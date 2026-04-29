# QuickModel v1.1.0 Release Notes — Skills & Extended Capabilities

**Date**: 2026-04-29  
**Since**: v1.0 (2026-04-21)

---

## Core New Feature: Skills System

### Overview

The skills system allows both users and the AI agent to load specialized prompt modules that steer the model's behavior toward specific task domains. Skills are plain Markdown files with YAML frontmatter, stored in `%APPDATA%/AIDesktopAssistant/skills/`.

### What You Can Do

| Capability | API / UI |
|---|---|
| **List & Read** | Agent tools `skill_list`, `skill_read` — model can discover and load skills on demand |
| **Create Custom Skills** | UI panel: name, description, prompt body → saved as `.md` with YAML frontmatter |
| **Edit & Delete** | Full CRUD from the skills management panel |
| **Import from Folder** | Point to a local folder and import Claude-style skills (`SKILL.md` files, with companion `.md` auto-inlined) |
| **Batch Import** | Recursively scan up to 3 directory levels for all `SKILL.md` files |
| **Auto-Detect** | Import dialog auto-detects whether selected path is a single skill dir, a `SKILL.md` file, or a parent directory tree |

### How It Works

1. Skills are injected into the model's system prompt when loaded via `skill_read`
2. The agent tool `skill_list` is always available — the model can browse skills before deciding which to load
3. Skills can reference companion `.md` files (e.g., `workflows.md`, `examples.md`) which are inlined into the skill content on import

---

## Companion Features (Same Release)

### Memory System
- `memory_read(key)` / `memory_write(key, content)` — persistent key-value store
- Agent uses these as tools; survives across conversations
- UI panel for browsing and exporting memories as a diff document

### Worktree Isolation
- Create isolated git worktrees per conversation
- Agent tools: `worktree_create`, `worktree_run`, `worktree_status`, `worktree_remove`, `worktree_list`, `worktree_keep`
- Side panel showing active worktrees, branch names, and bound task IDs
- Worktree events log (create/remove lifecycle tracking)

### Team Collaboration
- Spawn persistent team members (`team_spawn`) running in independent threads
- In-memory message bus with inbox/outbox (`team_send`, `team_read_inbox`, `team_broadcast`)
- Team member shutdown protocol (`team_shutdown`)
- UI notification callback when members complete work

### Task Management
- Persistent tasks with blocking dependency graph (`task_create`, `task_get`, `task_update`, `task_list`)
- Status workflow: `pending` → `in_progress` → `completed` / `deleted`
- Auto-complete bound tasks when removing a worktree

### Web Search Soft Limit
- After 5 `web_search` calls in a single conversation turn, the agent receives a nudge to consolidate results
- Prevents unlimited search loops that waste API quota

### Command Safety
- Allowed-commands list with wildcard pattern matching
- Confirmation dialog with "Allow All" button and pattern suggestions (`git *`, `python *`, `npm *`)

### UI Enhancements
- Collapsible tool call bubbles
- Chat navigation buttons (scroll to previous/next message)
- Scroll-to-bottom button
- Conversation sidebar drag-to-reorder

---

## Installation

```bash
# Upgrade from v1.0:
git pull
pip install -r requirements.txt  # if updated

# Or fresh install:
pip install openai pywebview tavily-python
python main.py
```

---

## Breaking Changes

None. All v1.0 configuration and conversation files are forward-compatible.
