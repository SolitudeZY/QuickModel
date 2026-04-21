"""
team.py — Multi-agent collaboration (s09-s12)

s09: MessageBus + TeammateManager (persistent JSONL inboxes, threaded agents)
s10: Shutdown + plan-approval protocols (request_id correlation)
s11: Autonomous idle polling, task auto-claim, identity re-injection
s12: WorktreeManager + EventBus (directory isolation, git worktrees)
"""
import json
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from app.config import get_app_data_dir
from app.tools import read_file, write_file, run_command

POLL_INTERVAL = 5
IDLE_TIMEOUT = 60
MAX_ROUNDS = 50

VALID_MSG_TYPES = {
    "message",
    "broadcast",
    "shutdown_request",
    "shutdown_response",
    "plan_approval_response",
}


def _team_dir() -> Path:
    d = get_app_data_dir() / "team"
    d.mkdir(exist_ok=True)
    return d


def _inbox_dir() -> Path:
    d = _team_dir() / "inbox"
    d.mkdir(exist_ok=True)
    return d


def _tasks_dir() -> Path:
    d = get_app_data_dir() / "tasks"
    d.mkdir(exist_ok=True)
    return d


# ── MessageBus (s09) ─────────────────────────────────────────────────
class MessageBus:
    def send(self, sender: str, to: str, content: str,
             msg_type: str = "message", extra: dict = None) -> str:
        if msg_type not in VALID_MSG_TYPES:
            return f"错误：无效消息类型 '{msg_type}'"
        msg = {"type": msg_type, "from": sender, "content": content,
               "timestamp": time.time()}
        if extra:
            msg.update(extra)
        inbox = _inbox_dir() / f"{to}.jsonl"
        with open(inbox, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        return f"已发送 {msg_type} 给 {to}"

    def read_inbox(self, name: str) -> list:
        inbox = _inbox_dir() / f"{name}.jsonl"
        if not inbox.exists():
            return []
        msgs = []
        for line in inbox.read_text(encoding="utf-8").strip().splitlines():
            if line:
                try:
                    msgs.append(json.loads(line))
                except Exception:
                    pass
        inbox.write_text("", encoding="utf-8")
        return msgs

    def broadcast(self, sender: str, content: str, names: list) -> str:
        count = sum(1 for n in names if n != sender
                    and not self.send(sender, n, content, "broadcast").startswith("错误"))
        return f"已广播给 {count} 个成员"


BUS = MessageBus()


# ── Task board helpers (s11) ─────────────────────────────────────────
_claim_lock = threading.Lock()


def scan_unclaimed_tasks() -> list:
    unclaimed = []
    for f in sorted(_tasks_dir().glob("task_*.json")):
        try:
            t = json.loads(f.read_text(encoding="utf-8"))
            if (t.get("status") == "pending"
                    and not t.get("owner")
                    and not t.get("blockedBy")):
                unclaimed.append(t)
        except Exception:
            pass
    return unclaimed


def claim_task(task_id: int, owner: str) -> str:
    with _claim_lock:
        path = _tasks_dir() / f"task_{task_id}.json"
        if not path.exists():
            return f"错误：任务 {task_id} 不存在"
        t = json.loads(path.read_text(encoding="utf-8"))
        if t.get("owner"):
            return f"错误：任务 {task_id} 已被 {t['owner']} 认领"
        if t.get("status") != "pending":
            return f"错误：任务 {task_id} 状态为 '{t['status']}'，无法认领"
        if t.get("blockedBy"):
            return f"错误：任务 {task_id} 被阻塞，无法认领"
        t["owner"] = owner
        t["status"] = "in_progress"
        path.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"已认领任务 #{task_id}"


# ── Request trackers (s10) ───────────────────────────────────────────
_tracker_lock = threading.Lock()
shutdown_requests: dict = {}
plan_requests: dict = {}


# ── TeammateManager (s09/s10/s11) ────────────────────────────────────
class TeammateManager:
    def __init__(self):
        self._config_path = _team_dir() / "config.json"
        self._config = self._load_config()
        self._threads: dict[str, threading.Thread] = {}
        self._notification_cb = None  # set by webview_app for UI push

    def set_notification_cb(self, cb):
        self._notification_cb = cb

    def _notify(self, msg: str):
        if self._notification_cb:
            try:
                self._notification_cb(msg)
            except Exception:
                pass

    def _load_config(self) -> dict:
        if self._config_path.exists():
            try:
                return json.loads(self._config_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"team_name": "default", "members": []}

    def _save_config(self):
        self._config_path.write_text(
            json.dumps(self._config, ensure_ascii=False, indent=2), encoding="utf-8")

    def _find(self, name: str) -> Optional[dict]:
        for m in self._config["members"]:
            if m["name"] == name:
                return m
        return None

    def _set_status(self, name: str, status: str):
        m = self._find(name)
        if m:
            m["status"] = status
            self._save_config()

    def spawn(self, name: str, role: str, prompt: str,
              api_key: str, base_url: str, model: str) -> str:
        m = self._find(name)
        if m:
            if m["status"] not in ("idle", "shutdown"):
                return f"错误：'{name}' 当前状态为 {m['status']}"
            m["status"] = "working"
            m["role"] = role
            m["model"] = model
        else:
            m = {"name": name, "role": role, "status": "working", "model": model}
            self._config["members"].append(m)
        self._save_config()
        t = threading.Thread(
            target=self._loop,
            args=(name, role, prompt, api_key, base_url, model),
            daemon=True,
        )
        self._threads[name] = t
        t.start()
        return f"已启动成员 '{name}'（角色：{role}，模型：{model}）"

    def _loop(self, name: str, role: str, prompt: str,
              api_key: str, base_url: str, model: str):
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        team_name = self._config["team_name"]
        sys_prompt = (
            f"你是 '{name}'，角色：{role}，团队：{team_name}。"
            f"完成任务后调用 idle 工具进入空闲状态。"
            f"收到 shutdown_request 时用 shutdown_response 回应。"
            f"重大操作前用 plan_approval 提交计划。"
        )
        messages = [{"role": "user", "content": prompt}]
        tools = self._teammate_tools()

        while True:
            # WORK PHASE
            for _ in range(MAX_ROUNDS):
                inbox = BUS.read_inbox(name)
                for msg in inbox:
                    if msg.get("type") == "shutdown_request":
                        self._set_status(name, "shutdown")
                        self._notify(f"[{name}] 已关闭")
                        return
                    messages.append({"role": "user", "content": json.dumps(msg, ensure_ascii=False)})
                try:
                    resp = client.chat.completions.create(
                        model=model, messages=[{"role": "system", "content": sys_prompt}] + messages,
                        tools=tools, tool_choice="auto",
                    )
                except Exception as e:
                    self._set_status(name, "idle")
                    self._notify(f"[{name}] API 错误：{e}")
                    return
                assistant_msg = {"role": "assistant", "content": resp.choices[0].message.content or ""}
                tcs = resp.choices[0].message.tool_calls or []
                if tcs:
                    assistant_msg["tool_calls"] = [
                        {"id": tc.id, "type": "function",
                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in tcs
                    ]
                messages.append(assistant_msg)
                if not tcs:
                    break
                idle_requested = False
                results = []
                for tc in tcs:
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except Exception:
                        args = {}
                    if tc.function.name == "idle":
                        idle_requested = True
                        out = "进入空闲状态，等待新任务。"
                    else:
                        out = self._exec(name, tc.function.name, args)
                    self._notify(f"[{name}] {tc.function.name}: {str(out)[:120]}")
                    results.append({"role": "tool", "tool_call_id": tc.id, "content": str(out)})
                messages.extend(results)
                if idle_requested:
                    break

            # IDLE PHASE (s11)
            self._set_status(name, "idle")
            resumed = False
            for _ in range(IDLE_TIMEOUT // max(POLL_INTERVAL, 1)):
                time.sleep(POLL_INTERVAL)
                inbox = BUS.read_inbox(name)
                if inbox:
                    for msg in inbox:
                        if msg.get("type") == "shutdown_request":
                            self._set_status(name, "shutdown")
                            self._notify(f"[{name}] 已关闭")
                            return
                        messages.append({"role": "user", "content": json.dumps(msg, ensure_ascii=False)})
                    resumed = True
                    break
                unclaimed = scan_unclaimed_tasks()
                if unclaimed:
                    task = unclaimed[0]
                    result = claim_task(task["id"], name)
                    if result.startswith("错误"):
                        continue
                    # identity re-injection (s11)
                    if len(messages) <= 3:
                        messages.insert(0, {"role": "user",
                            "content": f"<identity>你是 '{name}'，角色：{role}，团队：{team_name}。继续工作。</identity>"})
                        messages.insert(1, {"role": "assistant", "content": f"我是 {name}，继续工作。"})
                    messages.append({"role": "user",
                        "content": f"<auto-claimed>任务 #{task['id']}：{task['subject']}\n{task.get('description','')}</auto-claimed>"})
                    self._notify(f"[{name}] 自动认领任务 #{task['id']}")
                    resumed = True
                    break

            if not resumed:
                self._set_status(name, "shutdown")
                self._notify(f"[{name}] 空闲超时，已关闭")
                return
            self._set_status(name, "working")

    def _exec(self, sender: str, tool_name: str, args: dict) -> str:
        if tool_name == "read_file":
            return read_file(args.get("path", ""))
        if tool_name == "write_file":
            return write_file(args.get("path", ""), args.get("content", ""))
        if tool_name == "run_command":
            return run_command(args.get("command", ""), args.get("timeout", 30))
        if tool_name == "send_message":
            return BUS.send(sender, args["to"], args["content"],
                            args.get("msg_type", "message"))
        if tool_name == "read_inbox":
            return json.dumps(BUS.read_inbox(sender), ensure_ascii=False)
        if tool_name == "claim_task":
            return claim_task(int(args["task_id"]), sender)
        if tool_name == "shutdown_response":
            req_id = args["request_id"]
            approve = args["approve"]
            with _tracker_lock:
                if req_id in shutdown_requests:
                    shutdown_requests[req_id]["status"] = "approved" if approve else "rejected"
            BUS.send(sender, "lead", args.get("reason", ""),
                     "shutdown_response", {"request_id": req_id, "approve": approve})
            return f"关闭请求已{'批准' if approve else '拒绝'}"
        if tool_name == "plan_approval":
            plan_text = args.get("plan", "")
            req_id = uuid.uuid4().hex[:8]
            with _tracker_lock:
                plan_requests[req_id] = {"from": sender, "plan": plan_text, "status": "pending"}
            BUS.send(sender, "lead", plan_text, "plan_approval_response",
                     {"request_id": req_id, "plan": plan_text})
            return f"计划已提交（request_id={req_id}），等待审批。"
        return f"未知工具：{tool_name}"

    def _teammate_tools(self) -> list:
        return [
            {"type": "function", "function": {"name": "read_file",
                "description": "读取文件内容",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
            {"type": "function", "function": {"name": "write_file",
                "description": "写入文件",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
            {"type": "function", "function": {"name": "run_command",
                "description": "执行 shell 命令",
                "parameters": {"type": "object", "properties": {
                    "command": {"type": "string"}, "timeout": {"type": "integer"}}, "required": ["command"]}}},
            {"type": "function", "function": {"name": "send_message",
                "description": "向其他成员发送消息",
                "parameters": {"type": "object", "properties": {
                    "to": {"type": "string"}, "content": {"type": "string"},
                    "msg_type": {"type": "string", "enum": list(VALID_MSG_TYPES)}},
                    "required": ["to", "content"]}}},
            {"type": "function", "function": {"name": "read_inbox",
                "description": "读取并清空自己的收件箱",
                "parameters": {"type": "object", "properties": {}}}},
            {"type": "function", "function": {"name": "claim_task",
                "description": "从任务板认领一个未分配的任务",
                "parameters": {"type": "object", "properties": {
                    "task_id": {"type": "integer"}}, "required": ["task_id"]}}},
            {"type": "function", "function": {"name": "shutdown_response",
                "description": "回应关闭请求",
                "parameters": {"type": "object", "properties": {
                    "request_id": {"type": "string"}, "approve": {"type": "boolean"},
                    "reason": {"type": "string"}}, "required": ["request_id", "approve"]}}},
            {"type": "function", "function": {"name": "plan_approval",
                "description": "提交计划给 lead 审批",
                "parameters": {"type": "object", "properties": {
                    "plan": {"type": "string"}}, "required": ["plan"]}}},
            {"type": "function", "function": {"name": "idle",
                "description": "当前任务完成，进入空闲状态等待新任务",
                "parameters": {"type": "object", "properties": {}}}},
        ]

    def shutdown(self, name: str) -> str:
        req_id = uuid.uuid4().hex[:8]
        with _tracker_lock:
            shutdown_requests[req_id] = {"target": name, "status": "pending"}
        return BUS.send("lead", name, "请关闭", "shutdown_request", {"request_id": req_id})

    def list_all(self) -> str:
        if not self._config["members"]:
            return "暂无团队成员。"
        lines = [f"团队：{self._config['team_name']}"]
        for m in self._config["members"]:
            lines.append(f"  {m['name']} ({m['role']}) [{m.get('model','')}]: {m['status']}")
        return "\n".join(lines)

    def member_names(self) -> list:
        return [m["name"] for m in self._config["members"]]

    def approve_plan(self, request_id: str, approve: bool) -> str:
        with _tracker_lock:
            req = plan_requests.get(request_id)
        if not req:
            return f"错误：未找到计划请求 {request_id}"
        req["status"] = "approved" if approve else "rejected"
        BUS.send("lead", req["from"], f"计划已{'批准' if approve else '拒绝'}",
                 "plan_approval_response", {"request_id": request_id, "approve": approve})
        return f"计划 {request_id} 已{'批准' if approve else '拒绝'}"

    def pending_plans(self) -> list:
        with _tracker_lock:
            return [{"request_id": k, **v}
                    for k, v in plan_requests.items() if v["status"] == "pending"]


# ── EventBus (s12) ───────────────────────────────────────────────────
class EventBus:
    def __init__(self):
        self._path = get_app_data_dir() / "worktrees" / "events.jsonl"
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text("", encoding="utf-8")

    def emit(self, event: str, task: dict = None, worktree: dict = None, error: str = None):
        payload = {"event": event, "ts": time.time(),
                   "task": task or {}, "worktree": worktree or {}}
        if error:
            payload["error"] = error
        with self._path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def list_recent(self, limit: int = 20) -> str:
        n = max(1, min(int(limit or 20), 200))
        lines = self._path.read_text(encoding="utf-8").splitlines()
        items = []
        for line in lines[-n:]:
            try:
                items.append(json.loads(line))
            except Exception:
                pass
        return json.dumps(items, ensure_ascii=False, indent=2)


# ── WorktreeManager (s12) ────────────────────────────────────────────
class WorktreeManager:
    def __init__(self, events: EventBus):
        self._events = events
        self._dir = get_app_data_dir() / "worktrees"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._index_path = self._dir / "index.json"
        if not self._index_path.exists():
            self._index_path.write_text(json.dumps({"worktrees": []}, indent=2), encoding="utf-8")
        self.git_available = self._is_git_repo()

    def _is_git_repo(self) -> bool:
        try:
            r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                               capture_output=True, text=True, timeout=10)
            return r.returncode == 0
        except Exception:
            return False

    def _git(self, args: list) -> str:
        if not self.git_available:
            raise RuntimeError("当前目录不是 git 仓库，worktree 功能需要 git。")
        r = subprocess.run(["git", *args], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError((r.stdout + r.stderr).strip())
        return (r.stdout + r.stderr).strip() or "(no output)"

    def _load_index(self) -> dict:
        return json.loads(self._index_path.read_text(encoding="utf-8"))

    def _save_index(self, data: dict):
        self._index_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _find(self, name: str) -> Optional[dict]:
        for wt in self._load_index().get("worktrees", []):
            if wt.get("name") == name:
                return wt
        return None

    def create(self, name: str, task_id: int = None, base_ref: str = "HEAD") -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", name or ""):
            return "错误：worktree 名称只能含字母、数字、.、_、-，长度 1-40"
        if self._find(name):
            return f"错误：worktree '{name}' 已存在"
        path = self._dir / name
        branch = f"wt/{name}"
        self._events.emit("worktree.create.before",
                          task={"id": task_id} if task_id else {},
                          worktree={"name": name})
        try:
            self._git(["worktree", "add", "-b", branch, str(path), base_ref])
            entry = {"name": name, "path": str(path), "branch": branch,
                     "task_id": task_id, "status": "active", "created_at": time.time()}
            idx = self._load_index()
            idx["worktrees"].append(entry)
            self._save_index(idx)
            if task_id is not None:
                tp = _tasks_dir() / f"task_{task_id}.json"
                if tp.exists():
                    t = json.loads(tp.read_text(encoding="utf-8"))
                    t["worktree"] = name
                    if t.get("status") == "pending":
                        t["status"] = "in_progress"
                    tp.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
            self._events.emit("worktree.create.after",
                              task={"id": task_id} if task_id else {},
                              worktree={"name": name, "path": str(path), "branch": branch})
            return json.dumps(entry, ensure_ascii=False, indent=2)
        except Exception as e:
            self._events.emit("worktree.create.failed", error=str(e),
                              worktree={"name": name})
            return f"错误：{e}"

    def list_all(self) -> str:
        wts = self._load_index().get("worktrees", [])
        if not wts:
            return "暂无 worktree。"
        lines = []
        for wt in wts:
            suffix = f" task={wt['task_id']}" if wt.get("task_id") else ""
            lines.append(f"[{wt.get('status','?')}] {wt['name']} → {wt['path']}{suffix}")
        return "\n".join(lines)

    def status(self, name: str) -> str:
        wt = self._find(name)
        if not wt:
            return f"错误：未知 worktree '{name}'"
        path = Path(wt["path"])
        if not path.exists():
            return f"错误：路径不存在 {path}"
        r = subprocess.run(["git", "status", "--short", "--branch"],
                           cwd=path, capture_output=True, text=True, timeout=30)
        return (r.stdout + r.stderr).strip() or "干净的 worktree"

    def run(self, name: str, command: str) -> str:
        wt = self._find(name)
        if not wt:
            return f"错误：未知 worktree '{name}'"
        path = Path(wt["path"])
        if not path.exists():
            return f"错误：路径不存在 {path}"
        try:
            r = subprocess.run(command, shell=True, cwd=path,
                               capture_output=True, timeout=300)
            import locale
            def _dec(b):
                if not b: return ""
                for enc in (locale.getpreferredencoding(False), "utf-8", "gbk"):
                    try: return b.decode(enc)
                    except: pass
                return b.decode("utf-8", errors="replace")
            return (_dec(r.stdout) + _dec(r.stderr)).strip()[:50000] or "(no output)"
        except subprocess.TimeoutExpired:
            return "错误：超时（300s）"

    def keep(self, name: str) -> str:
        wt = self._find(name)
        if not wt:
            return f"错误：未知 worktree '{name}'"
        idx = self._load_index()
        for item in idx.get("worktrees", []):
            if item.get("name") == name:
                item["status"] = "kept"
                item["kept_at"] = time.time()
        self._save_index(idx)
        self._events.emit("worktree.keep", worktree={"name": name})
        return f"worktree '{name}' 已标记为保留"

    def remove(self, name: str, force: bool = False, complete_task: bool = False) -> str:
        wt = self._find(name)
        if not wt:
            return f"错误：未知 worktree '{name}'"
        self._events.emit("worktree.remove.before", worktree={"name": name})
        try:
            args = ["worktree", "remove"]
            if force:
                args.append("--force")
            args.append(wt["path"])
            self._git(args)
            if complete_task and wt.get("task_id") is not None:
                tp = _tasks_dir() / f"task_{wt['task_id']}.json"
                if tp.exists():
                    t = json.loads(tp.read_text(encoding="utf-8"))
                    t["status"] = "completed"
                    t["worktree"] = ""
                    tp.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
            idx = self._load_index()
            for item in idx.get("worktrees", []):
                if item.get("name") == name:
                    item["status"] = "removed"
                    item["removed_at"] = time.time()
            self._save_index(idx)
            self._events.emit("worktree.remove.after", worktree={"name": name, "status": "removed"})
            return f"已移除 worktree '{name}'"
        except Exception as e:
            self._events.emit("worktree.remove.failed", error=str(e), worktree={"name": name})
            return f"错误：{e}"

    def events(self, limit: int = 20) -> str:
        return self._events.list_recent(limit)


# ── Global singletons ────────────────────────────────────────────────
EVENTS = EventBus()
WORKTREES = WorktreeManager(EVENTS)
TEAM = TeammateManager()
