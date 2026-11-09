# 结构与执行边界

```text
vault/                         可安装的通用知识库骨架
  售前工作台.md                Dataview 入口
  .obsidian/snippets/          工作台样式
  _MOC/                       使用说明与通用导航
  90-其他/工作台/
    dashboard/view.js         六分区视图
    actions.js                记录、进度和面板入口
    task-intake.js            五步任务收集
    task-store.js             草稿、引用和建档
    task-ai.js                整理与核对说明
    intake_ai_worker.py       识图、转录、正文提取
    task-run*.js              持续执行面板
    task_work_worker.py       Codex app-server 客户端
    project-organization*.js  用途分类、采用入口和交接导航
    weekly*.js / *_worker.py  来源、候选和周报初稿
    runtime.*                本机可执行文件和非秘密配置
examples/demo-notes/          显式标记的虚构业务材料
optional-plugins/             可选本机 Word 预览
scripts/                      安装与发布检查
tests/                        文件保护和协议测试
```

工作台是 Dataview JavaScript 应用，依赖 Obsidian 桌面环境中的文件系统与进程能力。它不是可直接部署到网页的前端，也没有独立服务端或账号系统。

说明核对前不写正式任务；正式建档复制外部材料、引用库内资料。文件整理维护索引与 `.workbench/organization/`，不搬迁既有文件。运行和周报目录只属于使用者，不进入代码发布。

AI 文案整理与周报通过 CLI 的临时结构化输出调用；项目执行通过 app-server 使用当前任务目录和持续会话，展示真实交互请求，写入仅限任务目录。前端定期读取 JSON 状态，不把关闭窗口等同于停止执行。

支持范围和测试结果以 README、CHANGELOG 及实际版本为准。离线与模拟服务测试不能证明所有模型、Office、云端适配器和 CLI 版本可用。
