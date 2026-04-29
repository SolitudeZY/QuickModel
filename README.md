# QuickModel

A desktop Agent frontend powered by pywebview, connecting to AI models through their chat-completion APIs with full tool-use capabilities. Run an autonomous agent locally — read/write files, execute PowerShell commands, search the web, collaborate with sub-agents, and more, all within an isolated worktree environment.

## Features

### Core Agent
- **Multi-Provider Support** — DeepSeek (V3/R1/V4 Pro), OpenAI, Anthropic, and any OpenAI-compatible API
- **Multiple Models per Provider** — Configure and switch between multiple model backends in settings
- **Thinking Mode** — Toggle reasoning chains on/off with a single toolbar button (persisted across sessions)
- **Auto-Compact** — When context grows large, automatically summarize and compress conversation history to stay within token limits
- **Vision** — Paste or drop images into the chat; images are described via a vision API (Qwen VL or compatible) and attached as context

### Tools Built into the Agent
| Tool | Description |
|------|-------------|
| `read_file` | Read local files (txt, md, py, json, csv, pdf, docx, xlsx, etc.) |
| `write_file` | Write or overwrite files on disk |
| `list_directory` | List directory contents |
| `run_command` | Execute PowerShell commands locally |
| `web_search` | Search the internet via Tavily API |
| `web_read` | Fetch and read full webpage content (HTML → plain text) |
| `compact` | Manually trigger context compression |
| `todo_write` | Maintain a structured task list for multi-step work tracking |

### Search Control
- **Auto / Manual modes** — In auto mode, the model decides when to search; in manual mode, you toggle search on/off with a toolbar button
- **Soft limit** — After 5 searches in a single turn, the agent is automatically nudged to consolidate existing results rather than keep searching
- **`web_read` companion** — When search snippets are insufficient, the agent can fetch the full page content for deeper analysis

### Skills System
- **Built-in Skills** — Pre-configured agent behaviors that change how the model approaches tasks (e.g., code review, research, planning)
- **Custom Skills** — Create your own skills: name, description, and a prompt that gets injected into the system message
- **Import from Folder** — Import Claude-style skills (`.md` files) from a local folder; auto-detects `SKILL.md` files
- **Skill Editor** — Full create/edit/delete UI panel for managing skills

### Memory System
- **Persistent Key-Value Store** — Save facts, preferences, or context for the agent to recall across conversations
- **Memory Diff Export** — Export all memories as a formatted document
- Full API: `memory_read`, `memory_write` — the agent can use these as tools

### Worktree Isolation
- **Git Worktree Integration** — Each conversation can operate in its own isolated git worktree
- **Worktree Panel** — Side panel showing active worktrees with their branch and task associations
- **Safe by Default** — Command confirmation dialog with "allow all" and wildcard pattern suggestions (`git *`, `python *`)
- **Create / List / Remove** — Full worktree lifecycle management from within the agent or manually

### Team Collaboration
- **Multi-Agent Teams** — Spawn persistent team members running in independent threads
- **Message Passing** — Agents communicate via an in-memory message bus (inbox/outbox)
- **Notification Callback** — UI receives real-time notifications when team members complete work
- **Shutdown Protocol** — Graceful shutdown of team members with confirmation

### Task Management
- **Persistent Tasks** — Create structured tasks that survive across conversations
- **Blocking Dependencies** — Tasks can block each other, forming a dependency graph
- **Status Tracking** — pending → in_progress → completed/deleted workflow
- **Auto-complete on Worktree Remove** — Optionally mark bound tasks as done when removing a worktree

### UI
- **pywebview Desktop App** — Native window with web-based chat interface
- **Conversation Management** — Sidebar with drag-to-reorder, search, rename, delete conversations
- **Collapsible Tool Bubbles** — Tool calls and results shown in collapsible message bubbles
- **Chat Navigation** — Previous/next message buttons for smooth scrolling through long conversations
- **Command Confirmation Dialog** — Review and approve shell commands before execution, with wildcard allow-list
- **Theme Support** — Light and dark themes, adjustable font size

## Installation

```bash
# 1. Install dependencies
pip install openai pywebview tavily-python

# 2. Clone the repository
git clone <repo-url>
cd quick_model

# 3. Create configuration
# On first launch, a settings panel will appear.
# Configure your API keys and model preferences.

# 4. Launch
python main.py
```

## Configuration

All settings are stored in `config.json` under the app directory. Key settings:

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
| `search_mode` | `"auto"` = model decides when to search; `"manual"` = user toggles |
| `search_enabled` | When manual mode, whether search tools are available |
| `tavily_api_key` | API key for web search |
| `vision_api_key` / `vision_base_url` / `vision_model` | Vision model for image description |

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

## License

MIT
