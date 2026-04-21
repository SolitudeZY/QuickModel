# Quick Model — Project Context

## Overview
Desktop AI assistant (Windows .exe) supporting multiple LLM vendors via OpenAI-compatible API.
Built with **pywebview** (WebView2) frontend + Python backend. Packaged with PyInstaller.
Conda environment: `ai_api`

## Architecture

```
quick_model/
├── main.py                  # Entry point — pywebview window
├── app/
│   ├── webview_app.py       # Python API bridge exposed to JS
│   ├── agent.py             # Tool-calling loop, streaming, sliding window, compression
│   ├── advanced_tools.py    # TodoManager, TaskManager, BackgroundManager, subagent, compression
│   ├── tools.py             # read_file, write_file, run_command, list_directory, web_search
│   ├── vision.py            # Image understanding via Qwen-VL (or any vision API)
│   ├── conversation.py      # JSON persistence, sort_order, export to Markdown
│   ├── config.py            # AppData config, DEFAULT_MODEL_CONFIGS
│   └── static/
│       ├── index.html       # App shell
│       ├── app.js           # All frontend logic
│       ├── style.css        # Dark/light CSS variables
│       └── vendor/          # marked.min.js, katex, highlight.js (local, offline)
```

## Key Design Decisions

### Frontend: pywebview + WebView2
- `pywebview` uses system WebView2 (Edge) on Windows 10/11
- JS → Python: `window.pywebview.api.method(args)` returns Promise
- Python → JS: `window.evaluate_js('Chat.method(...)')` from background threads
- Markdown: **marked.js** (custom renderer for code blocks)
- LaTeX: **KaTeX** (full support including matrices, align environments)
- Code highlighting: **highlight.js** with github-dark theme
- All vendor libs in `app/static/vendor/` (offline, no CDN)

### Multi-vendor LLM
- OpenAI Python SDK with `base_url` parameter — works with DeepSeek, Ollama, Qwen, etc.
- Each "model config" stores: name, api_key, base_url, model, system_prompt
- Config persisted in `%APPDATA%/AIDesktopAssistant/config.json`

### Agent Loop (agent.py)
- Sliding window: `all_messages` = full history, `full_messages` = last 40 messages sent to API
- Context compression: `microcompact` clears old tool results (keeps last 4); `auto_compact` summarizes via LLM when >80k tokens
- Todo nag: if model has open todos and hasn't called `todo_write` in 3 rounds, injects reminder
- Background task notifications injected at start of each loop iteration

### Advanced Tools (advanced_tools.py)
- **TodoWrite** (`todo_write`): model-maintained checklist shown in side panel; max 20 items, 1 in_progress
- **TaskManager** (`task_create/get/update/list`): persistent JSON tasks in `%APPDATA%/.../tasks/`; supports blocked-by dependencies
- **BackgroundManager** (`background_run/check`): async shell commands with notification queue
- **Subagent** (`subagent`): spawns focused sub-agent with own tool loop (up to 30 rounds); Explore=read-only, General=+write
- **Context compression**: `microcompact` + `auto_compact` (transcripts saved to `%APPDATA%/.../transcripts/`)

### Conversation Storage
- One JSON file per conversation in `%APPDATA%/AIDesktopAssistant/conversations/`
- `sort_order >= 0` = manually pinned (drag-sorted), `sort_order = -1` = auto time-based
- `list_conversations()`: pinned sorted by sort_order, unpinned sorted by updated_at desc

### File Upload
- JS reads file as base64 via FileReader, sends to `save_uploaded_file()` in Python
- Saved to `%APPDATA%/AIDesktopAssistant/uploads/` with unique 8-char hex suffix
- Images → vision API (qwen-vl-max default); other files → read_file content injection

### Image Understanding
- Drag image onto input → base64 → `save_uploaded_file` → `describe_image` (qwen-vl-max)
- Config fields: `vision_api_key`, `vision_base_url`, `vision_model` (default: qwen-vl-max)
- Description injected as `[图片: filename]\n<description>` into user message

### Tool Calling
- Standard tools: `read_file`, `write_file`, `run_command`, `list_directory`, `web_search` (Tavily)
- `run_command` decodes bytes with locale→utf-8→gbk→cp936 fallback (Windows GBK fix)
- Stop mid-generation: always complete tool_result loop to avoid tool_call_id mismatch API error
- Confirm required for: `run_command`, `write_file` (configurable: confirm/auto/disabled)

### Sidebar
- Drag-sort with HTML5 drag API; persists via `reorder_conversations`
- Search filter on title
- Rename via ✏ button or double-click

## Dependencies (requirements.txt)
```
openai>=1.30.0
tavily-python>=0.3.3
pdfplumber>=0.11.0
python-docx>=1.1.0
openpyxl>=3.1.2
pywebview>=5.0
pyinstaller>=6.6.0
```

## Packaging
```bash
pyinstaller --onefile --windowed --name QuickModel --add-data "app/static;app/static" main.py
```
