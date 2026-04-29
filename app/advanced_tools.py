"""
advanced_tools.py — TodoWrite, TaskManager, BackgroundManager, context compression, Subagent, Skills, Memory
Ported from s_full.py harness patterns.
"""
import json
import subprocess
import threading
import time
import uuid
from pathlib import Path
from queue import Queue, Empty
from typing import Optional

from app.config import get_app_data_dir


def _tasks_dir() -> Path:
    d = get_app_data_dir() / "tasks"
    d.mkdir(exist_ok=True)
    return d


# ── TodoManager (s03) ────────────────────────────────────────────────
class TodoManager:
    """Model-maintained short checklist for the current task."""

    def __init__(self):
        self.items: list[dict] = []
        self._lock = threading.Lock()

    def update(self, items: list) -> str:
        validated, ip = [], 0
        for i, item in enumerate(items):
            content = str(item.get("content", "")).strip()
            status = str(item.get("status", "pending")).lower()
            active_form = str(item.get("activeForm", "")).strip()
            if not content:
                raise ValueError(f"Item {i}: content required")
            if status not in ("pending", "in_progress", "completed"):
                raise ValueError(f"Item {i}: invalid status '{status}'")
            if not active_form:
                active_form = content
            if status == "in_progress":
                ip += 1
            validated.append({"content": content, "status": status, "activeForm": active_form})
        if len(validated) > 20:
            raise ValueError("Max 20 todos")
        if ip > 1:
            raise ValueError("Only one in_progress allowed")
        with self._lock:
            self.items = validated
        return self.render()

    def render(self) -> str:
        with self._lock:
            items = list(self.items)
        if not items:
            return "No todos."
        lines = []
        for item in items:
            mark = {"completed": "[x]", "in_progress": "[>]", "pending": "[ ]"}.get(item["status"], "[?]")
            suffix = f" ← {item['activeForm']}" if item["status"] == "in_progress" else ""
            lines.append(f"{mark} {item['content']}{suffix}")
        done = sum(1 for t in items if t["status"] == "completed")
        lines.append(f"\n({done}/{len(items)} completed)")
        return "\n".join(lines)

    def has_open_items(self) -> bool:
        with self._lock:
            return any(t["status"] != "completed" for t in self.items)

    def get_items(self) -> list[dict]:
        with self._lock:
            return list(self.items)


# ── TaskManager (s07) ────────────────────────────────────────────────
class TaskManager:
    """Persistent structured tasks with dependencies, stored as JSON files."""

    def __init__(self):
        _tasks_dir()

    def _next_id(self) -> int:
        ids = [int(f.stem.split("_")[1]) for f in _tasks_dir().glob("task_*.json")
               if f.stem.split("_")[1].isdigit()]
        return max(ids, default=0) + 1

    def _load(self, tid: int) -> dict:
        p = _tasks_dir() / f"task_{tid}.json"
        if not p.exists():
            raise ValueError(f"Task {tid} not found")
        return json.loads(p.read_text(encoding="utf-8"))

    def _save(self, task: dict):
        (_tasks_dir() / f"task_{task['id']}.json").write_text(
            json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8")

    def create(self, subject: str, description: str = "") -> str:
        task = {
            "id": self._next_id(),
            "subject": subject,
            "description": description,
            "status": "pending",
            "owner": None,
            "blockedBy": [],
        }
        self._save(task)
        return json.dumps(task, ensure_ascii=False, indent=2)

    def get(self, task_id: int) -> str:
        try:
            return json.dumps(self._load(task_id), ensure_ascii=False, indent=2)
        except ValueError as e:
            return f"错误：{e}"

    def update(self, task_id: int, status: str = None,
               add_blocked_by: list = None, remove_blocked_by: list = None) -> str:
        try:
            task = self._load(task_id)
        except ValueError as e:
            return f"错误：{e}"
        if status:
            task["status"] = status
            if status == "completed":
                # unblock dependent tasks
                for f in _tasks_dir().glob("task_*.json"):
                    t = json.loads(f.read_text(encoding="utf-8"))
                    if task_id in t.get("blockedBy", []):
                        t["blockedBy"].remove(task_id)
                        self._save(t)
            if status == "deleted":
                (_tasks_dir() / f"task_{task_id}.json").unlink(missing_ok=True)
                return f"Task {task_id} deleted"
        if add_blocked_by:
            task["blockedBy"] = list(set(task.get("blockedBy", []) + add_blocked_by))
        if remove_blocked_by:
            task["blockedBy"] = [x for x in task.get("blockedBy", []) if x not in remove_blocked_by]
        self._save(task)
        return json.dumps(task, ensure_ascii=False, indent=2)

    def list_all(self) -> str:
        tasks = [json.loads(f.read_text(encoding="utf-8"))
                 for f in sorted(_tasks_dir().glob("task_*.json"))]
        if not tasks:
            return "No tasks."
        lines = []
        for t in tasks:
            mark = {"pending": "[ ]", "in_progress": "[>]", "completed": "[x]"}.get(t["status"], "[?]")
            owner = f" @{t['owner']}" if t.get("owner") else ""
            blocked = f" (blocked by: {t['blockedBy']})" if t.get("blockedBy") else ""
            lines.append(f"{mark} #{t['id']}: {t['subject']}{owner}{blocked}")
        return "\n".join(lines)


# ── BackgroundManager (s08) ──────────────────────────────────────────
class BackgroundManager:
    """Run shell commands in background threads, check results later."""

    def __init__(self):
        self._tasks: dict[str, dict] = {}
        self._notifications: Queue = Queue()
        self._lock = threading.Lock()

    def run(self, command: str, timeout: int = 120) -> str:
        tid = uuid.uuid4().hex[:8]
        with self._lock:
            self._tasks[tid] = {"status": "running", "command": command, "result": None}
        threading.Thread(target=self._exec, args=(tid, command, timeout), daemon=True).start()
        return f"后台任务 {tid} 已启动：{command[:80]}"

    def _exec(self, tid: str, command: str, timeout: int):
        try:
            import locale
            r = subprocess.run(command, shell=True, capture_output=True, timeout=timeout)
            def _decode(b):
                if not b: return ""
                for enc in (locale.getpreferredencoding(False), "utf-8", "gbk", "cp936"):
                    try: return b.decode(enc)
                    except: continue
                return b.decode("utf-8", errors="replace")
            output = (_decode(r.stdout) + _decode(r.stderr)).strip()[:50000]
            result = output or "(no output)"
        except subprocess.TimeoutExpired:
            result = f"超时（{timeout}s）"
        except Exception as e:
            result = f"执行失败：{e}"
        with self._lock:
            self._tasks[tid]["status"] = "completed"
            self._tasks[tid]["result"] = result
        self._notifications.put({"task_id": tid, "result": result[:200]})

    def check(self, task_id: Optional[str] = None) -> str:
        with self._lock:
            if task_id:
                t = self._tasks.get(task_id)
                if not t:
                    return f"未知任务 {task_id}"
                return json.dumps(t, ensure_ascii=False)
            return json.dumps(
                {tid: {"status": t["status"], "command": t["command"][:60]}
                 for tid, t in self._tasks.items()},
                ensure_ascii=False, indent=2
            )

    def drain_notifications(self) -> list[dict]:
        notes = []
        while True:
            try:
                notes.append(self._notifications.get_nowait())
            except Empty:
                break
        return notes


# ── Context compression (s06) ────────────────────────────────────────
def estimate_tokens(messages: list) -> int:
    return len(json.dumps(messages, default=str)) // 4


def microcompact(messages: list, window_size: int = 40) -> None:
    """Clear old tool_result content that falls outside the sliding window.

    Only compresses messages that won't be sent to the API (outside the window),
    so messages within the window stay byte-for-byte identical across requests,
    maximising DeepSeek prefix-cache hit rate.
    """
    non_system = [m for m in messages if m.get("role") != "system"]
    if len(non_system) <= window_size:
        return  # everything is within the window — nothing to compress
    outside = non_system[:-window_size]
    for msg in outside:
        if msg.get("role") == "tool" and isinstance(msg.get("content"), str) and len(msg["content"]) > 200:
            msg["content"] = "[已压缩]"


def auto_compact(messages: list, client, model: str) -> list:
    """Summarize conversation when context is too large."""
    transcripts_dir = get_app_data_dir() / "transcripts"
    transcripts_dir.mkdir(exist_ok=True)
    path = transcripts_dir / f"transcript_{int(time.time())}.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for msg in messages:
            f.write(json.dumps(msg, default=str, ensure_ascii=False) + "\n")

    conv_text = json.dumps(messages, default=str, ensure_ascii=False)[-80000:]
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content":
                f"请用中文简洁总结以下对话内容，保留关键信息和结论，供后续对话继续使用：\n{conv_text}"}],
        )
        summary = resp.choices[0].message.content or "(无摘要)"
    except Exception as e:
        summary = f"(压缩失败: {e})"

    return [{"role": "user", "content": f"[对话已压缩，原始记录：{path}]\n\n{summary}"},
            {"role": "assistant", "content": "已了解之前的对话内容，请继续。"}]


# ── Subagent (s04) ───────────────────────────────────────────────────
def run_subagent(prompt: str, api_key: str, base_url: str, model: str,
                 agent_type: str = "Explore") -> str:
    """Spawn a focused sub-agent with its own tool loop. Returns a summary."""
    from openai import OpenAI
    from app.tools import read_file, list_directory, run_command, write_file

    client = OpenAI(api_key=api_key, base_url=base_url)

    # Explore agents get read-only tools; General agents get write tools too
    sub_tools = [
        {"type": "function", "function": {
            "name": "read_file",
            "description": "读取文件内容",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        }},
        {"type": "function", "function": {
            "name": "list_directory",
            "description": "列出目录内容",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        }},
        {"type": "function", "function": {
            "name": "run_command",
            "description": "执行 shell 命令",
            "parameters": {"type": "object", "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer"},
            }, "required": ["command"]},
        }},
    ]
    if agent_type != "Explore":
        sub_tools += [
            {"type": "function", "function": {
                "name": "write_file",
                "description": "写入文件",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}, "content": {"type": "string"},
                }, "required": ["path", "content"]},
            }},
        ]

    def dispatch(name, args):
        if name == "read_file":    return read_file(args.get("path", ""))
        if name == "list_directory": return list_directory(args.get("path", ""))
        if name == "run_command":  return run_command(args.get("command", ""), args.get("timeout", 30))
        if name == "write_file":   return write_file(args.get("path", ""), args.get("content", ""))
        return f"未知工具：{name}"

    messages = [{"role": "user", "content": prompt}]
    system = "你是一个专注的子代理，负责完成指定的子任务并返回详细结果摘要。"
    is_deepseek = "deepseek" in (base_url or "").lower()

    for _ in range(30):
        # DeepSeek V4 requires reasoning_content on all assistant messages
        # (V4 enables thinking by default). Patch before each API call.
        send_messages = [{"role": "system", "content": system}]
        for m in messages:
            if m.get("role") == "assistant" and is_deepseek:
                send_messages.append({**m, "reasoning_content": m.get("reasoning_content") or ""})
            else:
                send_messages.append(m)

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=send_messages,
                tools=sub_tools,
                tool_choice="auto",
            )
        except Exception as e:
            return f"子代理调用失败：{e}"

        choice = resp.choices[0]
        msg = choice.message

        if not msg.tool_calls:
            return msg.content or "(子代理无返回)"

        # Append assistant message with tool_calls + reasoning_content
        asst = {
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        }
        rc = getattr(msg, "reasoning_content", None)
        if rc:
            asst["reasoning_content"] = rc
        messages.append(asst)
        # Execute tools and append results
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = dispatch(tc.function.name, args)
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": str(result)[:50000],
            })

    return "(子代理达到最大轮次，未返回摘要)"


# ── Tool schemas for new tools ────────────────────────────────────────
ADVANCED_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "todo_write",
            "description": "维护当前任务的待办清单。用于追踪多步骤工作的进度。",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "完整的待办列表（每次调用替换全部）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content":    {"type": "string", "description": "任务描述"},
                                "status":     {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                                "activeForm": {"type": "string", "description": "进行时描述，如'正在分析代码'"},
                            },
                            "required": ["content", "status", "activeForm"],
                        },
                    },
                },
                "required": ["items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_create",
            "description": "创建一个持久化任务（适合跨对话的长期工作）",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject":     {"type": "string", "description": "任务标题"},
                    "description": {"type": "string", "description": "任务详细描述"},
                },
                "required": ["subject"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_get",
            "description": "获取指定任务的详情",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "description": "任务 ID"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_update",
            "description": "更新任务状态或依赖关系",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id":         {"type": "integer"},
                    "status":          {"type": "string", "enum": ["pending", "in_progress", "completed", "deleted"]},
                    "add_blocked_by":  {"type": "array", "items": {"type": "integer"}, "description": "添加阻塞依赖"},
                    "remove_blocked_by": {"type": "array", "items": {"type": "integer"}, "description": "移除阻塞依赖"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_list",
            "description": "列出所有持久化任务",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compact",
            "description": "手动压缩当前对话上下文：保存完整对话到磁盘，用 LLM 生成摘要替换历史，释放 token 空间。在对话变长或需要清理上下文时使用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "background_run",
            "description": "在后台异步执行 shell 命令，立即返回任务 ID，稍后用 background_check 查询结果",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的命令"},
                    "timeout": {"type": "integer", "description": "超时秒数，默认 120"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "background_check",
            "description": "查询后台任务状态和结果",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "后台任务 ID，不填则列出所有"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "subagent",
            "description": "派遣一个专注的子代理完成独立子任务（如代码分析、文件搜索、数据处理），返回结果摘要。适合需要多步工具调用的子任务。",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "给子代理的完整任务描述，包含所有必要上下文",
                    },
                    "agent_type": {
                        "type": "string",
                        "enum": ["Explore", "General"],
                        "description": "Explore=只读工具（分析/搜索）；General=含写入工具（可修改文件）",
                    },
                },
                "required": ["prompt"],
            },
        },
    },
    # ── Team tools (s09-s12) ──────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "team_spawn",
            "description": "启动一个持久化团队成员（在独立线程中运行，可自主完成任务、收发消息）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":      {"type": "string", "description": "成员名称（唯一标识）"},
                    "role":      {"type": "string", "description": "角色描述，如 coder、researcher"},
                    "prompt":    {"type": "string", "description": "初始任务描述"},
                    "model_config": {"type": "string", "description": "使用的模型配置名称，留空则用当前活跃配置"},
                },
                "required": ["name", "role", "prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_list",
            "description": "列出所有团队成员及其状态",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_send",
            "description": "向团队成员的收件箱发送消息",
            "parameters": {
                "type": "object",
                "properties": {
                    "to":       {"type": "string", "description": "接收者名称"},
                    "content":  {"type": "string", "description": "消息内容"},
                    "msg_type": {"type": "string", "enum": ["message", "broadcast", "shutdown_request"], "description": "消息类型"},
                },
                "required": ["to", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_read_inbox",
            "description": "读取并清空 lead 的收件箱（查看成员回复、计划审批请求等）",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_broadcast",
            "description": "向所有团队成员广播消息",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "广播内容"},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_approve_plan",
            "description": "审批或拒绝成员提交的计划（s10 协议）",
            "parameters": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "string"},
                    "approve":    {"type": "boolean"},
                },
                "required": ["request_id", "approve"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "team_shutdown",
            "description": "向指定成员发送关闭请求（s10 协议）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "要关闭的成员名称"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_create",
            "description": "创建 git worktree 隔离执行环境，可绑定任务 ID（s12）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":     {"type": "string", "description": "worktree 名称（字母/数字/-/_/.）"},
                    "task_id":  {"type": "integer", "description": "绑定的任务 ID（可选）"},
                    "base_ref": {"type": "string", "description": "基础分支/commit，默认 HEAD"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_list",
            "description": "列出所有 worktree 及状态",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_run",
            "description": "在指定 worktree 目录中执行命令",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":    {"type": "string", "description": "worktree 名称"},
                    "command": {"type": "string", "description": "要执行的命令"},
                },
                "required": ["name", "command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_status",
            "description": "查看 worktree 的 git 状态",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_keep",
            "description": "标记 worktree 为保留（不删除分支）",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_remove",
            "description": "移除 worktree，可选同时完成绑定任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":          {"type": "string"},
                    "force":         {"type": "boolean", "description": "强制删除（有未提交更改时）"},
                    "complete_task": {"type": "boolean", "description": "同时将绑定任务标记为完成"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "worktree_events",
            "description": "查看 worktree 生命周期事件日志",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "返回最近 N 条，默认 20"}},
            },
        },
    },
]

# Append skill + memory tool schemas
from app.skills import SKILL_TOOLS_SCHEMA
ADVANCED_TOOLS_SCHEMA = ADVANCED_TOOLS_SCHEMA + SKILL_TOOLS_SCHEMA
