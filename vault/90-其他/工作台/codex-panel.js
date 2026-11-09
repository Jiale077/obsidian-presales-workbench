// Optional integration; opening the panel does not alter models or send a task.
async function openCodex(app) {
  const plugin = app.plugins.plugins.realclaudian;
  if (plugin?.views?.activateView) return plugin.views.activateView();
  if (plugin?.activateView) return plugin.activateView();
  throw new Error('未安装兼容的 AI 协作面板。可直接使用项目卡片“开始 / 继续工作”，或复制任务说明到自己的 AI 工具。');
}
module.exports = {openCodex};
