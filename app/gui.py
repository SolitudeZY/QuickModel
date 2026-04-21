import threading
import tkinter as tk
from tkinter import filedialog, messagebox
from pathlib import Path
from typing import Optional
import customtkinter as ctk

from app.config import load_config, save_config, get_active_model_config
from app.conversation import (
    new_conversation, save_conversation, load_conversation,
    delete_conversation, rename_conversation, list_conversations,
    update_sort_orders, auto_title_from_message, export_conversation_md,
)
from app.sidebar import Sidebar
from app.chat_view import ChatView
from app.agent import Agent
from app.settings_dialog import SettingsDialog


class App(ctk.CTk):
    def __init__(self):
        self._config = load_config()
        ctk.set_appearance_mode(self._config.get("theme", "dark"))
        ctk.set_default_color_theme("blue")
        super().__init__()

        self.title("AI Desktop Assistant")
        self.geometry("1100x700")
        self.minsize(800, 500)

        self._current_conv: Optional[dict] = None
        self._agent: Optional[Agent] = None
        self._running = False

        self._build_ui()
        self._load_sidebar()

        # 启动时自动新建或加载最近对话
        convs = list_conversations()
        if convs:
            self._open_conversation(convs[0]["id"])
        else:
            self._new_conversation()

    # ── UI 构建 ───────────────────────────────────────────────────────
    def _build_ui(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # 侧边栏
        sidebar_width = self._config.get("sidebar_width", 220)
        self._sidebar = Sidebar(
            self,
            on_select=self._open_conversation,
            on_new=self._new_conversation,
            on_rename=self._rename_conversation,
            on_delete=self._delete_conversation,
            on_export=self._export_conversation,
            on_reorder=update_sort_orders,
            width=sidebar_width,
        )
        self._sidebar.grid(row=0, column=0, sticky="nsew")

        # 右侧主区域
        right = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew")
        right.grid_rowconfigure(1, weight=1)
        right.grid_columnconfigure(0, weight=1)

        # 顶部工具栏
        self._build_toolbar(right)

        # 对话内容区
        self._chat_view = ChatView(
            right,
            font_size=self._config.get("font_size", 13),
            fg_color=("gray95", "gray10"),
        )
        self._chat_view.grid(row=1, column=0, sticky="nsew", padx=0, pady=0)

        # 底部输入区
        self._build_input_area(right)

    def _build_toolbar(self, parent):
        bar = ctk.CTkFrame(parent, height=44, corner_radius=0,
                           fg_color=("gray85", "gray20"))
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_columnconfigure(1, weight=1)

        # 模型选择下拉
        model_names = [mc["name"] for mc in self._config.get("model_configs", [])]
        active = self._config.get("active_model_config", model_names[0] if model_names else "")
        self._model_var = tk.StringVar(value=active)
        self._model_menu = ctk.CTkOptionMenu(
            bar,
            values=model_names or ["（无配置）"],
            variable=self._model_var,
            width=180,
            command=self._on_model_change,
        )
        self._model_menu.grid(row=0, column=0, padx=(10, 6), pady=6)

        # 对话标题
        self._title_label = ctk.CTkLabel(bar, text="", font=ctk.CTkFont(size=14, weight="bold"),
                                         anchor="w")
        self._title_label.grid(row=0, column=1, sticky="w", padx=6)

        # 右侧按钮
        btn_frame = ctk.CTkFrame(bar, fg_color="transparent")
        btn_frame.grid(row=0, column=2, padx=10)
        ctk.CTkButton(btn_frame, text="设置", width=60, height=30,
                      command=self._open_settings).pack(side="left", padx=3)
        ctk.CTkButton(btn_frame, text="导出", width=60, height=30,
                      command=lambda: self._export_conversation(
                          self._current_conv["id"] if self._current_conv else None
                      )).pack(side="left", padx=3)

    def _build_input_area(self, parent):
        self._attached_files: list[dict] = []  # {"path": ..., "content": ...}

        area = ctk.CTkFrame(parent, corner_radius=0, fg_color=("gray90", "gray15"))
        area.grid(row=2, column=0, sticky="ew")
        area.grid_columnconfigure(0, weight=1)

        # 文件芯片区域（拖拽后显示）
        self._chips_frame = ctk.CTkFrame(area, fg_color="transparent")
        self._chips_frame.grid(row=0, column=0, columnspan=2, sticky="w", padx=10, pady=(6, 0))

        # 拖拽提示（无附件时显示）
        self._drop_hint = ctk.CTkLabel(
            self._chips_frame,
            text="📎 拖拽文件到此处附加",
            text_color=("gray50", "gray60"),
            font=ctk.CTkFont(size=11),
        )
        self._drop_hint.pack(side="left")

        # 输入框
        self._input = ctk.CTkTextbox(area, height=80, wrap="word",
                                     font=ctk.CTkFont(size=self._config.get("font_size", 13)))
        self._input.grid(row=1, column=0, sticky="ew", padx=(12, 6), pady=8)
        self._input.bind("<Return>", self._on_enter)
        self._input.bind("<Shift-Return>", lambda e: None)

        # 按钮列
        btn_col = ctk.CTkFrame(area, fg_color="transparent")
        btn_col.grid(row=1, column=1, padx=(0, 12), pady=8, sticky="s")
        self._send_btn = ctk.CTkButton(btn_col, text="发送", width=70, height=36,
                                       command=self._send)
        self._send_btn.pack(pady=(0, 4))
        self._stop_btn = ctk.CTkButton(btn_col, text="停止", width=70, height=36,
                                       fg_color="#C0392B", hover_color="#E74C3C",
                                       command=self._stop, state="disabled")
        self._stop_btn.pack()

        # 文件拖拽绑定（tkinterdnd2）
        try:
            self.drop_target_register("DND_Files")  # type: ignore
            self.dnd_bind("<<Drop>>", self._on_file_drop)  # type: ignore
        except Exception:
            pass

    def _add_file_chip(self, path: str, content: str):
        """在芯片区添加一个文件标签。"""
        from pathlib import Path
        name = Path(path).name
        ext = Path(path).suffix.lower()
        icon = {"pdf": "📄", "docx": "📝", "xlsx": "📊", "xls": "📊",
                "png": "🖼", "jpg": "🖼", "jpeg": "🖼"}.get(ext.lstrip("."), "📎")

        chip = ctk.CTkFrame(self._chips_frame, corner_radius=12,
                            fg_color=("gray75", "gray30"))
        chip.pack(side="left", padx=(0, 6))

        ctk.CTkLabel(chip, text=f"{icon} {name}", font=ctk.CTkFont(size=11),
                     text_color=("gray20", "gray90")).pack(side="left", padx=(8, 2), pady=3)

        def remove():
            self._attached_files = [f for f in self._attached_files if f["path"] != path]
            chip.destroy()
            if not self._attached_files:
                self._drop_hint.pack(side="left")

        ctk.CTkButton(chip, text="✕", width=20, height=20, corner_radius=10,
                      fg_color="transparent", hover_color=("gray60", "gray45"),
                      font=ctk.CTkFont(size=10),
                      command=remove).pack(side="left", padx=(0, 4))

        self._attached_files.append({"path": path, "content": content})
        self._drop_hint.pack_forget()

    # ── 对话管理 ──────────────────────────────────────────────────────
    def _load_sidebar(self):
        convs = list_conversations()
        self._sidebar.load_conversations(convs)

    def _new_conversation(self):
        mc = get_active_model_config(self._config)
        conv = new_conversation(mc["name"] if mc else "")
        save_conversation(conv)
        self._current_conv = conv
        self._chat_view.clear()
        self._title_label.configure(text=conv["title"])
        self._sidebar.add_conversation({
            "id": conv["id"],
            "title": conv["title"],
            "updated_at": conv["updated_at"],
            "sort_order": 0,
            "model_config": conv["model_config"],
        })

    def _open_conversation(self, conv_id: str):
        conv = load_conversation(conv_id)
        if not conv:
            return
        self._current_conv = conv
        self._title_label.configure(text=conv.get("title", "对话"))
        self._chat_view.load_history(conv.get("messages", []))
        self._sidebar.select(conv_id)

    def _rename_conversation(self, conv_id: str, new_title: str):
        rename_conversation(conv_id, new_title)
        if self._current_conv and self._current_conv["id"] == conv_id:
            self._current_conv["title"] = new_title
            self._title_label.configure(text=new_title)

    def _delete_conversation(self, conv_id: str):
        delete_conversation(conv_id)
        self._sidebar.remove_conversation(conv_id)
        if self._current_conv and self._current_conv["id"] == conv_id:
            self._current_conv = None
            self._chat_view.clear()
            self._title_label.configure(text="")
            # 自动打开下一条
            convs = list_conversations()
            if convs:
                self._open_conversation(convs[0]["id"])
            else:
                self._new_conversation()

    def _export_conversation(self, conv_id: Optional[str]):
        if not conv_id:
            return
        conv = load_conversation(conv_id)
        if not conv:
            return
        md = export_conversation_md(conv)
        path = filedialog.asksaveasfilename(
            defaultextension=".md",
            filetypes=[("Markdown", "*.md"), ("All files", "*.*")],
            initialfile=f"{conv.get('title', 'conversation')}.md",
        )
        if path:
            Path(path).write_text(md, encoding="utf-8")
            messagebox.showinfo("导出成功", f"已保存到：{path}")

    # ── 模型切换 ──────────────────────────────────────────────────────
    def _on_model_change(self, name: str):
        self._config["active_model_config"] = name
        save_config(self._config)

    # ── 发送消息 ──────────────────────────────────────────────────────
    def _on_enter(self, event):
        # Enter 发送，Shift+Enter 换行
        if not event.state & 0x1:  # Shift 未按下
            self._send()
            return "break"

    def _send(self):
        if self._running:
            return
        text = self._input.get("1.0", "end").strip()
        if not text:
            return

        if not self._current_conv:
            self._new_conversation()

        self._input.delete("1.0", "end")

        # 拼入附件内容
        full_content = text
        if self._attached_files:
            parts = [text] if text else []
            for f in self._attached_files:
                from pathlib import Path as _Path
                parts.append(f"\n\n---\n📎 文件：{_Path(f['path']).name}\n\n{f['content']}")
            full_content = "".join(parts)
            # 清空芯片
            self._attached_files.clear()
            for w in self._chips_frame.winfo_children():
                w.destroy()
            self._drop_hint = ctk.CTkLabel(
                self._chips_frame, text="📎 拖拽文件到此处附加",
                text_color=("gray50", "gray60"), font=ctk.CTkFont(size=11))
            self._drop_hint.pack(side="left")

        self._chat_view.add_user_message(full_content)

        # 追加到对话
        self._current_conv["messages"].append({"role": "user", "content": full_content})

        # 自动命名
        if len(self._current_conv["messages"]) == 1:
            auto_title_from_message(self._current_conv, text)
            self._title_label.configure(text=self._current_conv["title"])
            self._sidebar.update_title(self._current_conv["id"], self._current_conv["title"])

        self._set_running(True)
        self._chat_view.start_assistant_message()

        mc = get_active_model_config(self._config)
        if not mc:
            self._chat_view.add_error("未配置模型，请在设置中添加模型配置")
            self._set_running(False)
            return

        self._agent = Agent(
            api_key=mc.get("api_key", ""),
            base_url=mc.get("base_url", ""),
            model=mc.get("model", ""),
            system_prompt=mc.get("system_prompt", "You are a helpful assistant."),
            tavily_key=self._config.get("tavily_api_key", ""),
            command_safety=self._config.get("command_safety", "confirm"),
            command_timeout=self._config.get("command_timeout", 30),
        )

        messages = list(self._current_conv["messages"])

        thread = threading.Thread(
            target=self._agent.run,
            kwargs=dict(
                messages=messages,
                on_token=self._on_token,
                on_tool_start=self._on_tool_start,
                on_tool_result=self._on_tool_result,
                on_confirm=self._on_confirm,
                on_done=self._on_done,
                on_error=self._on_error,
            ),
            daemon=True,
        )
        thread.start()

    def _stop(self):
        if self._agent:
            self._agent.stop()

    def _set_running(self, running: bool):
        self._running = running
        state = "disabled" if running else "normal"
        stop_state = "normal" if running else "disabled"
        self._send_btn.configure(state=state)
        self._stop_btn.configure(state=stop_state)

    # ── Agent 回调（从后台线程调用，需 after() 切回主线程）────────────
    def _on_token(self, token: str):
        self.after(0, self._chat_view.append_token, token)

    def _on_tool_start(self, tool_name: str, args: dict):
        self.after(0, self._chat_view.add_tool_call, tool_name, args)

    def _on_tool_result(self, tool_name: str, result: str):
        self.after(0, self._chat_view.add_tool_result, tool_name, result)

    def _on_confirm(self, tool_name: str, args: dict) -> bool:
        """在主线程弹出确认框，阻塞后台线程等待结果。"""
        result = threading.Event()
        approved = [False]

        def ask():
            import json
            detail = json.dumps(args, ensure_ascii=False, indent=2)
            ok = messagebox.askyesno(
                f"确认执行：{tool_name}",
                f"AI 请求执行以下操作：\n\n{detail}\n\n是否允许？",
                parent=self,
            )
            approved[0] = ok
            result.set()

        self.after(0, ask)
        result.wait()
        return approved[0]

    def _on_done(self, updated_messages: list[dict]):
        def finish():
            self._chat_view.finish_assistant_message()
            self._current_conv["messages"] = updated_messages
            save_conversation(self._current_conv)
            self._set_running(False)
        self.after(0, finish)

    def _on_error(self, error: str):
        def show():
            self._chat_view.finish_assistant_message()
            self._chat_view.add_error(f"请求失败：{error}")
            self._set_running(False)
        self.after(0, show)

    # ── 文件拖拽 ──────────────────────────────────────────────────────
    def _on_file_drop(self, event):
        import re
        raw = event.data.strip()
        paths = re.findall(r'\{([^}]+)\}|(\S+)', raw)
        paths = [a or b for a, b in paths]
        for path in paths:
            if any(f["path"] == path for f in self._attached_files):
                continue
            self._process_dropped_file(path)

    def _process_dropped_file(self, path: str):
        from app.vision import is_image, describe_image
        from app.tools import read_file
        if is_image(path):
            # 图片：先显示芯片，后台调 vision API
            self._add_file_chip(path, "")
            chip_idx = len(self._attached_files) - 1

            def _vision_thread():
                content = describe_image(
                    path,
                    prompt="请详细描述这张图片的内容，包括文字、图表、场景等所有细节。",
                    api_key=self._config.get("vision_api_key", ""),
                    base_url=self._config.get("vision_base_url",
                                              "https://dashscope.aliyuncs.com/compatible-mode/v1"),
                    model=self._config.get("vision_model", "qwen-vl-plus"),
                )
                if chip_idx < len(self._attached_files):
                    self._attached_files[chip_idx]["content"] = content

            threading.Thread(target=_vision_thread, daemon=True).start()
        else:
            content = read_file(path)
            self._add_file_chip(path, content)

    # ── 设置 ──────────────────────────────────────────────────────────
    def _open_settings(self):
        def on_save(new_config: dict):
            self._config = new_config
            save_config(self._config)
            # 更新模型下拉
            names = [mc["name"] for mc in self._config.get("model_configs", [])]
            self._model_menu.configure(values=names)
            active = self._config.get("active_model_config", names[0] if names else "")
            self._model_var.set(active)
            # 更新主题
            ctk.set_appearance_mode(self._config.get("theme", "dark"))

        SettingsDialog(self, self._config, on_save)
