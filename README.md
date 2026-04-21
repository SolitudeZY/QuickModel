# QuickModel

A desktop AI assistant for Windows supporting multiple LLM vendors via OpenAI-compatible API. Built with pywebview (WebView2) + Python backend.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

English | [中文](./README.zh.md)

## Features

- **Multi-vendor LLM** — Works with any OpenAI-compatible API: DeepSeek, OpenAI, Qwen, Ollama, and more
- **Tool calling** — File read/write, shell commands, web search (Tavily), directory listing
- **Thinking mode** — Extended reasoning support for DeepSeek V3.2, OpenAI o-series, and Anthropic Claude
- **Image understanding** — Drag & drop images, powered by Qwen-VL or any vision API
- **Agent loop** — Multi-turn tool calling with sliding window context management
- **Context compression** — Auto-compact at 80k tokens, manual `/compact` command
- **Todo & Task manager** — Model-maintained checklist and persistent task tracking
- **Skill system** — Save and reuse custom prompt templates
- **Memory system** — Persistent memory files injected on new conversations
- **Markdown & LaTeX** — Full rendering with marked.js and KaTeX (offline, no CDN)
- **Conversation management** — Persistent JSON storage, drag-sort, rename, export to Markdown
- **Multi-agent** — Spawn subagents for parallel tasks

## Screenshots

> Coming soon

## Requirements

- Windows 10/11 with [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Win11)
- Python 3.10+
- API key for at least one supported LLM provider

## Installation

### Run from source

```bash
git clone https://github.com/your-username/quick-model.git
cd quick-model

pip install -r requirements.txt

python main.py
```

### Download pre-built .exe

Download `QuickModel.exe` from [Releases](https://github.com/your-username/quick-model/releases) and run directly. No installation needed.

## Build

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name QuickModel --add-data "app/static;app/static" main.py
```

Output: `dist/QuickModel.exe`

## Configuration

On first launch, open **Settings** to configure:

| Field | Description |
|-------|-------------|
| API Key | Your LLM provider API key |
| Base URL | Provider endpoint (e.g. `https://api.deepseek.com/v1`) |
| Model | Model name (e.g. `deepseek-chat`) |
| System Prompt | Default assistant persona |
| Tavily API Key | For web search tool (optional) |
| Vision API | For image understanding (optional, default: qwen-vl-max) |

Config is stored in `%APPDATA%\AIDesktopAssistant\config.json`.

## Supported Providers

| Provider | Base URL |
|----------|----------|
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Ollama (local) | `http://localhost:11434/v1` |
| DashScope (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Any OpenAI-compatible API | Custom URL |

## Tech Stack

- **Frontend**: pywebview (WebView2), HTML/CSS/JS
- **Backend**: Python, OpenAI SDK
- **Rendering**: marked.js, KaTeX, highlight.js (all local, offline)
- **Packaging**: PyInstaller

## License

MIT
