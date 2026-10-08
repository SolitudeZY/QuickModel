// NODE_PATH must resolve playwright. Uses the installed Edge browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../app/static');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QM_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      window.sent = [];
      window.stopped = [];
      window.pywebview = { api: {
        open_conversation: async id => ({id, title: id, messages: []}),
        get_context_usage: async () => ({used: 0, total: 80000}),
        send_message: async (...args) => { window.sent.push(args); return {ok:true}; },
        stop_generation: async id => window.stopped.push(id),
        list_recent_projects: async () => [],
        new_conversation: async () => ({id: 'C', title: 'C'}),
      }};
      state.conversations = [{id:'A',title:'A'}, {id:'B',title:'B'}];
    });
    await page.evaluate(async () => {
      await openConversation('A');
      msgInput.value = 'A 的草稿';
      restoreUndoneInput({text: msgInput.value, files: [{name:'a.txt',path:'C:/a.txt',content:'A attachment'}]});
      await openConversation('B');
    });
    assert.equal(await page.locator('#msg-input').inputValue(), '');
    assert.equal(await page.locator('.file-chip').count(), 0);
    await page.evaluate(async () => {
      msgInput.value = 'B 的草稿';
      await openConversation('A');
    });
    assert.equal(await page.locator('#msg-input').inputValue(), 'A 的草稿');
    assert.equal(await page.locator('.file-chip').count(), 1);
    await page.evaluate(async () => { await sendMessage(); await openConversation('B'); await sendMessage(); });
    assert.deepEqual(await page.evaluate(() => sent.map(args => [args[0], args[1], args[2].length])),
      [['A','A 的草稿',1], ['B','B 的草稿',0]]);
    await page.evaluate(() => {
      Chat.forConversation('A', () => Chat.appendThinking('thinking A'));
      Chat.forConversation('A', () => Chat.appendToken('answer A'));
      Chat.forConversation('A', () => Chat.showToolCall('read_file', {path:'a.txt'}));
      Chat.forConversation('A', () => Chat.showToolResult('read_file', 'result A'));
      Chat.forConversation('B', () => Chat.appendToken('answer B'));
      msgInput.value = 'B 下一条';
    });
    assert.match(await page.locator('#chat-messages').innerText(), /answer B/);
    assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /answer A|result A/);
    await page.evaluate(() => openConversation('A'));
    assert.match(await page.locator('#chat-messages').innerText(), /answer A/);
    assert.equal(await page.locator('.tool-result-content').textContent(), 'result A');
    assert.equal(await page.locator('#btn-send').isDisabled(), true);
    await page.locator('#btn-stop').click();
    assert.deepEqual(await page.evaluate(() => stopped), ['A']);
    await page.evaluate(async () => {
      Chat.forConversation('A', () => Chat.finishMessage(), 'done');
      await openConversation('B');
    });
    assert.equal(await page.locator('#btn-send').isDisabled(), true);
    assert.equal(await page.locator('#msg-input').inputValue(), 'B 下一条');
    await page.evaluate(async () => {
      await newConversation();
      Chat.forConversation('B', () => Chat.appendToken(' done in background'));
      Chat.forConversation('B', () => Chat.finishMessage(), 'done');
      msgInput.value = '主页草稿';
      await sendMessage();
    });
    assert.equal(await page.evaluate(() => sent.at(-1)[0]), 'C');
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '主页草稿');
    assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /answer B/);
    await page.evaluate(() => openConversation('B'));
    assert.match(await page.locator('#chat-messages').innerText(), /answer B done in background/);
    assert.equal(await page.locator('#btn-send').isDisabled(), false);
    assert.equal(await page.locator('#msg-input').inputValue(), 'B 下一条');
    await page.evaluate(async () => {
      await sendMessage();
      Chat.forConversation('C', () => Chat.showConfirmDialog('run_command', {command:'echo C'}, ''), 'dialog');
      Chat.forConversation('C', () => Chat.closeConversationDialogs(), 'dialogEnd');
      Chat.forConversation('C', () => Chat.showError('C failed'), 'done');
    });
    assert.equal(await page.locator('#btn-send').isDisabled(), true);
    assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /C failed/);
    await page.evaluate(() => openConversation('C'));
    assert.match(await page.locator('#chat-messages').innerText(), /C failed/);
    assert.equal(await page.locator('#confirm-overlay').isVisible(), false);
    assert.equal(await page.locator('#btn-send').isDisabled(), false);
    await page.evaluate(async () => {
      window.pywebview.api.save_uploaded_file = () => new Promise(resolve => { window.finishUpload = resolve; });
      window.pywebview.api.read_file_content = async () => 'uploaded in C';
      window.upload = addFileChip(new File(['file'], 'c.txt'));
    });
    await page.waitForFunction(() => typeof finishUpload === 'function');
    await page.evaluate(async () => {
      await openConversation('A');
      finishUpload('C:/c.txt');
      await upload;
    });
    assert.equal(await page.locator('.file-chip').count(), 0);
    await page.evaluate(() => openConversation('C'));
    assert.equal(await page.locator('.file-chip').count(), 1);
    assert.deepEqual(await page.evaluate(() => state.attachedFiles.map(f => [f.name, f.path, f.loading])),
      [['c.txt', 'C:/c.txt', false]]);
    assert.deepEqual(errors, []);
    console.log('PASS conversation drafts, attachments, concurrent streams, tools, targeted stop, background completion and home send');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
