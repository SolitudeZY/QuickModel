"""云同步模块 — 通过本地同步文件夹（坚果云/OneDrive等）实现对话和配置同步。

工作原理：
- 对话保存时自动复制 JSON 到同步文件夹
- 启动时扫描同步文件夹，检测本地没有的对话文件
- 用户可选择性导入新对话
- 配置文件（config.json、allowed_commands.json）也可同步
"""
import json
import shutil
from pathlib import Path
from typing import Optional

from app.config import (
    get_conversations_dir, load_config, save_config,
    CONFIG_PATH, get_allowed_commands_path, get_app_data_dir,
)


SYNC_SUBDIR = "QuickModel_Sync"
CONFIG_SYNC_SUBDIR = "QuickModel_Config"
MEMORY_SYNC_SUBDIR = "QuickModel_Memory"
SKILL_SYNC_SUBDIR = "QuickModel_Skills"


def get_sync_dir() -> Optional[Path]:
    """获取同步目录路径。返回 None 表示未配置。"""
    config = load_config()
    folder = config.get("sync_folder", "")
    if not folder:
        return None
    sync_dir = Path(folder) / SYNC_SUBDIR
    sync_dir.mkdir(parents=True, exist_ok=True)
    return sync_dir


def upload_conversation(conv_id: str) -> bool:
    """将指定对话上传（复制）到同步文件夹。"""
    sync_dir = get_sync_dir()
    if not sync_dir:
        return False
    src = get_conversations_dir() / f"{conv_id}.json"
    if not src.exists():
        return False
    dest = sync_dir / f"{conv_id}.json"
    shutil.copy2(src, dest)
    return True


def upload_all_conversations() -> int:
    """将所有本地对话上传到同步文件夹。返回上传数量。"""
    sync_dir = get_sync_dir()
    if not sync_dir:
        return 0
    count = 0
    for src in get_conversations_dir().glob("conv_*.json"):
        dest = sync_dir / src.name
        # 只在源文件更新时覆盖
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            count += 1
    return count


def detect_new_conversations() -> list[dict]:
    """检测同步文件夹中本地没有的对话，返回摘要列表。"""
    sync_dir = get_sync_dir()
    if not sync_dir:
        return []
    local_dir = get_conversations_dir()
    new_convs = []
    for f in sync_dir.glob("conv_*.json"):
        local_file = local_dir / f.name
        # 本地不存在，或同步文件夹的版本更新
        if not local_file.exists() or f.stat().st_mtime > local_file.stat().st_mtime:
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                new_convs.append({
                    "id": f.stem,
                    "title": data.get("title", "未命名"),
                    "updated_at": data.get("updated_at", ""),
                    "filename": f.name,
                    "is_new": not local_file.exists(),
                })
            except Exception:
                continue
    # 按更新时间降序
    new_convs.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return new_convs


def import_from_sync(filenames: list[str]) -> int:
    """从同步文件夹导入选中的对话到本地。返回导入数量。"""
    sync_dir = get_sync_dir()
    if not sync_dir:
        return 0
    local_dir = get_conversations_dir()
    count = 0
    for name in filenames:
        src = sync_dir / name
        if src.exists():
            shutil.copy2(src, local_dir / name)
            count += 1
    return count


def delete_from_sync(conv_id: str) -> bool:
    """从同步文件夹删除指定对话。"""
    sync_dir = get_sync_dir()
    if not sync_dir:
        return False
    dest = sync_dir / f"{conv_id}.json"
    if dest.exists():
        dest.unlink()
        return True
    return False


# ─── 配置同步 ───────────────────────────────────────────────────────────────

def _get_config_sync_dir() -> Optional[Path]:
    """获取配置同步目录。"""
    config = load_config()
    folder = config.get("sync_folder", "")
    if not folder:
        return None
    d = Path(folder) / CONFIG_SYNC_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def upload_config() -> dict:
    """上传配置文件到同步文件夹。返回上传的文件列表。"""
    cfg_dir = _get_config_sync_dir()
    if not cfg_dir:
        return {"uploaded": []}
    uploaded = []
    # config.json
    if CONFIG_PATH.exists():
        shutil.copy2(CONFIG_PATH, cfg_dir / "config.json")
        uploaded.append("config.json")
    # allowed_commands.json
    ac_path = get_allowed_commands_path()
    if ac_path.exists():
        shutil.copy2(ac_path, cfg_dir / "allowed_commands.json")
        uploaded.append("allowed_commands.json")
    return {"uploaded": uploaded}


def detect_config_updates() -> dict:
    """检测同步文件夹中是否有更新的配置文件。"""
    cfg_dir = _get_config_sync_dir()
    if not cfg_dir:
        return {"has_updates": False, "files": []}
    updates = []
    # config.json
    remote_cfg = cfg_dir / "config.json"
    if remote_cfg.exists():
        if not CONFIG_PATH.exists() or remote_cfg.stat().st_mtime > CONFIG_PATH.stat().st_mtime:
            updates.append("config.json")
    # allowed_commands.json
    ac_path = get_allowed_commands_path()
    remote_ac = cfg_dir / "allowed_commands.json"
    if remote_ac.exists():
        if not ac_path.exists() or remote_ac.stat().st_mtime > ac_path.stat().st_mtime:
            updates.append("allowed_commands.json")
    return {"has_updates": len(updates) > 0, "files": updates}


def import_config(files: Optional[list] = None) -> dict:
    """从同步文件夹导入配置文件。files 为 None 时导入所有可用配置。"""
    cfg_dir = _get_config_sync_dir()
    if not cfg_dir:
        return {"imported": []}
    if files is None:
        files = ["config.json", "allowed_commands.json"]
    imported = []
    for name in files:
        src = cfg_dir / name
        if not src.exists():
            continue
        if name == "config.json":
            # 导入配置时保留本机的 sync_folder（不覆盖同步路径）
            local_sync_folder = load_config().get("sync_folder", "")
            shutil.copy2(src, CONFIG_PATH)
            # 恢复本机同步路径
            cfg = load_config()
            cfg["sync_folder"] = local_sync_folder
            save_config(cfg)
            imported.append(name)
        elif name == "allowed_commands.json":
            shutil.copy2(src, get_allowed_commands_path())
            imported.append(name)
    return {"imported": imported}


# ─── 记忆同步 ───────────────────────────────────────────────────────────────

def _get_memory_sync_dir() -> Optional[Path]:
    """获取记忆同步目录。"""
    config = load_config()
    folder = config.get("sync_folder", "")
    if not folder:
        return None
    d = Path(folder) / MEMORY_SYNC_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _local_memory_dir() -> Path:
    d = get_app_data_dir() / "memory"
    d.mkdir(exist_ok=True)
    return d


def _get_skill_sync_dir() -> Optional[Path]:
    """获取技能同步目录。"""
    config = load_config()
    folder = config.get("sync_folder", "")
    if not folder:
        return None
    d = Path(folder) / SKILL_SYNC_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _local_skills_dir() -> Path:
    d = get_app_data_dir() / "skills"
    d.mkdir(exist_ok=True)
    return d


def upload_memory() -> int:
    """将本地记忆 .md 上传到同步文件夹（mtime 增量）。返回上传数量。"""
    mem_dir = _get_memory_sync_dir()
    if not mem_dir:
        return 0
    count = 0
    for src in _local_memory_dir().glob("*.md"):
        dest = mem_dir / src.name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            count += 1
    return count


def import_memory() -> int:
    """从同步文件夹导入更新的记忆 .md 到本地（mtime 增量）。返回导入数量。"""
    mem_dir = _get_memory_sync_dir()
    if not mem_dir:
        return 0
    local_dir = _local_memory_dir()
    count = 0
    for src in mem_dir.glob("*.md"):
        dest = local_dir / src.name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            count += 1
    return count


def upload_skills() -> int:
    """将本地技能 .md 上传到同步文件夹（mtime 增量）。返回上传数量。"""
    skill_dir = _get_skill_sync_dir()
    if not skill_dir:
        return 0
    count = 0
    for src in _local_skills_dir().glob("*.md"):
        dest = skill_dir / src.name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            count += 1
    return count


def import_skills() -> int:
    """从同步文件夹导入更新的技能 .md 到本地（mtime 增量）。返回导入数量。"""
    skill_dir = _get_skill_sync_dir()
    if not skill_dir:
        return 0
    local_dir = _local_skills_dir()
    count = 0
    for src in skill_dir.glob("*.md"):
        dest = local_dir / src.name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
            count += 1
    return count


def sync_all() -> dict:
    """一键全量同步：上传对话 + 上传配置 + 上传记忆 + 上传技能。"""
    conv_count = upload_all_conversations()
    cfg_result = upload_config()
    mem_count = upload_memory()
    skill_count = upload_skills()
    return {
        "conversations_uploaded": conv_count,
        "config_uploaded": cfg_result["uploaded"],
        "memory_uploaded": mem_count,
        "skills_uploaded": skill_count,
    }


def import_all() -> dict:
    """一键全量导入：导入所有新对话 + 导入配置 + 导入记忆 + 导入技能。"""
    # 导入对话
    new_convs = detect_new_conversations()
    conv_count = 0
    if new_convs:
        filenames = [c["filename"] for c in new_convs]
        conv_count = import_from_sync(filenames)
    # 导入配置
    cfg_result = import_config()
    # 导入记忆
    mem_count = import_memory()
    # 导入技能
    skill_count = import_skills()
    return {
        "conversations_imported": conv_count,
        "config_imported": cfg_result["imported"],
        "memory_imported": mem_count,
        "skills_imported": skill_count,
    }
