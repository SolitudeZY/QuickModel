'use strict';
let serverSettings=null, weatherResult=null, weatherTimer=0, settingsDirty=false, modelDirty=false, editingModel='';
const numberFields=['font_size','weather_intensity','weather_mist','weather_refraction','weather_refresh_minutes','max_output_tokens'];
function prefsFromForm(){
 const p={...serverSettings.preferences};
 for(const key of Object.keys(p)){const el=$('pref-'+key);if(el)p[key]=el.type==='checkbox'?el.checked:numberFields.includes(key)?Number(el.value):el.value;}
 return p;
}
function applyAppearance(p){
 const period=resolveThemePeriod(p.theme_mode);document.documentElement.dataset.period=period;
 if(window.qmNativePeriod!==period){window.qmNativePeriod=period;api('/native/appearance','POST',{period}).catch(()=>{});}
 document.documentElement.style.setProperty('--chat-font-size',p.font_size+'px');
 applyStarfieldSettings(p);
 const codes={clear:0,cloudy:3,rain:63,snow:73,fog:45,thunder:95};
 if(p.weather_preview!=='auto')setStarfieldWeather({ok:true,weather_code:codes[p.weather_preview]??0,wind_speed:8});
 else setStarfieldWeather(p.weather_enabled?weatherResult:{ok:false});
}
function editModel(){
 if(modelDirty&&editingModel!==$('edit-model').value){$('edit-model').value=editingModel;notice('请先保存当前模型修改，或重新载入放弃修改');return;}
 const model=serverSettings?.models.find(m=>m.name===$('edit-model').value);if(!model)return;editingModel=model.name;
 $('edit-model-id').value=model.model;$('edit-prompt').value=model.system_prompt||'';
}
function fillPreferences(){
 const p=serverSettings.preferences;
 window.qmDefaultModel=serverSettings.active_model_config;
 for(const [key,value] of Object.entries(p)){const el=$('pref-'+key);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value;}}
 for(const id of ['pref-active_model','edit-model']){$(id).replaceChildren();for(const m of serverSettings.models){const o=document.createElement('option');o.value=m.name;o.textContent=m.name;$(id).append(o);}$(id).value=serverSettings.active_model_config;}
 modelDirty=false;editModel();$('settings-fields').disabled=false;settingsDirty=false;
 $('settings-state').textContent='服务器设置已载入';applyAppearance(p);
}
async function loadPreferences(){
 try{serverSettings=await api('/settings');fillPreferences();await refreshWeather();}
 catch(e){$('settings-state').textContent='设置载入失败：'+e.message;notice(e.message);}
}
async function refreshWeather(){
 clearTimeout(weatherTimer);if(!serverSettings)return;
 const p=serverSettings.preferences;
 if(!p.weather_enabled||!p.starfield_enabled){$('weather-status').textContent='自动天气已关闭';weatherResult=null;window.qmWeatherLabel='';applyAppearance(p);updateHeading();return;}
 $('weather-status').textContent='正在读取地区和天气…';
 try{
  weatherResult=await api('/weather');
  if(!weatherResult.ok){window.qmWeatherLabel='';$('weather-status').textContent=weatherResult.reason||'暂时无法读取天气';}
  else {
   const w=weatherResult;window.qmWeatherLabel=(w.location?.name||'当前地区')+' · '+(w.temperature??'—')+'°C';$('weather-status').textContent=window.qmWeatherLabel+(w.stale?' · 暂用缓存':'')+' · '+(w.location?.source==='ip'?'IP 近似定位':'手动地区');
  }
  applyAppearance(settingsDirty?prefsFromForm():p);updateHeading();
 }catch(e){$('weather-status').textContent=e.message;}
 weatherTimer=setTimeout(()=>{if(!document.hidden)refreshWeather();},p.weather_refresh_minutes*60000);
}
async function savePreferences(){
 if(!serverSettings)return;
 if(!Array.from($('settings-fields').querySelectorAll('input,textarea,select')).every(el=>el.reportValidity()))return;
 $('save-settings').disabled=true;
 const body={revision:serverSettings.revision,preferences:prefsFromForm(),active_model_config:$('pref-active_model').value,model_edit:{name:$('edit-model').value,model:$('edit-model-id').value,system_prompt:$('edit-prompt').value}};
 try{
  serverSettings=await api('/settings','POST',body);fillPreferences();
  if(!state.run&&!state.pending&&!state.conv)$('model').value=serverSettings.active_model_config;
  $('settings-state').textContent='已保存到服务器';notice('设置已保存');await refreshWeather();
 }catch(e){$('settings-state').textContent=e.message;notice(e.message);}
 finally{$('save-settings').disabled=false;}
}
$('save-settings').onclick=savePreferences;
$('reload-settings').onclick=loadPreferences;
$('weather-refresh').onclick=()=>{if(settingsDirty){notice('请先保存地区和天气设置');return;}refreshWeather();};
$('edit-model').onchange=editModel;
$('settings-fields').addEventListener('input',event=>{settingsDirty=true;if(['edit-model-id','edit-prompt'].includes(event.target.id))modelDirty=true;$('settings-state').textContent='有未保存的修改';applyAppearance(prefsFromForm());});
document.addEventListener('qm-ready',loadPreferences);
// Script loading is synchronous; also recover if a test/native bridge returned immediately.
if(window.qmReady)loadPreferences();
setInterval(()=>{if(serverSettings&&!document.hidden)applyAppearance(settingsDirty?prefsFromForm():serverSettings.preferences);},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&serverSettings&&!settingsDirty)refreshWeather();});
