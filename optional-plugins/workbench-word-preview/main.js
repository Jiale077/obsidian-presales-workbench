const {Plugin,FileView,Notice,loadPdfJs}=require('obsidian');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {execFile}=require('child_process'),{promisify}=require('util');
const run=promisify(execFile),TYPE='workbench-word-preview',REVISION='word-pdf-v1';
const WORD_SCRIPT=`on run argv
set sourceFile to POSIX file (item 1 of argv)
set outputName to (POSIX file (item 2 of argv)) as text
set temporaryDocument to missing value
with timeout of 170 seconds
  tell application "Microsoft Word"
    try
      open sourceFile read only true add to recent files false
      set candidateDocument to active document
      if (name of candidateDocument) does not start with (item 3 of argv) then error "Temporary preview document was not activated."
      set temporaryDocument to candidateDocument
      save as temporaryDocument file name outputName file format format PDF add to recent files false
      close temporaryDocument saving no
    on error errorMessage number errorNumber
      if temporaryDocument is not missing value then
        try
          close temporaryDocument saving no
        end try
      end if
      error errorMessage number errorNumber
    end try
  end tell
end timeout
end run`;

class WordView extends FileView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.generation=0;this.zoom=1;this.currentPage=1;}
  getViewType(){return TYPE;}
  getDisplayText(){return this.file?.basename||'Word 预览';}
  getIcon(){return 'file-text';}
  canAcceptExtension(extension){return ['doc','docx'].includes(extension.toLowerCase());}
  async onOpen(){
    this.registerEvent(this.app.vault.on('modify',file=>{if(file.path!==this.file?.path)return;clearTimeout(this.changeTimer);this.changeTimer=setTimeout(()=>this.onLoadFile(file),700);}));
  }
  dispose(){
    this.observer?.disconnect();this.resizeObserver?.disconnect();clearTimeout(this.resizeTimer);
    const old=this.session;this.session=null;if(old){for(const task of old.tasks.values())try{task.cancel();}catch{}old.loadingTask?.destroy().catch(()=>{});}
  }
  async onClose(){this.generation++;clearTimeout(this.changeTimer);this.dispose();}
  async onUnloadFile(){this.generation++;clearTimeout(this.changeTimer);this.dispose();}
  async onLoadFile(file){
    const generation=++this.generation;this.dispose();this.file=file;this.currentPage=1;
    const host=this.containerEl.children[1];host.empty();host.addClass('wpw-content');
    const root=host.createDiv({cls:'wpw-root'}),header=root.createDiv({cls:'wpw-header'}),identity=header.createDiv();
    identity.createEl('strong',{text:file.basename});this.status=identity.createDiv({cls:'wpw-status',text:'正在使用本机 Word 准备预览…'});
    const tools=header.createDiv({cls:'wpw-tools'});
    const button=(text,fn,title)=>{const b=tools.createEl('button',{text});if(title)b.title=title;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){new Notice(e.message);}finally{b.disabled=false;}};return b;};
    button('刷新',async()=>{await this.plugin.invalidate(file);await this.onLoadFile(file);},'重新生成预览');
    button('－',()=>this.setZoom(Math.max(.35,this.zoom-.15)),'缩小');
    button('＋',()=>this.setZoom(Math.min(2,this.zoom+.15)),'放大');
    button('适宽',()=>this.setZoom(1),'适合窗口宽度');
    button('适页',()=>{this.fitMode='page';this.zoom=1;this.applyZoom();this.refreshRendered();this.goTo(this.currentPage);},'显示完整页面');
    button('外部打开',()=>this.plugin.openExternal(file),'在默认应用中编辑原文件');
    const nav=root.createDiv({cls:'wpw-navigation'}),previous=nav.createEl('button',{text:'上一页'}),next=nav.createEl('button',{text:'下一页'});
    this.counter=nav.createEl('span',{text:'— / —'});previous.onclick=()=>this.goTo(this.currentPage-1);next.onclick=()=>this.goTo(this.currentPage+1);
    this.pageInput=nav.createEl('input',{type:'number',attr:{min:'1','aria-label':'跳到页码'}});this.pageInput.placeholder='页码';this.pageInput.onchange=()=>this.goTo(Number(this.pageInput.value));
    this.pages=root.createDiv({cls:'wpw-pages'});this.pages.tabIndex=0;this.pages.createDiv({cls:'wpw-loading',text:'首次打开会生成临时预览，原始 Word 保持不变。'});
    this.pages.addEventListener('scroll',()=>this.syncPage(),{passive:true});
    this.pages.addEventListener('keydown',e=>{if(e.target!==this.pages)return;if(['PageDown','ArrowRight'].includes(e.key)){e.preventDefault();this.goTo(this.currentPage+1);}if(['PageUp','ArrowLeft'].includes(e.key)){e.preventDefault();this.goTo(this.currentPage-1);}});
    try{
      const pdf=await this.plugin.preview(file);if(generation!==this.generation)return;
      const pdfjs=await loadPdfJs();if(generation!==this.generation)return;
      const loadingTask=pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(pdf))});
      const session={generation,pdfPath:pdf,pdfjs,loadingTask,document:null,wrappers:new Map(),tasks:new Map(),rendering:new Map(),rendered:new Map()};this.session=session;
      session.document=await loadingTask.promise;if(this.session!==session){await session.document.destroy();return;}
      this.pageCount=session.document.numPages;this.pages.empty();this.pageInput.max=String(this.pageCount);
      const first=await session.document.getPage(1),viewport=first.getViewport({scale:1});
      for(let n=1;n<=this.pageCount;n++){const wrapper=this.pages.createDiv({cls:'wpw-page'});wrapper.dataset.page=String(n);wrapper.style.aspectRatio=viewport.width+' / '+viewport.height;wrapper.createDiv({cls:'wpw-page-loading',text:'第 '+n+' 页'});session.wrappers.set(n,wrapper);}
      this.applyZoom();this.counter.textContent='1 / '+this.pageCount;this.pageInput.value='1';
      await this.renderPage(session,1);if(this.session!==session)return;
      this.status.textContent='Word 原生预览 · '+this.pageCount+' 页';
      this.observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)this.renderPage(session,Number(entry.target.dataset.page)).catch(e=>this.reportPageError(session,entry.target,e));},{root:this.pages,rootMargin:'65% 0px 65% 0px',threshold:.01});
      for(const wrapper of session.wrappers.values())this.observer.observe(wrapper);
      let width=this.pages.clientWidth;this.resizeObserver=new ResizeObserver(()=>{const nextWidth=this.pages.clientWidth;if(Math.abs(nextWidth-width)<3)return;width=nextWidth;clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.refreshRendered(),120);});this.resizeObserver.observe(this.pages);
    }catch(e){
      if(generation!==this.generation)return;this.status.textContent='预览未完成';this.pages.empty();this.pages.createDiv({cls:'wpw-error',text:'未能生成预览：'+e.message+'。可点“刷新”重试，或用“外部打开”查看原文件。'});console.error('[Word预览]',e);
    }
  }
  reportPageError(session,wrapper,error){if(this.session===session)wrapper.querySelector('.wpw-page-loading')?.setText('本页未能显示，可刷新重试');console.warn('[Word预览页面]',error);}
  applyZoom(){for(const wrapper of this.session?.wrappers.values()||[]){const dimensions=wrapper.style.aspectRatio.split('/').map(Number),ratio=dimensions[0]/dimensions[1]||.707;const width=this.fitMode==='page'?Math.min(this.pages.clientWidth-56,(this.pages.clientHeight-40)*ratio):Math.max(320,this.pages.clientWidth-56);wrapper.style.width=Math.round(width*this.zoom)+'px';}}
  setZoom(value){this.fitMode='width';this.zoom=value;this.applyZoom();this.refreshRendered();}
  refreshRendered(){const session=this.session;if(!session)return;this.applyZoom();for(const number of [...session.rendered.keys()]){const wrapper=session.wrappers.get(number);if(wrapper.getBoundingClientRect().bottom>=this.pages.getBoundingClientRect().top&&wrapper.getBoundingClientRect().top<=this.pages.getBoundingClientRect().bottom)this.renderPage(session,number,true).catch(()=>{});}}
  async renderPage(session,number,force=false){
    if(this.session!==session||!number||session.rendering.has(number))return;
    const wrapper=session.wrappers.get(number);if(!wrapper)return;const targetWidth=Math.min(2600,Math.round(wrapper.clientWidth*Math.min(2,devicePixelRatio||1)));
    if(!force&&session.rendered.get(number)===targetWidth)return;
    const work=(async()=>{
      const page=await session.document.getPage(number);if(this.session!==session)return;
      const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:targetWidth/base.width}),cssViewport=page.getViewport({scale:wrapper.clientWidth/base.width});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.className='wpw-canvas';
      const task=page.render({canvasContext:canvas.getContext('2d'),viewport});session.tasks.set(number,task);await task.promise;
      if(this.session!==session)return;wrapper.replaceChildren(canvas);wrapper.style.aspectRatio=base.width+' / '+base.height;
      if(typeof session.pdfjs.TextLayer==='function')try{const textLayer=wrapper.createDiv({cls:'textLayer wpw-text-layer'});await new session.pdfjs.TextLayer({textContentSource:await page.getTextContent(),container:textLayer,viewport:cssViewport}).render();}catch{}
      session.rendered.delete(number);session.rendered.set(number,targetWidth);
      if(session.rendered.size>8){for(const oldNumber of session.rendered.keys()){if(Math.abs(oldNumber-this.currentPage)<3)continue;session.wrappers.get(oldNumber).replaceChildren();session.wrappers.get(oldNumber).createDiv({cls:'wpw-page-loading',text:'第 '+oldNumber+' 页'});session.rendered.delete(oldNumber);break;}}
    })();session.rendering.set(number,work);
    try{await work;}finally{session.rendering.delete(number);session.tasks.delete(number);}
  }
  syncPage(){const session=this.session;if(!session)return;const top=this.pages.getBoundingClientRect().top+20;let closest=1,distance=Infinity;for(const [n,wrapper]of session.wrappers){const delta=Math.abs(wrapper.getBoundingClientRect().top-top);if(delta<distance){closest=n;distance=delta;}}this.currentPage=closest;this.counter.textContent=closest+' / '+this.pageCount;if(document.activeElement!==this.pageInput)this.pageInput.value=String(closest);}
  goTo(number){if(!this.session)return;number=Math.max(1,Math.min(this.pageCount,number||1));const wrapper=this.session.wrappers.get(number);this.pages.scrollTo({top:wrapper.offsetTop-16,behavior:'smooth'});this.renderPage(this.session,number).catch(()=>{});}
}

module.exports=class WordPreviewPlugin extends Plugin {
  async onload(){this.queue=Promise.resolve();this.pending=new Map();this.registerView(TYPE,leaf=>new WordView(leaf,this));this.registerExtensions(['docx','doc'],TYPE);}
  source(file){const source=this.app.vault.adapter.getFullPath(file.path),stat=fs.statSync(source);return {source,key:crypto.createHash('sha256').update(REVISION+source+':'+stat.mtimeMs+':'+stat.size).digest('hex').slice(0,28)};}
  location(file){const {source,key}=this.source(file);return {source,key,pdf:path.join(os.tmpdir(),'obsidian-word-workbench-preview',key+'.pdf')};}
  async invalidate(file){const {pdf}=this.location(file);if(this.pending.has(pdf))await this.pending.get(pdf);fs.rmSync(pdf,{force:true});}
  async preview(file){
    const info=this.location(file);if(fs.existsSync(info.pdf)&&fs.statSync(info.pdf).size>1024)return info.pdf;
    if(this.pending.has(info.pdf))return this.pending.get(info.pdf);
    const job=this.queue.catch(()=>{}).then(()=>this.convert(info));this.queue=job;this.pending.set(info.pdf,job);
    try{return await job;}finally{this.pending.delete(info.pdf);}
  }
  async convert({source,key,pdf}){
    if(process.platform!=='darwin'||!fs.existsSync('/Applications/Microsoft Word.app'))throw Error('此预览需要本机 Microsoft Word');
    const stage=path.join(os.homedir(),'Library/Containers/com.microsoft.Word/Data/Library/Caches/obsidian-word-workbench-preview',key+'-'+crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(stage,{recursive:true});const basename='source-'+key,copy=path.join(stage,basename+path.extname(source)),output=path.join(stage,'preview.pdf');fs.copyFileSync(source,copy);
    try{await run('/usr/bin/osascript',['-e',WORD_SCRIPT,copy,output,basename],{timeout:180000,maxBuffer:200000});if(!fs.existsSync(output)||fs.statSync(output).size<1024)throw Error('Word 没有生成可用的预览');fs.mkdirSync(path.dirname(pdf),{recursive:true});const temporary=pdf+'.tmp';fs.copyFileSync(output,temporary);fs.renameSync(temporary,pdf);return pdf;}catch(e){this.lastConversionError=e;console.warn('[Word转换]',e.stderr||e.message);throw Error(e.killed?'Word 转换等待超时':'Word 未能完成本轮转换');}finally{fs.rmSync(stage,{recursive:true,force:true});}
  }
  async openExternal(file){const result=await require('electron').shell.openPath(this.app.vault.adapter.getFullPath(file.path));if(result)throw Error(result);}
};
