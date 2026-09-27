'use strict';
let voiceCallOpen=false, voiceRun='', spokenLength=0, speechBuffer='', spokenChars=0, manualVoice=false;
const callApi=(path,body={})=>api('/native/voice-'+path,'POST',body);
let speechCommands=Promise.resolve();
let callClosing=Promise.resolve();
function orderedSpeech(path,body){
 speechCommands=speechCommands.catch(()=>{}).then(()=>callApi(path,body));
 speechCommands.catch(e=>callState('error',e.message));
 return speechCommands;
}
window.qmVoiceActive=()=>voiceCallOpen;
function callState(status,message=''){
 if(!voiceCallOpen)return;
 const labels={permission:'等待麦克风授权',listening:'正在聆听',recording:'正在听你说',transcribing:'正在识别',thinking:'正在思考',synthesizing:'正在准备声音',speaking:'正在说话',error:'通话遇到问题',idle:'正在连接'};
 $('voice-call').dataset.state=status;
 $('call-status').textContent=labels[status]||'语音通话';
 $('call-hint').textContent=message||({listening:'直接说话即可，也可轻点下方按钮',recording:'说完稍停，我会自动接着聊',thinking:'正在准备回答',speaking:'你可以随时说话打断我',transcribing:'正在整理你说的话',synthesizing:'马上开始播放'}[status]||'');
 $('call-mic').classList.toggle('is-manual',manualVoice);
 $('call-mic').querySelector('span').textContent=manualVoice?'说完点这里':'立即说话';
}
function callLine(role,text){
 const item=document.createElement('p');item.className=role;item.textContent=text;
 $('call-lines').append(item);$('call-lines').scrollTop=$('call-lines').scrollHeight;
}
function callHistory(){
 $('call-lines').replaceChildren();
 for(const m of (state.conv?.messages||[]).filter(x=>['user','assistant'].includes(x.role)).slice(-12))
  callLine(m.role,m.content||'');
}
async function openVoiceCall(){
 if(state.run||state.pending||state.uploading){notice('请先完成当前回复或上传');return;}
 await callClosing;
 if(state.conv?.source==='desktop'){$('new').click();}
 $('draft').blur();voiceCallOpen=true;manualVoice=false;voiceRun='';
 $('voice-call').hidden=false;$('call-model').textContent=$('model').selectedOptions[0]?.textContent||'AI 助手';
 $('call-live').textContent='';callHistory();callState('idle');
 try{await callApi('call-start');}catch(e){callState('error',e.message);}
}
async function closeVoiceCall(){
 if(!voiceCallOpen)return;
 voiceCallOpen=false;manualVoice=false;voiceRun='';speechBuffer='';
 $('voice-call').hidden=true;
 if(state.run)api('/runs/'+state.run.id+'/stop','POST').catch(()=>{});
 callClosing=callApi('call-end').catch(()=>{});
 await callClosing;
 if(state.conv)state.conv=await api('/conversations/'+state.conv.id).catch(()=>state.conv);
 renderConversation(true);
}
$('voice-open').onclick=()=>openVoiceCall().catch(e=>notice(e.message));
$('call-end').onclick=()=>closeVoiceCall().catch(e=>notice(e.message));
$('call-image').onclick=()=>{if(!state.uploading)$('attach-image').click();};
$('call-screen').onclick=()=>{if(!state.uploading)$('capture-screen').click();};
$('call-mic').onclick=()=>{
 if(!voiceCallOpen)return;
 if(manualVoice){manualVoice=false;callApi('manual-stop').catch(e=>notice(e.message));}
 else{manualVoice=true;callApi('interrupt').catch(e=>notice(e.message));if(state.run)api('/runs/'+state.run.id+'/stop','POST').catch(()=>{});}
 callState(manualVoice?'recording':'listening');
};
const oldMobileBack=window.mobileBack;
window.mobileBack=()=>{if(voiceCallOpen)closeVoiceCall().catch(e=>notice(e.message));else oldMobileBack();};
const oldMobileImage=window.mobileImage;
window.mobileImage=result=>{
 oldMobileImage(result);
 if(voiceCallOpen&&!result.cancelled){
  callState('listening',result.error||'图片已加入下一轮对话，直接说出你的问题');
 }
};
window.mobileVoice=result=>{
 if(!voiceCallOpen)return;
 const status=result.status||'error';
 if(status==='interrupt'){
  voiceRun='';speechBuffer='';manualVoice=false;
  if(state.run)api('/runs/'+state.run.id+'/stop','POST').catch(()=>{});
  callState('recording');return;
 }
 if(status==='recording')manualVoice=false;
 if(status==='ready'&&result.text){
  manualVoice=false;callLine('user',result.text);
  $('call-live').textContent=result.text;
  queueRecognized(result.text).catch(e=>{callState('error',e.message);notice(e.message);});
  return;
 }
 callState(status,result.message||'');
};
async function queueRecognized(text){
 if(!voiceCallOpen||!text.trim())return;
 if(state.run){await api('/runs/'+state.run.id+'/stop','POST').catch(()=>{});
  for(let i=0;i<80&&state.run&&voiceCallOpen;i++)await new Promise(resolve=>setTimeout(resolve,100));}
 if(!voiceCallOpen)return;
 if(state.run||state.pending){callState('error','上一轮还未结束，请轻点麦克风重试');return;}
 $('draft').value=state.attachments.length?($('draft').value+'\n'+text).trim():text;
 callState('thinking');await send();
 if(!state.run)callState('error','消息未能发送，请查看聊天记录后重试');
}
window.qmVoiceRunStarted=id=>{
 if(!voiceCallOpen)return;
 voiceRun=id;spokenLength=0;speechBuffer='';spokenChars=0;
 orderedSpeech('turn',{id});
 callState('thinking');
};
function speechPlain(text){
 return text.replace(/```[\s\S]*?```/g,'代码片段略。').replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g,'链接。')
  .replace(/[`*_#>]/g,'').replace(/\s+/g,' ').trim();
}
function flushSpeech(done){
 if(!voiceRun)return;
 let next;
 while(speechBuffer.length&&spokenChars<2000){
  const clause=speechBuffer.search(/[。！？!?；;\n]/);
  if(clause>=11&&clause<120)next=clause+1;
  else if(speechBuffer.length>=100){const comma=speechBuffer.slice(32,90).search(/[，,]/);next=comma>=0?comma+33:90;}
  else if(done)next=speechBuffer.length;
  else break;
  const segment=speechPlain(speechBuffer.slice(0,next));speechBuffer=speechBuffer.slice(next);
  if(!segment)continue;
  const bounded=segment.slice(0,Math.min(2000-spokenChars,220));
  spokenChars+=bounded.length;
  orderedSpeech('say',{id:voiceRun,text:bounded});
 }
}
window.qmVoiceProgress=(text,done)=>{
 if(!voiceCallOpen||!voiceRun)return;
 if(text.length<spokenLength){spokenLength=0;speechBuffer='';}
 speechBuffer+=text.slice(spokenLength);spokenLength=text.length;
 $('call-live').textContent=speechPlain(text.slice(-180))||'正在思考…';
 flushSpeech(done);
};
window.qmVoiceRunDone=result=>{
 if(!voiceCallOpen||!voiceRun)return;
 if(result.text)callLine('assistant',result.text);
 const id=voiceRun;voiceRun='';speechBuffer='';
 orderedSpeech('turn-done',{id});
 if(result.error)callState('error',result.error);
};
window.qmVoiceResume=()=>{
 if(voiceCallOpen&&!document.hidden)callApi('call-start').catch(e=>callState('error',e.message));
};
document.addEventListener('visibilitychange',window.qmVoiceResume);
