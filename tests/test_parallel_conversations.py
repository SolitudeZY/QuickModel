import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.conversation import new_conversation, save_conversation, load_conversation
from app.webview_app import API


class ParallelConversationsTests(unittest.TestCase):
    def test_overlapping_runs_stop_and_callbacks_are_isolated(self):
        agents = []

        class Agent:
            def __init__(self, **kwargs):
                self.entered = threading.Event()
                self.release = threading.Event()
                self.finished = threading.Event()
                self.stopped = False
                self.provider_state = {}
                agents.append(self)

            def run(self, messages, **callbacks):
                self.entered.set()
                self.release.wait(5)
                try:
                    callbacks['on_token'](messages[-1]['content'])
                    callbacks['on_done'](messages + [{'role': 'assistant', 'content': 'done'}])
                finally:
                    self.finished.set()

            def stop(self):
                self.stopped = True
                self.release.set()

        def managers(api):
            api._todo, api._tasks, api._bg = object(), object(), object()

        with tempfile.TemporaryDirectory() as folder, \
                patch('app.conversation.get_conversations_dir', return_value=Path(folder)), \
                patch('app.webview_app.load_config', return_value={}), \
                patch('app.webview_app.get_active_model_config', return_value={'model': 'test'}), \
                patch('app.webview_app._lazy_agent', return_value=SimpleNamespace(Agent=Agent, AUTO_COMPACT_THRESHOLD=80000)), \
                patch.object(API, '_ensure_managers', managers), \
                patch.object(API, '_notify_system'):
            api = API()
            api._window = Mock()
            convs = [new_conversation('test') for _ in range(2)]
            for conv in convs:
                conv.update(title='Manual', title_source='manual')
                save_conversation(conv)
            a, b = [conv['id'] for conv in convs]
            try:
                self.assertTrue(api.send_message(a, 'alpha', [])['ok'])
                self.assertTrue(api.send_message(b, 'beta', [])['ok'])
                self.assertTrue(all(agent.entered.wait(2) for agent in agents))
                self.assertFalse(api.send_message(a, 'duplicate', [])['ok'])
                self.assertEqual(len(agents), 2)
                self.assertFalse(api.bulk_delete_conversations([a])['ok'])
                self.assertFalse(api.bulk_archive_conversations([b])['ok'])
                self.assertIsNot(api._sessions[a]._todo, api._sessions[b]._todo)
                api.confirm_tool(True, b)
                self.assertTrue(api._sessions[b]._confirm_event.is_set())
                self.assertFalse(api._sessions[a]._confirm_event.is_set())
                api.stop_generation(a)
                self.assertTrue(agents[0].finished.wait(2))
                self.assertTrue(agents[0].stopped)
                self.assertFalse(agents[1].stopped)
                self.assertTrue(api._conversation_running(b))
                agents[1].release.set()
                self.assertTrue(agents[1].finished.wait(2))
                for cid, text in [(a, 'alpha'), (b, 'beta')]:
                    self.assertEqual(load_conversation(cid)['messages'][0]['content'], text)
                    scripts = [call.args[0] for call in api._window.evaluate_js.call_args_list]
                    self.assertTrue(any(cid in code and f'Chat.appendToken("{text}")' in code for code in scripts))
            finally:
                for agent in agents:
                    agent.release.set()
                    agent.finished.wait(2)


if __name__ == '__main__':
    unittest.main()
