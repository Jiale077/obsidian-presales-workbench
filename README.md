# Obsidian 售前工作台

把零散的客户消息、截图、录音和参考材料，变成有说明、有执行记录、能接着修改的项目。

**收任务 → 整理说明 → 人工核对 → AI 执行 → 成果归档 → 周报复盘**

这是从真实日常使用中整理出的开源版本。界面在 Obsidian 桌面端运行，底层仍是可直接打开的 Markdown、附件和本地文件夹。仓库只包含工作台代码、规则和虚构示例。

## 可以做什么

- **工作总览**：项目关注、进度、最近交流、周报，以及下班、周末和中国法定假期倒计时。
- **收集一项工作**：粘贴原始要求、加入截图和附件、引用库内资料；支持草稿、新任务、子任务和补充要求。
- **核对任务说明**：通过 Codex 识图和整理正文，保留来源编号、识别原文和待核对项；采用后再建档。
- **开始 / 继续工作**：项目绑定持续的 Codex 会话，显示进度、提问和新增文件；支持停止后继续。
- **整理项目文件**：维护用途分类、人工选择的采用入口与交接导航，保留原文件路径。
- **周报复盘**：首次进入收集本库文件线索，之后可手动刷新，选入候选、按项目归并、生成可编辑初稿，核对后保存。
- **Office 入口**：默认外部打开；可选 Word 预览插件在本机生成临时 PDF，原稿保留。

## 先试用

首版面向 **macOS 的 Obsidian 桌面端**。基础工作台需要 Obsidian 和 Dataview；AI 功能另需 **Python 3.11+、已安装并登录的 Codex CLI**。Linux 的后台代码尚未实机验证，Windows 和移动端暂不支持。

```bash
git clone https://github.com/Jiale077/obsidian-presales-workbench.git
cd obsidian-presales-workbench
python3 scripts/install.py --vault "/你的路径/售前工作台演示" --demo
```

1. 在 Obsidian 中选择“打开文件夹作为仓库”，打开刚生成的目录。
2. 在“第三方插件”安装并启用 **Dataview**，在其设置中启用 **JavaScript Queries**。
3. 在“外观 → CSS 代码片段”启用 `presales-workbench`。
4. 打开 `售前工作台.md`，切换到**阅读视图**。

不使用 AI，也可以浏览材料、建档、手动写说明、维护项目与工作记录。示例中的客户和项目均为虚构。

已有工作库建议先备份。安装工具会在发现不同内容的同名文件时整体停止；不会自动覆盖首页、规则、代码或业务资料。先用 `--dry-run` 查看计划。目录结构按本项目约定创建，**不会自动迁移你已有的知识库目录**。

## 开启 AI 与可选能力

在安装后的 `90-其他/工作台/runtime-config.json` 配置本机命令。文件留在自己的知识库，不应提交到公开仓库。

```json
{
  "python_command": "/你的 Python 路径/python3",
  "codex_command": "/你的 Codex 路径/codex",
  "codex_model": "",
  "include_codex_history": false,
  "document_provider": "local"
}
```

路径留空时自动查找；可用 `command -v python3`、`command -v codex` 查看。基础后台只使用 Python 标准库。模型留空时使用 CLI 默认模型；工作台使用你自己的 Codex 登录与用量，本项目不提供模型服务。

- 文档正文读取：可选安装 `python3 -m pip install 'markitdown[all]'`。
- 本机录音转录：Apple Silicon Mac 可选安装 `python3 -m pip install mlx-whisper`，并安装 FFmpeg；首次使用会下载配置的 Whisper 模型。也可以直接加入已有转录稿。
- 云端转录 / 文档解析：使用显式配置的可选适配器，见[配置说明](docs/configuration.md)，未配置时不保证可用。
- Word 预览：`python3 scripts/install.py --vault "/你的知识库路径" --word-preview`，再在第三方插件中启用“Word 预览 · 工作台”。需要本机 Microsoft Word 和 macOS 自动化授权。
- 已安装 Dataview 后，可以关闭目标库，再通过 `--enable-settings` 备份并合并插件、JavaScript 查询和 CSS 设置。这个选项才会修改设置文件。

完整使用说明见[工作台指南](vault/_MOC/工作台使用指南.md)，目录和执行边界见[架构说明](docs/architecture.md)。

## 数据与运行边界

- 原始材料和执行记录保存在你的知识库。调用 AI 时，选定的文字和图片会发送给你配置的模型服务；主动选择云端转录或解析时，相关文件会上传到该服务。
- 周报默认只扫描本库业务目录的文件变化，首次进入自动收集，之后可手动刷新。**读取本机 Codex 历史默认关闭**；开启后仅筛选本库对应业务目录的会话，依赖 CLI 本地索引格式。
- 文件修改、模型回复和生成初稿不代表已提交、已验收或整个项目完成。项目状态由使用者维护。
- AI 写入限定在当前任务目录，外部操作仍需相应授权。相关提问和操作确认会显示在执行面板中。
- 日历会访问公开的 `holiday-cn` 数据源。首版按北京时间和中国节假日处理，断网时使用已有缓存。

## 当前版本

`v0.1.0` 是从个人工作库提取的首个公共版本，不是 Obsidian 官方插件。主界面采用 Dataview JavaScript 和 CSS，尚未做成单独的社区插件。

Codex app-server 是实验接口。当前核对 CLI 为 `0.167.0-alpha.3.2`；本仓库用模拟服务测试持续会话和文件记录，不把它称为所有 CLI 版本的兼容保证。PPT 预览、独立 AI 侧栏和每日定时刷新不随本仓库自动安装；可自行接入兼容工具。

## 开发与检查

```bash
python3 -m unittest discover -s tests -v
node --test tests/core.test.cjs
python3 scripts/check_release.py
```

欢迎通过 Issue 提交问题。请使用虚构材料复现，删除截图中的客户名称、会话内容和登录信息。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可与致谢

本项目代码、规则和虚构示例以 [MIT License](LICENSE) 开源。Obsidian、Dataview、Codex、MarkItDown 和其他可选工具由各自项目提供，未打包分发。第三方来源与兼容范围见 [NOTICE.md](NOTICE.md)。
