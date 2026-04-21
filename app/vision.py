import base64
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def is_image(path: str) -> bool:
    return Path(path).suffix.lower() in IMAGE_EXTS


def _encode_image(path: str) -> tuple[str, str]:
    """返回 (base64_data, mime_type)"""
    ext = Path(path).suffix.lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}.get(ext, "image/png")
    data = base64.b64encode(Path(path).read_bytes()).decode("utf-8")
    return data, mime


def describe_image(
    path: str,
    prompt: str = "请详细描述这张图片的内容。",
    api_key: str = "",
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: str = "qwen-vl-plus",
) -> str:
    if not api_key:
        return f"[图片：{Path(path).name}]（未配置 Vision API Key，无法解析图片内容）"
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        b64, mime = _encode_image(path)
        resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return resp.choices[0].message.content or "（无返回内容）"
    except Exception as e:
        return f"[图片解析失败：{e}]"
