"""SSH-only administration. Never expose through the API."""
import argparse
import hashlib
import json
import os
import secrets
import sys
import time
from pathlib import Path

from cryptography.fernet import Fernet

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['models', 'pair', 'import', 'preferences', 'multimodal'])
args = parser.parse_args()
root = Path(os.environ.get('QM_MOBILE_DATA', '/var/lib/quickmodel-mobile'))
root.mkdir(parents=True, exist_ok=True)
if args.action == 'models':
    keyfile = Path(os.environ.get('QM_MOBILE_KEY_FILE', '/etc/quickmodel-mobile/vault.key'))
    keyfile.parent.mkdir(parents=True, exist_ok=True)
    if not keyfile.exists():
        keyfile.write_bytes(Fernet.generate_key())
        keyfile.chmod(0o600)
    config = json.load(sys.stdin)
    sanitized = {}
    if (root / 'models.enc').exists():
        sanitized = json.loads(Fernet(keyfile.read_bytes()).decrypt((root/'models.enc').read_bytes()))
    sanitized.update({k: config[k] for k in ('model_configs', 'active_model_config')})
    sanitized['settings_revision'] = sanitized.get('settings_revision',0)+1
    (root / 'models.enc').write_bytes(Fernet(keyfile.read_bytes()).encrypt(json.dumps(sanitized).encode()))
    print('Encrypted model profiles saved:', len(sanitized['model_configs']))
elif args.action == 'multimodal':
    from mobile_server.server import models_config, save_models_config
    config = models_config()
    incoming = json.load(sys.stdin)
    for field in ('vision', 'speech'):
        if field in incoming:
            config[field] = incoming[field]
    save_models_config(config)
    print('Encrypted multimodal configuration saved')
elif args.action == 'preferences':
    from mobile_server.server import models_config, save_models_config
    from mobile_server.preferences import Preferences
    config=models_config()
    incoming=json.load(sys.stdin)
    if 'mobile_preferences' not in config:
        config['mobile_preferences']=Preferences.model_validate(incoming).model_dump()
        config['settings_revision']=config.get('settings_revision',0)+1
        save_models_config(config)
        print('Initial mobile preferences imported')
    else:
        print('Existing mobile preferences preserved')
elif args.action == 'pair':
    code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(12))
    (root / 'pairing.json').write_text(json.dumps({'hash': hashlib.sha256(code.encode()).hexdigest(), 'expires': time.time()+86400}))
    print('-'.join(code[i:i+4] for i in range(0, 12, 4)))
else:
    from mobile_server.server import connect, save_conv
    records = json.load(sys.stdin)
    added = 0
    with connect() as db:
        for item in records:
            cid, body = item['id'], item['body']
            if body.get('temporary') or body.get('is_temporary'):
                continue
            # Keep originals and desktop identities; never overwrite mobile edits or imports.
            if db.execute('SELECT 1 FROM conversations WHERE id=?', (cid,)).fetchone():
                continue
            body['id'], body['source'] = cid, 'desktop'
            save_conv(db, body, 1)
            added += 1
    print('Imported desktop conversations:', added)
