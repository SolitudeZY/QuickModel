import json
import os
from pathlib import Path
from typing import Optional

APP_NAME = "AIDesktopAssistant"


def get_app_data_dir() -> Path:
    base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_conversations_dir() -> Path:
    d = get_app_data_dir() / "conversations"
    d.mkdir(parents=True, exist_ok=True)
    return d


CONFIG_PATH = get_app_data_dir() / "config.json"

DEFAULT_MODEL_CONFIGS = [
    {
        "name": "DeepSeek 官方",
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "system_prompt": "You are a helpful assistant.",
    },
    {
        "name": "OpenAI",
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
        "system_prompt": "You are a helpful assistant.",
    },
    {
        "name": "本地 Ollama",
        "api_key": "ollama",
        "base_url": "http://localhost:11434/v1",
        "model": "llama3",
        "system_prompt": "You are a helpful assistant.",
    },
]

DEFAULT_CONFIG = {
    "model_configs": DEFAULT_MODEL_CONFIGS,
    "active_model_config": "DeepSeek 官方",
    "tavily_api_key": "",
    "command_safety": "confirm",   # confirm | auto | disabled
    "command_timeout": 30,
    "theme": "dark",               # dark | light | system
    "font_size": 13,
    "sidebar_width": 220,
    "vision_api_key": "",
    "vision_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "vision_model": "qwen-vl-max",
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            # 补全缺失的顶层 key
            for k, v in DEFAULT_CONFIG.items():
                if k not in data:
                    data[k] = v
            return data
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def get_active_model_config(config: dict) -> Optional[dict]:
    name = config.get("active_model_config")
    for mc in config.get("model_configs", []):
        if mc["name"] == name:
            return mc
    configs = config.get("model_configs", [])
    return configs[0] if configs else None
