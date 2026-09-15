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


SUBAGENT_MAX_ROUNDS = 10
SUBAGENT_MAX_SECONDS = 90


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
    from app.multimodal import estimate_message_tokens
    return estimate_message_tokens(messages)


def _summarize_text(model_config: dict, text: str, timeout_seconds: float = 120,
                    stop_event: threading.Event = None) -> str:
    """调模型对一段对话文本做结构化摘要。失败抛异常由调用方处理。"""
    prompt = (
        "你在为一个『AI 编程助手』压缩历史对话，供它之后无缝继续工作。"
        "请把下面的对话片段总结成结构化中文摘要，**必须尽量保留可继续工作的具体事实**，不要泛泛而谈：\n"
        "- 用户的原始需求、明确要求与约束（逐条列出，含具体数值/参数）\n"
        "- 涉及的具体文件路径、函数名、变量名、命令、URL、配置项等标识符（原样保留）\n"
        "- 已经做出的关键决策及其理由\n"
        "- 已完成的改动/结论，以及尚未完成的待办\n"
        "- 工具调用得到的关键结果（如查到的目录结构、报错信息、搜索发现）\n\n"
        "用如下结构输出：\n"
        "## 需求与约束\n## 关键事实与标识符\n## 已完成\n## 待办/未决\n## 重要结论\n\n"
        f"对话片段：\n{text}"
    )
    from app.model_protocol import complete_text

    result_queue = Queue(maxsize=1)
    request_stop = threading.Event()

    def run_summary():
        try:
            result = complete_text(
                model_config,
                [{"role": "user", "content": prompt}],
                stop_event=request_stop,
            ) or "(无摘要)"
            result_queue.put((True, result))
        except BaseException as exc:
            result_queue.put((False, exc))

    threading.Thread(target=run_summary, name="QuickModel-Compact", daemon=True).start()
    timeout_seconds = max(0.01, float(timeout_seconds))
    deadline = time.monotonic() + timeout_seconds
    while True:
        if stop_event is not None and stop_event.is_set():
            request_stop.set()
            raise InterruptedError("用户已停止上下文压缩")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            request_stop.set()
            raise TimeoutError(f"上下文摘要超过 {timeout_seconds:g} 秒")
        try:
            ok, value = result_queue.get(timeout=min(0.1, remaining))
        except Empty:
            continue
        if ok:
            return value
        raise value


def auto_compact(messages: list, model_config: dict,
                 summary_model_config: dict = None, target_tokens: int = 0,
                 timeout_seconds: float = 120, stop_event: threading.Event = None,
                 on_status=None) -> list:
    """Summarize conversation when context is too large.

    Preserves: system message (head) + recent tail (RECENT_KEEP messages).
    Replaces: the middle section with a structured summary.
    保持 system 前缀 byte-stable，DeepSeek prefix cache 保温。

    改进（修复压缩后失忆）：
    - 中段分块摘要，不再 [-80000:] 硬截断丢弃早期内容；
    - 结构化 prompt 保留可继续工作的具体事实；
    - 摘要失败则保留原始消息（不压缩），绝不用错误串替换整个中段；
    - RECENT_KEEP 提高；可用更便宜的模型（summary_client/summary_model）做摘要。
    """
    RECENT_KEEP = 15   # keep at most the last N messages verbatim
    CHUNK_CHARS = 60000  # 每块喂给摘要模型的字符上限

    def report(state: str, detail: str = ""):
        if on_status:
            try:
                on_status(state, detail)
            except Exception:
                pass

    # 摘要模型：优先用传入的便宜模型配置，回退主模型配置。
    summary_config = summary_model_config or model_config

    # Separate system messages (prefix) from conversation
    system_msgs = [m for m in messages if m.get("role") == "system"]
    conv_msgs = [m for m in messages if m.get("role") != "system"]

    # Keep a recent suffix, bounded by both message count and token budget. A
    # fixed 15-message tail can itself exceed the threshold when it contains
    # large tool results, leaving nothing compressible.
    candidates = conv_msgs[-RECENT_KEEP:]
    if target_tokens > 0 and candidates:
        tail_budget = max(1000, int(target_tokens * 0.35))
        selected, selected_tokens = [], 0
        for message in reversed(candidates):
            message_tokens = estimate_tokens([message])
            if selected and selected_tokens + message_tokens > tail_budget:
                break
            selected.append(message)
            selected_tokens += message_tokens
        tail = list(reversed(selected))
    else:
        tail = candidates

    # Align forward off tool messages so the tail does not start with an orphan.
    while tail and tail[0].get("role") == "tool":
        tail = tail[1:]

    # Summarize the middle (everything except the tail)
    middle = conv_msgs[:-len(tail)] if tail else conv_msgs
    if not middle:
        report("skipped", "没有可压缩的较早消息")
        return messages  # nothing to compact

    report("started")

    # Archive full transcript for traceability. Failure to archive should not
    # prevent context recovery, so the summary simply omits the archive path.
    path = None
    try:
        transcripts_dir = get_app_data_dir() / "transcripts"
        transcripts_dir.mkdir(exist_ok=True)
        path = transcripts_dir / f"transcript_{time.time_ns()}.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for msg in messages:
                f.write(json.dumps(msg, default=str, ensure_ascii=False) + "\n")
    except OSError:
        path = None

    # 分块：按消息累积到 CHUNK_CHARS 一块，逐块摘要，避免硬截断丢弃早期内容
    chunks, cur, cur_len = [], [], 0
    from app.multimodal import summary_safe
    for original in middle:
        m = summary_safe(original)
        s = json.dumps(m, default=str, ensure_ascii=False)
        if cur and cur_len + len(s) > CHUNK_CHARS:
            chunks.append(cur)
            cur, cur_len = [], 0
        cur.append(m)
        cur_len += len(s)
    if cur:
        chunks.append(cur)

    try:
        deadline = time.monotonic() + max(0.01, float(timeout_seconds))
        part_summaries = []
        for i, ch in enumerate(chunks):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"上下文摘要超过 {timeout_seconds:g} 秒")
            ch_text = json.dumps(ch, default=str, ensure_ascii=False)
            part_summaries.append(_summarize_text(
                summary_config, ch_text, timeout_seconds=remaining,
                stop_event=stop_event,
            ))
        if len(part_summaries) == 1:
            summary = part_summaries[0]
        else:
            # 多块：合并各块摘要为一份总摘要
            merged = "\n\n".join(f"[片段{i+1}]\n{s}" for i, s in enumerate(part_summaries))
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"上下文摘要超过 {timeout_seconds:g} 秒")
            summary = _summarize_text(
                summary_config,
                f"以下是同一段对话按时间顺序分块得到的多份摘要，请合并为一份连贯、不丢信息的结构化摘要：\n{merged}",
                timeout_seconds=remaining,
                stop_event=stop_event,
            )
    except Exception as e:
        # 关键：摘要失败不丢中段，退化为不压缩，避免灾难性失忆
        report("failed", str(e)[:300])
        return messages

    # Reassemble: system (unchanged prefix) + summary + recent tail
    compacted = list(system_msgs)
    archive_note = f"完整原始记录已存档：{path}" if path else "完整原始记录存档失败"
    image_paths = list(dict.fromkeys(
        ref["path"] for message in middle for ref in message.get("images", []) if ref.get("path")
    ))
    image_note = ""
    if image_paths:
        image_note = "\n较早图片的原始快照（未重新发送图片；需要复查时使用 view_image，纯文本模型使用 analyze_image）：\n" + "\n".join(image_paths)
    compacted.append({"role": "user", "content":
        f"<context_summary>\n以下是之前对话的结构化摘要（{archive_note}）。"
        f"请把它当作你已经掌握的上下文，无缝继续后续工作：\n{summary}{image_note}\n</context_summary>"})
    compacted.append({"role": "assistant", "content": "已完整了解之前的对话上下文，继续。"})
    compacted.extend(tail)
    report("completed", f"{estimate_tokens(messages)} -> {estimate_tokens(compacted)}")
    return compacted


# ── RLM 并行子任务 ──────────────────────────────────────────────────
def run_rlm(prompts: list[str], model_config: dict, system_prompt: str = "") -> str:
    """Dispatch 1-16 prompts to a low-cost model in parallel, return aggregated results."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from app.model_protocol import create_model_adapter

    if not prompts:
        return "错误：prompts 列表为空"
    if len(prompts) > 16:
        prompts = prompts[:16]

    sys_msg = [{"role": "system", "content": system_prompt}] if system_prompt else []

    def _call(idx: int, prompt: str) -> tuple[int, str]:
        try:
            msgs = sys_msg + [{"role": "user", "content": prompt}]
            content = create_model_adapter(model_config).complete_text(msgs)
            return idx, content or "(无输出)"
        except Exception as e:
            return idx, f"[错误] {e}"

    results = [""] * len(prompts)
    max_workers = min(len(prompts), 8)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_call, i, p): i for i, p in enumerate(prompts)}
        for future in as_completed(futures):
            idx, content = future.result()
            results[idx] = content

    parts = []
    for i, (prompt, result) in enumerate(zip(prompts, results)):
        parts.append(f"### 子任务 {i+1}\n**输入:** {prompt[:100]}{'...' if len(prompt)>100 else ''}\n**输出:** {result}")
    return "\n\n".join(parts)


# ── Subagent (s04) ───────────────────────────────────────────────────
def run_subagent(prompt: str, model_config: dict,
                 agent_type: str = "Explore", cwd: str = "") -> str:
    """Spawn a focused sub-agent with its own tool loop. Returns a summary."""
    from app.model_protocol import create_model_adapter
    from app.tools import read_file, list_directory, run_command, write_file

    adapter = create_model_adapter(model_config)

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
    sub_tools.append({
        "type": "function",
        "function": {
            "name": "complete_task",
            "description": "子任务已经完成时调用一次，立即把最终结果返回给主代理。不要在调用后继续使用其他工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "完整、可直接交给主代理的结果摘要，包含结论、证据和未完成项",
                    },
                },
                "required": ["summary"],
            },
        },
    })

    def dispatch(name, args):
        if name == "read_file":    return read_file(args.get("path", ""), cwd=cwd)
        if name == "list_directory": return list_directory(args.get("path", ""), cwd=cwd)
        if name == "run_command":  return run_command(args.get("command", ""), args.get("timeout", 30), cwd=cwd)
        if name == "write_file":   return write_file(args.get("path", ""), args.get("content", ""), cwd=cwd)
        return f"未知工具：{name}"

    messages = [{"role": "user", "content": prompt}]
    system = (
        "你是一个专注的子代理，负责完成指定的子任务。使用工具获取足够信息后，"
        "必须调用 complete_task 并在 summary 中返回详细结果；不要重复执行完全相同的工具调用，"
        "也不要为了继续探索而探索。如果无需工具，直接回答即可。"
        + (f"当前项目目录是：{cwd}。所有相对路径和命令都以此目录为基准。" if cwd else "")
    )
    MAX_STALLED_ROUNDS = 3
    executed_calls: set[str] = set()
    stalled_rounds = 0
    started_at = time.monotonic()
    evidence: list[dict] = []
    assistant_notes: list[str] = []

    def evidence_fallback(reason: str) -> str:
        parts = [f"[子代理总结降级：{reason}]", "", "已获取的工具证据："]
        if assistant_notes:
            parts.extend(["", "子代理过程说明：", *assistant_notes[-3:]])
        if evidence:
            for index, item in enumerate(evidence[-12:], 1):
                parts.append(
                    f"\n### 证据 {index}: {item['tool']}\n"
                    f"参数：{item['args']}\n"
                    f"结果：\n{item['result']}"
                )
        else:
            parts.append("\n没有成功获取工具结果。")
        return "\n".join(parts)

    def force_summary(reason: str) -> str:
        evidence_text = evidence_fallback(reason)
        compact_prompt = (
            f"原始子任务：\n{prompt}\n\n"
            f"终止原因：{reason}\n\n"
            f"以下是执行过程中已经获取的可靠材料：\n{evidence_text[-60000:]}\n\n"
            "请仅基于这些材料给出完整、结构化、可直接交给主代理的最终答案。"
            "保留版本号、路径、分支、标签、提交哈希等具体信息；材料不足时明确指出。"
        )
        try:
            send_messages = [
                {"role": "system", "content": "你是结果整理器。不得调用工具，只输出最终答案。"},
                {"role": "user", "content": compact_prompt},
            ]
            final = adapter.complete_text(send_messages)
            if final and final.strip():
                return final.strip()
        except Exception as e:
            return evidence_fallback(f"{reason}；模型总结失败：{e}")
        return evidence_fallback(f"{reason}；模型总结返回空文本")

    for _ in range(SUBAGENT_MAX_ROUNDS):
        if time.monotonic() - started_at >= SUBAGENT_MAX_SECONDS:
            return force_summary(f"子代理已达到 {SUBAGENT_MAX_SECONDS} 秒同步执行预算")
        send_messages = [{"role": "system", "content": system}] + messages

        try:
            round_result = adapter.stream_round(send_messages, tools=sub_tools, stateless=True)
        except Exception as e:
            return f"子代理调用失败：{e}"

        round_content = str(round_result.assistant_message.get("content") or "").strip()
        if round_content:
            assistant_notes.append(round_content[:12000])
        if not round_result.tool_calls:
            return round_content or force_summary("子代理结束工具循环但没有返回文本")

        for tc in round_result.tool_calls:
            if tc.get("function", {}).get("name") != "complete_task":
                continue
            try:
                args = json.loads(tc.get("function", {}).get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            summary = str(args.get("summary", "")).strip()
            return summary or round_content or force_summary("complete_task 未提供摘要")

        messages.append(round_result.assistant_message)
        # Execute tools and append results
        new_work_this_round = False
        for tc in round_result.tool_calls:
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_name = tc["function"]["name"]
            signature = json.dumps([tool_name, args], ensure_ascii=False, sort_keys=True, default=str)
            if signature in executed_calls:
                result = "相同工具调用已经执行过，已跳过。请使用已有结果并调用 complete_task 返回结论。"
            else:
                executed_calls.add(signature)
                new_work_this_round = True
                result = dispatch(tool_name, args)
                evidence.append({
                    "tool": tool_name,
                    "args": json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)[:4000],
                    "result": str(result)[:16000],
                })
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": str(result)[:50000],
            })

        stalled_rounds = 0 if new_work_this_round else stalled_rounds + 1
        if stalled_rounds >= MAX_STALLED_ROUNDS:
            return force_summary(f"检测到连续 {stalled_rounds} 轮重复工具调用，子任务没有产生新进展")

    final = force_summary(f"已达到子代理独立轮次预算 {SUBAGENT_MAX_ROUNDS}")
    return f"[子代理达到轮次预算({SUBAGENT_MAX_ROUNDS})，以下为已获取信息的总结]\n\n{final}"


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
    {
        "type": "function",
        "function": {
            "name": "rlm_query",
            "description": "并行派发多个子任务到低成本模型（deepseek-v4-flash），适合批量分析、翻译、代码审查等。最多 16 个子任务同时执行。",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "子任务提示词列表，每个独立执行",
                    },
                    "system_prompt": {
                        "type": "string",
                        "description": "所有子任务共享的系统提示词（可选）",
                    },
                },
                "required": ["prompts"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user_question",
            "description": "暂停执行并向用户提问。用于需要用户确认方向、选择方案、或补充信息时。返回用户的回答。必须提供 question 参数（不能为空）。不要用于问'计划可以吗'这类问题（用 exit_plan_mode 代替）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "要问用户的问题（必填，不能为空字符串）"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "可选的选项列表，用户可以用方向键选择（也可以自由输入）",
                    },
                    "multi_select": {"type": "boolean", "description": "是否允许多选（默认单选）", "default": False},
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "enter_plan_mode",
            "description": "进入计划模式。在开始非简单任务前主动调用，用于：新功能实现、多种方案选择、代码修改影响现有行为、架构决策、多文件变更、不确定用户意图、复杂重构。进入后输出详细计划，完成后调用 exit_plan_mode。",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "exit_plan_mode",
            "description": "退出计划模式，表示所有计划步骤已通过 ask_user_question 逐步确认完毕，开始执行。",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]

# Append skill + memory tool schemas
from app.skills import SKILL_TOOLS_SCHEMA
ADVANCED_TOOLS_SCHEMA = ADVANCED_TOOLS_SCHEMA + SKILL_TOOLS_SCHEMA
