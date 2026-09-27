const {chromium}=require(process.env.QM_PLAYWRIGHT||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../mobile_web');
(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){res.writeHead(404).end();return;}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(p));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  let paired=false,pending='{}',conv={id:'conv_mobile_test',title:'新对话',revision:1,messages:[],source:'mobile'},polls=0;
  let settings={revision:0,active_model_config:'测试模型',models:[{name:'测试模型',model:'model-test',system_prompt:'test'}],preferences:{theme_mode:'night',font_size:15,starfield_enabled:true,starfield_mode:'weather',background_quality:'eco',weather_enabled:true,weather_location_mode:'ip',weather_city:'',weather_preview:'auto',weather_intensity:70,weather_mist:32,weather_refraction:65,weather_refresh_minutes:30,max_output_tokens:4096,thinking:'off',health_context_enabled:false}};
  window.QuickModelNative={postMessage(text){const r=JSON.parse(text);let data;
   if(r.path==='/native/status')data={paired};
   else if(r.path==='/native/pending'){if(r.method==='POST')pending=r.body.value;data={value:pending};}
   else if(r.path==='/pair'){paired=true;data={paired:true};}
   else if(r.path==='/models')data={models:[{name:'测试模型'}],active:'测试模型'};
   else if(r.path==='/settings'){if(r.method==='POST'){settings={...settings,...r.body,revision:settings.revision+1};settings.models[0]={...settings.models[0],...r.body.model_edit};}data=settings;}
   else if(r.path.startsWith('/media/images/'))data={id:r.path.split('/').at(-1),preview:'data:image/png;base64,iVBORw0KGgo='};
   else if(r.path==='/weather')data={ok:true,weather_code:3,temperature:22,location:{name:'测试城市',source:'ip'}};
   else if(r.path==='/conversations')data=r.method==='POST'?conv:[conv];
   else if(r.path.endsWith('/send')){window.lastSend=r.body;polls=0;conv.messages.push({role:'user',content:r.body.text,attachments:r.body.attachments||[]});conv.revision++;data={run_id:'abcd'};}
   else if(r.path.startsWith('/conversations/'))data=conv;
   else if(r.path.startsWith('/runs/')){polls++;data={status:polls>1?'done':'running',text:'你好，**测试成功**。',reasoning:''};if(polls===2){conv.messages.push({role:'assistant',content:data.text});conv.revision++;}}
   else if(r.path==='/health/summary')data={data:[{date:'2026-09-26',steps:5200}]};
   else if(r.path==='/health/heart-rate')data={data:[{timestamp:'2026-09-26T12:00:00+08:00',bpm:72}]};
   else if(r.path==='/health/sleep')data={data:[]};
   else if(r.path==='/health/sync')data={status:'accepted',sync_id:'abcd'};
   else if(r.path==='/health-sync/abcd')data={status:'ok',records_added:0};
   else data={};
   const result=r.path.startsWith('/native/')||r.path==='/pair'?data:{payload:JSON.stringify(data),offline:false};
   setTimeout(()=>this.onmessage({data:JSON.stringify({id:r.id,ok:true,data:result})}),5);
  }};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#pair').waitFor({state:'visible'});await page.fill('#code','TEST-PAIR-CODE');await page.click('#connect');await page.locator('#app').waitFor({state:'visible'});
 await page.fill('#draft','测试消息');await page.click('#send');await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length&&document.querySelector('#stop').hidden);
 assert.equal(await page.locator('.message.user').count(),1);assert.match(await page.locator('.message.assistant').innerText(),/测试成功/);
 const render=await page.evaluate(()=>{const x=document.createElement('div');x.innerHTML=safeMarkdown('<img src=x onerror="window.pwned=1"><svg onload="window.pwned=1"></svg>[bad](javascript:alert(1))\n\n$E=mc^2$\n\n```js\nconst x = 1;\n```');document.body.append(x);return {danger:x.querySelectorAll('img,svg[onload],[onerror],a[href^="javascript:"]').length,math:x.querySelectorAll('.katex').length,code:x.querySelector('pre code')?.textContent};});
 assert.equal(render.danger,0);assert.equal(render.math,1);assert.match(render.code,/const x/);assert.equal(await page.evaluate(()=>window.pwned),undefined);
 await page.waitForTimeout(1800);
 const sceneBefore=await page.locator('#background-base-a').evaluate(c=>({width:c.width,height:c.height,pixels:c.toDataURL()}));
 await page.focus('#draft');await page.setViewportSize({width:393,height:460});await page.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
 await page.waitForTimeout(400);assert.deepEqual(await page.locator('#background-base-a').evaluate(c=>({width:c.width,height:c.height,pixels:c.toDataURL()})),sceneBefore,'keyboard must preserve scene');
 const composer=await page.locator('#composer').boundingBox();assert(composer.y+composer.height<=461,'composer stays above keyboard');assert.equal(await page.locator('nav').isVisible(),false);
 await page.locator('#draft').evaluate(el=>el.blur());await page.setViewportSize({width:393,height:852});await page.waitForFunction(()=>!document.documentElement.classList.contains('keyboard-open'));
 await page.click('[data-tab=settings]');await page.waitForFunction(()=>!document.querySelector('#settings-fields').disabled);await page.selectOption('#pref-theme_mode','dusk');await page.fill('#pref-font_size','18');await page.fill('#edit-prompt','updated prompt');await page.fill('#pref-max_output_tokens','0');await page.click('#save-settings');await page.waitForFunction(()=>document.querySelector('#settings-state').textContent==='已保存到服务器');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.period),'dusk');await page.click('#reload-settings');await page.waitForFunction(()=>document.querySelector('#settings-state').textContent==='服务器设置已载入');assert.equal(await page.inputValue('#edit-prompt'),'updated prompt');assert.equal(await page.inputValue('#pref-max_output_tokens'),'0');
 await page.selectOption('#pref-theme_mode','night');await page.click('#save-settings');await page.waitForFunction(()=>document.querySelector('#settings-state').textContent==='已保存到服务器');
 await page.click('[data-tab=chat]');await page.waitForFunction(()=>document.querySelector('#background-scene').classList.contains('is-active'));
 if(process.env.QM_QA_SCREENSHOT_DIR){fs.mkdirSync(process.env.QM_QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QM_QA_SCREENSHOT_DIR,'mobile-chat-020.png')});}
 await page.click('#history');await page.evaluate(()=>{const list=document.querySelector('#conversations');for(let i=0;i<80;i++){const el=document.createElement('button');el.className='conv';el.textContent='历史 '+i;list.append(el);}list.scrollTop=list.scrollHeight;});assert(await page.locator('#close-history').isVisible());const close=await page.locator('#close-history').boundingBox();assert(close.y>=0&&close.y+close.height<852);await page.click('#close-history');assert.equal(await page.locator('#drawer').isVisible(),false);
 await page.click('[data-tab=health]');await page.waitForFunction(()=>document.querySelector('#health-content').textContent.includes('5200'));assert.match(await page.locator('#health-content').innerText(),/暂无记录/);
 await page.click('#sync');await page.waitForFunction(()=>document.querySelector('#sync-note').textContent.startsWith('同步完成'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(process.env.QM_QA_SCREENSHOT_DIR){fs.mkdirSync(process.env.QM_QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QM_QA_SCREENSHOT_DIR,'mobile-health.png')});}
 await page.click('[data-tab=chat]');
 await page.evaluate(()=>window.mobileImage({id:'a'.repeat(64),preview:'data:image/png;base64,iVBORw0KGgo='}));
 assert.equal(await page.locator('.attachment-chip').count(),1);
 await page.fill('#draft','inspect image');await page.click('#send');await page.waitForFunction(()=>document.querySelector('#stop').hidden);
 assert.deepEqual(await page.evaluate(()=>window.lastSend.attachments),['a'.repeat(64)]);
 await page.waitForFunction(()=>document.querySelectorAll('.attachment-preview').length===1);
 await page.evaluate(()=>window.mobileVoice({status:'recording'}));assert.equal(await page.locator('#voice-record').innerText(),'结束录音');
 await page.evaluate(()=>window.mobileVoice({status:'ready',text:'synthetic recognized speech'}));assert.equal(await page.inputValue('#draft'),'synthetic recognized speech');
 await page.evaluate(()=>window.mobileImage({images:[{id:'b'.repeat(64),preview:'data:image/png;base64,iVBORw0KGgo='}],description:'video frame at 0.0 seconds'}));
 assert.match(await page.inputValue('#draft'),/0.0 seconds/);
 await page.evaluate(()=>window.mobileVoice({status:'ready',text:'what happened'}));assert.match(await page.inputValue('#draft'),/0.0 seconds/);
 assert.deepEqual(errors,[]);console.log('PASS pairing, chat, health, Markdown/math, XSS, keyboard viewport, preferences save/reload, desktop background');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
