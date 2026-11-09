const DRAFT_ROOT='00-Inbox/工作任务草稿';
const HOME='售前工作台.md';
const ROLES=['领导聊天截图','待修改文件','填写模板','参考资料','会议录音','文字转录','其他材料'];
const OMIT=/(^|\/)(node_modules|\.git|\.obsidian|\.trash|outputs?|work|dist|build|__pycache__|\.venv|venv|90-历史版本|会话交接|工作任务草稿)(\/|$)/i;
function stamp() {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,short:`${Number(p.month)}.${Number(p.day)}`};
}
function id() {return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);}
function safeName(s) {return String(s??'').normalize('NFC').replace(/[\\/:*?"<>|\[\]#^\n\r]/g,' ').replace(/\s+/g,' ').trim().replace(/^\.+|\.+$/g,'').slice(0,110);}
function validPath(path) {
  if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.')))throw new Error('请选择知识库内的有效目录。');
  return path;
}
function assetRelative(name) {return String(name).split(/[\\/]/).filter(Boolean).map(safeName).filter(Boolean).join('/');}
function frontmatter(f) {return '---\n'+Object.entries(f).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';}
async function ensureFolder(app,path) {validPath(path);let p='';for(const part of path.split('/')){p=p?`${p}/${part}`:part;const f=app.vault.getAbstractFileByPath(p);if(f&&!Array.isArray(f.children))throw new Error('目录名称已被文件占用：'+p);if(!f)await app.vault.createFolder(p);}}
async function unique(app,path,directory=false) {let candidate=path;const slash=path.lastIndexOf('/'),dot=path.lastIndexOf('.');const ext=!directory&&dot>slash?path.slice(dot):'';const base=ext?path.slice(0,-ext.length):path;for(let i=2;await app.vault.adapter.exists(candidate);i++)candidate=`${base}-${i}${ext}`;return candidate;}
function createDraft(values={}) {const t=stamp();return {schema:1,id:id(),created:t.time,updated:t.time,step:0,title:'',client:'',raw_messages:'',background:'',first_action:'',deliverable:'',constraints:'',deadline:'',extra_notes:'',mode:'new',category:'近期工作',parent:'30-近期工作',target_folder:'',folder_name:'',focus:true,assets:[],references:[],...values};}
function draftFolder(d) {if(!/^[a-z0-9-]+$/.test(d.id))throw new Error('草稿编号无效');return `${DRAFT_ROOT}/${d.id}`;}
async function saveDraft(app,d) {const folder=draftFolder(d);await ensureFolder(app,folder);d.updated=stamp().time;await app.vault.adapter.write(`${folder}/草稿.json`,JSON.stringify(d,null,2));return d;}
async function loadDraft(app,draftId) {if(!/^[a-z0-9-]+$/.test(draftId))throw new Error('草稿编号无效');const d=JSON.parse(await app.vault.adapter.read(`${DRAFT_ROOT}/${draftId}/草稿.json`));if(d.id!==draftId||d.schema!==1)throw new Error('草稿格式不受支持');return d;}
async function listDrafts(app) {
  if(!await app.vault.adapter.exists(DRAFT_ROOT))return [];
  const folders=(await app.vault.adapter.list(DRAFT_ROOT)).folders;const result=[];
  for(const folder of folders){try{const d=JSON.parse(await app.vault.adapter.read(`${folder}/草稿.json`));if(d.schema===1&&d.status!=='committed')result.push(d);}catch{/* Other folders are not intake drafts. */}}
  return result.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
}
async function stageFile(app,d,file,{lane='material',relativePath=''}={}) {
  if(lane==='chat'&&!file.type?.startsWith('image/')&&!/\.(png|jpe?g|webp|gif|heic|bmp|svg)$/i.test(file.name))lane='material';
  const fileId=id();const rel=assetRelative(relativePath||file.webkitRelativePath||file.name)||`附件-${fileId}`;
  const folder=`${draftFolder(d)}/附件/${fileId}`;await ensureFolder(app,folder);
  const filename=safeName(file.name)||rel.split('/').at(-1);const path=`${folder}/${filename}`;
  const bytes=await file.arrayBuffer();await app.vault.createBinary(path,bytes);
  const asset={id:fileId,name:filename,relative_path:rel,storage_path:path,size:bytes.byteLength,mime:file.type||'',lane,role:lane==='chat'?'领导聊天截图':/\.(m4a|mp3|wav|aac|ogg|flac)$/i.test(filename)?'会议录音':'参考资料',note:''};
  d.assets.push(asset);await saveDraft(app,d);return asset;
}
function getFolders(app) {return app.vault.getAllLoadedFiles().filter(f=>Array.isArray(f.children)&&f.path!=='/'&&!OMIT.test(f.path)&&!f.path.split('/').some(x=>x.startsWith('.'))).map(f=>f.path).sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function findReferences(app,query) {
  if(!query.trim())return [];
  const terms=query.trim().toLowerCase().split(/\s+/);
  return app.vault.getAllLoadedFiles().filter(f=>f.path!=='/'&&!OMIT.test(f.path)&&!f.path.split('/').some(x=>x.startsWith('.'))&&!['AGENTS.md','CLAUDE.md'].includes(f.name)&&terms.every(t=>f.path.toLowerCase().includes(t))).sort((a,b)=>Number(Array.isArray(a.children))-Number(Array.isArray(b.children))||a.path.length-b.path.length).slice(0,18);
}
function plannedFolder(d) {
  if(d.commit?.folder)return d.commit.folder;
  if(d.mode==='append')return validPath(d.target_folder);
  const parent=validPath(d.mode==='subtask'?d.target_folder:d.parent);
  const name=safeName(d.folder_name)||`${safeName(d.title)||'未命名工作'}-${stamp().short}`;
  return `${parent}/${name}`;
}
function validate(app,d) {
  if(d.ai?.result&&!require('./task-ai.js').current(d))throw new Error('请先在“核对说明”核对并采用 AI 说明草稿；资料有变动时可重新整理。');
  if(!safeName(d.title))throw new Error('请先填写工作名称。');
  const parent=validPath(d.mode==='new'?d.parent:d.target_folder);
  const f=app.vault.getAbstractFileByPath(parent);if(!f||!Array.isArray(f.children))throw new Error('保存目录不存在，请回到“选择位置”重新选择。');
  for(const r of d.references){validPath(r.path);if(!app.vault.getAbstractFileByPath(r.path))throw new Error('这份参考资料已移动，请重新关联：'+r.path);}
  for(const a of d.assets)if(!a.storage_path.startsWith(draftFolder(d)+'/附件/'))throw new Error('附件不属于当前草稿，请重新加入。');
}
function tableCell(s) {return String(s||'').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');}
function wiki(path,label='') {return `[[${path}${label?'|'+String(label).replace(/[\[\]|]/g,' '):''}]]`;}
function materialList(d,paths,folder) {
  const rows=[];
  for(const a of d.assets){const dest=paths[a.id]||`${folder}/${a.lane==='chat'?'聊天截图':'原始资料'}/${a.relative_path}`;rows.push(`| ${wiki(dest,a.name)} | ${tableCell(a.role)} | ${tableCell(a.note||a.ai_note)||'待补充'} |`);}
  for(const r of d.references)rows.push(`| ${wiki(r.path,r.path.split('/').at(-1))} | ${tableCell(r.role)}（库内引用） | ${tableCell(r.note||r.ai_note)||'待补充'} |`);
  return rows.length?'| 材料 | 用途分类 | 使用说明 |\n| --- | --- | --- |\n'+rows.join('\n'):'暂未加入资料，可后续补充。';
}
function screenshotLinks(d,folder,paths) {
  return d.assets.filter(a=>a.lane==='chat').map(a=>{
    const dest=paths[a.id]||`${folder}/聊天截图/${a.relative_path}`;
    return `!${wiki(dest)}${a.note?'\n\n'+a.note:''}`;
  });
}
function sourceInputs(d,{folder,paths}) {
  const entries=[
    ['领导原始要求',[d.raw_messages,...screenshotLinks(d,folder,paths)].filter(Boolean).join('\n\n')],
    ['工作背景',d.background],['本次先做',d.first_action],['预期交付物',d.deliverable],
    ['明确要求',d.constraints],['时间安排',d.deadline],['其他补充',d.extra_notes],
    ['资料清单',d.assets.length||d.references.length?materialList(d,paths,folder):'']
  ];
  return entries.filter(([,value])=>value?.trim()).map(([title,value])=>`#### ${title}\n\n${value}`).join('\n\n');
}
function section(d,{folder=plannedFolder(d),paths={}}={}) {
  if(d.ai?.approved&&d.ai.result)return require('./task-ai.js').section(d,{folder,paths});
  const lines=[`## ${d.mode==='append'?'补充要求':'任务说明'} · ${d.created}`,`### 工作背景\n\n${d.background||'待补充。'}`,`### 领导原始要求\n\n${d.raw_messages||'文字要求尚未补充；如有聊天截图，请读取下方原图。'}`];
  lines.push(...screenshotLinks(d,folder,paths));
  lines.push(`### 本次先做什么\n\n${d.first_action||'先阅读本说明、聊天截图和相关资料，梳理背景、要求与交付物。'}`,`### 预期交付物\n\n${d.deliverable||'待明确；先依据原始要求梳理，不自行扩大任务范围。'}`,`### 必须遵守的要求\n\n${d.constraints||'尚未单独填写，先核对原始消息和材料要求。'}`,`### 时间安排\n\n${d.deadline||'尚未明确。'}`,`### 相关资料与用途\n\n${materialList(d,paths,folder)}`);
  if(d.extra_notes)lines.push(`### 补充说明\n\n${d.extra_notes}`);
  const pending=[];if(!d.deliverable)pending.push('预期交付物');if(!d.deadline)pending.push('截止时间');if(!d.assets.length&&!d.references.length)pending.push('相关材料');
  lines.push(`### 读取与接续\n\n请实际打开上面的文件、目录和聊天截图，不只依赖文件名。录音、转录稿与原始材料分别核对；本说明保存的是原始要求与用户填写内容，未自动完成识图或转录。${d.mode==='append'?'本节为新增要求，原说明保留；遇到与旧要求冲突且无法判断的地方，请明确指出。':''}${pending.length?'\n\n待明确：'+pending.join('、')+'。':''}`);
  return lines.join('\n\n');
}
function brief(d,plan={}) {return frontmatter({title:d.title,type:'work-brief',tags:['工作任务','需求说明'],client:d.client,project:d.title,created:stamp().date,task_id:d.id})+`# ${d.title}\n\n`+section(d,plan)+`\n\n返回：${wiki(`${plan.folder||plannedFolder(d)}/📂 索引`,'任务索引')} · [[售前工作台]]\n`;}
function workflowGuidance(base,{organize=false}={}) {
  return [
    `售前工作流：${base}/90-其他/工作台/售前技能工作流.md`,
    '按本次任务需要选择技能，不必依次运行全部三个：',
    '• 会前准备：结合历史交流、项目背景与产品材料，整理简报、问题和演示路线。',
    '• 口径核验：核实采用版本、数字出处、能力边界与材料冲突。',
    '• 反馈归并：将多轮意见整理为有来源的修改响应矩阵。',
    '已有有效核验表、转录和矩阵直接复用；后续 PPT、讲稿、正式纪要和周报继续使用现有对应技能。',
    organize?'本次仅梳理背景与要求；上述技能只按需辅助核验和归并，不制作正式交付物。':'只推进本次已要求的工作；简单改稿直接处理。'
  ].join('\n');
}
function handoff(app,briefPath,{organize=false}={}) {
  const base=app.vault.adapter.getBasePath();
  const folder=briefPath.slice(0,briefPath.lastIndexOf('/'));
  return `工作知识库：${base}\n请本库有 AGENTS.md 时先按其读取入口。\n本次说明：${base}/${briefPath}\n\n请实际读取说明中的聊天截图、附件和库内参考资料。${organize?'先识别聊天要求；有录音或转录稿时按适用技能处理，整理工作背景、本次任务、交付物、明确约束与待核对事项，更新说明，先不制作正式交付物。':'先理解背景、领导要求和材料用途，再按“本次先做什么”推进。'}\n保留原始要求和资料，不把推测当作已确认事实；遇到重要信息缺失时说明缺口。\n\n${require('./project-organization.js').guidance(base,folder)}\n\n${workflowGuidance(base,{organize})}`;
}
function managedBlock(d,body) {return `<!-- work-intake:${d.id}:start -->\n${body}\n<!-- work-intake:${d.id}:end -->`;}
async function appendOnce(app,file,d,body) {const marker=`<!-- work-intake:${d.id}:start -->`;await app.vault.process(file,old=>old.includes(marker)?old:old.trimEnd()+'\n\n'+managedBlock(d,body)+'\n');}
async function commitDraft(app,d) {
  if(d.status==='committed'&&d.result)return d.result;
  validate(app,d);
  const locks=app.__presalesIntakeLocks||(app.__presalesIntakeLocks=new Set());if(locks.has(d.id))throw new Error('正在保存这项工作，请稍候。');locks.add(d.id);
  try {
    if(!d.commit){let folder=plannedFolder(d);if(d.mode!=='append')folder=await unique(app,folder,true);d.commit={folder,paths:{},copied:{}};await saveDraft(app,d);}
    const {folder,paths,copied}=d.commit;await ensureFolder(app,folder);
    for(const a of d.assets){
      const source=app.vault.getAbstractFileByPath(a.storage_path);if(!source)throw new Error('草稿附件未找到：'+a.name);
      if(!paths[a.id]){paths[a.id]=await unique(app,`${folder}/${a.lane==='chat'?'聊天截图':'原始资料'}/${a.relative_path}`);await saveDraft(app,d);}
      const dest=paths[a.id];await ensureFolder(app,dest.slice(0,dest.lastIndexOf('/')));
      const existing=app.vault.getAbstractFileByPath(dest);
      if(!copied[a.id]||!existing){if(existing){if(existing.stat?.size!==source.stat.size)throw new Error('目标文件发生变化，请检查：'+dest);}else await app.vault.copy(source,dest);copied[a.id]=true;await saveDraft(app,d);}
    }
    const briefPath=folder+'/说明.md',indexPath=folder+'/📂 索引.md';let file=app.vault.getAbstractFileByPath(briefPath);
    if(file){if(d.mode!=='append'&&!(await app.vault.cachedRead(file)).includes('task_id: '+JSON.stringify(d.id)))throw new Error('说明文件已存在，请检查后再保存：'+briefPath);if(d.mode==='append')await appendOnce(app,file,d,section(d,{folder,paths}));}
    else file=await app.vault.create(briefPath,brief(d,{folder,paths}));
    let index=app.vault.getAbstractFileByPath(indexPath);
    const firstAction=d.ai?.approved?'按已核对的说明推进本轮任务':d.first_action||'读取资料，梳理背景、要求与交付物';
    const indexBody=`## 本次任务入口\n\n- ${wiki(briefPath,'说明与原始要求')}\n- 本次先做：${firstAction}\n\n${materialList(d,paths,folder)}\n\n返回：[[售前工作台]]`;
    if(index)await appendOnce(app,index,d,indexBody);
    else index=await app.vault.create(indexPath,frontmatter({title:d.title,type:'work-task',tags:['工作任务',d.category],created:stamp().date,updated:stamp().date,client:d.client,project:d.title,status:'待开始',stage:'需求梳理',next_action:d.ai?.approved?firstAction:d.first_action||'阅读说明与原始资料，梳理本次要求',task_brief:briefPath})+`# ${d.title}\n\n`+managedBlock(d,indexBody)+'\n');
    if(d.mode!=='append')await require('./project-organization.js').initialize(app,folder);
    if(d.focus){const home=app.vault.getAbstractFileByPath(HOME);if(home)await app.fileManager.processFrontMatter(home,f=>{const list=Array.isArray(f.focus_projects)?f.focus_projects:[];if(!list.includes(indexPath))f.focus_projects=[...list,indexPath];});}
    d.status='committed';d.result={folder,briefPath,indexPath};await saveDraft(app,d);
    const staging=app.vault.getAbstractFileByPath(draftFolder(d));if(staging){try{await app.vault.trash(staging,true);}catch{/* A committed draft is hidden from the draft list even if cleanup fails. */}}
    return d.result;
  } finally {locks.delete(d.id);}
}
module.exports={DRAFT_ROOT,ROLES,OMIT,stamp,safeName,validPath,assetRelative,createDraft,saveDraft,loadDraft,listDrafts,stageFile,getFolders,findReferences,plannedFolder,validate,brief,section,sourceInputs,handoff,workflowGuidance,commitDraft,draftFolder};
