import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
import re
import io

# ── matplotlib：LaTeX 渲染（Windows 无 cairo，仅用 mathtext）────────
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image, ImageTk
    _MPL_OK = True
except ImportError:
    _MPL_OK = False

_LATEX_OK = _MPL_OK

# ── mistune：Markdown 解析 ───────────────────────────────────────────
try:
    import mistune
    _MISTUNE_OK = True
except ImportError:
    _MISTUNE_OK = False


def _is_dark() -> bool:
    return ctk.get_appearance_mode().lower() == "dark"


def _theme_colors() -> dict:
    dark = _is_dark()
    return {
        "text_fg":    "#E0E0E0" if dark else "#1A1A1A",
        "muted_fg":   "#888888" if dark else "#666666",
        "h_fg":       "#FFFFFF" if dark else "#111111",
        "bold_fg":    "#E0E0E0" if dark else "#1A1A1A",
        "italic_fg":  "#C0C0C0" if dark else "#333333",
        "code_fg":    "#D4D4D4" if dark else "#1A1A1A",
        "code_bg":    "#2D2D2D" if dark else "#F0F0F0",
        "link_fg":    "#6AABFF" if dark else "#0066CC",
    }


class CodeBlock(tk.Frame):
    """可复制的代码块组件。"""

    def __init__(self, master, code: str, lang: str = "", font_size: int = 12, **kwargs):
        tc = _theme_colors()
        super().__init__(master, bg=tc["code_bg"], **kwargs)

        # 顶部语言标签 + 复制按钮
        header = tk.Frame(self, bg=tc["code_bg"])
        header.pack(fill="x")
        if lang:
            tk.Label(header, text=lang, bg=tc["code_bg"], fg=tc["muted_fg"],
                     font=("Segoe UI", 10)).pack(side="left", padx=8, pady=2)
        copy_btn = tk.Button(
            header, text="复制", bg=tc["code_bg"], fg=tc["muted_fg"],
            relief="flat", cursor="hand2", font=("Segoe UI", 10),
            command=lambda: self._copy(code),
        )
        copy_btn.pack(side="right", padx=8, pady=2)

        # 代码文本框（可选中复制）
        self._text = tk.Text(
            self,
            wrap="none",
            relief="flat",
            borderwidth=0,
            highlightthickness=0,
            font=("Consolas", font_size),
            fg=tc["code_fg"],
            bg=tc["code_bg"],
            selectbackground="#4A90D9",
            selectforeground="#FFFFFF",
            state="normal",
        )
        # 水平滚动条
        hbar = tk.Scrollbar(self, orient="horizontal", command=self._text.xview)
        self._text.configure(xscrollcommand=hbar.set)
        self._text.insert("1.0", code.rstrip("\n"))
        self._text.configure(state="disabled")

        lines = code.count("\n") + 1
        self._text.configure(height=min(lines, 30))
        self._text.pack(fill="x", padx=4, pady=(0, 2))
        if lines > 5:
            hbar.pack(fill="x")

    def _copy(self, code: str):
        self.clipboard_clear()
        self.clipboard_append(code)

    def update_code(self, code: str):
        self._text.configure(state="normal")
        self._text.delete("1.0", "end")
        self._text.insert("1.0", code.rstrip("\n"))
        lines = code.count("\n") + 1
        self._text.configure(height=min(lines, 30), state="disabled")


class MessageBubble(ctk.CTkFrame):
    """单条消息气泡，用 mistune 解析 Markdown，代码块可复制。"""

    ROLE_LABELS = {
        "user": "You", "assistant": "Assistant",
        "tool_call": "Tool Call", "tool_result": "Tool Result", "error": "Error",
    }

    def __init__(self, master, role: str, content: str = "", font_size: int = 13, **kwargs):
        tc = _theme_colors()
        bg_map = {
            "user":        ("bubble_user",   "#DCF8C6", "#2B5278"),
            "assistant":   ("bubble_asst",   "#FFFFFF", "#1E1E2E"),
            "tool_call":   ("bubble_tool",   "#F0F0F0", "#2A2A3E"),
            "tool_result": ("bubble_result", "#E8F4FD", "#1A2A3A"),
            "error":       ("bubble_error",  "#FFE0E0", "#3A1A1A"),
        }
        _, light_bg, dark_bg = bg_map.get(role, bg_map["assistant"])
        super().__init__(master, corner_radius=10,
                         fg_color=(light_bg, dark_bg), **kwargs)
        self.role = role
        self._font_size = font_size
        self._raw_content = ""
        self._latex_images = []
        self._code_blocks: list[CodeBlock] = []

        ctk.CTkLabel(
            self,
            text=self.ROLE_LABELS.get(role, role),
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=(tc["muted_fg"], tc["muted_fg"]),
            anchor="w",
        ).pack(anchor="w", padx=10, pady=(6, 0))

        # 主文本框
        self._text = tk.Text(
            self, wrap="word", relief="flat", borderwidth=0,
            highlightthickness=0,
            font=("Segoe UI", font_size),
            cursor="arrow",
            state="disabled",
            fg=tc["text_fg"],
            bg=dark_bg if _is_dark() else light_bg,
            selectbackground="#4A90D9",
            selectforeground="#FFFFFF",
        )
        self._text.pack(fill="x", padx=10, pady=(2, 8))
        self._configure_tags()
        # 将滚轮事件转发给外层 ChatView，避免内部 tk.Text 吞掉滚轮
        self._text.bind("<MouseWheel>", self._forward_scroll)
        self._text.bind("<Button-4>", self._forward_scroll)
        self._text.bind("<Button-5>", self._forward_scroll)

        if content:
            self._raw_content = content
            self._rerender()

    def _forward_scroll(self, event):
        """将滚轮事件转发给最近的 CTkScrollableFrame 的 canvas。"""
        w = self.master
        while w is not None:
            if isinstance(w, ctk.CTkScrollableFrame):
                try:
                    canvas = w._parent_canvas
                    if event.num == 4:
                        canvas.yview_scroll(-1, "units")
                    elif event.num == 5:
                        canvas.yview_scroll(1, "units")
                    else:
                        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
                except Exception:
                    pass
                return
            w = getattr(w, "master", None)

    def _configure_tags(self):
        tc = _theme_colors()
        fs = self._font_size
        self._text.tag_configure("h1", font=("Segoe UI", fs+5, "bold"), foreground=tc["h_fg"])
        self._text.tag_configure("h2", font=("Segoe UI", fs+3, "bold"), foreground=tc["h_fg"])
        self._text.tag_configure("h3", font=("Segoe UI", fs+1, "bold"), foreground=tc["h_fg"])
        self._text.tag_configure("bold", font=("Segoe UI", fs, "bold"), foreground=tc["bold_fg"])
        self._text.tag_configure("italic", font=("Segoe UI", fs, "italic"), foreground=tc["italic_fg"])
        self._text.tag_configure("inline_code", font=("Consolas", fs-1),
                                 background=tc["code_bg"], foreground=tc["code_fg"])
        self._text.tag_configure("normal", font=("Segoe UI", fs), foreground=tc["text_fg"])
        self._text.tag_configure("muted", font=("Segoe UI", fs), foreground=tc["muted_fg"])
        self._text.tag_configure("bullet", font=("Segoe UI", fs), foreground=tc["text_fg"],
                                 lmargin1=16, lmargin2=24)
        self._text.tag_configure("link", font=("Segoe UI", fs), foreground=tc["link_fg"],
                                 underline=True)
        self._text.tag_configure("blockquote", font=("Segoe UI", fs, "italic"),
                                 foreground=tc["muted_fg"], lmargin1=16, lmargin2=16)
        self._text.tag_configure("math_block", font=("Consolas", fs-1),
                                 foreground=tc["muted_fg"], lmargin1=8, lmargin2=8)

    def append(self, token: str):
        self._raw_content += token
        self._rerender()

    def _rerender(self):
        # 销毁旧代码块
        for cb in self._code_blocks:
            cb.destroy()
        self._code_blocks.clear()
        self._latex_images.clear()

        self._text.configure(state="normal")
        self._text.delete("1.0", "end")

        if _MISTUNE_OK:
            self._render_with_mistune(self._raw_content)
        else:
            self._render_plain(self._raw_content)

        self._text.configure(state="disabled")
        self._text.update_idletasks()
        lines = int(self._text.index("end-1c").split(".")[0])
        self._text.configure(height=max(1, lines))

    def _render_with_mistune(self, text: str):
        """用 mistune 解析 Markdown AST，渲染到 tk.Text。"""
        # 预处理 LaTeX：\[...\] → $$...$$，\(...\) → $...$（排除含中文）
        def repl_block(m):
            inner = m.group(1)
            return m.group(0) if re.search(r'[\u4e00-\u9fff]', inner) else f"$$\n{inner}\n$$"
        def repl_inline(m):
            inner = m.group(1)
            return m.group(0) if re.search(r'[\u4e00-\u9fff]', inner) else f"${inner}$"
        text = re.sub(r"\\\[\s*([\s\S]*?)\s*\\\]", repl_block, text)
        text = re.sub(r"\\\(\s*([\s\S]*?)\s*\\\)", repl_inline, text)

        md = mistune.create_markdown(renderer=None)  # AST 模式
        tokens = md(text)
        self._render_tokens(tokens)

    def _render_tokens(self, tokens, list_type=None, depth=0):
        if not tokens:
            return
        for token in tokens:
            t = token.get("type", "")

            if t == "heading":
                level = min(token.get("attrs", {}).get("level", 1), 3)
                self._text.insert("end", "\n" if self._text.index("end-1c") != "1.0" else "", "normal")
                self._render_children(token.get("children", []), f"h{level}")
                self._text.insert("end", "\n", "normal")

            elif t == "paragraph":
                self._text.insert("end", "\n" if self._text.index("end-1c") != "1.0" else "", "normal")
                self._render_children(token.get("children", []))
                self._text.insert("end", "\n", "normal")

            elif t == "block_code":
                code = token.get("raw", "")
                lang = token.get("attrs", {}).get("info", "") or ""
                self._insert_code_block(code, lang)

            elif t == "list":
                ordered = token.get("attrs", {}).get("ordered", False)
                children = token.get("children", [])
                for i, item in enumerate(children):
                    prefix = f"{i+1}. " if ordered else "• "
                    self._text.insert("end", prefix, "bullet")
                    self._render_children(item.get("children", []))
                    self._text.insert("end", "\n", "normal")

            elif t == "block_quote":
                self._render_children(token.get("children", []), "blockquote")

            elif t == "thematic_break":
                self._text.insert("end", "\n" + "─" * 40 + "\n", "muted")

            elif t == "blank_line":
                self._text.insert("end", "\n", "normal")

    def _render_children(self, children, parent_tag=None):
        for child in children:
            t = child.get("type", "")
            raw = child.get("raw", "")

            if t == "text":
                self._insert_text_with_latex(raw, parent_tag or "normal")
            elif t == "strong":
                self._render_children(child.get("children", []), "bold")
            elif t == "emphasis":
                self._render_children(child.get("children", []), "italic")
            elif t == "codespan":
                self._text.insert("end", raw, "inline_code")
            elif t == "link":
                url = child.get("attrs", {}).get("url", "")
                label = raw or url
                self._text.insert("end", label, "link")
            elif t == "softline" or t == "linebreak":
                self._text.insert("end", "\n", "normal")
            elif t == "paragraph":
                self._render_children(child.get("children", []), parent_tag)
                self._text.insert("end", "\n", "normal")
            elif t == "block_code":
                code = child.get("raw", "")
                lang = child.get("attrs", {}).get("info", "") or ""
                self._insert_code_block(code, lang)
            else:
                # 未知节点，尝试渲染子节点
                sub = child.get("children")
                if sub:
                    self._render_children(sub, parent_tag)
                elif raw:
                    self._text.insert("end", raw, parent_tag or "normal")

    def _insert_text_with_latex(self, text: str, tag: str):
        """在普通文本中检测并渲染行内/块级 LaTeX。"""
        # 匹配 $$...$$ 或 $...$（排除中文、纯数字）
        pattern = re.compile(
            r"(\$\$[\s\S]+?\$\$"
            r"|\$(?![0-9,，。！？\s])(?:[^\$\n\u4e00-\u9fff])+?\$)"
        )
        pos = 0
        for m in pattern.finditer(text):
            if m.start() > pos:
                self._text.insert("end", text[pos:m.start()], tag)
            self._insert_latex(m.group(0))
            pos = m.end()
        if pos < len(text):
            self._text.insert("end", text[pos:], tag)

    def _insert_code_block(self, code: str, lang: str):
        """插入可复制的代码块组件。"""
        self._text.insert("end", "\n", "normal")
        cb = CodeBlock(self._text, code=code, lang=lang, font_size=self._font_size - 1)
        self._code_blocks.append(cb)
        self._text.window_create("end", window=cb)
        self._text.insert("end", "\n", "normal")

    def _render_plain(self, text: str):
        """mistune 不可用时的纯文本降级渲染。"""
        self._text.insert("end", text, "normal")

    def _insert_latex(self, expr: str):
        """渲染 LaTeX 公式。
        - 简单公式（无 \\begin{}）：用 matplotlib mathtext 渲染为图片
        - 复杂公式（含 \\begin{}）：降级为 math_block 样式文本
        """
        inner = expr.strip()
        for prefix in ("$$", "$"):
            if inner.startswith(prefix):
                inner = inner[len(prefix):]
                break
        for suffix in ("$$", "$"):
            if inner.endswith(suffix):
                inner = inner[:-len(suffix)]
                break
        inner = inner.strip()

        if not inner:
            return
        if re.search(r'[\u4e00-\u9fff]', inner):
            self._text.insert("end", inner, "normal")
            return

        if not _MPL_OK:
            self._text.insert("end", inner, "math_block")
            return

        # matplotlib mathtext 渲染（支持 \begin{bmatrix} 等环境）
        dark = _is_dark()
        bg_hex = "#1E1E2E" if dark else "#FFFFFF"
        tc = _theme_colors()
        try:
            import warnings
            # 将多行公式压成单行（mathtext 不支持换行）
            single = inner.replace("\n", " ").replace("  ", " ").strip()
            fig = plt.figure(figsize=(0.01, 0.01))
            fig.patch.set_facecolor(bg_hex)
            renderer = fig.canvas.get_renderer()
            with warnings.catch_warnings():
                warnings.simplefilter("error")
                t = fig.text(0, 0, f"${single}$",
                             fontsize=13, color=tc["text_fg"])
                bb = t.get_window_extent(renderer=renderer)
            fig.set_size_inches(max(bb.width / fig.dpi + 0.3, 0.5),
                                max(bb.height / fig.dpi + 0.15, 0.35))
            t.set_position((0.05, 0.15))
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=130, bbox_inches="tight",
                        facecolor=bg_hex, pad_inches=0.06)
            plt.close(fig)
            buf.seek(0)
            photo = ImageTk.PhotoImage(Image.open(buf))
            self._latex_images.append(photo)
            self._text.image_create("end", image=photo)
        except Exception:
            plt.close("all")
            # matplotlib 渲染失败 → 可读的代码块（可复制）
            self._insert_code_block(inner, "latex")


class TypingIndicator(ctk.CTkLabel):
    def __init__(self, master, **kwargs):
        super().__init__(master, text="●  ○  ○", text_color=("gray50", "gray60"), **kwargs)
        self._step = 0
        self._job = None

    def start(self):
        self._animate()

    def stop(self):
        if self._job:
            self.after_cancel(self._job)
            self._job = None

    def _animate(self):
        frames = ["●  ○  ○", "○  ●  ○", "○  ○  ●"]
        self.configure(text=frames[self._step % 3])
        self._step += 1
        self._job = self.after(400, self._animate)


class ChatView(ctk.CTkScrollableFrame):
    """对话内容区域。"""

    def __init__(self, master, font_size: int = 13, **kwargs):
        super().__init__(master, **kwargs)
        self._font_size = font_size
        self._current_assistant_bubble: MessageBubble | None = None
        self._typing: TypingIndicator | None = None
        self._user_scrolled_up = False

        self._parent_canvas.bind("<MouseWheel>", self._on_mousewheel)
        self._parent_canvas.bind("<Button-4>", self._on_mousewheel)
        self._parent_canvas.bind("<Button-5>", self._on_mousewheel)

    def _on_mousewheel(self, event):
        self.after(50, self._check_scroll_position)

    def _check_scroll_position(self):
        try:
            pos = self._parent_canvas.yview()
            self._user_scrolled_up = pos[1] < 0.98
        except Exception:
            pass

    def set_font_size(self, size: int):
        self._font_size = size

    def clear(self):
        for widget in self.winfo_children():
            widget.destroy()
        self._current_assistant_bubble = None
        self._typing = None
        self._user_scrolled_up = False

    def add_user_message(self, content: str):
        self._stop_typing()
        bubble = MessageBubble(self, role="user", content=content, font_size=self._font_size)
        bubble.pack(fill="x", padx=12, pady=(6, 2))
        self._user_scrolled_up = False
        self._scroll_to_bottom()

    def start_assistant_message(self):
        self._stop_typing()
        self._current_assistant_bubble = MessageBubble(self, role="assistant",
                                                       font_size=self._font_size)
        self._current_assistant_bubble.pack(fill="x", padx=12, pady=(2, 6))
        self._typing = TypingIndicator(self)
        self._typing.pack(anchor="w", padx=20)
        self._typing.start()

    def append_token(self, token: str):
        if self._typing:
            self._stop_typing()
        if self._current_assistant_bubble:
            self._current_assistant_bubble.append(token)
            if not self._user_scrolled_up:
                self._scroll_to_bottom()

    def finish_assistant_message(self):
        self._stop_typing()
        self._current_assistant_bubble = None

    def add_tool_call(self, tool_name: str, args: dict):
        import json
        icon = {"web_search": "🔍", "read_file": "📄", "run_command": "⚙️",
                "write_file": "✏️", "list_directory": "📁"}.get(tool_name, "🔧")
        label = f"{icon} {tool_name}({json.dumps(args, ensure_ascii=False, separators=(',', ':'))[:80]})"
        frame = ctk.CTkFrame(self, fg_color=("gray88", "gray22"), corner_radius=6)
        frame.pack(fill="x", padx=24, pady=(2, 1))
        ctk.CTkLabel(frame, text=label, font=ctk.CTkFont(size=11),
                     text_color=("gray40", "gray65"), anchor="w").pack(anchor="w", padx=8, pady=3)

    def add_tool_result(self, tool_name: str, result: str):
        preview = result.replace("\n", " ").strip()[:120]
        if len(result.replace("\n", " ").strip()) > 120:
            preview += "…"
        icon = {"web_search": "🔍", "read_file": "📄", "run_command": "⚙️",
                "write_file": "✏️", "list_directory": "📁"}.get(tool_name, "🔧")
        frame = ctk.CTkFrame(self, fg_color=("gray85", "gray20"), corner_radius=6)
        frame.pack(fill="x", padx=24, pady=(1, 4))
        ctk.CTkLabel(frame, text=f"{icon} {preview}", font=ctk.CTkFont(size=11),
                     text_color=("gray45", "gray60"), anchor="w",
                     wraplength=600).pack(anchor="w", padx=8, pady=3)

    def add_error(self, message: str):
        self._stop_typing()
        bubble = MessageBubble(self, role="error", content=message, font_size=self._font_size)
        bubble.pack(fill="x", padx=12, pady=4)

    def load_history(self, messages: list[dict]):
        self.clear()
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content") or ""
            if role == "user":
                self.add_user_message(content)
            elif role == "assistant" and content:
                bubble = MessageBubble(self, role="assistant", content=content,
                                       font_size=self._font_size)
                bubble.pack(fill="x", padx=12, pady=(2, 6))
            elif role == "tool":
                self.add_tool_result("tool", content)
        self._scroll_to_bottom()

    def _stop_typing(self):
        if self._typing:
            self._typing.stop()
            self._typing.destroy()
            self._typing = None

    def _scroll_to_bottom(self):
        try:
            self._parent_canvas.yview_moveto(1.0)
        except Exception:
            pass
