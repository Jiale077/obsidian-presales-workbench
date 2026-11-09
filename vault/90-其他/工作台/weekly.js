const fs=require('fs'),path=require('path'),crypto=require('crypto');
const REPORTS='40-团队工作/工作汇报/周报';
const CATEGORIES=['项目交付','方案撰写','售前交流','品牌宣传','其他工作'];
const DAY=86400000;
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function defaults(){const d=new Date(today()+'T00:00:00Z'),offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset);return {start:d.toISOString().slice(0,10),end:new Date(+d+5*DAY).toISOString().slice(0,10)};}
function validPeriod(p){if(!p||!/^\d{4}-\d{2}-\d{2}$/.test(p.start)||!/^\d{4}-\d{2}-\d{2}$/.test(p.end))throw Error('请选择有效的汇报日期。');const a=Date.parse(p.start),b=Date.parse(p.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>31*DAY||new Date(a).toISOString().slice(0,10)!==p.start||new Date(b).toISOString().slice(0,10)!==p.end)throw Error('汇报周期应在1至31天之间。');return p;}
function context(app,period=defaults()){validPeriod(period);const base=fs.realpathSync(app.vault.adapter.getBasePath()),dir=path.join(base,'90-其他/工作台/.weekly',period.start+'_'+period.end);fs.mkdirSync(dir,{recursive:true});return {base,dir,period};}
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomBytes(3).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);}
function feed(app,p){const c=context(app,p);return read(path.join(c.dir,'feed.json'),{items:[],warnings:[],period:p});}
function candidates(app,p){return read(path.join(context(app,p).dir,'candidates.json'),[]);}
function setCandidates(app,p,items){write(path.join(context(app,p).dir,'candidates.json'),items);}
function addCandidate(app,p,item){const list=candidates(app,p);if(!list.some(i=>i.id===item.id)){list.push({...item,checked:true,added_at:new Date().toISOString()});setCandidates(app,p,list);}return list;}
function organizationFile(app){return path.join(app.vault.adapter.getBasePath(),'90-其他/工作台/.weekly/organization.json');}
function organization(app){return read(organizationFile(app),{projects:{}});}
function placements(app,p){return read(path.join(context(app,p).dir,'placements.json'),{});}
function categoryFor(item){
  const text=item.project||item.manual_project||item.title||'';
  if(/品牌|宣传|公众号|推文|海报|宣传片|产品发布|展会/.test(text))return '品牌宣传';
  if(/交付|验收|部署|实施|投标|招标/.test(text))return '项目交付';
  if(/方案|申报|可研|PPT|汇报|预算|指南|科技研究|科技项目/.test(text))return '方案撰写';
  if(/会议|交流|拜访|调研|研讨|纪要|接待/.test(text)||/^50-|^70-/.test(text))return '售前交流';
  return '其他工作';
}
function projectName(key){return (String(key).split('/').at(-1)||'未指定项目').replace(/[-－]\d{1,2}\.\d{1,2}$/, '').replace(/[-－]/g,' · ');}
function resolved(app,p,items){
  const org=organization(app),overrides=placements(app,p);
  return items.map(item=>{const own=overrides[item.id]||{},key=own.project_key||item.project||item.manual_project_key||'unassigned',project=org.projects?.[key]||{};
    return {...item,report_category:own.category||project.category||item.category||categoryFor(item),report_project:own.project_name||project.name||item.manual_project||projectName(key),report_project_key:key,report_title:own.title||item.title};});
}
function grouped(app,p,items){
  const categories=new Map(CATEGORIES.map(name=>[name,{name,projects:[],count:0,checked:0}]));
  for(const item of resolved(app,p,items)){const category=categories.get(item.report_category)||categories.get('其他工作');let project=category.projects.find(g=>g.key===item.report_project_key&&g.name===item.report_project);
    if(!project){project={key:item.report_project_key,name:item.report_project,items:[],checked:0};category.projects.push(project);}project.items.push(item);category.count++;if(item.checked!==false){project.checked++;category.checked++;}}
  return [...categories.values()];
}
function updateProject(app,key,data){
  if(!key||!String(data.name||'').trim()||!CATEGORIES.includes(data.category))throw Error('请填写项目名称并选择工作类别。');
  const org=organization(app);org.projects||={};org.projects[key]={name:data.name.trim().slice(0,120),category:data.category};write(organizationFile(app),org);
}
function updatePlacement(app,p,id,data){
  if(!id||!String(data.project_name||'').trim()||!CATEGORIES.includes(data.category))throw Error('请填写项目名称并选择工作类别。');
  const all=placements(app,p);all[id]={category:data.category,project_key:data.project_key||'named:'+data.project_name.trim(),project_name:data.project_name.trim().slice(0,120),title:String(data.title||'').trim().slice(0,160)};write(path.join(context(app,p).dir,'placements.json'),all);
}
function draft(app,p){return read(path.join(context(app,p).dir,'draft.json'),{notes:'',next_plan:'',markdown:''});}
function saveDraft(app,p,data){write(path.join(context(app,p).dir,'draft.json'),data);}
function active(s){return ['queued','running'].includes(s?.status);}
function state(app,p,mode){const c=context(app,p),meta=read(path.join(c.dir,'jobs.json'));const id=meta[mode];if(!id)return null;const job=path.join(c.dir,'jobs',id),s=read(path.join(job,'state.json'));const pid=s.pid||read(path.join(job,'pid.json')).pid;if(active(s)&&pid){try{process.kill(pid,0);}catch{s.status='failed';s.detail='处理进程已退出，请重试；原候选和初稿保留。';}}else if(active(s)&&Date.now()-(s.queued_at||0)>30000){s.status='failed';s.detail='启动未完成，请重试。';}return {...s,id,job};}
function suggestedTitle(app,p){
  const dir=path.join(app.vault.adapter.getBasePath(),REPORTS),year=+p.end.slice(0,4),target=Date.parse(p.end);let best=null;
  for(const file of fs.readdirSync(dir)){const m=/^(\d{4})-W(\d+)（(\d+)\.(\d+)）\.md$/.exec(file);if(!m)continue;const at=Date.UTC(+m[1],+m[3]-1,+m[4]);if(at===target)return file.slice(0,-3);if(+m[1]===year&&at<target&&(!best||at>best.at))best={at,week:+m[2]};}
  const number=best?best.week+Math.max(1,Math.round((target-best.at)/(7*DAY))):Math.ceil((target-Date.UTC(year,0,1)+DAY)/(7*DAY));
  const d=new Date(target);return `${year}-W${String(number).padStart(2,'0')}（${d.getUTCMonth()+1}.${d.getUTCDate()}）`;
}
async function start(app,p,mode){
  const c=context(app,p);const old=state(app,p,mode);if(active(old))return old;
  const selected=candidates(app,p).filter(i=>i.checked!==false);if(mode==='generate'&&!selected.length)throw Error('请先用“＋”加入候选，再勾选要写进周报的工作。');
  const d=draft(app,p),current=feed(app,p),items=resolved(app,p,selected.map(i=>({...i,...current.items.find(x=>x.id===i.id)})));
  const id=mode+'-'+Date.now().toString(36)+'-'+crypto.randomBytes(3).toString('hex'),job=path.join(c.dir,'jobs',id);fs.mkdirSync(job,{recursive:true});
  write(path.join(job,'request.json'),{vault:c.base,period:p,mode,selected:items,notes:d.notes||'',next_plan:d.next_plan||''});
  write(path.join(job,'state.json'),{status:'queued',queued_at:Date.now(),phase:mode==='scan'?'正在查找本周工作':'正在准备周报初稿'});
  const meta=read(path.join(c.dir,'jobs.json'));write(path.join(c.dir,'jobs.json'),{...meta,[mode]:id});
  if(mode==='generate'){if(d.markdown)write(path.join(c.dir,'history',id+'.json'),d);d.job_id=id;saveDraft(app,p,d);}
  const python=require('./runtime.js').executable('python'),log=fs.openSync(path.join(job,'worker.log'),'a');
  try{const child=require('child_process').spawn(python,[path.join(c.base,'90-其他/工作台/weekly_report_worker.py'),path.join(job,'request.json')],{cwd:job,detached:true,stdio:['ignore',log,log],env:require('./runtime.js').environment(python)});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();write(path.join(job,'pid.json'),{pid:child.pid});}
  catch(e){write(path.join(job,'state.json'),{status:'failed',phase:'未能启动处理',detail:e.message});throw e;}finally{fs.closeSync(log);}
  return state(app,p,mode);
}
function receive(app,p){const s=state(app,p,'generate'),d=draft(app,p);if(s?.status!=='completed'||d.job_id!==s.id||d.received_id===s.id)return d;const r=read(path.join(s.job,'result.json'));d.markdown=r.markdown;d.result=r;d.received_id=s.id;d.updated_at=new Date().toISOString();saveDraft(app,p,d);return d;}
function stop(app,p,mode){const s=state(app,p,mode);if(s)fs.writeFileSync(path.join(s.job,'stop'),'stop');}
function reportPath(title){const name=String(title).replace(/\.md$/,'').trim();if(!name||/[\\/\n\r]|^\./.test(name)||name.length>100)throw Error('请填写有效的周报名称。');return REPORTS+'/'+name+'.md';}
async function saveReport(app,p,title){
  const d=draft(app,p);if(!d.markdown?.trim())throw Error('请先生成或填写周报初稿。');const target=reportPath(title),hash=crypto.createHash('sha256').update(d.markdown).digest('hex');if(d.saved_hash===hash&&d.saved_path===target)return target;
  const items=resolved(app,p,candidates(app,p).filter(i=>i.checked!==false)),raw=items.map((i,n)=>`${n+1}、【${i.report_category} / ${i.report_project}】${i.report_title}${i.manual_text?'：'+i.manual_text:''}`).join('\n');
  const appendix='## 本周原始记录\n\n'+raw+(d.notes?'\n\n### 原始补充\n\n'+d.notes:'')+(d.next_plan?'\n\n### 原始下周计划\n\n'+d.next_plan:'');
  const body=appendix+'\n\n以下为归纳版本：\n\n'+d.markdown.trim()+'\n';
  const old=app.vault.getAbstractFileByPath(target);
  if(old){const addition='\n\n---\n\n## 工作台补充初稿 · '+today()+'\n\n'+body;if(app.vault.process)await app.vault.process(old,text=>text+addition);else fs.appendFileSync(path.join(app.vault.adapter.getBasePath(),target),addition);}
  else{const fm={title,type:'weekly-report',tags:['周报'],created:today(),period_start:p.start,period_end:p.end,status:'已核对初稿'};await app.vault.create(target,'---\n'+Object.entries(fm).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')+'\n---\n\n'+body);}
  d.saved_hash=hash;d.saved_path=target;saveDraft(app,p,d);return target;
}
module.exports={CATEGORIES,defaults,context,feed,candidates,setCandidates,addCandidate,organization,placements,resolved,grouped,updateProject,updatePlacement,draft,saveDraft,active,state,suggestedTitle,start,receive,stop,reportPath,saveReport};
