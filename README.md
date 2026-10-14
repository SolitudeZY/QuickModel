# QuickModel

用你自己的便宜模型，跑一个 Claude Code 式的桌面 Agent。开源、免费、代码全在你手里。日常的 AI 工作不需要最贵的模型，你只需要一个属于你自己的 Agent。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

中文 | [English](./README.en.md)

> 详细图文教程请参阅 [使用说明](./使用说明.md) | [MCP 使用指南](./MCP使用指南.md) | [主流 LLM 模型的 API Base URL 汇总](./主流%20LLM%20模型的%20API%20Base%20URL%20汇总.md)

 ## 30 秒上手

1. 从 [Releases](https://github.com/SolitudeZY/QuickModel/releases) 下载 `QuickModel-Setup.exe`（Windows）或 `.app` 压缩包（macOS）；也可源码运行：`git clone` → `pip install -r requirements.txt` → `python main.py`
2. 打开 **设置 → 模型配置**，填任意服务商的 API Key / Base URL / 模型名（也能从 Claude Code / Codex 一键导入）
3. 开聊。要联网就开搜索，要 OCR 就把图拖进来。

## 近期更新

- **会话工作流升级** — 支持临时对话、归档视图、整项目归档、批量归档/恢复/删除；项目分组默认收起长列表，并可搜索标题与正文
- **完整用量分析** — 月度热力图、周度柱状图、模型分布环图，可切换输出/输入/总 token，并统计缓存命中与估算数据
- **多协议模型接入** — 原生支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages，以及 DeepSeek、Qwen、GLM、Codex 请求差异；可导入本机 Claude/Codex 模型与 MCP 配置
- **可控浏览器** — Agent 可启动独立 Edge/Chrome 会话，读取页面、点击、输入和滚动；交互操作沿用命令确认机制，敏感信息由用户手动填写
- **沉浸式动态背景** — 根据时间与 Open-Meteo 实时天气展示城市昼夜、云、雨、雪、雾、雷暴、光尘与星轨；支持手动预览及强度、雾气、雨滴折射调节
- **子 Agent 稳定性** — 子 Agent 继承当前项目目录，带独立轮次/时间预算、重复调用检测与强制总结，避免长时间无进展阻塞主任务

## 功能特性

### 核心 Agent

- **多协议与多服务商支持** — 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；兼容 DeepSeek、OpenAI、Claude、Qwen、GLM、Ollama 及常见中转服务
- **多模型配置** — 设置中可配置多个模型后端，随时切换；每个模型可独立设置上下文长度和压缩阈值
- **配置迁移** — 可读取并选择性导入本机 Claude Code、Codex 的模型和 MCP Server 配置，减少重复填写
- **提示词预设** — 内置通用、探索研究、文档整理、代码编写、代码审查五种模板，仅在用户主动应用时替换模型提示词
- **思考模式 (off / high / max)** — 三级推理强度，工具栏按钮循环切换，跨会话持久化
- **自动压缩** — 上下文超过阈值自动摘要压缩（默认 600K，可自定义）；支持 `/compact` 手动压缩；前缀缓存感知压缩保留 DeepSeek 缓存命中
- **图片理解（针对性分析）** — 拖拽或粘贴图片即可分析。发送时仅附图片路径，由主模型按当前问题调用 `analyze_image` 工具做针对性分析（而非预生成通用描述）；内置反幻觉约束，只报告图中实际可见内容、区分观察与推测。默认使用 Qwen-VL 视觉模型
- **图片生成** — 用户要求生成/绘制图片时，主模型调用 `generate_image` 工具，经 OpenAI 兼容接口（支持 New API、sub2api 等中转）生成并保存到本地，对话中直接显示缩略图（点击放大）
- **跨会话记忆** — 模型记住用户偏好与项目背景，新会话自动带上；完成任务/解决 bug 后主动询问是否记入长期记忆（用户确认才写，不擅自存）；设置面板可查看/编辑/删除记忆条目
- **Token 用量追踪** — 侧边栏显示本轮/本次 Agent 运行的输出 token 与缓存命中率；用量面板提供月、周、模型维度统计

### 内置工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取本地文件（txt, md, py, json, csv, pdf, docx, xlsx 等） |
| `write_file` | 写入或覆盖文件 |
| `apply_patch` | 精确字符串替换修改文件（原文片段 → 新内容），支持多处/多文件编辑；匹配不到或不唯一时报错而非写坏文件 |
| `list_directory` | 列出目录内容 |
| `run_command` | 执行本地命令（Windows 优先 Git Bash、找不到时回退 PowerShell；macOS/Linux 使用 bash），带确认、白名单与超时保护 |
| `analyze_image` | 用视觉模型针对具体问题分析本地图片 |
| `generate_image` | 用生图模型生成图片并保存到本地 |
| `edit_image` | 在已有图片上按文字指令编辑（替换物体、增删元素、改文字等，基于 Qwen-Image-Edit） |
| `ocr_image` | 本地离线 OCR（RapidOCR）识别图片中的文字 |
| `web_search` | 多引擎网络搜索，自动降级 |
| `web_read` | 读取论坛/网页、远程 PDF、Word 与图片，并列出网页图片候选 |
| `extract_images` | 提取网页图片、PDF 页面或 Word 内嵌图片，可直接 OCR 或继续视觉分析 |
| `browser_*` | 启动独立 Edge/Chrome 会话，读取页面快照并执行点击、输入、滚动、关闭 |
| `ssh_*` | 建立持久 SSH 会话，远程执行命令、观察结果并继续 ReAct 操作 |
| `read_conversations_by_date` | 按日期范围读取历史会话，支持生成日报、周报与阶段总结 |
| `rlm_query` | 并行派发 1-16 个子任务到低成本模型 |
| `compact` | 手动触发上下文压缩 |
| `background_run` / `background_check` | 异步运行耗时命令并查询状态，避免阻塞 Agent 工具循环 |
| `todo_write` | 维护结构化任务清单 |
| `subagent` | 派生子 Agent 独立执行工具循环 |
| `glob_files` | 按模式匹配搜索文件 |
| `grep_files` | 按内容搜索文件 |
| `ask_user_question` | 向用户提问并等待回答 |
| `enter_plan_mode` / `exit_plan_mode` | 进入/退出计划模式 |

此外还包含持久化任务、团队消息总线和 Git worktree 等高级工具；MCP Server 暴露的工具会在连接后动态加入当前 Agent。

### 多引擎网络搜索

- **6 种搜索后端** — Tavily、Brave Search、Firecrawl、Google Custom Search、SearXNG、DuckDuckGo
- **自动降级** — 首选引擎失败时自动尝试下一个；DuckDuckGo（免费无需 Key）作为最终兜底
- **并行抓取** — 搜索结果页面并发抓取全文（最多 5 线程），大幅减少等待时间
- **软限制** — 单轮超过 5 次搜索后提示模型整合结果
- **手动/自动模式** — Auto 由模型决定是否搜索；Manual 通过工具栏开关控制

### 图文联合检索

- **论坛正文保留结构** — `web_read` 使用正文优先解析，保留段落换行，并识别 `srcset` 与常见懒加载图片
- **远程文档直读** — URL 指向 PDF 或 DOCX 时自动识别、缓存并提取文字，PDF 文字带页码标记
- **文档图片提取** — `extract_images` 可按页渲染 PDF（保留图、图注与版式），也可仅提取内嵌位图或 Word 媒体
- **OCR 优先、视觉按需** — `extract_images(ocr=true)` 可在提取后直接运行现有 RapidOCR；文字型截图和扫描件无需视觉 API，只有场景、布局、趋势或空间关系才调用 `analyze_image`

### 图片工具

- **针对性图片分析** — 发送图片时仅附绝对路径；文字型内容优先使用本地 OCR，人物表情、图表趋势、布局和特定区域等视觉语义再由主模型调用 `analyze_image`。视觉请求可设置 10-300 秒超时，且不会因 SDK 自动重试叠加等待
- **反幻觉约束** — 视觉模型被强制只报告实际可见内容、区分观察与推测、文字/数值逐字符照读、看不清就说不清，降低错误结论风险
- **图片生成** — 调用 `generate_image` 经 OpenAI 兼容 `/v1/images/generations` 生成图片，支持 New API / sub2api 等中转，保存到本地并在对话中显示缩略图卡片
- **图片编辑（指令式）** — 调用 `edit_image` 在已有图片上按文字指令编辑（如「把图里的猫换成狗」、增删元素、改图中文字、风格迁移），基于阿里 Qwen-Image-Edit，复用图片生成的配置
- **本地 OCR** — 调用 `ocr_image` 用本地 RapidOCR(ONNX) 引擎离线识别图片文字，速度快、不消耗视觉模型额度
- **读取模型列表** — 设置面板可一键拉取视觉/生图服务商的可用模型列表，点击直接填入
- **配套配置** — 视觉与生图各自独立的 `api_key` / `base_url` / `model`，设置面板「图片工具」标签分子页配置

### 命令执行与安全

- **跨平台 Shell** — Windows 优先使用 Git for Windows 的 bash，让 Agent 常用的 Unix 命令可直接运行；未安装时回退 PowerShell，macOS/Linux 使用 `/bin/bash`
- **输出编码自适应** — Git Bash 优先 UTF-8，PowerShell 兼容 GBK/cp936，减少中文输出乱码
- **命令确认与白名单** — 执行命令前弹确认对话框，可将命令加入允许列表实现后续自动执行；支持智能通配符模式建议
- **超时与中断** — 命令带超时保护，可随时停止执行

### MCP 与外部配置

- **MCP 客户端** — 支持 stdio 与 Streamable HTTP 两种传输方式，连接后的工具会动态注册到 Agent
- **可视化管理** — 在设置中新增、编辑、删除、启停和测试 MCP Server，可分别配置命令、工作目录、环境变量、URL 与请求头
- **Claude / Codex 导入** — 自动发现用户目录和当前项目中的 Claude Code、Codex 配置，可勾选导入模型或 MCP Server
- **安全边界** — 环境变量与请求头支持变量展开；导入前展示来源，修改后保存才生效

### 浏览器与远程操作

- **浏览器控制** — 使用本机 Edge 或 Chrome 启动独立、可见的浏览器会话，支持页面快照、元素引用、点击、输入和滚动
- **隔离与确认** — 不复用默认浏览器 Profile 或登录态；打开、点击和输入遵循现有确认策略，密码、验证码、API Key、支付信息必须由用户手动输入
- **SSH ReAct** — 支持密钥、SSH Agent 或默认私钥建立持久连接，Agent 可逐条执行远程命令并根据输出继续操作；高风险命令需要确认

### 项目分组与工作目录

- **会话绑定项目目录** — 每个会话可绑定一个项目文件夹，工具的相对路径以此为基准，根治模型把文件写到错误目录的问题
- **侧边栏按项目分组** — 对话列表按项目折叠分组，支持跨组拖拽归类、拖拽排序（带占位块视觉反馈）
- **主页项目选择** — 新建对话时可选最近项目、添加新项目或无项目快速开始
- **路径失效提示** — 跨设备同步后项目目录在本机不存在时，顶部提示并可一键重设

### 会话管理与总结

- **临时对话** — 仅保存在内存，不写入磁盘、不出现在侧边栏/搜索/归档/云同步中；切换到普通对话后自动丢弃
- **归档与批量管理** — 普通/归档视图分离，支持单条、整项目和多选批量归档、恢复、删除；正在生成的会话会被保护
- **长列表收纳** — 每个项目默认显示最近 5 条，可按组展开；侧边栏同时显示会话更新时间
- **正文搜索** — 搜索标题及用户/助手可见正文，不搜索隐藏的工具结果
- **日报与周报** — Agent 可按日期范围读取历史会话完整内容，结合系统注入的当前日期生成日报、周报或阶段总结

### 云同步与导入导出

- **一键全量同步** — 对话历史 + 配置文件 + 跨会话记忆一键上传到云盘文件夹（坚果云/OneDrive 等）
- **一键全量导入** — 换电脑时一键导入所有对话、配置和记忆，无需手动迁移
- **自动上传** — 对话完成后自动复制到同步文件夹
- **启动检测** — 每次启动自动检测云端新对话，标题栏提示
- **选择性导入** — 复选框界面，可自行选择要导入的对话
- **配置同步** — API Key、模型配置、允许的命令列表等全部同步（本机同步路径不会被覆盖）
- **导出为 Markdown** — 仅导出用户和助手的对话内容，不含工具调用
- **导入对话** — 支持从 .json（完整备份）或 .md（导出格式）文件导入历史对话

### 技能系统

- **内置与自定义技能** — 保存并复用提示词模板
- **导入 Claude 风格技能** — 从文件夹导入（自动识别 `SKILL.md` + 附属文件，支持批量导入）
- **完整管理面板** — 创建、编辑、删除技能

### 记忆系统

- **持久化键值存储** — Agent 可跨对话保存和回忆信息（`memory_read`、`memory_write`）
- **自动注入** — 新对话开始时自动注入记忆摘要

### Worktree 隔离

- **Git worktree 集成** — 每个对话可在独立 worktree 中操作
- **命令安全** — 确认对话框，支持智能通配符模式建议
- **Worktree 面板** — 侧面板显示活跃 worktree、分支和绑定任务

### 多 Agent 协作

- **多 Agent 团队** — 派生持久化团队成员，独立线程运行
- **消息总线** — 线程安全的收件箱/发件箱，Agent 间通信
- **UI 通知** — 团队成员完成工作时实时回调
- **空闲自动认领** — 空闲成员自动从任务板认领未分配任务

### 任务管理

- **持久化任务** — 跨对话存续的结构化任务
- **依赖图** — 任务间可设置阻塞关系（pending → in_progress → completed）
- **Worktree 绑定** — 绑定的 worktree 移除时任务自动完成

### RLM 并行处理

- **批量子任务** — 最多并行派发 16 个独立提示到 deepseek-v4-flash
- **应用场景** — 批量翻译、代码审查、多文件分析、数据提取
- **自动选模型** — 自动从已配置模型列表中选择 flash 模型

### 界面

- **pywebview 桌面应用** — 原生窗口 + Web 聊天界面
- **对话管理** — 侧边栏项目分组、拖拽排序、正文搜索、临时对话、归档、批量操作、重命名和删除
- **可折叠工具气泡** — 工具调用和结果以可折叠消息气泡展示
- **文件改动面板** — Agent 写文件后按文件累计显示增删行数，点击可查看带行号 diff 并在文件管理器中定位
- **聊天导航** — 上/下一条消息按钮，平滑滚动
- **Markdown & LaTeX** — 完整渲染，使用 marked.js 和 KaTeX（本地离线，无 CDN）
- **主题支持** — 深色/浅色主题，可调字体大小
- **上下文进度条** — 实时显示 token 用量和上下文利用率，切换对话时自动刷新
- **用量仪表盘** — 月度热力图、周度柱状图和模型分布环图，可查看输入、输出、总量、缓存命中/未命中
- **动态天气背景** — 城市昼夜随时间切换，并根据定位或指定城市显示晴、云、雨、雪、雾、雷暴；雨天支持 WebGL2 折射效果及 Canvas 降级

## 截图

> <img width="1238" height="748" alt="QQ20260524-122750-HD" src="https://github.com/user-attachments/assets/f334c249-8b9c-4176-bb22-6e3b364bb37e" />

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  pywebview (WebView2 / WebKit)                          │
│  ┌───────────────┐    JS ↔ Python API    ┌───────────┐  │
│  │  Frontend     │◄─────────────────────►│  Backend  │  │
│  │  HTML/CSS/JS  │                       │  Python   │  │
│  └───────────────┘                       └─────┬─────┘  │
└────────────────────────────────────────────────┼────────┘
                                                 │
         ┌───────────────────────────────────────┼──────┐
         │              Agent Loop               │      │
         │  ┌─────────┐  ┌──────────┐    ┌───────┴───┐  │
         │  │ Stream & │  │ Tool    │    │ Context   │  │
         │  │ Parse    │  │ Registry│    │ Manager   │  │
         │  └─────────┘  └──────────┘    └───────────┘  │
         └──────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────────────┐
         │                ▼                        │
         │  ┌──────┐ ┌────────┐ ┌───────┐ ┌────────┐ │
         │  │ File │ │ Search │ │  MCP  │ │Browser │ │
         │  │ I/O  │ │ (6 eng)│ │ Tools │ │ / SSH  │ │
         │  └──────┘ └────────┘ └───────┘ └────────┘ │
         └─────────────────────────────────────────┘
```

## 环境要求

- Windows 10/11，需安装 [WebView2 Runtime](https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/)（Win11 通常已预装）；或 macOS（使用系统自带 WebKit，无需额外运行时）
- Python 3.10+
- 至少一家 LLM 服务商的 API Key

## 安装

### 下载发行版

前往 [GitHub Releases](https://github.com/SolitudeZY/Deepseek-GUI/releases) 下载：

- Windows：`QuickModel-Setup.exe`（Inno Setup 安装程序）
- macOS Apple Silicon：`QuickModel-mac-arm64.zip`

### 从源码运行

```bash
git clone https://github.com/SolitudeZY/Deepseek-GUI.git
cd Deepseek-GUI

# requirements.txt 已按平台声明依赖；macOS 会自动安装 pyobjc
pip install -r requirements.txt

python main.py
```

### 打包

```bash
pip install pyinstaller

# Windows：生成 dist/QuickModel/ onedir 目录
pyinstaller QuickModel.spec --clean

# 再使用 Inno Setup 6 生成安装程序（PowerShell）
iscc /DMyAppVersion=X.Y.Z installer.iss

# macOS：生成 dist/QuickModel.app
pyinstaller main_mac.spec --clean
```

Windows 已从 `onefile` 切换为 `onedir + Inno Setup`，用于避免自更新重启时的 Python DLL 加载问题。Git tag `v*` 会触发 GitHub Actions 同时构建 Windows 安装包和 macOS `.app` 压缩包。正式发版请使用 `python bump_version.py X.Y.Z` 同步应用版本、提交、tag 和推送。

## 快速开始

> 详细图文教程请参阅 [使用说明](./使用说明.md) | [主流 LLM 模型的 API Base URL 汇总](./主流%20LLM%20模型的%20API%20Base%20URL%20汇总.md)

1. 启动后点击右上角 **设置**
2. 在「模型配置」中选择协议/服务商类型，填入 API Key、Base URL 和模型名；也可从 Claude/Codex 导入已有配置
3. 可选：在「MCP」中添加服务器，或导入本机 Claude/Codex MCP 配置
4. 可选：配置搜索引擎 Key、图片工具、云同步和动态天气背景
5. 保存设置，选择项目目录或直接开始无项目对话

## 使用技巧

- **思考模式**：复杂推理任务开启 high/max；简单问答用 off 节省 token
- **联网搜索**：研究任务用 auto 模式；想控制搜索用量时切换到 manual
- **临时对话**：不希望写入历史、搜索或云同步的内容，使用侧边栏「临时」入口
- **RLM**：让 Agent 批量处理任务（如"翻译这 10 段"），会自动使用并行子任务
- **Compact**：对话过长时使用 `/compact` 或等待自动压缩
- **日报/周报**：直接说“总结我上周的会话并生成周报”，Agent 会换算日期并读取对应历史
- **云同步**：设置同步文件夹后，点「一键上传全部」即可备份；新电脑点「一键导入全部」恢复
- **技能**：常用提示词保存为技能，下次直接调用

## 项目结构

```
quick_model/
├── main.py              # 入口
├── QuickModel.spec      # Windows onedir 打包配置
├── main_mac.spec        # macOS .app 打包配置
├── installer.iss        # Windows Inno Setup 安装程序
├── app/
│   ├── agent.py         # 核心 Agent 循环（拆分为流式解析/工具执行/上下文管理）
│   ├── tools.py         # 内置工具实现（文件、搜索、命令）
│   ├── browser_tools.py # Playwright 浏览器控制（Edge / Chrome）
│   ├── model_protocol.py # Chat Completions / Responses / Anthropic 协议适配
│   ├── mcp_client.py    # MCP stdio / Streamable HTTP 客户端
│   ├── external_config.py # Claude / Codex 配置发现与导入
│   ├── retrieval.py     # 网页/远程文档解析与图片提取
│   ├── advanced_tools.py # 子 Agent、任务、后台任务、Todo 管理
│   ├── skills.py        # 技能 CRUD、导入、记忆持久化
│   ├── team.py          # 多 Agent 团队、消息总线（线程安全）、Worktree
│   ├── sync.py          # 云同步模块（对话+配置 上传/检测/导入）
│   ├── webview_app.py   # pywebview API 桥接（Python ↔ JavaScript）
│   ├── config.py        # 配置加载/保存
│   ├── conversation.py  # 对话 CRUD、导入导出、排序
│   ├── compact.py       # 上下文压缩与摘要
│   ├── token_usage.py   # Token 用量记录与周/月聚合
│   ├── vision.py        # 图片描述与图片生成（Vision API）
│   └── static/          # HTML/CSS/JS 前端
│       ├── index.html   # 主界面布局
│       ├── core.js      # 全局状态与 DOM 引用（最先加载）
│       ├── render.js    # Markdown / KaTeX / 代码渲染
│       ├── drag.js      # 会话手动拖拽排序
│       ├── dialogs.js   # 提问、确认、图片灯箱、diff 等弹窗
│       ├── settings.js  # 设置、MCP、模型与同步管理
│       ├── starfield.js # 城市昼夜、天气、星轨背景引擎
│       ├── app.js       # 会话、消息、流式回调与主交互
│       ├── style.css    # 深色/浅色主题样式
│       └── animations.css # 动画与过渡效果
└── tests/               # 会话、模型协议、浏览器与用量测试
```

用户数据不写入仓库：Windows 位于 `%APPDATA%/AIDesktopAssistant/`，macOS 位于 `~/Library/Application Support/AIDesktopAssistant/`。

## 技术栈

- **前端**：pywebview（Windows: WebView2 / macOS: WebKit）、HTML/CSS/JS
- **后端**：Python 3.10+、OpenAI SDK、Anthropic SDK、MCP Python SDK
- **渲染**：marked.js、KaTeX、highlight.js（全部本地离线）
- **自动化**：Playwright（调用本机 Edge / Chrome）、Paramiko（SSH）、RapidOCR（本地 OCR）
- **并发**：threading + ThreadPoolExecutor（搜索抓取、后台命令、多 Agent 团队）
- **打包**：PyInstaller onedir + Inno Setup（Windows）、PyInstaller app bundle（macOS）

## 许可证

MIT
