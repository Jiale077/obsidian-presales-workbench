const fs=require('fs'),path=require('path'),crypto=require('crypto');
const RULES='90-其他/工作台/项目文件与接续规则.md';
const BUCKETS=[['entry','任务入口'],['current','当前采用'],['incoming','原始来料'],['reference','参考与模板'],['candidate','成果候选'],['process','过程文稿'],['handoff','会话交接'],['scratch','制作与临时文件'],['history','已标记历史'],['review','待确认用途']];
const DEFAULT_DIRS=['聊天截图','原始资料','参考资料','过程材料','交付物','会话交接','work'];
const BEGIN='<!-- workbench-organization:start -->',END='<!-- workbench-organization:end -->';
const SKIP=/(^|\/)(\.[^/]+|node_modules|__pycache__|site-packages)(\/|$)/;
const HASH=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
function context(app,folder){
  if(typeof folder!=='string'||folder.split('/').length<2||folder.startsWith('/')||folder.includes('\\')||folder.split('/').some(x=>!x||x.startsWith('.')||x==='..')||/^_MOC\//.test(folder)||folder.startsWith('90-其他/工作台'))throw Error('请选择一个具体项目文件夹。');
  const base=fs.realpathSync(app.vault.adapter.getBasePath());if(fs.lstatSync(path.join(base,folder)).isSymbolicLink())throw Error('请选择实际项目文件夹，整理入口不通过符号链接写入。');const full=fs.realpathSync(path.join(base,folder));
  if(!full.startsWith(base+path.sep)||!fs.statSync(full).isDirectory())throw Error('项目文件夹不在当前知识库中。');
  for(const relative of ['.workbench','.workbench/organization','.workbench/organization/catalog.json']){const p=path.join(full,relative);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('项目状态位置是符号链接，已保留：'+relative);}
  return {base,folder,full,meta:path.join(full,'.workbench/organization'),catalog:path.join(full,'.workbench/organization/catalog.json')};
}
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomBytes(3).toString('hex')+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,file);}
function state(app,folder){return read(context(app,folder).catalog,{schema:1,overrides:{},handoff:'',files:[]});}
function choices(app,folder){const saved=state(app,folder),draft=read(path.join(context(app,folder).meta,'draft.json'));return draft.baseApply===(saved.lastApply||null)&&draft.choices?draft.choices:saved;}
function saveChoices(app,folder,data){const c=context(app,folder);write(path.join(c.meta,'draft.json'),{baseApply:data.lastApply||null,choices:data});}
function classify(relative){
  const name=path.posix.basename(relative),ext=path.posix.extname(relative).toLowerCase(),folders=relative.slice(0,relative.length-name.length);
  if(!folders&&(/^(说明.*|📂 索引|AGENTS|CLAUDE)\.md$/.test(name)))return {bucket:'entry',reason:'根目录固定入口'};
  if(/交接|handoff/i.test(relative))return {bucket:'handoff',reason:'交接目录或交接文档'};
  if(/(^|\/)(work|tmp|temp|previews?|renders?|thumbnails?|缓存|渲染检查|预览|质检)(\/|$)/i.test(folders))return {bucket:'scratch',reason:'制作、渲染或程序中间内容'};
  if(/历史版本|历史归档|旧版归档/.test(folders))return {bucket:'history',reason:'已有历史目录'};
  if(/(^|\/)(outputs|交付物)(\/|$)/i.test(folders)&&/\.(docx?|pptx?|xlsx?|pdf|zip)$/.test(ext)&&!/(^|\/)(参考[^/]*|模板[^/]*|资料核对[^/]*|meeting-transcribe[^/]*|转录[^/]*)(\/|$)/i.test(folders)&&!/原文|录音/.test(name))return {bucket:'candidate',reason:'既有成果目录内的文档；采用版本待人工确认'};
  if(/参考|模板|研究基础|历史样例/.test(folders)||/原模板|指南|细则|参考样例/.test(name))return {bucket:'reference',reason:'参考、模板或编制依据'};
  if(/原始资料|聊天截图|材料收集|来稿|原始指南/.test(folders)||/原文|转写原文|录音/.test(name)||/\.(m4a|mp3|aac|ogg|flac|mp4|mov)$/i.test(name))return {bucket:'incoming',reason:'原始材料、消息或录音转写'};
  if(/\.(py|js|ts|jsx|tsx|json|jsonl|ndjson|conf|log|cache-\d+|tag)$/i.test(name)||ext==='.wav'&&/transcribe|转录/i.test(folders))return {bucket:'scratch',reason:'脚本、运行记录或派生音频'};
  if(ext==='.wav')return {bucket:'incoming',reason:'原始录音'};
  if(/meeting-transcribe|转录|识别|transcript/i.test(folders))return {bucket:'process',reason:'识别、转录或整理过程'};
  if(/\.(docx?|pptx?|xlsx?|pdf|zip)$/.test(ext))return {bucket:'candidate',reason:'文档或打包成果；采用版本待人工确认'};
  if(/图片稿/.test(folders)||/\.(png|jpe?g|webp|svg)$/.test(ext)&&/汇报材料|交付物|outputs/.test(folders))return {bucket:'candidate',reason:'图片稿或展示材料；采用状态待确认'};
  if(ext==='.md'||/过程材料/.test(folders))return {bucket:'process',reason:'说明、大纲、核验或过程文稿'};
  if(/\.(png|jpe?g|webp|svg|gif)$/.test(ext))return {bucket:'scratch',reason:'图片资源；可改为来料、参考或成果'};
  return {bucket:'review',reason:'仅凭路径无法确认用途'};
}
function scan(app,folder,draft){
  const c=context(app,folder),saved=state(app,folder),choices=draft||saved,prefix=folder+'/',files=[];
  for(const f of app.vault.getFiles()){
    if(!f.path.startsWith(prefix))continue;const relative=f.path.slice(prefix.length);if(SKIP.test(relative)||f.name==='.DS_Store'||f.name.startsWith('~$'))continue;
    const actual=path.join(c.full,relative);if(!fs.existsSync(actual)||fs.lstatSync(actual).isSymbolicLink())continue;
    const guess=classify(relative),override=choices.overrides?.[relative]||{},bucket=BUCKETS.some(([id])=>id===override.bucket)&&!['entry','current'].includes(override.bucket)?override.bucket:guess.bucket;
    files.push({path:f.path,relative,name:f.name,size:f.stat.size,mtime:f.stat.mtime,bucket,reason:override.bucket?'人工调整用途':guess.reason,pinned:!!override.pinned,label:override.label||f.basename||f.name});
    if(files.length>6000)throw Error('这个目录内容过多，请选择更具体的项目文件夹。');
  }
  files.sort((a,b)=>b.mtime-a.mtime||a.relative.localeCompare(b.relative,'zh-CN'));
  const paths=new Set(files.map(f=>f.relative)),previous=new Map([...(saved.files||[]),...(saved.missing||[])].map(f=>[f.relative,f])),missing=[...previous.values()].filter(f=>!paths.has(f.relative));
  const dirs={incoming:'原始资料',reference:'参考资料',process:'过程材料',deliverables:fs.existsSync(path.join(c.full,'交付物'))?'交付物':fs.existsSync(path.join(c.full,'outputs'))?'outputs':'交付物',scratch:fs.existsSync(path.join(c.full,'work'))?'work':fs.existsSync(path.join(c.full,'tmp'))?'tmp':'work'};
  return {folder,files,missing,choices:{schema:1,...choices,overrides:{...choices.overrides}},dirs,updated:saved.updated,counts:Object.fromEntries(BUCKETS.map(([id])=>[id,id==='current'?files.filter(f=>f.pinned).length:files.filter(f=>f.bucket===id&&!f.pinned).length]))};
}
function group(report){return BUCKETS.map(([id,name])=>({id,name,files:report.files.filter(f=>id==='current'?f.pinned:f.bucket===id&&!f.pinned)}));}
function roots(app){const found=new Set();for(const f of app.vault.getMarkdownFiles())if(['说明','📂 索引'].includes(f.basename)&&/^(10-|20-|30-|40-|50-|60-|70-)/.test(f.path)&&f.parent?.path.split('/').length>=2)found.add(f.parent.path);for(const f of app.vault.getAllLoadedFiles?.()||[])if(Array.isArray(f.children)&&f.path.split('/').length>=2&&f.path.split('/').length<=4&&/^(10-|20-|30-|40-|50-|60-|70-)/.test(f.path)&&!SKIP.test(f.path)&&!/(^|\/)(outputs|work|tmp|images|图片稿|历史快照)(\/|$)/i.test(f.path))found.add(f.path);return [...found].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function block(body){return BEGIN+'\n'+body+'\n'+END;}
function merge(original,body){const start=original.indexOf(BEGIN),end=original.indexOf(END);if(original.split(BEGIN).length>2||original.split(END).length>2)throw Error('整理标记有重复，请保留原文并检查。');if(start>=0&&end>=start)return original.slice(0,start)+block(body)+original.slice(end+END.length);if(start>=0||end>=0)throw Error('整理标记不完整，请保留原文并检查索引。');return original+(original.endsWith('\n\n')?'':original.endsWith('\n')?'\n':'\n\n')+block(body)+'\n';}
function fm(type,title){return '---\ntitle: '+JSON.stringify(title)+'\ntype: '+type+'\ntags: [项目导航, 工作台]\ncreated: '+now().slice(0,10)+'\n---\n\n';}
function link(app,folder,relative,label){const f=app.vault.getAbstractFileByPath(folder+'/'+relative);if(f&&app.fileManager?.generateMarkdownLink)return app.fileManager.generateMarkdownLink(f,folder+'/📂 索引.md',undefined,label||f.basename||f.name);return '[['+folder+'/'+relative+'|'+String(label||path.posix.basename(relative)).replace(/[\[\]|]/g,' ')+']]';}
function navigation(app,report){
  const {folder,files,dirs}=report,lines=['## 工作台文件导航',`整理时间：${now()}。按用途归类；原文件路径保持不变。`,'### 当前采用（人工选定）'];
  const pins=files.filter(f=>f.pinned);if(!pins.length)lines.push('尚未在整理面板指定。请结合本索引原有业务记录核对，成果候选不代表当前定稿。');else for(const f of pins)lines.push('- '+link(app,folder,f.relative,f.label));
  lines.push('### 固定接续入口','- '+link(app,folder,'会话交接/接续入口.md','交接与接续入口'),'### 后续文件位置',`- 原始来料：\`${dirs.incoming}/\`；参考：\`${dirs.reference}/\`；过程文稿：\`${dirs.process}/\`。`,`- 本轮成果：\`${dirs.deliverables}/\`；制作与临时内容：\`${dirs.scratch}/\`；交接：\`会话交接/\`。`);
  for(const g of group(report).filter(g=>g.id!=='current'&&g.files.length)){lines.push('### '+g.name+' · '+g.files.length);for(const f of g.files.slice(0,g.id==='scratch'?12:60))lines.push('- '+link(app,folder,f.relative,f.name));if(g.files.length>(g.id==='scratch'?12:60))lines.push('- 其余文件在工作台“整理文件”中展开查看。');}
  if(report.missing.length)lines.push('### 原路径缺失，需核对',...report.missing.map(f=>'- `'+f.relative+'`（本次整理未移动该文件）'));
  return lines.join('\n\n');
}
async function ensureFolder(app,folder){let at='';for(const part of folder.split('/')){at=at?at+'/'+part:part;const old=app.vault.getAbstractFileByPath(at);if(old&&!Array.isArray(old.children))throw Error('目录位置被文件占用：'+at);if(!old)await app.vault.createFolder(at);}}
function targets(c){return ['📂 索引.md','AGENTS.md','CLAUDE.md','会话交接/接续入口.md'].map(relative=>({relative,full:path.join(c.full,relative)}));}
async function maintain(app,folder,relative,body,{title,type}={}){const target=folder+'/'+relative;await ensureFolder(app,path.posix.dirname(target));const file=app.vault.getAbstractFileByPath(target);let before=null,after;if(file)await app.vault.process(file,text=>{before=text;after=merge(text,body);return after;});else{after=fm(type||'project-navigation',title||relative)+block(body)+'\n';await app.vault.create(target,after);}return {before,after:HASH(after)};}
async function apply(app,folder,choices,{createFolders=false,expectedApply}={}){
  choices=choices||state(app,folder);const c=context(app,folder),report=scan(app,folder,choices),old=state(app,folder),locks=app.__organizationLocks||(app.__organizationLocks=new Set());
  if(expectedApply!==undefined&&expectedApply!==(old.lastApply||null))throw Error('另一个窗口已更新分类，请重新读取项目后再保存。');
  if(locks.has(folder))throw Error('这个项目正在保存整理结果。');locks.add(folder);
  const id=Date.now().toString(36)+'-'+crypto.randomBytes(3).toString('hex'),backup={id,at:now(),folder,before:{},after:{},oldCatalog:old};
  try{
    for(const target of targets(c)){if(fs.existsSync(target.full)&&fs.lstatSync(target.full).isSymbolicLink())throw Error('入口是符号链接，已保留，请手工检查：'+target.relative);backup.before[target.relative]=fs.existsSync(target.full)?fs.readFileSync(target.full,'utf8'):null;if(backup.before[target.relative]?.includes(BEGIN)!==backup.before[target.relative]?.includes(END))throw Error('入口整理标记不完整：'+target.relative);}
    write(path.join(c.meta,'history',id+'.json'),backup);
    const update=async(relative,body,options)=>{const saved=await maintain(app,folder,relative,body,options);backup.before[relative]=saved.before;backup.after[relative]=saved.after;write(path.join(c.meta,'history',id+'.json'),backup);};
    if(createFolders)for(const directory of DEFAULT_DIRS)await ensureFolder(app,folder+'/'+directory);
    const handoffs=report.files.filter(f=>f.bucket==='handoff'&&f.relative!=='会话交接/接续入口.md'),selected=handoffs.find(f=>f.relative===choices?.handoff);
    const entry=['# 项目接续入口','这是固定导航入口，业务进度以实际累计交接和项目材料为准。','## 先读',app.vault.getAbstractFileByPath(folder+'/说明.md')?'- '+link(app,folder,'说明.md','任务说明'):'项目尚无根目录说明，请先阅读索引并核对本轮要求。','- '+link(app,folder,'📂 索引.md','项目索引与当前采用'),'## 指定采用的交接',selected?'- '+link(app,folder,selected.relative,selected.name):'尚未指定。以下为已有交接线索，先打开核对；日期和修改时间不能证明内容仍为当前口径。','## 现有交接记录',...(handoffs.length?handoffs.map(f=>'- '+link(app,folder,f.relative,f.name)):['尚未发现累计交接。需要交接时，可首次生成 `会话交接/项目交接.md`，再把准确链接追加在本入口管理区之外。']),'后续继续更新同一累计交接；新历史快照放 `会话交接/历史快照/`，已存在的交接保持原位置。'].join('\n\n');
    await update('会话交接/接续入口.md',entry,{title:'项目接续入口',type:'handoff-navigation'});
    const rulePath=path.join(c.base,RULES),pointer=`## 文件整理与跨 Agent 接续\n\n在本项目创建文件、整理成果或接续会话前，读取项目文件约定：\`${rulePath}\`。再读本目录 \`📂 索引.md\` 和 \`会话交接/接续入口.md\`，按索引中记录的位置保存新文件。`;
    await update('AGENTS.md',pointer,{title:'项目 Agent 约定',type:'project-agent-rules'});
    await update('CLAUDE.md','## 项目协作约定\n\n开始或接续本项目、生成文件前，先读取本目录 `AGENTS.md` 及其中指向的文件与接续约定。',{title:'项目协作入口',type:'project-agent-rules'});
    const refreshed=scan(app,folder,choices);await update('📂 索引.md',navigation(app,refreshed),{title:path.basename(folder)+' · 项目索引',type:'work-task'});
    const current={schema:1,overrides:choices.overrides||{},handoff:choices.handoff||'',updated:now(),files:refreshed.files.map(f=>({relative:f.relative,size:f.size,mtime:f.mtime})),missing:refreshed.missing,lastApply:id,dirs:refreshed.dirs};
    backup.done=true;write(path.join(c.meta,'history',id+'.json'),backup);write(c.catalog,current);return scan(app,folder);
  }catch(error){for(const [relative,expected]of Object.entries(backup.after).reverse()){try{const target=app.vault.getAbstractFileByPath(folder+'/'+relative);if(target&&HASH(fs.readFileSync(path.join(c.full,relative)))===expected){const before=backup.before[relative];if(before===null)await app.vault.trash(target,true);else await app.vault.modify(target,before);}}catch{}}backup.failed=String(error);try{write(path.join(c.meta,'history',id+'.json'),backup);}catch{}throw error;}finally{locks.delete(folder);}
}
async function undo(app,folder){
  const c=context(app,folder),current=state(app,folder);if(!current.lastApply)throw Error('没有可撤销的整理记录。');const backup=read(path.join(c.meta,'history',current.lastApply+'.json'));
  if(!backup.done)throw Error('上次保存未完整结束，请先核对入口。');
  for(const [relative,hash]of Object.entries(backup.after)){const file=path.join(c.full,relative);if(!fs.existsSync(file)||HASH(fs.readFileSync(file))!==hash)throw Error('入口保存后有新的修改，已保留这些内容，暂不能整批撤销：'+relative);}
  for(const [relative,old]of Object.entries(backup.before)){const target=app.vault.getAbstractFileByPath(folder+'/'+relative);if(old===null){if(target)await app.vault.trash(target,true);}else if(target)await app.vault.modify(target,old);}
  write(c.catalog,backup.oldCatalog||{schema:1,overrides:{},files:[]});return scan(app,folder);
}
async function initialize(app,folder){return apply(app,folder,state(app,folder),{createFolders:true});}
function guidance(base,folder){const entry=path.join(base,folder,'会话交接/接续入口.md');return `本轮工作目录：${path.join(base,folder)}\n文件与接续约定：${path.join(base,RULES)}\n开始前读取此约定与项目索引。${fs.existsSync(entry)?'固定接续入口：'+entry+'，再按入口读取实际交接。':'本项目尚未建立固定接续入口，先从说明、索引和已有交接核对背景。'}已有文件保持原路径；新成果直接保存在本项目索引约定的位置，采用入口只引用准确原路径。`;} 
function resume(app,folder){const c=context(app,folder);if(!fs.existsSync(path.join(c.full,'会话交接/接续入口.md')))throw Error('请先保存分类与入口，再复制接续指令。');return `本项目：${c.full}\n先按知识库AGENTS.md读取入口，再实际阅读本项目的📂 索引.md、会话交接/接续入口.md${fs.existsSync(path.join(c.full,'说明.md'))?'和说明.md':''}，打开其中指向的真实交接和材料后继续用户要求。\n${guidance(c.base,folder)}\n交接中的历史状态需要核对；新成果按日期版本保存，累计交接继续更新同一文件。`;}
module.exports={RULES,BUCKETS,DEFAULT_DIRS,context,state,choices,saveChoices,classify,scan,group,roots,apply,undo,initialize,guidance,resume,merge};
