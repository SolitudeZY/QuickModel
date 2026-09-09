import re
import unittest
from pathlib import Path


STYLE_PATH = Path(__file__).resolve().parents[1] / "app" / "static" / "style.css"


def _rule_body(css: str, selector: str) -> str:
    match = re.search(rf"{re.escape(selector)}\s*\{{([^}}]+)\}}", css)
    if not match:
        raise AssertionError(f"Missing CSS rule for {selector}")
    return match.group(1)


class DuskThemeContrastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = STYLE_PATH.read_text(encoding="utf-8")

    def test_clear_dusk_sidebar_uses_light_text_with_dark_shadow(self):
        body = _rule_body(
            self.css,
            '[data-period="dusk"][data-starfield="on"] #conv-list li',
        )
        self.assertIn("color: #fff8f4", body)
        self.assertIn("rgba(20, 10, 14, 0.88)", body)

    def test_rainy_dusk_sidebar_keeps_light_text(self):
        rain_selector = (
            '[data-period="dusk"][data-starfield="on"][data-weather="rain"] #conv-list li,\n'
            '[data-period="dusk"][data-starfield="on"][data-weather="thunder"] #conv-list li'
        )
        body = _rule_body(self.css, rain_selector)
        self.assertIn("color: #fff8f4", body)
        self.assertIn("text-shadow:", body)

    def test_rainy_dusk_switches_shared_text_tokens_to_light_values(self):
        selector = (
            '[data-period="dusk"][data-starfield="on"][data-weather="rain"],\n'
            '[data-period="dusk"][data-starfield="on"][data-weather="thunder"]'
        )
        body = _rule_body(self.css, selector)
        self.assertIn("--text: #fff8f4", body)
        self.assertIn("--text-dim: #f4d9d2", body)
        self.assertIn("--text-muted: #d9b5ad", body)

    def test_clear_dusk_panels_use_low_alpha_warm_glass(self):
        selector = (
            '[data-period="dusk"][data-starfield="on"] #sidebar,\n'
            '[data-period="dusk"][data-starfield="on"] #toolbar,\n'
            '[data-period="dusk"][data-starfield="on"] #input-area'
        )
        body = _rule_body(self.css, selector)
        color = re.search(r"background:\s*rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)", body)
        self.assertIsNotNone(color)
        self.assertLessEqual(float(color.group(1)), 0.24)


if __name__ == "__main__":
    unittest.main()
