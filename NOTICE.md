# 来源与第三方工具

本项目提取自作者日常使用的 Obsidian 售前工作台。公开版本替换了个人路径、组织品牌和真实业务入口，另写了虚构示例、安装工具与测试。原工作知识库及其业务资料不属于本仓库。

以下为独立依赖或数据源，本仓库未复制它们的程序包：

| 项目 | 用途 | 来源 |
| --- | --- | --- |
| Obsidian | Markdown 知识库与桌面宿主 | https://obsidian.md/ |
| Dataview | 在笔记中运行工作台视图 | https://github.com/blacksmithgu/obsidian-dataview |
| OpenAI Codex | CLI 识图、结构化输出及 app-server 持续会话 | https://github.com/openai/codex |
| holiday-cn | 公开的中国节假日 JSON，运行时按需获取 | https://github.com/NateScarlet/holiday-cn |
| MarkItDown | 可选的本机文档正文提取 | https://github.com/microsoft/markitdown |
| MLX Whisper | 可选的 Apple Silicon 本机转录 | https://github.com/ml-explore/mlx-examples/tree/main/whisper |
| Microsoft Word | 可选的本机 DOC/DOCX 转 PDF | https://www.microsoft.com/microsoft-365/word |

`codex-panel.js` 仅尝试调用已安装协作插件的视图入口；未包含协作插件代码，也不代表其官方集成。`office-preview.js` 可检测已经安装的 PPT Viewer，未捆绑其程序或本地补丁。可选 Word 预览代码位于 `optional-plugins/`，随本项目按 MIT 提供。

可选通义听悟适配器可使用作者独立维护的 [meeting-minutes-skill](https://github.com/Jiale077/meeting-minutes-skill)。云端适配器、模型权重和服务账号需要使用者另行配置，其各自条款不由本仓库 MIT 许可替代。
