"""
skills.py — Skill management for the AI assistant.

Skills are markdown files stored in %APPDATA%/AIDesktopAssistant/skills/.
Each skill has a name, description, and content (prompt/instructions).
The LLM can list and read skills on demand via tools.
Users can add/edit/delete skills via the UI.
"""
import json
from pathlib import Path
from app.config import get_app_data_dir


def _skills_dir() -> Path:
    d = get_app_data_dir() / "skills"
    d.mkdir(exist_ok=True)
    return d


def _skill_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("\\", "_").strip()
    return _skills_dir() / f"{safe}.md"


# ── CRUD ─────────────────────────────────────────────────────────────

def skill_save(name: str, description: str, content: str) -> str:
    name = name.strip()
    if not name:
        return "错误：技能名称不能为空"
    p = _skill_path(name)
    header = f"---\nname: {name}\ndescription: {description.strip()}\n---\n\n"
    p.write_text(header + content, encoding="utf-8")
    return f"技能 '{name}' 已保存"


def skill_delete(name: str) -> str:
    p = _skill_path(name)
    if not p.exists():
        return f"错误：技能 '{name}' 不存在"
    p.unlink()
    return f"技能 '{name}' 已删除"


def skill_list() -> list[dict]:
    skills = []
    for p in sorted(_skills_dir().glob("*.md")):
        try:
            text = p.read_text(encoding="utf-8")
            name, description = p.stem, ""
            if text.startswith("---"):
                parts = text.split("---", 2)
                if len(parts) >= 3:
                    for line in parts[1].splitlines():
                        if line.startswith("name:"):
                            name = line[5:].strip()
                        elif line.startswith("description:"):
                            description = line[12:].strip()
            skills.append({"name": name, "description": description, "file": p.name})
        except Exception:
            pass
    return skills


def skill_read(name: str) -> str:
    p = _skill_path(name)
    if not p.exists():
        # fuzzy match
        for f in _skills_dir().glob("*.md"):
            if name.lower() in f.stem.lower():
                p = f
                break
    if not p.exists():
        return f"错误：技能 '{name}' 不存在"
    text = p.read_text(encoding="utf-8")
    # strip frontmatter, return content only
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return text


def skill_import_from_path(path: str) -> list[dict]:
    """
    Import one or more Claude-style skills from a path.

    Accepts:
    - A directory containing SKILL.md → imports as single skill
    - A SKILL.md file directly → imports that skill
    - A directory tree with subdirectories containing SKILL.md → batch imports all

    Returns list of {name, description, content} dicts.
    """
    p = Path(path)
    results = []

    if p.is_file() and p.name.upper() == "SKILL.MD":
        skill = _parse_skill_dir(p.parent)
        if skill:
            results.append(skill)
    elif p.is_dir():
        skill_md = p / "SKILL.md"
        if skill_md.exists():
            # Single skill directory
            skill = _parse_skill_dir(p)
            if skill:
                results.append(skill)
        else:
            # Recursively scan for subdirectories with SKILL.md (up to 3 levels deep)
            for sub in sorted(p.rglob("SKILL.md")):
                skill = _parse_skill_dir(sub.parent)
                if skill:
                    results.append(skill)

    return results


def _parse_skill_dir(skill_dir: Path) -> dict | None:
    """Parse a skill directory: reads SKILL.md frontmatter + inlines companion .md files."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None
    try:
        text = skill_md.read_text(encoding="utf-8")
        name = skill_dir.name
        description = ""
        content = text

        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) >= 3:
                for line in parts[1].splitlines():
                    if line.startswith("name:"):
                        name = line[5:].strip()
                    elif line.startswith("description:"):
                        description = line[12:].strip()
                content = parts[2].strip()

        # Inline companion .md files (skip SKILL.md itself and README.md)
        companions = sorted(
            f for f in skill_dir.glob("*.md")
            if f.name.upper() not in ("SKILL.MD", "README.MD")
        )
        if companions:
            sections = [content]
            for cf in companions:
                try:
                    cf_text = cf.read_text(encoding="utf-8")
                    sections.append(f"\n\n---\n\n## {cf.stem}\n\n{cf_text.strip()}")
                except Exception:
                    pass
            content = "\n".join(sections)

        return {"name": name, "description": description, "content": content}
    except Exception:
        return None


def skill_list_str() -> str:
    skills = skill_list()
    if not skills:
        return "暂无技能。"
    lines = [f"- {s['name']}: {s['description']}" for s in skills]
    return "\n".join(lines)


# ── Memory helpers ────────────────────────────────────────────────────

def _memory_dir() -> Path:
    d = get_app_data_dir() / "memory"
    d.mkdir(exist_ok=True)
    return d


def memory_read(key: str = "") -> str:
    """Read a memory file by key, or list all memory keys."""
    if not key:
        files = sorted(_memory_dir().glob("*.md")) + sorted(_memory_dir().glob("*.txt"))
        if not files:
            return "暂无记忆文件。"
        return "\n".join(f.stem for f in files)
    for ext in (".md", ".txt", ""):
        p = _memory_dir() / f"{key}{ext}"
        if p.exists():
            return p.read_text(encoding="utf-8")
    return f"错误：记忆 '{key}' 不存在"


def memory_write(key: str, content: str) -> str:
    """Write or update a memory file."""
    if not key.strip():
        return "错误：key 不能为空"
    p = _memory_dir() / f"{key.strip()}.md"
    p.write_text(content, encoding="utf-8")
    return f"记忆 '{key}' 已保存"


def memory_list() -> list[dict]:
    files = sorted(_memory_dir().glob("*.md")) + sorted(_memory_dir().glob("*.txt"))
    result = []
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
            preview = text[:100].replace("\n", " ")
            result.append({"key": f.stem, "preview": preview})
        except Exception:
            pass
    return result


# ── Tool schemas ──────────────────────────────────────────────────────

SKILL_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "skill_list",
            "description": "列出所有可用技能（名称和描述）",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_read",
            "description": "读取指定技能的完整内容（提示词/指令）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "技能名称"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_read",
            "description": "读取记忆文件内容，不传 key 则列出所有记忆键名",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "记忆键名，留空则列出所有"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_write",
            "description": "写入或更新记忆文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "key":     {"type": "string", "description": "记忆键名（文件名）"},
                    "content": {"type": "string", "description": "记忆内容"},
                },
                "required": ["key", "content"],
            },
        },
    },
]
