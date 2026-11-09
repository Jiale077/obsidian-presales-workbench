function viewType(app,file){
  const extension=String(file?.extension||'').toLowerCase();
  if(['ppt','pptx'].includes(extension)&&app.plugins.enabledPlugins.has('ppt-viewer')&&app.plugins.plugins['ppt-viewer'])return 'ppt-viewer-view';
  if(['doc','docx'].includes(extension)&&app.plugins.enabledPlugins.has('workbench-word-preview')&&app.plugins.plugins['workbench-word-preview'])return 'workbench-word-preview';
  return null;
}
function canPreview(app,file){return !!viewType(app,file);}
async function open(app,file){
  const type=viewType(app,file);if(!type)throw Error('请先启用对应的文档预览插件。');
  const existing=app.workspace.getLeavesOfType(type).find(leaf=>leaf.view?.file?.path===file.path);
  if(existing){app.workspace.setActiveLeaf(existing,{focus:true});return existing;}
  const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return leaf;
}
module.exports={canPreview,open};
