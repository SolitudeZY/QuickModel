'use strict';
let voiceRecording=false;
window.mobileVoice=result=>{
 if(result.error){voiceRecording=false;$('voice-state').textContent=result.error;notice(result.error);}
 else {
  voiceRecording=result.status==='recording';
  const labels={recording:'录音中，最长 60 秒；再次点击结束',transcribing:'正在识别…',synthesizing:'正在合成语音…',playing:'正在朗读（最多前 600 字）',ready:'识别完成，可编辑文字',idle:'',permission:result.message};
  $('voice-state').textContent=labels[result.status]||'';
  if(result.text){$('draft').value=state.attachments.length?($('draft').value+'\n'+result.text).trim():result.text;if($('voice-mode').checked&&!state.run&&!state.pending)send().catch(e=>notice(e.message));}
 }
 $('voice-record').textContent=voiceRecording?'结束录音':'语音';
 $('voice-record').disabled=['transcribing','synthesizing'].includes(result.status);
 $('voice-cancel').hidden=!['recording','transcribing','synthesizing','playing'].includes(result.status);
};
$('voice-record').onclick=()=>{
 if(state.run||state.pending||state.conv?.source==='desktop'){notice('请等待当前回复完成，或新建可编辑的对话');return;}
 api('/native/voice-'+(voiceRecording?'stop':'start'),'POST').catch(e=>notice(e.message));
};
$('voice-cancel').onclick=()=>api('/native/voice-cancel','POST').catch(e=>notice(e.message));
window.qmSpeakReply=text=>{if($('voice-mode').checked&&text)api('/native/voice-speak','POST',{text:text.slice(0,600)}).catch(e=>notice(e.message));};
