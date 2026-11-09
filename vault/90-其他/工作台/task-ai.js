const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const store=require('./task-store.js');
const INPUT_FIELDS=['title','client','raw_messages','background','first_action','deliverable','constraints','deadline','extra_notes'];
function inputFields(d) {return Object.fromEntries(INPUT_FIELDS.map(key=>[key,d[key]||'']));}
function fingerprint(d) {return crypto.createHash('sha256').update(JSON.stringify({fields:INPUT_FIELDS.map(k=>d[k]||''),assets:d.assets.filter(a=>!a.is_ai_generated).map(a=>[a.id,a.storage_path,a.role,a.note]),references:d.references.map(r=>[r.path,r.role,r.note])})).digest('hex');}
function hasContent(d) {return !!(d.raw_messages?.trim()||d.background?.trim()||d.assets.some(a=>!a.is_ai_generated)||d.references.length);}
function rootPath(app) {return app.vault.adapter.getBasePath();}
function running(state) {return ['queued','running'].includes(state?.status);}
function jobPath(d) {return d.ai?.revision?.jobPath||d.ai?.jobPath;}
async function getState(app,d) {
  const job=jobPath(d);
  if(!job)return null;
  try{
    const state=JSON.parse(await app.vault.adapter.read(job+'/state.json'));
    if(running(state)&&state.pid){
      try{process.kill(state.pid,0);}
      catch{return {...state,status:'failed',phase:'后台处理未完成',detail:'本机处理进程已退出，草稿已保留。'};}
    }
    if(state.status==='queued'&&state.queuedAt&&Date.now()-state.queuedAt>60000)return {status:'failed',phase:'后台未能启动',detail:'草稿已保留，可重试。'};
    return state;
  }catch{return {status:'failed',phase:'无法读取处理状态',detail:'草稿已保留，可重试。'};}
}
function newJob(d) {
  const jobId=Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
  return {jobId,jobPath:store.draftFolder(d)+'/AI整理/'+jobId};
}
async function launch(app,d,job,nextAI,request,detail) {
  const base=rootPath(app);const python=require('./runtime.js').executable('python');
  const {jobPath}=job;
  for(const p of [store.draftFolder(d),store.draftFolder(d)+'/AI整理',jobPath])if(!await app.vault.adapter.exists(p))await app.vault.createFolder(p);
  await app.vault.adapter.write(jobPath+'/request.json',JSON.stringify({vault:base,...request}));
  await app.vault.adapter.write(jobPath+'/state.json',JSON.stringify({status:'queued',phase:'准备启动',detail,queuedAt:Date.now()}));
  const previous=d.ai;
  d.ai=nextAI;
  try{await store.saveDraft(app,d);}catch(e){d.ai=previous;throw e;}
  let log;
  try{
    log=fs.openSync(path.join(base,jobPath,'worker.log'),'a');
    const child=require('child_process').spawn(python,[path.join(base,'90-其他/工作台/intake_ai_worker.py'),path.join(base,jobPath,'request.json')],{cwd:path.join(base,jobPath),detached:true,stdio:['ignore',log,log],env:require('./runtime.js').environment(python)});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  }catch(e){
    await app.vault.adapter.write(jobPath+'/state.json',JSON.stringify({status:'failed',phase:'后台未能启动',detail:e.message}));
  }finally{if(log!==undefined)fs.closeSync(log);}
  return getState(app,d);
}
async function start(app,d,{readDocuments=true,audioProvider='local'}={}) {
  if(!hasContent(d))throw new Error('请先加入截图、录音、资料，或填写领导消息与背景。');
  const old=await getState(app,d);
  if(running(old))return old;
  const job=newJob(d);
  return launch(app,d,job,{...job,inputFingerprint:fingerprint(d),approved:false,readDocuments,audioProvider},{draft:{...inputFields(d),assets:d.assets,references:d.references},read_documents:readDocuments,audio_provider:audioProvider},'正在启动识图与转录');
}
function reviewMarkdown(d) {return d.ai?.reviewedMarkdown??d.ai?.result?.result?.review_markdown??'';}
function reviewSnapshot(d) {
  const {title,client,pending_questions}=d.ai.result.result;
  return {review_markdown:reviewMarkdown(d),title,client,pending_questions};
}
async function revise(app,d,instruction) {
  if(!d.ai?.result||!reviewMarkdown(d).trim())throw new Error('请先准备一份可修改的说明草稿。');
  if(!instruction.trim())throw new Error('请先填写希望 AI 怎么改。');
  const old=await getState(app,d);
  if(running(old))return old;
  const job=newJob(d);
  const data=d.ai.result;
  const review=reviewSnapshot(d);
  const revision={...job,baseHash:crypto.createHash('sha256').update(review.review_markdown).digest('hex')};
  const request={draft:inputFields(d),revision:{instruction:instruction.trim(),review,source_job_id:d.ai.jobId,sources:data.sources,image_texts:data.result.image_texts||[]}};
  return launch(app,d,job,{...d.ai,revision,revisionNotes:instruction},request,'正在准备修改说明');
}
async function stop(app,d) {const job=jobPath(d);if(job)await app.vault.adapter.write(job+'/stop','stop');}
function replaceReview(ai,review) {
  return {...ai,result:{...ai.result,result:{...ai.result.result,...review}},reviewedMarkdown:review.review_markdown,approved:false};
}
function undoRevision(d) {
  if(!d.ai?.previousReview)return;
  d.ai=replaceReview(d.ai,d.ai.previousReview);
  delete d.ai.previousReview;
  delete d.ai.revision;
}
async function receiveRevision(app,d) {
  const pending=d.ai.revision;
  const before=reviewSnapshot(d);
  if(crypto.createHash('sha256').update(before.review_markdown).digest('hex')!==pending.baseHash)throw new Error('修改期间底稿已变动，当前正文已保留，请按最新正文重新提交。');
  const {review_markdown,title,client,pending_questions}=JSON.parse(await app.vault.adapter.read(pending.jobPath+'/result.json'));
  if(typeof review_markdown!=='string'||!review_markdown.trim()||typeof title!=='string'||typeof client!=='string'||!Array.isArray(pending_questions))throw new Error('AI 没有返回可用的修改稿，原草稿已保留。');
  const review={review_markdown,title,client,pending_questions};
  const revised={...d,ai:replaceReview(d.ai,review)};
  revised.ai.previousReview=before;
  revised.ai.revisionNotes='';
  delete revised.ai.revision;
  await store.saveDraft(app,revised);
  d.ai=revised.ai;
  d.updated=revised.updated;
  return review;
}
async function receive(app,d) {
  const state=await getState(app,d);if(state?.status!=='completed')return null;
  if(d.ai.revision)return receiveRevision(app,d);
  if(d.ai.result)return d.ai.result;
  const data=JSON.parse(await app.vault.adapter.read(d.ai.jobPath+'/result.json'));
  for(const artifact of data.artifacts){
    const key=d.ai.jobId+':'+artifact.name;
    if(d.assets.some(a=>a.generated_key===key))continue;
    const absolute=path.resolve(artifact.path);const allowed=path.resolve(rootPath(app),store.draftFolder(d));if(!absolute.startsWith(allowed+path.sep))throw new Error('识别结果位置无效，请重试。');
    const bytes=await fs.promises.readFile(absolute);const source=await store.stageFile(app,d,{name:artifact.name,type:'text/markdown',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},{relativePath:'AI识别资料/'+d.ai.jobId+'/'+artifact.name});
    source.is_ai_generated=true;source.generated_key=key;source.role='文字转录';source.note='AI 识别原文，来源 '+artifact.source_id+'；请对照原文件核对';source.ai_source_id=artifact.source_id;
  }
  for(const item of data.result.material_notes||[]){const source=data.sources.find(s=>s.source_id===item.source_id);if(!source)continue;const a=d.assets.find(a=>a.id===source.key);if(a&&!a.note)a.ai_note=item.usage;const r=d.references.find(r=>'ref:'+r.path===source.key);if(r&&!r.note)r.ai_note=item.usage;}
  d.ai.result=data;d.ai.reviewedMarkdown=data.result.review_markdown;await store.saveDraft(app,d);return data;
}
function approve(d,markdown) {
  if(!markdown.trim())throw new Error('说明正文不能为空。');
  if(!d.ai?.result)throw new Error('请先完成资料识别。');
  const result=d.ai.result.result;
  for(const [key,fallback] of [['title','新工作'],['client','']]){
    if(d[key]?.trim()&&d[key]!==d.ai.inferred?.[key])continue;
    d[key]=result[key]||fallback;
    d.ai.inferred={...d.ai.inferred,[key]:d[key]};
  }
  d.ai.reviewedMarkdown=markdown.trim();d.ai.approved=true;d.ai.approvedAt=store.stamp().time;d.ai.inputFingerprint=fingerprint(d);
}
function current(d) {return !!(d.ai?.approved&&d.ai.inputFingerprint===fingerprint(d));}
function section(d,{folder,paths={}}) {
  const original=store.sourceInputs(d,{folder,paths});
  const data=d.ai.result;
  const sourceLinks=[];
  for(const source of data.sources){
    const asset=d.assets.find(a=>a.id===source.key);const ref=d.references.find(r=>'ref:'+r.path===source.key);
    const actual=asset?(paths[asset.id]||`${folder}/${asset.lane==='chat'?'聊天截图':'原始资料'}/${asset.relative_path}`):ref?.path||(source.key.startsWith('ref:')?source.key.slice(4):'');
    const extra=d.assets.filter(a=>a.is_ai_generated&&a.generated_key?.startsWith(d.ai.jobId+':')&&a.ai_source_id===source.source_id).map(a=>`[[${paths[a.id]||`${folder}/原始资料/${a.relative_path}`}|识别原文]]`).join('、');
    sourceLinks.push(`- **${source.source_id}**：${actual?`[[${actual}|${source.name}]]`:source.name}（${source.status==='failed'?'本轮未处理成功':source.status==='listed'?'仅列名，未读取正文':'已参与整理'}）${extra?'；'+extra:''}`);
  }
  const notices=[...(data.warnings||[])];
  return `## ${d.mode==='append'?'补充要求':'工作说明'} · ${d.created}\n\n> 用户于 ${d.ai.approvedAt} 核对采用。执行以本节已核对正文为准，下方来源和原始输入供追溯。\n\n${d.ai.reviewedMarkdown}\n\n### 来源与识别原文\n\n${sourceLinks.join('\n')||'依据用户填写的消息与背景整理。'}${notices.length?'\n\n### 处理范围提醒\n\n'+notices.map(n=>'- '+n).join('\n'):''}${original?'\n\n---\n\n### 原始输入与全部资料\n\n'+original:''}`;
}
module.exports={fingerprint,hasContent,jobPath,getState,running,start,revise,reviewMarkdown,undoRevision,stop,receive,approve,current,section};
