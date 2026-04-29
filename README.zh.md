# QuickModel

基于 pywebview 的桌面端 Agent 前端，通过各 AI 厂商的 chat-completion API 接入模型，具备完整的工具调用能力。在本地运行自主 Agent——读写文件、执行 PowerShell 命令、搜索网页、与子代理协作等，全部在隔离的 worktree 环境中进行。

## 功能特性

### 核心 Agent
- **多厂商支持** — DeepSeek（V3/R1/V4 Pro）、OpenAI、Anthropic，以及任意 OpenAI 兼容 API
- **多模型配置** — 在设置中配置并切换多个模型后端
- **思考模式** — 工具栏一键开关推理链（跨会话持久化）
- **自动压缩** — 上下文过长时自动总结并压缩对话历史，保持在 token 限制内
- **视觉理解** — 粘贴或拖拽图片到聊天中，通过视觉 API（千问 VL 或兼容接口）描述图片内容并附加为上下文

### 内置工具
| 工具 | 描述 |
|------|------|
| `read_file` | 读取本地文件（txt、md、py、json、csv、pdf、docx、xlsx 等） |
| `write_file` | 写入或覆盖磁盘文件 |
| `list_directory` | 列出目录内容 |
| `run_command` | 本地执行 PowerShell 命令 |
| `web_search` | 通过 Tavily API 搜索互联网 |
| `web_read` | 获取并阅读完整网页内容（HTML → 纯文本） |
| `compact` | 手动触发上下文压缩 |
| `todo_write` | 维护结构化待办清单，追踪多步骤工作进度 |

### 搜索控制
- **自动/手动模式** — 自动模式下模型自行决定何时搜索；手动模式下通过工具栏按钮开关搜索
- **软限制** — 单轮对话搜索达到 5 次后，系统自动提示 Agent 整理已有结果而非继续搜索
- **`web_read` 配套工具** — 搜索摘要不够详细时，Agent 可获取完整网页内容进行深入分析

### 技能系统（Skills）
- **内置技能** — 预设的 Agent 行为配置，改变模型处理任务的方式（如代码审查、研究、规划等）
- **自定义技能** — 创建自己的技能：名称、描述和提示词，会被注入到系统消息中
- **从文件夹导入** — 从本地文件夹导入 Claude 风格的技能（`.md` 文件），自动检测 `SKILL.md` 文件
- **技能编辑器** — 完整的创建/编辑/删除 UI 面板

### 记忆系统（Memory）
- **持久化键值存储** — 保存事实、偏好或上下文，跨对话记忆
- **记忆导出** — 将所有记忆导出为格式化文档
- 完整 API：`memory_read`、`memory_write` — Agent 可将记忆作为工具使用

### 工作树隔离（Worktree）
- **Git Worktree 集成** — 每个对话可在独立的 git worktree 中操作
- **工作树面板** — 侧面板显示活跃工作树及其分支和任务关联
- **默认安全** — 命令确认对话框，支持「全部允许」和通配符模式建议（`git *`、`python *`）
- **创建 / 列表 / 移除** — 通过 Agent 或手动完成工作树全生命周期管理

### 团队协作（Team）
- **多 Agent 团队** — 生成在独立线程中运行的持久化团队成员
- **消息传递** — Agent 通过内存消息总线（收件箱/发件箱）通信
- **通知回调** — 团队成员完成工作后 UI 接收实时通知
- **关闭协议** — 带确认的团队成员优雅关闭

### 任务管理（Task）
- **持久化任务** — 创建可跨对话存活的结构化任务
- **阻塞依赖** — 任务间可互相阻塞，形成依赖图
- **状态追踪** — pending → in_progress → completed/deleted 工作流
- **Worktree 移除时自动完成** — 可选择在移除 worktree 时将绑定任务标记为完成

### 用户界面
- **pywebview 桌面应用** — 原生窗口承载网页聊天界面
- **对话管理** — 侧边栏支持拖拽排序、搜索、重命名、删除对话
- **可折叠工具气泡** — 工具调用和结果以可折叠气泡形式展示
- **聊天导航** — 上/下一条消息按钮，长对话中平滑滚动
- **命令确认对话框** — 执行前审查并批准 shell 命令，支持通配符白名单
- **主题支持** — 浅色/深色主题，可调节字号

## 安装

```bash
# 1. 安装依赖
pip install openai pywebview tavily-python

# 2. 克隆仓库
git clone <repo-url>
cd quick_model

# 3. 创建配置
# 首次启动时会弹出设置面板。
# 配置你的 API 密钥和模型偏好。

# 4. 启动
python main.py
```

## 配置说明

所有设置保存在应用目录下的 `config.json` 中。关键设置项：

```json
{
  "api_key": "sk-...",
  "base_url": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "max_tokens": 8192,
  "temperature": 0.7,
  "theme": "dark",
  "font_size": 14,
  "thinking": true,
  "search_mode": "auto",
  "search_enabled": true,
  "tavily_api_key": "tvly-...",
  "model_configs": [
    {"label": "DeepSeek V3", "api_key": "sk-...", "base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
    {"label": "DeepSeek R1", "api_key": "sk-...", "base_url": "https://api.deepseek.com", "model": "deepseek-reasoner"}
  ]
}
```

| 配置项 | 说明 |
|--------|------|
| `api_key` / `base_url` / `model` | 主模型配置 |
| `model_configs` | 多模型后端（可在设置中切换） |
| `thinking` | 默认开启思考模式 |
| `search_mode` | `"auto"` = 模型自行决定搜索；`"manual"` = 用户手动开关 |
| `search_enabled` | 手动模式下搜索工具是否可用 |
| `tavily_api_key` | 网页搜索的 API 密钥 |
| `vision_api_key` / `vision_base_url` / `vision_model` | 用于图片描述的视觉模型 |

## 使用技巧

- **技能**：开始任务前先打开技能面板创建或导入专业化配置
- **工作树**：当 Agent 需要修改代码时，先让它创建 worktree 以隔离环境
- **记忆**：对 Agent 说「记住这个…」，它会保存到持久化记忆中
- **思考**：简单任务关闭思考模式以获得更快响应；复杂推理时开启
- **搜索**：研究类任务用自动模式；需要控制搜索用量时切换到手动模式
- **压缩**：对话过长时使用 `/compact` 或等待自动压缩

## 项目结构

```
quick_model/
├── main.py              # 入口文件
├── app/
│   ├── agent.py         # 核心 Agent 循环、工具分发、压缩逻辑
│   ├── tools.py         # 内置工具实现（文件、搜索、Shell）
│   ├── advanced_tools.py # 子代理、任务、后台任务、待办管理
│   ├── skills.py        # 技能 CRUD、导入、记忆持久化
│   ├── team.py          # 多 Agent 团队、消息总线、worktree 索引
│   ├── webview_app.py   # pywebview API 桥接（Python ↔ JavaScript）
│   ├── config.py        # 配置加载/保存，默认值
│   ├── conversation.py  # 对话 CRUD、导出、排序
│   ├── compact.py       # 上下文压缩和总结
│   ├── vision.py        # 通过视觉 API 进行图片描述
│   ├── command_safety.py # 命令白名单和模式匹配
│   ├── static/          # HTML/CSS/JS 前端
│   │   ├── index.html   # 主界面布局
│   │   ├── app.js       # 前端逻辑与事件处理
│   │   └── style.css    # 深色/浅色主题样式
│   └── skills/          # 默认技能定义（.md 文件）
└── conversations/       # 对话历史（自动创建）
```

## 许可证

MIT
