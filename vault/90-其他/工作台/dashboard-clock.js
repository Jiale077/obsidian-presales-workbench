const MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR;
const holidays=require('./holiday-calendar.js');
function shanghai(now){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  const start=Date.UTC(+p.year,+p.month-1,+p.day)-8*HOUR;
  return {start,weekday:new Date(start+8*HOUR).getUTCDay(),year:p.year,month:p.month,day:p.day};
}
function parts(ms){
  const minutes=Math.max(0,Math.ceil(ms/MINUTE));
  if(minutes>=1440)return [{value:Math.floor(minutes/1440),unit:'天'},{value:Math.floor(minutes%1440/60),unit:'小时'}];
  return [{value:Math.floor(minutes/60),unit:'小时'},{value:minutes%60,unit:'分钟'}];
}
function dayParts(ms){return [{value:Math.max(0,Math.ceil(ms/DAY)),unit:'天'}];}
function weekendClock(local,ms,endMinutes,calendar){
  for(let offset=0;offset<28;offset++){
    const day=local.start+offset*DAY,weekday=new Date(day+8*HOUR).getUTCDay();
    if(![0,6].includes(weekday)||!holidays.dayInfo(day,calendar).off)continue;
    const start=day-DAY+endMinutes*MINUTE;let end=day+DAY;
    if(weekday===6&&holidays.dayInfo(end,calendar).off)end+=DAY;
    if(ms>=end)continue;
    if(ms>=start)return {label:'周末已开始',text:'休息时间',note:'周末休息'};
    const previous=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(day-DAY));
    const time=String(Math.floor(endMinutes/60)).padStart(2,'0')+':'+String(endMinutes%60).padStart(2,'0');
    return {label:'距离周末',parts:parts(start-ms),note:previous+' '+time+' 开始休息'};
  }
  return {label:'距离周末',text:'查看日历',note:''};
}
function customTime(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))return null;
  const time=Date.parse(value+':00+08:00');return Number.isFinite(time)?time:null;
}
function clock(settings={},now=new Date(),calendar={years:{}}){
  const local=shanghai(now),ms=now.getTime();
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.off_work_time||'')?settings.off_work_time:'18:00';
  const [h,m]=time.split(':').map(Number),todayEnd=local.start+h*HOUR+m*MINUTE;
  let work;
  const today=holidays.dayInfo(local.start,calendar);
  if(today.off)work={label:today.name?'今天放假':'今天休息',text:today.name?today.name+'假期':'休息时间',note:today.name?'按法定节假日安排':'周末休息'};
  else if(ms>=todayEnd)work={label:'今天已下班',text:'下班啦',note:time+' 已到，好好休息'};
  else work={label:'距离下班',parts:parts(todayEnd-ms),note:(today.makeup?'今天调休上班 · ':'')+time+' 收工'};
  let rest;
  const custom=customTime(settings.custom_rest_at),name=String(settings.custom_rest_name||'放假').trim().slice(0,24)||'放假';
  if(custom!==null){
    const note=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(custom))+' 开始休息';
    rest=ms<custom?{label:'距离'+name,parts:dayParts(custom-ms),note}:{label:name+'时间已到',text:'假期到了',note};
  }else{
    const next=holidays.nextHoliday(ms,h*60+m,calendar);
    if(next){
      const date=d=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric'}).format(new Date(d));
      const range=date(next.start)+(next.end-next.start>DAY?'—'+date(next.end-DAY):'');
      const note=next.provisional?range+' · '+new Date(next.start+8*HOUR).getUTCFullYear()+' 年调休安排待公布':range+' · 共 '+Math.round((next.end-next.start)/DAY)+' 天（含连休）';
      rest=ms>=next.startsAt?{label:next.name+'假期中',text:'休息时间',note}:{label:'距离'+next.name,parts:dayParts(next.startsAt-ms),note};
      rest.source=next.paper;rest.provisional=next.provisional;
    }else rest={label:'下一个法定假期',text:'等待公布',note:'尚无完整日历，联网后自动更新'};
  }
  return {date:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(now),work,weekend:weekendClock(local,ms,h*60+m,calendar),rest};
}
module.exports={clock,customTime};
