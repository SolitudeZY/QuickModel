#!/bin/sh
set -eu
id qmmobile >/dev/null 2>&1 || useradd --system --home /var/lib/quickmodel-mobile --shell /usr/sbin/nologin qmmobile
install -d -o qmmobile -g qmmobile -m 700 /var/lib/quickmodel-mobile /etc/quickmodel-mobile
if [ ! -d /opt/quickmodel-mobile-venv ]; then python3 -m venv /opt/quickmodel-mobile-venv; fi
python3 - <<'PY'
from pathlib import Path
names = ('openai', 'anthropic', 'fastapi', 'uvicorn', 'cryptography', 'httpx')
lines = Path('/opt/quickmodel-mobile/requirements.txt').read_text().splitlines()
Path('/opt/quickmodel-mobile/server-requirements.txt').write_text('\n'.join(x for x in lines if any(x.startswith(n+'>') for n in names)))
PY
/opt/quickmodel-health-bootstrap/bin/uv pip install --python /opt/quickmodel-mobile-venv/bin/python --index-url https://mirrors.aliyun.com/pypi/simple -r /opt/quickmodel-mobile/server-requirements.txt
install -m 644 /opt/quickmodel-mobile/mobile_server/quickmodel-mobile.service /etc/systemd/system/quickmodel-mobile.service
systemctl daemon-reload
systemctl enable quickmodel-mobile
