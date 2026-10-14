# QuickModel

**把便宜模型用在日常，把强模型留给硬活——一个开源、可自己改的通用桌面 Agent。**

Windows / macOS 桌面 AI Agent：联网检索、读写文档、图片与 OCR、代码编辑，接任意模型。基于 pywebview（WebView2 / WebKit）+ Python 后端构建，支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 以及各类 OpenAI 兼容服务。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

中文 | [English](./README.en.md)

> 详细图文教程请参阅 [使用说明](./使用说明.md) | [MCP 使用指南](./MCP使用指南.md) | [主流 LLM 模型的 API Base URL 汇总](./主流%20LLM%20模型的%20API%20Base%20URL%20汇总.md)

---

大多数 AI 工作其实用不上最贵的模型——查资料、读文档、整理材料、写初稿，一个便宜模型配一个好用的 Agent 就够了；真正值得花大钱的，是写代码那种硬活。

QuickModel 就是照这个思路做的：**你的 Key 直连你的模型，数据存在你自己电脑上，中间不做任何路由。** 日常用 DeepSeek / Qwen / GLM 省钱，需要时在一个窗口里切到 GPT / Claude，不用为整块订阅付全价。MIT 开源，代码全在仓库里，缺什么自己加。

## 它和别的 AI 助手不一样在哪

- **不做模型路由，没有私活** —— 你的 API Key、你的 Base URL，请求直连服务商。不经过中转、不偷偷加价、没有"额度用完请充值"。
- **一个客户端，接所有模型** —— 原生支持 OpenAI Chat Completions / Responses、Anthropic Messages，兼容 DeepSeek、Qwen、GLM、Ollama；多套模型配置随时切换，各带自己的上下文阈值。还能一键导入本机 Claude Code / Codex 的模型与 MCP 配置。
- **数据在你自己电脑上** —— 对话、记忆、配置默认存本地；要跨机，一键同步到坚果云 / OneDrive 即可，**不用注册任何账号**。不想留痕的对话用「临时对话」，不写盘。
- **不止写代码** —— 6 引擎联网搜索、PDF / Word / Excel 直读、网页图片提取、离线 OCR、图片理解与生成、跨会话记忆、读历史会话出日报周报。是一个"研究 + 写作 + 处理"的通用工作台，不是聊天框套壳。
- **免费、开源、可 Fork** —— MIT。想改行为、加工具、接自己的服务，直接读 Python 源码。

## 适合谁

- 已经在用 Claude Code / Codex 这类 Agent，但嫌终端麻烦、想要桌面 GUI 的人
- 想用便宜国产模型干日常、只有硬活才上强模型的人
- 需要一个"能查、能读、能写、能处理图片"的助手，而不只是会写代码的人
- 在意隐私，想让数据留在本地、不想注册账号 / 被路由的人
- 想读得懂、甚至改得动这套 Agent 的开发者

**可能不适合你**：只想待在终端里写代码（那类 Claude Code 更成熟）；想完全开箱即用、不愿碰任何配置（这里需要你自备模型 API Key）；想找能在手机或网页上随时用的（这是桌面应用）。

## 它能干什么

最常用的几类场景：

- **信息检索** —— 一句"帮我查一下 X，整理成要点"，自动多引擎搜索、并发抓取正文、汇总结论；论坛正文保留结构，远程 PDF / Word 直接读。
- **文档编写** —— 读本地 txt / md / docx / xlsx / pdf，或结合联网资料写初稿、周报、材料；改格式、批量替换、写生成 docx / pptx 的脚本这类脏活交给它。
- **图片与截图** —— 文字型截图走本地离线 OCR，不花视觉额度；图表趋势、布局、画面语义再交给视觉模型；还能按指令改图、生成图。
- **总结与回顾** —— "总结我上周的会话并生成周报"，它自己换算日期、读历史、写出来。
- **代码与工程** —— 读写文件、精确 patch、跑命令、git、MCP、子 Agent、多 Agent 协作，一样不缺。

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

### 联网检索

- **6 种搜索后端** — Tavily、Brave Search、Firecrawl、Google Custom Search、SearXNG、DuckDuckGo
- **自动降级** — 首选引擎失败时自动尝试下一个；DuckDuckGo（免费无需 Key）作为最终兜底
- **并行抓取** — 搜索结果页面并发抓取全文（最多 5 线程），大幅减少等待时间
- **手动/自动模式** — Auto 由模型决定是否搜索；Manual 通过工具栏开关控制
- **软限制** — 单轮超过 5 次搜索后提示模型整合结果

### 文档与图文处理

- **本地文档直读** — `read_file` 支持 txt、md、py、json、csv、pdf、docx、xlsx 等格式
- **远程文档直读** — URL 指向 PDF 或 DOCX 时自动识别、缓存并提取文字，PDF 文字带页码标记
- **论坛正文保留结构** — `web_read` 正文优先解析，保留段落换行，并识别 `srcset` 与常见懒加载图片
- **文档图片提取** — `extract_images` 可按页渲染 PDF（保留图、图注与版式），也可仅提取内嵌位图或 Word 媒体
- **OCR 优先、视觉按需** — 文字型截图与扫描件走本地 RapidOCR，无需视觉 API；只有场景、布局、趋势或空间关系才调用 `analyze_image`

### 图片工具

- **针对性图片分析** — 发送图片时仅附绝对路径，由主模型按当前问题调用 `analyze_image` 做针对性分析（而非预生成通用描述）。内置反幻觉约束，只报告实际可见内容、区分观察与推测（默认 Qwen-VL）
- **图片生成** — 调用 `generate_image` 经 OpenAI 兼容 `/v1/images/generations` 生成图片，支持 New API / sub2api 等中转，保存到本地并在对话中显示缩略图卡片
- **图片编辑（指令式）** — 调用 `edit_image` 按文字指令编辑已有图片（替换物体、增删元素、改图中文字、风格迁移等），基于阿里 Qwen-Image-Edit
- **本地 OCR** — 调用 `ocr_image` 用 RapidOCR(ONNX) 引擎离线识别图片文字，速度快、不消耗视觉模型额度
- **读取模型列表** — 设置面板可一键拉取视觉/生图服务商的可用模型列表，点击直接填入
- **配套配置** — 视觉与生图各自独立的 `api_key` / `base_url` / `model`，设置面板「图片工具」标签分子页配置

### 模型与记忆

- **多协议多服务商** — 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；兼容 DeepSeek、OpenAI、Claude、Qwen、GLM、Ollama 及常见中转服务
- **多模型配置** — 设置中可配置多个模型后端，随时切换；每个模型可独立设置上下文长度和压缩阈值
- **思考模式 (off / high / max)** — 三级推理强度，工具栏按钮循环切换，跨会话持久化
- **自动压缩** — 上下文超过阈值自动摘要压缩（默认 600K，可自定义）；支持 `/compact` 手动压缩；前缀缓存感知压缩保留 DeepSeek 缓存命中
- **提示词预设** — 内置通用、探索研究、文档整理、代码编写、代码审查五种模板，仅在用户主动应用时替换模型提示词
- **跨会话记忆** — 模型记住用户偏好与项目背景，新会话自动带上；完成任务/解决 bug 后主动询问是否记入长期记忆（用户确认才写，不擅自存）；设置面板可查看/编辑/删除记忆条目
- **Token 用量追踪** — 侧边栏显示本轮/本次 Agent 运行的输出 token 与缓存命中率；用量面板提供月、周、模型维度统计

### 会话管理

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

### 文件、命令与工程

- **文件工具** — `read_file` / `write_file` / `apply_patch` / `list_directory` / `glob_files` / `grep_files`
- **精确 patch** — `apply_patch` 用原文片段替换修改文件，支持多处/多文件编辑；匹配不到或不唯一时报错而非写坏文件
- **跨平台 Shell** — Windows 优先使用 Git for Windows 的 bash，未安装时回退 PowerShell，macOS/Linux 使用 `/bin/bash`；输出编码自适应，减少中文乱码
- **命令确认与白名单** — 执行命令前弹确认对话框，可将命令加入允许列表实现后续自动执行，支持智能通配符模式建议
- **项目分组与工作目录** — 会话可绑定项目文件夹，工具相对路径以此为基准，根治模型把文件写到错误目录的问题；侧边栏按项目分组，支持拖拽归类
- **Worktree 隔离** — Git worktree 集成，每个对话可在独立 worktree 中操作，带工作树面板与命令确认

### 多 Agent 与任务

- **子 Agent** — `subagent` 派生独立执行工具循环的子代理，带独立轮次/时间预算
- **多 Agent 团队** — 派生持久化团队成员、独立线程运行，线程安全的消息总线，空闲成员自动认领任务
- **持久化任务** — 跨对话存续的结构化任务，支持依赖图（pending → in_progress → completed）与 worktree 绑定
- **RLM 并行** — 最多并行派发 16 个子任务到低成本模型，适用于批量翻译、代码审查、多文件分析、数据提取

### 扩展与接入

- **MCP 客户端** — 支持 stdio 与 Streamable HTTP 两种传输方式，连接后的工具动态注册到 Agent；设置中可视化管理与测试
- **Claude / Codex 导入** — 自动发现用户目录和当前项目中的 Claude Code、Codex 配置，可勾选导入模型或 MCP Server
- **技能系统** — 保存并复用提示词模板，支持从文件夹导入 Claude 风格 `SKILL.md` 技能（批量导入）
- **浏览器控制** — 使用本机 Edge / Chrome 启动独立、可见的浏览器会话，支持快照、点击、输入、滚动；不复用默认登录态，敏感信息必须用户手动填写
- **SSH ReAct** — 支持密钥、SSH Agent 或默认私钥建立持久连接，逐条执行远程命令并根据输出继续操作
- **其他工具** — `background_run` / `background_check`、`todo_write`、`ask_user_question`、`enter_plan_mode` / `exit_plan_mode`、`compact`、`read_conversations_by_date`、`memory_read` / `memory_write`

### 界面

- **pywebview 桌面应用** — 原生窗口 + Web 聊天界面
- **对话管理** — 侧边栏项目分组、拖拽排序、正文搜索、临时对话、归档、批量操作、重命名和删除
- **可折叠工具气泡** — 工具调用和结果以可折叠消息气泡展示
- **文件改动面板** — Agent 写文件后按文件累计显示增删行数，点击可查看带行号 diff 并在文件管理器中定位
- **Markdown & LaTeX** — 完整渲染，使用 marked.js 和 KaTeX（本地离线，无 CDN）
- **主题支持** — 深色/浅色主题，可调字体大小；上下文进度条实时显示 token 用量
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

前往 [GitHub Releases](https://github.com/SolitudeZY/QuickModel/releases) 下载：

- Windows：`QuickModel-Setup.exe`（Inno Setup 安装程序）
- macOS Apple Silicon：`QuickModel-mac-arm64.zip`

### 从源码运行

```bash
git clone https://github.com/SolitudeZY/QuickModel.git
cd QuickModel

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

## 使用技巧

- **思考模式**：复杂推理任务开启 high/max；简单问答用 off 节省 token
- **联网搜索**：研究任务用 auto 模式；想控制搜索用量时切换到 manual
- **临时对话**：不希望写入历史、搜索或云同步的内容，使用侧边栏「临时」入口
- **RLM**：让 Agent 批量处理任务（如"翻译这 10 段"），会自动使用并行子任务
- **Compact**：对话过长时使用 `/compact` 或等待自动压缩
- **日报/周报**：直接说"总结我上周的会话并生成周报"，Agent 会换算日期并读取对应历史
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