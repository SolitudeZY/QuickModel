"""Operator test using synthetic media only. Leaves one clearly labelled test chat."""
import base64
import io
import subprocess
import time
import uuid
import requests
from PIL import Image

ssh = ['C:/Windows/System32/OpenSSH/ssh.exe', '-i', 'C:/Users/ASUS/.ssh/aliyun_ecs', '-o', 'BatchMode=yes',
       '-o', 'StrictHostKeyChecking=yes', 'root@47.102.146.139']
code = subprocess.check_output(ssh + ['cd /opt/quickmodel-mobile && runuser -u qmmobile -- /opt/quickmodel-mobile-venv/bin/python -m mobile_server.admin pair']).decode().strip()
session = requests.Session(); session.trust_env = False
base = 'https://47.102.146.139/quickmodel-api'


def call(method, path, **kw):
    response = session.request(method, base + path, timeout=65, **kw)
    if not response.ok:
        raise RuntimeError(f'{path}: HTTP {response.status_code}')
    return response.json()


session.headers['Authorization'] = 'Bearer ' + call('POST', '/pair', json={'code': code, 'name': 'Synthetic multimodal QA'})['token']
try:
    out = io.BytesIO(); Image.new('RGB', (128, 128), 'red').save(out, 'PNG')
    attachment = call('POST', '/media/images', json={'data': base64.b64encode(out.getvalue()).decode()})
    assert call('GET', '/media/images/' + attachment['id'])['preview'].startswith('data:image/jpeg')
    models = call('GET', '/models'); model = models['active']
    conv = call('POST', '/conversations', json={'model': model})
    call('PATCH', '/conversations/' + conv['id'], json={'revision': conv['revision'], 'title': '多模态合成素材测试（可忽略）'})
    conv = call('GET', '/conversations/' + conv['id'])
    body = {'model': model, 'text': '这张图片主要是什么颜色？只回答颜色名称。', 'attachments': [attachment['id']],
            'revision': conv['revision'], 'request_id': uuid.uuid4().hex}
    run = call('POST', '/conversations/' + conv['id'] + '/send', json=body)
    assert call('POST', '/conversations/' + conv['id'] + '/send', json=body) == run
    for _ in range(100):
        result = call('GET', '/runs/' + run['run_id'])
        if result['status'] != 'running': break
        time.sleep(2)
    assert result['status'] == 'done', result['status']
    assert '红' in result['text'] or 'red' in result['text'].lower(), 'Vision did not identify synthetic red square'
    print('PASS private image upload, native vision, persisted reference, idempotent send', flush=True)
    audio = call('POST', '/voice/tts', json={'text': '你好，这是语音测试。'})
    text = call('POST', '/voice/asr', json={'data': audio['audio']})['text']
    assert '测试' in text
    print('PASS authenticated TTS -> synthetic audio -> ASR', flush=True)
finally:
    call('DELETE', '/device')
    assert session.get(base + '/models', timeout=20).status_code == 401
    print('Temporary QA device revoked', flush=True)
