import json
import threading
from typing import Callable, Optional

from openai import OpenAI

from app.tools import TOOLS_SCHEMA, CONFIRM_REQUIRED, dispatch
from app.advanced_tools import (
    ADVANCED_TOOLS_SCHEMA, TodoManager, TaskManager, BackgroundManager,
    microcompact, auto_compact, estimate_tokens, run_subagent,
)
from app.team import TEAM, WORKTREES, BUS
from app.skills import skill_list_str, skill_read, memory_read, memory_write

# Token threshold for auto-compact (approx)
AUTO_COMPACT_THRESHOLD = 80_000
# V4 models have 1M context — compact at 800k to leave headroom
AUTO_COMPACT_THRESHOLD_V4 = 800_000

V4_MODELS = {"deepseek-v4-pro", "deepseek-v4-flash"}


class Agent:
    """
    封装 OpenAI 兼容 API 的工具调用循环。
    集成 TodoWrite、TaskManager、BackgroundManager、上下文压缩。
    """

    CONTEXT_WINDOW = 40

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        system_prompt: str = "You are a helpful assistant.",
        tavily_key: str = "",
        command_safety: str = "confirm",
        command_timeout: int = 30,
        todo_manager: Optional[TodoManager] = None,
        task_manager: Optional[TaskManager] = None,
        bg_manager: Optional[BackgroundManager] = None,
        thinking: bool = False,
        max_rounds: int = 50,
    ):
        self.model = model
        self.system_prompt = system_prompt
        self.tavily_key = tavily_key
        self.command_safety = command_safety
        self.command_timeout = command_timeout
        self.thinking = thinking
        self.max_rounds = max_rounds
        self._model_configs: list = []
        self._client = OpenAI(api_key=api_key, base_url=base_url)
        self._base_url = (base_url or "").rstrip("/")
        self._stop_flag = threading.Event()
        self._todo = todo_manager or TodoManager()
        self._tasks = task_manager or TaskManager()
        self._bg = bg_manager or BackgroundManager()
        self._rounds_without_todo = 0

    def _provider(self) -> str:
        """Detect provider from base_url."""
        url = self._base_url.lower()
        if "deepseek" in url:
            return "deepseek"
        if "anthropic" in url or "claude" in url:
            return "anthropic"
        return "openai"

    def _is_reasoner(self) -> bool:
        """True when this call should use extended thinking / reasoning."""
        if not self.thinking:
            return False
        p = self._provider()
        if p == "deepseek":
            return True  # use deepseek-reasoner model
        if p in ("openai", "anthropic"):
            return True
        return False

    def _build_stream(self, messages: list) -> tuple:
        """Return (stream, extra_kwargs). Handles provider-specific params."""
        kwargs: dict = dict(
            model=self.model,
            messages=messages,
            stream=True,
        )
        provider = self._provider()

        if self._is_reasoner():
            if provider == "deepseek":
                # V3.2+ / V4: thinking mode + tool calling
                # reasoning_effort is a top-level param, thinking type goes in extra_body
                kwargs["reasoning_effort"] = "high"
                kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
                kwargs["tools"] = self._all_tools()
                kwargs["tool_choice"] = "auto"
            elif provider == "openai":
                # o-series: reasoning_effort
                kwargs["extra_body"] = {"reasoning_effort": "high"}
                kwargs["tools"] = self._all_tools()
                kwargs["tool_choice"] = "auto"
            elif provider == "anthropic":
                kwargs["extra_body"] = {"thinking": {"type": "enabled", "budget_tokens": 8000}}
                kwargs["tools"] = self._all_tools()
                kwargs["tool_choice"] = "auto"
        else:
            kwargs["tools"] = self._all_tools()
            kwargs["tool_choice"] = "auto"

        return self._client.chat.completions.create(**kwargs), provider

    def stop(self):
        self._stop_flag.set()

    def reset_stop(self):
        self._stop_flag.clear()

    @property
    def todo(self) -> TodoManager:
        return self._todo

    def _all_tools(self) -> list:
        return TOOLS_SCHEMA + ADVANCED_TOOLS_SCHEMA

    def _dispatch_advanced(self, tool_name: str, args: dict) -> Optional[str]:
        """Handle advanced tools. Returns None if not an advanced tool."""
        if tool_name == "todo_write":
            try:
                return self._todo.update(args.get("items", []))
            except ValueError as e:
                return f"TodoWrite 错误：{e}"
        elif tool_name == "task_create":
            return self._tasks.create(args.get("subject", ""), args.get("description", ""))
        elif tool_name == "task_get":
            return self._tasks.get(int(args.get("task_id", 0)))
        elif tool_name == "task_update":
            return self._tasks.update(
                int(args.get("task_id", 0)),
                args.get("status"),
                args.get("add_blocked_by"),
                args.get("remove_blocked_by"),
            )
        elif tool_name == "task_list":
            return self._tasks.list_all()
        elif tool_name == "background_run":
            return self._bg.run(args.get("command", ""), int(args.get("timeout", 120)))
        elif tool_name == "background_check":
            return self._bg.check(args.get("task_id"))
        elif tool_name == "subagent":
            return run_subagent(
                prompt=args.get("prompt", ""),
                api_key=self._client.api_key,
                base_url=str(self._client.base_url),
                model=self.model,
                agent_type=args.get("agent_type", "Explore"),
            )
        # ── Team tools (s09-s12) ──────────────────────────────────────
        elif tool_name == "team_spawn":
            mc_name = args.get("model_config", "")
            # resolve model config: use named config or fall back to current agent's creds
            if mc_name and self._model_configs:
                mc = next((c for c in self._model_configs if c.get("name") == mc_name), None)
            else:
                mc = None
            api_key = mc["api_key"] if mc else self._client.api_key
            base_url = mc["base_url"] if mc else str(self._client.base_url)
            model = mc["model"] if mc else self.model
            return TEAM.spawn(
                name=args.get("name", ""),
                role=args.get("role", ""),
                prompt=args.get("prompt", ""),
                api_key=api_key,
                base_url=base_url,
                model=model,
            )
        elif tool_name == "team_list":
            return TEAM.list_all()
        elif tool_name == "team_send":
            return BUS.send("lead", args.get("to", ""), args.get("content", ""),
                            args.get("msg_type", "message"))
        elif tool_name == "team_read_inbox":
            msgs = BUS.read_inbox("lead")
            return json.dumps(msgs, ensure_ascii=False, indent=2) if msgs else "收件箱为空。"
        elif tool_name == "team_broadcast":
            return BUS.broadcast("lead", args.get("content", ""), TEAM.member_names())
        elif tool_name == "team_approve_plan":
            return TEAM.approve_plan(args.get("request_id", ""), bool(args.get("approve", False)))
        elif tool_name == "team_shutdown":
            return TEAM.shutdown(args.get("name", ""))
        elif tool_name == "worktree_create":
            return WORKTREES.create(args.get("name", ""), args.get("task_id"), args.get("base_ref", "HEAD"))
        elif tool_name == "worktree_list":
            return WORKTREES.list_all()
        elif tool_name == "worktree_run":
            return WORKTREES.run(args.get("name", ""), args.get("command", ""))
        elif tool_name == "worktree_status":
            return WORKTREES.status(args.get("name", ""))
        elif tool_name == "worktree_keep":
            return WORKTREES.keep(args.get("name", ""))
        elif tool_name == "worktree_remove":
            return WORKTREES.remove(args.get("name", ""), bool(args.get("force", False)),
                                    bool(args.get("complete_task", False)))
        elif tool_name == "worktree_events":
            return WORKTREES.events(args.get("limit", 20))
        elif tool_name == "skill_list":
            return skill_list_str()
        elif tool_name == "skill_read":
            return skill_read(args.get("name", ""))
        elif tool_name == "memory_read":
            return memory_read(args.get("key", ""))
        elif tool_name == "memory_write":
            return memory_write(args.get("key", ""), args.get("content", ""))
        return None

    def _apply_window(self, messages: list[dict]) -> list[dict]:
        system = [m for m in messages if m.get("role") == "system"]
        rest = [m for m in messages if m.get("role") != "system"]
        if len(rest) <= self.CONTEXT_WINDOW:
            return messages
        window = rest[-self.CONTEXT_WINDOW:]
        # Drop leading tool results (orphaned from truncated tool_calls)
        while window and window[0].get("role") == "tool":
            window = window[1:]
        # Drop leading assistant messages that have tool_calls but no preceding tool results
        # (their tool results were cut off by the window)
        while window and window[0].get("role") == "assistant" and window[0].get("tool_calls"):
            window = window[1:]
        # After dropping, there may again be orphaned tool results at the front
        while window and window[0].get("role") == "tool":
            window = window[1:]
        return system + window

    def run(
        self,
        messages: list[dict],
        on_token: Callable[[str], None],
        on_tool_start: Callable[[str, dict], None],
        on_tool_result: Callable[[str, str], None],
        on_confirm: Callable[[str, dict], bool],
        on_done: Callable[[list[dict]], None],
        on_error: Callable[[str, list], None],
        on_todo_update: Optional[Callable[[list[dict]], None]] = None,
        on_context_update: Optional[Callable[[int, int], None]] = None,
        on_thinking: Optional[Callable[[str], None]] = None,
    ):
        """在调用线程中同步运行（应在后台线程调用）。"""
        self._stop_flag.clear()
        self._rounds_without_todo = 0
        all_messages = [{"role": "system", "content": self.system_prompt}] + messages

        try:
            max_rounds = self.max_rounds
            round_count = 0
            threshold = AUTO_COMPACT_THRESHOLD_V4 if self.model in V4_MODELS else AUTO_COMPACT_THRESHOLD
            while not self._stop_flag.is_set() and round_count < max_rounds:
                # 注入后台任务完成通知
                notes = self._bg.drain_notifications()
                for note in notes:
                    all_messages.append({
                        "role": "user",
                        "content": f"<bg_notification>后台任务 {note['task_id']} 已完成：{note['result']}</bg_notification>",
                    })

                # microcompact：清理旧 tool result
                microcompact(all_messages)

                # auto_compact：token 超限时压缩
                if estimate_tokens(all_messages) > threshold:
                    all_messages = auto_compact(all_messages, self._client, self.model)

                # 推送上下文用量
                if on_context_update:
                    on_context_update(estimate_tokens(all_messages), threshold)

                full_messages = self._apply_window(all_messages)

                # DeepSeek thinking mode: all assistant messages must carry reasoning_content.
                # Patch any that are missing it (old history, compact summaries, etc.)
                if self._is_reasoner() and self._provider() == "deepseek":
                    full_messages = [
                        {**msg, "reasoning_content": msg.get("reasoning_content") or ""}
                        if msg.get("role") == "assistant" else msg
                        for msg in full_messages
                    ]

                tool_calls_accumulated = []
                assistant_content = ""
                thinking_content = ""

                stream, provider = self._build_stream(full_messages)
                current_tool_calls: dict[int, dict] = {}

                for chunk in stream:
                    if self._stop_flag.is_set():
                        break
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta is None:
                        continue
                    # reasoning_content (DeepSeek reasoner / some providers)
                    rc = getattr(delta, "reasoning_content", None)
                    if rc:
                        thinking_content += rc
                        if on_thinking:
                            on_thinking(rc)
                    if delta.content:
                        assistant_content += delta.content
                        on_token(delta.content)
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in current_tool_calls:
                                current_tool_calls[idx] = {
                                    "id": "", "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                }
                            if tc.id:
                                current_tool_calls[idx]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    current_tool_calls[idx]["function"]["name"] += tc.function.name
                                if tc.function.arguments:
                                    current_tool_calls[idx]["function"]["arguments"] += tc.function.arguments

                tool_calls_accumulated = list(current_tool_calls.values())
                round_count += 1

                assistant_msg: dict = {"role": "assistant", "content": assistant_content}
                # DeepSeek thinking mode: reasoning_content must ALWAYS be present on every
                # assistant message when thinking is enabled — even if empty this round.
                if self._is_reasoner() and provider == "deepseek":
                    assistant_msg["reasoning_content"] = thinking_content
                if tool_calls_accumulated:
                    assistant_msg["tool_calls"] = tool_calls_accumulated
                all_messages.append(assistant_msg)

                # DeepSeek reasoner (old model): no tool calls, single-turn, always break
                if self._is_reasoner() and provider == "deepseek" and not tool_calls_accumulated:
                    break

                if not tool_calls_accumulated:
                    break

                used_todo = False
                for tc in tool_calls_accumulated:
                    tool_name = tc["function"]["name"]
                    try:
                        args = json.loads(tc["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}

                    if self._stop_flag.is_set():
                        all_messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": "用户已停止",
                        })
                        continue

                    on_tool_start(tool_name, args)

                    # Layer 3: manual compact
                    if tool_name == "compact":
                        all_messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": "正在压缩上下文…",
                        })
                        all_messages = auto_compact(all_messages, self._client, self.model)
                        on_tool_result(tool_name, "上下文已压缩")
                        continue

                    # Try advanced tools first
                    result = self._dispatch_advanced(tool_name, args)
                    if result is None:
                        # Standard tools
                        if tool_name in CONFIRM_REQUIRED:
                            if self.command_safety == "disabled":
                                result = f"工具 {tool_name} 已被禁用"
                            elif self.command_safety == "confirm":
                                allowed = on_confirm(tool_name, args)
                                result = (dispatch(tool_name, args, self.tavily_key, self.command_timeout, self._stop_flag)
                                          if allowed else f"用户拒绝执行工具：{tool_name}")
                            else:
                                result = dispatch(tool_name, args, self.tavily_key, self.command_timeout, self._stop_flag)
                        else:
                            result = dispatch(tool_name, args, self.tavily_key, self.command_timeout, self._stop_flag)

                    if tool_name == "todo_write":
                        used_todo = True
                        if on_todo_update:
                            on_todo_update(self._todo.get_items())

                    on_tool_result(tool_name, result)
                    all_messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    })

                # Todo nag: remind model to update todos if it has open items
                self._rounds_without_todo = 0 if used_todo else self._rounds_without_todo + 1
                if self._todo.has_open_items() and self._rounds_without_todo >= 3:
                    all_messages.append({
                        "role": "user",
                        "content": "<reminder>请更新你的 todo_write 清单。</reminder>",
                    })
                    self._rounds_without_todo = 0

            on_done(all_messages[1:])

        except Exception as e:
            on_error(str(e), all_messages[1:])
