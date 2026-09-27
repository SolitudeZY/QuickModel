"""Single-owner mobile API; no desktop tool execution, no public admin routes."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import secrets
import sqlite3
import threading
import time
import uuid
import traceback
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.model_protocol import create_model_adapter
from mobile_server.preferences import Preferences, SavePreferences, public_settings
from mobile_server.weather import current_weather
from mobile_server import media, health_context, speech
from app.config import supports_native_images

ROOT = Path(os.environ.get('QM_MOBILE_DATA', '/var/lib/quickmodel-mobile'))
ROOT.mkdir(parents=True, exist_ok=True)
DB = ROOT / 'mobile.db'
LOCK = threading.RLock()
STOPS: dict[str, threading.Event] = {}
PAIR_ATTEMPTS: dict[str, list[float]] = {}
RUNNER = create_model_adapter


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS devices(hash TEXT PRIMARY KEY,name TEXT,created TEXT);
        CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,device TEXT,conv TEXT,request TEXT,payload_hash TEXT,
            status TEXT,text TEXT DEFAULT '',reasoning TEXT DEFAULT '',error TEXT DEFAULT '',created TEXT,updated TEXT,
            UNIQUE(device,request));
        CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,body TEXT);
        ''')
        db.execute("UPDATE runs SET status='interrupted',error='服务重启，本次生成已中断。' WHERE status='running'")


def models_config():
    key = Path(os.environ['QM_MOBILE_KEY_FILE']).read_bytes().strip()
    return json.loads(Fernet(key).decrypt((ROOT / 'models.enc').read_bytes()))


def save_models_config(config):
    key = Path(os.environ['QM_MOBILE_KEY_FILE']).read_bytes().strip()
    temporary = ROOT / 'models.enc.tmp'
    temporary.write_bytes(Fernet(key).encrypt(json.dumps(config,ensure_ascii=False).encode()))
    temporary.chmod(0o600)
    temporary.replace(ROOT / 'models.enc')


def get_conv(db, cid):
    row = db.execute('SELECT body,revision FROM conversations WHERE id=?', (cid,)).fetchone()
    if row is None:
        raise HTTPException(404, '会话不存在')
    result = json.loads(row['body'])
    result['revision'] = row['revision']
    return result


def save_conv(db, conv, revision):
    value = dict(conv)
    value.pop('revision', None)
    value['updated_at'] = now()
    db.execute('INSERT INTO conversations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision',
               (value['id'], json.dumps(value, ensure_ascii=False), revision))


async def auth(request: Request):
    bearer = request.headers.get('authorization', '')
    if not bearer.startswith('Bearer ') or len(bearer) > 256:
        raise HTTPException(401, '请先连接设备')
    digest = hashlib.sha256(bearer[7:].encode()).hexdigest()
    with connect() as db:
        if db.execute('SELECT 1 FROM devices WHERE hash=?', (digest,)).fetchone() is None:
            raise HTTPException(401, '设备已断开，请重新配对')
    return digest


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield
    for event in list(STOPS.values()):
        event.set()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def limits(request, call_next):
    try:
        if int(request.headers.get('content-length', '0')) > 2_000_000:
            return JSONResponse({'detail': '请求过大'}, status_code=413)
    except ValueError:
        return JSONResponse({'detail': '请求无效'}, status_code=400)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


class Pair(BaseModel):
    code: str = Field(min_length=8, max_length=64)
    name: str = Field(default='Android', max_length=80)


@app.post('/pair')
def pair(body: Pair, request: Request):
    # Pairing bootstrap is created only over SSH; never exposed by an HTTP route.
    host = request.client.host if request.client else 'unknown'
    with LOCK:
        attempts = [t for t in PAIR_ATTEMPTS.get(host, []) if time.time() - t < 300]
        PAIR_ATTEMPTS[host] = attempts + [time.time()]
        if len(attempts) >= 10:
            raise HTTPException(429, '尝试过多，请五分钟后重试')
        path = ROOT / 'pairing.json'
        if not path.exists():
            raise HTTPException(403, '配对码已使用或尚未生成')
        record = json.loads(path.read_text())
        normalized = body.code.replace('-', '').replace(' ', '').upper()
        if time.time() > record['expires'] or not secrets.compare_digest(
                hashlib.sha256(normalized.encode()).hexdigest(), record['hash']):
            raise HTTPException(403, '配对码无效或已过期')
        token = secrets.token_urlsafe(32)
        with connect() as db:
            db.execute('INSERT INTO devices VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), body.name, now()))
        path.unlink()
        return {'token': token}


@app.delete('/device')
def revoke(device=Depends(auth)):
    with connect() as db:
        db.execute('DELETE FROM devices WHERE hash=?', (device,))
    return {'ok': True}


@app.get('/models')
def models(device=Depends(auth)):
    config = models_config()
    return {'models': [{'name': m['name'], 'model': m.get('model', '')} for m in config['model_configs']],
            'active': config.get('active_model_config', '')}


@app.get('/settings')
def settings(device=Depends(auth)):
    return public_settings(models_config())


@app.post('/settings')
def update_settings(body: SavePreferences, device=Depends(auth)):
    with LOCK:
        config = models_config()
        if body.revision != config.get('settings_revision',0):
            raise HTTPException(409,'设置已在其他设备更新，请重新载入后修改')
        names = {m['name'] for m in config['model_configs']}
        if body.active_model_config not in names:
            raise HTTPException(400,'默认模型不存在')
        if body.model_edit:
            if body.model_edit.name not in names:
                raise HTTPException(400,'编辑的模型不存在')
            for m in config['model_configs']:
                if m['name'] == body.model_edit.name:
                    m.update(body.model_edit.model_dump(exclude={'name'}))
        config['mobile_preferences'] = body.preferences.model_dump()
        config['active_model_config'] = body.active_model_config
        config['settings_revision'] = body.revision+1
        save_models_config(config)
    return public_settings(config)


@app.get('/weather')
async def weather(request: Request, device=Depends(auth)):
    p = Preferences.model_validate(models_config().get('mobile_preferences',{})).model_dump()
    # Uvicorn trusts only the local Apache proxy, which appends the actual client IP.
    return await current_weather(p, request.client.host if request.client else '')


@app.get('/conversations')
def conversations(device=Depends(auth)):
    with connect() as db:
        result = []
        for row in db.execute('SELECT body,revision FROM conversations'):
            c = json.loads(row['body'])
            result.append({k: c.get(k) for k in ('id', 'title', 'updated_at', 'model_config', 'archived_at', 'source')}
                          | {'revision': row['revision']})
    return sorted(result, key=lambda c: c.get('updated_at') or '', reverse=True)


@app.get('/conversations/{cid}')
def conversation(cid: str, device=Depends(auth)):
    with connect() as db:
        return get_conv(db, cid)


class NewConversation(BaseModel):
    model: str = Field(max_length=150)


@app.post('/conversations')
def new_conversation(body: NewConversation, device=Depends(auth)):
    c = {'id': 'conv_mobile_' + uuid.uuid4().hex, 'title': '新对话', 'messages': [],
         'model_config': body.model, 'created_at': now(), 'source': 'mobile'}
    with LOCK, connect() as db:
        save_conv(db, c, 1)
        return get_conv(db, c['id'])


class Rename(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    revision: int


@app.patch('/conversations/{cid}')
def rename(cid: str, body: Rename, device=Depends(auth)):
    with LOCK, connect() as db:
        c = get_conv(db, cid)
        if c['revision'] != body.revision:
            raise HTTPException(409, '会话有更新，请刷新后重试')
        c['title'] = body.title
        c['title_source'] = 'manual'
        save_conv(db, c, c['revision'] + 1)
    return {'ok': True}


class Send(BaseModel):
    request_id: str = Field(min_length=16, max_length=80)
    text: str = Field(min_length=1, max_length=20000)
    model: str = Field(max_length=150)
    revision: int
    attachments: list[str] = Field(default_factory=list, max_length=12)


class ImageUpload(BaseModel):
    data: str = Field(max_length=1400000)


class SpeechText(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class SpeechSegment(BaseModel):
    text: str = Field(min_length=1, max_length=220)


@app.post('/voice/tts-stream')
def stream_voice(body: SpeechSegment, device=Depends(auth)):
    cfg = models_config().get('speech', {})
    if not cfg.get('api_key'):
        raise HTTPException(503, '服务器尚未配置语音服务')
    def frames():
        try:
            yield from speech.stream_pcm(body.text, cfg)
        except Exception as exc:
            logging.warning('Speech stream failed: %s', type(exc).__name__)
            yield '{"error":"语音流中断，请重试"}\n'
    return StreamingResponse(frames(), media_type='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})


@app.post('/voice/asr')
def recognize_voice(body: ImageUpload, device=Depends(auth)):
    cfg = models_config().get('speech', {})
    if not cfg.get('api_key'):
        raise HTTPException(503, '服务器尚未配置语音服务')
    try:
        return {'text': speech.transcribe(body.data, cfg)}
    except Exception:
        raise HTTPException(502, '语音识别失败，请重试或使用文字输入')


@app.post('/voice/tts')
def speak_text(body: SpeechText, device=Depends(auth)):
    cfg = models_config().get('speech', {})
    if not cfg.get('api_key'):
        raise HTTPException(503, '服务器尚未配置语音服务')
    try:
        return {'audio': speech.synthesize(body.text, cfg)}
    except Exception:
        raise HTTPException(502, '语音合成失败，文字回复仍可阅读')


@app.post('/media/images')
def upload_image(body: ImageUpload, device=Depends(auth)):
    return media.save_image(ROOT, body.data)


@app.get('/media/images/{identity}')
def image_preview(identity: str, device=Depends(auth)):
    return media.preview(ROOT, identity)


def generate(rid, cid, cfg, messages, event, options=None):
    adapter = None
    text, reasoning, flushed = '', '', 0.0
    state, error = 'done', ''

    def flush(force=False):
        nonlocal flushed
        if not force and time.monotonic() - flushed < .35:
            return
        with connect() as db:
            db.execute('UPDATE runs SET text=?,reasoning=?,updated=? WHERE id=?', (text, reasoning, now(), rid))
        flushed = time.monotonic()

    def on_text(delta):
        nonlocal text
        text += delta
        if len(text) > 120000:
            event.set()
        flush()

    def on_thinking(delta):
        nonlocal reasoning
        reasoning = (reasoning + delta)[:100000]
        flush()

    timer = threading.Timer(180, event.set)
    timer.daemon = True
    timer.start()
    try:
        adapter = RUNNER(cfg)
        options = options or {}
        current = messages[-1]
        question = current['content']
        snapshot = None
        if options.get('health_context_enabled'):
            try:
                snapshot = health_context.read_snapshot()
            except Exception:
                snapshot = {'status': 'unavailable', 'message': '健康记录读取失败，不能假设当前健康状态'}
            current['content'] += health_context.context_text(snapshot)
        refs = current.get('images', [])
        if refs and not supports_native_images(cfg):
            vision = models_config().get('vision', {})
            current['content'] += '\n\n[独立视觉服务对本次图片的观察]\n' + media.describe(refs, question, vision)
            current.pop('images', None)
        if event.is_set():
            raise InterruptedError('Stopped before provider request')
        # Freeze exactly what will be sent before the first provider request.
        with LOCK, connect() as db:
            conversation = get_conv(db, cid)
            conversation['messages'][-1]['model_content'] = current['content']
            if snapshot is not None:
                conversation['messages'][-1]['health_snapshot'] = snapshot
            if current.get('images'):
                conversation['messages'][-1]['native_images'] = True
            save_conv(db, conversation, conversation['revision'])
        answer = adapter.stream_round(messages, tools=[], on_text=on_text, on_thinking=on_thinking,
                                      stop_event=event, max_tokens=options.get('max_output_tokens',0) or None,
                                      thinking=options.get('thinking','off'),stateless=True)
        if not text:
            text = answer.assistant_message.get('content', '') or ''
        if event.is_set():
            state = 'stopped'
        elif not text:
            state, error = 'error', '模型没有返回正文，请换一个模型重试。'
        with connect() as db:
            db.execute('INSERT OR REPLACE INTO usage VALUES(?,?)',
                       (rid, json.dumps({'model': cfg['name'], 'created_at': now(), **answer.usage.as_dict()})))
    except Exception as exc:
        # Provider error bodies can contain request data; log only exception type and code locations.
        logging.error('Model request %s failed: %s; %s', rid, type(exc).__name__,
                      [(f.name, f.lineno) for f in traceback.extract_tb(exc.__traceback__)])
        state, error = ('stopped', '') if event.is_set() else ('error', '模型请求失败。请检查服务端模型配置，或换一个模型重试。')
    finally:
        timer.cancel()
        if adapter is not None and getattr(adapter, '_client', None):
            try:
                adapter._client.close()
            except Exception:
                pass
        with LOCK, connect() as db:
            c = get_conv(db, cid)
            if text:
                c['messages'].append({'role': 'assistant', 'content': text, 'reasoning_content': reasoning,
                                      'mobile_run_id': rid})
            save_conv(db, c, c['revision'] + 1)
            db.execute('UPDATE runs SET text=?,reasoning=?,status=?,error=?,updated=? WHERE id=?',
                       (text, reasoning, state, error, now(), rid))
            STOPS.pop(rid, None)


@app.post('/conversations/{cid}/send')
def send(cid: str, body: Send, device=Depends(auth)):
    config = models_config()
    cfg = next((m for m in config['model_configs'] if m['name'] == body.model), None)
    if not cfg:
        raise HTTPException(400, '模型不存在')
    digest = hashlib.sha256((cid + '\n' + body.model + '\n' + body.text + ('\n' + json.dumps(body.attachments) if body.attachments else '')).encode()).hexdigest()
    with LOCK, connect() as db:
        previous = db.execute('SELECT id,payload_hash FROM runs WHERE device=? AND request=?', (device, body.request_id)).fetchone()
        if previous:
            if previous['payload_hash'] != digest:
                raise HTTPException(409, '重试请求内容不一致')
            return {'run_id': previous['id']}
        c = get_conv(db, cid)
        if c.get('source') == 'desktop':
            raise HTTPException(409, '桌面历史暂为只读，请新建手机对话')
        if c['revision'] != body.revision:
            raise HTTPException(409, '会话已更新，请刷新后重试')
        if len(STOPS) >= 2 or db.execute("SELECT 1 FROM runs WHERE conv=? AND status='running'", (cid,)).fetchone():
            raise HTTPException(409, '已有回复正在生成，请等待或停止')
        refs = [media.reference(ROOT, identity) for identity in body.attachments]
        if refs and not supports_native_images(cfg) and not config.get('vision', {}).get('api_key'):
            raise HTTPException(400, '当前模型不支持图片，服务器也未配置独立视觉服务')
        history = []
        for m in c['messages']:
            if m['role'] not in ('user', 'assistant'):
                continue
            item = {'role': m['role'], 'content': m.get('model_content', m.get('content', ''))}
            if m.get('native_images'):
                if not supports_native_images(cfg):
                    raise HTTPException(400, '此会话包含原生图片，请使用支持图片的模型或新建会话')
                item['images'] = [media.reference(ROOT, x) for x in m.get('attachments', [])]
            history.append(item)
        history.append({'role': 'user', 'content': body.text, **({'images': refs} if refs else {})})
        if len(json.dumps(history, ensure_ascii=False)) > 90000:
            raise HTTPException(413, '当前对话较长，请新建对话继续')
        c['messages'].append({'role': 'user', 'content': body.text, 'attachments': body.attachments})
        c['model_config'] = body.model
        if c.get('title') == '新对话':
            c['title'] = body.text.strip()[:40]
        save_conv(db, c, c['revision'] + 1)
        rid = uuid.uuid4().hex
        db.execute('INSERT INTO runs(id,device,conv,request,payload_hash,status,created,updated) VALUES(?,?,?,?,?,?,?,?)',
                   (rid, device, cid, body.request_id, digest, 'running', now(), now()))
        stop = threading.Event()
        STOPS[rid] = stop
    system = cfg.get('system_prompt') or '你是 QuickModel 助手。准确、清晰地回答用户，不声称执行了没有提供的工具。'
    thread = threading.Thread(target=generate, args=(rid, cid, cfg, [{'role': 'system', 'content': system}] + history, stop, config.get('mobile_preferences',{})), daemon=True)
    thread.start()
    return {'run_id': rid}


@app.get('/runs/{rid}')
def run(rid: str, device=Depends(auth)):
    with connect() as db:
        row = db.execute('SELECT id,conv,status,text,reasoning,error,updated FROM runs WHERE id=? AND device=?', (rid, device)).fetchone()
        if row is None:
            raise HTTPException(404, '生成任务不存在')
        return dict(row)


@app.post('/runs/{rid}/stop')
def stop(rid: str, device=Depends(auth)):
    run(rid, device)
    with LOCK:
        if rid in STOPS:
            STOPS[rid].set()
    return {'ok': True}


@app.get('/health/{kind}')
async def health(kind: str, device=Depends(auth)):
    if kind not in ('summary', 'heart-rate', 'sleep', 'coverage', 'connection'):
        raise HTTPException(404)
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        result = await client.post('http://127.0.0.1:18323/action/' + kind, json={},
                                  headers={'Origin': 'http://127.0.0.1:18323', 'X-QM-Lab': '1'})
    if result.status_code != 200:
        raise HTTPException(502, '健康服务暂不可用')
    return result.json()


@app.post('/health/sync')
async def sync_health(device=Depends(auth)):
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        result = await client.post('http://127.0.0.1:18323/action/sync', json={},
                                  headers={'Origin': 'http://127.0.0.1:18323', 'X-QM-Lab': '1'})
    if result.status_code != 200:
        raise HTTPException(502, '健康同步未能启动')
    return result.json()


@app.get('/health-sync/{sid}')
async def health_progress(sid: str, device=Depends(auth)):
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        result = await client.post('http://127.0.0.1:18323/action/progress', json={'sync_id': sid},
                                  headers={'Origin': 'http://127.0.0.1:18323', 'X-QM-Lab': '1'})
    if result.status_code != 200:
        raise HTTPException(502, '无法读取同步状态')
    return result.json()
