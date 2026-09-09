import unittest
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RENDER = (ROOT / "app" / "static" / "render.js").read_text(encoding="utf-8-sig")
INDEX = (ROOT / "app" / "static" / "index.html").read_text(encoding="utf-8-sig")


class FrontendCodeFeatureTests(unittest.TestCase):
    def test_mermaid_vendor_and_renderer_are_wired(self):
        self.assertIn('vendor/mermaid.min.js', INDEX)
        self.assertIn("String(lang).toLowerCase() === 'mermaid'", RENDER)
        self.assertIn('data-mermaid-action="download-svg"', RENDER)
        self.assertIn('hydrateMermaid', RENDER)

    def test_browser_clipboard_interactions(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Browser regression requires Node.js and Playwright")
        probe = subprocess.run(
            [node, "-e", "require.resolve('playwright')"], cwd=ROOT,
            capture_output=True, timeout=15,
        )
        if probe.returncode:
            self.skipTest("Set NODE_PATH to a Node installation with Playwright")
        result = subprocess.run(
            [node, str(ROOT / "tests" / "frontend_clipboard.cjs")], cwd=ROOT,
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
