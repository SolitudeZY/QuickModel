# Release Notes

## v1.2.0 — 2026-04-28

### New Features

**Image paste from clipboard**
Paste any image directly into the input box with Ctrl+V. The image is processed the same way as drag-and-drop uploads — sent to the vision API for description and attached to your message.

**Image thumbnails in chat history**
Uploaded images now appear as inline thumbnails in the conversation. Click any thumbnail to open a full-size lightbox view. Press Escape or click outside to close.

**Collapsible user input bubbles**
Long messages are automatically collapsed to keep the chat readable. A toggle button appears below the bubble to expand or collapse it.

**Smooth chat navigation**
The ↑ / ↓ navigation buttons now animate with an easeInOutCubic curve instead of jumping instantly to the target message.

### Improvements

**DeepSeek V4 thinking mode fixes**
- Fixed a `400 - reasoning_content must be passed back` error that occurred when the model made tool calls with thinking enabled and then attempted a final answer. The `reasoning_content` field is now unconditionally attached to every assistant message when thinking mode is active.
- History messages missing `reasoning_content` (e.g. from older conversations or after context compression) are patched before each API call.

**Correct context window for DeepSeek V4**
The auto-compact threshold for DeepSeek V4 models (`deepseek-v4-pro`, `deepseek-v4-flash`) is now 800k tokens, matching their 1M context window. Previously it was incorrectly set to 400k, causing premature compression.

**Command execution reliability**
`run_command` now supports a configurable timeout and a stop flag, preventing hung commands from blocking the agent loop.

### Bug Fixes

- Fixed JS initialization failure caused by lightbox HTML being placed after script tags in `index.html`, which broke the stop button and other UI controls.
- Fixed image description text leaking into the user bubble alongside the thumbnail. The full `[图片: filename]\n<description>` segment is now replaced entirely by the thumbnail element.

---

## v1.1.0 — 2026-04-22

- Chat navigation buttons (↑ / ↓ / scroll-to-bottom)
- DeepSeek V4 Pro initial support (thinking mode + tool calling)
- Open external links in system browser
- Enhanced `run_command` with timeout and stop flag

## v1.0.0 — Initial Release

- Multi-vendor LLM support via OpenAI-compatible API
- Tool calling: file read/write, shell commands, web search, directory listing
- Thinking mode for DeepSeek V3.2, OpenAI o-series, Anthropic Claude
- Image understanding via Qwen-VL
- Agent loop with sliding window context and auto-compact
- Command allowlist, configurable max rounds
- Todo & Task manager, Skill system, Memory system
- Markdown & LaTeX rendering (offline)
- Conversation management: persistent JSON, drag-sort, rename, export
- Multi-agent subagent support
