const store=require('./task-store.js');
const ai=require('./task-ai.js');
const STEPS=['放入任务','选择位置','加入资料','核对说明','检查并建档'];
const CATEGORIES={'近期工作':'30-近期工作','公司申报':'40-团队工作/各类申报材料','会议材料':'70-会议交流','自选目录':''};
function el(parent,tag,text='',cls='') {return parent.createEl(tag,{text:String(text),cls});}
function size(n){return n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';}
async function droppedFiles(transfer) {
  const found=[];
  async function visit(entry,prefix='') {
    if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));found.push({file,relativePath:prefix+file.name});}
    else if(entry.isDirectory){const reader=entry.createReader();while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await visit(child,prefix+entry.name+'/');}}
  }
  const entries=[...transfer.items||[]].map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
  if(entries.length)for(const entry of entries)await visit(entry);else for(const file of transfer.files||[])found.push({file});
  return found;
}
async function openIntake(app,options={}) {
  const active=document.querySelector('dialog.pwb-intake');if(active){active.focus();return;}
  let d=options.draftId?await store.loadDraft(app,options.draftId):store.createDraft({mode:options.mode||(options.targetFolder?'append':'new'),target_folder:options.targetFolder||'',category:options.category||'近期工作',parent:options.parent||'30-近期工作',title:options.targetFolder?.split('/').at(-1)||''});
  let dirty=false,timer=null,queue=Promise.resolve(),busy=0,committing=false,view='wizard',result=null,closed=false;
  let aiTimer=null,aiStarting=false,aiState=restoringAI(),readDocuments=d.ai?.readDocuments??true,audioProvider=d.ai?.audioProvider||'local';
  function restoringAI(){return ai.jobPath(d)&&(!d.ai.result||d.ai.revision)?{status:'queued',phase:'正在读取处理状态'}:null;}
  function aiWorking(){return aiStarting||ai.running(aiState);}
  const dialog=document.createElement('dialog');dialog.className='pwb-dialog pwb-intake';dialog.setAttribute('aria-label','接一项工作');document.body.appendChild(dialog);
  const head=el(dialog,'header','','pwi-header');const titles=el(head,'div');el(titles,'h2','接一项工作');el(titles,'p','把要求和资料放在一起，准备好下一步。','pwi-muted');
  const headerActions=el(head,'div','','pwi-header-actions');
  const draftsButton=button(headerActions,'草稿',async()=>{await flush();view='drafts';await renderDrafts();});
  button(headerActions,'关闭',safeClose,'pwi-text');
  const steps=el(dialog,'nav','','pwi-steps');steps.setAttribute('aria-label','任务收集步骤');
  const body=el(dialog,'div','','pwi-body');const error=el(dialog,'div','','pwi-error');error.setAttribute('role','alert');
  const foot=el(dialog,'footer','','pwi-footer');const saveState=el(foot,'span','尚未填写','pwi-muted');const buttons=el(foot,'div','','pwi-footer-buttons');saveState.setAttribute('aria-live','polite');
  function showError(e){error.textContent=e.message||String(e);console.error('[接一项工作]',e);}
  function button(parent,text,fn,cls='') {
    const b=el(parent,'button',text,cls);b.type='button';b.addEventListener('click',async()=>{if(committing)return;b.disabled=true;error.textContent='';try{await fn();}catch(e){showError(e);}finally{b.disabled=false;}});return b;
  }
  function persist(){if(closed||committing)return;if(!dirty&&!ai.hasContent(d)&&!['title','client','first_action','deliverable','constraints','deadline','extra_notes'].some(k=>d[k]?.trim()))return;dirty=true;saveState.textContent='正在保存草稿…';clearTimeout(timer);timer=setTimeout(()=>{queue=queue.then(()=>store.saveDraft(app,d)).then(()=>{if(!closed)saveState.textContent='草稿已保存';}).catch(e=>{showError(e);saveState.textContent='草稿未保存，请重试';});},500);}
  async function flush(){clearTimeout(timer);await queue;if(dirty){await store.saveDraft(app,d);saveState.textContent='草稿已保存';}}
  async function safeClose(){
    if(committing||closed)return;
    if(busy||aiStarting){error.textContent='草稿正在保存，请稍等片刻再关闭。';return;}
    closed=true;
    try{if(!result)await flush();}
    catch(e){closed=false;watchAI();throw e;}
    clearTimeout(timer);clearInterval(aiTimer);dialog.close();dialog.remove();
  }
  dialog.addEventListener('cancel',e=>{e.preventDefault();safeClose().catch(showError);});
  function field(parent,key,label,{multiline=false,placeholder='',rows=4,type='text'}={}) {
    const wrap=el(parent,'label','','pwi-field');el(wrap,'span',label);const control=el(wrap,multiline?'textarea':'input');control.dataset.field=key;control.value=d[key]||'';if(multiline)control.rows=rows;else control.type=type;control.placeholder=placeholder;
    control.addEventListener('input',()=>{d[key]=control.value;persist();});return control;
  }
  function select(parent,label,value,choices,onChange,fieldName='') {
    const wrap=el(parent,'label','','pwi-field');el(wrap,'span',label);const c=el(wrap,'select');if(fieldName)c.dataset.field=fieldName;for(const choice of choices){const [val,text]=Array.isArray(choice)?choice:[choice,choice];c.createEl('option',{value:val,text});}c.value=value;c.onchange=()=>onChange(c.value);return c;
  }
  function section(parent,title,desc=''){el(parent,'h3',title);if(desc)el(parent,'p',desc,'pwi-muted');}
  function folderPicker(parent,key,label) {
    const wrap=el(parent,'div','','pwi-folder-picker');const input=field(wrap,key,label,{placeholder:'输入目录名或路径，选择下方的匹配结果'});const matches=el(wrap,'div','','pwi-picker-results');
    const folders=store.getFolders(app);
    function update(){matches.empty();const q=input.value.trim().toLowerCase();const list=folders.filter(p=>!q||p.toLowerCase().includes(q)).slice(0,8);if(!list.length)el(matches,'p','没有找到目录，请换一个关键词。','pwi-muted');for(const path of list)button(matches,path,()=>{d[key]=path;input.value=path;matches.empty();persist();},'pwi-picker-item');}
    input.addEventListener('input',update);input.addEventListener('focus',update);
  }
  async function addFiles(items,lane) {
    if(aiWorking())throw new Error('请等本轮 AI 处理完成后再加入资料。');
    if(!items.length)return;busy++;saveState.textContent='正在保存资料…';renderFooter();let skipped=0;
    try{await flush();for(let i=0;i<items.length;i++){const item=items[i];const rel=item.relativePath||item.file.webkitRelativePath||item.file.name;if(/(^|\/)(\.DS_Store|node_modules|\.git)(\/|$)/.test(rel)){skipped++;continue;}saveState.textContent=`正在保存资料 ${i+1}/${items.length}`;await store.stageFile(app,d,item.file,{lane,relativePath:rel});dirty=true;}saveState.textContent=skipped?`资料已保存，跳过 ${skipped} 个系统或依赖文件`:'资料已保存到草稿';}
    finally{busy--;render();}
  }
  function fileInput(parent,label,lane,{images=false,directory=false}={}) {
    const picker=el(parent,'input','','pwi-file-input');picker.type='file';picker.multiple=true;picker.setAttribute('aria-label',label);if(images)picker.accept='image/*';if(directory)picker.setAttribute('webkitdirectory','');
    button(parent,label,()=>picker.click(),'pwi-secondary');picker.onchange=()=>{const items=[...picker.files].map(file=>({file}));picker.value='';addFiles(items,lane).catch(showError);};
  }
  function dropZone(parent,lane) {
    const zone=el(parent,'div','','pwi-dropzone');zone.tabIndex=0;zone.dataset.lane=lane;zone.setAttribute('aria-label',lane==='chat'?'粘贴或拖入聊天截图':'拖入本地资料');
    el(zone,'strong',lane==='chat'?'粘贴微信截图，或拖到这里':'把领导发的文件、录音拖到这里');
    el(zone,'p',lane==='chat'?'点击此处后按 ⌘V，支持连续加入多张截图。':'保存为本地副本，不需要再打开访达复制。','pwi-muted');
    const choices=el(zone,'div','','pwi-file-choices');fileInput(choices,lane==='chat'?'选择截图':'选择文件',lane,{images:lane==='chat'});if(lane!=='chat')fileInput(choices,'选择文件夹',lane,{directory:true});
    zone.ondragover=e=>{e.preventDefault();zone.classList.add('is-dragging');};zone.ondragleave=()=>zone.classList.remove('is-dragging');zone.ondrop=async e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('is-dragging');try{await addFiles(await droppedFiles(e.dataTransfer),lane);}catch(err){showError(err);}};
    zone.addEventListener('click',e=>{if(e.target===zone||e.target.tagName==='STRONG'||e.target.tagName==='P')zone.focus();});
  }
  dialog.addEventListener('paste',e=>{const files=[...e.clipboardData?.files||[]];if(!files.length)return;e.preventDefault();const lane=files.every(f=>f.type.startsWith('image/'))?'chat':'material';addFiles(files.map(file=>({file})),lane).catch(showError);});
  // Prevent a drop outside a collection area from navigating the Obsidian window.
  dialog.addEventListener('dragover',e=>e.preventDefault());dialog.addEventListener('drop',e=>{e.preventDefault();if(e.target.closest('.pwi-dropzone'))return;droppedFiles(e.dataTransfer).then(items=>addFiles(items,'material')).catch(showError);});
  function assetRows(parent,lane) {
    const list=d.assets.filter(a=>!lane||a.lane===lane);if(!list.length)return;
    const rows=el(parent,'div','','pwi-assets');
    for(const asset of list){
      const row=el(rows,'article','','pwi-asset');const top=el(row,'div','','pwi-asset-top');
      if(asset.mime.startsWith('image/')){const img=el(top,'img');img.src=app.vault.adapter.getResourcePath(asset.storage_path);img.alt=asset.name;}
      const name=el(top,'div');el(name,'strong',asset.name);el(name,'small',size(asset.size),'pwi-muted');
      button(top,'移除',()=>{d.assets=d.assets.filter(a=>a.id!==asset.id);persist();render();},'pwi-text');
      const fields=el(row,'div','','pwi-asset-fields');select(fields,'资料用途',asset.role,store.ROLES,v=>{asset.role=v;persist();});
      const label=el(fields,'label','','pwi-field');el(label,'span','补充用途（可留空）');const note=el(label,'input');note.value=asset.note||asset.ai_note||'';note.placeholder='例如：按这份模板填写，只改第三章';note.oninput=()=>{asset.note=note.value;persist();};
      if(asset.relative_path!==asset.name)el(row,'small',asset.relative_path,'pwi-muted');
    }
  }
  function references(parent) {
    section(parent,'关联知识库里的资料','搜索文件或整个资料目录，生成引用。');
    const input=el(parent,'input','','pwi-reference-search');input.type='search';input.placeholder='输入产品、项目或文件名';input.setAttribute('aria-label','搜索库内参考资料');
    const results=el(parent,'div','','pwi-picker-results');let refTimer;
    input.oninput=()=>{clearTimeout(refTimer);refTimer=setTimeout(()=>{results.empty();const matches=store.findReferences(app,input.value);for(const f of matches)button(results,(Array.isArray(f.children)?'目录：':'')+f.path,()=>{if(!d.references.some(r=>r.path===f.path))d.references.push({path:f.path,role:'参考资料',note:''});persist();render();},'pwi-picker-item');if(input.value&&!matches.length)el(results,'p','没有找到，试试更短的关键词。','pwi-muted');},100);};
    const rows=el(parent,'div','','pwi-assets');for(const ref of d.references){const row=el(rows,'article','','pwi-asset');const top=el(row,'div','','pwi-asset-top');el(top,'strong',ref.path);button(top,'移除',()=>{d.references=d.references.filter(r=>r!==ref);persist();render();},'pwi-text');const fields=el(row,'div','','pwi-asset-fields');select(fields,'资料用途',ref.role,store.ROLES.filter(x=>x!=='领导聊天截图'),v=>{ref.role=v;persist();});const label=el(fields,'label','','pwi-field');el(label,'span','参考什么（可留空）');const note=el(label,'input');note.value=ref.note||ref.ai_note||'';note.placeholder='例如：沿用产品介绍页，项目案例只作背景';note.oninput=()=>{ref.note=note.value;persist();};}
  }
  function watchAI() {
    clearInterval(aiTimer);
    const draft=d,job=ai.jobPath(draft);
    if(!job)return;
    let polling=false;
    const active=()=>!closed&&d===draft&&ai.jobPath(draft)===job;
    async function poll(){
      if(!active()||polling)return;
      polling=true;
      try{
        const next=await ai.getState(app,draft);
        if(!active())return;
        const previous=aiState?.status;
        if(next?.status==='completed'&&(!draft.ai.result||draft.ai.revision)){
          const revision=!!draft.ai.revision;
          busy++;
          try{await ai.receive(app,draft);}finally{busy--;}
          aiState=next;
          dirty=true;render();saveState.textContent=revision?'修改稿已保存，待核对':'AI 草稿已生成，待核对';
        }else{
          aiState=next;
          const label=dialog.querySelector('.pwi-ai-progress');
          if(label)label.textContent=[next?.phase,next?.detail].filter(Boolean).join(' · ');
          if(previous!==next?.status)render();
        }
        if(!ai.running(next))clearInterval(interval);
      }catch(e){aiState={status:'failed',detail:e.message};render();showError(e);clearInterval(interval);}
      finally{polling=false;}
    }
    const interval=setInterval(poll,1200);aiTimer=interval;poll();
  }
  async function launchAI(run){
    if(busy||aiWorking())throw new Error('请等当前处理完成后再试。');
    const step=d.step;
    aiStarting=true;dirty=true;d.step=3;render();
    try{await flush();aiState=await run();}
    catch(e){d.step=step;throw e;}
    finally{aiStarting=false;render();watchAI();}
  }
  async function startAI() {
    if(!ai.hasContent(d))throw new Error('请先加入截图、录音、资料，或填写领导消息与背景。');
    await launchAI(()=>ai.start(app,d,{readDocuments,audioProvider}));
  }
  function aiControls(parent) {
    const box=el(parent,'section','','pwi-ai-controls');
    el(box,'strong','根据这些资料起草说明');
    el(box,'p','截图与说明使用本机 Codex；录音默认在本机转录。整理完成后先由你核对，再建档。','pwi-muted');
    select(box,'录音转录方式',audioProvider,[['local','本机 Whisper（已缓存模型，不上传原始录音）'],['tingwu','通义听悟（云端，可区分说话人）']],v=>{audioProvider=v;});
    const check=el(box,'label','','pwi-checkbox');const c=el(check,'input');c.type='checkbox';c.checked=readDocuments;c.onchange=()=>{readDocuments=c.checked;};el(check,'span','一并读取文档正文（云端不可用时自动在本机读取）');
    button(box,'识别资料并起草说明',startAI,'pwi-primary');
  }
  function aiProgress(parent,title,stopLabel){
    const box=el(parent,'div','','pwi-ai-working');
    el(box,'h3',title);
    const progress=el(box,'p',aiStarting?'正在保存当前草稿…':[aiState?.phase,aiState?.detail].filter(Boolean).join(' · '),'pwi-ai-progress');
    progress.setAttribute('role','status');
    if(!aiStarting){
      el(box,'p','可以保存草稿并关闭。回来后从“草稿”查看结果。','pwi-muted');
      button(box,stopLabel,()=>ai.stop(app,d),'pwi-text');
    }
  }
  function revisionControls(parent){
    if(aiWorking()){
      aiProgress(parent,'正在修改说明','停止修改');
      return;
    }
    if(d.ai.revision&&['failed','cancelled'].includes(aiState?.status))el(parent,'p',`${aiState.detail||'本轮修改未完成。'} 当前正文和修改意见已保留。`,'pwi-location');
    const box=el(parent,'section','','pwi-ai-controls');
    const label=el(box,'label','','pwi-field');el(label,'span','告诉 AI 你想怎么改');
    const input=el(label,'textarea');input.rows=2;input.value=d.ai.revisionNotes||'';
    input.placeholder='例如：这次只整理汇报思路；时间还没定，把字数和页数要求删掉。';
    input.oninput=()=>{d.ai.revisionNotes=input.value;persist();};
    const controls=el(box,'div','','pwi-ai-review-actions');
    button(controls,'按意见修改',async()=>{
      const instruction=input.value.trim();
      if(!instruction){input.focus();throw new Error('请先填写希望 AI 怎么改。');}
      if(!ai.reviewMarkdown(d).trim())throw new Error('请先准备一份可修改的说明草稿。');
      await launchAI(()=>ai.revise(app,d,instruction));
    },'pwi-primary');
    if(d.ai.previousReview)button(controls,'恢复修改前',()=>{ai.undoRevision(d);persist();render();},'pwi-secondary');
    el(controls,'span','基于当前草稿修改，完成后由你核对。','pwi-muted');
  }
  function aiReview(parent) {
    if(aiWorking()&&!d.ai?.result){aiProgress(parent,'正在识别资料并整理说明','停止整理');return true;}
    if(d.ai?.result){
      const data=d.ai.result;section(parent,'核对 AI 整理的说明','核对本轮要做什么、交付什么和哪些要求已明确。可让 AI 按意见修改，也可直接编辑正文。');
      if(d.ai.inputFingerprint!==ai.fingerprint(d))el(parent,'p','资料或填写内容已有变化。请重新整理，或对照最新要求修改下方正文后再采用。','pwi-location');
      revisionControls(parent);
      const grid=el(parent,'div','','pwi-ai-review-grid');const left=el(grid,'div');const editor=el(left,'textarea','','pwi-ai-editor');editor.dataset.field='ai-review';editor.setAttribute('aria-label','AI 说明草稿，可直接修改');editor.value=ai.reviewMarkdown(d);editor.readOnly=aiWorking();editor.oninput=()=>{d.ai.reviewedMarkdown=editor.value;d.ai.approved=false;persist();};
      const right=el(grid,'aside','','pwi-ai-sources');el(right,'h4','来源与待核对');
      const notices=[...(data.warnings||[]),...(data.result.pending_questions||[])];if(notices.length){const list=el(right,'ul');for(const item of notices)el(list,'li',item);}else el(right,'p','AI 未单独标注疑问，请对照原文核对。','pwi-muted');
      for(const source of data.sources){const details=el(right,'details');el(details,'summary',`${source.source_id}  ${source.name}`);const image=data.result.image_texts.find(i=>i.source_id===source.source_id);if(image){const a=d.assets.find(a=>a.id===source.key);if(a){const img=el(details,'img');img.src=app.vault.adapter.getResourcePath(a.storage_path);img.alt=a.name;}el(details,'pre',image.text);if(image.uncertainty)el(details,'p',image.uncertainty,'pwi-muted');}else{const a=d.assets.find(a=>a.is_ai_generated&&a.ai_source_id===source.source_id&&a.generated_key?.startsWith(d.ai.jobId+':'))||(source.kind==='text'?d.assets.find(a=>a.id===source.key):null);if(a){const pre=el(details,'pre','展开后读取原文');details.addEventListener('toggle',async()=>{if(details.open&&!pre.dataset.loaded){try{pre.textContent=await app.vault.cachedRead(app.vault.getAbstractFileByPath(a.storage_path));pre.dataset.loaded='true';}catch{pre.textContent='原文暂时无法读取，请重新整理。';}}});}else el(details,'p',source.error||(source.status==='listed'?'本轮未读取正文。':'已用于说明整理。'),'pwi-muted');}}
      const actions=el(parent,'div','','pwi-ai-review-actions');button(actions,'重新识别与整理',startAI,'pwi-secondary').disabled=aiWorking();el(actions,'span',d.ai.approved?'这份说明已核对采用，仍可修改。':'核对后点击下方“采用草稿并继续”。','pwi-muted');return true;
    }
    if(aiState&&['failed','cancelled'].includes(aiState.status)){el(parent,'p',aiState.detail||'本次整理未完成，原资料保留。','pwi-location');}
    aiControls(parent);return false;
  }
  function renderFooter() {
    buttons.empty();if(result)return;
    draftsButton.disabled=aiWorking();
    button(buttons,'保存草稿并关闭',safeClose,'pwi-text').disabled=aiStarting;
    if(view==='drafts'){button(buttons,'回到当前任务',()=>{view='wizard';render();},'pwi-secondary');return;}
    if(d.step>0&&!aiWorking())button(buttons,'上一步',()=>{d.step--;persist();render();},'pwi-secondary');
    const next=button(buttons,d.step===4?'确认并保存说明':d.step===2?'识别并进入核对':d.step===3&&d.ai?.result?'采用草稿并继续':'下一步',async()=>{
      if(busy){error.textContent='资料正在保存，请稍等片刻。';return;}
      if(d.step===2){await startAI();return;}
      if(d.step===3&&d.ai?.result){ai.approve(d,ai.reviewMarkdown(d));}
      if(d.step<4){d.step++;persist();render();return;}
      await flush();store.validate(app,d);committing=true;for(const b of dialog.querySelectorAll('input,select,textarea,button'))b.disabled=true;saveState.textContent='正在整理目录与说明…';
      try{result=await store.commitDraft(app,d);renderSuccess();await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(result.briefPath));}
      finally{committing=false;for(const b of dialog.querySelectorAll('input,select,textarea,button'))b.disabled=false;if(!result)saveState.textContent='尚未完成，草稿和原资料已保留，可重试';}
    },'pwi-primary');next.disabled=!!busy||aiWorking();
    if(d.step===2)button(buttons,'手动填写',()=>{d.step=3;persist();render();},'pwi-text');
  }
  async function renderDrafts() {
    steps.hidden=true;body.empty();buttons.empty();section(body,'继续未完成的收集','已加入的截图和文件会一并恢复。');
    const list=await store.listDrafts(app);if(!list.length)el(body,'p','目前没有保存的草稿。','pwi-muted');
    for(const item of list){const row=el(body,'div','','pwi-draft-row');const info=el(row,'div');el(info,'strong',item.title||item.ai?.result?.result?.title||'尚未命名的工作');el(info,'small',`${item.updated}  ·  ${item.assets.length} 份资料`,'pwi-muted');button(row,'继续',async()=>{d=await store.loadDraft(app,item.id);aiState=restoringAI();readDocuments=d.ai?.readDocuments??true;audioProvider=d.ai?.audioProvider||'local';dirty=true;view='wizard';render();watchAI();},'pwi-secondary');}
    renderFooter();
  }
  function renderSuccess() {
    steps.hidden=true;body.empty();buttons.empty();error.textContent='';section(body,'工作已建档','说明已在新标签页打开。后续的新消息和资料，可以从项目卡片的“补充要求”继续加入。');
    el(body,'p',d.title,'pwi-success-title');const path=el(body,'textarea','','pwi-success-path');path.readOnly=true;path.rows=3;path.value=app.vault.adapter.getBasePath()+'/'+result.briefPath;path.setAttribute('aria-label','说明文件完整路径');
    const ops=el(body,'div','','pwi-success-actions');button(ops,'开始工作',async()=>{await safeClose();await require('./actions.js').openWork(app,result.folder,{autostart:true});},'pwi-primary');button(ops,'复制给 GPT 的任务说明',async()=>{await navigator.clipboard.writeText(store.handoff(app,result.briefPath));new Notice('任务说明已复制');},'pwi-secondary');button(ops,'复制资料梳理任务',async()=>{await navigator.clipboard.writeText(store.handoff(app,result.briefPath,{organize:true}));new Notice('资料梳理任务已复制');},'pwi-secondary');button(ops,'复制说明路径',async()=>{await navigator.clipboard.writeText(path.value);new Notice('路径已复制');},'pwi-secondary');
    el(body,'p','说明和来源已保存。点击“开始工作”即可按说明执行；之后也能在任务卡片中继续修改。','pwi-muted');
    button(buttons,'在访达中显示',()=>require('electron').shell.showItemInFolder(path.value),'pwi-secondary');button(buttons,'完成',safeClose,'pwi-primary');saveState.textContent='已保存';
  }
  function render() {
    if(closed)return;if(result){renderSuccess();return;}if(view==='drafts'){renderDrafts().catch(showError);return;}
    steps.hidden=false;steps.empty();body.empty();error.textContent='';
    STEPS.forEach((step,i)=>{const b=button(steps,`${i+1}  ${step}`,()=>{d.step=i;persist();render();},i===d.step?'is-active':'');b.disabled=aiWorking();b.setAttribute('aria-current',i===d.step?'step':'false');});
    if(d.step===0){
      section(body,'先把任务放进来','先留下原话，背景可以用自己的话简单补充。');
      const grid=el(body,'div','','pwi-two-columns');const left=el(grid,'div');field(left,'title','工作名称',{placeholder:'可先留空，由 AI 根据资料拟定名称'});field(left,'raw_messages','领导消息 / 聊天原文',{multiline:true,rows:5,placeholder:'可以粘贴微信文字，也可以只放截图。'});field(left,'background','我知道的背景',{multiline:true,rows:4,placeholder:'这是什么事，之前做到哪了，领导希望我做什么。'});
      const right=el(grid,'div');dropZone(right,'chat');assetRows(right,'chat');
    } else if(d.step===1){
      section(body,'这项工作放在哪里','可新建工作目录，也可接续原项目。');
      select(body,'本次如何收纳',d.mode,[['new','新建一项工作'],['subtask','在已有项目下新建一轮工作'],['append','给已有工作补充新要求']],v=>{d.mode=v;persist();render();},'mode');
      if(d.mode==='new'){
        // 保留已有草稿和会议材料快捷入口使用的分类值。
        const choices=Object.keys(CATEGORIES).map(category=>category==='会议材料'?[category,'会议交流']:category);
        select(body,'工作分类',d.category,choices,v=>{d.category=v;if(CATEGORIES[v])d.parent=CATEGORIES[v];persist();render();},'category');
        if(d.category==='自选目录')folderPicker(body,'parent','上级目录');else el(body,'p','保存到：'+d.parent,'pwi-location');
      } else folderPicker(body,'target_folder',d.mode==='subtask'?'选择原项目目录':'选择要补充的工作目录');
      if(d.mode!=='append')field(body,'folder_name','新目录名称（可留空）',{placeholder:(store.safeName(d.title)||'工作名称')+'-'+store.stamp().short});
      field(body,'client','客户 / 合作方（可留空）',{placeholder:'例如：示例客户A'});
      if(d.mode==='append')el(body,'p','新增要求会按时间追加到“说明.md”，已有内容保留。','pwi-location');
    } else if(d.step===2){
      section(body,'把相关资料一起放好','文件保留原格式，可以标明各自用来做什么。录音和已有转录稿都可加入。');
      dropZone(body,'material');assetRows(body);references(body);aiControls(body);
    } else if(d.step===3){
      if(aiReview(body)){renderFooter();body.scrollTop=0;return;}
      section(body,'这次先做什么','先做的一步和最终交付可以分别写。暂不确定的内容可以留空。');
      field(body,'first_action','本次先做什么',{multiline:true,rows:3,placeholder:'例如：先总结会议录音，梳理领导要求，暂不制作PPT。'});
      const grid=el(body,'div','','pwi-two-columns');field(grid,'deliverable','希望得到什么',{multiline:true,rows:4,placeholder:'例如：填好Excel中的三行；或形成一页PPT内容建议。'});field(grid,'constraints','必须遵守的要求',{multiline:true,rows:4,placeholder:'例如：使用研究院名义；只改第五章；采用指定模板。'});
      field(body,'deadline','时间安排（可留空）',{placeholder:'例如：周五上午先给领导看初稿'});field(body,'extra_notes','其他补充（可留空）',{multiline:true,rows:3});
    } else {
      section(body,'检查说明并保存','核对后保存到所选目录；识别原文、录音转写和原始资料会一并保留。');
      let path='请先在“选择位置”选定目录';try{path=store.plannedFolder(d);}catch{}
      el(body,'p','保存位置：'+path,'pwi-location');
      const check=el(body,'label','','pwi-checkbox');const input=el(check,'input');input.type='checkbox';input.checked=d.focus;input.onchange=()=>{d.focus=input.checked;persist();};el(check,'span','在「项目推进」中加星关注');
      const preview=el(body,'textarea','','pwi-preview');preview.readOnly=true;preview.setAttribute('aria-label','说明内容预览');try{preview.value=d.mode==='append'?store.section(d):store.brief(d);}catch{preview.value='请先返回“选择位置”选定目录。';}
    }
    renderFooter();body.scrollTop=0;
  }
  render();dialog.showModal();dialog.querySelector('input[data-field=title]')?.focus();watchAI();

  return dialog;
}
module.exports={openIntake,droppedFiles};
