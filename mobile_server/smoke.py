"""Local operator smoke test. Tokens stay in memory; creates one named test chat."""
import json
import subprocess
import time
import uuid
import requests

command = ['C:/Windows/System32/OpenSSH/ssh.exe', '-i', 'C:/Users/ASUS/.ssh/aliyun_ecs', '-o', 'BatchMode=yes',
           'root@47.102.146.139', 'cd /opt/quickmodel-mobile && runuser -u qmmobile -- /opt/quickmodel-mobile-venv/bin/python -m mobile_server.admin pair']
code = subprocess.check_output(command).decode().strip()
session = requests.Session()
session.trust_env = False
base = 'https://47.102.146.139/quickmodel-api'

def call(method, path, **kw):
    r = session.request(method, base+path, timeout=65, **kw)
    r.raise_for_status()
    return r.json()

response = call('POST', '/pair', json={'code':code,'name':'Temporary verification'})
session.headers['Authorization'] = 'Bearer '+response['token']
try:
    models = call('GET','/models')
    print('HTTPS pairing OK; model profiles:',len(models['models']),flush=True)
    model = models['active']
    c = call('POST','/conversations',json={'model':model})
    call('PATCH','/conversations/'+c['id'],json={'revision':c['revision'],'title':'手机端联调测试（可忽略）'})
    c = call('GET','/conversations/'+c['id'])
    body = {'model':model,'text':'请只回复：手机端连接成功','request_id':uuid.uuid4().hex,'revision':c['revision']}
    r = call('POST','/conversations/'+c['id']+'/send',json=body)
    assert call('POST','/conversations/'+c['id']+'/send',json=body)==r
    for _ in range(90):
        result=call('GET','/runs/'+r['run_id'])
        if result['status']!='running':break
        time.sleep(2)
    assert result['status']=='done', result['error']
    print('Real model response OK; reply chars:',len(result['text']),flush=True)
    for kind in ['summary','heart-rate','sleep']:
        result=call('GET','/health/'+kind)
        assert isinstance(result.get('data'),list)
        print('Health',kind,'OK; records:',len(result['data']),flush=True)
    print('Saved conversations:',len(call('GET','/conversations')),flush=True)
finally:
    call('DELETE','/device')
    assert session.get(base+'/models',timeout=20).status_code==401
    print('Temporary verification device revoked',flush=True)
