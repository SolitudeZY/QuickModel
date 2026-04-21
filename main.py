import sys
import os

# 确保 app 目录在路径中（PyInstaller 打包后也能找到）
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))

sys.path.insert(0, base_dir)

import webview
from app.webview_app import API, get_html_path

if __name__ == "__main__":
    api = API()
    window = webview.create_window(
        'AI Desktop Assistant',
        get_html_path(),
        js_api=api,
        width=1100,
        height=700,
        min_size=(800, 500),
    )
    api.set_window(window)
    webview.start(debug=False)
