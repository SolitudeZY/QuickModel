import tkinter as tk
from tkinter import simpledialog, messagebox
from typing import Callable, Optional
import customtkinter as ctk


class SidebarItem(ctk.CTkFrame):
    """单条对话条目，支持选中高亮、双击重命名。"""

    def __init__(self, master, conv_id: str, title: str,
                 on_select: Callable, on_rename: Callable,
                 on_delete: Callable, on_export: Callable,
                 **kwargs):
        super().__init__(master, corner_radius=6, **kwargs)
        self.conv_id = conv_id
        self._on_select = on_select
        self._on_rename = on_rename
        self._on_delete = on_delete
        self._on_export = on_export
        self._selected = False

        self.label = ctk.CTkLabel(self, text=title, anchor="w", cursor="hand2",
                                  font=ctk.CTkFont(size=13))
        self.label.pack(fill="x", padx=8, pady=6)

        self.label.bind("<Button-1>", self._on_click)
        self.label.bind("<Double-Button-1>", self._on_double_click)
        self.label.bind("<Button-3>", self._show_context_menu)
        self.bind("<Button-3>", self._show_context_menu)

    def set_selected(self, selected: bool):
        self._selected = selected
        self.configure(fg_color=("gray75", "gray30") if selected else "transparent")

    def set_title(self, title: str):
        self.label.configure(text=title)

    def _on_click(self, event):
        self._on_select(self.conv_id)

    def _on_double_click(self, event):
        current = self.label.cget("text")
        new_title = simpledialog.askstring("重命名对话", "输入新标题：", initialvalue=current,
                                           parent=self.winfo_toplevel())
        if new_title and new_title.strip():
            self._on_rename(self.conv_id, new_title.strip())
            self.set_title(new_title.strip())

    def _show_context_menu(self, event):
        menu = tk.Menu(self, tearoff=0)
        menu.add_command(label="重命名", command=lambda: self._on_double_click(None))
        menu.add_command(label="导出为 Markdown", command=lambda: self._on_export(self.conv_id))
        menu.add_separator()
        menu.add_command(label="删除", command=self._confirm_delete)
        menu.tk_popup(event.x_root, event.y_root)

    def _confirm_delete(self):
        if messagebox.askyesno("删除对话", f"确定删除「{self.label.cget('text')}」？",
                               parent=self.winfo_toplevel()):
            self._on_delete(self.conv_id)


class Sidebar(ctk.CTkFrame):
    """左侧对话列表侧边栏，支持拖拽排序、搜索过滤。"""

    def __init__(self, master,
                 on_select: Callable[[str], None],
                 on_new: Callable[[], None],
                 on_rename: Callable[[str, str], None],
                 on_delete: Callable[[str], None],
                 on_export: Callable[[str], None],
                 on_reorder: Callable[[list[str]], None],
                 width: int = 220,
                 **kwargs):
        super().__init__(master, width=width, corner_radius=0, **kwargs)
        self.pack_propagate(False)

        self._on_select = on_select
        self._on_new = on_new
        self._on_rename = on_rename
        self._on_delete = on_delete
        self._on_export = on_export
        self._on_reorder = on_reorder

        self._items: list[SidebarItem] = []
        self._all_convs: list[dict] = []
        self._selected_id: Optional[str] = None

        # 拖拽状态
        self._drag_src: Optional[int] = None
        self._drag_placeholder: Optional[ctk.CTkFrame] = None

        self._build_ui()

    def _build_ui(self):
        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=8, pady=(8, 4))
        ctk.CTkButton(top, text="+ 新对话", command=self._on_new, height=32).pack(fill="x")

        self._scroll = ctk.CTkScrollableFrame(self, label_text="", fg_color="transparent")
        self._scroll.pack(fill="both", expand=True, padx=4)

        bottom = ctk.CTkFrame(self, fg_color="transparent")
        bottom.pack(fill="x", padx=8, pady=(4, 8))
        self._search_var = tk.StringVar()
        self._search_var.trace_add("write", lambda *_: self._apply_filter())
        ctk.CTkEntry(bottom, placeholder_text="搜索对话...",
                     textvariable=self._search_var, height=30).pack(fill="x")

    def load_conversations(self, convs: list[dict]):
        self._all_convs = list(convs)
        self._apply_filter()

    def _apply_filter(self):
        keyword = self._search_var.get().strip().lower()
        filtered = [c for c in self._all_convs
                    if not keyword or keyword in c["title"].lower()]
        self._render(filtered)

    def _render(self, convs: list[dict]):
        for item in self._items:
            item.destroy()
        self._items.clear()

        for conv in convs:
            item = SidebarItem(
                self._scroll,
                conv_id=conv["id"],
                title=conv["title"],
                on_select=self._select,
                on_rename=self._on_rename,
                on_delete=self._delete,
                on_export=self._on_export,
                fg_color="transparent",
            )
            item.pack(fill="x", pady=1)
            # 拖拽绑定在 Sidebar 层管理
            item.label.bind("<ButtonPress-1>", self._drag_press)
            item.label.bind("<B1-Motion>", self._drag_motion)
            item.label.bind("<ButtonRelease-1>", self._drag_release)
            self._items.append(item)

            if conv["id"] == self._selected_id:
                item.set_selected(True)

    def _select(self, conv_id: str):
        self._selected_id = conv_id
        self._highlight(conv_id)
        self._on_select(conv_id)

    def _highlight(self, conv_id: str):
        self._selected_id = conv_id
        for item in self._items:
            item.set_selected(item.conv_id == conv_id)

    def select(self, conv_id: str):
        self._highlight(conv_id)

    def _delete(self, conv_id: str):
        self._on_delete(conv_id)

    def update_title(self, conv_id: str, title: str):
        for item in self._items:
            if item.conv_id == conv_id:
                item.set_title(title)
        for c in self._all_convs:
            if c["id"] == conv_id:
                c["title"] = title

    def add_conversation(self, conv: dict):
        self._all_convs.insert(0, conv)
        self._apply_filter()
        self._highlight(conv["id"])

    def remove_conversation(self, conv_id: str):
        self._all_convs = [c for c in self._all_convs if c["id"] != conv_id]
        if self._selected_id == conv_id:
            self._selected_id = None
        self._apply_filter()

    # ── 拖拽排序 ──────────────────────────────────────────────────────
    def _item_index_at_y(self, y_root: int) -> Optional[int]:
        for i, item in enumerate(self._items):
            try:
                iy = item.winfo_rooty()
                ih = item.winfo_height()
                if iy <= y_root <= iy + ih:
                    return i
            except Exception:
                pass
        return None

    def _drag_press(self, event):
        widget = event.widget
        for i, item in enumerate(self._items):
            if item.label is widget:
                self._drag_src = i
                break

    def _drag_motion(self, event):
        if self._drag_src is None:
            return
        dst = self._item_index_at_y(event.y_root)
        if dst is None or dst == self._drag_src:
            return
        # 实时交换位置
        src = self._drag_src
        item = self._items.pop(src)
        self._items.insert(dst, item)
        conv = self._all_convs.pop(src)
        self._all_convs.insert(dst, conv)
        self._drag_src = dst

        for i in self._items:
            i.pack_forget()
        for i in self._items:
            i.pack(fill="x", pady=1)

    def _drag_release(self, event):
        if self._drag_src is not None:
            self._on_reorder([c["id"] for c in self._all_convs])
        self._drag_src = None
