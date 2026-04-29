# QuickModel

A desktop AI assistant for Windows supporting multiple LLM vendors via OpenAI-compatible API. Built with pywebview (WebView2) + Python backend.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

English | [中文](./README.zh.md)

## Features

### Core Agent
- **Multi-vendor LLM** — Works with any OpenAI-compatible API: DeepSeek (V3/R1/V4 Pro), OpenAI, Qwen, Ollama, and more
- **Multiple models per provider** — Configure and switch between multiple model backends in settings
- **Thinking mode** — Extended reasoning support with toolbar toggle (persisted across sessions)
- **Auto-Compact** — Context auto-summarizes at 80k tokens; manual `/compact` command also available
- **Image understanding** — Paste or drop images into chat; described via Qwen-VL or any vision API

### Tools Built into the Agent
| Tool | Description |
|------|-------------|
| `read_file` | Read local files (txt, md, py, json, csv, pdf, docx, xlsx, etc.) |
| `write_file` | Write or overwrite files on disk |
| `list_directory` | List directory contents |
| `run_command` | Execute PowerShell commands (with confirmation dialog) |
| `web_search` | Search the internet via Tavily API |
| `web_read` | Fetch and read full webpage content (HTML → plain text) |
| `compact` | Manually trigger context compression |
| `todo_write` | Maintain a structured task list for multi-step work tracking |

### Search Control
- **Auto / Manual modes** — Auto lets the model decide; manual gives you a toolbar toggle
- **Soft limit** — After 5 searches in one turn, the agent is nudged to consolidate results
- **`web_read` companion** — Fetch full page content when search snippets are insufficient

### Skills System
- **Built-in & custom skills** — Save and reuse prompt templates that change agent behavior
- **Import from folder** — Import Claude-style skills (auto-detects `SKILL.md` files)
- **Full CRUD panel** — Create, edit, and delete skills from a management UI

### Memory System
- **Persistent key-value store** — Agent can save and recall facts across conversations (`memory_read`, `memory_write`)
- **Export** — Export all memories as a formatted diff document

### Worktree Isolation
- **Git worktree integration** — Each conversation operates in its own isolated worktree
- **Command safety** — Confirmation dialog with wildcard pattern suggestions (`git *`, `python *`)
- **Worktree panel** — Side panel showing active worktrees, branches, and bound tasks

### Team Collaboration
- **Multi-agent teams** — Spawn persistent team members running in independent threads
- **Message bus** — In-memory inbox/outbox for agent-to-agent communication
- **UI notifications** — Real-time callback when team members complete work

### Task Management
- **Persistent tasks** — Structured tasks that survive across conversations
- **Dependency graph** — Tasks can block each other (pending → in_progress → completed)
- **Worktree binding** — Tasks auto-complete when bound worktrees are removed

### UI
- **pywebview desktop app** — Native window with web-based chat interface
- **Conversation management** — Sidebar with drag-to-reorder, search, rename, delete, export to Markdown
- **Collapsible tool bubbles** — Tool calls and results in collapsible message bubbles
- **Chat navigation** — Previous/next message buttons for long conversations
- **Markdown & LaTeX** — Full rendering with marked.js and KaTeX (offline, no CDN)
- **Theme support** — Light and dark themes, adjustable font size

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

pip install openai pywebview tavily-python

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

On first launch, open **Settings** to configure. Config is stored in `%APPDATA%\AIDesktopAssistant\config.json`.

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

| Key | Description |
|-----|-------------|
| `api_key` / `base_url` / `model` | Primary model configuration |
| `model_configs` | Multiple model backends (switchable in settings) |
| `thinking` | Thinking mode on by default |
| `search_mode` | `"auto"` = model decides; `"manual"` = user toggles via toolbar |
| `search_enabled` | When manual mode, whether search tools are available |
| `tavily_api_key` | API key for web search |
| `vision_api_key` / `vision_base_url` / `vision_model` | Vision model for image description |

## Supported Providers

| Provider | Base URL |
|----------|----------|
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Ollama (local) | `http://localhost:11434/v1` |
| DashScope (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Any OpenAI-compatible API | Custom URL |

## Usage Tips

- **Skills**: Open the skills panel to create or import specializations before starting a task
- **Worktrees**: When the agent needs to modify code, ask it to create a worktree first for isolation
- **Memory**: Tell the agent "remember this..." and it will save to persistent memory
- **Thinking**: Toggle off for faster responses on simple tasks; toggle on for complex reasoning
- **Search**: Use auto mode for research tasks; switch to manual when you want to control search usage
- **Compact**: If the conversation gets too long, use `/compact` or wait for auto-compact

## Project Structure

```
quick_model/
├── main.py              # Entry point
├── app/
│   ├── agent.py         # Core agent loop, tool dispatch, compact logic
│   ├── tools.py         # Built-in tool implementations (file, search, shell)
│   ├── advanced_tools.py # Sub-agent, task, background task, todo management
│   ├── skills.py        # Skill CRUD, import, memory persistence
│   ├── team.py          # Multi-agent team, message bus, worktree index
│   ├── webview_app.py   # pywebview API bridge (Python ↔ JavaScript)
│   ├── config.py        # Configuration loading/saving with defaults
│   ├── conversation.py  # Conversation CRUD, export, sort ordering
│   ├── compact.py       # Context compression and summarization
│   ├── vision.py        # Image description via vision API
│   ├── command_safety.py # Command allow-list and pattern matching
│   ├── static/          # HTML/CSS/JS frontend
│   │   ├── index.html   # Main UI layout
│   │   ├── app.js       # Frontend logic and event handling
│   │   └── style.css    # Dark/light theme styles
│   └── skills/          # Default skill definitions (.md files)
└── conversations/       # Conversation history (auto-created)
```

## Tech Stack

- **Frontend**: pywebview (WebView2), HTML/CSS/JS
- **Backend**: Python, OpenAI SDK
- **Rendering**: marked.js, KaTeX, highlight.js (all local, offline)
- **Packaging**: PyInstaller

## License

MIT
