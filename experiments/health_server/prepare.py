"""Run on the experiment server after fetching the reviewed source archive."""
import json
import os
from pathlib import Path

root = Path('/opt/quickmodel-health-source')
# Python 3.10 compatibility: UTC is just timezone.utc in Python 3.11+.
for path in (root / 'src').rglob('*.py'):
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    changed = False
    for index, line in enumerate(lines):
        if line.startswith('from datetime import ') and 'UTC' in line:
            names = [n.strip() for n in line.strip().split('import ', 1)[1].split(',') if n.strip() != 'UTC']
            if 'timezone' not in names:
                names.append('timezone')
            lines[index] = 'from datetime import ' + ', '.join(names) + '\nUTC = timezone.utc\n'
            changed = True
    if changed:
        path.write_text(''.join(lines))

os.umask(0o077)
from cryptography.fernet import Fernet
keydir = Path('/etc/quickmodel-health')
keydir.mkdir(exist_ok=True)
key = keydir / 'vault.key'
if not key.exists():
    key.write_bytes(Fernet.generate_key())
data = Path('/var/lib/quickmodel-health')
data.mkdir(exist_ok=True)
cfg = data / '.config/mi-fitness-mcp'
cfg.mkdir(parents=True, exist_ok=True)
(cfg / 'config.json').write_text(json.dumps({
    'region': 'cn', 'timezone': 'Asia/Shanghai', 'mode': 'not_configured',
    'database_path': str(data / 'health.db'), 'logs_path': str(data / 'health.log'),
    'auto_sync_on_start': False, 'store_raw_payloads': False,
    'default_lookback_days': 7, 'request_retries': 2,
}))
