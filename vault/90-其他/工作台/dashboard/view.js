const app = dv.app;
const modulePath = require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/actions.js');
delete require.cache[require.resolve(modulePath)];
const actions = require(modulePath);
const clockPath=require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/dashboard-clock.js');delete require.cache[require.resolve(clockPath)];const {clock}=require(clockPath);
const calendar=require(require('path').join(app.vault.adapter.getBasePath(),'90-其他/工作台/holiday-calendar.js'));let holidayData=calendar.read(app),lastCalendarCheck=Date.now();
const root=dv.container.createDiv({cls:'pwb'});
const HOME=actions.HOME;
const tabs=['工作总览','项目推进','材料库','会议交流','周报复盘','调研学习'];
let current=sessionStorage.getItem('presales-workbench-tab')||tabs[0];if(!tabs.includes(current))current=tabs[0];
let query='',folder='',clientFilter='全部',searchLimit=60;
const recentFilters=['未完成','已完成','已关注','全部'];
const recentFilterKey='presales-workbench-recent-filter';
const legacyCompletionHint='';
let recentFilter=sessionStorage.getItem(recentFilterKey);
if(!recentFilters.includes(recentFilter))recentFilter=recentFilters[0];
// A successful save can return before Obsidian has refreshed its metadata cache.
const savedFields=new Map();
const sourceCache=new Map();
let clockPrefs={...(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(HOME))?.frontmatter||{})},clockNodes=null,lastClock='';
const excluded=/(^|\/)(node_modules|\.git|\.obsidian|\.trash|outputs?|work|dist|build|__pycache__|\.venv|venv|site-packages|90-历史版本|修订前备份|原始项目|原始源码|源码|代码|会话交接|Users|工作任务草稿)(\/|$)/i;
function usable(f) {return !excluded.test(f.path)&&!['AGENTS','CLAUDE','SKILL','README','CHANGELOG'].includes(f.basename)&&!f.basename.startsWith('~$');}
function notes() {return app.vault.getMarkdownFiles().filter(usable);}
function fm(f) {
  const data=app.metadataCache.getFileCache(f)?.frontmatter||{};
  const saved=savedFields.get(f.path);
  if(!saved)return data;
  if(Object.entries(saved).every(([key,value])=>Array.isArray(value)?JSON.stringify(data[key])===JSON.stringify(value):data[key]===value)){
    savedFields.delete(f.path);
    return data;
  }
  return {...data,...saved};
}
function name(f) {return fm(f).title||(['📂 索引','说明'].includes(f.basename)?(fm(f).project||f.parent.name):f.basename);}
function pinned() {return fm(app.vault.getAbstractFileByPath(HOME)).focus_projects||[];}
function recentSort(a,b) {return b.stat.mtime-a.stat.mtime;}
function taskActivity(f) {
  const brief=app.vault.getAbstractFileByPath(f.parent.path+'/说明.md');
  return Math.max(f.stat.mtime,brief?.stat?.mtime||0);
}
function projectStatus(f,data=fm(f)) {
  const status=String(data.status??'').trim();
  if(status&&status!=='未标注')return status;
  return status || '未标注';
}
function date(ms,full=false) {return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:full?'numeric':undefined,month:'2-digit',day:'2-digit'}).format(ms);}
function projectFiles() {return notes().filter(f=>{
  if(fm(f).type==='work-task')return true;
  if(f.basename==='📂 索引'&&/^(10-客户资料|20-项目归档|30-近期工作|70-会议交流)\/[^/]+\/📂 索引\.md$/.test(f.path))return true;
  return f.basename==='说明'&&/^(10-客户资料|20-项目归档|30-近期工作|40-团队工作|70-会议交流)\//.test(f.path)&&!app.vault.getAbstractFileByPath(f.parent.path+'/📂 索引.md');
}).sort(recentSort);}
function meetings() {return notes().filter(f=>f.path.startsWith('50-会议纪要/')&&f.basename!=='📂 索引'||/^70-会议交流\/[^/]+\/📂 索引\.md$/.test(f.path)).sort(recentSort);}
function weekly() {return notes().filter(f=>f.path.startsWith('40-团队工作/工作汇报/周报/')&&/\d{4}-W\d+/.test(f.basename)).sort((a,b)=>b.basename.localeCompare(a.basename,undefined,{numeric:true}));}
function logs() {return notes().filter(f=>f.path.startsWith('40-团队工作/工作记录/')).sort(recentSort);}
function tagText(f) {const t=fm(f).tags;return Array.isArray(t)?t.join(' '):String(t||'');}
function match(f) {return `${name(f)} ${f.path} ${fm(f).client||''} ${tagText(f)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());}
function el(p,t,text='',cls='') {return p.createEl(t,{text:String(text),cls});}
function button(p,text,fn,cls='') {
  const b=el(p,'button',text,cls);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){new Notice(e.message);console.error('[售前工作台]',e);}finally{b.disabled=false;}});return b;
}
function link(p,text,path,cls='') {
  const a=el(p,'a',text,cls);a.href='obsidian://open?vault='+encodeURIComponent(app.vault.getName())+'&file='+encodeURIComponent(path);a.title=path;
  a.addEventListener('click',e=>{e.preventDefault();actions.open(app,path,e.metaKey||e.ctrlKey).catch(err=>new Notice(err.message));});return a;
}
function heading(p,text,hint='') {const h=el(p,'div','','pwb-section-head');el(h,'h2',text);if(hint)el(h,'span',hint,'pwb-muted');return h;}
function empty(p,text) {el(p,'p',text,'pwb-empty');}
function switchTab(tab,target='') {current=tab;folder=target;sessionStorage.setItem('presales-workbench-tab',tab);render();}
function shelf(p,title,desc,tab,target) {const b=button(p,'',()=>switchTab(tab,target),'pwb-shelf');el(b,'strong',title);el(b,'span',desc);return b;}
function documentRows(p,list,limit=8) {
  if(!list.length){empty(p,'这里还没有记录。可以从上方新建，或选择其他目录。');return;}
  const rows=el(p,'div','','pwb-docs');
  for(const f of list.slice(0,limit)) {
    const row=el(rows,'div','','pwb-doc');
    const text=el(row,'div');link(text,name(f),f.path);el(text,'small',f.path.split('/').slice(0,-1).join(' / '),'pwb-muted');
    el(row,'span',f.extension==='md'?date(f.stat.mtime):f.extension.toUpperCase(),'pwb-date');
  }
  if(list.length>limit&&limit===searchLimit)button(p,`再显示 ${Math.min(40,list.length-limit)} 条`,()=>{searchLimit+=40;render();},'pwb-more');
}
function taskStatusControl(p,f,status,hint) {
  const select=el(p,'select','','pwb-task-status'+(status==='已完成'?' is-done':''));
  select.setAttribute('aria-label',`${name(f)}的工作状态`);
  if(hint)select.title=hint;
  for(const value of actions.projectStatusOptions(status))select.createEl('option',{text:value,value});
  select.value=status;
  select.addEventListener('change',async()=>{
    const next=select.value;
    select.disabled=true;
    try{
      await actions.saveProjectProgress(app,f,{status:next});
    }catch(e){
      select.value=status;
      new Notice('工作状态保存失败：'+e.message);
      return;
    }finally{select.disabled=false;}
    savedFields.set(f.path,{...savedFields.get(f.path),status:next});
    render();
    new Notice(next==='已完成'?'已标记为完成，可在「已完成」中查看。':'工作状态已更新');
  });
}
function projectRows(p,list,limit=20,{recent=false}={}) {
  if(!list.length){empty(p,'没有符合条件的项目。');return;}
  const rows=el(p,'div','','pwb-projects');const focus=pinned();
  for(const f of list.slice(0,limit)) {
    const data=fm(f);const status=projectStatus(f,data);
    const hint=status==='已完成'&&String(data.status??'').trim()!=='已完成'?legacyCompletionHint:'';
    const row=el(rows,'article','','pwb-project');
    const top=el(row,'div','','pwb-project-top');
    const star=button(top,focus.includes(f.path)?'★':'☆',async()=>{
      const focusProjects=await actions.toggleFocus(app,f.path);
      savedFields.set(HOME,{focus_projects:focusProjects});
      render();
    },'pwb-star');star.title=focus.includes(f.path)?'取消关注':'关注项目';star.setAttribute('aria-label',star.title+'：'+name(f));star.setAttribute('aria-pressed',String(focus.includes(f.path)));
    link(top,name(f),f.path,'pwb-project-title');
    if(recent)taskStatusControl(top,f,status||'未标注',hint);
    else if(status){const badge=el(top,'span',status,'pwb-badge'+(['已完成','已归档'].includes(status)?' is-done':''));if(hint)badge.title=hint;}
    const meta=el(row,'div','','pwb-project-meta');el(meta,'span',data.client||f.path.split('/')[0].replace(/^\d+-/,''));if(data.stage)el(meta,'span',data.stage);el(meta,'span',recent?'更新 '+date(taskActivity(f)):'索引更新 '+date(f.stat.mtime));
    const next=el(row,'div','','pwb-next');el(next,'span',data.next_action||'打开索引，查看当前采用材料与最近记录。');
    const ops=el(row,'div','','pwb-project-ops');if(app.vault.getAbstractFileByPath(f.parent.path+'/说明.md'))button(ops,'开始 / 继续工作',()=>actions.openWork(app,f.parent.path,{autostart:true}),'pwb-text-button');button(ops,'整理文件',()=>actions.openOrganizer(app,f.parent.path),'pwb-text-button');button(ops,'更新进展',async()=>{
      const data=await actions.updateProgress(app,f);
      if(data){savedFields.set(f.path,data);render();}
    },'pwb-text-button');button(ops,'补充要求',()=>actions.openIntake(app,{mode:'append',targetFolder:f.parent.path}),'pwb-text-button');button(ops,'复制协作任务',()=>actions.copyTask(app,f,'project'),'pwb-text-button');
  }
  if(list.length>limit&&limit===searchLimit)button(p,`显示更多项目（还有 ${list.length-limit} 个）`,()=>{searchLimit+=40;render();},'pwb-more');
}
function recentWork(p,projects) {
  const head=heading(p,'最近工作');
  button(head,'全部工作',()=>{clientFilter='全部';searchLimit=60;switchTab('项目推进');},'pwb-text-button');
  const filters=el(p,'div','','pwb-filters pwb-recent-filters');
  filters.setAttribute('role','group');filters.setAttribute('aria-label','按工作状态筛选');
  for(const label of recentFilters){
    const active=recentFilter===label;
    const tab=button(filters,label,()=>{recentFilter=label;sessionStorage.setItem(recentFilterKey,label);render();},active?'is-active':'');
    tab.setAttribute('aria-pressed',String(active));
  }
  const focus=recentFilter==='已关注'?new Set(pinned()):null;
  const list=projects.filter(f=>{
    if(focus)return focus.has(f.path);
    if(recentFilter==='全部')return true;
    const status=projectStatus(f);
    if(recentFilter==='已完成')return status==='已完成';
    return !['已完成','已归档'].includes(status);
  }).sort((a,b)=>taskActivity(b)-taskActivity(a)||recentSort(a,b));
  if(list.length)projectRows(p,list,focus?list.length:6,{recent:true});
  else if(focus)empty(p,'还没有关注的工作。点击任务卡片上的星标即可加入。');
  else empty(p,recentFilter==='全部'?'还没有工作记录。':`目前没有${recentFilter}的工作。`);
}
function browse(p,path) {
  const crumbs=el(p,'div','','pwb-breadcrumb');button(crumbs,'返回分区',()=>{folder='';render();},'pwb-text-button');el(crumbs,'span',path.replaceAll('/',' / '));
  const prefix=path+'/';const files=app.vault.getFiles().filter(f=>usable(f)&&f.path.startsWith(prefix)&&['md','pdf','pptx','docx','xlsx','base','canvas'].includes(f.extension));
  const subfolders=[...new Set(files.map(f=>f.path.slice(prefix.length).split('/')).filter(a=>a.length>1).map(a=>a[0]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const grid=el(p,'div','','pwb-folder-grid');for(const sub of subfolders)shelf(grid,sub,'打开目录',current,prefix+sub);
  const direct=files.filter(f=>!f.path.slice(prefix.length).includes('/')).sort(recentSort);
  if(direct.length){heading(p,'目录内材料',`${direct.length} 份`);documentRows(p,direct,searchLimit);}else if(!subfolders.length)empty(p,'这个目录还没有可展示的笔记或文档。');
}
const header=el(root,'header','','pwb-header');const brand=el(header,'div','','pwb-brand');const logo=el(brand,'img','','pwb-logo');logo.src=app.vault.adapter.getResourcePath('90-其他/工作台/assets/workbench-mark.svg');logo.alt='Presales Workbench';el(brand,'strong','售前工作台');
const utilities=el(header,'div','','pwb-utilities');link(utilities,'使用指南','_MOC/工作台使用指南.md');button(utilities,'AI 协作面板',()=>actions.openCodex(app),'pwb-text-button pwb-ai-button');
const navigation=el(root,'div','','pwb-navigation');const nav=el(navigation,'nav','','pwb-nav');nav.setAttribute('aria-label','工作台分区');const navs=new Map();for(const tab of tabs)navs.set(tab,button(nav,tab,()=>{query='';search.value='';searchLimit=60;switchTab(tab);},'pwb-nav-button'));
const searchBar=el(navigation,'div','','pwb-searchbar');const search=el(searchBar,'input');search.type='search';search.placeholder='搜索笔记、客户、项目或标签';search.setAttribute('aria-label',search.placeholder);let debounce;search.oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{query=search.value.trim();searchLimit=60;render();},120);};
button(searchBar,'搜索全文',()=>{const plugin=app.internalPlugins.plugins['global-search']?.instance;if(!plugin)throw new Error('请启用 Obsidian 搜索');plugin.openGlobalSearch(search.value);},'pwb-text-button');
const main=el(root,'main','','pwb-main');
function tickClock(){
  if(!clockNodes?.band.isConnected)return;const data=clock(clockPrefs,new Date(),holidayData),key=JSON.stringify(data);if(key===lastClock)return;lastClock=key;
  clockNodes.date.textContent=data.date;
  for(const [name,entry]of [['work',data.work],['weekend',data.weekend],['rest',data.rest]]){const node=clockNodes[name];node.label.textContent=entry.label;node.value.empty();if(entry.parts){for(const p of entry.parts){el(node.value,'strong',p.value);el(node.value,'span',p.unit);}}else el(node.value,'strong',entry.text,'is-resting');node.note.textContent=name==='rest'?'':entry.note;node.note.hidden=name==='rest'||!entry.note;}
}
async function refreshCalendar(){try{holidayData=await calendar.refresh(app);if(root.isConnected){lastClock='';tickClock();}}catch(e){console.warn('[工作台日历]',e.message);}}
function countdown(p){
  const band=el(p,'section','','pwb-countdown');band.setAttribute('aria-label','下班与休息倒计时');const top=el(band,'div','','pwb-daybar');const date=el(top,'span');
  button(top,'倒计时设置',async()=>{const next=await actions.clockSettings(app);if(next){clockPrefs={...clockPrefs,...next};lastClock='';tickClock();}},'pwb-text-button');
  const grid=el(band,'div','','pwb-clock-grid');clockNodes={band,date};
  for(const [name,tag]of [['work','h1'],['weekend','h2'],['rest','h2']]){const area=el(grid,'div','','pwb-clock');area.dataset.clock=name;clockNodes[name]={label:el(area,tag,'','pwb-clock-label'),value:el(area,'div','','pwb-clock-value'),note:el(area,'p','','pwb-clock-note')};}
  lastClock='';tickClock();
}
async function weeklyPreview(p,f) {
  if(!f){empty(p,'还没有周报记录。');return;}
  link(p,f.basename,f.path,'pwb-weekly-title');
  const preview=el(p,'p','读取本期周报…','pwb-weekly-preview');
  const tools=el(p,'div','','pwb-inline-actions');button(tools,'撰写周报',()=>actions.openWeekly(app),'pwb-text-button');button(tools,'查看周报',()=>actions.open(app,f.path),'pwb-text-button');button(tools,'复制整理任务',()=>actions.copyTask(app,f,'weekly'),'pwb-text-button');
  try {let content=sourceCache.get(f.path);if(!content){content=await app.vault.cachedRead(f);sourceCache.set(f.path,content);}
    const raw=content.replace(/^---[\s\S]*?---\s*/,'').split(/以下为归纳版本/)[0].split('\n').filter(l=>/^\s*(\d+[、.．]|- )/.test(l)).slice(0,3).map(l=>l.replace(/^\s*(\d+[、.．]|- )/,'').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,a,b)=>b||a).replace(/\*\*/g,''));
    preview.textContent=raw.length?raw.join('\n'):'打开周报查看本周记录。';
  }catch {preview.textContent='打开周报查看本周记录。';}
}
function render() {
  main.empty();clockNodes=null;for(const [t,b] of navs){b.classList.toggle('is-active',t===current);b.setAttribute('aria-current',t===current?'page':'false');}
  if(query){heading(main,'搜索结果','匹配标题、路径、客户与标签');const result=notes().filter(f=>f.path!==HOME&&match(f)).sort(recentSort);el(main,'p',`找到 ${result.length} 篇笔记`,'pwb-muted');documentRows(main,result,searchLimit);return;}
  if(folder){heading(main,folder.split('/').at(-1));browse(main,folder);return;}
  if(current==='工作总览') {
    countdown(main);
    const quickbar=el(main,'div','','pwb-quickbar');const ctas=el(quickbar,'div','','pwb-actions');button(ctas,'＋ 接一项工作',()=>actions.openIntake(app),'pwb-primary');button(ctas,'记一条工作',()=>actions.createRecord(app,'log'),'pwb-secondary');
    const projects=projectFiles();
    const summary=el(quickbar,'div','','pwb-summary');for(const [label,num,tab] of [['项工作',projects.length,'项目推进'],['次交流',meetings().length,'会议交流'],['份周报',weekly().length,'周报复盘']]){const b=button(summary,'',()=>switchTab(tab),'pwb-summary-item');el(b,'strong',num);el(b,'span',label);}
    const columns=el(main,'div','','pwb-columns');recentWork(el(columns,'section'),projects);
    const right=el(columns,'aside','','pwb-aside');heading(right,'最近一份周报');weeklyPreview(right,weekly()[0]);heading(right,'最近交流');documentRows(right,meetings(),3);
    heading(main,'常用工作入口');const shelves=el(main,'div','','pwb-shelves');shelf(shelves,'产品与解决方案','产品、通用方案与交流材料','材料库','40-团队工作/解决方案');shelf(shelves,'客户档案','客户资料与历史项目','项目推进');shelf(shelves,'技术与行业研究','技术趋势、行业与竞品','调研学习');shelf(shelves,'工作记录','随手记下进展，周报时再归纳','周报复盘','40-团队工作/工作记录');
    heading(main,'最近修改的工作笔记','按文件修改时间排序');documentRows(main,notes().filter(f=>/^(10-|20-|30-|40-|50-|70-)/.test(f.path)&&f.basename!=='📂 索引'&&!/^\d{4}-W/.test(f.basename)).sort(recentSort),5);
  } else if(current==='项目推进') {
    const head=heading(main,'项目推进','项目、申报与会议材料的工作入口');button(head,'整理项目',()=>actions.openOrganizer(app),'pwb-secondary');button(head,'＋ 接一项工作',()=>actions.openIntake(app),'pwb-primary');
    const filters=el(main,'div','','pwb-filters');for(const label of ['全部','已关注','客户资料','项目归档','近期工作','公司工作','会议材料'])button(filters,label,()=>{clientFilter=label;render();},clientFilter===label?'is-active':'');
    const list=projectFiles().filter(f=>clientFilter==='全部'||clientFilter==='已关注'&&pinned().includes(f.path)||clientFilter==='客户资料'&&f.path.startsWith('10-')||clientFilter==='项目归档'&&f.path.startsWith('20-')||clientFilter==='近期工作'&&f.path.startsWith('30-')||clientFilter==='公司工作'&&f.path.startsWith('40-')||clientFilter==='会议材料'&&f.path.startsWith('70-'));
    el(main,'p','进展读取项目属性。'+legacyCompletionHint+'可通过“更新进展”设置实际状态。','pwb-muted');projectRows(main,list,searchLimit);
  } else if(current==='材料库') {
    heading(main,'材料库','按准备材料时的用途进入');const shelves=el(main,'div','','pwb-shelves');
    for(const [title,desc,path] of [['产品与解决方案','通用方案、产品PPT与讲稿','40-团队工作/解决方案'],['对外交流材料','团队介绍、产品与演示资料','40-团队工作/对外交流材料'],['公司与申报资料','公司信息、资质与各类申报材料','40-团队工作'],['客户资料','客户背景与业务资料','10-客户资料'],['项目归档','已归档项目与交付记录','20-项目归档'],['收件箱','待分类笔记与新材料','00-Inbox']])shelf(shelves,title,desc,current,path);
    heading(main,'知识地图');const anchors=el(main,'div','','pwb-link-list');for(const [title,path] of [['产品与解决方案','_MOC/产品与解决方案.md'],['客户交流方法','_MOC/客户交流方法.md'],['项目交付方法','_MOC/项目交付方法.md']])link(anchors,title,path);
  } else if(current==='会议交流') {
    const h=heading(main,'会议与客户交流','正式纪要、交流准备与会后记录');button(h,'＋ 准备会议材料',()=>actions.openIntake(app,{category:'会议材料',parent:'70-会议交流'}),'pwb-primary');button(h,'记会议交流',()=>actions.createRecord(app,'meeting'),'pwb-text-button');const shelves=el(main,'div','','pwb-shelves');shelf(shelves,'正式会议纪要','按年份保留的正式记录',current,'50-会议纪要');shelf(shelves,'对外交流与研讨','交流材料、讲稿与反馈',current,'70-会议交流');heading(main,'最近记录');documentRows(main,meetings(),searchLimit);
  } else if(current==='周报复盘') {
    const h=heading(main,'周报与工作复盘','选入候选、勾选工作，再核对周报初稿');button(h,'撰写周报',()=>actions.openWeekly(app),'pwb-primary');actions.weeklyPanel(app,main);const columns=el(main,'div','','pwb-columns');const left=el(columns,'section');heading(left,'历次周报');documentRows(left,weekly(),searchLimit);const right=el(columns,'aside','','pwb-aside');heading(right,'最近工作记录');documentRows(right,logs(),8);const shelves=el(main,'div','','pwb-shelves');shelf(shelves,'季度与阶段汇报','述职、半年总结与绩效资料',current,'40-团队工作/工作汇报');shelf(shelves,'全部工作记录','整理本周进度时回看',current,'40-团队工作/工作记录');
  } else if(current==='调研学习') {
    heading(main,'调研与学习','与售前工作相连的技术、行业与产品研究');const shelves=el(main,'div','','pwb-shelves');for(const [title,desc,path] of [['AI 与前沿','大模型、智能体与技术趋势','60-调研学习/10-AI与前沿'],['行业研究','行业政策、应用场景与客户需求','60-调研学习/20-行业研究'],['网络与通信','SDN、确定性网络与 RDMA','60-调研学习/30-网络与通信'],['产品与技术','产品原理与技术积累','60-调研学习/40-产品与技术'],['竞品公司','公司画像、产品与竞争分析','60-调研学习/50-竞品公司'],['热门项目与行业动态','开源项目、Skill 与开发者动态','60-调研学习/80-热门项目']])shelf(shelves,title,desc,current,path);
    const links=el(main,'div','','pwb-link-list');link(links,'学习知识库地图','60-调研学习/_MOC/首页.md');
    heading(main,'最近更新的学习笔记');documentRows(main,notes().filter(f=>f.path.startsWith('60-调研学习/')&&!f.path.includes('/_MOC/')&&f.basename!=='📂 索引').sort(recentSort),8);
  }
}
render();
refreshCalendar();
const clockTimer=window.setInterval(()=>{if(!root.isConnected)window.clearInterval(clockTimer);else{tickClock();if(Date.now()-lastCalendarCheck>3600000){lastCalendarCheck=Date.now();refreshCalendar();}}},1000);
if(dv.component?.registerInterval)dv.component.registerInterval(clockTimer);
