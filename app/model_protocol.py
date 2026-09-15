"""Normalized text-model protocol adapters for QuickModel."""

from __future__ import annotations

import hashlib
import json
import platform
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import urlsplit, urlunsplit

from app.config import normalize_model_config
from app.multimodal import (
    check_request_size, convert_content, estimate_message_tokens,
    prepare_image_messages, summary_safe,
)


TextCallback = Optional[Callable[[str], None]]

DEFAULT_REQUEST_RETRIES = 5
_RETRY_DELAYS = (0.5, 1.0, 2.0, 4.0, 8.0)


def _value(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _usage_value(usage: Any, *names: str) -> int:
    for name in names:
        try:
            value = _value(usage, name)
            if value is not None:
                return int(value or 0)
        except (TypeError, ValueError):
            continue
    return 0


def _estimate_tokens(value: Any) -> int:
    try:
        return max(1, estimate_message_tokens(value))
    except Exception:
        return 1


def normalize_base_url(base_url: str, protocol: str, use_full_url: bool = False) -> str:
    """Return the SDK base URL for either a root URL or a standard endpoint URL.

    ``use_full_url`` is retained only for callers loading pre-1.9.4 configs. Text
    model SDKs always append their resource path, so the flag no longer changes
    behavior.
    """
    url = str(base_url or "").strip()
    if not url:
        return ""
    suffixes = {
        "openai_chat": ("/chat/completions", "/completions", "/models"),
        "openai_responses": ("/responses", "/models"),
        "anthropic_messages": ("/v1/messages", "/messages", "/v1"),
    }.get(protocol, ())
    parsed = urlsplit(url)
    path = parsed.path.rstrip("/")
    lowered = path.lower()
    for suffix in suffixes:
        if lowered.endswith(suffix):
            path = path[: -len(suffix)].rstrip("/")
            break
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment)).rstrip("/")


def _safe_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if parsed.port:
            host = f"{host}:{parsed.port}"
        return urlunsplit((parsed.scheme, host, parsed.path, "", ""))
    except Exception:
        return ""


def model_config_fingerprint(model_config: dict) -> str:
    config = normalize_model_config(model_config)
    payload = {
        "api_protocol": config["api_protocol"],
        "provider_profile": config["provider_profile"],
        "base_url": normalize_base_url(
            config.get("base_url", ""),
            config["api_protocol"],
        ),
        "model": str(config.get("model", "") or ""),
        "auth_mode": config["auth_mode"],
        "client_profile": config["client_profile"],
        "responses_server_state": config["responses_server_state"],
        "image_input_mode": config["image_input_mode"],
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ModelRuntimeConfig:
    name: str
    api_key: str
    base_url: str
    model: str
    api_protocol: str
    provider_profile: str
    auth_mode: str
    client_profile: str
    responses_server_state: bool

    @classmethod
    def from_dict(cls, model_config: dict) -> "ModelRuntimeConfig":
        config = normalize_model_config(model_config)
        protocol = config["api_protocol"]
        profile = config["provider_profile"]
        if profile != "generic" and protocol != "openai_chat":
            raise ModelConfigurationError(
                f"Provider profile '{profile}' 仅支持 OpenAI Chat Completions；"
                f"当前协议为 '{protocol}'。"
            )
        return cls(
            name=str(config.get("name", "") or ""),
            api_key=str(config.get("api_key", "") or ""),
            base_url=normalize_base_url(
                config.get("base_url", ""), protocol
            ),
            model=str(config.get("model", "") or ""),
            api_protocol=protocol,
            provider_profile=profile,
            auth_mode=config["auth_mode"],
            client_profile=config["client_profile"],
            responses_server_state=config["responses_server_state"],
        )


@dataclass
class NormalizedUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    estimated: bool = False

    def as_dict(self) -> dict:
        return {
            "prompt": self.prompt_tokens,
            "completion": self.completion_tokens,
            "cache_hit": self.cache_hit_tokens,
            "cache_miss": self.cache_miss_tokens,
            "estimated": self.estimated,
        }


@dataclass
class ProviderStateUpdate:
    response_id: str = ""
    config_fingerprint: str = ""
    updated_at: str = ""
    invalidated: bool = False

    def as_dict(self) -> dict:
        if self.invalidated:
            return {}
        return {
            "response_id": self.response_id,
            "config_fingerprint": self.config_fingerprint,
            "updated_at": self.updated_at,
        }


@dataclass
class ModelRoundResult:
    assistant_message: dict
    tool_calls: list[dict] = field(default_factory=list)
    usage: NormalizedUsage = field(default_factory=NormalizedUsage)
    provider_state_update: Optional[ProviderStateUpdate] = None
    downgrade_notice: str = ""


class ModelProtocolError(RuntimeError):
    pass


class ModelConfigurationError(ModelProtocolError):
    pass


class ProviderCapabilityError(ModelProtocolError):
    pass


class ProviderRequestError(ModelProtocolError):
    pass


class _RetryExhaustedError(RuntimeError):
    pass


def _redact(text: Any, secrets: list[str]) -> str:
    rendered = summary_safe(str(text or ""))
    for secret in secrets:
        if secret:
            rendered = rendered.replace(secret, "***")
    rendered = re.sub(
        r"(?i)(authorization|x-api-key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+",
        r"\1: ***",
        rendered,
    )
    rendered = re.sub(r"\b(sk|key|token)-[A-Za-z0-9._-]{8,}\b", "***", rendered)
    return rendered[:2000]


def _is_tool_rejection(exc: Exception) -> bool:
    text = str(exc).lower()
    tool_signal = any(word in text for word in (
        "tool_choice", "tool call", "tool_call", "tools", "function_call", "function calling"
    ))
    rejection_signal = any(word in text for word in (
        "unsupported", "not support", "not allowed", "unknown parameter", "unrecognized",
        "invalid parameter", "invalid_request", "extra inputs", "not permitted",
    ))
    return tool_signal and rejection_signal


def _is_stale_response_id(exc: Exception) -> bool:
    text = str(exc).lower()
    return "previous_response_id" in text and any(word in text for word in (
        "not found", "invalid", "expired", "unknown", "does not exist",
    ))


def _status_code(exc: Exception) -> Optional[int]:
    value = getattr(exc, "status_code", None)
    if value is None:
        value = getattr(getattr(exc, "response", None), "status_code", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _is_retryable_request_error(exc: Exception) -> bool:
    """Return whether a failed request is safe to retry before output starts."""
    if isinstance(exc, ModelProtocolError):
        return False

    status = _status_code(exc)
    if status is not None:
        return status in (408, 409, 425, 429) or status >= 500

    retryable_names = {
        "APIConnectionError", "APITimeoutError", "ConnectError", "ConnectTimeout",
        "ConnectionClosed", "ConnectionResetError", "InternalServerError",
        "NetworkError", "OverloadedError", "PoolTimeout", "RateLimitError",
        "ReadError", "ReadTimeout", "RemoteProtocolError", "TimeoutException",
        "WriteError", "WriteTimeout",
    }
    current: Optional[BaseException] = exc
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        if isinstance(current, (ConnectionError, TimeoutError)):
            return True
        if current.__class__.__name__ in retryable_names:
            return True
        current = current.__cause__ or current.__context__

    message = str(exc).lower()
    return any(signal in message for signal in (
        "connection error", "connection reset", "connection closed",
        "connection aborted", "server disconnected", "remote protocol error",
        "temporarily unavailable", "timed out", "timeout", "overloaded",
        "rate limit", "too many requests",
    ))


def _strip_tool_history(messages: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for message in messages:
        role = message.get("role")
        if role == "tool":
            continue
        if role == "assistant" and message.get("tool_calls"):
            item = {"role": "assistant", "content": message.get("content") or ""}
            if message.get("reasoning_content"):
                item["reasoning_content"] = message["reasoning_content"]
            cleaned.append(item)
        else:
            cleaned.append(dict(message))
    return cleaned


def _tool_calls_list(calls: dict[Any, dict]) -> list[dict]:
    return [calls[key] for key in sorted(calls, key=lambda item: str(item))]


def _codex_default_headers() -> dict[str, str]:
    system = platform.system() or "Unknown"
    release = platform.release() or "Unknown"
    machine = platform.machine() or "unknown"
    return {
        "User-Agent": (
            f"Codex Desktop/1.0 ({system} {release}; {machine}) "
            "QuickModel (codex_compatible; 1.0)"
        ),
        "originator": "Codex Desktop",
        "Accept": "text/event-stream",
    }


class ModelAdapter:
    def __init__(self, model_config: dict, client: Any = None):
        self.raw_config = normalize_model_config(model_config)
        self.config = ModelRuntimeConfig.from_dict(self.raw_config)
        self._client = client
        self._owns_client = client is None

    def stream_round(
        self,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        thinking: str = "off",
        stop_event: Optional[threading.Event] = None,
        on_text: TextCallback = None,
        on_thinking: TextCallback = None,
        previous_response_id: str = "",
        incremental_messages: Optional[list[dict]] = None,
        tools_required: bool = False,
        max_tokens: Optional[int] = None,
        stateless: bool = False,
    ) -> ModelRoundResult:
        tools = list(tools or [])
        seen: list[str] = []
        try:
            messages = prepare_image_messages(messages, self.raw_config)
            if incremental_messages is not None:
                incremental_messages = prepare_image_messages(incremental_messages, self.raw_config)
            return self._stream_with_retries(
                messages, tools, thinking, stop_event, on_text, on_thinking,
                previous_response_id, incremental_messages, max_tokens, seen, stateless,
            )
        except Exception as exc:
            if tools and not seen and _is_tool_rejection(exc):
                if tools_required:
                    raise ProviderCapabilityError("当前模型端点明确拒绝工具调用，无法完成必须使用工具的任务。")
                try:
                    result = self._stream_with_retries(
                        _strip_tool_history(messages), [], thinking, stop_event, on_text, on_thinking,
                        "", None, max_tokens, seen, stateless,
                    )
                except Exception as retry_exc:
                    if isinstance(retry_exc, ModelProtocolError):
                        raise
                    raise self._request_error(retry_exc) from None
                result.downgrade_notice = "当前模型端点不支持工具，本轮已降级为纯文本回答。"
                return result
            if isinstance(exc, ModelProtocolError):
                raise
            raise self._request_error(exc) from None

    def _stream_with_retries(
        self, messages, tools, thinking, stop_event, on_text, on_thinking,
        previous_response_id, incremental_messages, max_tokens, seen, stateless,
    ) -> ModelRoundResult:
        retry_count = 0
        while True:
            try:
                return self._stream_once(
                    messages, tools, thinking, stop_event, on_text, on_thinking,
                    previous_response_id, incremental_messages, max_tokens, seen, stateless,
                )
            except Exception as exc:
                can_retry = (
                    retry_count < DEFAULT_REQUEST_RETRIES
                    and not seen
                    and _is_retryable_request_error(exc)
                    and not (stop_event is not None and stop_event.is_set())
                )
                if not can_retry:
                    if retry_count and _is_retryable_request_error(exc):
                        raise _RetryExhaustedError(
                            f"{exc}（已自动重试 {retry_count} 次）"
                        ) from exc
                    raise
                self._reset_client_for_retry()
                delay = _RETRY_DELAYS[min(retry_count, len(_RETRY_DELAYS) - 1)]
                retry_count += 1
                if stop_event is not None:
                    if stop_event.wait(delay):
                        raise
                else:
                    time.sleep(delay)

    def _reset_client_for_retry(self) -> None:
        if not self._owns_client or self._client is None:
            return
        close = getattr(self._client, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
        self._client = None

    def complete_text(
        self,
        messages: list[dict],
        system_prompt: str = "",
        max_tokens: Optional[int] = None,
        on_text: TextCallback = None,
        stop_event: Optional[threading.Event] = None,
    ) -> str:
        payload = list(messages)
        if system_prompt:
            payload = [{"role": "system", "content": system_prompt}] + payload
        result = self.stream_round(
            payload, tools=[], stop_event=stop_event, on_text=on_text, max_tokens=max_tokens,
            stateless=True,
        )
        return str(result.assistant_message.get("content") or "")

    def _request_error(self, exc: Exception) -> ProviderRequestError:
        message = _redact(exc, [self.config.api_key])
        endpoint = _safe_url(self.config.base_url)
        prefix = f"{self.config.name or self.config.model} ({self.config.api_protocol})"
        if endpoint:
            prefix += f" @ {endpoint}"
        return ProviderRequestError(f"模型请求失败：{prefix}：{message}")

    def _stream_once(self, *args, **kwargs) -> ModelRoundResult:
        raise NotImplementedError


class OpenAIChatAdapter(ModelAdapter):
    def _get_client(self):
        if self._client is None:
            from openai import OpenAI
            kwargs = {"api_key": self.config.api_key, "max_retries": 0}
            if self.config.base_url:
                kwargs["base_url"] = self.config.base_url
            if self.config.client_profile == "codex":
                kwargs["default_headers"] = _codex_default_headers()
            self._client = OpenAI(**kwargs)
        return self._client

    def _request_options(self, thinking: str) -> dict:
        if thinking == "off":
            return {}
        profile = self.config.provider_profile
        if profile == "generic":
            return {"reasoning_effort": "high"}
        if profile == "deepseek":
            return {
                "reasoning_effort": "high",
                "extra_body": {"thinking": {"type": "enabled"}},
            }
        if profile == "qwen":
            return {"extra_body": {"enable_thinking": True}}
        if profile == "glm":
            return {"extra_body": {"thinking": {"type": "enabled"}}}
        return {}

    def _messages(self, messages: list[dict], thinking: str) -> list[dict]:
        prepared = []
        for message in messages:
            item = dict(message)
            if item.get("role") == "assistant":
                if self.config.provider_profile == "deepseek" and thinking != "off":
                    item["reasoning_content"] = item.get("reasoning_content") or ""
                elif self.config.provider_profile == "deepseek":
                    item.pop("reasoning_content", None)
            prepared.append(item)
        return prepared

    def _stream_once(
        self, messages, tools, thinking, stop_event, on_text, on_thinking,
        previous_response_id, incremental_messages, max_tokens, seen, stateless,
    ) -> ModelRoundResult:
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": self._messages(messages, thinking),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        kwargs.update(self._request_options(thinking))

        content = ""
        reasoning = ""
        usage_obj = None
        calls: dict[int, dict] = {}
        check_request_size(kwargs)
        stream = self._get_client().chat.completions.create(**kwargs)
        try:
            for chunk in stream:
                if stop_event is not None and stop_event.is_set():
                    break
                chunk_usage = _value(chunk, "usage")
                if chunk_usage:
                    usage_obj = chunk_usage
                choices = _value(chunk, "choices", []) or []
                if not choices:
                    continue
                delta = _value(choices[0], "delta")
                if delta is None:
                    continue
                reasoning_delta = _value(delta, "reasoning_content")
                if reasoning_delta:
                    reasoning += str(reasoning_delta)
                    seen.append("reasoning")
                    if on_thinking:
                        on_thinking(str(reasoning_delta))
                text_delta = _value(delta, "content")
                if text_delta:
                    content += str(text_delta)
                    seen.append("text")
                    if on_text:
                        on_text(str(text_delta))
                for tool_call in _value(delta, "tool_calls", []) or []:
                    index = int(_value(tool_call, "index", len(calls)) or 0)
                    current = calls.setdefault(index, {
                        "id": "", "type": "function",
                        "function": {"name": "", "arguments": ""},
                    })
                    call_id = _value(tool_call, "id")
                    if call_id:
                        current["id"] += str(call_id)
                    function = _value(tool_call, "function")
                    if function:
                        name = _value(function, "name")
                        arguments = _value(function, "arguments")
                        if name:
                            current["function"]["name"] += str(name)
                        if arguments:
                            current["function"]["arguments"] += str(arguments)
                    seen.append("tool")
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()

        normalized_calls = _tool_calls_list(calls)
        assistant = {"role": "assistant", "content": content}
        if reasoning:
            assistant["reasoning_content"] = reasoning
        if normalized_calls:
            assistant["tool_calls"] = normalized_calls
        usage = self._normalize_usage(usage_obj, messages, assistant)
        return ModelRoundResult(assistant, normalized_calls, usage)

    @staticmethod
    def _normalize_usage(usage_obj: Any, messages: list[dict], assistant: dict) -> NormalizedUsage:
        if usage_obj:
            prompt = _usage_value(usage_obj, "prompt_tokens", "input_tokens", "promptTokens")
            completion = _usage_value(usage_obj, "completion_tokens", "output_tokens", "completionTokens")
            cache_hit = _usage_value(
                usage_obj, "prompt_cache_hit_tokens", "cache_hit_tokens", "promptCacheHitTokens"
            )
            cache_miss = _usage_value(
                usage_obj, "prompt_cache_miss_tokens", "cache_miss_tokens", "promptCacheMissTokens"
            )
            total = _usage_value(usage_obj, "total_tokens", "totalTokens")
            if prompt <= 0 and completion <= 0 and total > 0:
                prompt = total
            if prompt > 0 or completion > 0:
                return NormalizedUsage(prompt, completion, cache_hit, cache_miss, False)
        return NormalizedUsage(
            _estimate_tokens(messages), _estimate_tokens(assistant), 0, 0, True
        )


def _responses_tools(tools: list[dict]) -> list[dict]:
    converted = []
    for tool in tools:
        function = tool.get("function", {})
        item = {
            "type": "function",
            "name": function.get("name", ""),
            "description": function.get("description", ""),
            "parameters": function.get("parameters") or {"type": "object", "properties": {}},
        }
        if "strict" in function:
            item["strict"] = function["strict"]
        converted.append(item)
    return converted


def _responses_input(messages: list[dict]) -> tuple[str, list[dict]]:
    instructions = "\n\n".join(
        str(message.get("content") or "") for message in messages if message.get("role") == "system"
    )
    items: list[dict] = []
    for message in messages:
        role = message.get("role")
        if role == "system":
            continue
        if role in ("user", "assistant"):
            content = message.get("content")
            if content:
                items.append({"role": role, "content": convert_content(content, "openai_responses")})
            if role == "assistant":
                for call in message.get("tool_calls") or []:
                    function = call.get("function", {})
                    items.append({
                        "type": "function_call",
                        "call_id": call.get("id", ""),
                        "name": function.get("name", ""),
                        "arguments": function.get("arguments", "{}"),
                    })
        elif role == "tool":
            items.append({
                "type": "function_call_output",
                "call_id": message.get("tool_call_id", ""),
                "output": str(message.get("content") or ""),
            })
    return instructions, items


class OpenAIResponsesAdapter(ModelAdapter):
    def _get_client(self):
        if self._client is None:
            from openai import OpenAI
            kwargs = {"api_key": self.config.api_key, "max_retries": 0}
            if self.config.base_url:
                kwargs["base_url"] = self.config.base_url
            if self.config.client_profile == "codex":
                kwargs["default_headers"] = _codex_default_headers()
            self._client = OpenAI(**kwargs)
        return self._client

    def _stream_once(
        self, messages, tools, thinking, stop_event, on_text, on_thinking,
        previous_response_id, incremental_messages, max_tokens, seen, stateless,
    ) -> ModelRoundResult:
        active_messages = incremental_messages if previous_response_id and incremental_messages is not None else messages
        instructions, _ = _responses_input(messages)
        _, input_items = _responses_input(active_messages)
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "input": input_items,
            "stream": True,
            "store": self.config.responses_server_state and not stateless,
        }
        if instructions:
            kwargs["instructions"] = instructions
        if tools:
            kwargs["tools"] = _responses_tools(tools)
            kwargs["tool_choice"] = "auto"
        if thinking != "off":
            kwargs["reasoning"] = {"effort": "high"}
        if max_tokens is not None:
            kwargs["max_output_tokens"] = max_tokens
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id

        try:
            return self._consume_stream(
                kwargs, messages, stop_event, on_text, on_thinking, seen, stateless=stateless
            )
        except Exception as exc:
            if previous_response_id and not seen and _is_stale_response_id(exc):
                instructions, input_items = _responses_input(messages)
                kwargs["input"] = input_items
                if instructions:
                    kwargs["instructions"] = instructions
                else:
                    kwargs.pop("instructions", None)
                kwargs.pop("previous_response_id", None)
                return self._consume_stream(
                    kwargs, messages, stop_event, on_text, on_thinking, seen,
                    stateless=stateless, state_was_stale=True,
                )
            raise

    def _consume_stream(
        self, kwargs, full_messages, stop_event, on_text, on_thinking, seen,
        stateless: bool = False,
        state_was_stale: bool = False,
    ) -> ModelRoundResult:
        content = ""
        reasoning = ""
        usage_obj = None
        response_id = ""
        calls: dict[Any, dict] = {}
        check_request_size(kwargs)
        stream = self._get_client().responses.create(**kwargs)
        try:
            for event in stream:
                if stop_event is not None and stop_event.is_set():
                    break
                event_type = str(_value(event, "type", "") or "")
                if event_type == "response.output_text.delta":
                    delta = str(_value(event, "delta", "") or "")
                    if delta:
                        content += delta
                        seen.append("text")
                        if on_text:
                            on_text(delta)
                elif "reasoning" in event_type and event_type.endswith(".delta"):
                    delta = str(_value(event, "delta", "") or "")
                    if delta:
                        reasoning += delta
                        seen.append("reasoning")
                        if on_thinking:
                            on_thinking(delta)
                elif event_type == "response.output_item.added":
                    item = _value(event, "item")
                    if _value(item, "type") == "function_call":
                        key = _value(event, "output_index", _value(item, "id", len(calls)))
                        calls[key] = {
                            "id": str(_value(item, "call_id", _value(item, "id", "")) or ""),
                            "type": "function",
                            "function": {
                                "name": str(_value(item, "name", "") or ""),
                                "arguments": str(_value(item, "arguments", "") or ""),
                            },
                        }
                        seen.append("tool")
                elif event_type == "response.function_call_arguments.delta":
                    key = _value(event, "output_index", _value(event, "item_id", len(calls)))
                    current = calls.setdefault(key, {
                        "id": str(_value(event, "call_id", _value(event, "item_id", "")) or ""),
                        "type": "function",
                        "function": {"name": str(_value(event, "name", "") or ""), "arguments": ""},
                    })
                    current["function"]["arguments"] += str(_value(event, "delta", "") or "")
                    seen.append("tool")
                elif event_type == "response.function_call_arguments.done":
                    key = _value(event, "output_index", _value(event, "item_id", len(calls)))
                    current = calls.setdefault(key, {
                        "id": str(_value(event, "call_id", _value(event, "item_id", "")) or ""),
                        "type": "function",
                        "function": {"name": "", "arguments": ""},
                    })
                    if _value(event, "name"):
                        current["function"]["name"] = str(_value(event, "name"))
                    if _value(event, "arguments") is not None:
                        current["function"]["arguments"] = str(_value(event, "arguments"))
                    seen.append("tool")
                elif event_type == "response.completed":
                    response = _value(event, "response")
                    response_id = str(_value(response, "id", "") or "")
                    usage_obj = _value(response, "usage")
                    self._merge_completed_calls(calls, _value(response, "output", []) or [])
                elif event_type in ("error", "response.failed"):
                    error = _value(event, "error", _value(_value(event, "response"), "error", "request failed"))
                    raise RuntimeError(str(error))
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()

        normalized_calls = _tool_calls_list(calls)
        assistant = {"role": "assistant", "content": content}
        if reasoning:
            assistant["reasoning_content"] = reasoning
        if normalized_calls:
            assistant["tool_calls"] = normalized_calls
        usage = NormalizedUsage(
            _usage_value(usage_obj, "input_tokens", "prompt_tokens"),
            _usage_value(usage_obj, "output_tokens", "completion_tokens"),
            _usage_value(_value(usage_obj, "input_tokens_details", {}), "cached_tokens"),
            0,
            False,
        )
        if usage.prompt_tokens <= 0 and usage.completion_tokens <= 0:
            usage = NormalizedUsage(
                _estimate_tokens(full_messages), _estimate_tokens(assistant), 0, 0, True
            )
        state = None
        if self.config.responses_server_state and not stateless and response_id:
            state = ProviderStateUpdate(
                response_id=response_id,
                config_fingerprint=model_config_fingerprint(self.raw_config),
                updated_at=datetime.now().isoformat(),
            )
        elif state_was_stale:
            state = ProviderStateUpdate(invalidated=True)
        return ModelRoundResult(assistant, normalized_calls, usage, state)

    @staticmethod
    def _merge_completed_calls(calls: dict[Any, dict], output: list[Any]) -> None:
        for index, item in enumerate(output):
            if _value(item, "type") != "function_call":
                continue
            key = index
            existing_key = next((
                candidate for candidate, call in calls.items()
                if call.get("id") == str(_value(item, "call_id", "") or "")
            ), key)
            calls[existing_key] = {
                "id": str(_value(item, "call_id", _value(item, "id", "")) or ""),
                "type": "function",
                "function": {
                    "name": str(_value(item, "name", "") or ""),
                    "arguments": str(_value(item, "arguments", "{}") or "{}"),
                },
            }


def _anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system = "\n\n".join(
        str(message.get("content") or "") for message in messages if message.get("role") == "system"
    )
    converted: list[dict] = []

    def append(role: str, blocks: list[dict]) -> None:
        if not blocks:
            return
        if converted and converted[-1]["role"] == role:
            previous = converted[-1]["content"]
            if isinstance(previous, str):
                previous = [{"type": "text", "text": previous}]
                converted[-1]["content"] = previous
            previous.extend(blocks)
        else:
            converted.append({"role": role, "content": blocks})

    for message in messages:
        role = message.get("role")
        if role == "system":
            continue
        if role == "user":
            content = convert_content(message.get("content"), "anthropic_messages")
            append("user", content if isinstance(content, list) else [{"type": "text", "text": content}])
        elif role == "assistant":
            blocks = []
            if message.get("content"):
                blocks.append({"type": "text", "text": str(message["content"])})
            for call in message.get("tool_calls") or []:
                function = call.get("function", {})
                try:
                    arguments = json.loads(function.get("arguments") or "{}")
                except (TypeError, json.JSONDecodeError):
                    arguments = {}
                blocks.append({
                    "type": "tool_use",
                    "id": call.get("id", ""),
                    "name": function.get("name", ""),
                    "input": arguments,
                })
            append("assistant", blocks)
        elif role == "tool":
            append("user", [{
                "type": "tool_result",
                "tool_use_id": message.get("tool_call_id", ""),
                "content": str(message.get("content") or ""),
            }])
    return system, converted


def _anthropic_tools(tools: list[dict]) -> list[dict]:
    converted = []
    for tool in tools:
        function = tool.get("function", {})
        converted.append({
            "name": function.get("name", ""),
            "description": function.get("description", ""),
            "input_schema": function.get("parameters") or {"type": "object", "properties": {}},
        })
    return converted


class AnthropicMessagesAdapter(ModelAdapter):
    def _get_client(self):
        if self._client is None:
            from anthropic import Anthropic
            kwargs: dict[str, Any] = {"max_retries": 0}
            if self.config.auth_mode == "auth_token":
                kwargs["auth_token"] = self.config.api_key
            else:
                kwargs["api_key"] = self.config.api_key
            if self.config.base_url:
                kwargs["base_url"] = self.config.base_url
            self._client = Anthropic(**kwargs)
        return self._client

    def _stream_once(
        self, messages, tools, thinking, stop_event, on_text, on_thinking,
        previous_response_id, incremental_messages, max_tokens, seen, stateless,
    ) -> ModelRoundResult:
        system, payload = _anthropic_messages(messages)
        token_limit = max_tokens or 8192
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": payload,
            "max_tokens": token_limit,
            "stream": True,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = _anthropic_tools(tools)
            kwargs["tool_choice"] = {"type": "auto"}
        if thinking != "off":
            budget = 32000 if thinking == "max" else 8000
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
            kwargs["max_tokens"] = max(token_limit, budget + 1024)

        content = ""
        reasoning = ""
        usage_start = None
        usage_end = None
        calls: dict[int, dict] = {}
        check_request_size(kwargs)
        stream = self._get_client().messages.create(**kwargs)
        try:
            for event in stream:
                if stop_event is not None and stop_event.is_set():
                    break
                event_type = str(_value(event, "type", "") or "")
                if event_type == "message_start":
                    usage_start = _value(_value(event, "message"), "usage")
                elif event_type == "content_block_start":
                    index = int(_value(event, "index", len(calls)) or 0)
                    block = _value(event, "content_block")
                    if _value(block, "type") == "tool_use":
                        initial = _value(block, "input", {}) or {}
                        calls[index] = {
                            "id": str(_value(block, "id", "") or ""),
                            "type": "function",
                            "function": {
                                "name": str(_value(block, "name", "") or ""),
                                "arguments": "" if not initial else json.dumps(initial, ensure_ascii=False),
                            },
                        }
                        seen.append("tool")
                elif event_type == "content_block_delta":
                    index = int(_value(event, "index", 0) or 0)
                    delta = _value(event, "delta")
                    delta_type = str(_value(delta, "type", "") or "")
                    if delta_type == "text_delta":
                        text = str(_value(delta, "text", "") or "")
                        if text:
                            content += text
                            seen.append("text")
                            if on_text:
                                on_text(text)
                    elif delta_type == "thinking_delta":
                        text = str(_value(delta, "thinking", "") or "")
                        if text:
                            reasoning += text
                            seen.append("reasoning")
                            if on_thinking:
                                on_thinking(text)
                    elif delta_type == "input_json_delta":
                        current = calls.setdefault(index, {
                            "id": "", "type": "function",
                            "function": {"name": "", "arguments": ""},
                        })
                        current["function"]["arguments"] += str(_value(delta, "partial_json", "") or "")
                        seen.append("tool")
                elif event_type == "message_delta":
                    usage_end = _value(event, "usage")
                elif event_type == "error":
                    raise RuntimeError(str(_value(event, "error", "request failed")))
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()

        normalized_calls = _tool_calls_list(calls)
        for call in normalized_calls:
            if not call["function"]["arguments"]:
                call["function"]["arguments"] = "{}"
        assistant = {"role": "assistant", "content": content}
        if reasoning:
            assistant["reasoning_content"] = reasoning
        if normalized_calls:
            assistant["tool_calls"] = normalized_calls
        prompt_tokens = _usage_value(usage_start, "input_tokens")
        completion_tokens = _usage_value(usage_end, "output_tokens") or _usage_value(
            usage_start, "output_tokens"
        )
        cache_hit = _usage_value(usage_start, "cache_read_input_tokens")
        cache_miss = _usage_value(usage_start, "cache_creation_input_tokens")
        estimated = prompt_tokens <= 0 and completion_tokens <= 0
        if estimated:
            prompt_tokens = _estimate_tokens(messages)
            completion_tokens = _estimate_tokens(assistant)
        usage = NormalizedUsage(
            prompt_tokens, completion_tokens, cache_hit, cache_miss, estimated
        )
        return ModelRoundResult(assistant, normalized_calls, usage)


def create_model_adapter(model_config: dict, client: Any = None) -> ModelAdapter:
    protocol = normalize_model_config(model_config)["api_protocol"]
    if protocol == "openai_chat":
        return OpenAIChatAdapter(model_config, client)
    if protocol == "openai_responses":
        return OpenAIResponsesAdapter(model_config, client)
    if protocol == "anthropic_messages":
        return AnthropicMessagesAdapter(model_config, client)
    raise ModelConfigurationError(f"不支持的模型协议：{protocol}")


def list_model_ids(model_config: dict) -> list[str]:
    """List models through the same normalized OpenAI client used for chat."""
    adapter = create_model_adapter(model_config)
    if isinstance(adapter, AnthropicMessagesAdapter):
        raise ProviderCapabilityError("Anthropic Messages 暂不提供统一的模型列表接口")
    if not adapter.config.api_key:
        raise ModelConfigurationError("请先填写 API Key")
    try:
        page = adapter._get_client().models.list()
        items = _value(page, "data", []) or []
        return sorted({
            str(_value(item, "id", "") or "").strip()
            for item in items
            if str(_value(item, "id", "") or "").strip()
        })
    except Exception as exc:
        raise adapter._request_error(exc) from exc


def complete_text(
    model_config: dict,
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: Optional[int] = None,
    on_text: TextCallback = None,
    stop_event: Optional[threading.Event] = None,
) -> str:
    return create_model_adapter(model_config).complete_text(
        messages, system_prompt=system_prompt, max_tokens=max_tokens,
        on_text=on_text, stop_event=stop_event,
    )
