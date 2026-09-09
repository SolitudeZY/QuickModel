import unittest
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

    def test_code_copy_exposes_markdown_and_word_formats(self):
        self.assertIn("'text/markdown'", RENDER)
        self.assertIn("'text/html'", RENDER)
        self.assertIn("event.clipboardData.setData('text/markdown'", RENDER)
        self.assertIn("event.clipboardData.setData('text/html'", RENDER)

    def test_copy_selection_stays_inside_code_body(self):
        self.assertIn("selection.anchorNode?.parentElement?.closest('pre code')", RENDER)
        self.assertIn("selection.focusNode?.parentElement?.closest('pre code')", RENDER)


if __name__ == "__main__":
    unittest.main()
