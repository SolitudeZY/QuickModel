// 主题 × 天气对比度回归：黄昏/白天/夜晚 × 晴天/雨天，工具栏、工具执行记录、
// 折叠条、状态、输入区的文字对比度都必须 ≥ 4.5:1（WCAG AA）。
// 半透明玻璃 + 动态背景是主要风险：面板透明度刻意保持不变（见 CLAUDE.md），
// 所以内容层改用实底 token（--chrome-* / --tool-record-*）。
// playwright 解析顺序：QM_PLAYWRIGHT 指定的包目录 → playwright → playwright-core。
function loadPlaywright() {
  const candidates = [process.env.QM_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean);
  for (const name of candidates) {
    try { return require(name); } catch (error) { /* 继续尝试下一个 */ }
  }
  throw new Error('未找到 playwright，可设置 QM_PLAYWRIGHT 指向 playwright 包目录');
}
const { chromium } = loadPlaywright();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../app/static');

const SCENES = {
  'day-clear': '#e6eef1',
  'day-rain': '#9fb2bb',
  'dusk-clear': '#f0a97f',
  'dusk-rain': '#6d4e52',
  'night-clear': '#0d1220',
  'night-rain': '#101722',
};

const TARGETS = [
  '#model-select', '#conv-title', '#btn-thinking', '#btn-toggle-tools', '#btn-search', '#btn-settings',
  '#msg-input', '#search-input',
  '.tool-name', '.tool-args-preview', '.tool-status', '.tool-fold-label', '.tool-result-content',
  '.bubble-assistant .bubble-content', '.bubble-user .bubble-content',
];

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html'
      : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  const port = 19000 + Math.floor(Math.random() * 900);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QM_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => {
      window.pywebview = { api: {
        paths_exist: async () => ({ existing: [] }), open_file_location: async () => {},
        get_image_data: async () => '', get_config: async () => ({}),
        get_allowed_commands: async () => [], get_app_version: async () => 'test',
      }};
      const scene = document.createElement('div');
      scene.id = 'contrast-scene';
      scene.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none';
      document.body.prepend(scene);
      document.body.style.background = 'transparent';
      // 过渡/动画会让 getComputedStyle 抓到中间帧，测量前统一关掉
      const kill = document.createElement('style');
      kill.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.appendChild(kill);
      applyToolCallStyle('record');
      document.getElementById('conv-title').textContent = '帮我把这张图中的文字换一个更大气背景';
      addAssistantBubble('明白，我搞错了。我把刚才误加进长图的内容撤掉，改为单独生成一张新海报。');
      for (let i = 0; i < 6; i++) {
        addToolCallBubble('apply_patch', { edits: [{ path: 'E:/AI_temp/poster_series.py' }] });
        addToolResultBubble('apply_patch', i % 3 === 0 ? '错误：old_string 未找到' : '✅ E:/AI_temp/poster_series.py');
      }
      addUserBubble('我是说生成一个新的海报');
    });

    const failures = [];
    for (const [name, color] of Object.entries(SCENES)) {
      const [period, weather] = name.split('-');
      await page.evaluate(({ period, weather, color }) => {
        const de = document.documentElement;
        de.dataset.starfield = 'on';
        de.dataset.period = period;
        de.dataset.theme = period === 'night' ? 'dark' : 'light';
        de.dataset.weather = weather;
        document.getElementById('contrast-scene').style.background = color;
      }, { period, weather, color });
      await page.waitForTimeout(60);
      const rows = await page.evaluate(({ targets, sceneColor }) => {
        const parse = value => {
          const text = String(value).trim();
          const hex = text.match(/^#([0-9a-f]{6})$/i);
          if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
          const m = text.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(',').map(v => parseFloat(v.trim()));
          return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
        };
        const scene = [sceneColor[1], sceneColor[2], sceneColor[3]];
        const effectiveBackground = el => {
          const layers = [];
          for (let node = el; node; node = node.parentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c[3] > 0.001) layers.push(c);
          }
          let out = scene;
          for (let i = layers.length - 1; i >= 0; i--) {
            const [r, g, b, a] = layers[i];
            out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
          }
          return out;
        };
        const luminance = rgb => {
          const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
        };
        const contrast = (fg, bg) => {
          const a = luminance(fg), b = luminance(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return targets.map(sel => {
          const el = document.querySelector(sel);
          if (!el) return { sel, missing: true };
          const cs = getComputedStyle(el);
          const bg = effectiveBackground(el);
          const raw = parse(cs.color) || [0, 0, 0, 1];
          const fg = [raw[0] * raw[3] + bg[0] * (1 - raw[3]),
            raw[1] * raw[3] + bg[1] * (1 - raw[3]),
            raw[2] * raw[3] + bg[2] * (1 - raw[3])];
          return { sel, ratio: Math.round(contrast(fg, bg) * 100) / 100, color: cs.color };
        });
      }, { targets: TARGETS, sceneColor: (() => {
        const m = color.match(/^#(..)(..)(..)$/);
        return [0, parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
      })() });
      rows.filter(row => !row.missing && row.ratio < 4.5)
        .forEach(row => failures.push(`${name} ${row.sel} = ${row.ratio}:1`));
    }

    assert.deepEqual(failures, [], `文字对比度不足 4.5:1：\n${failures.join('\n')}`);
    assert.deepEqual(errors, []);
    console.log('frontend_theme_contrast: ok');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
