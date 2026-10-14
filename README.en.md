# QuickModel

**Run everyday work on cheap models, save the strong ones for hard problems — an open-source, hackable, general-purpose desktop agent.**

A desktop AI agent for Windows and macOS: web research, document reading and writing, images and OCR, and code editing, with whatever model you like. Built with pywebview (WebView2 / WebKit) and a Python backend, with native support for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and OpenAI-compatible providers.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[中文](./README.md) | English

> See the [Usage Guide (Chinese)](./使用说明.md) | [MCP Guide (Chinese)](./MCP使用指南.md) | [LLM API Base URL Reference](./主流%20LLM%20模型的%20API%20Base%20URL%20汇总.md)

---

Most AI work doesn't need the most expensive model — searching, reading documents, organizing material, and drafting are fine with a cheap model and a good agent. What's actually worth paying top dollar for is hard work like coding.

That's the idea behind QuickModel: **your key connects straight to your model, your data stays on your own machine, and nothing is routed in between.** Use DeepSeek / Qwen / GLM for everyday work, switch to GPT / Claude in the same window when you need it, and skip paying full price for a whole subscription. MIT-licensed, all the code is in the repo — add whatever you're missing.

## How it's different

- **No model routing, no markup** — your API key, your base URL, straight to the provider. No middleman, no hidden markup, no "your credits ran out, please top up."
- **One client, every model** — native OpenAI Chat Completions / Responses and Anthropic Messages, compatible with DeepSeek, Qwen, GLM, Ollama; multiple model configs you can switch between anytime, each with its own context threshold. Import your local Claude Code / Codex model and MCP configs in one click.
- **Your data stays on your machine** — conversations, memory, and config are local by default; to move machines, sync them to Nutstore / OneDrive in one click, **no account required**. Use "Temporary chat" for conversations you don't want written to disk.
- **Not just coding** — 6-engine web search, direct PDF / Word / Excel reading, web image extraction, offline OCR, image understanding and generation, cross-conversation memory, and daily/weekly reports from your history. A "research + writing + processing" workbench, not a chat box in a wrapper.
- **Free, open-source, forkable** — MIT. Want to change behavior, add tools, or wire up your own service? Just read the Python.

## Who it's for

- People already using agents like Claude Code / Codex but tired of the terminal and wanting a desktop GUI
- People who want to run everyday work on a cheap domestic model and only pay up for hard problems
- People who want an assistant that can search, read, write, and handle images — not just one that writes code
- People who care about privacy and want data local, without signing up or being routed
- Developers who want to read — or even modify — the agent

**Probably not for you if**: you only ever work in the terminal (the Claude Code line is more mature); you want zero-configuration out of the box (you bring your own model API key here); or you want something to use on your phone or in a browser (this is a desktop app).

## What it can do

The most common scenarios:

- **Research** — say "look up X and summarize it" and it searches several engines, fetches pages in parallel, and writes up the findings; forum threads keep their structure, and remote PDFs / Word docs are read directly.
- **Document writing** — read local txt / md / docx / xlsx / pdf, or draft reports and material from web sources; hand it the grunt work (reformatting, bulk replace, scripts that generate docx / pptx).
- **Images & screenshots** — text-heavy screenshots go through local offline OCR and cost no vision credits; chart trends, layout, and semantics go to the vision model; it can also edit and generate images on request.
- **Summaries & reviews** — "summarize last week's conversations into a weekly report" — it resolves the dates, reads history, and writes it.
- **Code & engineering** — file read/write, precise patches, shell commands, git, MCP, sub-agents, and multi-agent collaboration are all there.

## 30-second start

1. Grab `QuickModel-Setup.exe` (Windows) or the `.app` archive (macOS) from [Releases](https://github.com/SolitudeZY/QuickModel/releases); or run from source: `git clone` → `pip install -r requirements.txt` → `python main.py`
2. Open **Settings → Model Config** and enter any provider's API Key / Base URL / model name (you can also import from Claude Code / Codex)
3. Start chatting. Turn on search for the web, drop in an image for OCR.

## Recent Updates

- **Expanded conversation workflows** — Temporary conversations, archive view, project-level archive, and bulk archive/restore/delete; long project groups collapse automatically and search covers titles and visible message content
- **Usage analytics** — Monthly heatmap, weekly bar chart, and model distribution chart with output/input/total token views, cache metrics, and estimated-usage tracking
- **Native model protocols** — OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages, plus provider-specific handling for DeepSeek, Qwen, GLM, and Codex; import local Claude/Codex model and MCP configs
- **Controlled browser** — The agent can launch an isolated Edge/Chrome session, inspect pages, click, type, and scroll; interactive actions use the existing confirmation policy and secrets stay user-entered
- **Immersive weather backgrounds** — Time-aware city scenes driven by Open-Meteo weather, with clouds, rain, snow, fog, thunderstorms, light motes, and star trails; includes manual previews and effect controls
- **More reliable sub-agents** — Sub-agents inherit the current project directory and use dedicated round/time budgets, repeated-call detection, and forced summarization to avoid stalling the main task

## Features

### Web Search

- **6 search backends** — Tavily, Brave Search, Firecrawl, Google Custom Search, SearXNG, DuckDuckGo
- **Auto-fallback** — If the preferred engine fails, automatically tries the next; DuckDuckGo (free) as ultimate fallback
- **Parallel fetching** — Search result pages fetched concurrently (up to 5 threads), significantly reducing wait time
- **Soft limit** — After 5 searches in one turn, the agent is nudged to consolidate results
- **Manual / Auto modes** — Auto lets the model decide; manual gives you a toolbar toggle

### Documents & Text-Image Handling

- **Local document reading** — `read_file` supports txt, md, py, json, csv, pdf, docx, xlsx, and more
- **Direct remote document reading** — PDF and DOCX URLs are detected, cached, and parsed automatically; PDF text includes page markers
- **Forum-aware text extraction** — `web_read` prioritizes readable content, preserves paragraph boundaries, and recognizes `srcset` and common lazy-load image attributes
- **Document image extraction** — `extract_images` can render selected PDF pages (preserving figures, captions, and layout), extract embedded PDF bitmaps, or unpack Word media
- **OCR first, vision on demand** — Text-heavy screenshots and scans use the bundled RapidOCR and need no vision API; only scenes, layouts, trends, and spatial relationships call `analyze_image`

### Image Tools

- **Targeted image analysis** — Only the absolute path is attached on send. The main model calls `analyze_image` with a question tailored to the current conversation (rather than a pre-generated generic description). Built-in anti-hallucination constraints make the vision model report only what is actually visible and distinguish observation from speculation. Uses Qwen-VL or any vision API by default
- **Image generation** — `generate_image` calls an OpenAI-compatible `/v1/images/generations` endpoint (supports relays like New API / sub2api), saves locally, and renders a thumbnail card inline
- **Instruction-based image editing** — `edit_image` modifies an existing image from text instructions (replacing objects, adding/removing elements, editing visible text, style transfer), using Qwen-Image-Edit
- **Local OCR** — `ocr_image` uses the bundled RapidOCR ONNX engine offline, avoiding vision-model latency and usage charges for text extraction
- **Fetch model list** — One click in settings pulls the available model list from your vision/image-gen provider; click to fill it in
- **Separate config** — Independent `api_key` / `base_url` / `model` for vision and image-gen, configured under the "Image Tools" tab in settings

### Models & Memory

- **Multiple protocols and providers** — OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages, with support for DeepSeek, OpenAI, Claude, Qwen, GLM, Ollama, and common API relays
- **Multiple model configs** — Configure and switch between multiple model backends; each model has independent context length and compact threshold settings
- **Reasoning intensity (off / high / max)** — Three-level thinking mode cycled via toolbar button; persisted across sessions
- **Auto-Compact** — Context auto-summarizes when exceeding threshold (default 600K, customizable); manual `/compact` command; prefix-cache-aware compression preserves DeepSeek cache hits
- **Prompt presets** — General, research, document organization, coding, and code review templates; prompts change only when explicitly applied
- **Cross-conversation memory** — Remembers approved user preferences and project context across conversations; memory entries can be viewed, edited, and deleted in settings
- **Token usage tracking** — The sidebar shows output tokens for the current round/agent run and cache hit rate; the usage dashboard aggregates by month, week, and model

### Conversation Management

- **Temporary conversations** — Kept in memory only and excluded from disk persistence, the sidebar, search, archives, and cloud sync; discarded when switching back to a persistent conversation
- **Archive and bulk management** — Separate active/archive views with per-conversation, whole-project, and multi-select archive/restore/delete actions; actively generating conversations are protected
- **Compact long lists** — Each project shows its five most recent conversations by default and can be expanded; timestamps are visible in the sidebar
- **Visible-content search** — Searches titles and user/assistant message text while ignoring hidden tool results
- **Daily and weekly reports** — The agent can read complete conversations by date range and use the injected current date to prepare daily, weekly, or milestone summaries

### Cloud Sync & Import/Export

- **One-click full sync** — Upload all conversations + config files to a cloud folder (Nutstore / OneDrive / Google Drive)
- **One-click full import** — Import all conversations and config on a new machine with a single click
- **Auto-upload** — Conversations automatically copied to the sync folder after completion
- **Startup detection** — Automatically detects new conversations from the cloud on launch
- **Selective import** — Checkbox interface to choose which conversations to import
- **Config sync** — API keys, model configs, allowed commands all synced (local sync path is preserved)
- **Export to Markdown** — Exports only user and assistant content, excluding tool calls
- **Import conversations** — Import from .json (full backup) or .md (exported format) files

### Files, Shell & Engineering

- **File tools** — `read_file` / `write_file` / `apply_patch` / `list_directory` / `glob_files` / `grep_files`
- **Precise patching** — `apply_patch` edits files by exact substring replacement, supports multiple edits/files, and errors out instead of corrupting the file when no/ambiguous match
- **Cross-platform shell** — Git for Windows bash is preferred so common Unix commands work directly; PowerShell is used as a fallback, while macOS/Linux use `/bin/bash`. Adaptive output decoding reduces garbled Chinese output
- **Confirmation & allow-list** — Confirmation dialog before running commands; commands can be added to an allow-list for subsequent auto-execution; smart wildcard pattern suggestions
- **Project grouping & working dir** — Each conversation can bind a project folder; tool relative paths resolve against it, fixing the model writing files to the wrong directory. Sidebar grouped by project with drag support
- **Worktree isolation** — Git worktree integration so each conversation can operate in its own worktree, with a worktree panel and command confirmation

### Multi-Agent & Tasks

- **Sub-agents** — `subagent` spawns a focused sub-agent with its own tool loop and dedicated round/time budget
- **Multi-agent teams** — Spawn persistent team members running in independent threads with a thread-safe message bus; idle members auto-claim tasks
- **Persistent tasks** — Structured tasks that survive across conversations, with a dependency graph (pending → in_progress → completed) and worktree binding
- **RLM parallel processing** — Dispatch up to 16 sub-tasks to a low-cost model in parallel, for bulk translation, code review, multi-file analysis, and data extraction

### Extensions & Integrations

- **MCP client** — Supports stdio and Streamable HTTP transports; connected tools are registered dynamically with the agent and manageable in settings
- **Claude / Codex import** — Discover global and project-level Claude Code and Codex configs, then selectively import model configs or MCP Servers
- **Skills system** — Save and reuse prompt templates, and import Claude-style `SKILL.md` skills from a folder (batch import)
- **Browser control** — Launch a visible, isolated session in the locally installed Edge or Chrome with snapshots, click, type, and scroll; the default login state is never reused and secrets must be entered manually
- **SSH ReAct** — Connect with a key, SSH agent, or default private key and execute remote commands step by step in a ReAct loop
- **Other tools** — `background_run` / `background_check`, `todo_write`, `ask_user_question`, `enter_plan_mode` / `exit_plan_mode`, `compact`, `read_conversations_by_date`, `memory_read` / `memory_write`

### UI

- **pywebview desktop app** — Native window with a web-based chat interface
- **Conversation management** — Project grouping, drag-to-reorder, visible-content search, temporary conversations, archives, bulk actions, rename, and delete
- **Collapsible tool bubbles** — Tool calls and results in collapsible message bubbles
- **File change panel** — File writes are grouped by path with cumulative added/removed line counts; click to inspect a line-numbered diff or locate the file
- **Markdown & LaTeX** — Full rendering with marked.js and KaTeX (offline, no CDN)
- **Theme & progress** — Light and dark themes, adjustable font size; a context progress bar shows real-time token usage
- **Usage dashboard** — Monthly heatmap, weekly bars, and model distribution with input, output, total, cache-hit, and cache-miss metrics
- **Dynamic weather background** — Time-aware city scenes with clear, cloudy, rain, snow, fog, and thunder states; rain uses WebGL2 refraction with a Canvas fallback

## Screenshots

> <img width="1238" height="748" alt="QQ20260524-122750-HD" src="https://github.com/user-attachments/assets/f334c249-8b9c-4176-bb22-6e3b364bb37e" />

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  pywebview (WebView2 / WebKit)                          │
│  ┌───────────────┐    JS ↔ Python API    ┌───────────┐ │
│  │  Frontend     │◄─────────────────────►│  Backend  │ │
│  │  HTML/CSS/JS  │                       │  Python   │ │
│  └───────────────┘                       └─────┬─────┘ │
└────────────────────────────────────────────────┼────────┘
                                                 │
         ┌───────────────────────────────────────┼──────┐
         │              Agent Loop               │      │
         │  ┌─────────┐  ┌──────────┐  ┌───────┴───┐  │
         │  │ Stream & │  │ Tool     │  │ Context   │  │
         │  │ Parse    │  │ Registry │  │ Manager   │  │
         │  └─────────┘  └──────────┘  └───────────┘  │
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

## Requirements

- Windows 10/11 with [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Win11); or macOS (uses the built-in WebKit, no extra runtime)
- Python 3.10+
- At least one LLM provider API key

## Installation

### Download a Release

Download the latest build from [GitHub Releases](https://github.com/SolitudeZY/QuickModel/releases):

- Windows: `QuickModel-Setup.exe` (Inno Setup installer)
- macOS Apple Silicon: `QuickModel-mac-arm64.zip`

### Run from source

```bash
git clone https://github.com/SolitudeZY/QuickModel.git
cd QuickModel

# requirements.txt includes platform markers; pyobjc is installed on macOS
pip install -r requirements.txt

python main.py
```

### Build

```bash
pip install pyinstaller

# Windows: produce the dist/QuickModel/ onedir bundle
pyinstaller QuickModel.spec --clean

# Then build the installer with Inno Setup 6 (PowerShell)
iscc /DMyAppVersion=X.Y.Z installer.iss

# macOS: produce dist/QuickModel.app
pyinstaller main_mac.spec --clean
```

Windows uses `onedir + Inno Setup` instead of `onefile` to avoid Python DLL load failures after an in-app update. A `v*` Git tag triggers GitHub Actions to build both the Windows installer and macOS app archive. Use `python bump_version.py X.Y.Z` for releases so the application version, commit, tag, and push stay synchronized.

## Tips

- **Thinking mode**: Use high/max for complex reasoning; off for simple Q&A to save tokens
- **Web search**: Use auto mode for research tasks; switch to manual to control search usage
- **Temporary chat**: Use the sidebar's temporary entry for conversations that should not enter history, search, or cloud sync
- **RLM**: Ask the agent to batch-process tasks (e.g., "translate these 10 paragraphs") and it will use parallel sub-tasks
- **Compact**: If the conversation gets too long, use `/compact` or wait for auto-compact
- **Daily/weekly reports**: Ask the agent to summarize last week's conversations; it will resolve the dates and load the matching history
- **Cloud sync**: After setting the sync folder, click "Upload All" to back up; on a new PC click "Import All" to restore
- **Skills**: Save frequently-used prompts as skills for quick reuse

## Project Structure

```
quick_model/
├── main.py              # Entry point
├── QuickModel.spec      # Windows onedir build config
├── main_mac.spec        # macOS app bundle config
├── installer.iss        # Windows Inno Setup installer
├── app/
│   ├── agent.py         # Core agent loop (split into stream/parse, tool exec, context mgmt)
│   ├── tools.py         # Built-in tool implementations (file, search, shell)
│   ├── browser_tools.py # Playwright browser control (Edge / Chrome)
│   ├── model_protocol.py # Chat Completions / Responses / Anthropic adapters
│   ├── mcp_client.py    # MCP stdio / Streamable HTTP client
│   ├── external_config.py # Claude / Codex config discovery and import
│   ├── retrieval.py     # Web/remote document parsing and image extraction
│   ├── advanced_tools.py # Sub-agent, task, background task, todo management
│   ├── skills.py        # Skill CRUD, import, memory persistence
│   ├── team.py          # Multi-agent team, message bus (thread-safe), worktree
│   ├── sync.py          # Cloud sync module (conversations + config upload/detect/import)
│   ├── webview_app.py   # pywebview API bridge (Python ↔ JavaScript)
│   ├── config.py        # Configuration loading/saving with defaults
│   ├── conversation.py  # Conversation CRUD, import/export, sort ordering
│   ├── compact.py       # Context compression and summarization
│   ├── token_usage.py   # Token records and weekly/monthly aggregation
│   ├── vision.py        # Image description & image generation via vision API
│   └── static/          # HTML/CSS/JS frontend
│       ├── index.html   # Main UI layout
│       ├── core.js      # Shared state and DOM references (loaded first)
│       ├── render.js    # Markdown, KaTeX, and code rendering
│       ├── drag.js      # Manual conversation drag/reorder engine
│       ├── dialogs.js   # Questions, confirmation, lightbox, and diff dialogs
│       ├── settings.js  # Settings, MCP, model, and sync management
│       ├── starfield.js # City, weather, and star-trail background engine
│       ├── app.js       # Conversations, messages, streaming callbacks, main UI
│       ├── style.css    # Dark/light theme styles
│       └── animations.css # Animation and transition effects
└── tests/               # Conversation, protocol, browser, and usage tests
```

User data stays outside the repository: `%APPDATA%/AIDesktopAssistant/` on Windows and `~/Library/Application Support/AIDesktopAssistant/` on macOS.

## Tech Stack

- **Frontend**: pywebview (WebView2 on Windows / WebKit on macOS), HTML/CSS/JS
- **Backend**: Python 3.10+, OpenAI SDK, Anthropic SDK, MCP Python SDK
- **Rendering**: marked.js, KaTeX, highlight.js (all local, offline)
- **Automation**: Playwright (local Edge / Chrome), Paramiko (SSH), RapidOCR (offline OCR)
- **Concurrency**: threading + ThreadPoolExecutor (search fetching, background commands, multi-agent teams)
- **Packaging**: PyInstaller onedir + Inno Setup on Windows; PyInstaller app bundle on macOS

## License

MIT