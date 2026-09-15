"""Local image references, immutable snapshots and wire-format conversion.

Conversation content remains text. Only protocol adapters expand ``images`` into
API content blocks; encoded bytes never become conversation or summary text.
"""

import base64
import copy
import hashlib
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.config import get_app_data_dir, supports_native_images


MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_REQUEST_BYTES = 48 * 1024 * 1024
MIME_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "GIF": "image/gif", "WEBP": "image/webp"}
SUFFIXES = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp"}
EXTERNAL_IMAGE_HINT = (
    "当前模型未直接接收图片。需要文字时可用 ocr_image；需要视觉理解时，"
    "用 analyze_image(path, question) 并在 question 中提供问题背景。"
)


class ImageAttachmentError(ValueError):
    pass


@dataclass
class ImageToolResult:
    attachment: dict
    text: str


def _read_bytes(path: Path) -> bytes:
    try:
        with path.open("rb") as handle:
            data = handle.read(MAX_IMAGE_BYTES + 1)
    except OSError as exc:
        raise ImageAttachmentError(f"图片无法读取：{path}。请重新附加图片或使用 view_image 打开有效路径。") from exc
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageAttachmentError(f"图片超过 32 MiB，请缩小后重试：{path.name}")
    return data


def snapshot_image(path: str, name: str = "", cwd: str = "") -> dict:
    """Validate and copy bytes once; follow-up requests verify the content hash."""
    from PIL import Image

    if not str(path or "").strip():
        raise ImageAttachmentError("图片尚未上传完成，请等待附件就绪后重试。")
    source = Path(path).expanduser()
    if not source.is_absolute():
        source = Path(cwd or Path.cwd()) / source
    source = source.resolve()
    data = _read_bytes(source)
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            width, height = img.size
            if max(width, height) > 8192:
                raise ImageAttachmentError("图片单边超过 8192 像素，请缩小后重试。")
            if fmt == "BMP":
                output = io.BytesIO()
                img.convert("RGB").save(output, format="PNG")
                data, fmt = output.getvalue(), "PNG"
            else:
                img.verify()
    except ImageAttachmentError:
        raise
    except Exception as exc:
        raise ImageAttachmentError(f"图片损坏或格式不可识别：{source.name}") from exc
    if fmt not in MIME_TYPES:
        raise ImageAttachmentError("支持 JPEG、PNG、GIF、WebP，以及自动转换为 PNG 的 BMP。")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageAttachmentError("转换后的图片超过 32 MiB，请缩小后重试。")
    digest = hashlib.sha256(data).hexdigest()
    directory = get_app_data_dir() / "uploads" / "native_images"
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / (digest + SUFFIXES[fmt])
    try:
        with dest.open("xb") as handle:
            handle.write(data)
    except FileExistsError:
        if hashlib.sha256(_read_bytes(dest)).hexdigest() != digest:
            raise ImageAttachmentError(f"图片快照已被修改：{dest}。请移走该文件后重新附加。")
    return {"path": str(dest), "name": name or source.name, "mime_type": MIME_TYPES[fmt],
            "sha256": digest, "width": width, "height": height}


def image_data_url(ref: dict) -> str:
    path = Path(ref["path"])
    # A restored conversation may refer to the other computer's data directory.
    if not path.is_file():
        local = get_app_data_dir() / "uploads" / "native_images" / path.name
        if local.is_file():
            path = local
    data = _read_bytes(path)
    if hashlib.sha256(data).hexdigest() != ref.get("sha256"):
        raise ImageAttachmentError(f"图片内容与会话快照不一致：{ref.get('name', path.name)}，请重新附加。")
    mime = ref.get("mime_type")
    if mime not in MIME_TYPES.values():
        raise ImageAttachmentError("图片附件的 MIME 类型无效，请重新附加。")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def prepare_image_messages(messages: list[dict], config: dict) -> list[dict]:
    """Create disposable Chat-style content blocks without modifying history."""
    native = supports_native_images(config)
    result = []
    total_bytes = 0
    refs = [ref for message in messages for ref in message.get("images", [])]
    if native and (len(refs) > 600 or (len(refs) >= 15 and any(
            max(ref.get("width", 0), ref.get("height", 0)) > 4096 for ref in refs))):
        raise ImageAttachmentError("图片数量超过 600，或 15 张及以上图片中存在单边超过 4096 像素的图片；请减少图片或压缩上下文。")
    for message in messages:
        item = copy.deepcopy(message)
        item.pop("image_origin", None)
        images = item.pop("images", [])
        if images:
            if item.get("role") != "user":
                raise ImageAttachmentError("图片必须放在 user 消息中。")
            content = item.get("content") or ""
            if native:
                blocks = [{"type": "text", "text": content}] if isinstance(content, str) else list(content)
                for ref in images:
                    url = image_data_url(ref)
                    total_bytes += len(url)
                    if total_bytes > MAX_REQUEST_BYTES:
                        raise ImageAttachmentError("图片请求超过 48 MiB，请减少图片或压缩上下文。")
                    blocks.append({"type": "image_url", "image_url": {"url": url}})
                item["content"] = blocks
            else:
                paths = "\n".join(f"[图片: {ref.get('name', '')} 路径: {ref['path']}]" for ref in images if ref['path'] not in content)
                item["content"] = f"{content}\n{paths}\n（{EXTERNAL_IMAGE_HINT}）"
        result.append(item)
    return result


def convert_content(content, protocol: str):
    """Convert canonical Chat content lists, never stringify image blocks."""
    if not isinstance(content, list):
        return content or ""
    blocks = []
    for block in content:
        kind = block.get("type")
        if kind == "text":
            blocks.append({"type": "input_text" if protocol == "openai_responses" else "text",
                           "text": block.get("text", "")})
        elif kind == "image_url":
            image = block["image_url"]
            url = image["url"]
            if protocol == "openai_responses":
                converted = {"type": "input_image", "image_url": url}
                if image.get("detail"):
                    converted["detail"] = image["detail"]
            elif protocol == "anthropic_messages":
                match = re.fullmatch(r"data:(image/[\w.+-]+);base64,(.+)", url, re.DOTALL)
                if match:
                    source = {"type": "base64", "media_type": match[1], "data": match[2]}
                elif url.startswith(("https://", "http://")):
                    source = {"type": "url", "url": url}
                else:
                    raise ImageAttachmentError("图片 URL 必须是 Base64 data URL 或 HTTP(S) URL。")
                converted = {"type": "image", "source": source}
            else:
                converted = copy.deepcopy(block)
            blocks.append(converted)
        else:
            raise ImageAttachmentError(f"不支持的消息内容块：{kind}")
    return blocks


def check_request_size(payload: dict) -> None:
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_REQUEST_BYTES:
        raise ImageAttachmentError("请求体超过 48 MiB，请减少图片或压缩上下文后重试。")


def summary_safe(value):
    """Remove transport bytes even if an external caller supplies API blocks."""
    if isinstance(value, list):
        return [summary_safe(item) for item in value]
    if isinstance(value, dict):
        if value.get("type") in {"image_url", "input_image", "image"}:
            return {"type": "image_reference", "text": "[图片内容不作为文本展开]"}
        return {key: summary_safe(item) for key, item in value.items()}
    if isinstance(value, str):
        return re.sub(r"data:image/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+", "[图片编码已省略]", value)
    return value


def estimate_message_tokens(value) -> int:
    """Conservative image budget; actual provider usage remains authoritative."""
    def image_count(item):
        if isinstance(item, list):
            return sum(image_count(x) for x in item)
        if isinstance(item, dict):
            if item.get("type") in {"image_url", "input_image", "image"}:
                return 1
            return len(item.get("images", [])) + sum(image_count(v) for k, v in item.items() if k != "images")
        return 0
    return len(json.dumps(summary_safe(value), default=str)) // 4 + image_count(value) * 1024
