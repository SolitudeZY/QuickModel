"""Short-clip Alibaba ASR/TTS. Credentials never leave the server."""
import base64
from urllib.parse import urlsplit
import httpx
import json
import uuid
from websockets.sync.client import connect


def stream_pcm(text, config):
    """Yield protocol-safe NDJSON as audio arrives. Closing the iterator closes WS."""
    if not text or len(text) > 220:
        raise ValueError('Invalid speech segment')
    url = config.get('tts_realtime_url',
        'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime')
    if not url.startswith('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model='):
        raise ValueError('Untrusted realtime speech endpoint')
    received = 0
    with connect(url, additional_headers={'Authorization': 'Bearer ' + config['api_key']},
                 open_timeout=12, close_timeout=2) as ws:
        def send(kind, **fields):
            ws.send(json.dumps({'event_id': uuid.uuid4().hex, 'type': kind, **fields}))
        send('session.update', session={'voice': config.get('voice', 'Cherry'), 'mode': 'server_commit',
             'language_type': 'Chinese', 'response_format': 'pcm', 'sample_rate': 24000})
        send('input_text_buffer.append', text=text)
        send('input_text_buffer.commit')
        send('session.finish')
        for _ in range(2000):
            event = json.loads(ws.recv(timeout=30))
            kind = event.get('type')
            if kind == 'response.audio.delta':
                chunk = event.get('delta', '')
                if not isinstance(chunk, str) or len(chunk) > 100000:
                    raise ValueError('Invalid speech chunk')
                received += len(chunk)
                if received > 2800000:
                    raise ValueError('Speech segment too large')
                yield json.dumps({'audio': chunk}, separators=(',', ':')) + '\n'
            elif kind == 'error':
                raise ValueError('Speech provider returned an error')
            elif kind == 'session.finished':
                yield '{"done":true}\n'
                return
        raise TimeoutError('Speech stream did not finish')


def transcribe(data, config):
    raw = base64.b64decode(data, validate=True)
    mime = 'audio/mp4' if b'ftyp' in raw[:32] else 'audio/wav' if raw[:4] == b'RIFF' and raw[8:12] == b'WAVE' else ''
    if not 100 < len(raw) <= 1000000 or not mime:
        raise ValueError('Invalid audio recording')
    with httpx.Client(timeout=45, trust_env=False) as client:
        response = client.post(config['asr_url'], headers={'Authorization': 'Bearer ' + config['api_key']},
            json={'model': config.get('asr_model', 'qwen3-asr-flash'), 'messages': [
                {'role': 'user', 'content': [{'type': 'input_audio', 'input_audio': {
                    'data': 'data:' + mime + ';base64,' + data}}]}],
                  'asr_options': {'enable_itn': True}})
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content'][:20000]


def synthesize(text, config):
    with httpx.Client(timeout=45, trust_env=False) as client:
        response = client.post(config['tts_url'], headers={'Authorization': 'Bearer ' + config['api_key']},
            json={'model': config.get('tts_model', 'qwen3-tts-flash'),
                  'input': {'text': text, 'voice': config.get('voice', 'Cherry'), 'language_type': 'Chinese'}})
        response.raise_for_status()
        url = response.json()['output']['audio']['url']
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not (parsed.hostname or '').endswith('.aliyuncs.com') or parsed.username or parsed.password or parsed.port not in (None,443):
            raise ValueError('Untrusted audio download URL')
        # DashScope sometimes returns an HTTP OSS URL. OSS supports the same signed
        # path over HTTPS; never download voice content over cleartext transport.
        url = parsed._replace(scheme='https').geturl()
        # Fetch provider output without sending our API key and bound memory usage.
        audio = bytearray()
        with client.stream('GET', url) as result:
            result.raise_for_status()
            for chunk in result.iter_bytes():
                audio.extend(chunk)
                if len(audio) > 2500000:
                    raise ValueError('Audio too large')
        return base64.b64encode(audio).decode()
