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


def run_command(command: str, timeout: int = 30, stop_flag=None) -> str:
    import time, threading

    try:
        # CREATE_NO_WINDOW prevents PowerShell console from flashing
        creationflags = 0
        if os.name == 'nt':
            creationflags = subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            creationflags=creationflags,
        )

        result_holder = {}

        def _communicate():
            try:
                out, err = proc.communicate()
                result_holder['stdout'] = out
                result_holder['stderr'] = err
            except Exception as e:
                result_holder['error'] = str(e)

        t = threading.Thread(target=_communicate, daemon=True)
        t.start()

        elapsed = 0
        interval = 0.2
        while t.is_alive():
            if stop_flag and stop_flag.is_set():
                proc.kill()
                t.join(2)
                return "用户已停止命令执行"
            if elapsed >= timeout:
                proc.kill()
                t.join(2)
                return f"错误：命令超时（{timeout}s）"
            time.sleep(interval)
            elapsed += interval

        if 'error' in result_holder:
            return f"执行失败：{result_holder['error']}"

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

        stdout = _decode(result_holder.get('stdout', b''))
        stderr = _decode(result_holder.get('stderr', b''))
        output = stdout
        if stderr:
            output += f"\n[stderr]\n{stderr}"
        if proc.returncode != 0:
            output += f"\n[退出码: {proc.returncode}]"
        return output.strip() or f"（命令执行完毕，退出码 {proc.returncode}，无输出）"
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
            lines.append(f"   {r.get('content', '')[:600]}")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"搜索失败：{e}"


def web_read(url: str, max_chars: int = 20000) -> str:
    """Fetch a URL and return its text content (HTML stripped to readable text)."""
    try:
        import urllib.request
        import re as _re
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
        # Try utf-8 first, then detect from headers
        charset = "utf-8"
        ct = resp.headers.get("Content-Type", "")
        if "charset=" in ct:
            charset = ct.split("charset=")[-1].strip().split(";")[0]
        try:
            html = raw.decode(charset)
        except Exception:
            html = raw.decode("utf-8", errors="replace")
        # Strip HTML tags, scripts, styles
        html = _re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=_re.IGNORECASE)
        html = _re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=_re.IGNORECASE)
        html = _re.sub(r'<[^>]+>', ' ', html)
        # Collapse whitespace
        text = _re.sub(r'\s+', ' ', html).strip()
        # Decode HTML entities
        import html as _html_mod
        text = _html_mod.unescape(text)
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[内容已截断，共 {len(text)} 字符，显示前 {max_chars} 字符]"
        return text if text else "（页面无文本内容）"
    except Exception as e:
        return f"读取失败：{e}"


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
            "description": "使用 Tavily 搜索互联网获取实时信息。每次搜索消耗 API 配额，请高效使用：先用一个精准的关键词搜索，根据结果判断是否需要补充搜索。通常 1-5 次搜索即可满足需求，避免对同一主题反复搜索。如果搜索结果的摘要不够详细，请使用 web_read 工具读取具体网页的完整内容，而不是继续搜索。",
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
            "name": "web_read",
            "description": "读取指定 URL 的网页完整内容（HTML 转纯文本）。当 web_search 的摘要不够详细时，用此工具获取完整页面。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要读取的网页 URL"},
                },
                "required": ["url"],
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


def dispatch(tool_name: str, args: dict, tavily_key: str = "", timeout: int = 30, stop_flag=None) -> str:
    """执行工具调用，返回字符串结果。"""
    if tool_name == "read_file":
        return read_file(args.get("path", ""))
    elif tool_name == "list_directory":
        return list_directory(args.get("path", ""))
    elif tool_name == "web_search":
        return web_search(args.get("query", ""), args.get("max_results", 5), api_key=tavily_key)
    elif tool_name == "web_read":
        return web_read(args.get("url", ""))
    elif tool_name == "run_command":
        return run_command(args.get("command", ""), args.get("timeout", timeout), stop_flag=stop_flag)
    elif tool_name == "write_file":
        return write_file(args.get("path", ""), args.get("content", ""))
    else:
        return f"未知工具：{tool_name}"
