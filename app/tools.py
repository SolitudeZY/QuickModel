import json
import os
import subprocess
from pathlib import Path
from typing import Any

# ── 文档解析依赖（可选，缺失时降级为纯文本）──────────────────────────
try:
    import pdfplumber
    _PDF_OK = True
except ImportError:
    _PDF_OK = False

try:
    from docx import Document as DocxDocument
    _DOCX_OK = True
except ImportError:
    _DOCX_OK = False

try:
    import openpyxl
    _XLSX_OK = True
except ImportError:
    _XLSX_OK = False

MAX_FILE_CHARS = 50_000


# ── 工具实现 ──────────────────────────────────────────────────────────

def read_file(path: str) -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f"错误：文件不存在 — {path}"
    if not p.is_file():
        return f"错误：路径不是文件 — {path}"

    suffix = p.suffix.lower()

    try:
        if suffix == ".pdf":
            return _read_pdf(p)
        elif suffix == ".docx":
            return _read_docx(p)
        elif suffix in (".xlsx", ".xls"):
            return _read_xlsx(p)
        else:
            text = p.read_text(encoding="utf-8", errors="replace")
            return _truncate(text, path)
    except Exception as e:
        return f"读取文件失败：{e}"


def _read_pdf(p: Path) -> str:
    if not _PDF_OK:
        return "错误：pdfplumber 未安装，无法读取 PDF"
    text_parts = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
    return _truncate("\n".join(text_parts), str(p))


def _read_docx(p: Path) -> str:
    if not _DOCX_OK:
        return "错误：python-docx 未安装，无法读取 Word 文档"
    doc = DocxDocument(str(p))
    text = "\n".join(para.text for para in doc.paragraphs)
    return _truncate(text, str(p))


def _read_xlsx(p: Path) -> str:
    if not _XLSX_OK:
        return "错误：openpyxl 未安装，无法读取 Excel 文件"
    wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
    lines = []
    for sheet in wb.worksheets:
        lines.append(f"=== Sheet: {sheet.title} ===")
        for row in sheet.iter_rows(values_only=True):
            lines.append("\t".join("" if v is None else str(v) for v in row))
    return _truncate("\n".join(lines), str(p))


def _truncate(text: str, path: str) -> str:
    if len(text) > MAX_FILE_CHARS:
        return text[:MAX_FILE_CHARS] + f"\n\n[文件已截断，仅显示前 {MAX_FILE_CHARS} 字符，原始路径：{path}]"
    return text


def list_directory(path: str) -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f"错误：路径不存在 — {path}"
    if not p.is_dir():
        return f"错误：路径不是目录 — {path}"
    try:
        entries = sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        lines = []
        for e in entries:
            tag = "[目录]" if e.is_dir() else "[文件]"
            size = "" if e.is_dir() else f"  {e.stat().st_size:,} bytes"
            lines.append(f"{tag} {e.name}{size}")
        return "\n".join(lines) if lines else "（空目录）"
    except PermissionError:
        return f"错误：无权限访问 — {path}"


def run_command(command: str, timeout: int = 30) -> str:
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=timeout,
        )
        # Windows 系统命令输出为本地编码（GBK/CP936），先尝试本地编码，再 fallback UTF-8
        def _decode(b: bytes) -> str:
            if not b:
                return ""
            import locale
            for enc in (locale.getpreferredencoding(False), "utf-8", "gbk", "cp936"):
                try:
                    return b.decode(enc)
                except (UnicodeDecodeError, LookupError):
                    continue
            return b.decode("utf-8", errors="replace")

        stdout = _decode(result.stdout)
        stderr = _decode(result.stderr)
        output = stdout
        if stderr:
            output += f"\n[stderr]\n{stderr}"
        if result.returncode != 0:
            output += f"\n[退出码: {result.returncode}]"
        return output.strip() or f"（命令执行完毕，退出码 {result.returncode}，无输出）"
    except subprocess.TimeoutExpired:
        return f"错误：命令超时（{timeout}s）— 提示：Windows 请使用 cmd 语法，避免使用 && 或 $VAR，可改用多条命令分开执行"
    except Exception as e:
        return f"执行失败：{e}"


def web_search(query: str, max_results: int = 5, api_key: str = "") -> str:
    if not api_key:
        return "错误：未配置 Tavily API Key，请在设置中填写"
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        resp = client.search(query=query, max_results=max_results)
        results = resp.get("results", [])
        if not results:
            return "未找到相关结果"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.get('title', '')}")
            lines.append(f"   URL: {r.get('url', '')}")
            lines.append(f"   {r.get('content', '')[:300]}")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"搜索失败：{e}"


def write_file(path: str, content: str) -> str:
    try:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"文件已写入：{path}（{len(content)} 字符）"
    except Exception as e:
        return f"写入失败：{e}"


# ── 工具 Schema（供 OpenAI Function Calling 使用）────────────────────

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文件内容，支持 txt/md/py/json/csv/pdf/docx/xlsx 等格式",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件的绝对或相对路径"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "列出指定目录下的文件和子目录",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目录路径"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "使用 Tavily 搜索互联网，获取实时信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "description": "返回结果数量，默认 5", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "在 PowerShell 中执行命令，返回输出结果。支持 PowerShell 语法，包括 &&、$ENV:VAR、管道等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的 shell 命令"},
                    "timeout": {"type": "integer", "description": "超时秒数，默认 30", "default": 30},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "将内容写入本地文件（会覆盖已有文件）",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目标文件路径"},
                    "content": {"type": "string", "description": "要写入的文本内容"},
                },
                "required": ["path", "content"],
            },
        },
    },
]

# 需要用户确认的工具
CONFIRM_REQUIRED = {"run_command", "write_file"}


def dispatch(tool_name: str, args: dict, tavily_key: str = "", timeout: int = 30) -> str:
    """执行工具调用，返回字符串结果。"""
    if tool_name == "read_file":
        return read_file(args.get("path", ""))
    elif tool_name == "list_directory":
        return list_directory(args.get("path", ""))
    elif tool_name == "web_search":
        return web_search(args.get("query", ""), args.get("max_results", 5), api_key=tavily_key)
    elif tool_name == "run_command":
        return run_command(args.get("command", ""), args.get("timeout", timeout))
    elif tool_name == "write_file":
        return write_file(args.get("path", ""), args.get("content", ""))
    else:
        return f"未知工具：{tool_name}"
