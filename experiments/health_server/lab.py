"""Isolated loopback-only health experiment; upstream API never exposed directly."""
import json
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

os.umask(0o077)
DATA = Path(os.environ.get("QM_HEALTH_DATA", "/var/lib/quickmodel-health"))
DATA.mkdir(parents=True, exist_ok=True)
fernet = Fernet(Path(os.environ["QM_HEALTH_KEY_FILE"]).read_bytes().strip())


def read_vault():
    path = DATA / "credentials.enc"
    return json.loads(fernet.decrypt(path.read_bytes())) if path.exists() else {}


def save_vault(values):
    temp = DATA / "credentials.enc.tmp"
    temp.write_bytes(fernet.encrypt(json.dumps(values).encode()))
    temp.replace(DATA / "credentials.enc")


def store_secret(key, value):
    values = read_vault()
    values[key] = value
    save_vault(values)
    return True  # errors propagate: NEVER fall back to plaintext


def delete_secret(key):
    values = read_vault()
    values.pop(key, None)
    save_vault(values)


os.environ["MI_FITNESS_API_KEY"] = secrets.token_urlsafe(32)
os.environ["MI_FITNESS_ADMIN_KEY"] = secrets.token_urlsafe(32)
from mi_fitness_mcp import api as upstream
upstream.store_api_key_secret = store_secret
upstream.load_api_key_secret = lambda key: read_vault().get(key)
upstream.delete_api_key_secret = delete_secret
logging.getLogger("mi_fitness_mcp").setLevel(logging.CRITICAL)


@asynccontextmanager
async def lifespan(app):
    async with upstream.lifespan(upstream.app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=upstream.app),
                                     base_url="http://127.0.0.1", timeout=240) as client:
            app.state.client = client
            yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
ORIGINS = {"http://127.0.0.1:18323", "http://localhost:18323"}


@app.middleware("http")
async def local_only(request, call_next):
    host = request.headers.get("host", "")
    if host not in {"127.0.0.1:18323", "localhost:18323"}:
        return Response(status_code=403)
    if request.method != "GET" and (
        request.headers.get("origin") not in ORIGINS
        or request.headers.get("x-qm-lab") != "1"
    ):
        return Response(status_code=403)
    result = await call_next(request)
    result.headers["Cache-Control"] = "no-store"
    result.headers["X-Frame-Options"] = "DENY"
    result.headers["X-Content-Type-Options"] = "nosniff"
    result.headers["Referrer-Policy"] = "no-referrer"
    result.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-ancestors 'none'; connect-src 'self'"
    return result


@app.get("/")
async def index():
    return HTMLResponse(Path(__file__).with_name("index.html").read_text(encoding="utf-8"))


@app.post("/action/{action}")
async def action(action: str, request: Request):
    body = await request.json()
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    dates = {"start_date": str(today - timedelta(days=6)), "end_date": str(today)}
    token = body.get("token", "")
    active = read_vault().get("active_api_key")
    headers = {"X-API-Key": active or os.environ["MI_FITNESS_API_KEY"],
               "X-Admin-Key": os.environ["MI_FITNESS_ADMIN_KEY"]}
    method, params, payload = "GET", {}, None
    if action == "start":
        upstream.app.state.qr_sessions.clear()
        method, path, params = "POST", "/api/auth/qr/start", {"region": "cn"}
    elif action in ("poll", "image"):
        if not re.fullmatch(r"[a-f0-9]{32}", token):
            return JSONResponse({"message": "二维码标识无效"}, status_code=400)
        path = "/api/auth/qr/poll" if action == "poll" else f"/api/auth/qr/{token}.png"
        params = {"token": token} if action == "poll" else {}
    elif action == "connection":
        if not active:
            return {"connected": False, "message": "尚未扫码连接"}
        path = "/api/status"
    elif action == "sync":
        if not active:
            return JSONResponse({"message": "请先扫码"}, status_code=409)
        method, path = "POST", "/api/sync"
        payload = {**dates, "data_types": ["daily_activity", "heart_rate", "sleep"], "background": True}
    elif action == "progress":
        sid = body.get("sync_id", "")
        if not re.fullmatch(r"[a-f0-9-]{32,36}", sid):
            return Response(status_code=400)
        path = f"/api/sync/{sid}"
    elif action in ("summary", "sleep", "heart-rate", "coverage"):
        if not active:
            return JSONResponse({"message": "请先扫码"}, status_code=409)
        path, params = f"/api/{action}", dates
    else:
        return Response(status_code=404)
    try:
        result = await request.app.state.client.request(method, path, params=params, json=payload, headers=headers)
        if result.status_code >= 400:
            return JSONResponse({"message": f"请求失败（{result.status_code}），请重试或重新扫码。"}, status_code=502)
        if action == "image":
            return Response(result.content, media_type="image/png")
        data = result.json()
        if action == "poll" and data.get("status") == "confirmed":
            key = data.pop("api_key", None)
            data.pop("user_id", None)
            if not key:
                return {"status": "failed", "message": "小米未提供可用登录会话，请重新扫码。"}
            store_secret("active_api_key", key)
            return {"status": "confirmed"}
        if action == "start":
            return {"qr_token": data["qr_token"], "expires_in": data.get("expires_in", 300)}
        # Do not relay upstream errors that could include credentials or URLs.
        def sanitize(value):
            if isinstance(value, dict):
                return {k: ("采集未完成，请检查账号连接状态。" if k == "error" and v else sanitize(v))
                        for k, v in value.items() if k not in {"user_id", "pass_token", "api_key", "note"}}
            if isinstance(value, list):
                return [sanitize(v) for v in value]
            return value
        return sanitize(data)
    except Exception:
        return JSONResponse({"message": "服务请求未完成，请重试；凭据不会在错误信息中显示。"}, status_code=502)
