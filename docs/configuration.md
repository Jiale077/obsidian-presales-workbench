# 配置

`runtime-config.example.json` 是公开模板。安装工具在目标库生成私有的 `runtime-config.json`；不要把密钥填入这个文件，云端工具继续使用各自的凭据配置。

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `python_command` | 自动查找 Python 3.11+ | 支持完整可执行文件路径，不是 shell 命令 |
| `codex_command` | 自动查找 `codex` | 可通过 `PWB_CODEX_COMMAND` 环境变量覆盖 |
| `codex_model` | CLI 默认 | 只填写账号可用的模型名 |
| `include_codex_history` | `false` | 主动允许周报读取本库业务目录对应的本机 Codex 会话 |
| `document_provider` | `local` | 本机 MarkItDown；设置 `mineru` 才尝试云端适配器 |
| `mineru_script` | 空 | 可选 MinerU 客户端的 Python 文件路径 |
| `tingwu_script` | 空 | 可选 meeting-minutes 的 `tingwu_transcribe.py` 路径 |
| `whisper_model` | `mlx-community/whisper-large-v3-turbo` | 本机模型目录或 MLX Whisper 兼容模型名 |
| `whisper_initial_prompt` | 空 | 可选术语提示，不内置任何组织名称 |

AI 整理和周报使用结构化输出。执行项目通过 Codex app-server 保留会话，沿用自己的登录与账号用量。CLI 变更可能影响实验接口，应先在虚构示例任务中核对。

## 可选云端适配器

这些是明确配置后才使用的扩展，不是开箱即用的内置服务。

- 通义听悟：可使用独立的 `meeting-minutes-skill/scripts/tingwu_transcribe.py`。需按该项目配置 OSS 与听悟，接口包含上传、提交、轮询、下载和清理。
- MinerU：需要提供与 `intake_ai_worker.py` 调用接口一致的 Python 客户端，包含 `get_token`、`submit_batch`、`upload`、`api_get`、`process_zip` 与 `API`。不满足接口时不应启用；失败会尝试本机正文读取。
- 未装相应工具时，可以直接提供已有转录和 Markdown 材料，不影响手动建档。

## 目录

首版采用仓库内的通用中文目录约定。若已有知识库使用其他目录，可以先用独立示例库试用；不要把脚本直接覆盖到个人定制工作台。当前没有一键重映射所有业务目录的设置。

## 安装和设置保护

安装前先检查全部文件冲突；不同内容的同名文件会使整次安装停止。不会更改原知识库的项目状态、星标、说明、记录或交接。

`--enable-settings` 需事先安装 Dataview，并建议关闭目标库后使用。它将备份受影响的设置，再合并 CSS、Dataview JavaScript、已启用插件列表与文件显示选项。备份在目标库 `.presales-workbench-backups/`。
