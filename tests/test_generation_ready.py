"""Queue handoff must wait for the actual worker, including its final writes."""
import tempfile
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.conversation import new_conversation, save_conversation, load_conversation
from app.webview_app import API


class GenerationReadyTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        folder = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch('app.conversation.get_conversations_dir', return_value=Path(folder)))
        self.stack.enter_context(patch('app.webview_app.load_config', return_value={}))
        self.stack.enter_context(patch('app.webview_app.get_active_model_config', return_value={'model': 'test'}))
        self.stack.enter_context(patch.object(API, '_ensure_managers'))
        self.stack.enter_context(patch.object(API, '_notify_system'))
        self.api = API()
        self.ready = threading.Event()
        self.scripts = []

        def script(code):
            self.scripts.append(code)
            if 'Chat.generationReady(' in code:
                self.ready.set()

        self.api._window = SimpleNamespace(evaluate_js=script)
        self.conv = new_conversation('test')
        self.conv.update(title='Manual', title_source='manual')
        save_conversation(self.conv)
        self.cid = self.conv['id']

    def test_done_does_not_release_session_before_worker_cleanup(self):
        done = threading.Event()
        release = threading.Event()

        class Agent:
            provider_state = {}

            def __init__(self, **kwargs):
                pass

            def run(self, messages, **callbacks):
                callbacks['on_done'](messages + [{'role': 'assistant', 'content': 'saved'}])
                done.set()
                release.wait(5)

            def stop(self):
                release.set()

        self.stack.enter_context(patch('app.webview_app._lazy_agent', return_value=SimpleNamespace(
            Agent=Agent, AUTO_COMPACT_THRESHOLD=80000)))
        try:
            self.assertTrue(self.api.send_message(self.cid, 'first', [])['ok'])
            self.assertTrue(done.wait(2))
            self.assertFalse(self.ready.is_set())
            self.assertFalse(self.api.send_message(self.cid, 'too early', [])['ok'])
            self.assertFalse(self.api.bulk_delete_conversations([self.cid])['ok'])
            release.set()
            self.assertTrue(self.ready.wait(2))
            self.assertEqual(sum('Chat.generationReady(' in s for s in self.scripts), 1)
            self.ready.clear()
            self.assertTrue(self.api.send_message(self.cid, 'next', [])['ok'])
            self.assertTrue(self.ready.wait(2))
            self.assertEqual([m['content'] for m in load_conversation(self.cid)['messages']
                              if m['role'] == 'user'], ['first', 'next'])
        finally:
            release.set()

    def test_failed_setup_releases_once_and_reports_failure(self):
        with patch('app.webview_app.get_active_model_config', return_value=None):
            self.api.send_message(self.cid, 'first', [])
        self.assertTrue(self.ready.wait(2))
        ready = [s for s in self.scripts if 'Chat.generationReady(' in s]
        self.assertEqual(len(ready), 1)
        self.assertIn(', true)', ready[0])
        self.assertFalse(self.api._conversation_running(self.cid))

    def test_stop_during_dispatch_reaches_new_agent(self):
        stopped_at_start = []
        api, cid = self.api, self.cid

        class Agent:
            provider_state = {}

            def __init__(self, **kwargs):
                self.stopped = False
                api.stop_generation(cid)

            def stop(self):
                self.stopped = True

            def run(self, messages, **callbacks):
                stopped_at_start.append((self.stopped, callbacks['preserve_stop']))
                callbacks['on_done'](messages)

        self.stack.enter_context(patch('app.webview_app._lazy_agent', return_value=SimpleNamespace(
            Agent=Agent, AUTO_COMPACT_THRESHOLD=80000)))
        self.api.send_message(cid, 'first', [])
        self.assertTrue(self.ready.wait(2))
        self.assertEqual(stopped_at_start, [(True, True)])


if __name__ == '__main__':
    unittest.main()
