import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from app.updater import _windows_update_script, launch_windows_update
from app.webview_app import API


class UpdaterTests(unittest.TestCase):
    def test_launcher_preserves_install_directory_and_hides_helper(self):
        with tempfile.TemporaryDirectory(prefix="qm update's ") as folder:
            root = Path(folder)
            setup = root / 'setup.exe'
            setup.write_bytes(b'installer fixture')
            exe = root / 'custom install' / 'QuickModel.exe'
            captured = []

            def launch(args, **kwargs):
                captured.append((args, kwargs))
                script = Path(args[-1])
                script.with_suffix('.ready').write_text('ready')
                return Mock(pid=123)

            with patch('app.updater.subprocess.Popen', side_effect=launch):
                self.assertEqual(launch_windows_update(setup, exe, os.getpid(), root), 123)
            args, kwargs = captured[0]
            script = Path(args[-1]).read_text(encoding='utf-8-sig')
            self.assertIn('/DIR=' + str(exe.parent).replace("'", "''"), script)
            self.assertIn('/LOG=', script)
            self.assertNotIn('-WindowStyle', args)
            self.assertTrue(kwargs['creationflags'] & 0x08000000)

    def test_helper_is_ready_before_window_is_destroyed(self):
        api = API.__new__(API)
        api._window = Mock()
        calls = []
        api._window.destroy.side_effect = lambda: calls.append('close')
        with tempfile.TemporaryDirectory() as folder, \
                patch('tempfile.gettempdir', return_value=folder), \
                patch('app.webview_app.IS_WIN', True), \
                patch.object(sys, 'frozen', True, create=True), \
                patch('app.updater.launch_windows_update', side_effect=lambda *args: calls.append('ready') or 123):
            self.assertTrue(api.apply_update_and_restart('setup.exe')['ok'])
        self.assertEqual(calls, ['ready', 'close'])

    def test_failed_handoff_keeps_app_open(self):
        api = API.__new__(API)
        api._window = Mock()
        with tempfile.TemporaryDirectory() as folder, \
                patch('tempfile.gettempdir', return_value=folder), \
                patch('app.webview_app.IS_WIN', True), \
                patch.object(sys, 'frozen', True, create=True), \
                patch('app.updater.launch_windows_update', side_effect=OSError('launch failed')):
            self.assertIn('launch failed', api.apply_update_and_restart('setup.exe')['error'])
        api._window.destroy.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows handoff integration')
    def test_detached_helper_waits_for_parent_then_runs_installer(self):
        with tempfile.TemporaryDirectory(prefix="qm update's ") as folder:
            folder = Path(folder)
            ready, log = folder / 'ready', folder / 'update.log'
            parent = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            helper = None
            try:
                script = folder / 'handoff.ps1'
                script.write_text(_windows_update_script(
                    Path(os.environ['SystemRoot']) / 'System32/cmd.exe', '/d /c exit 0',
                    parent.pid, ready, log), encoding='utf-8-sig')
                helper = subprocess.Popen([
                    'powershell.exe', '-NoProfile', '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass', '-File', str(script),
                ], creationflags=0x08000000 | 0x00000200)
                deadline = time.monotonic() + 15
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(ready.exists())
                self.assertNotIn('Starting installer', log.read_text(encoding='utf-8-sig'))
                parent.terminate()
                parent.wait(timeout=5)
                self.assertEqual(helper.wait(timeout=15), 0)
                self.assertIn('Installer exit code: 0', log.read_text(encoding='utf-8-sig'))
            finally:
                if parent.poll() is None:
                    parent.terminate()
                parent.wait(timeout=5)
                if helper and helper.poll() is None:
                    helper.terminate()
                    helper.wait(timeout=5)
