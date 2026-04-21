# AI Desktop Assistant — PRD

## 1. 产品概述

一个支持多厂商模型的桌面 AI 助手，通过 OpenAI 兼容 API 协议对接 DeepSeek、OpenAI、Ollama 等任意模型，支持自动工具调用（Function Calling），能读取文档、执行系统命令、联网搜索，本地持久化对话记录，打包为单文件 .exe 分发。

---

## 2. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| AI 后端 | OpenAI Python SDK（兼容模式） | 通过 `base_url` 对接任意厂商 |
| GUI 框架 | CustomTkinter | 现代风格，纯 Python，PyInstaller 友好 |
| 网络搜索 | Tavily API | 专为 AI Agent 设计，结构化结果 |
| 文档解析 | pdfplumber + python-docx + openpyxl | PDF / Word / Excel |
| 对话存储 | 每条对话独立 JSON 文件 | 存于 AppData/conversations/ |
| 打包 | PyInstaller | 单文件 .exe，~80MB |
| 配置存储 | JSON 文件（AppData/config.json） | 持久化模型配置、API Key |

---

## 3. 核心功能

### 3.1 多厂商模型配置

用户可在设置界面管理多套「模型配置」，每套配置包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 显示名，用户自定义 | `DeepSeek 官方` |
| API Key | 对应厂商的 Key | `sk-xxx` |
| Base URL | API 端点 | `https://api.deepseek.com/v1` |
| 模型名 | 模型 ID | `deepseek-chat` |
| 系统提示词 | 可选，每套配置独立 | `你是一个编程助手` |

内置预设（可编辑）：
- DeepSeek 官方：`https://api.deepseek.com/v1`
- OpenAI：`https://api.openai.com/v1`
- 本地 Ollama：`http://localhost:11434/v1`

主界面顶部下拉框切换当前使用的配置。

### 3.2 对话管理（左侧边栏）

```
┌──────────────┬────────────────────────────────┐
│ [+ 新对话]    │                                │
├──────────────┤        对话内容区域              │
│ ≡ 项目分析    │                                │
│ ≡ 代码审查    │                                │
│ ≡ 今日总结    │                                │
│              │                                │
│ [搜索对话...]  │                                │
└──────────────┴────────────────────────────────┘
```

侧边栏功能：
- **新建对话**：点击 `+ 新对话` 按钮
- **切换对话**：点击列表项加载历史
- **拖拽排序**：鼠标拖拽对话条目调整顺序，顺序持久化保存
- **自定义标题**：双击对话条目进入编辑模式，回车确认
- **右键菜单**：重命名 / 导出为 .md / 删除
- **搜索过滤**：底部搜索框，按标题或内容关键词过滤
- **自动命名**：新对话首条消息发送后，用前 20 字自动生成标题

### 3.3 对话界面

- 聊天气泡式对话历史（区分 user / assistant / tool_call / tool_result）
- 流式输出（streaming）显示 AI 回复
- 代码块语法高亮（使用 `tkinter.Text` + 自定义 tag）
- 支持多轮对话，完整上下文

### 3.4 工具调用（Function Calling）

AI 可自主决定调用以下工具：

| 工具名 | 功能 | 安全级别 |
|--------|------|----------|
| `read_file` | 读取文件内容（txt/md/py/json/csv/pdf/docx/xlsx） | 自动执行 |
| `list_directory` | 列出目录内容 | 自动执行 |
| `web_search` | Tavily 联网搜索 | 自动执行 |
| `run_command` | 执行 shell 命令 | 需用户确认 |
| `write_file` | 写入/覆盖文件 | 需用户确认 |

安全机制：
- `run_command` / `write_file` 执行前弹出确认对话框，显示完整参数
- 命令执行超时限制（默认 30s，可配置）
- 设置中可将命令执行设为「总是确认 / 自动执行 / 完全禁用」

### 3.5 文件拖拽

- 拖拽文件到输入框区域，自动读取内容附加到消息
- 支持格式：`.txt` `.md` `.py` `.json` `.csv` `.pdf` `.docx` `.xlsx`
- 大文件自动截断（默认前 50,000 字符），截断时提示用户

### 3.6 设置界面（Tab 布局）

**Tab 1 — 模型配置**
- 配置列表（增/删/改）
- 每条配置：名称、API Key（密码框）、Base URL、模型名、系统提示词

**Tab 2 — 工具设置**
- Tavily API Key
- 命令执行安全级别
- 命令超时时间

**Tab 3 — 界面设置**
- 主题（深色 / 浅色 / 跟随系统）
- 字体大小
- 侧边栏宽度

---

## 4. 对话 JSON 格式

```json
{
  "id": "conv_20260415_143022_a1b2",
  "title": "项目分析",
  "created_at": "2026-04-15T14:30:22",
  "updated_at": "2026-04-15T15:10:05",
  "model_config": "DeepSeek 官方",
  "sort_order": 0,
  "messages": [
    {"role": "user", "content": "帮我分析这个项目"},
    {"role": "assistant", "content": "...", "tool_calls": []},
    {"role": "tool", "tool_call_id": "xxx", "content": "..."}
  ]
}
```

侧边栏排序通过 `sort_order` 字段持久化，拖拽后批量更新。

---

## 5. 数据流

```
用户输入 / 文件拖拽
  │
  ▼
构建 messages（含历史 + 工具定义）
  │
  ▼
OpenAI SDK → base_url 路由到对应厂商
  │
  ├─► 直接回复 ──► 流式写入界面 ──► 保存 JSON
  │
  └─► tool_calls
        │
        ├─► 需确认工具 → 弹窗 → 用户批准/拒绝
        │
        ▼
      执行工具 → 获取结果
        │
        ▼
      追加 tool result → 再次调用 API（循环）
```

---

## 6. 文件结构

```
quick_model/
├── main.py                  # 入口
├── app/
│   ├── gui.py               # 主窗口（侧边栏 + 对话区）
│   ├── sidebar.py           # 对话列表侧边栏（拖拽排序）
│   ├── chat_view.py         # 对话内容区域（流式输出）
│   ├── agent.py             # API 调用 + 工具循环
│   ├── tools.py             # 工具实现
│   ├── config.py            # 配置读写
│   ├── conversation.py      # 对话 JSON 读写管理
│   └── settings_dialog.py   # 设置弹窗（3 Tab）
├── assets/
│   └── icon.ico
├── requirements.txt
└── build.spec
```

---

## 7. 非功能需求

- 启动时间 < 5s
- 支持 Windows 10/11 x64
- 无需安装 Python 环境
- API Key 存储在本地 AppData，不上传
- 对话文件存储在 AppData/conversations/，用户可手动备份
