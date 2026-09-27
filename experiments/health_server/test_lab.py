"""Tests use temporary data; no user login and no external API requests."""
import os
import tempfile
from pathlib import Path
from cryptography.fernet import Fernet

temp = tempfile.TemporaryDirectory()
os.environ['QM_HEALTH_DATA'] = temp.name
os.environ['XDG_CONFIG_HOME'] = temp.name
key = Path(temp.name) / 'key'
key.write_bytes(Fernet.generate_key())
os.environ['QM_HEALTH_KEY_FILE'] = str(key)
import lab
from fastapi.testclient import TestClient


def test_encryption_and_failure_closed():
    lab.store_secret('test', 'SENSITIVE_TEST_VALUE')
    assert lab.read_vault()['test'] == 'SENSITIVE_TEST_VALUE'
    assert b'SENSITIVE_TEST_VALUE' not in (Path(temp.name) / 'credentials.enc').read_bytes()
    lab.delete_secret('test')
    assert 'test' not in lab.read_vault()
    original = lab.save_vault
    def fail(_):
        raise OSError('storage failure')
    lab.save_vault = fail
    try:
        try:
            lab.store_secret('test', 'secret')
            assert False, 'must not return False to enable upstream plaintext fallback'
        except OSError:
            pass
    finally:
        lab.save_vault = original


def test_origin_and_unconnected_state():
    with TestClient(lab.app, base_url='http://127.0.0.1:18323') as client:
        assert client.get('/').status_code == 200
        assert client.get('/', headers={'Host': 'evil.test'}).status_code == 403
        assert client.post('/action/start', json={}).status_code == 403
        headers = {'Origin': 'http://127.0.0.1:18323', 'X-QM-Lab': '1'}
        assert client.post('/action/start', json={}, headers={**headers, 'Origin': 'https://evil.test'}).status_code == 403
        assert client.post('/action/connection', json={}, headers=headers).json()['connected'] is False
        assert client.post('/action/sync', json={}, headers=headers).status_code == 409
        assert client.get('/api/auth/keys').status_code == 404
