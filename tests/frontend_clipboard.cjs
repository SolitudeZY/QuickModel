// Real browser regression: NODE_PATH must resolve playwright; uses installed Edge.
// Optional QM_QA_SCREENSHOT_DIR stores screenshots outside the source tree.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '../app/static');
const code = 'irm https://example.test/install.ps1\n\tWrite-Host "hello"\n\n\n# keep blank lines\n$env:Path';
const md = '**不用手动添加了**，你现在直接重跑：\n\n```powershell\n' + code + '\n```\n\n完成后检查。';
const fixture = `<!doctype html><html data-theme="light" data-period="dusk" data-starfield="on" data-weather="clear"><head><meta charset="utf-8"><title>QuickModel clipboard regression</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"></head><body style="background:linear-gradient(#f9ba86,#d6744f);height:100vh"><aside id="sidebar"><div class="conv-group-header">测试项目 <span class="cg-count">3</span></div><ul id="conv-list"><li><div class="conv-title-wrap">张扬-公司<div class="conv-time">今天 13:39</div></div><div class="conv-snippet">重跑命令并检查结果</div></li></ul><input id="search-input" placeholder="搜索会话"></aside><main style="flex:1;padding:24px;min-width:0"><div id="chat-messages"><div class="bubble-content"></div></div><textarea id="unrelated">keep selection</textarea></main><aside id="fileops-panel" style="display:block"><div id="fileops-header">文件操作 <button>收起</button></div><div class="fileops-name">install.ps1</div><span class="fo-add">+12</span><span class="fo-del">-3</span></aside><script src="/vendor/marked.min.js"></script><script src="/vendor/highlight.min.js"></script><script src="/render.js"></script></body></html>`;
const normalized = value => value.replace(/\r\n/g, '\n');

async function run() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
    const target = path.resolve(root, '.' + req.url);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QM_TEST_BROWSER || 'msedge', headless: true });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.title(), 'QuickModel clipboard regression');
    const render = async (markdown = md) => page.evaluate(value => {
      document.querySelector('.bubble-content').innerHTML = renderMarkdown(value);
    }, markdown);
    const read = async () => normalized(await page.evaluate(() => navigator.clipboard.readText()));
    const readHtmlCode = async () => page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find(item => item.types.includes('text/html'));
      const html = await (await item.getType('text/html')).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { text: doc.querySelector('pre code')?.textContent, html, toolbar: !!doc.querySelector('.code-block-header') };
    });
    const copySelection = async () => { await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c'); await page.waitForTimeout(60); return read(); };
    const selectAll = async (backwards = false) => page.evaluate(reverse => {
      document.activeElement?.blur();
      const el = document.querySelector('.bubble-content');
      getSelection().setBaseAndExtent(el, reverse ? el.childNodes.length : 0, el, reverse ? 0 : el.childNodes.length);
    }, backwards);

    await render();
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#code-copy-status')?.textContent === '复制成功');
    assert.equal(await read(), code);
    assert.equal(normalized((await readHtmlCode()).text), code);
    assert.equal(await page.locator('.btn-copy.is-copied').textContent(), '已复制 ✓');
    console.log('PASS real button writes code and HTML; success feedback');

    await page.getByRole('button', { name: '复制格式', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.btn-copy.is-copied').length === 2);
    assert.equal(await read(), '```powershell\n' + code + '\n```');
    assert.equal(normalized((await readHtmlCode()).text), code);
    const fencedCode = 'print("```")';
    await render('~~~~python\n' + fencedCode + '\n~~~~');
    await page.getByRole('button', { name: '复制格式', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.btn-copy.is-copied'));
    assert.equal(await read(), '````python\n' + fencedCode + '\n````');
    console.log('PASS formatted copy supplies fenced plain text and fence-free HTML');

    await render();
    for (const backwards of [false, true]) {
      await selectAll(backwards);
      assert.equal(await copySelection(), '不用手动添加了，你现在直接重跑：\n\n' + code + '\n\n完成后检查。');
      const rich = await readHtmlCode();
      assert.equal(rich.toolbar, false);
      assert.equal(normalized(rich.text), code);
    }
    assert.equal(await page.locator('.code-lang').evaluate(el => getComputedStyle(el).userSelect), 'none');
    console.log('PASS forward/backward prose + code selection excludes toolbar and preserves whitespace');

    // Stop halfway through a highlighted token; do not copy unselected code.
    await page.evaluate(() => {
      const start = document.querySelector('.bubble-content p strong').firstChild;
      const walker = document.createTreeWalker(document.querySelector('pre code'), NodeFilter.SHOW_TEXT);
      let node, remaining = 7;
      while ((node = walker.nextNode())) { if (remaining <= node.length) break; remaining -= node.length; }
      getSelection().setBaseAndExtent(start, 0, node, remaining);
    });
    assert.equal(await copySelection(), '不用手动添加了，你现在直接重跑：\n\n' + code.slice(0, 7));
    await page.evaluate(() => {
      const node = document.querySelector('pre code').firstChild;
      getSelection().setBaseAndExtent(node, 1, node, 3);
    });
    const partial = await page.evaluate(() => getSelection().toString());
    assert.equal(await copySelection(), partial);
    console.log('PASS partial cross-block and code-only selections');

    await render();
    await selectAll();
    await page.evaluate(() => {
      window.qaWrite = navigator.clipboard.write;
      window.qaWriteText = navigator.clipboard.writeText;
      window.qaExec = document.execCommand;
      navigator.clipboard.write = async () => { throw new DOMException('Test denied', 'NotAllowedError'); };
    });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.btn-copy.is-copied'));
    assert.equal(await read(), code);
    assert.equal(normalized((await readHtmlCode()).text), code);
    assert.ok(await page.evaluate(() => getSelection().toString().includes('不用手动添加了')));
    await render();
    await page.getByRole('button', { name: '复制格式', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.btn-copy.is-copied'));
    assert.equal(await read(), '```powershell\n' + code + '\n```');
    assert.equal(normalized((await readHtmlCode()).text), code);
    console.log('PASS denied async API falls back to actual native copy event, preserving selection and rich formats');

    await render();
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.btn-copy.is-copied'));
    assert.equal(await read(), code);
    await render();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Test blocked'); }; });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.copy-failed'));
    assert.equal(await read(), code);
    assert.match(await page.locator('#code-copy-status').textContent(), /复制失败/);
    await page.evaluate(() => {
      navigator.clipboard.write = window.qaWrite;
      navigator.clipboard.writeText = window.qaWriteText;
      document.execCommand = window.qaExec;
    });
    console.log('PASS plain API last fallback and visible total-failure feedback');

    await page.locator('#unrelated').focus();
    await page.locator('#unrelated').selectText();
    assert.equal(await copySelection(), 'keep selection');
    await render();
    await page.getByRole('button', { name: '复制代码', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('.btn-copy.is-copied'));
    await render(); // streaming replaces the bubble
    assert.equal(await page.locator('#code-copy-status').isVisible(), true);
    assert.equal(await read(), code);
    console.log('PASS input copy stays native, keyboard activation and feedback survives streaming');

    for (const theme of ['light', 'dark']) {
      for (const weather of ['clear', 'rain', 'thunder']) {
        await page.evaluate(({ theme, weather }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.weather = weather; }, { theme, weather });
        for (const selector of ['#conv-list li', '.conv-group-header', '.fileops-name', '#fileops-header']) {
          const styles = await page.locator(selector).evaluate(el => ({ color: getComputedStyle(el).color, shadow: getComputedStyle(el).textShadow }));
          assert.equal(styles.color, 'rgb(255, 248, 244)', `${theme}/${weather}: ${selector}`);
          assert.ok(styles.shadow.includes('20, 10, 14'), styles.shadow);
        }
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.dataset.weather = 'clear'; getSelection().removeAllRanges(); });
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(48, 30, 27, 0.18)');
    assert.equal(await page.locator('#search-input').evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgb(245, 220, 212)');
    if (process.env.QM_QA_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.QM_QA_SCREENSHOT_DIR, 'quickmodel-clipboard-fixed.png') });
      await page.setViewportSize({ width: 960, height: 700 });
      await page.screenshot({ path: path.join(process.env.QM_QA_SCREENSHOT_DIR, 'quickmodel-clipboard-compact.png') });
    }
    assert.deepEqual(errors, []);
    console.log('PASS dusk colors in clear/rain/thunder, preserved opacity, no runtime errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
