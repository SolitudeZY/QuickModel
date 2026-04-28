import json
import threading
import webbrowser
import webview
from pathlib import Path
from typing import Optional

from app.config import load_config, save_config, get_active_model_config, load_allowed_commands, save_allowed_commands, is_command_allowed, add_allowed_command
from app.conversation import (
    new_conversation, save_conversation, load_conversation,
    delete_conversation, rename_conversation, list_conversations,
    update_sort_orders, auto_title_from_message, export_conversation_md,
)
from app.agent import Agent
from app.tools import read_file as _read_file
from app.vision import is_image, describe_image
from app.advanced_tools import TodoManager, TaskManager, BackgroundManager
from app.team import TEAM, WORKTREES
from app.skills import skill_list, skill_save, skill_delete, skill_read, memory_list, memory_read, memory_write


def get_static_dir() -> Path:
    import sys, os
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS) / 'app'
    else:
        base = Path(os.path.dirname(os.path.abspath(__file__)))
    return base / 'static'


def get_html_path() -> str:
    return str(get_static_dir() / 'index.html')


class API:
    def __init__(self):
        self._window: Optional[webview.Window] = None
        self._config = load_config()
        self._agent: Optional[Agent] = None
        self._running = False
        self._confirm_event = threading.Event()
        self._confirm_result = False
        # Shared managers — persist across conversations
        self._todo = TodoManager()
        self._tasks = TaskManager()
        self._bg = BackgroundManager()
        # Persist thinking/search state from config
        self._thinking = bool(self._config.get("thinking", True))
        self._search_mode = self._config.get("search_mode", "auto")    # "auto" | "manual"
        self._search_enabled = bool(self._config.get("search_enabled", True))
        # Team notification callback — push teammate activity to UI
        TEAM.set_notification_cb(lambda msg: self._js(f'Chat.showTeamNotification({json.dumps(msg)})'))

    def set_window(self, window: webview.Window):
        self._window = window

    def _js(self, code: str):
        """Thread-safe evaluate_js."""
        if self._window:
            self._window.evaluate_js(code)

    # ── Config ────────────────────────────────────────────────────
    def get_config(self) -> dict:
        return self._config

    def save_config(self, config: dict) -> None:
        self._config = config
        save_config(config)

    # ── Conversations ─────────────────────────────────────────────
    def list_conversations(self) -> list:
        return list_conversations()

    def new_conversation(self) -> dict:
        mc = get_active_model_config(self._config)
        conv = new_conversation(mc['name'] if mc else '')
        save_conversation(conv)
        return {'id': conv['id'], 'title': conv['title']}

    def open_conversation(self, conv_id: str) -> Optional[dict]:
        conv = load_conversation(conv_id)
        if not conv:
            return None
        return {
            'id': conv['id'],
            'title': conv.get('title', '对话'),
            'messages': conv.get('messages', []),
        }

    def delete_conversation(self, conv_id: str) -> None:
        delete_conversation(conv_id)

    def rename_conversation(self, conv_id: str, title: str) -> None:
        rename_conversation(conv_id, title)

    def reorder_conversations(self, ids: list) -> None:
        update_sort_orders(ids)

    def set_thinking(self, enabled: bool) -> None:
        self._thinking = bool(enabled)
        self._config["thinking"] = self._thinking
        save_config(self._config)

    def get_ui_state(self) -> dict:
        """Return persistent UI toggle states for frontend init."""
        return {
            "thinking": self._thinking,
            "search_mode": self._search_mode,
            "search_enabled": self._search_enabled,
        }

    def set_search_mode(self, mode: str) -> None:
        """mode: 'auto' | 'manual'"""
        self._search_mode = mode
        self._config["search_mode"] = mode
        save_config(self._config)

    def set_search_enabled(self, enabled: bool) -> None:
        """Manual mode: toggle whether web_search tool is available."""
        self._search_enabled = bool(enabled)
        self._config["search_enabled"] = self._search_enabled
        save_config(self._config)

    def open_url(self, url: str) -> None:
        webbrowser.open(url)

    # ── Skills ────────────────────────────────────────────────────
    def list_skills(self) -> list:
        return skill_list()

    def save_skill(self, name: str, description: str, content: str) -> str:
        return skill_save(name, description, content)

    def delete_skill(self, name: str) -> str:
        return skill_delete(name)

    def read_skill(self, name: str) -> str:
        return skill_read(name)

    # ── Memory ────────────────────────────────────────────────────
    def list_memory(self) -> list:
        return memory_list()

    def read_memory(self, key: str) -> str:
        return memory_read(key)

    def write_memory(self, key: str, content: str) -> str:
        return memory_write(key, content)

    def get_memory_summary(self) -> str:
        """Return all memory content concatenated, for injection on /new."""
        items = memory_list()
        if not items:
            return ""
        parts = []
        for item in items:
            content = memory_read(item['key'])
            parts.append(f"## {item['key']}\n{content}")
        return "\n\n".join(parts)

    # ── Worktree ─────────────────────────────────────────────────
    def get_worktrees(self) -> list:
        """Return worktree list for frontend panel."""
        idx = WORKTREES._load_index()
        return idx.get("worktrees", [])

    def export_conversation(self, conv_id: str) -> None:
        conv = load_conversation(conv_id)
        if not conv:
            return
        md = export_conversation_md(conv)
        save_path = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=f"{conv.get('title', 'conversation')}.md",
            file_types=('Markdown (*.md)', 'All files (*.*)')
        )
        if save_path:
            dest = save_path[0] if isinstance(save_path, (list, tuple)) else save_path
            Path(dest).write_text(md, encoding='utf-8')

    # ── File helpers ──────────────────────────────────────────────
    def save_uploaded_file(self, filename: str, base64_content: str) -> str:
        """将 JS 传来的 base64 文件保存到本地 uploads 目录，返回本地路径。"""
        import base64
        import uuid
        from app.config import get_app_data_dir
        uploads_dir = get_app_data_dir() / 'uploads'
        uploads_dir.mkdir(exist_ok=True)
        p = Path(filename)
        unique_name = f"{p.stem}_{uuid.uuid4().hex[:8]}{p.suffix}"
        dest = uploads_dir / unique_name
        dest.write_bytes(base64.b64decode(base64_content))
        return str(dest)

    def get_image_data(self, filename: str) -> str:
        """Return base64 data URL for an uploaded image (by filename only)."""
        import base64 as _b64
        from app.config import get_app_data_dir
        path = get_app_data_dir() / 'uploads' / filename
        if not path.exists():
            return ''
        ext = path.suffix.lower().lstrip('.')
        mime = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'}.get(ext, 'image/png')
        return f'data:{mime};base64,{_b64.b64encode(path.read_bytes()).decode()}'

    def read_file_content(self, path: str) -> str:
        try:
            return _read_file(path)
        except Exception as e:
            return f'[读取失败: {e}]'

    def describe_image(self, path: str) -> str:
        return describe_image(
            path,
            prompt='请详细描述这张图片的内容，包括文字、图表、场景、数据、文字信息等所有细节。',
            api_key=self._config.get('vision_api_key', ''),
            base_url=self._config.get('vision_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
            model=self._config.get('vision_model', 'qwen-vl-max'),
        )

    # ── Agent / send ──────────────────────────────────────────────
    def send_message(self, conv_id: str, text: str, files: list) -> None:
        if self._running:
            return
        conv = load_conversation(conv_id)
        if not conv:
            return

        # /compact slash command — inject as tool call trigger
        if text == '__slash_compact__':
            conv['messages'].append({'role': 'user', 'content': '请立即压缩上下文（调用 compact 工具）。'})
            save_conversation(conv)
            self._start_agent(conv)
            return

        # Build user message content
        # Images: use vision model to get text description
        # Other files: inject content as text
        parts = [text] if text else []
        for f in files:
            name = f.get('name', '')
            path = f.get('path', '')
            content = f.get('content', '')
            ext = Path(name).suffix.lower().lstrip('.')
            is_img = ext in {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
            if is_img:
                if content:
                    # Already described by vision API in JS
                    parts.append(f"[图片: {name}]\n{content}")
                elif path:
                    # Describe now (fallback if JS didn't finish in time)
                    desc = describe_image(
                        path,
                        prompt='请详细描述这张图片的内容，包括文字、图表、场景、数据等所有细节。',
                        api_key=self._config.get('vision_api_key', ''),
                        base_url=self._config.get('vision_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
                        model=self._config.get('vision_model', 'qwen-vl-max'),
                    )
                    parts.append(f"[图片: {name}]\n{desc}")
            else:
                if content:
                    parts.append(f"[附件: {name}]\n{content}")

        full_text = '\n\n'.join(parts)

        user_msg = {'role': 'user', 'content': full_text}
        conv['messages'].append(user_msg)

        # Auto-title on first message
        if len(conv['messages']) == 1:
            auto_title_from_message(conv, full_text)

        mc = get_active_model_config(self._config)
        if not mc:
            self._js('Chat.showError("未配置模型，请在设置中添加模型配置")')
            return

        self._agent = Agent(
            api_key=mc.get('api_key', ''),
            base_url=mc.get('base_url', ''),
            model=mc.get('model', ''),
            system_prompt=mc.get('system_prompt', 'You are a helpful assistant.'),
            tavily_key=self._config.get('tavily_api_key', ''),
            command_safety=self._config.get('command_safety', 'confirm'),
            command_timeout=self._config.get('command_timeout', 30),
            max_rounds=self._config.get('max_rounds', 50),
            todo_manager=self._todo,
            task_manager=self._tasks,
            bg_manager=self._bg,
            thinking=self._thinking,
            search_enabled=self._search_mode == "auto" or self._search_enabled,
        )
        self._agent._model_configs = self._config.get('model_configs', [])
        self._running = True

        def run():
            self._agent.run(
                messages=conv['messages'],
                on_token=self._on_token,
                on_tool_start=self._on_tool_start,
                on_tool_result=self._on_tool_result,
                on_confirm=self._on_confirm,
                on_done=lambda msgs: self._on_done(conv, msgs),
                on_error=lambda err, msgs: self._on_error(conv, err, msgs),
                on_todo_update=self._on_todo_update,
                on_context_update=self._on_context_update,
                on_thinking=self._on_thinking,
            )

        threading.Thread(target=run, daemon=True).start()

    def _start_agent(self, conv: dict) -> None:
        """Start agent for an already-prepared conv (used by slash commands)."""
        mc = get_active_model_config(self._config)
        if not mc:
            self._js('Chat.showError("未配置模型，请在设置中添加模型配置")')
            return
        self._agent = Agent(
            api_key=mc.get('api_key', ''),
            base_url=mc.get('base_url', ''),
            model=mc.get('model', ''),
            system_prompt=mc.get('system_prompt', 'You are a helpful assistant.'),
            tavily_key=self._config.get('tavily_api_key', ''),
            command_safety=self._config.get('command_safety', 'confirm'),
            command_timeout=self._config.get('command_timeout', 30),
            max_rounds=self._config.get('max_rounds', 50),
            todo_manager=self._todo,
            task_manager=self._tasks,
            bg_manager=self._bg,
            thinking=self._thinking,
            search_enabled=self._search_mode == "auto" or self._search_enabled,
        )
        self._agent._model_configs = self._config.get('model_configs', [])
        self._running = True
        self._js('startAssistantStream(); setRunning(true);')

        def run():
            self._agent.run(
                messages=conv['messages'],
                on_token=self._on_token,
                on_tool_start=self._on_tool_start,
                on_tool_result=self._on_tool_result,
                on_confirm=self._on_confirm,
                on_done=lambda msgs: self._on_done(conv, msgs),
                on_error=lambda err, msgs: self._on_error(conv, err, msgs),
                on_todo_update=self._on_todo_update,
                on_context_update=self._on_context_update,
                on_thinking=self._on_thinking,
            )

        threading.Thread(target=run, daemon=True).start()

    def stop_generation(self) -> None:
        if self._agent:
            self._agent.stop()

    # ── Agent callbacks ───────────────────────────────────────────
    def _on_todo_update(self, items: list):
        self._js(f'Chat.updateTodo({json.dumps(items)})')

    def _on_token(self, token: str):
        self._js(f'Chat.appendToken({json.dumps(token)})')

    def _on_context_update(self, used: int, total: int):
        self._js(f'Chat.updateContext({used}, {total})')

    def _on_thinking(self, token: str):
        self._js(f'Chat.appendThinking({json.dumps(token)})')

    def _on_tool_start(self, tool_name: str, args: dict):
        self._js(f'Chat.showToolCall({json.dumps(tool_name)}, {json.dumps(args)})')

    def _on_tool_result(self, tool_name: str, result: str):
        self._js(f'Chat.showToolResult({json.dumps(tool_name)}, {json.dumps(result)})')

    def _on_confirm(self, tool_name: str, args: dict) -> bool:
        # Check allowlist for run_command
        if tool_name == "run_command":
            cmd = args.get("command", "").strip()
            if is_command_allowed(cmd):
                return True
        self._confirm_event.clear()
        self._js(f'Chat.showConfirmDialog({json.dumps(tool_name)}, {json.dumps(args)})')
        self._confirm_event.wait()
        return self._confirm_result

    def confirm_tool(self, approved: bool) -> None:
        self._confirm_result = approved
        self._confirm_event.set()

    def confirm_tool_always(self, command: str) -> None:
        add_allowed_command(command)
        self._confirm_result = True
        self._confirm_event.set()

    def get_allowed_commands(self) -> list:
        return load_allowed_commands()

    def save_allowed_commands_api(self, commands: list) -> None:
        save_allowed_commands(commands)

    def _on_done(self, conv: dict, updated_messages: list):
        conv['messages'] = updated_messages
        save_conversation(conv)
        self._running = False
        self._js('Chat.finishMessage()')
        threading.Thread(target=self._auto_title, args=(conv,), daemon=True).start()

    def _auto_title(self, conv: dict):
        """用 LLM 根据对话内容生成标题，完成后推送到前端。"""
        messages = conv.get('messages', [])
        # 只取前几条消息做摘要，避免浪费 token
        sample = []
        for m in messages[:6]:
            if m.get('role') in ('user', 'assistant') and m.get('content'):
                sample.append(m)
        if not sample:
            return
        mc = get_active_model_config(self._config)
        if not mc:
            return
        from openai import OpenAI
        client = OpenAI(api_key=mc.get('api_key', ''), base_url=mc.get('base_url', ''))
        try:
            conv_text = '\n'.join(
                f"{'用户' if m['role'] == 'user' else 'AI'}: {str(m['content'])[:300]}"
                for m in sample
            )
            resp = client.chat.completions.create(
                model=mc.get('model', ''),
                messages=[{"role": "user", "content":
                    f"请根据以下对话内容，用不超过20个字生成一个简洁的标题，只输出标题本身，不要加引号或其他内容：\n\n{conv_text}"}],
                max_tokens=60,
            )
            title = (resp.choices[0].message.content or '').strip().strip('"\'')
            if title:
                conv['title'] = title
                save_conversation(conv)
                self._js(f'Chat.updateConvTitle({json.dumps(conv["id"])}, {json.dumps(title)})')
        except Exception:
            pass

    def _on_error(self, conv: dict, error: str, messages: list):
        conv['messages'] = messages
        save_conversation(conv)
        self._running = False
        self._js(f'Chat.showError({json.dumps(error)})')
