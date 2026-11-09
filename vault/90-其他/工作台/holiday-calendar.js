const fs=require('fs'),path=require('path'),https=require('https');
const DAY=86400000,HOUR=3600000,LEGAL_SOURCE='https://www.beijing.gov.cn/zhengce/gwywj/202411/t20241112_3939912.html';
const pending=new Map(),compiled=new WeakMap();
function midnight(date){return Date.parse(date+'T00:00:00+08:00');}
function iso(ms){return new Date(ms+8*HOUR).toISOString().slice(0,10);}
function valid(doc,year){
  try{
    if(doc?.year!==year||!Array.isArray(doc.days)||doc.days.length<7||doc.days.length>400||!doc.papers?.length)return false;
    if(!doc.papers.every(p=>{const u=new URL(p);return u.protocol==='https:'&&(u.hostname==='gov.cn'||u.hostname.endsWith('.gov.cn'));}))return false;
    const seen=new Set();
    return doc.days.every(d=>{if(typeof d.name!=='string'||!d.name.trim()||d.name.length>40||typeof d.isOffDay!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||iso(midnight(d.date))!==d.date||Math.abs(+d.date.slice(0,4)-year)>1||seen.has(d.date))return false;seen.add(d.date);return true;});
  }catch{return false;}
}
function cacheFile(app){return path.join(app.vault.adapter.getBasePath(),'90-其他/工作台/holiday-cache.json');}
function read(app){
  let data;try{data=JSON.parse(fs.readFileSync(cacheFile(app),'utf8'));}catch{data={};}
  const years={};for(const [year,doc]of Object.entries(data.years||{}))if(valid(doc,+year))years[year]=doc;
  return {schema:1,years,attempts:data.attempts||{},updated_at:data.updated_at||null};
}
function fetchJSON(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'User-Agent':'Obsidian-Presales-Workbench/1.0','Accept':'application/json'}},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error('HTTP '+res.statusCode));return;}
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>180000)req.destroy(new Error('日历数据异常'));});
      res.on('end',()=>{try{resolve(JSON.parse(text));}catch(e){reject(e);}});res.on('error',reject);
    });req.setTimeout(7000,()=>req.destroy(new Error('日历更新超时')));req.on('error',reject);
  });
}
async function refresh(app,{force=false,now=new Date()}={}){
  const file=cacheFile(app);if(pending.has(file))return pending.get(file);
  const work=(async()=>{
    const data=read(app),year=+iso(now.getTime()).slice(0,4),today=iso(now.getTime());let changed=false;
    await Promise.allSettled([year-1,year,year+1].map(async y=>{
      if(!force&&data.attempts[y]?.date===today)return;
      let doc,error;
      for(const host of ['https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/','https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/']){
        try{doc=await fetchJSON(host+y+'.json');break;}catch(e){error=e.message;}
      }
      if(valid(doc,y)){data.years[y]=doc;data.attempts[y]={date:today,status:'updated'};}
      else data.attempts[y]={date:today,status:doc?.days?.length===0?'unpublished':'offline',detail:error||'尚无完整公告日历'};
      changed=true;
    }));
    if(changed){data.updated_at=now.toISOString();const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);}
    return data;
  })();pending.set(file,work);try{return await work;}finally{pending.delete(file);}
}
function index(data){
  if(compiled.has(data))return compiled.get(data);
  const days=new Map(),years=[];
  for(const [year,doc]of Object.entries(data.years||{}).sort(([a],[b])=>+a-+b))if(valid(doc,+year)){years.push(+year);for(const day of doc.days)days.set(day.date,{...day,paper:doc.papers[0]});}
  const info=ms=>{const date=iso(ms),entry=days.get(date),weekend=[0,6].includes(new Date(ms+8*HOUR).getUTCDay());return {date,off:entry?entry.isOffDay:weekend,name:entry?.name||'',makeup:entry?.isOffDay===false,paper:entry?.paper};};
  const groups=[];
  for(const day of [...days.values()].filter(d=>d.isOffDay).sort((a,b)=>a.date.localeCompare(b.date))){
    const dayMS=midnight(day.date);if(groups.some(g=>dayMS>=g.start&&dayMS<g.end))continue;
    let start=dayMS,end=dayMS+DAY;for(let n=0;n<15&&info(start-DAY).off;n++)start-=DAY;for(let n=0;n<15&&info(end).off;n++)end+=DAY;
    const names=[...new Set([...days.values()].filter(d=>d.isOffDay&&midnight(d.date)>=start&&midnight(d.date)<end).map(d=>d.name))];
    groups.push({start,end,name:names.join('、'),paper:day.paper,provisional:false});
  }
  const result={days,years,info,groups};compiled.set(data,result);return result;
}
function dayInfo(ms,data){
  const result=index(data).info(ms),date=iso(ms);
  if(!index(data).days.has(date)&&date.endsWith('-01-01'))return {...result,off:true,name:'元旦',paper:LEGAL_SOURCE,provisional:true};
  return result;
}
function nextHoliday(ms,endMinutes,data){
  const idx=index(data),year=+iso(ms).slice(0,4);
  const list=idx.groups.map(g=>({...g,startsAt:g.start-DAY+endMinutes*60000}));
  // Before the next annual notice exists, only Jan 1 itself is certain; never invent its bridge days.
  for(const y of [year,year+1]){
    const start=midnight(y+'-01-01');
    const afterKnownYear=idx.years.includes(y-1)&&!idx.groups.some(g=>+iso(g.start).slice(0,4)===y-1&&g.end>ms);
    if(!idx.years.includes(y)&&(y===year&&iso(ms).slice(5,10)==='01-01'||y===year+1&&afterKnownYear))list.push({name:'元旦',start,end:start+DAY,startsAt:start,provisional:true,paper:LEGAL_SOURCE});
  }
  return list.filter(g=>g.end>ms).sort((a,b)=>a.start-b.start)[0]||null;
}
module.exports={read,refresh,valid,dayInfo,nextHoliday,iso,midnight};
