const weekly=require('./weekly.js');
function el(p,t,text='',cls=''){return p.createEl(t,{text:String(text),cls});}
function button(p,text,fn,cls=''){const b=el(p,'button',text,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){new Notice(e.message||String(e));console.error('[周报]',e);}finally{if(b.isConnected)b.disabled=false;}};return b;}
function shortDate(s){return String(s||'').slice(5,10).replace('-','.');}
function periodLabel(p){return shortDate(p.start)+'—'+shortDate(p.end);}
function openGroups(parent){return new Map([...parent.querySelectorAll('details[data-group-id]')].map(d=>[d.dataset.groupId,d.open]));}
function projects(app,p){const all=weekly.resolved(app,p,[...weekly.feed(app,p).items,...weekly.candidates(app,p)]),seen=new Set(),result=[];for(const item of all)if(!seen.has(item.report_project_key)){seen.add(item.report_project_key);result.push({key:item.report_project_key,name:item.report_project,category:item.report_category});}for(const [key,value]of Object.entries(weekly.organization(app).projects||{}))if(!seen.has(key))result.push({key,...value});return result;}
function categoryField(form,value){const wrap=el(form,'label','','pwb-field');el(wrap,'span','工作类别');const select=el(wrap,'select');for(const name of weekly.CATEGORIES)el(select,'option',name).value=name;select.value=value||'其他工作';return select;}
function projectField(form,options,value=''){const wrap=el(form,'label','','pwb-field');el(wrap,'span','所属项目');const input=el(wrap,'input');input.required=true;input.value=value;input.placeholder='选择已有项目，或直接输入项目名称';const id='pww-projects-'+Math.random().toString(36).slice(2),list=el(wrap,'datalist');list.id=id;input.setAttribute('list',id);for(const project of options)el(list,'option',project.name).value=project.name;return input;}
function organize(app,p,item,onSave,wholeProject=false){
  const modal=document.createElement('dialog');modal.className='pwb-dialog pwb-form pww-organize';document.body.appendChild(modal);el(modal,'h2',wholeProject?'调整项目归类':'调整工作归类');el(modal,'p',wholeProject?'同一项目默认沿用此名称和类别；单条事项仍可单独调整。':'这项工作将按你选择的类别和项目展示，刷新后保留。','pwi-muted');
  const form=el(modal,'form'),options=projects(app,p),category=categoryField(form,item.report_category),project=projectField(form,options,item.report_project);let title;
  if(!wholeProject){const wrap=el(form,'label','','pwb-field');el(wrap,'span','工作名称');title=el(wrap,'input');title.value=item.report_title;title.required=true;}
  const close=()=>{modal.close();modal.remove();},row=el(form,'div','','pwb-form-buttons');button(row,'取消',close);el(row,'button','保存归类','mod-cta').type='submit';
  form.onsubmit=e=>{e.preventDefault();if(!project.value.trim())return;const existing=options.find(x=>x.name===project.value.trim());try{if(wholeProject)weekly.updateProject(app,item.report_project_key,{name:project.value,category:category.value});else weekly.updatePlacement(app,p,item.id,{category:category.value,project_key:existing?.key||(project.value.trim()===item.report_project?item.report_project_key:'named:'+project.value.trim()),project_name:project.value,title:title.value});close();onSave?.();}catch(e){new Notice(e.message);}};modal.addEventListener('cancel',e=>{e.preventDefault();close();});modal.showModal();
}
function groupTree(app,parent,p,items,{prefix='feed',state=new Map(),showEmpty=false,candidates=false,onChange=()=>{},renderItem}={}){
  for(const category of weekly.grouped(app,p,items)){
    if(!category.count&&(!showEmpty||category.name==='其他工作'))continue;
    const group=el(parent,'details','','pww-category'),groupId=prefix+':category:'+category.name;group.dataset.groupId=groupId;group.open=state.has(groupId)?state.get(groupId):category.count>0;
    const summary=el(group,'summary');el(summary,'strong',category.name);el(summary,'span',category.count+' 项','pww-count');
    if(!category.count){el(group,'p','本周暂无这一类记录。','pwi-muted');continue;}
    const content=el(group,'div','','pww-category-body');
    for(const project of category.projects){const projectGroup=el(content,'details','','pww-project'),projectId=prefix+':'+category.name+':'+project.key;projectGroup.dataset.groupId=projectId;projectGroup.open=state.has(projectId)?state.get(projectId):false;
      const projectSummary=el(projectGroup,'summary'),name=el(projectSummary,'div','','pww-project-name');el(name,'strong',project.name);el(name,'small',candidates?'已勾选 '+project.checked+' / '+project.items.length+' 项':project.items.length+' 项工作','pwi-muted');
      const tools=el(projectSummary,'div','','pww-group-tools');tools.onclick=e=>{e.stopPropagation();if(e.target.closest('button'))e.preventDefault();};
      if(candidates)button(tools,project.checked===project.items.length?'取消全选':'全选',()=>{const ids=new Set(project.items.map(x=>x.id)),check=project.checked!==project.items.length;weekly.setCandidates(app,p,weekly.candidates(app,p).map(x=>ids.has(x.id)?{...x,checked:check}:x));onChange();},'pwi-text');
      button(tools,'归类',()=>organize(app,p,project.items[0],onChange,true),'pwi-text');
      const list=el(projectGroup,'div','','pww-project-items');for(const item of project.items)renderItem(list,item);
    }
  }
}
function openFile(app,relative){const f=app.vault.getAbstractFileByPath(relative);if(!f){new Notice('没有找到资料：'+relative);return;}const preview=require('./office-preview.js');if(preview.canPreview(app,f)){for(const dialog of document.querySelectorAll('dialog.pww-source,dialog.pww-editor'))dialog.dispatchEvent(new Event('cancel',{cancelable:true}));return preview.open(app,f);}if(['docx','xlsx','pptx','ppt'].includes(f.extension))return require('electron').shell.openPath(require('path').join(app.vault.adapter.getBasePath(),relative));return app.workspace.getLeaf('tab').openFile(f);}
function source(app,item){
  const modal=document.createElement('dialog');modal.className='pwb-dialog pww-source';document.body.appendChild(modal);el(modal,'h2',item.report_title||item.title);el(modal,'p',item.report_project?[item.report_category,item.report_project].join(' / '):item.project||item.kind,'pwi-muted');
  const close=()=>{modal.close();modal.remove();};button(modal,'关闭',close,'pwi-secondary');modal.addEventListener('cancel',e=>{e.preventDefault();close();});
  if(item.manual_text)el(modal,'pre',item.manual_text);
  for(const [title,records]of [['本周提出的要求',item.requests],['本周处理记录',item.outcomes]])if(records?.length){el(modal,'h3',title);for(const record of records){const detail=el(modal,'details');el(detail,'summary',record.at.slice(0,16).replace('T',' '));el(detail,'pre',record.text);}}
  if(item.files?.length){el(modal,'h3','关联资料');el(modal,'p','修改时间仅作查找线索，实际进度需结合正文和会话核对。','pwi-muted');for(const file of item.files.slice(0,35))button(modal,file.path,()=>openFile(app,file.path),'pwi-text');}
  modal.showModal();
}
function manual(app,p,onSave){
  const modal=document.createElement('dialog');modal.className='pwb-dialog pwb-form';document.body.appendChild(modal);el(modal,'h2','补充一项本周工作');const form=el(modal,'form');
  const field=(label,multi=false)=>{const wrap=el(form,'label','','pwb-field');el(wrap,'span',label);return el(wrap,multi?'textarea':'input');};
  const title=field('工作名称');title.required=true;const options=projects(app,p),category=categoryField(form,'其他工作'),project=projectField(form,options);project.onchange=()=>{const known=options.find(x=>x.name===project.value.trim());if(known)category.value=known.category;};const text=field('做了什么、进展和结果',true);text.required=true;
  const buttons=el(form,'div','','pwb-form-buttons');const close=()=>{modal.close();modal.remove();};button(buttons,'取消',close);el(buttons,'button','加入候选','mod-cta').type='submit';
  form.onsubmit=e=>{e.preventDefault();if(!title.value.trim()||!text.value.trim()||!project.value.trim()){new Notice('请填写工作名称、项目和具体内容。');return;}const known=options.find(x=>x.name===project.value.trim()),item={id:'manual:'+Date.now(),title:title.value.trim(),kind:'本人补充',manual_text:text.value.trim(),summary:text.value.trim(),date:new Date().toISOString(),files:[],manual_project:project.value.trim(),manual_project_key:known?.key||'named:'+project.value.trim(),category:category.value};weekly.addCandidate(app,p,item);weekly.updatePlacement(app,p,item.id,{category:category.value,project_key:item.manual_project_key,project_name:item.manual_project,title:item.title});close();onSave?.();};modal.addEventListener('cancel',e=>{e.preventDefault();close();});modal.showModal();title.focus();
}
async function choosePeriod(app,p){
  return new Promise(resolve=>{const modal=document.createElement('dialog');modal.className='pwb-dialog pwb-form';document.body.appendChild(modal);el(modal,'h2','选择汇报周期');const form=el(modal,'form'),fields={};for(const [key,label]of [['start','开始日期'],['end','结束日期']]){const wrap=el(form,'label','','pwb-field');el(wrap,'span',label);const input=el(wrap,'input');input.type='date';input.required=true;input.value=p[key];fields[key]=input;}const row=el(form,'div','','pwb-form-buttons');let result=null;button(row,'取消',()=>modal.close());el(row,'button','切换','mod-cta').type='submit';form.onsubmit=e=>{e.preventDefault();result={start:fields.start.value,end:fields.end.value};try{weekly.context(app,result);modal.close();}catch(e){new Notice(e.message);result=null;}};modal.onclose=()=>{modal.remove();resolve(result);};modal.showModal();});
}
function renderCandidates(app,parent,p,{onChange=()=>{},compact=false,state:keptState}={}){
  const items=weekly.candidates(app,p),state=keptState||openGroups(parent);parent.empty();
  if(!items.length)el(parent,'p','在左边点“＋”加入本周工作，也可以补充线下沟通和出差。','pwi-muted');
  groupTree(app,parent,p,items,{prefix:'candidates',state,candidates:true,onChange,renderItem:(list,item)=>{const row=el(list,'div','','pww-candidate');row.dataset.candidateId=item.id;const label=el(row,'label');const input=el(label,'input');input.type='checkbox';input.checked=item.checked!==false;el(label,'span',item.report_title);input.onchange=()=>{const list=weekly.candidates(app,p);const current=list.find(x=>x.id===item.id);if(current)current.checked=input.checked;weekly.setCandidates(app,p,list);onChange();};
    const tools=el(row,'div','','pww-candidate-tools');if(!compact)button(tools,'来源',()=>source(app,item),'pwi-text');button(tools,'归类',()=>organize(app,p,item,onChange),'pwi-text');const remove=button(tools,'移除',()=>{weekly.setCandidates(app,p,weekly.candidates(app,p).filter(x=>x.id!==item.id));onChange();},'pwi-text');remove.setAttribute('aria-label','从周报候选移除：'+item.report_title);
  }});
}
async function openWeekly(app,p=weekly.defaults()){
  const previous=document.querySelector('dialog.pww-editor');if(previous){previous.focus();return;}
  weekly.context(app,p);let d=weekly.receive(app,p),closed=false,timer=null,saveTimer=null,dirty=false,lastKey='',lastOrganization='';
  if(!d.report_title)d.report_title=weekly.suggestedTitle(app,p);
  const dialog=document.createElement('dialog');dialog.className='pwb-dialog pww-editor';dialog.lang='zh-CN';document.body.appendChild(dialog);
  const header=el(dialog,'header','','pwr-header'),titles=el(header,'div');el(titles,'h2','撰写周报');el(titles,'p',periodLabel(p)+' · 初稿生成后可直接修改，核对后再保存。','pwi-muted');
  function persist(){clearTimeout(saveTimer);if(dirty){weekly.saveDraft(app,p,d);dirty=false;}}
  function change(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(persist,300);}
  function close(){persist();closed=true;clearInterval(timer);dialog.close();dialog.remove();}
  button(header,'保存草稿并关闭',close,'pwi-text');dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  const status=el(dialog,'div','','pwr-status'),grid=el(dialog,'div','','pww-edit-grid'),main=el(grid,'main'),side=el(grid,'aside');
  const titleLabel=el(main,'label','','pwi-field');el(titleLabel,'span','周报名称');const title=el(titleLabel,'input');title.value=d.report_title;title.oninput=()=>{d.report_title=title.value;change();};
  const editLabel=el(main,'label','','pww-draft-label');el(editLabel,'span','周报初稿');const editor=el(editLabel,'textarea','','pww-markdown');editor.value=d.markdown||'';editor.placeholder='先勾选右侧候选工作，再生成初稿；你也可以在这里直接撰写。';editor.oninput=()=>{d.markdown=editor.value;change();};
  el(side,'h3','勾选要纳入周报的工作');const candidateBox=el(side,'div');function updateCandidates(){renderCandidates(app,candidateBox,p,{onChange:()=>{updateCandidates();refresh(true);}});}updateCandidates();button(side,'＋ 补充一条',()=>manual(app,p,()=>{updateCandidates();refresh(true);}), 'pwi-text');
  for(const [key,label,placeholder]of [['notes','本周补充（可选）','补充线下沟通、出差、未记入文件的工作，或纠正候选中的信息。'],['next_plan','下周计划（可选）','只写已明确的计划；不填写时，初稿会保留待补充。']]){const field=el(side,'label','','pwi-field');el(field,'span',label);const input=el(field,'textarea');input.rows=key==='notes'?5:3;input.value=d[key]||'';input.placeholder=placeholder;input.oninput=()=>{d[key]=input.value;change();};}
  el(side,'h3','需要你核对');const questions=el(side,'div','','pww-questions');
  const foot=el(dialog,'footer','','pwi-footer');const hint=el(foot,'span','原始候选和补充保留；正式周报只在点击保存后写入。','pwi-muted');const buttons=el(foot,'div','','pwi-footer-buttons');
  const generate=button(buttons,'按勾选生成初稿',async()=>{persist();await weekly.start(app,p,'generate');refresh(true);},'pwi-secondary');
  const stop=button(buttons,'停止生成',()=>{weekly.stop(app,p,'generate');},'pwi-secondary');
  const save=button(buttons,'保存周报',async()=>{persist();const relative=await weekly.saveReport(app,p,d.report_title);new Notice('周报已保存，原有内容保留');close();await openFile(app,relative);},'pwi-primary');
  function refresh(force=false){
    if(closed)return;const state=weekly.state(app,p,'generate');const fresh=weekly.receive(app,p);
    if(fresh.received_id&&fresh.received_id!==d.received_id){d=fresh;editor.value=d.markdown||'';}
    const busy=weekly.active(state);editor.disabled=busy;title.disabled=busy;generate.disabled=busy;save.disabled=busy||!editor.value.trim();stop.hidden=!busy;
    status.textContent=busy?state.phase:state?.status==='failed'?(state.detail||'生成未完成，请重试'):d.markdown?'初稿已保留，可编辑、补充后保存。':'勾选候选工作后，生成本周初稿。';
    let exists=false;try{exists=!!app.vault.getAbstractFileByPath(weekly.reportPath(d.report_title));}catch{save.disabled=true;}save.textContent=exists?'追加到已有周报':'保存周报';hint.textContent=exists?'本周已有周报，保存时追加本轮内容，原文保留。':'原始候选和补充保留；正式周报只在点击保存后写入。';
    const key=JSON.stringify([d.received_id,d.result?.questions]);if(force||key!==lastKey){lastKey=key;questions.empty();for(const question of d.result?.questions||[])el(questions,'p',question);if(!d.result?.questions?.length)el(questions,'p','生成后会在这里列出待核对事项。','pwi-muted');}
    const organization=JSON.stringify([weekly.organization(app),weekly.placements(app,p),weekly.candidates(app,p).map(x=>[x.id,x.checked])]);if(lastOrganization!==organization){lastOrganization=organization;updateCandidates();}
  }
  refresh(true);dialog.showModal();timer=setInterval(()=>refresh(),1500);return dialog;
}
function renderPanel(app,parent){
  let p=weekly.defaults(),custom=false;const root=el(parent,'section','','pww-panel');let lastKey='',timer=null;
  function render(){
    if(!root.isConnected)return;const open=openGroups(root);root.empty();const data=weekly.feed(app,p),selected=weekly.candidates(app,p),scan=weekly.state(app,p,'scan');
    const tools=el(root,'div','','pww-toolbar');const period=el(tools,'div');el(period,'strong',periodLabel(p));el(period,'small',data.updated_at?'最近刷新 '+data.updated_at.slice(0,16).replace('T',' '):'首次进入收集本库文件线索；之后可手动刷新。','pwi-muted');
    const ops=el(tools,'div');button(ops,'切换周次',async()=>{const next=await choosePeriod(app,p);if(next){p=next;custom=true;lastKey='';render();}},'pwb-text-button');const refresh=button(ops,'刷新本周工作',async()=>{await weekly.start(app,p,'scan');lastKey='';render();},'pwb-secondary');refresh.disabled=weekly.active(scan);
    if(weekly.active(scan))el(root,'p',scan.phase,'pwi-muted');if(scan?.status==='failed')el(root,'p',scan.detail||'本次刷新未完成，请重试。','pww-error');
    const layout=el(root,'div','','pww-overview-grid'),feed=el(layout,'section'),aside=el(layout,'aside','','pww-candidates');el(feed,'h3','本周做了什么');el(feed,'p','按工作类别和项目收拢，展开项目后点“＋”加入候选。','pwi-muted');
    if(!data.items.length)el(feed,'p',weekly.active(scan)?'正在读取本周记录…':'暂未找到记录，可刷新或在右侧补充一条。','pwi-muted');
    groupTree(app,feed,p,data.items,{prefix:'feed',state:open,showEmpty:true,onChange:()=>{lastKey='';render();},renderItem:(list,item)=>{const row=el(list,'article','','pww-activity');row.dataset.activityId=item.id;const text=el(row,'div');el(text,'strong',item.report_title);el(text,'small',shortDate(item.date)+' · '+item.kind,'pwi-muted');el(text,'p',item.summary||'查看相关记录并核对本周进度。');if(item.kind==='资料线索')el(text,'small','资料变化仅作线索，请核对后再纳入。','pwi-muted');const actions=el(row,'div','','pww-activity-actions');const add=button(actions,selected.some(i=>i.id===item.id)?'已加入':'＋',()=>{weekly.addCandidate(app,p,item);lastKey='';render();},'pww-add');add.disabled=selected.some(i=>i.id===item.id);add.setAttribute('aria-label','加入周报候选：'+item.report_title);button(actions,'来源',()=>source(app,item),'pwb-text-button');button(actions,'归类',()=>organize(app,p,item,()=>{lastKey='';render();}),'pwb-text-button');}});
    el(aside,'h3','周报候选 · '+selected.length);const list=el(aside,'div');renderCandidates(app,list,p,{state:open,onChange:()=>{lastKey='';render();}});button(aside,'＋ 补充一条',()=>manual(app,p,()=>{lastKey='';render();}),'pwb-text-button');const checked=selected.filter(i=>i.checked!==false).length;button(aside,'撰写周报（已勾选 '+checked+' 项）',()=>openWeekly(app,p),'pwb-primary');
    for(const warning of data.warnings||[])el(root,'p',warning,'pwi-muted');
  }
  function signature(){const c=weekly.context(app,p),fs=require('fs'),path=require('path');return [p.start,p.end,...['feed.json','candidates.json','jobs.json','placements.json','../organization.json'].map(name=>{try{return fs.statSync(path.join(c.dir,name)).mtimeMs;}catch{return 0;}}),weekly.state(app,p,'scan')?.status].join('|');}
  render();lastKey=signature();if(!weekly.feed(app,p).updated_at&&!weekly.active(weekly.state(app,p,'scan')))weekly.start(app,p,'scan').catch(e=>new Notice(e.message));
  timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}if(!custom&&weekly.defaults().start!==p.start)p=weekly.defaults();const key=signature();if(key!==lastKey){lastKey=key;render();}},1500);
  return root;
}
module.exports={renderPanel,openWeekly};
