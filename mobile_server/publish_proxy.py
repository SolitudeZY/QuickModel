"""Run as root on the server, after testing the loopback service."""
from pathlib import Path
import subprocess
import time

path = Path('/etc/apache2/sites-available/obsidian-https.conf')
old = path.read_text()
new = old.replace('^/(?!dav(?:/|$))', '^/(?!(?:dav|quickmodel-api|quickmodel-download)(?:/|$))')
if 'ProxyPass /quickmodel-api/' not in new:
    new = new.replace('    DocumentRoot', '''    ProxyPass /quickmodel-api/ http://127.0.0.1:18324/ connectiontimeout=5 timeout=60
    ProxyPassReverse /quickmodel-api/ http://127.0.0.1:18324/
    <Location /quickmodel-api/>
        Require all granted
        LimitRequestBody 2000000
    </Location>
    Alias /quickmodel-download/ /var/www/quickmodel-download/
    <Directory /var/www/quickmodel-download>
        Options None
        AllowOverride None
        Require all granted
    </Directory>
    DocumentRoot''')
backup = path.with_name(path.name + '.backup-mobile-' + str(int(time.time())))
backup.write_text(old)
subprocess.run(['a2enmod', 'proxy', 'proxy_http'], check=True)
path.write_text(new)
try:
    subprocess.run(['apache2ctl', 'configtest'], check=True)
    subprocess.run(['systemctl', 'reload', 'apache2'], check=True)
except BaseException:
    path.write_text(old)
    subprocess.run(['systemctl', 'reload', 'apache2'])
    raise
print('Mobile HTTPS route enabled; WebDAV configuration preserved.')
