import hashlib
import base64
import io
import copy
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
        self.mock_config = self.cfg.start()
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
            body['preferences']['max_output_tokens']=0
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
                assert kw['max_tokens'] is None
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

    def wait_run(self, rid):
        for _ in range(200):
            result = self.client.get('/runs/'+rid).json()
            if result['status'] != 'running':
                self.assertEqual(result['status'], 'done', result)
                return
            time.sleep(.01)
        self.fail('run did not finish')

    def test_health_context_is_opt_in_and_historical_snapshot_is_immutable(self):
        calls=[]
        class Fake:
            def __init__(self,cfg): pass
            def stream_round(self,messages,**kw):
                calls.append(copy.deepcopy(messages))
                return ModelRoundResult(assistant_message={'role':'assistant','content':'ok'},usage=NormalizedUsage())
        config=self.mock_config.return_value
        config['mobile_preferences']={'health_context_enabled':True}
        c=self.client.post('/conversations',json={'model':'test'}).json()
        with patch.object(s,'RUNNER',Fake), patch.object(s.health_context,'read_snapshot',side_effect=[{'steps':100}, {'steps':200}]) as reader:
            for i in range(2):
                r=self.client.post('/conversations/'+c['id']+'/send',json={'model':'test','text':'health','revision':c['revision'],'request_id':str(i)*16})
                self.wait_run(r.json()['run_id'])
                c=self.client.get('/conversations/'+c['id']).json()
            self.assertEqual(calls[0][1],calls[1][1])
            self.assertIn('100', calls[1][1]['content'])
            self.assertIn('200', calls[1][-1]['content'])
            config['mobile_preferences']['health_context_enabled']=False
            r=self.client.post('/conversations/'+c['id']+'/send',json={'model':'test','text':'plain','revision':c['revision'],'request_id':'z'*16})
            self.wait_run(r.json()['run_id'])
            self.assertEqual(reader.call_count,2)
            self.assertEqual(calls[-1][-1]['content'],'plain')

    def test_private_image_upload_validation_and_fallback(self):
        from PIL import Image
        out=io.BytesIO();Image.new('RGB',(32,24),'red').save(out,'PNG')
        upload={'data':base64.b64encode(out.getvalue()).decode()}
        image=self.client.post('/media/images',json=upload).json()
        self.assertNotIn('path', image)
        self.assertEqual(self.client.get('/media/images/'+image['id']).status_code,200)
        self.assertEqual(self.client.post('/media/images',json={'data':'not-an-image'}).status_code,400)
        self.client.headers.clear()
        self.assertEqual(self.client.get('/media/images/'+image['id']).status_code,401)
        self.client.headers['Authorization']='Bearer '+self.token
        c=self.client.post('/conversations',json={'model':'test'}).json()
        body={'model':'test','text':'describe','revision':c['revision'],'request_id':'v'*16,'attachments':[image['id']]}
        self.assertEqual(self.client.post('/conversations/'+c['id']+'/send',json=body).status_code,400)
        self.mock_config.return_value['vision']={'api_key':'secret'}
        calls=[]
        class Fake:
            def __init__(self,cfg): pass
            def stream_round(self,messages,**kw):
                calls.append(messages)
                return ModelRoundResult(assistant_message={'role':'assistant','content':'red'},usage=NormalizedUsage())
        with patch.object(s,'RUNNER',Fake),patch.object(s.media,'describe',return_value='red rectangle') as vision:
            r=self.client.post('/conversations/'+c['id']+'/send',json=body)
            self.wait_run(r.json()['run_id'])
            self.assertEqual(vision.call_count,1)
            self.assertNotIn('images',calls[0][-1])
            self.assertIn('red rectangle',calls[0][-1]['content'])
            saved=self.client.get('/conversations/'+c['id']).json()
            self.assertEqual(saved['messages'][0]['attachments'],[image['id']])
            self.assertNotIn('base64',json.dumps(saved))

    def test_health_missing_is_not_zero(self):
        result=s.health_context.summarize({'summary':[{'date':'2026-01-01','steps':50}], 'sleep':[], 'heart-rate':[]})
        self.assertIsNone(result['latest_heart_rate'])
        self.assertEqual(result['sleep'],[])
        self.assertIn('sleep',result['missing'])

    def test_voice_routes_require_config_and_limit_text(self):
        self.assertEqual(self.client.post('/voice/asr',json={'data':'abcd'}).status_code,503)
        self.assertEqual(self.client.post('/voice/tts',json={'text':'a'*601}).status_code,422)
        self.mock_config.return_value['speech']={'api_key':'never-export'}
        with patch.object(s.speech,'transcribe',return_value='test voice'):
            self.assertEqual(self.client.post('/voice/asr',json={'data':'abcd'}).json()['text'],'test voice')
        with patch.object(s.speech,'synthesize',side_effect=ValueError('secret-provider-response')):
            result=self.client.post('/voice/tts',json={'text':'hello'})
            self.assertEqual(result.status_code,502)
            self.assertNotIn('secret-provider-response',result.text)

    def test_tts_upgrades_provider_http_oss_to_https_without_credentials(self):
        from unittest.mock import MagicMock
        client=MagicMock()
        client.post.return_value.json.return_value={'output':{'audio':{'url':'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?signature=test'}}}
        stream=client.stream.return_value.__enter__.return_value
        stream.iter_bytes.return_value=[b'RIFFtestWAVE']
        with patch.object(s.speech.httpx,'Client') as factory:
            factory.return_value.__enter__.return_value=client
            result=s.speech.synthesize('test',{'api_key':'secret','tts_url':'https://example.test'})
            self.assertEqual(base64.b64decode(result),b'RIFFtestWAVE')
            self.assertEqual(client.stream.call_args.args[1],'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?signature=test')
            self.assertNotIn('headers',client.stream.call_args.kwargs)
            client.post.return_value.json.return_value={'output':{'audio':{'url':'http://127.0.0.1/private'}}}
            with self.assertRaises(ValueError):s.speech.synthesize('test',{'api_key':'secret','tts_url':'https://example.test'})

if __name__=='__main__':unittest.main()
