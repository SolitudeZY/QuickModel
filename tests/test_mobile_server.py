import hashlib
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault('QM_MOBILE_DATA', tempfile.mkdtemp(prefix='qm-mobile-test-'))
from fastapi.testclient import TestClient
from mobile_server import server as s
from app.model_protocol import ModelRoundResult, NormalizedUsage
from cryptography.fernet import Fernet


class MobileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (s.ROOT, s.DB)
        s.ROOT = Path(self.temp.name)
        s.DB = s.ROOT / 'mobile.db'
        s.PAIR_ATTEMPTS.clear()
        self.client = TestClient(s.app)
        self.client.__enter__()
        self.cfg = patch.object(s, 'models_config', return_value={'model_configs': [{'name':'test','model':'test','api_key':'never-export'}], 'active_model_config':'test'})
        self.cfg.start()
        self.token = 'unit-test-token'
        with s.connect() as db:
            db.execute('INSERT INTO devices VALUES(?,?,?)',(hashlib.sha256(self.token.encode()).hexdigest(),'test',s.now()))
        self.client.headers['Authorization'] = 'Bearer '+self.token

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.cfg.stop()
        s.ROOT,s.DB = self.old
        self.temp.cleanup()

    def test_auth_and_secret_projection(self):
        self.assertNotIn('never-export', self.client.get('/models').text)
        self.client.headers.clear()
        for route in ['/models','/conversations','/health/summary','/runs/abc']:
            self.assertEqual(self.client.get(route).status_code,401)

    def test_factory_selects_concrete_protocol(self):
        from app.model_protocol import OpenAIChatAdapter
        adapter = s.RUNNER({'name':'test', 'model':'test', 'api_key':'test', 'api_protocol':'openai_chat'})
        self.assertIsInstance(adapter, OpenAIChatAdapter)

    def test_settings_encryption_revision_and_model_preservation(self):
        self.cfg.stop()
        key=Fernet.generate_key(); keypath=s.ROOT/'key';keypath.write_bytes(key)
        with patch.dict(os.environ,{'QM_MOBILE_KEY_FILE':str(keypath)}):
            initial={'model_configs':[{'name':'test','model':'test','api_key':'never-export','base_url':'https://example.test','provider_profile':'deepseek'}],'active_model_config':'test'}
            s.save_models_config(initial)
            public=self.client.get('/settings').json()
            self.assertNotIn('never-export',json.dumps(public))
            self.assertNotIn('base_url',public['models'][0])
            body={'revision':0,'active_model_config':'test','preferences':public['preferences'],
                  'model_edit':{'name':'test','model':'new-model','system_prompt':'new prompt'}}
            body['preferences']['theme_mode']='night'
            saved=self.client.post('/settings',json=body)
            self.assertEqual(saved.status_code,200,saved.text)
            self.assertEqual(saved.json()['revision'],1)
            self.assertEqual(self.client.post('/settings',json=body).status_code,409)
            cfg=s.models_config();self.assertEqual(cfg['model_configs'][0]['api_key'],'never-export')
            self.assertEqual(cfg['model_configs'][0]['provider_profile'],'deepseek')
            self.assertEqual(cfg['model_configs'][0]['system_prompt'],'new prompt')
            self.assertNotIn(b'new prompt',(s.ROOT/'models.enc').read_bytes())
            self.assertEqual(self.client.post('/settings',json={**body,'revision':1,'preferences':{**body['preferences'],'weather_location_mode':'device'}}).status_code,422)

    def test_weather_uses_request_client_not_server(self):
        from unittest.mock import AsyncMock
        with patch.object(s,'current_weather',new_callable=AsyncMock,return_value={'ok':False}) as weather:
            self.client.get('/weather')
            self.assertEqual(weather.call_args.args[1],'testclient')

    def test_pair_is_one_use_and_revoke(self):
        code='ABCDEFGH2345'
        (s.ROOT/'pairing.json').write_text(json.dumps({'hash':hashlib.sha256(code.encode()).hexdigest(),'expires':time.time()+60}))
        response=self.client.post('/pair',json={'code':code})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.post('/pair',json={'code':code}).status_code,403)
        self.client.headers['Authorization']='Bearer '+response.json()['token']
        self.assertEqual(self.client.delete('/device').status_code,200)
        self.assertEqual(self.client.get('/models').status_code,401)

    def test_revision_and_readonly(self):
        c=self.client.post('/conversations',json={'model':'test'}).json()
        response=self.client.patch('/conversations/'+c['id'],json={'title':'renamed','revision':0})
        self.assertEqual(response.status_code,409)
        with s.connect() as db:
            c['source']='desktop';s.save_conv(db,c,1)
        response=self.client.post('/conversations/'+c['id']+'/send',json={'model':'test','text':'hi','request_id':'x'*16,'revision':1})
        self.assertEqual(response.status_code,409)

    def test_send_retry_and_stream_persistence(self):
        gate=threading.Event()
        class Fake:
            def __init__(self,cfg):pass
            def stream_round(self,messages,**kw):
                kw['on_text']('hello');gate.wait(2)
                return ModelRoundResult(assistant_message={'role':'assistant','content':'hello'},usage=NormalizedUsage())
        c=self.client.post('/conversations',json={'model':'test'}).json()
        body={'model':'test','text':'hi','request_id':'x'*16,'revision':c['revision']}
        path='/conversations/'+c['id']+'/send'
        with patch.object(s,'RUNNER',Fake):
            r=self.client.post(path,json=body).json()
            self.assertEqual(self.client.post(path,json=body).json(),r)
            self.assertEqual(self.client.post(path,json={**body,'text':'changed'}).status_code,409)
            self.assertEqual(self.client.post(path,json={**body,'request_id':'y'*16}).status_code,409)
            gate.set()
            for _ in range(100):
                result=self.client.get('/runs/'+r['run_id']).json()
                if result['status']!='running':break
                time.sleep(.02)
            self.assertEqual(result['status'],'done',result)
            saved=self.client.get('/conversations/'+c['id']).json()
            self.assertEqual([m['content'] for m in saved['messages']],['hi','hello'])

if __name__=='__main__':unittest.main()
