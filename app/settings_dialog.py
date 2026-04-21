import tkinter as tk
from tkinter import messagebox
from typing import Callable
import customtkinter as ctk

from app.config import DEFAULT_MODEL_CONFIGS


class SettingsDialog(ctk.CTkToplevel):
    """设置弹窗，包含三个 Tab：模型配置 / 工具设置 / 界面设置。"""

    def __init__(self, master, config: dict, on_save: Callable[[dict], None]):
        super().__init__(master)
        self.title("设置")
        self.geometry("600x520")
        self.resizable(False, False)
        self.grab_set()  # 模态

        import copy
        self._config = copy.deepcopy(config)
        self._on_save = on_save
        self._model_configs = self._config.get("model_configs", [])
        self._selected_mc_idx: int | None = None

        self._build_ui()
        self._refresh_model_list()

    def _build_ui(self):
        self._tabs = ctk.CTkTabview(self)
        self._tabs.pack(fill="both", expand=True, padx=12, pady=(12, 0))

        self._tabs.add("模型配置")
        self._tabs.add("工具设置")
        self._tabs.add("图片理解")
        self._tabs.add("界面设置")

        self._build_model_tab(self._tabs.tab("模型配置"))
        self._build_tools_tab(self._tabs.tab("工具设置"))
        self._build_vision_tab(self._tabs.tab("图片理解"))
        self._build_ui_tab(self._tabs.tab("界面设置"))

        # 底部按钮
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(fill="x", padx=12, pady=10)
        ctk.CTkButton(btn_frame, text="取消", width=80,
                      fg_color="gray40", hover_color="gray50",
                      command=self.destroy).pack(side="right", padx=(6, 0))
        ctk.CTkButton(btn_frame, text="保存", width=80,
                      command=self._save).pack(side="right")

    # ── Tab 1: 模型配置 ───────────────────────────────────────────────
    def _build_model_tab(self, tab):
        left = ctk.CTkFrame(tab, width=160)
        left.pack(side="left", fill="y", padx=(0, 8), pady=4)
        left.pack_propagate(False)

        ctk.CTkButton(left, text="+ 添加", height=28,
                      command=self._add_model_config).pack(fill="x", padx=6, pady=(6, 4))

        self._mc_listbox_frame = ctk.CTkScrollableFrame(left, fg_color="transparent")
        self._mc_listbox_frame.pack(fill="both", expand=True, padx=4)

        right = ctk.CTkFrame(tab, fg_color="transparent")
        right.pack(side="left", fill="both", expand=True, pady=4)

        def row(label, widget_factory):
            f = ctk.CTkFrame(right, fg_color="transparent")
            f.pack(fill="x", pady=3)
            ctk.CTkLabel(f, text=label, width=90, anchor="w").pack(side="left")
            w = widget_factory(f)
            w.pack(side="left", fill="x", expand=True)
            return w

        self._mc_name = row("名称", lambda p: ctk.CTkEntry(p, placeholder_text="配置名称"))
        self._mc_key = row("API Key", lambda p: ctk.CTkEntry(p, placeholder_text="sk-...", show="*"))
        self._mc_url = row("Base URL", lambda p: ctk.CTkEntry(p, placeholder_text="https://api.xxx.com/v1"))
        self._mc_model = row("模型名", lambda p: ctk.CTkEntry(p, placeholder_text="model-name"))

        ctk.CTkLabel(right, text="系统提示词", anchor="w").pack(fill="x", pady=(6, 2))
        self._mc_system = ctk.CTkTextbox(right, height=80)
        self._mc_system.pack(fill="x")

        btn_row = ctk.CTkFrame(right, fg_color="transparent")
        btn_row.pack(fill="x", pady=(8, 0))
        ctk.CTkButton(btn_row, text="保存此配置", width=100,
                      command=self._save_current_mc).pack(side="left")
        ctk.CTkButton(btn_row, text="删除", width=60,
                      fg_color="#C0392B", hover_color="#E74C3C",
                      command=self._delete_current_mc).pack(side="left", padx=(8, 0))

    def _refresh_model_list(self):
        for w in self._mc_listbox_frame.winfo_children():
            w.destroy()
        for i, mc in enumerate(self._model_configs):
            btn = ctk.CTkButton(
                self._mc_listbox_frame,
                text=mc["name"],
                height=28,
                anchor="w",
                fg_color=("gray80", "gray25") if i == self._selected_mc_idx else "transparent",
                hover_color=("gray70", "gray35"),
                command=lambda idx=i: self._select_mc(idx),
            )
            btn.pack(fill="x", pady=1)

    def _select_mc(self, idx: int):
        self._selected_mc_idx = idx
        mc = self._model_configs[idx]
        self._mc_name.delete(0, "end"); self._mc_name.insert(0, mc.get("name", ""))
        self._mc_key.delete(0, "end"); self._mc_key.insert(0, mc.get("api_key", ""))
        self._mc_url.delete(0, "end"); self._mc_url.insert(0, mc.get("base_url", ""))
        self._mc_model.delete(0, "end"); self._mc_model.insert(0, mc.get("model", ""))
        self._mc_system.delete("1.0", "end")
        self._mc_system.insert("1.0", mc.get("system_prompt", ""))
        self._refresh_model_list()

    def _add_model_config(self):
        new_mc = {
            "name": f"新配置 {len(self._model_configs)+1}",
            "api_key": "",
            "base_url": "",
            "model": "",
            "system_prompt": "You are a helpful assistant.",
        }
        self._model_configs.append(new_mc)
        self._select_mc(len(self._model_configs) - 1)

    def _save_current_mc(self):
        if self._selected_mc_idx is None:
            return
        mc = self._model_configs[self._selected_mc_idx]
        mc["name"] = self._mc_name.get().strip() or mc["name"]
        mc["api_key"] = self._mc_key.get().strip()
        mc["base_url"] = self._mc_url.get().strip()
        mc["model"] = self._mc_model.get().strip()
        mc["system_prompt"] = self._mc_system.get("1.0", "end").strip()
        self._refresh_model_list()

    def _delete_current_mc(self):
        if self._selected_mc_idx is None or len(self._model_configs) <= 1:
            messagebox.showwarning("提示", "至少保留一个模型配置", parent=self)
            return
        self._model_configs.pop(self._selected_mc_idx)
        self._selected_mc_idx = None
        self._refresh_model_list()
        # 清空右侧表单
        for w in [self._mc_name, self._mc_key, self._mc_url, self._mc_model]:
            w.delete(0, "end")
        self._mc_system.delete("1.0", "end")

    # ── Tab 2: 工具设置 ───────────────────────────────────────────────
    def _build_tools_tab(self, tab):
        def row(label, widget_factory):
            f = ctk.CTkFrame(tab, fg_color="transparent")
            f.pack(fill="x", pady=6)
            ctk.CTkLabel(f, text=label, width=130, anchor="w").pack(side="left")
            w = widget_factory(f)
            w.pack(side="left", fill="x", expand=True)
            return w

        self._tavily_key = row(
            "Tavily API Key",
            lambda p: ctk.CTkEntry(p, placeholder_text="tvly-...", show="*")
        )
        self._tavily_key.insert(0, self._config.get("tavily_api_key", ""))

        self._cmd_safety_var = tk.StringVar(value=self._config.get("command_safety", "confirm"))
        row("命令执行安全", lambda p: ctk.CTkOptionMenu(
            p,
            values=["confirm", "auto", "disabled"],
            variable=self._cmd_safety_var,
        ))

        self._cmd_timeout = row(
            "命令超时（秒）",
            lambda p: ctk.CTkEntry(p, placeholder_text="30")
        )
        self._cmd_timeout.insert(0, str(self._config.get("command_timeout", 30)))

    # ── Tab 3: 图片理解 ───────────────────────────────────────────────
    def _build_vision_tab(self, tab):
        def row(label, widget_factory):
            f = ctk.CTkFrame(tab, fg_color="transparent")
            f.pack(fill="x", pady=6)
            ctk.CTkLabel(f, text=label, width=130, anchor="w").pack(side="left")
            w = widget_factory(f)
            w.pack(side="left", fill="x", expand=True)
            return w

        ctk.CTkLabel(tab, text="拖拽图片到输入框时，调用 Vision 模型解析图片内容。",
                     text_color=("gray50", "gray60"), font=ctk.CTkFont(size=11),
                     anchor="w").pack(fill="x", pady=(4, 8))

        self._vision_key = row(
            "Vision API Key",
            lambda p: ctk.CTkEntry(p, placeholder_text="sk-...", show="*")
        )
        self._vision_key.insert(0, self._config.get("vision_api_key", ""))

        self._vision_url = row(
            "Base URL",
            lambda p: ctk.CTkEntry(p, placeholder_text="https://dashscope.aliyuncs.com/compatible-mode/v1")
        )
        self._vision_url.insert(0, self._config.get("vision_base_url",
                                                      "https://dashscope.aliyuncs.com/compatible-mode/v1"))

        self._vision_model = row(
            "模型名",
            lambda p: ctk.CTkEntry(p, placeholder_text="qwen-vl-plus")
        )
        self._vision_model.insert(0, self._config.get("vision_model", "qwen-vl-plus"))

        ctk.CTkLabel(tab, text="常用模型：qwen-vl-plus / qwen-vl-max / gpt-4o / glm-4v",
                     text_color=("gray50", "gray60"), font=ctk.CTkFont(size=11),
                     anchor="w").pack(fill="x", pady=(4, 0))

    # ── Tab 4: 界面设置 ───────────────────────────────────────────────
    def _build_ui_tab(self, tab):
        def row(label, widget_factory):
            f = ctk.CTkFrame(tab, fg_color="transparent")
            f.pack(fill="x", pady=6)
            ctk.CTkLabel(f, text=label, width=130, anchor="w").pack(side="left")
            w = widget_factory(f)
            w.pack(side="left")
            return w

        self._theme_var = tk.StringVar(value=self._config.get("theme", "dark"))
        row("主题", lambda p: ctk.CTkOptionMenu(
            p, values=["dark", "light", "system"], variable=self._theme_var
        ))

        self._font_size_var = tk.StringVar(value=str(self._config.get("font_size", 13)))
        row("字体大小", lambda p: ctk.CTkOptionMenu(
            p, values=["11", "12", "13", "14", "15", "16"], variable=self._font_size_var
        ))

        self._sidebar_width_var = tk.StringVar(value=str(self._config.get("sidebar_width", 220)))
        row("侧边栏宽度", lambda p: ctk.CTkEntry(p, textvariable=self._sidebar_width_var, width=80))

    # ── 保存 ──────────────────────────────────────────────────────────
    def _save(self):
        # 如果有正在编辑的模型配置，先保存
        if self._selected_mc_idx is not None:
            self._save_current_mc()

        self._config["model_configs"] = self._model_configs
        self._config["tavily_api_key"] = self._tavily_key.get().strip()
        self._config["command_safety"] = self._cmd_safety_var.get()
        try:
            self._config["command_timeout"] = int(self._cmd_timeout.get())
        except ValueError:
            self._config["command_timeout"] = 30
        self._config["vision_api_key"] = self._vision_key.get().strip()
        self._config["vision_base_url"] = self._vision_url.get().strip()
        self._config["vision_model"] = self._vision_model.get().strip()
        self._config["theme"] = self._theme_var.get()
        try:
            self._config["font_size"] = int(self._font_size_var.get())
        except ValueError:
            self._config["font_size"] = 13
        try:
            self._config["sidebar_width"] = int(self._sidebar_width_var.get())
        except ValueError:
            self._config["sidebar_width"] = 220

        self._on_save(self._config)
        self.destroy()
