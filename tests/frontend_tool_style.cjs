// 工具调用展示样式 / 结果文件定位 / 设置密钥显隐的前端回归。
// playwright 解析顺序：环境变量 QM_PLAYWRIGHT 指定的包目录 → playwright → playwright-core。
// 默认使用本机 Edge（可用 QM_TEST_BROWSER 改 channel）。
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

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html'
      : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  // 固定高段端口范围，避开 Chromium 的 blocked ports（如 6666）与随机冲突
  const port = 19000 + Math.floor(Math.random() * 900);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QM_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => {
      window.located = [];
      window.pywebview = { api: {
        // 只把真实存在过的标记路径算作存在，验证前端确实过滤了候选路径；
        // 返回值故意用反斜杠形式，验证与标记里的正斜杠路径去重（只出一个 chip）。
        paths_exist: async paths => ({
          existing: (paths || []).filter(p => p.includes('exists')).map(p => p.replace(/\//g, '\\')),
          dirs: [],
        }),
        open_file_location: async p => { window.located.push(p); },
        get_image_data: async () => '',
        get_allowed_commands: async () => [],
        get_app_version: async () => '0.0.0',
      }};
    });

    // 1) 执行记录样式：状态标记可见、正文只在展开后显示
    await page.evaluate(() => {
      applyToolCallStyle('record');
      addToolCallBubble('run_command', { command: 'python render.py' });
      addToolResultBubble('run_command', '已生成文件：E:/out/exists.png\n无关路径：E:/out/missing.png');
    });
    assert.equal(await page.evaluate(() => document.body.dataset.toolStyle), 'record');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tool-status')).display), 'flex');
    assert.equal(await page.evaluate(() => document.querySelector('.tool-status').textContent), '完成');
    await page.waitForSelector('.bubble-tool-call .tool-file-actions', { state: 'attached' });
    const chips = page.locator('.bubble-tool-call .tool-file-actions .file-link');
    assert.equal(await chips.count(), 1, '只保留后端确认存在的路径');
    assert.equal(await page.locator('.bubble-tool-call .tool-body').isVisible(), false, '收起时不显示正文');
    assert.equal(await chips.first().isVisible(), false, '收起时不显示定位按钮');
    await page.locator('.bubble-tool-call .tool-header').click();
    assert.equal(await page.locator('.bubble-tool-call .tool-body').isVisible(), true);
    assert.equal(await chips.first().isVisible(), true, '展开后才显示定位按钮');
    await chips.first().click();
    const located = await page.evaluate(() => window.located);
    assert.equal(located.length, 1);
    assert.match(located[0], /exists\.png$/);

    // 2) 图片结果同样有定位按钮（不再只有代码文件才有）
    await page.evaluate(() => {
      addToolCallBubble('generate_image', { prompt: 'cat' });
      addToolResultBubble('generate_image', '[图片: exists.png 路径: E:/out/exists.png]');
    });
    await page.waitForSelector('.bubble-tool-call .attach-image');
    assert.equal(await page.locator('.bubble-tool-call .attach-image').count(), 1);
    assert.equal(await page.locator('.bubble-tool-call .tool-file-actions').count(), 2);
    const imageChips = page.locator('.bubble-tool-call').nth(1).locator('.tool-file-actions .file-link');
    assert.equal(await imageChips.count(), 1, '标记路径与后端返回路径按归一化 key 去重');
    assert.equal(await imageChips.first().textContent(), 'exists.png');

    // 3) 切回气泡样式：状态标记隐藏，结构不变
    await page.evaluate(() => applyToolCallStyle('bubble'));
    assert.equal(await page.evaluate(() => document.body.dataset.toolStyle), 'bubble');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tool-status')).display), 'none');

    // 4) 设置面板能读写工具样式（fillSettingsFields 与 saveSettings 共用同一 id）
    await page.evaluate(() => fillSettingsFields({ tool_call_style: 'record' }));
    assert.equal(await page.locator('#ui-tool-style').inputValue(), 'record');

    // 5) 设置里的密钥显隐：切到 text，关闭后恢复 password
    await page.evaluate(() => setSecretsVisible(true));    assert.equal(await page.locator('#tavily-key').getAttribute('type'), 'text');
    assert.equal(await page.locator('#imagegen-key').getAttribute('type'), 'text');
    assert.match(await page.locator('#btn-toggle-secrets').textContent(), /隐藏密钥/);
    await page.evaluate(() => setSecretsVisible(false));
    assert.equal(await page.locator('#tavily-key').getAttribute('type'), 'password');
    assert.match(await page.locator('#btn-toggle-secrets').textContent(), /显示密钥/);
    // 连接密钥输入框（非设置面板）不应被一起切换
    assert.equal(await page.locator('#secret-input').getAttribute('type'), 'password');

    assert.deepEqual(errors, []);
    console.log('frontend_tool_style: ok');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
