'use strict';
const $ = id => document.getElementById(id);
const state = {conv:null, tab:'chat', list:[], pending:null, run:null, sending:false, polling:false, attachments:[], uploading:false,videoDescription:null};
const waiting = new Map();
const escapeHtml = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let noticeTimer;
function notice(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,6500);}
function updateHeading(){
  $('heading').textContent=state.tab==='chat'?(state.conv?.title||'QuickModel'):state.tab==='health'?'健康记录':'设置';
  $('subtitle').textContent=window.qmWeatherLabel||'你的私人 AI 空间';
}
if(window.QuickModelNative) QuickModelNative.onmessage = event => {
  const message=JSON.parse(event.data), item=waiting.get(message.id);if(!item)return;
  clearTimeout(item.timer);waiting.delete(message.id);
  if(!message.ok&&String(message.error).startsWith('401')){$('app').hidden=true;$('pair').hidden=false;}
  message.ok?item.resolve(message.data):item.reject(new Error(message.error));
};
async function api(path,method='GET',body={}){
  if(!window.QuickModelNative)throw new Error('请在 QuickModel 安卓应用中打开。');
  const id=crypto.randomUUID();
  const raw=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('连接超时，请重试。'));},65000);
    waiting.set(id,{resolve,reject,timer});QuickModelNative.postMessage(JSON.stringify({id,path,method,body}));
  });
  if(raw.offline){$('subtitle').textContent='离线缓存 · 数据可能不是最新';}
  return raw.payload!==undefined?JSON.parse(raw.payload):raw;
}
function safeMarkdown(text){
  try{return renderMarkdown(String(text));}catch(_){return '<pre>'+escapeHtml(text)+'</pre>';}
}
function bubble(m){
  const el=document.createElement('section');el.className='message '+m.role;
  if(m.role==='user')el.textContent=typeof m.content==='string'?m.content:JSON.stringify(m.content);
  else{
    if(m.reasoning_content){const d=document.createElement('details'),s=document.createElement('summary'),p=document.createElement('pre');s.textContent='思考过程';p.textContent=m.reasoning_content;d.append(s,p);el.append(d);}
    const body=document.createElement('div');body.innerHTML=safeMarkdown(m.content||'');el.append(body);
    el.querySelectorAll('pre code').forEach(code=>{try{hljs.highlightElement(code);}catch(_){}});
  }
  for(const id of m.attachments||[]){const img=document.createElement('img');img.className='attachment-preview';img.alt='图片附件';el.append(img);api('/media/images/'+id).then(r=>{img.src=r.preview;}).catch(()=>{img.alt='图片暂不可用';});}
  if(m.health_snapshot){const h=m.health_snapshot,d=document.createElement('details'),title=document.createElement('summary'),info=document.createElement('p');title.textContent='本次健康上下文';info.textContent=h.status==='unavailable'?'本次健康记录读取失败，模型已收到缺失提示。':'读取时间：'+localTime(h.retrieved_at)+'；步数最近日期：'+(h.daily?.at(-1)?.date||'无记录')+'；心率测量时间：'+(h.latest_heart_rate?.timestamp?localTime(h.latest_heart_rate.timestamp):'无记录')+'；睡眠：'+(h.sleep?.length?'有记录':'无记录')+'。均为云端同步记录，非实时测量。';d.append(title,info);el.append(d);}
  return el;
}
function renderConversation(forceScroll=false){
  const box=$('messages'), near=box.scrollHeight-box.scrollTop-box.clientHeight<100;
  box.replaceChildren();
  if(!state.conv||!state.conv.messages.length)box.innerHTML='<div class="welcome"><span class="emblem">Q</span><h1>今天，想聊些什么？</h1><p>想法、问题，或一个新的开始。</p></div>';
  for(const m of state.conv?.messages||[])if(['user','assistant'].includes(m.role))box.append(bubble(m));
  updateHeading();
  const readonly=state.conv?.source==='desktop';
  $('draft').disabled=readonly||!!state.pending||!!state.run;
  $('model').disabled=!!state.pending||!!state.run;
  $('send').disabled=readonly||state.sending||!!state.run||state.uploading;
  for(const id of ['attach-image','attach-video','capture-screen'])$(id).disabled=readonly||!!state.pending||!!state.run||state.uploading;
  $('send').textContent=state.pending?'重试发送':'发送';
  $('stop').hidden=!state.run;
  $('chat-note').textContent=readonly?'桌面历史 · 只读，请新建对话继续':'会话自动保存在你的服务器';
  if(forceScroll||near)box.scrollTop=box.scrollHeight;
}
async function refreshList(){state.list=await api('/conversations');renderList();}
function renderList(){
  const text=$('search').value.toLowerCase();$('conversations').replaceChildren();
  for(const c of state.list.filter(c=>(c.title||'').toLowerCase().includes(text))){
    const button=document.createElement('button');button.className='conv';
    button.innerHTML='<strong>'+escapeHtml(c.title||'未命名')+'</strong><small>'+escapeHtml((c.updated_at||'').slice(0,10))+' · '+(c.source==='desktop'?'桌面历史':'手机会话')+(c.archived_at?' · 已归档':'')+'</small>';
    button.onclick=()=>openConversation(c.id).catch(e=>notice(e.message));$('conversations').append(button);
  }
  if(!$('conversations').children.length)$('conversations').textContent='还没有对话';
}
async function openConversation(id){
  if(state.pending||state.run||state.uploading){notice('请先等待当前回复完成，或停止生成。');return;}
  state.conv=await api('/conversations/'+id);if(state.conv.model_config)$('model').value=state.conv.model_config;
  $('drawer').close();tab('chat');renderConversation(true);
}
async function persistPending(){await api('/native/pending','POST',{value:JSON.stringify({pending:state.pending,run:state.run})});}
async function send(){
  if(state.sending||state.run)return;
  const text=$('draft').value.trim()||(state.attachments.length?'请分析这些图片。':'');if(state.uploading||(!state.pending&&!text))return;
  state.sending=true;$('send').disabled=true;
  try{
    if(!state.conv)state.conv=await api('/conversations','POST',{model:$('model').value});
    if(!state.pending){state.pending={cid:state.conv.id,body:{request_id:crypto.randomUUID(),text,model:$('model').value,revision:state.conv.revision,attachments:state.attachments.map(x=>x.id)}};await persistPending();}
    const r=await api('/conversations/'+state.pending.cid+'/send','POST',state.pending.body);
    state.run={id:r.run_id,cid:state.pending.cid};state.pending=null;await persistPending();$('draft').value='';state.attachments=[];state.videoDescription=null;renderAttachments();
    state.conv=await api('/conversations/'+state.run.cid);renderConversation(true);poll();
  }catch(e){notice(e.message);if(e.message.startsWith('409')||e.message.startsWith('413')||e.message.startsWith('400')){state.pending=null;await persistPending();if(state.conv)state.conv=await api('/conversations/'+state.conv.id);}}
  finally{state.sending=false;renderConversation();}
}
async function poll(){
  if(state.polling||!state.run)return;state.polling=true;
  try{
    const r=await api('/runs/'+state.run.id);
    if(r.status!=='running'){
      const cid=state.run.cid;state.run=null;await persistPending();state.conv=await api('/conversations/'+cid);renderConversation();await refreshList();
      if(r.error)notice(r.error);else if(r.status==='stopped')notice('已停止生成');else if(window.qmSpeakReply)window.qmSpeakReply(state.conv.messages.at(-1)?.content||'');
    }else{
      const box=$('messages'),near=box.scrollHeight-box.scrollTop-box.clientHeight<100;
      let el=$('stream');const replacement=bubble({role:'assistant',content:r.text||'正在思考…',reasoning_content:r.reasoning});replacement.id='stream';
      if(el)el.replaceWith(replacement);else box.append(replacement);
      if(near)box.scrollTop=box.scrollHeight;
    }
  }catch(e){notice(e.message+' 回复仍保留在服务器，将自动重连。');}
  finally{state.polling=false;if(state.run)setTimeout(poll,1500);}
}
function tab(name){state.tab=name;for(const n of ['chat','health','settings'])$(n).hidden=n!==name;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===name));updateHeading();if(name==='health')loadHealth().catch(e=>notice(e.message));}
function metric(title,value,unit,caption=''){return '<article><h3>'+escapeHtml(title)+'</h3><div class="metric">'+escapeHtml(value)+'<span class="unit">'+escapeHtml(unit)+'</span></div><small>'+escapeHtml(caption)+'</small></article>';}
function localTime(t){const d=new Date(t);return isNaN(d)?String(t):d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});}
async function loadHealth(){
  $('health-content').setAttribute('aria-busy','true');
  try{
    const [d,h,s]=await Promise.all([api('/health/summary'),api('/health/heart-rate'),api('/health/sleep')]);
    if([d,h,s].some(x=>!Array.isArray(x.data)))throw new Error('健康记录暂不可用，请检查账号连接。');
    const daily=[...d.data].sort((a,b)=>a.date.localeCompare(b.date)),heart=[...h.data].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),sleep=[...s.data].sort((a,b)=>b.end_at.localeCompare(a.end_at));
    const latest=daily.at(-1),hr=heart.at(-1),night=sleep[0];let html=metric('最近记录的步数',latest?.steps??'—','步',latest?.date||'暂无记录');
    if(daily.length){const max=Math.max(1,...daily.map(x=>x.steps||0));html+='<article><h3>步数趋势</h3><div class="bars">'+daily.map(x=>'<div class="barcol"><span>'+Number(x.steps||0)+'</span><div class="bar" style="height:'+Math.round((x.steps||0)/max*95)+'px"></div><small>'+escapeHtml(x.date.slice(5))+'</small></div>').join('')+'</div></article>';}
    html+=metric('最近一次心率',hr?.bpm??'—','次/分',hr?localTime(hr.timestamp)+' · 历史测量，非实时':'暂无记录');
    if(heart.length){const values=heart.map(x=>x.bpm).filter(x=>Number.isFinite(x)&&x>0);if(values.length)html+='<article><h3>近 7 天心率记录</h3><p>'+Math.min(...values)+'–'+Math.max(...values)+' 次/分</p><small>共 '+values.length+' 次测量；范围包含运动等不同状态，不作为静息心率判断。</small></article>';}
    html+=metric('最近记录的睡眠',night?Math.floor(night.time_asleep_minutes/60)+' 小时 '+night.time_asleep_minutes%60:'—',night?'分钟':'',night?localTime(night.start_at)+' → '+localTime(night.end_at):'暂无记录，可在小米运动健康开启采集');
    html+='<article><h3>近期睡眠</h3>'+(sleep.length?sleep.map(x=>'<div class="healthrow"><span>'+escapeHtml(localTime(x.end_at))+'</span><strong>'+Math.floor(x.time_asleep_minutes/60)+'时'+x.time_asleep_minutes%60+'分</strong></div>').join(''):'<p>暂无记录</p>')+'</article>';
    $('health-content').innerHTML=html;
  }finally{$('health-content').removeAttribute('aria-busy');}
}
async function syncHealth(){
  $('sync').disabled=true;
  try{const result=await api('/health/sync','POST');if(!result.sync_id)throw new Error(result.message||'同步未启动');
    $('sync-note').textContent='正在从小米云端同步…';
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,2000));const p=await api('/health-sync/'+result.sync_id);
      if(['ok','completed','success','done','partial'].includes(p.status)){$('sync-note').textContent=(p.status==='partial'?'部分记录同步成功，请稍后重试':'同步完成')+' · '+new Date().toLocaleTimeString();await loadHealth();return;}
      if(['failed','error','cancelled'].includes(p.status))throw new Error('同步失败，请在电脑检查小米账号连接。');
    }$('sync-note').textContent='同步仍在服务器继续，稍后重新进入健康页面查看。';
  }catch(e){$('sync-note').textContent=e.message;}finally{$('sync').disabled=false;}
}
async function start(){
  const status=await api('/native/status');$('pair').hidden=status.paired;$('app').hidden=!status.paired;if(!status.paired)return;
  const models=await api('/models');$('model').replaceChildren();for(const m of models.models){const o=document.createElement('option');o.value=m.name;o.textContent=m.name;$('model').append(o);}$('model').value=models.active||models.models[0]?.name;
  await refreshList();const saved=await api('/native/pending');try{const p=JSON.parse(saved.value||'{}');state.pending=p.pending;state.run=p.run;}catch(_){}
  if(state.run||state.pending){state.conv=await api('/conversations/'+(state.run||state.pending).cid);if(state.pending)$('draft').value=state.pending.body.text;renderConversation(true);if(state.run)poll();}
  window.qmReady=true;document.dispatchEvent(new Event('qm-ready'));
}
$('connect').onclick=async()=>{$('connect').disabled=true;try{await api('/pair','POST',{code:$('code').value,name:'小米 14'});$('code').value='';await start();}catch(e){notice(e.message);}finally{$('connect').disabled=false;}};
$('send').onclick=()=>send().catch(e=>notice(e.message));
$('stop').onclick=()=>api('/runs/'+state.run.id+'/stop','POST').catch(e=>notice(e.message));
$('new').onclick=()=>{if(state.run||state.pending||state.uploading){notice('请先完成或停止当前回复。');return;}state.conv=null;state.attachments=[];state.videoDescription=null;renderAttachments();$('draft').value='';if(window.qmDefaultModel)$('model').value=window.qmDefaultModel;tab('chat');renderConversation(true);};
$('history').onclick=()=>{$('drawer').showModal();refreshList().catch(e=>notice(e.message));};$('close-history').onclick=()=>$('drawer').close();$('search').oninput=renderList;
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('sync').onclick=syncHealth;
$('logout').onclick=async()=>{try{if(state.run){notice('请先停止生成');return;}await api('/device','DELETE');state.conv=null;state.pending=null;state.run=null;await start();}catch(e){notice(e.message);}};
window.mobileBack=()=>{if($('drawer').open)$('drawer').close();else if(state.tab!=='chat')tab('chat');};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.run)poll();});
start().catch(e=>notice(e.message));

// The native parent owns system/IME insets. visualViewport also covers older WebViews.
let viewportFrame=0, viewportWidth=0, viewportMax=0;
function fitViewport(){
 cancelAnimationFrame(viewportFrame);viewportFrame=requestAnimationFrame(()=>{
  const height=Math.min(innerHeight,window.visualViewport?.height||innerHeight);
  if(Math.abs(innerWidth-viewportWidth)>80){viewportMax=height;viewportWidth=innerWidth;}
  viewportMax=Math.max(viewportMax,height);
  const editing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
  document.documentElement.classList.toggle('keyboard-open',editing&&viewportMax-height>100);
  document.documentElement.style.setProperty('--app-height',height+'px');
  if(document.activeElement===$('draft'))$('messages').scrollTop=$('messages').scrollHeight;
 });
}
window.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('resize',fitViewport);
document.addEventListener('focusin',fitViewport);document.addEventListener('focusout',fitViewport);fitViewport();

function renderAttachments(){
 $('attachments').replaceChildren();
 for(const attachment of state.attachments){const button=document.createElement('button');button.className='attachment-chip';button.title='移除图片';const img=document.createElement('img');img.src=attachment.preview;img.alt='待发送图片';button.append(img,document.createTextNode(' ×'));button.onclick=()=>{if(state.pending)return;if(state.videoDescription){$('draft').value=$('draft').value.replace(state.videoDescription,'').trim();state.videoDescription=null;state.attachments=[];}else state.attachments=state.attachments.filter(x=>x!==attachment);renderAttachments();};$('attachments').append(button);}
}
window.mobileImage=result=>{
 state.uploading=false;
 if(result.error)notice(result.error);
 else if(result.images){state.videoDescription=result.description;state.attachments=result.images;renderAttachments();$('draft').value=($('draft').value+'\n'+result.description).trim();notice('视频已抽帧，可添加问题后发送');}
 else if(!result.cancelled&&result.id&&!state.attachments.some(x=>x.id===result.id)){state.attachments.push(result);renderAttachments();}
 renderConversation();
};
$('attach-image').onclick=async()=>{
 if(state.attachments.length>=4){notice('每次最多附加 4 张图片');return;}
 state.uploading=true;renderConversation();
 try{await api('/native/pick-image','POST');}catch(e){state.uploading=false;renderConversation();notice(e.message);}
};

$('attach-video').onclick=async()=>{
 if(state.attachments.length){notice('请先发送或移除现有图片，再选择视频');return;}
 state.uploading=true;renderConversation();notice('选择 60 秒以内的视频，抽帧和音轨转写可能需要约一分钟');
 try{await api('/native/pick-video','POST');}catch(e){state.uploading=false;renderConversation();notice(e.message);}
};
$('capture-screen').onclick=async()=>{
 if(state.attachments.length>=4){notice('请先发送或移除已有图片');return;}
 notice('授权后应用会最小化，5 秒后截取一次。切到目标画面，等待后返回这里预览。');
 state.uploading=true;renderConversation();
 try{await api('/native/capture-screen','POST');}catch(e){state.uploading=false;renderConversation();notice(e.message);}
};
