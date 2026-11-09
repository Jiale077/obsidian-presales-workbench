const run=require('./task-run.js');
function el(parent,tag,text='',cls=''){return parent.createEl(tag,{text:String(text),cls});}
function inline(parent,text,app){
  const regex=/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g;let from=0,match;
  while((match=regex.exec(text))){parent.appendChild(document.createTextNode(text.slice(from,match.index)));if(match[2])el(parent,'strong',match[2]);else if(match[3])el(parent,'code',match[3]);else{const label=match[4]||match[7]||match[6],target=(match[5]||match[6]).replace(/^<|>$/g,'');const a=el(parent,'a',label);a.href='#';a.onclick=e=>{e.preventDefault();if(/^https?:\/\//i.test(target))require('electron').shell.openExternal(target);else{const base=app.vault.adapter.getBasePath();let local=target.startsWith(base+'/')?target.slice(base.length+1):target;const f=app.vault.getAbstractFileByPath(local)||app.metadataCache.getFirstLinkpathDest(local,'');if(f){parent.closest('dialog')?.dispatchEvent(new Event('cancel',{cancelable:true}));app.workspace.getLeaf('tab').openFile(f);}else new Notice('可从右侧文件列表打开本次产出。');}};}from=regex.lastIndex;}
  parent.appendChild(document.createTextNode(text.slice(from)));
}
function markdown(parent,text,app){let code=null;for(const line of String(text||'').split('\n')){if(/^```/.test(line)){if(code)code=null;else code=el(el(parent,'pre'),'code');continue;}if(code){code.textContent+=line+'\n';continue;}if(!line.trim())continue;const heading=/^(#{1,5})\s+(.+)/.exec(line);const bullet=/^\s*[-*]\s+(.+)/.exec(line);const node=el(parent,heading?'h'+Math.min(heading[1].length+1,5):'p','',bullet?'pwr-bullet':'');inline(node,heading?heading[2]:bullet?'• '+bullet[1]:line,app);}}
async function openWork(app,folder,{autostart=false}={}){
  run.context(app,folder);
  const previous=document.querySelector('dialog.pwb-run');if(previous){if(previous.dataset.folder===folder){previous.focus();return previous;}previous.dispatchEvent(new Event('cancel',{cancelable:true}));}
  const dialog=document.createElement('dialog');dialog.className='pwb-dialog pwb-run';dialog.dataset.folder=folder;dialog.setAttribute('aria-label','任务执行');document.body.appendChild(dialog);
  let state=run.getState(app,folder),timer=null,closed=false,busy=false,lastContent='',lastRequests='',lastFiles='',lastHistory='';
  const header=el(dialog,'header','','pwr-header');const heading=el(header,'div');el(heading,'h2',folder.split('/').at(-1));el(heading,'p','依据已核对的说明执行，产出保存在本任务文件夹。','pwi-muted');const actions=el(header,'div','','pwr-top-actions');
  const status=el(dialog,'div','','pwr-status');status.setAttribute('aria-live','polite');
  const layout=el(dialog,'div','','pwr-layout');const main=el(layout,'main');const questions=el(main,'div','','pwr-questions');const progress=el(main,'section','','pwr-progress');
  const aside=el(layout,'aside','','pwr-aside');el(aside,'h3','本轮文件');const files=el(aside,'div');el(aside,'h3','执行记录');const histories=el(aside,'div');
  const footer=el(dialog,'footer','','pwr-footer');const label=el(footer,'label');el(label,'span','本次补充 / 继续修改');const input=el(label,'textarea');input.rows=3;input.placeholder='可留空直接开始；之后在这里补充修改要求，继续同一会话。';input.setAttribute('aria-label','本次补充或继续修改要求');
  const controls=el(footer,'div','','pwr-controls');const helper=el(controls,'span','','pwi-muted');const buttons=el(controls,'div','','pwr-buttons');const error=el(dialog,'div','','pwi-error');error.setAttribute('role','alert');
  function button(parent,text,fn,cls=''){const b=el(parent,'button',text,cls);b.type='button';b.onclick=async()=>{if(busy)return;b.disabled=true;error.textContent='';try{await fn();}catch(e){error.textContent=e.message||String(e);console.error('[任务执行]',e);}finally{b.disabled=false;}};return b;}
  function close(){closed=true;clearInterval(timer);dialog.close();dialog.remove();}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  button(actions,'打开说明',async()=>{close();await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(folder+'/说明.md'));},'pwi-text');button(actions,'显示文件夹',()=>require('electron').shell.showItemInFolder(require('path').join(app.vault.adapter.getBasePath(),folder,'说明.md')),'pwi-text');button(actions,'关闭',close,'pwi-text');
  async function start(){
    const text=input.value.trim();if(state.status==='completed'&&!text){error.textContent='写一句这次需要怎样修改，就能继续当前会话。';input.focus();return;}
    busy=true;try{state=await run.start(app,folder,text||(['failed','interrupted'].includes(state.status)?'请读取最新说明和本任务已有产出，继续上次未完成的工作，避免重复已完成部分。':''));input.value='';refresh(true);}finally{busy=false;}
  }
  const send=button(buttons,'开始工作',start,'pwi-primary');const stop=button(buttons,'停止本轮',()=>{run.stop(app,folder);helper.textContent='正在请求停止，已生成的文件会保留。';},'pwi-secondary');
  function fileLink(parent,file){const row=el(parent,'div','','pwr-file');const a=el(row,'a',file.name||file.path);a.href='#';a.onclick=async e=>{e.preventDefault();const f=app.vault.getAbstractFileByPath(file.path);if(!f){new Notice('文件暂未同步到目录视图，请稍后重试。');return;}close();const preview=require('./office-preview.js');if(preview.canPreview(app,f))await preview.open(app,f);else if(['docx','doc','pptx','ppt','xlsx','xls'].includes(f.extension))await require('electron').shell.openPath(require('path').join(app.vault.adapter.getBasePath(),f.path));else await app.workspace.getLeaf('tab').openFile(f);};if(file.size!==undefined)el(row,'small',Math.max(1,Math.round(file.size/1024))+' KB','pwi-muted');}
  function renderRequests(){
    questions.empty();for(const request of state.pending||[]){const p=request.params,box=el(questions,'section','','pwr-question');
      if(request.method==='item/tool/requestUserInput'){
        el(box,'h3','需要你补充的信息');const fields={};let secret=false;
        for(const q of p.questions||[]){el(box,'p',q.question);if(q.isSecret){secret=true;el(box,'p','这项输入涉及敏感凭证，请到 Codex 或对应服务完成。','pwi-muted');continue;}const field=el(box,'textarea');field.rows=2;field.setAttribute('aria-label',q.question);fields[q.id]=field;if(q.options?.length){const options=el(box,'div','','pwr-options');for(const option of q.options){const b=button(options,option.label,()=>{field.value=option.label;},'pwi-secondary');b.title=option.description||'';}}}
        if(!secret)button(box,'发送答复并继续',()=>{const answers={};for(const [id,field]of Object.entries(fields)){if(!field.value.trim())throw new Error('请补充答复后再继续。');answers[id]={answers:[field.value.trim()]};}run.respond(app,folder,request.id,{answers},'用户已答复工作问题');helper.textContent='答复已发送，等待继续执行。';},'pwi-primary');
      }else if(request.method==='mcpServer/elicitation/request'){
        el(box,'h3',p.serverName?'工具需要补充信息：'+p.serverName:'工具需要补充信息');el(box,'p',p.message||'请查看工具的请求。');
        const fields={};if(p.url){const url=el(box,'a','打开工具授权页面');url.href=p.url;url.onclick=e=>{e.preventDefault();if(/^https?:\/\//i.test(p.url))require('electron').shell.openExternal(p.url);};}
        const properties=p.requestedSchema?.properties||{};let supported=true;for(const [key,schema]of Object.entries(properties)){const label=el(box,'label','','pwi-field');el(label,'span',schema.title||schema.description||key);if(schema.type==='object'||schema.type==='array'||schema.format==='password'||/password|secret|token|密码|密钥/i.test(key)){supported=false;el(label,'p','这项复杂工具输入需在 Codex 中处理。');continue;}const field=el(label,schema.enum?'select':'input');if(schema.enum)for(const value of schema.enum)field.createEl('option',{value:String(value),text:String(value)});else field.type=schema.type==='boolean'?'checkbox':schema.type==='number'?'number':'text';fields[key]={field,schema};}
        if(supported)button(box,'提交并继续',()=>{const content={};for(const [key,{field,schema}]of Object.entries(fields)){content[key]=schema.type==='boolean'?field.checked:schema.type==='number'?Number(field.value):field.value;if(p.requestedSchema?.required?.includes(key)&&!String(content[key]).trim())throw new Error('请填写工具所需的信息。');}run.respond(app,folder,request.id,{action:'accept',content:p.mode==='url'?null:content},'用户已提交工具所需信息');},'pwi-primary');button(box,'暂不提供',()=>run.respond(app,folder,request.id,{action:'decline',content:null},'用户暂不提供工具所需信息'),'pwi-secondary');
      }else{
        el(box,'h3','工具请求操作确认');el(box,'p',p.reason||'执行任务需要以下操作，请核对后选择。');if(p.command)el(box,'pre',p.command);if(p.cwd)el(box,'p','位置：'+p.cwd,'pwi-muted');
        if(p.permissions){const entries=p.permissions.fileSystem?.entries||p.permissions.file_system?.entries||[];for(const entry of entries)el(box,'p',entry.access+'：'+(entry.path?.path||entry.path?.pattern||entry.path?.value||''),'pwi-muted');if(p.permissions.network?.enabled)el(box,'p','本轮需要连接网络。','pwi-muted');}
        const allow=request.method==='item/permissions/requestApproval'?{permissions:p.permissions,scope:'turn'}:{decision:'accept'};const decline=request.method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:{decision:'decline'};
        button(box,'允许本次',()=>run.respond(app,folder,request.id,allow,'用户允许当前工具请求'),'pwi-primary');button(box,'不允许',()=>run.respond(app,folder,request.id,decline,'用户拒绝当前工具请求'),'pwi-secondary');
      }
    }
  }
  function refresh(force=false){
    if(closed)return;try{state=run.getState(app,folder);}catch(e){error.textContent=e.message;return;}
    status.textContent=state.phase||'准备开始';status.dataset.state=state.status;input.disabled=run.active(state);send.disabled=run.active(state);send.textContent=state.status==='idle'?'开始工作':'继续工作';stop.hidden=!run.active(state);helper.textContent=run.active(state)?'可关闭面板，后台会继续；回来后从任务卡片查看。':'每次继续都会读取最新说明，并保留原会话上下文。';
    const messages=JSON.stringify([state.messages,state.plan,state.detail,state.error,state.status]);if(force||messages!==lastContent){lastContent=messages;progress.empty();if(state.plan?.length){const list=el(progress,'div','','pwr-plan');for(const step of state.plan)el(list,'div',(step.status==='completed'?'✓ ':step.status==='inProgress'?'◉ ':'○ ')+step.step);}
      if(!state.messages?.length)el(progress,'p',state.status==='idle'?'点击“开始工作”后，会自动读取本任务的说明和资料，再制作相应文件。':'正在准备会话和读取任务要求…','pwi-muted');
      for(const message of state.messages||[]){const article=el(progress,'article','',message.phase==='final_answer'?'pwr-message is-final':'pwr-message');markdown(article,message.text,app);}if(state.detail)el(progress,'p',state.detail,'pwr-error-detail');if(state.error?.message)el(progress,'p',state.error.message,'pwr-error-detail');}
    const pending=JSON.stringify(state.pending);if(force||pending!==lastRequests){lastRequests=pending;renderRequests();}
    const fkey=JSON.stringify([state.files,state.record_path,state.status]);if(force||fkey!==lastFiles){lastFiles=fkey;files.empty();for(const file of state.files||[])fileLink(files,file);if(!state.files?.length)el(files,'p',run.active(state)?'完成后在这里显示新增或更新的文件。':'本轮没有新增或更新文件。','pwi-muted');if(state.record_path)fileLink(files,{path:state.record_path,name:'打开本轮执行记录'});}
    if(force||state.status!==lastHistory){lastHistory=state.status;histories.empty();for(const item of run.history(app,folder).slice(0,12)){const details=el(histories,'details');el(details,'summary',(item.started_at||'本轮')+' '+({completed:'已结束',running:'执行中',waiting:'等待答复',failed:'未完成',interrupted:'已停止',queued:'准备中'}[item.status]||''));el(details,'p',item.summary||item.detail||item.phase||'','pwi-muted');if(item.record_path)fileLink(details,{path:item.record_path,name:'执行记录'});}}
  }
  refresh(true);dialog.showModal();timer=setInterval(()=>refresh(),1200);
  if(autostart&&state.status==='idle')start().catch(e=>{error.textContent=e.message;});
  return dialog;
}
module.exports={openWork,markdown};
