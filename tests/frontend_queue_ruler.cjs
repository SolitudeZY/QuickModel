// Browser interaction regression. NODE_PATH must resolve Playwright; uses installed Edge.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '../app/static');

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QM_TEST_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: {width: 1280, height: 900} });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    assert.equal(page.url(), url);
    assert.ok(await page.title());
    await page.evaluate(() => {
      window.sent = [];
      window.stopped = [];
      window.pywebview = { api: {
        open_conversation: async id => ({id, title: id === 'A' ? '功能开发讨论' : '独立会话', messages: []}),
        get_context_usage: async () => ({used: 0, total: 80000}),
        send_message: async (...args) => { sent.push(args); return {ok: true}; },
        stop_generation: async id => stopped.push(id),
        list_recent_projects: async () => [],
        get_image_data: async () => null,
      }};
      state.conversations = [{id:'A',title:'功能开发讨论'}, {id:'B',title:'独立会话'}];
      window.complete = (id, failed = false) => {
        Chat.forConversation(id, () => failed ? Chat.showError('模拟网络错误') : Chat.finishMessage(), 'done');
        Chat.forConversation(id, () => Chat.generationReady(id, failed), 'queueReady');
      };
    });
    await page.evaluate(() => openConversation('A'));
    const send = async text => {
      await page.locator('#msg-input').fill(text);
      await page.locator('#msg-input').press('Enter');
    };
    await send('先分析现有对话流程');
    for (let i = 1; i <= 5; i++) await send(`后续任务 ${i}`);
    assert.equal(await page.locator('.queue-item').count(), 5);
    await send('第六条保留在输入框');
    assert.equal(await page.locator('#msg-input').inputValue(), '第六条保留在输入框');
    assert.equal(await page.locator('.queue-item').count(), 5);
    assert.equal(await page.evaluate(() => sent.length), 1);

    // finishMessage is deliberately earlier than worker release; it must not drain.
    await page.evaluate(() => Chat.forConversation('A', () => Chat.finishMessage(), 'done'));
    assert.equal(await page.evaluate(() => sent.length), 1);
    await page.evaluate(() => Chat.forConversation('A', () => Chat.generationReady('A'), 'queueReady'));
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '后续任务 1');
    assert.equal(await page.locator('.queue-item').count(), 4);
    assert.equal(await page.locator('#msg-input').inputValue(), '第六条保留在输入框');

    // Promote an existing queued item without discarding the FIFO remainder.
    await page.locator('.queue-item').nth(2).getByText('立即发送').click();
    assert.deepEqual(await page.evaluate(() => stopped), ['A']);
    assert.equal(await page.evaluate(() => sent.length), 2);
    await page.evaluate(() => complete('A', true)); // Provider reports cancellation as error.
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '后续任务 4');
    assert.deepEqual(await page.evaluate(() => conversationView('A').pendingMessages.map(m => m.text)),
      ['后续任务 2', '后续任务 3', '后续任务 5']);

    // New immediate input, attachment snapshot, then background queue advancement.
    await page.evaluate(() => restoreUndoneInput({text: '优先处理这个附件', files: [{name:'notes.txt',path:'C:/notes.txt',content:'snapshot'}]}));
    await page.locator('#btn-send-now').click();
    assert.equal(await page.locator('.file-chip').count(), 0);
    await page.evaluate(() => complete('A'));
    assert.deepEqual(await page.evaluate(() => sent.at(-1).slice(1)),
      ['优先处理这个附件', [{name:'notes.txt',path:'C:/notes.txt',content:'snapshot'}]]);
    await page.evaluate(() => openConversation('B'));
    await send('B 独立运行');
    await page.evaluate(() => complete('A'));
    assert.deepEqual(await page.evaluate(() => sent.at(-1).slice(0, 2)), ['A', '后续任务 2']);
    assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /后续任务|优先处理/);
    await page.evaluate(() => openConversation('A'));
    assert.match(await page.locator('#chat-messages').innerText(), /后续任务 2/);
    assert.equal(await page.locator('.queue-item').count(), 2);

    // Explicit stop pauses the queue; resume sends only after the worker is ready.
    const beforeStop = await page.evaluate(() => sent.length);
    await page.locator('#btn-stop').click();
    await page.evaluate(() => complete('A'));
    assert.equal(await page.evaluate(() => sent.length), beforeStop);
    assert.match(await page.locator('#queue-status').innerText(), /已暂停/);
    await page.locator('#btn-queue-resume').click();
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '后续任务 3');
    await page.evaluate(() => complete('A', true));
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '后续任务 3');
    assert.match(await page.locator('#queue-status').innerText(), /已暂停/);
    await page.locator('.queue-remove').click();
    assert.equal(await page.locator('#message-queue').isVisible(), false);

    // Early completion and a rejected bridge call both preserve queue state.
    await page.evaluate(() => {
      pywebview.api.send_message = async (...args) => { sent.push(args); complete(args[0]); return {ok: true}; };
    });
    await send('立即完成');
    assert.equal(await page.evaluate(() => conversationView().awaitingReady), false);
    await page.evaluate(() => { pywebview.api.send_message = async () => ({ok:false, error:'bridge rejected'}); });
    await send('失败后保留');
    assert.match(await page.locator('#queue-status').innerText(), /已暂停/);
    assert.match(await page.locator('.queue-summary').innerText(), /失败后保留/);
    await page.locator('.queue-remove').click();

    // A late stop acknowledgement must not cancel the newly dequeued generation.
    await page.evaluate(() => {
      pywebview.api.send_message = async (...args) => { sent.push(args); return {ok:true}; };
      pywebview.api.stop_generation = id => new Promise(resolve => { stopped.push(id); window.finishStop = resolve; });
    });
    await send('等待停止的旧任务');
    await send('停止完成后才启动');
    const beforeLateStop = await page.evaluate(() => sent.length);
    await page.locator('.queue-item').getByText('立即发送').click();
    await page.evaluate(() => complete('A'));
    assert.equal(await page.evaluate(() => sent.length), beforeLateStop);
    await page.evaluate(() => finishStop());
    await page.waitForFunction(() => sent.at(-1)[1] === '停止完成后才启动');
    await page.evaluate(() => complete('A'));

    // Interruption during bridge setup is deferred until the session is reserved.
    await page.evaluate(() => {
      pywebview.api.send_message = (...args) => new Promise(resolve => { sent.push(args); window.finishSubmit = resolve; });
      pywebview.api.stop_generation = async id => stopped.push(id);
    });
    await send('桥接仍在初始化');
    const stopsBeforeSubmit = await page.evaluate(() => stopped.length);
    await page.locator('#msg-input').fill('初始化后优先发送');
    await page.locator('#btn-send-now').click();
    assert.equal(await page.evaluate(() => stopped.length), stopsBeforeSubmit);
    await page.evaluate(() => finishSubmit({ok:true}));
    await page.waitForFunction(n => stopped.length === n + 1, stopsBeforeSubmit);
    await page.evaluate(() => {
      pywebview.api.send_message = async (...args) => { sent.push(args); return {ok:true}; };
      complete('A');
    });
    assert.equal(await page.evaluate(() => sent.at(-1)[1]), '初始化后优先发送');
    await page.evaluate(() => complete('A'));

    // Navigation excludes tool-image user messages and keeps reading position during streaming.
    await page.evaluate(() => {
      const messages = [];
      for (let i = 1; i <= 12; i++) {
        messages.push({role:'user', content:`第 ${i} 个问题：讨论队列的发送行为`});
        messages.push({role:'assistant', content: '这是回答正文，用于验证历史定位。\n\n'.repeat(12)});
      }
      loadHistory(messages);
      addUserBubble('工具图片，不是用户提问', false);
      pywebview.api.send_message = async (...args) => { sent.push(args); return {ok:true}; };
    });
    await page.waitForFunction(() => document.querySelectorAll('.ruler-tick').length === 12);
    const ruler = await page.locator('#conversation-ruler').boundingBox();
    const chat = await page.locator('#chat-area').boundingBox();
    assert.ok(Math.abs(ruler.y + ruler.height / 2 - chat.y - chat.height / 2) < 2, 'ruler is vertically centered');
    const tickWidth = index => page.locator('.ruler-tick span').nth(index).evaluate(el => el.getBoundingClientRect().width);
    await page.mouse.move(1100, 100);
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[3].style.width) < 7.1);
    const nearTick = await page.locator('.ruler-tick').nth(3).boundingBox();
    // Proximity responds before entering the hit area, and the nearest line grows most.
    await page.mouse.move(ruler.x + ruler.width + 48, nearTick.y + nearTick.height / 2);
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[3].style.width) > 17);
    const approachingWidth = await tickWidth(3);
    assert.ok(approachingWidth < 23);
    assert.ok(approachingWidth > await tickWidth(2));
    assert.ok(approachingWidth > await tickWidth(9));
    await page.locator('.ruler-tick').nth(3).hover();
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[3].style.width) > 29);
    await page.locator('.ruler-tick').nth(7).hover();
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[7].style.width) > 29);
    assert.ok(await tickWidth(7) > await tickWidth(3));
    await page.mouse.move(1100, 100);
    const shrinkingWidth = await tickWidth(7);
    assert.ok(shrinkingWidth > 7.1 && shrinkingWidth < 30.1, 'leave animates instead of snapping');
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[7].style.width) < 7.1);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('.ruler-tick').nth(3).hover();
    await page.waitForFunction(() => parseFloat(document.querySelectorAll('.ruler-tick span')[3].style.width) === 30);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    assert.match(await page.locator('#ruler-preview').innerText(), /第 4 个问题/);
    await page.locator('.ruler-tick').nth(3).click();
    await page.waitForFunction(() => {
      const bubble = document.querySelectorAll('.bubble-user[data-user-input="true"]')[3];
      return Math.abs(bubble.getBoundingClientRect().top - $('chat-area').getBoundingClientRect().top - 8) < 2;
    });
    assert.equal(await page.locator('.ruler-tick').nth(3).getAttribute('aria-current'), 'true');
    const scrollTop = await page.evaluate(() => $('chat-area').scrollTop);
    await page.evaluate(() => { startAssistantStream(); Chat.appendToken('后台仍在生成'); });
    assert.equal(await page.evaluate(() => $('chat-area').scrollTop), scrollTop);
    await page.locator('.ruler-tick').nth(1).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.ruler-tick')[1].getAttribute('aria-current') === 'true');

    // Screenshot a populated queue, then verify compact window and light theme layout.
    await send('完成历史对话刻度导航');
    await send('补充队列的错误恢复测试');
    await send('整理功能使用说明');
    await page.locator('.ruler-tick').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.ruler-tick')[1].getAttribute('aria-current') === 'true');
    const shots = process.env.QM_QA_SCREENSHOT_DIR || path.join(os.tmpdir(), 'quickmodel-queue-ruler-qa');
    fs.mkdirSync(shots, {recursive:true});
    await page.screenshot({path: path.join(shots, 'desktop.png')});
    await page.setViewportSize({width: 900, height: 720});
    await page.evaluate(() => applyTheme('light'));
    await page.waitForFunction(() => getComputedStyle($('msg-input')).backgroundColor === 'rgb(221, 227, 229)');
    await page.screenshot({path: path.join(shots, 'compact-light.png')});
    const smallRuler = await page.locator('#conversation-ruler').boundingBox();
    const smallChat = await page.locator('#chat-area').boundingBox();
    assert.ok(Math.abs(smallRuler.y + smallRuler.height / 2 - smallChat.y - smallChat.height / 2) < 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#btn-send-now').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS queue capacity/FIFO/interrupt/background/attachments/pause/error and ruler preview/click/keyboard/scroll; ${url}; screenshots: ${shots}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
