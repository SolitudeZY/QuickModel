import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.agent import Agent
from app.model_protocol import ModelRoundResult, NormalizedUsage, ProviderStateUpdate


def model_config(protocol):
    return {
        "name": protocol,
        "api_key": "test-key",
        "base_url": "https://provider.example/v1",
        "model": "test-model",
        "api_protocol": protocol,
        "provider_profile": "generic",
        "auth_mode": "api_key",
        "responses_server_state": protocol == "openai_responses",
    }


class FakeAdapter:
    def __init__(self, protocol, stateful=False, notice=""):
        self.config = type("Config", (), {"base_url": "https://provider.example/v1"})()
        self.protocol = protocol
        self.stateful = stateful
        self.notice = notice
        self.calls = []

    def stream_round(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        if len(self.calls) == 1:
            state = None
            if self.stateful:
                state = ProviderStateUpdate("resp_tool", "sha256:test", "now")
            return ModelRoundResult(
                assistant_message={
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "skill_list", "arguments": "{}"},
                    }],
                },
                tool_calls=[{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "skill_list", "arguments": "{}"},
                }],
                usage=NormalizedUsage(10, 2),
                provider_state_update=state,
                downgrade_notice=self.notice,
            )
        state = None
        if self.stateful:
            state = ProviderStateUpdate("resp_final", "sha256:test", "later")
        return ModelRoundResult(
            assistant_message={"role": "assistant", "content": "done"},
            usage=NormalizedUsage(5, 1),
            provider_state_update=state,
        )


class AgentProtocolTests(unittest.TestCase):
    def _run_agent(self, protocol, adapter, provider_state=None):
        cfg = model_config(protocol)
        if adapter.stateful:
            with patch("app.agent.model_config_fingerprint", return_value="sha256:test"):
                with patch("app.agent.create_model_adapter", return_value=adapter):
                    agent = Agent(
                        api_key="test-key", base_url=cfg["base_url"], model=cfg["model"],
                        model_config=cfg, provider_state=provider_state,
                    )
        else:
            with patch("app.agent.create_model_adapter", return_value=adapter):
                agent = Agent(
                    api_key="test-key", base_url=cfg["base_url"], model=cfg["model"],
                    model_config=cfg, provider_state=provider_state,
                )
        completed, errors, notices, usage = [], [], [], []
        agent.run(
            messages=[{"role": "user", "content": "Use a harmless tool"}],
            on_token=lambda *_: None,
            on_tool_start=lambda *_: None,
            on_tool_result=lambda *_: None,
            on_confirm=lambda *_: True,
            on_done=completed.append,
            on_error=lambda error, messages: errors.append((error, messages)),
            on_usage=usage.append,
            on_notice=notices.append,
        )
        self.assertFalse(errors)
        self.assertEqual(completed[0][-1]["content"], "done")
        self.assertEqual(completed[0][-2]["role"], "tool")
        return agent, completed[0], notices, usage

    def test_main_react_loop_uses_adapter_for_all_protocols(self):
        for protocol in ("openai_chat", "openai_responses", "anthropic_messages"):
            with self.subTest(protocol=protocol):
                adapter = FakeAdapter(protocol)
                _, messages, _, usage = self._run_agent(protocol, adapter)
                self.assertEqual(len(adapter.calls), 2)
                self.assertTrue(adapter.calls[0][1]["tools"])
                self.assertEqual(messages[-3]["tool_calls"][0]["function"]["name"], "skill_list")
                self.assertEqual(usage[-1]["session"]["prompt_tokens"], 15)

    def test_notice_is_visible_and_not_written_to_history(self):
        adapter = FakeAdapter("openai_chat", notice="text-only downgrade")
        _, messages, notices, _ = self._run_agent("openai_chat", adapter)
        self.assertEqual(notices, ["text-only downgrade"])
        self.assertNotIn("text-only downgrade", str(messages))

    def test_responses_state_advances_and_second_round_sends_tool_suffix(self):
        adapter = FakeAdapter("openai_responses", stateful=True)
        agent, _, _, _ = self._run_agent("openai_responses", adapter)
        self.assertEqual(agent.provider_state["response_id"], "resp_final")
        second_kwargs = adapter.calls[1][1]
        self.assertEqual(second_kwargs["previous_response_id"], "resp_tool")
        self.assertEqual(len(second_kwargs["incremental_messages"]), 1)
        self.assertEqual(second_kwargs["incremental_messages"][0]["role"], "tool")

    def test_failed_manual_compact_preserves_all_messages(self):
        agent = object.__new__(Agent)
        agent.model_config = model_config("openai_chat")
        agent._model_configs = []
        agent.compact_threshold = 100
        agent._stop_flag = threading.Event()
        agent._rounds_without_todo = 0
        agent._todo = SimpleNamespace(has_open_items=lambda: False)
        callback = SimpleNamespace(
            on_tool_start=lambda *_: None,
            on_tool_result=lambda *_: None,
            on_notice=lambda *_: None,
            on_todo_update=None,
        )
        messages = [{"role": "user", "content": "important history"}]

        def failed_compact(original, *args, **kwargs):
            kwargs["on_status"]("failed", "timeout")
            return original

        with patch("app.agent.auto_compact", side_effect=failed_compact):
            agent._execute_tools([{
                "id": "compact-1",
                "function": {"name": "compact", "arguments": "{}"},
            }], messages, callback, 0, 5, None)

        self.assertEqual(messages[0]["content"], "important history")
        self.assertEqual(len(messages), 2)

    def test_compact_command_never_requests_main_model_round(self):
        agent = object.__new__(Agent)
        agent.model_config = model_config("openai_chat")
        agent._model_configs = []
        agent._stop_flag = threading.Event()
        agent._subagent_results = {}
        agent.system_prompt = "system"
        agent.compact_threshold = 100
        done, errors = [], []
        messages = [{"role": "user", "content": "history"}]
        with patch("app.agent.auto_compact", side_effect=lambda msgs, *a, **kw: msgs) as compact, \
                patch.object(agent, "_stream_and_parse") as stream:
            agent.run(messages, lambda *_: None, lambda *_: None,
                      lambda *_: None, lambda *_: True, done.append,
                      lambda *args: errors.append(args), compact_only=True)
        compact.assert_called_once()
        stream.assert_not_called()
        self.assertEqual(done, [messages])
        self.assertEqual(errors, [])

    def test_failed_auto_compact_is_not_retried_in_same_run(self):
        agent = object.__new__(Agent)
        agent.model_config = model_config("openai_chat")
        agent._model_configs = []
        agent._stop_flag = threading.Event()
        agent._auto_compact_attempted = False
        callback = SimpleNamespace(
            on_notice=lambda *_: None,
            on_context_update=lambda *_: None,
        )
        messages = [{"role": "user", "content": "x" * 1000}]

        def failed_compact(original, *args, **kwargs):
            kwargs["on_status"]("failed", "timeout")
            return original

        with patch("app.agent.auto_compact", side_effect=failed_compact) as compact:
            agent._manage_context(messages, 10, callback)
            agent._manage_context(messages, 10, callback)

        compact.assert_called_once()

    def test_failed_compaction_blocks_model_request_and_preserves_history(self):
        agent = object.__new__(Agent)
        agent.model_config = model_config("openai_chat")
        agent._model_configs = []
        agent._stop_flag = threading.Event()
        agent._subagent_results = {}
        agent.system_prompt = "system"
        agent.compact_threshold = 10
        agent.context_length = 1000
        agent.max_rounds = 2
        done, errors = [], []
        messages = [{"role": "user", "content": "x" * 1000}]
        with patch("app.agent.auto_compact", side_effect=lambda msgs, *a, **kw: msgs), \
                patch.object(agent, "_inject_context", side_effect=lambda msgs: msgs), \
                patch.object(agent, "_stream_and_parse") as stream:
            agent.run(messages, lambda *_: None, lambda *_: None,
                      lambda *_: None, lambda *_: True, done.append,
                      lambda *args: errors.append(args))
        stream.assert_not_called()
        self.assertEqual(done, [])
        self.assertEqual(errors[0][1], messages)
        self.assertIn("未发送超长请求", errors[0][0])

    def test_successful_compaction_rearms_and_clears_server_state(self):
        agent = object.__new__(Agent)
        agent.model_config = model_config("openai_chat")
        agent._model_configs = []
        agent._stop_flag = threading.Event()
        agent._auto_compact_attempted = False
        agent.provider_state = {"response_id": "old"}
        callback = SimpleNamespace(on_notice=None, on_context_update=None)
        messages = [{"role": "user", "content": "x" * 1000}]
        with patch("app.agent.auto_compact", side_effect=lambda *a, **kw: [{"role": "user", "content": "short"}]) as compact:
            agent._manage_context(messages, 100, callback)
            agent._manage_context(messages, 100, callback)
        self.assertEqual(compact.call_count, 2)
        self.assertEqual(agent.provider_state, {})


if __name__ == "__main__":
    unittest.main()
