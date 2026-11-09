const Notice = globalThis.Notice;
const HOME = '售前工作台.md';
const PROJECT_STATUSES = ['未标注','待开始','进行中','待反馈','暂停','已完成','已归档'];
function projectStatusOptions(status) {
  return status && !PROJECT_STATUSES.includes(status) ? [...PROJECT_STATUSES,status] : PROJECT_STATUSES;
}
function dateParts(value = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,year:p.year,short:`${p.month}.${p.day}`};
}
function safeName(s) {return String(s).normalize('NFC').replace(/[\\/:*?"<>|\[\]#^\n\r]/g,' ').replace(/\s+/g,' ').trim().slice(0,90).replace(/^\.+|\.+$/g,'');}
function frontmatter(fields) {return '---\n'+Object.entries(fields).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';}
async function ensureFolder(app,path) {
  let current='';
  for(const piece of path.split('/')) {current=current?`${current}/${piece}`:piece;if(!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);}
}
async function unique(app,parent,name,ext='') {
  let path=`${parent}/${name}${ext}`;
  for(let i=2;await app.vault.adapter.exists(path);i++) path=`${parent}/${name}-${i}${ext}`;
  return path;
}
function form(app,title,fields,submitText='保存') {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='pwb-dialog pwb-form';dialog.lang='zh-CN';document.body.appendChild(dialog);
    dialog.createEl('h2',{text:title});
    const node=dialog.createEl('form');const controls={};let result=null;
    for(const field of fields) {
      const label=node.createEl('label',{cls:'pwb-field'});label.createEl('span',{text:field.label});
      const input=label.createEl(field.options?'select':field.multiline?'textarea':'input');
      if(field.options)for(const option of field.options)input.createEl('option',{text:option,value:option});
      if(field.multiline)input.rows=5;else if(!field.options)input.type=field.type||(field.date?'date':'text');
      input.value=field.value??'';input.required=!!field.required||!!field.date;
      if(field.placeholder)input.placeholder=field.placeholder;if(field.help)label.createEl('small',{text:field.help,cls:'pwb-muted'});controls[field.key]=input;
    }
    const error=node.createDiv({cls:'pwb-error'});error.setAttribute('role','alert');
    const buttons=node.createDiv({cls:'pwb-form-buttons'});
    const cancel=buttons.createEl('button',{text:'取消',type:'button'});cancel.onclick=()=>dialog.close();
    buttons.createEl('button',{text:submitText,type:'submit',cls:'mod-cta'});
    node.onsubmit=e=>{e.preventDefault();result=Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.value.trim()]));if(fields.some(f=>f.required&&!result[f.key])){error.textContent='请填写必填项目。';result=null;return;}dialog.close();};
    dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});dialog.showModal();Object.values(controls)[0]?.focus();
  });
}
async function open(app,path,newTab=false) {
  const file=app.vault.getAbstractFileByPath(path);
  if(!file) throw new Error('没有找到文件：'+path);
  const preview=require('./office-preview.js');if(preview.canPreview(app,file))return preview.open(app,file);
  await app.workspace.getLeaf(newTab?'tab':false).openFile(file);
}
function openOrganizer(app,folder=''){
  const file=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/project-organization-ui.js');delete require.cache[require.resolve(file)];return require(file).openOrganizer(app,folder);
}
async function createRecord(app,kind) {
  const today=dateParts();
  const meeting=kind==='meeting', project=kind==='project';
  const fields=[{key:'title',label:project?'项目名称':meeting?'交流主题':'工作标题',required:true,placeholder:project?'客户与项目名称':'用一句话记下这件事'},
    {key:'client',label:'客户 / 合作方（可留空）'},
    ...(project?[{key:'next_action',label:'下一步（可留空）'}]:[{key:'date',label:meeting?'会议日期':'记录日期',date:true,value:today.date},{key:'project',label:'关联项目（可留空）'}]),
    ...(meeting?[{key:'kind',label:'记录类型',options:['交流准备与记录','正式会议纪要']}]:[]),
    {key:'details',label:project?'目标与范围':meeting?'已知背景 / 交流内容':'进展、结果或待跟进事项',multiline:true}];
  const data=await form(app,project?'新建工作项目':meeting?'记录会议交流':'记一条工作',fields,project?'创建项目':'保存记录');
  if(!data) return null;
  const name=safeName(data.title);if(!name)throw new Error('标题中需要有可用的文字。');
  let path,body;const fieldsOut={title:data.title,type:project?'work-project':meeting?'meeting-record':'work-log',tags:[project?'工作项目':meeting?'会议交流':'工作记录'],created:today.date,client:data.client,project:project?data.title:data.project};
  if(project) {
    const folder=await unique(app,'30-近期工作',name);await ensureFolder(app,folder);path=folder+'/📂 索引.md';
    Object.assign(fieldsOut,{stage:'需求梳理',status:'进行中',next_action:data.next_action,updated:today.date});
    body=`# ${data.title}\n\n## 目标与范围\n\n${data.details}\n\n## 当前采用材料\n\n## 需求与反馈\n\n## 交付与验证\n\n## 进展记录\n\n返回：[[售前工作台]]\n`;
  } else if(meeting) {
    fieldsOut.meeting_date=data.date;fieldsOut.record_kind=data.kind;
    if(data.kind==='正式会议纪要') {
      fieldsOut.tags=['会议纪要'];const folder=`50-会议纪要/${data.date.slice(0,4)||today.year}`;await ensureFolder(app,folder);path=await unique(app,folder,`${data.date}-${name}`,'.md');
    } else {
      const folder=await unique(app,'70-会议交流',`${name}-${data.date.slice(5).replace('-','.')}`);await ensureFolder(app,folder);path=folder+'/📂 索引.md';
    }
    body=`# ${data.title}\n\n## 背景与交流内容\n\n${data.details}\n\n## 客户需求与反馈\n\n## 已确认事项\n\n## 待跟进事项\n\n## 相关材料\n\n返回：[[售前工作台]]\n`;
  } else {
    fieldsOut.record_date=data.date;await ensureFolder(app,'40-团队工作/工作记录');path=await unique(app,'40-团队工作/工作记录',`${data.date}-${name}`,'.md');
    body=`# ${data.title}\n\n## 工作记录\n\n${data.details}\n\n## 待跟进事项\n\n## 关联材料\n\n返回：[[售前工作台]]\n`;
  }
  const file=await app.vault.create(path,frontmatter(fieldsOut)+body);if(project)await require('./project-organization.js').initialize(app,file.parent.path);new Notice(project?'项目已创建':'记录已保存');await open(app,file.path,true);return file;
}
async function saveProjectProgress(app,file,fields) {
  await app.fileManager.processFrontMatter(file,f=>Object.assign(f,fields,{updated:dateParts().date}));
}
async function updateProgress(app,file) {
  const fm=app.metadataCache.getFileCache(file)?.frontmatter||{};
  const data=await form(app,'更新项目进展',[
    {key:'stage',label:'当前阶段',value:fm.stage||''},
    {key:'status',label:'状态',options:projectStatusOptions(fm.status),value:fm.status||'未标注'},
    {key:'next_action',label:'下一步',value:fm.next_action||''}
  ],'更新进展');
  if(!data)return;
  await saveProjectProgress(app,file,data);
  new Notice('项目进展已更新');
  return data;
}
async function toggleFocus(app,path) {
  const file=app.vault.getAbstractFileByPath(HOME);if(!file)throw new Error('没有找到工作台配置');
  let next;
  await app.fileManager.processFrontMatter(file,f=>{
    const list=Array.isArray(f.focus_projects)?f.focus_projects:[];
    next=list.includes(path)?list.filter(p=>p!==path):[...list,path];
    f.focus_projects=next;
  });
  return next;
}
function openIntake(app,options={}) {
  const dir=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台');
  for(const name of ['task-intake.js','task-store.js','task-ai.js']){const path=require('path').join(dir,name);delete require.cache[require.resolve(path)];}
  return require(require('path').join(dir,'task-intake.js')).openIntake(app,options);
}
async function openWork(app,folder,options={}) {
  const current=document.querySelector("dialog.pwb-intake");if(current){current.dispatchEvent(new Event("cancel",{cancelable:true}));for(let i=0;i<40&&document.querySelector("dialog.pwb-intake");i++)await new Promise(r=>setTimeout(r,100));if(document.querySelector("dialog.pwb-intake"))throw new Error("请等资料保存完成后再开始工作。");}
  const dir=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台');
  for(const name of ['task-run-ui.js','task-run.js']){const file=require('path').join(dir,name);delete require.cache[require.resolve(file)];}
  return require(require('path').join(dir,'task-run-ui.js')).openWork(app,folder,options);
}
function openCodex(app){
  const file=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/codex-panel.js');delete require.cache[require.resolve(file)];return require(file).openCodex(app);
}
function weeklyUI(app){const file=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/weekly-ui.js');delete require.cache[require.resolve(file)];return require(file);}
function openWeekly(app,period){return weeklyUI(app).openWeekly(app,period);}
function weeklyPanel(app,parent){return weeklyUI(app).renderPanel(app,parent);}
async function clockSettings(app){
  const file=app.vault.getAbstractFileByPath(HOME),data=app.metadataCache.getFileCache(file)?.frontmatter||{};
  const next=await form(app,'倒计时设置',[
    {key:'off_work_time',label:'每天几点下班',type:'time',required:true,value:data.off_work_time||'18:00'},
    {key:'custom_rest_name',label:'自定假期名称（可选）',value:data.custom_rest_name||'',placeholder:'例如：公司额外放假、年假'},
    {key:'custom_rest_at',label:'自定假期开始时间（可选）',type:'datetime-local',value:data.custom_rest_at||'',help:'留空即自动计算下一个法定假期，并识别调休补班。这里只用于公司额外假期或年假；清除时间可恢复自动计算。'}
  ],'保存设置');
  if(!next)return null;
  await app.fileManager.processFrontMatter(file,f=>{Object.assign(f,next);});new Notice('倒计时设置已保存');return next;
}
async function copyTask(app,file,kind) {
  const briefPath=`${file.parent.path}/说明.md`;
  const base=app.vault.adapter.getBasePath();
  let store;
  if(kind!=='weekly') {
    const storePath=require('path').join(base,'90-其他/工作台/task-store.js');
    delete require.cache[require.resolve(storePath)];store=require(storePath);
  }
  if(kind==='project'&&app.vault.getAbstractFileByPath(briefPath)){await navigator.clipboard.writeText(store.handoff(app,briefPath));new Notice('任务说明已复制');return;}
  const instructions={project:'先读项目索引及当前采用材料，核对实际进展、当前版本和未决问题，再推进下一步。不要把历史草稿当作现行结论。',weekly:`先读取《周报生成规则》：${base}/90-其他/工作台/周报生成规则.md，并按其中指定的范本和列表格式整理。用 weekly-report-summary 技能核对原始记录与引用文档，保留原文和可追溯事实；正文格式以工作台规则为准。`};
  await navigator.clipboard.writeText(`工作知识库：${base}\n本库有 AGENTS.md 时先按其读取入口。\n本次文件：${base}/${file.path}\n\n${instructions[kind]||instructions.project}${store?'\n\n'+store.workflowGuidance(base):''}`);
  new Notice('任务说明已复制，可粘贴到 Codex 或 AI 协作面板');
}
module.exports={HOME,dateParts,createRecord,projectStatusOptions,saveProjectProgress,updateProgress,toggleFocus,copyTask,open,openIntake,openWork,openCodex,clockSettings,openWeekly,weeklyPanel,openOrganizer};
