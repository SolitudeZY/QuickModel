# QuickModel

Windows 桌面 AI 助手，支持通过 OpenAI 兼容 API 接入多家 LLM 服务商。基于 pywebview (WebView2) + Python 后端构建。

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[English](./README.md) | 中文

## 功能特性

- **多服务商支持** — 兼容任何 OpenAI 格式 API：DeepSeek、OpenAI、Qwen、Ollama 等
- **工具调用** — 文件读写、执行命令、网络搜索（Tavily）、目录浏览
- **思考模式** — 支持 DeepSeek V3.2、OpenAI o 系列、Anthropic Claude 的扩展推理
- **图片理解** — 拖拽图片即可分析，默认使用 Qwen-VL 视觉模型
- **Agent 循环** — 多轮工具调用，滑动窗口上下文管理
- **上下文压缩** — 超过 80k token 自动压缩，支持 `/compact` 手动压缩
- **Todo & 任务管理** — 模型维护的待办清单与持久化任务追踪
- **技能系统** — 保存并复用自定义提示词模板
- **记忆系统** — 持久化记忆文件，新对话时自动注入
- **Markdown & LaTeX** — 完整渲染支持，使用 marked.js 和 KaTeX（本地离线，无 CDN 依赖）
- **对话管理** — JSON 持久化存储，拖拽排序，重命名，导出为 Markdown
- **多 Agent** — 支持派生子 Agent 并行处理任务

## 截图

> 即将更新

## 环境要求

- Windows 10/11，需安装 [WebView2 Runtime](https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/)（Win11 通常已预装）
- Python 3.10+
- 至少一家 LLM 服务商的 API Key

## 安装

### 从源码运行

```bash
git clone https://github.com/SolitudeZY/QuickModel.git
cd quick-model

pip install -r requirements.txt

python main.py
```

### 下载预编译 .exe

从 [Releases](https://github.com/SolitudeZY/QuickModel/release) 下载 `QuickModel.exe`，双击直接运行，无需安装。

## 打包

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name QuickModel --add-data "app/static;app/static" main.py
```

输出文件：`dist/QuickModel.exe`

## 配置

首次启动后，点击右上角**设置**进行配置：

| 字段 | 说明 |
|------|------|
| API Key | LLM 服务商的 API 密钥 |
| Base URL | 服务商接口地址（如 `https://api.deepseek.com/v1`） |
| Model | 模型名称（如 `deepseek-chat`） |
| System Prompt | 默认系统提示词 |
| Tavily API Key | 网络搜索工具所需（可选） |
| Vision API | 图片理解所需（可选，默认：qwen-vl-max） |

配置文件存储于 `%APPDATA%\AIDesktopAssistant\config.json`。

## 支持的服务商

| 服务商 | Base URL |
|--------|----------|
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Ollama（本地） | `http://localhost:11434/v1` |
| DashScope（通义千问） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 其他 OpenAI 兼容 API | 自定义地址 |

## 技术栈

- **前端**：pywebview (WebView2)、HTML/CSS/JS
- **后端**：Python、OpenAI SDK
- **渲染**：marked.js、KaTeX、highlight.js（全部本地离线）
- **打包**：PyInstaller

## 许可证

MIT
