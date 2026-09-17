import json
import re
import uuid
import ntpath
import posixpath
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.config import get_conversations_dir


def _conv_path(conv_id: str) -> Path:
    return get_conversations_dir() / f"{conv_id}.json"


def new_conversation(model_config_name: str = "", project_path: str = "") -> dict:
    now = datetime.now()
    conv_id = f"conv_{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    return {
        "id": conv_id,
        "title": "新对话",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "model_config": model_config_name,
        "project_path": project_path or "",
        "sort_order": -1,
        "messages": [],
    }


def save_conversation(conv: dict) -> None:
    conv["updated_at"] = datetime.now().isoformat()
    with open(_conv_path(conv["id"]), "w", encoding="utf-8") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)


def load_conversation(conv_id: str) -> Optional[dict]:
    p = _conv_path(conv_id)
    if not p.exists():
        return None
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Sync conflict copies have distinct filenames but may share an embedded ID.
    data["id"] = p.stem
    return data


def delete_conversation(conv_id: str) -> None:
    p = _conv_path(conv_id)
    if p.exists():
        p.unlink()


def delete_conversations(conv_ids: list[str]) -> int:
    """Delete existing conversations once each and return the deleted count."""
    deleted = 0
    for conv_id in dict.fromkeys(conv_ids or []):
        if not isinstance(conv_id, str) or not load_conversation(conv_id):
            continue
        delete_conversation(conv_id)
        deleted += 1
    return deleted


def rename_conversation(conv_id: str, new_title: str) -> None:
    conv = load_conversation(conv_id)
    if conv:
        conv["title"] = new_title.strip() or "新对话"
        conv["title_source"] = "manual"
        save_conversation(conv)


def set_conversation_project(conv_id: str, project_path: str) -> None:
    conv = load_conversation(conv_id)
    if conv:
        conv["project_path"] = project_path or ""
        save_conversation(conv)


def set_conversation_archived(conv_id: str, archived: bool = True) -> bool:
    """Archive or restore one conversation without moving or deleting its file."""
    conv = load_conversation(conv_id)
    if not conv:
        return False
    if archived:
        conv["archived_at"] = datetime.now().isoformat()
    else:
        conv.pop("archived_at", None)
    save_conversation(conv)
    return True


def set_conversations_archived(conv_ids: list[str], archived: bool = True) -> int:
    """Archive or restore existing conversations once each."""
    return sum(
        1 for conv_id in dict.fromkeys(conv_ids or [])
        if isinstance(conv_id, str) and set_conversation_archived(conv_id, archived)
    )


def project_path_key(project_path: str) -> str:
    """Normalize a project path for comparison without requiring it to exist."""
    raw = str(project_path or "").strip()
    if not raw:
        return ""
    is_windows_path = bool(re.match(r"^[A-Za-z]:[\\/]", raw)) or raw.startswith(("\\\\", "//"))
    if is_windows_path or "\\" in raw:
        return ntpath.normcase(ntpath.normpath(raw.replace("/", "\\")))
    return posixpath.normpath(raw)


def set_project_archived(project_path: str, archived: bool = True) -> int:
    """Archive or restore every conversation bound to one exact project path."""
    target = project_path_key(project_path)
    if not target:
        return 0
    matched = [
        item for item in list_conversations()
        if project_path_key(item.get("project_path", "")) == target
    ]
    for item in matched:
        set_conversation_archived(item["id"], archived)
    return len(matched)


def list_conversations() -> list[dict]:
    """返回所有对话摘要。
    排序规则：
    - sort_order >= 0 的对话（手动拖拽固定）按 sort_order 升序排在最前
    - sort_order = -1 的对话按 updated_at 降序（最新在上），插在最前面
    这样新对话和最近活跃的对话始终出现在列表顶部。
    """
    convs = []
    for p in get_conversations_dir().glob("conv_*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            convs.append({
                "id": p.stem,
                "title": data.get("title", "新对话"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "sort_order": data.get("sort_order", -1),
                "model_config": data.get("model_config", ""),
                "project_path": data.get("project_path", ""),
                "archived_at": data.get("archived_at", ""),
                "archived": bool(data.get("archived_at")),
            })
        except Exception:
            continue

    unpinned = [c for c in convs if c["sort_order"] < 0]
    pinned = [c for c in convs if c["sort_order"] >= 0]
    unpinned.sort(key=lambda c: c["updated_at"], reverse=True)
    pinned.sort(key=lambda c: c["sort_order"])
    return unpinned + pinned


def search_conversations(keyword: str) -> list[dict]:
    """Search titles and user-visible user/assistant message text only."""
    kw = (keyword or "").casefold().strip()
    if not kw:
        return []
    results: list[dict] = []
    for path in get_conversations_dir().glob("conv_*.json"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            title = str(data.get("title", "") or "")
            base = {
                "id": path.stem,
                "title": title,
                "project_path": data.get("project_path", ""),
                "archived": bool(data.get("archived_at")),
            }
            if kw in title.casefold():
                results.append({**base, "match": "title"})
                continue
            for message in data.get("messages", []):
                if message.get("role") not in ("user", "assistant"):
                    continue
                content = str(message.get("content", "") or "")
                folded = content.casefold()
                if kw not in folded:
                    continue
                index = folded.index(kw)
                start = max(0, index - 20)
                end = min(len(content), index + len(keyword) + 40)
                snippet = content[start:end].replace("\n", " ")
                if start > 0:
                    snippet = "..." + snippet
                if end < len(content):
                    snippet += "..."
                results.append({**base, "match": "content", "snippet": snippet})
                break
        except Exception:
            continue
    return results


def update_sort_orders(ordered_ids: list[str]) -> None:
    """拖拽后批量写入 sort_order（0-based），使手动顺序持久化。"""
    for i, conv_id in enumerate(ordered_ids):
        conv = load_conversation(conv_id)
        if conv:
            conv["sort_order"] = i
            save_conversation(conv)


def auto_title_from_message(conv: dict, first_user_message: str) -> None:
    """用首条用户消息的前 30 字作为临时标题（LLM 生成前的占位）。"""
    if conv.get("title") == "新对话":
        title = first_user_message.strip().replace("\n", " ")[:30]
        conv["title"] = title or "新对话"


def export_conversation_md(conv: dict) -> str:
    """将对话导出为 Markdown 字符串（仅用户和助手内容，不含工具调用）。"""
    lines = [f"# {conv.get('title', '对话')}\n"]
    lines.append(f"> 创建时间：{conv.get('created_at', '')}\n")
    lines.append(f"> 模型配置：{conv.get('model_config', '')}\n\n---\n")
    for msg in conv.get("messages", []):
        role = msg.get("role", "")
        content = msg.get("content") or ""
        if role == "user":
            lines.append(f"**User:**\n\n{content}\n\n")
        elif role == "assistant" and content:
            lines.append(f"**Assistant:**\n\n{content}\n\n")
    return "".join(lines)


def read_conversations_by_date(start_date: str = "", end_date: str = "",
                               max_chars: int = 120000) -> str:
    """按 updated_at 时间范围读取会话的完整内容，供模型总结（如写周报）。

    start_date/end_date 为 YYYY-MM-DD（含边界；end_date 当天算到 23:59:59）。
    留空则不限该端。返回各命中会话的 Markdown 文本拼接，超 max_chars 截断并提示。
    """
    from datetime import datetime as _dt, time as _time

    def _parse(d: str, end: bool):
        d = (d or "").strip()
        if not d:
            return None
        try:
            day = _dt.strptime(d[:10], "%Y-%m-%d").date()
            return _dt.combine(day, _time.max if end else _time.min)
        except ValueError:
            return None

    lo = _parse(start_date, end=False)
    hi = _parse(end_date, end=True)

    hits = []
    for p in get_conversations_dir().glob("conv_*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        ts = data.get("updated_at", "") or data.get("created_at", "")
        if not ts:
            continue
        try:
            when = _dt.fromisoformat(ts)
        except ValueError:
            continue
        if lo and when < lo:
            continue
        if hi and when > hi:
            continue
        hits.append((when, data))

    if not hits:
        rng = f"{start_date or '不限'} ~ {end_date or '不限'}"
        return f"该时间范围（{rng}）内没有会话记录。"

    hits.sort(key=lambda x: x[0])  # 按时间升序
    parts = [f"共 {len(hits)} 个会话（时间范围 {start_date or '不限'} ~ {end_date or '不限'}）：\n"]
    for when, data in hits:
        parts.append(f"\n===== 会话：{data.get('title', '新对话')}"
                     f"（更新于 {when.strftime('%Y-%m-%d %H:%M')}）=====\n")
        parts.append(export_conversation_md(data))
    text = "".join(parts)
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n\n[内容过长已截断，仅显示前 {max_chars} 字符。可缩小时间范围再试]"
    return text


def import_conversation_from_file(file_path: str) -> Optional[dict]:
    """从文件导入对话。支持 .json（原生格式）和 .md（导出格式）。"""
    p = Path(file_path)
    if not p.exists():
        return None

    if p.suffix.lower() == '.json':
        return _import_from_json(p)
    elif p.suffix.lower() == '.md':
        return _import_from_md(p)
    return None


def _import_from_json(p: Path) -> Optional[dict]:
    """导入原生 JSON 格式的对话文件。"""
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

    # 如果是完整的对话 JSON（有 id 和 messages）
    if "messages" in data:
        conv = new_conversation(data.get("model_config", ""))
        conv["title"] = data.get("title", p.stem)
        conv["messages"] = data["messages"]
        save_conversation(conv)
        return conv

    return None


def _import_from_md(p: Path) -> Optional[dict]:
    """解析导出的 Markdown 格式，还原为对话。"""
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        return None

    messages = []
    title = p.stem

    # 提取标题
    lines = text.split('\n')
    for line in lines:
        if line.startswith('# '):
            title = line[2:].strip()
            break

    # 按 **User:** 和 **Assistant:** 分割
    parts = re.split(r'\n\*\*(User|Assistant):\*\*\s*\n', text)
    # parts: [header, 'User', content, 'Assistant', content, ...]
    i = 1
    while i < len(parts) - 1:
        role = parts[i].lower()
        content = parts[i + 1].strip()
        if role in ('user', 'assistant') and content:
            messages.append({"role": role, "content": content})
        i += 2

    if not messages:
        return None

    conv = new_conversation("")
    conv["title"] = title
    conv["messages"] = messages
    save_conversation(conv)
    return conv
