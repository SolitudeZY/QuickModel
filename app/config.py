import json
import os
import platform
import copy
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

APP_NAME = "AIDesktopAssistant"
APP_VERSION = "1.9.16"
GITHUB_REPO = "SolitudeZY/Deepseek-GUI"

IS_MAC = platform.system() == "Darwin"
IS_WIN = platform.system() == "Windows"

MODEL_PROTOCOLS = {"openai_chat", "openai_responses", "anthropic_messages"}
PROVIDER_PROFILES = {"generic", "deepseek", "qwen", "glm"}
ANTHROPIC_AUTH_MODES = {"api_key", "auth_token"}
MODEL_CLIENT_PROFILES = {"generic", "codex"}
MODEL_API_TYPES = {
    "openai_chat",
    "openai_responses",
    "anthropic",
    "deepseek",
    "qwen",
    "glm",
    "codex_chat",
    "codex_responses",
}

MODEL_API_TYPE_FIELDS = {
    "openai_chat": ("openai_chat", "generic", "generic"),
    "openai_responses": ("openai_responses", "generic", "generic"),
    "anthropic": ("anthropic_messages", "generic", "generic"),
    "deepseek": ("openai_chat", "deepseek", "generic"),
    "qwen": ("openai_chat", "qwen", "generic"),
    "glm": ("openai_chat", "glm", "generic"),
    "codex_chat": ("openai_chat", "generic", "codex"),
    "codex_responses": ("openai_responses", "generic", "codex"),
}

MODEL_CONFIG_DEFAULTS = {
    "image_input_mode": "auto",
    "api_type": "openai_chat",
    "api_protocol": "openai_chat",
    "provider_profile": "generic",
    "auth_mode": "api_key",
    "client_profile": "generic",
    "responses_server_state": False,
}

DEFAULT_SYSTEM_PROMPT = (
    "You are a precise, pragmatic AI assistant. Understand the user's goal before acting, "
    "ask only when missing information materially blocks progress, use available tools when "
    "they improve reliability, distinguish verified facts from assumptions, and return concise, "
    "actionable results. Preserve user data and avoid unrelated changes."
)


def infer_provider_profile(model_config: dict) -> str:
    """Conservatively classify legacy Chat-compatible provider configs once."""
    url = str(model_config.get("base_url", "") or "").strip().lower()
    model = str(model_config.get("model", "") or "").strip().lower()
    try:
        host = (urlsplit(url).hostname or "").lower()
    except Exception:
        host = ""
    if host == "api.deepseek.com" or model.startswith("deepseek-"):
        return "deepseek"
    if host.endswith("dashscope.aliyuncs.com") or model.startswith("qwen"):
        return "qwen"
    if host == "open.bigmodel.cn" or model.startswith(("glm-", "chatglm")):
        return "glm"
    return "generic"


def infer_model_api_type(model_config: dict) -> str:
    """Map legacy protocol/profile/client combinations to one UI-facing type."""
    protocol = str(model_config.get("api_protocol", "") or "").strip().lower()
    if protocol not in MODEL_PROTOCOLS:
        protocol = "openai_chat"
    profile = str(model_config.get("provider_profile", "") or "").strip().lower()
    if profile not in PROVIDER_PROFILES:
        profile = infer_provider_profile(model_config)
    client = str(model_config.get("client_profile", "") or "").strip().lower()
    if client not in MODEL_CLIENT_PROFILES:
        client = "generic"

    if client == "codex":
        return "codex_responses" if protocol == "openai_responses" else "codex_chat"
    if protocol == "anthropic_messages":
        return "anthropic"
    if protocol == "openai_responses":
        return "openai_responses"
    return profile if profile in {"deepseek", "qwen", "glm"} else "openai_chat"


def normalize_model_config(model_config: dict) -> dict:
    """Return a validated model config without mutating the caller's object."""
    normalized = copy.deepcopy(model_config) if isinstance(model_config, dict) else {}

    api_type = str(normalized.get("api_type", "") or "").strip().lower()
    if api_type not in MODEL_API_TYPES:
        if "provider_profile" not in normalized:
            normalized["provider_profile"] = infer_provider_profile(normalized)
        api_type = infer_model_api_type(normalized)
    normalized["api_type"] = api_type
    image_mode = normalized.get("image_input_mode", "auto")
    normalized["image_input_mode"] = image_mode if image_mode in ("auto", "native", "external") else "auto"
    protocol, profile, client_profile = MODEL_API_TYPE_FIELDS[api_type]
    normalized["api_protocol"] = protocol
    normalized["provider_profile"] = profile
    normalized["client_profile"] = client_profile

    auth_mode = str(normalized.get("auth_mode", "") or "").strip().lower()
    normalized["auth_mode"] = auth_mode if auth_mode in ANTHROPIC_AUTH_MODES else "api_key"
    if api_type != "anthropic":
        normalized["auth_mode"] = "api_key"
    normalized["responses_server_state"] = (
        normalized.get("responses_server_state") is True
        and protocol == "openai_responses"
    )
    system_prompt = str(normalized.get("system_prompt", "") or "").strip()
    normalized["system_prompt"] = (
        DEFAULT_SYSTEM_PROMPT
        if not system_prompt or system_prompt == "You are a helpful assistant."
        else system_prompt
    )
    normalized.pop("use_full_url", None)
    return normalized


def supports_native_images(model_config: dict) -> bool:
    """Only known official endpoints opt in automatically; proxies can opt in."""
    mode = model_config.get("image_input_mode", "auto")
    if mode != "auto":
        return mode == "native"
    try:
        host = (urlsplit(model_config.get("base_url", "")).hostname or "").lower()
    except ValueError:
        return False
    model = str(model_config.get("model", "")).strip().lower()
    return (host == "api.deepseek.com" and model in {
        "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
    }) or (host == "dashscope.aliyuncs.com" and model == "deepseek-v4.1-flash")


def normalize_config(config: dict) -> dict:
    """Normalize persisted config fields at the storage boundary."""
    normalized = copy.deepcopy(config) if isinstance(config, dict) else {}
    had_theme_mode = "theme_mode" in normalized
    had_location_mode_version = normalized.get("weather_location_mode_version") == 1
    legacy_theme = str(normalized.get("theme", "") or "").strip().lower()
    for key, value in DEFAULT_CONFIG.items():
        if key not in normalized:
            normalized[key] = copy.deepcopy(value)
    theme_mode = str(normalized.get("theme_mode", "") or "").strip().lower()
    if not had_theme_mode and legacy_theme in {"dark", "light"}:
        theme_mode = {"dark": "night", "light": "day"}.get(legacy_theme, "auto")
    elif theme_mode not in {"auto", "day", "dusk", "night"}:
        theme_mode = "auto"
    normalized["theme_mode"] = theme_mode
    location_mode = str(normalized.get("weather_location_mode", "ip") or "").strip().lower()
    if not had_location_mode_version and location_mode == "device":
        location_mode = "ip"
    normalized["weather_location_mode"] = location_mode if location_mode in {"ip", "device", "manual"} else "ip"
    normalized["weather_location_mode_version"] = 1
    normalized["weather_city"] = str(normalized.get("weather_city", "") or "").strip()[:120]
    weather_preview = str(normalized.get("weather_preview", "auto") or "").strip().lower()
    normalized["weather_preview"] = (
        weather_preview
        if weather_preview in {"auto", "clear", "cloudy", "rain", "snow", "fog", "thunder"}
        else "auto"
    )
    try:
        refresh_minutes = int(normalized.get("weather_refresh_minutes", 30))
    except (TypeError, ValueError):
        refresh_minutes = 30
    normalized["weather_refresh_minutes"] = max(15, min(refresh_minutes, 180))
    normalized["weather_enabled"] = normalized.get("weather_enabled") is not False
    configs = normalized.get("model_configs")
    if not isinstance(configs, list):
        configs = []
    normalized["model_configs"] = [normalize_model_config(item) for item in configs]
    return normalized


def get_app_data_dir() -> Path:
    if IS_MAC:
        base = Path.home() / "Library" / "Application Support"
    else:
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
        "name": "DeepSeek V4 Pro",
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-v4-pro",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "context_length": 1000000,
        "compact_threshold": 600000,
        "api_type": "deepseek",
    },
    {
        "name": "DeepSeek V4.1 Flash",
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-flash",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "context_length": 1000000,
        "compact_threshold": 600000,
        "api_type": "deepseek",
    },
    {
        "name": "DeepSeek V3.2",
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "context_length": 128000,
        "compact_threshold": 80000,
        "api_type": "deepseek",
    },
    {
        "name": "OpenAI",
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "context_length": 128000,
        "compact_threshold": 80000,
        "api_type": "openai_chat",
    },
    {
        "name": "本地 Ollama",
        "api_key": "ollama",
        "base_url": "https://ollama.api.com/v1",
        "model": "llama3",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "context_length": 128000,
        "compact_threshold": 80000,
        "api_type": "openai_chat",
    },
]

DEFAULT_CONFIG = {
    "model_configs": DEFAULT_MODEL_CONFIGS,
    "active_model_config": "DeepSeek 官方",
    "tavily_api_key": "",
    "search_engine": "tavily",         # tavily | brave | firecrawl | duckduckgo | google | searxng
    "search_fallback": True,           # 失败时自动降级到其他引擎
    "bing_api_key": "",                # 已停用，保留兼容
    "brave_api_key": "",
    "firecrawl_api_key": "",
    "google_api_key": "",
    "google_cx": "",                   # Google Custom Search Engine ID
    "searxng_url": "",                 # 如 http://localhost:8888
    "command_safety": "confirm",   # confirm | auto | disabled
    "command_timeout": 30,
    "max_rounds": 50,
    "theme": "dark",               # legacy color preference; theme_mode is authoritative
    "theme_mode": "auto",          # auto | day | dusk | night
    "font_size": 13,
    "starfield_enabled": False,    # 背景动态效果开关
    "starfield_mode": "twinkle",   # twinkle | trails | weather
    "background_quality": "balanced",  # eco | balanced | high
    "weather_enabled": True,        # 根据天气调整动态背景
    "weather_location_mode": "ip",  # ip | device | manual
    "weather_location_mode_version": 1,
    "weather_city": "",            # 手动定位城市（可选）
    "weather_preview": "auto",    # auto | clear | cloudy | rain | snow | fog | thunder
    "weather_intensity": 70,
    "weather_mist": 32,
    "weather_refraction": 65,
    "weather_refresh_minutes": 30,
    "sidebar_width": 220,
    "vision_api_key": "",
    "vision_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "vision_model": "qwen-vl-max",
    "vision_timeout": 90,
    "imagegen_api_key": "",
    "imagegen_base_url": "",
    "imagegen_use_full_url": False,
    "imagegen_model": "gpt-image-2",
    "imagegen_format": "openai",  # openai | dashscope
    "thinking": "high",             # off | high | max
    "search_mode": "auto",         # auto | manual
    "search_enabled": True,        # manual mode: whether search tool is active
    "sync_folder": "",             # 云同步文件夹路径（如坚果云同步目录）
    "sync_auto_upload": True,      # 对话保存时自动上传到同步文件夹
    "recent_projects": [],         # 最近使用的项目目录 [{path, name, last_used}]，倒序，上限 ~12
    "mcp_servers": [],             # MCP stdio / Streamable HTTP 服务器配置
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            normalized = normalize_config(data)
        except Exception:
            return normalize_config(DEFAULT_CONFIG)
        if normalized != data:
            try:
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(normalized, f, ensure_ascii=False, indent=2)
            except OSError:
                pass
        return normalized
    return normalize_config(DEFAULT_CONFIG)


def save_config(config: dict) -> None:
    config = normalize_config(config)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def get_active_model_config(config: dict) -> Optional[dict]:
    name = config.get("active_model_config")
    for mc in config.get("model_configs", []):
        if mc["name"] == name:
            return mc
    configs = config.get("model_configs", [])
    return configs[0] if configs else None


def get_allowed_commands_path() -> Path:
    return get_app_data_dir() / "allowed_commands.json"


def load_allowed_commands() -> list:
    p = get_allowed_commands_path()
    if p.exists():
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_allowed_commands(commands: list) -> None:
    with open(get_allowed_commands_path(), "w", encoding="utf-8") as f:
        json.dump(commands, f, ensure_ascii=False, indent=2)


def is_command_allowed(command: str) -> bool:
    import fnmatch
    cmd = command.strip()
    for pattern in load_allowed_commands():
        if fnmatch.fnmatch(cmd, pattern) or cmd == pattern:
            return True
    return False


def add_allowed_command(command: str) -> None:
    cmds = load_allowed_commands()
    cmd = command.strip()
    if cmd and cmd not in cmds:
        cmds.append(cmd)
        save_allowed_commands(cmds)
