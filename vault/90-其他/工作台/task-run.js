const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const store=require('./task-store.js');
function active(state){return ['queued','running','waiting'].includes(state?.status);}
function readJSON(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJSON(file,data){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,file);}
function context(app,folder){
  store.validPath(folder);const base=fs.realpathSync(app.vault.adapter.getBasePath());const full=fs.realpathSync(path.join(base,folder));
  if(!full.startsWith(base+path.sep)||!fs.statSync(full).isDirectory())throw new Error('请选择知识库中的任务文件夹。');
  if(!fs.existsSync(path.join(full,'说明.md')))throw new Error('这个任务还没有“说明.md”，请先补充或生成任务说明。');
  return {base,folder,full,meta:path.join(full,'.workbench/session.json'),runtime:path.join(full,'.workbench')};
}
function getSession(app,folder){const c=context(app,folder);return readJSON(c.meta);}
function getState(app,folder){
  const c=context(app,folder);const meta=readJSON(c.meta);if(!meta.last_run)return {status:'idle',phase:'准备开始',messages:[],files:[],pending:[]};
  const job=path.join(c.runtime,'runs',meta.last_run);const state=readJSON(path.join(job,'state.json'),{status:'queued',phase:'准备启动',messages:[],files:[],pending:[]});
  const pid=state.pid||Number(readJSON(path.join(job,'worker-pid.json')).pid);
  if(active(state)&&pid){try{process.kill(pid,0);}catch{state.status='interrupted';state.phase='连接已结束，可继续当前会话';state.pending=[];}}
  else if(active(state)&&state.queued_at&&Date.now()-state.queued_at>30000){state.status='interrupted';state.phase='启动未完成，可再次继续';}
  return {...state,run_id:meta.last_run,thread_id:state.thread_id||meta.thread_id,title:meta.title};
}
async function start(app,folder,prompt=''){
  const c=context(app,folder);const python=require('./runtime.js').executable('python');require('./runtime.js').executable('codex');fs.mkdirSync(c.runtime,{recursive:true});const lock=path.join(c.runtime,'launch.lock');let fd;
  try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));}catch{
    const age=Date.now()-fs.statSync(lock).mtimeMs;if(age>30000&&!active(getState(app,folder))){fs.unlinkSync(lock);return start(app,folder,prompt);}
    throw new Error('正在启动这项工作，请稍候。');
  }
  try{
    const current=getState(app,folder);if(active(current))return current;
    const brief=fs.readFileSync(path.join(c.full,'说明.md'),'utf8');if(brief.trim().length<12)throw new Error('说明内容还太少，请先补充工作要求。');
    const runId=Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');const job=path.join(c.runtime,'runs',runId);fs.mkdirSync(job,{recursive:true});
    const file=app.vault.getAbstractFileByPath(folder+'/📂 索引.md');const fm=file?app.metadataCache.getFileCache(file)?.frontmatter:{};const title=String(fm?.title||fm?.project||path.basename(c.full));
    writeJSON(path.join(job,'request.json'),{vault:c.base,folder:c.full,title,prompt});
    writeJSON(path.join(job,'state.json'),{status:'queued',phase:'正在创建或恢复任务会话',queued_at:Date.now(),messages:[],files:[],pending:[]});
    const meta=readJSON(c.meta);writeJSON(c.meta,{...meta,version:1,title,folder:c.full,last_run:runId,brief_hash:crypto.createHash('sha256').update(brief).digest('hex'),runs:[...(meta.runs||[]),runId]});
    const log=fs.openSync(path.join(job,'worker.log'),'a');
    try{
      const child=require('child_process').spawn(python,[path.join(c.base,'90-其他/工作台/task_work_worker.py'),path.join(job,'request.json')],{cwd:c.full,detached:true,stdio:['ignore',log,log],env:require('./runtime.js').environment(python)});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      writeJSON(path.join(job,'worker-pid.json'),{pid:child.pid});
    }catch(error){writeJSON(path.join(job,'state.json'),{status:'failed',phase:'未能启动本机 Codex',detail:error.message,messages:[],files:[],pending:[]});throw error;}finally{fs.closeSync(log);}
    return getState(app,folder);
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}}
}
function stop(app,folder){const c=context(app,folder),meta=readJSON(c.meta);if(meta.last_run)fs.writeFileSync(path.join(c.runtime,'runs',meta.last_run,'stop'),'stop');}
function respond(app,folder,requestId,result,summary='用户已答复'){
  const c=context(app,folder),state=getState(app,folder);if(!state.pending?.some(p=>String(p.id)===String(requestId)))throw new Error('这个问题已经处理，请查看最新执行状态。');
  const file=path.join(c.runtime,'runs',state.run_id,'answer-'+crypto.randomBytes(6).toString('hex')+'.json');writeJSON(file,{request_id:requestId,result,summary});
}
function history(app,folder){const c=context(app,folder),meta=readJSON(c.meta);return (meta.runs||[]).map(id=>({...readJSON(path.join(c.runtime,'runs',id,'state.json')),run_id:id})).reverse();}
module.exports={context,active,getSession,getState,start,stop,respond,history};
