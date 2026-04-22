/* app.js — AI Desktop Assistant frontend */
'use strict';

// ── marked config ──────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

// Custom renderer: code blocks with highlight.js + copy button
const renderer = new marked.Renderer();
renderer.code = function(token) {
  // marked v9+ passes a token object; older versions pass (code, lang)
  const code = typeof token === 'object' ? (token.text || token.raw || '') : token;
  const lang = typeof token === 'object' ? (token.lang || '') : (arguments[1] || '');
  const language = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
  let highlighted;
  try { highlighted = hljs.highlight(String(code), { language }).value; }
  catch { highlighted = hljs.highlightAuto(String(code)).value; }
  return `<div class="code-block-wrap">
    <div class="code-block-header">
      <span class="code-lang">${lang || ''}</span>
      <button class="btn-copy" onclick="copyCode(this)" data-code="${encodeURIComponent(code)}">复制</button>
    </div>
    <pre><code class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};
marked.use({ renderer });

// ── KaTeX render helper ────────────────────────────────────────────
function renderLatex(html) {
  // Replace $$...$$ (display) then $...$ (inline)
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
    catch { return `<code>${tex}</code>`; }
  });
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, tex) => {
    if (/[\u4e00-\u9fff]/.test(tex)) return `$${tex}$`;
    try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); }
    catch { return `<code>${tex}</code>`; }
  });
  return html;
}

function renderMarkdown(text) {
  // Pre-process LaTeX delimiters: \[...\] → $$...$$, \(...\) → $...$
  text = text.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (m, inner) =>
    /[\u4e00-\u9fff]/.test(inner) ? m : `$$${inner}$$`);
  text = text.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (m, inner) =>
    /[\u4e00-\u9fff]/.test(inner) ? m : `$${inner}$`);
  const html = marked.parse(text);
  return renderLatex(html);
}

function copyCode(btn) {
  const code = decodeURIComponent(btn.dataset.code);
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制';
    setTimeout(() => btn.textContent = '复制', 1500);
  });
}

// ── State ─────────────────────────────────────────────────────────
let state = {
  config: {},
  conversations: [],
  currentConvId: null,
  running: false,
  attachedFiles: [],   // [{name, path, content}]
  dragSrcIdx: null,
  selectedMcIdx: null,
};

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const convList      = $('conv-list');
const chatMessages  = $('chat-messages');
const msgInput      = $('msg-input');
const btnSend       = $('btn-send');
const btnStop       = $('btn-stop');
const modelSelect   = $('model-select');
const convTitle     = $('conv-title');
const fileChips     = $('file-chips');
const searchInput   = $('search-input');

// ── Init ──────────────────────────────────────────────────────────
// ── Scroll speed boost ────────────────────────────────────────────
$('chat-area').addEventListener('wheel', e => {
  e.preventDefault();
  $('chat-area').scrollTop += e.deltaY * 1.2;
}, { passive: false });

window.addEventListener('pywebviewready', async () => {
  state.config = await window.pywebview.api.get_config();
  applyTheme(state.config.theme || 'dark');
  applyFontSize(state.config.font_size || 14);
  populateModelSelect();
  state.conversations = await window.pywebview.api.list_conversations();
  renderConvList();
  if (state.conversations.length > 0) {
    await openConversation(state.conversations[0].id);
  } else {
    await newConversation();
  }
});

// ── Theme / font ──────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-size', size + 'px');
}

// ── Model select ──────────────────────────────────────────────────
function populateModelSelect() {
  modelSelect.innerHTML = '';
  const configs = state.config.model_configs || [];
  configs.forEach(mc => {
    const opt = document.createElement('option');
    opt.value = mc.name;
    opt.textContent = mc.name;
    if (mc.name === state.config.active_model_config) opt.selected = true;
    modelSelect.appendChild(opt);
  });
}
modelSelect.addEventListener('change', async () => {
  state.config.active_model_config = modelSelect.value;
  await window.pywebview.api.save_config(state.config);
});

// ── Conversation list ─────────────────────────────────────────────
function renderConvList(filter = '') {
  convList.innerHTML = '';
  const kw = filter.toLowerCase();
  state.conversations.forEach((conv, idx) => {
    if (kw && !conv.title.toLowerCase().includes(kw)) return;
    const li = document.createElement('li');
    li.dataset.id = conv.id;
    li.dataset.idx = idx;
    if (conv.id === state.currentConvId) li.classList.add('active');

    const titleSpan = document.createElement('span');
    titleSpan.textContent = conv.title;
    titleSpan.style.flex = '1';
    li.appendChild(titleSpan);

    const actions = document.createElement('div');
    actions.className = 'conv-actions';
    const btnRename = document.createElement('button');
    btnRename.textContent = '✏';
    btnRename.title = '重命名';
    btnRename.addEventListener('click', e => { e.stopPropagation(); showRenameDialog(conv.id, conv.title); });
    const btnDel = document.createElement('button');
    btnDel.textContent = '🗑';
    btnDel.title = '删除';
    btnDel.addEventListener('click', e => { e.stopPropagation(); deleteConversation(conv.id); });
    actions.appendChild(btnRename);
    actions.appendChild(btnDel);
    li.appendChild(actions);

    li.addEventListener('click', () => openConversation(conv.id));

    // Drag sort
    li.draggable = true;
    li.addEventListener('dragstart', e => { state.dragSrcIdx = idx; e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    li.addEventListener('drop', e => {
      e.preventDefault();
      if (state.dragSrcIdx === null || state.dragSrcIdx === idx) return;
      const moved = state.conversations.splice(state.dragSrcIdx, 1)[0];
      state.conversations.splice(idx, 0, moved);
      state.dragSrcIdx = null;
      renderConvList(searchInput.value);
      window.pywebview.api.reorder_conversations(state.conversations.map(c => c.id));
    });

    convList.appendChild(li);
  });
}

searchInput.addEventListener('input', () => renderConvList(searchInput.value));

async function openConversation(convId) {
  const conv = await window.pywebview.api.open_conversation(convId);
  if (!conv) return;
  state.currentConvId = convId;
  convTitle.textContent = conv.title;
  renderConvList(searchInput.value);
  loadHistory(conv.messages || []);
}

async function newConversation() {
  const conv = await window.pywebview.api.new_conversation();
  state.conversations.unshift({ id: conv.id, title: conv.title });
  state.currentConvId = conv.id;
  convTitle.textContent = conv.title;
  renderConvList(searchInput.value);
  chatMessages.innerHTML = '';
}

async function deleteConversation(convId) {
  if (!confirm('确定删除这条对话？')) return;
  await window.pywebview.api.delete_conversation(convId);
  state.conversations = state.conversations.filter(c => c.id !== convId);
  if (state.currentConvId === convId) {
    chatMessages.innerHTML = '';
    state.currentConvId = null;
    convTitle.textContent = '';
    if (state.conversations.length > 0) await openConversation(state.conversations[0].id);
    else await newConversation();
  }
  renderConvList(searchInput.value);
}

$('btn-new-conv').addEventListener('click', newConversation);

// ── Rename dialog ─────────────────────────────────────────────────
let _renameConvId = null;
function showRenameDialog(convId, currentTitle) {
  _renameConvId = convId;
  $('rename-input').value = currentTitle;
  $('rename-overlay').classList.remove('hidden');
  $('rename-input').focus();
  $('rename-input').select();
}
$('btn-rename-cancel').addEventListener('click', () => $('rename-overlay').classList.add('hidden'));
$('btn-rename-ok').addEventListener('click', doRename);
$('rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });
async function doRename() {
  const newTitle = $('rename-input').value.trim();
  if (!newTitle || !_renameConvId) { $('rename-overlay').classList.add('hidden'); return; }
  await window.pywebview.api.rename_conversation(_renameConvId, newTitle);
  const conv = state.conversations.find(c => c.id === _renameConvId);
  if (conv) conv.title = newTitle;
  if (_renameConvId === state.currentConvId) convTitle.textContent = newTitle;
  renderConvList(searchInput.value);
  $('rename-overlay').classList.add('hidden');
}

// ── History rendering ─────────────────────────────────────────────
function loadHistory(messages) {
  chatMessages.innerHTML = '';
  messages.forEach(msg => {
    const role = msg.role;
    const content = msg.content || '';
    if (role === 'user') addUserBubble(content);
    else if (role === 'assistant' && content) addAssistantBubble(content);
    else if (role === 'tool') addToolResultBubble('tool', content);
  });
  scrollToBottom();
}

function addUserBubble(text) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-user';
  div.innerHTML = `<div class="bubble-label">You</div><div class="bubble-content">${escapeHtml(text).replace(/\n/g,'<br>')}</div>`;
  chatMessages.appendChild(div);
  return div;
}

function addAssistantBubble(content) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-assistant';
  div.innerHTML = `<div class="bubble-label">Assistant</div><div class="bubble-content">${renderMarkdown(content)}</div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function addToolCallBubble(toolName, args) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-tool-call';
  const argsStr = JSON.stringify(args, null, 2);
  const icons = { web_search:'🔍', read_file:'📄', run_command:'⚙️', write_file:'✏️', list_directory:'📁' };
  const icon = icons[toolName] || '🔧';
  div.innerHTML = `
    <div class="tool-header" onclick="this.parentElement.classList.toggle('tool-expanded')">
      <span class="tool-icon">${icon}</span>
      <span class="tool-name">${escapeHtml(toolName)}</span>
      <span class="tool-args-preview">${escapeHtml(JSON.stringify(args).slice(0,80))}${JSON.stringify(args).length>80?'…':''}</span>
      <span class="tool-chevron">▶</span>
    </div>
    <div class="tool-body">
      <div class="tool-section-label">参数</div>
      <pre class="tool-pre">${escapeHtml(argsStr)}</pre>
      <div class="tool-section-label tool-result-label">结果</div>
      <div class="tool-result-content">等待中…</div>
    </div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function addToolResultBubble(toolName, result) {
  // find the last tool-call bubble for this tool and update its result inline
  const bubbles = chatMessages.querySelectorAll('.bubble-tool-call');
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const nameEl = bubbles[i].querySelector('.tool-name');
    if (nameEl && nameEl.textContent === toolName) {
      const resultEl = bubbles[i].querySelector('.tool-result-content');
      if (resultEl && resultEl.textContent === '等待中…') {
        const preview = result.replace(/\n/g,' ').trim().slice(0, 200) + (result.length > 200 ? '…' : '');
        resultEl.textContent = preview;
        return;
      }
    }
  }
  // fallback: orphaned result bubble
  const div = document.createElement('div');
  div.className = 'bubble bubble-tool-call';
  const icons = { web_search:'🔍', read_file:'📄', run_command:'⚙️', write_file:'✏️', list_directory:'📁' };
  const icon = icons[toolName] || '🔧';
  div.innerHTML = `<div class="tool-header"><span class="tool-icon">${icon}</span><span class="tool-name">${escapeHtml(toolName)}</span></div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function addErrorBubble(msg) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-error';
  div.innerHTML = `<div class="bubble-label">Error</div><div>${escapeHtml(msg)}</div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

// ── Streaming assistant bubble ────────────────────────────────────
let _streamBubble = null;
let _streamContent = '';
let _typingEl = null;

function startAssistantStream() {
  removeTypingIndicator();
  _streamContent = '';
  _streamBubble = document.createElement('div');
  _streamBubble.className = 'bubble bubble-assistant';
  _streamBubble.innerHTML = `<div class="bubble-label">Assistant</div><div class="bubble-content"></div>`;
  chatMessages.appendChild(_streamBubble);
  _typingEl = document.createElement('div');
  _typingEl.className = 'typing-indicator';
  _typingEl.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  chatMessages.appendChild(_typingEl);
  scrollToBottom();
}

// Called from Python via evaluate_js
window.Chat = {
  appendToken(token) {
    removeTypingIndicator();
    _streamContent += token;
    if (_streamBubble) {
      _streamBubble.querySelector('.bubble-content').innerHTML = renderMarkdown(_streamContent);
      scrollToBottom();
    }
  },
  showToolCall(toolName, args) {
    addToolCallBubble(toolName, args);
  },
  showToolResult(toolName, result) {
    addToolResultBubble(toolName, result);
  },
  updateTodo(items) {
    const panel = $('todo-panel');
    const list = $('todo-list');
    if (!items || items.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      const marks = { completed: '✓', in_progress: '▶', pending: '○' };
      const mark = marks[item.status] || '○';
      if (item.status === 'completed') li.classList.add('todo-completed');
      else if (item.status === 'in_progress') li.classList.add('todo-inprogress');
      li.innerHTML = `<span class="todo-mark">${mark}</span><span>${escapeHtml(item.content)}${
        item.status === 'in_progress' ? `<span class="todo-active">${escapeHtml(item.activeForm || '')}</span>` : ''
      }</span>`;
      list.appendChild(li);
    });
  },
  finishMessage() {
    removeTypingIndicator();
    _streamBubble = null;
    _streamContent = '';
    _thinkingBubble = null;
    _thinkingContent = '';
    setRunning(false);
    window.pywebview.api.list_conversations().then(convs => {
      state.conversations = convs;
      renderConvList(searchInput.value);
    });
  },
  updateConvTitle(convId, title) {
    const conv = state.conversations.find(c => c.id === convId);
    if (conv) conv.title = title;
    if (convId === state.currentConvId) convTitle.textContent = title;
    renderConvList(searchInput.value);
  },
  showTeamNotification(msg) {
    const div = document.createElement('div');
    div.className = 'bubble bubble-tool';
    div.innerHTML = `<div class="bubble-label">Team</div><div class="bubble-content">${escapeHtml(msg)}</div>`;
    chatMessages.appendChild(div);
    scrollToBottom();
  },
  updateContext(used, total) {
    updateContextBar(used, total);
  },
  appendThinking(token) {
    if (!_thinkingBubble) {
      _thinkingBubble = document.createElement('div');
      _thinkingBubble.className = 'bubble bubble-thinking';
      const toggle = document.createElement('div');
      toggle.className = 'thinking-toggle';
      toggle.textContent = '思考过程';
      const body = document.createElement('div');
      body.className = 'thinking-body';
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('open');
        body.classList.toggle('open');
      });
      _thinkingBubble.appendChild(toggle);
      _thinkingBubble.appendChild(body);
      chatMessages.appendChild(_thinkingBubble);
    }
    _thinkingContent += token;
    _thinkingBubble.querySelector('.thinking-body').textContent = _thinkingContent;
    scrollToBottom();
  },
  showError(msg) {
    removeTypingIndicator();
    _streamBubble = null;
    addErrorBubble(msg);
    setRunning(false);
  },
  showConfirmDialog(toolName, args) {
    $('confirm-title').textContent = `确认执行：${toolName}`;
    $('confirm-detail').textContent = JSON.stringify(args, null, 2);
    _confirmCommand = args.command || '';
    $('btn-confirm-always').style.display = (toolName === 'run_command' && _confirmCommand) ? '' : 'none';
    $('confirm-overlay').classList.remove('hidden');
  },
};

function removeTypingIndicator() {
  if (_typingEl) { _typingEl.remove(); _typingEl = null; }
}

// ── Confirm dialog ────────────────────────────────────────────────
let _confirmCommand = '';
$('btn-confirm-yes').addEventListener('click', () => {
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool(true);
});
$('btn-confirm-no').addEventListener('click', () => {
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool(false);
});
$('btn-confirm-always').addEventListener('click', () => {
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool_always(_confirmCommand);
});

// ── Send message ──────────────────────────────────────────────────
function setRunning(running) {
  state.running = running;
  btnSend.disabled = running;
  btnStop.disabled = !running;
}

msgInput.addEventListener('keydown', e => {
  if (slashMenuVisible()) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slashMenuMove(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); slashMenuMove(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); slashMenuConfirm(); return; }
    if (e.key === 'Escape')    { e.preventDefault(); slashMenuHide(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
msgInput.addEventListener('input', () => { /* slash menu moved to button */ });
$('btn-slash').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (slashMenuVisible()) { slashMenuHide(); return; }
  await loadSkillCmds();
  slashMenuShow(allCmds());
});
document.addEventListener('click', (e) => {
  if (slashMenuVisible() && !slashMenu.contains(e.target) && e.target !== $('btn-slash')) {
    slashMenuHide();
  }
  // Open all external links in system browser
  const a = e.target.closest('a[href]');
  if (a && a.href && a.href.startsWith('http')) {
    e.preventDefault();
    window.pywebview.api.open_url(a.href);
  }
});
btnSend.addEventListener('click', sendMessage);
btnStop.addEventListener('click', () => window.pywebview.api.stop_generation());

async function sendMessage() {
  if (state.running) return;
  const text = msgInput.value.trim();
  if (!text && state.attachedFiles.length === 0) return;
  if (!state.currentConvId) await newConversation();

  msgInput.value = '';
  addUserBubble(text || '[附件]');
  startAssistantStream();
  setRunning(true);

  const files = state.attachedFiles.map(f => ({ name: f.name, path: f.path, content: f.content }));
  clearFileChips();

  await window.pywebview.api.send_message(state.currentConvId, text, files);
}

// ── Slash command menu ────────────────────────────────────────────
const slashMenu = $('slash-menu');
let _slashIdx = 0;

// Static built-in commands + dynamic skill entries
const BUILTIN_CMDS = [
  { cmd: '/new',     desc: '新建对话（自动读取记忆）', action: async () => { slashMenuHide(); await newConvWithMemory(); } },
  { cmd: '/compact', desc: '手动压缩上下文',           action: () => { slashMenuHide(); msgInput.value = ''; window.pywebview.api.send_message(state.currentConvId, '__slash_compact__', []); } },
  { cmd: '/skills',  desc: '管理技能库',               action: () => { slashMenuHide(); openSkillManager(); } },
  { cmd: '/memory',  desc: '查看记忆文件',             action: () => { slashMenuHide(); msgInput.value = '请列出并总结所有记忆文件内容。'; } },
];

let _skillCmds = [];
let _skillCmdsLoaded = false;
async function loadSkillCmds() {
  if (_skillCmdsLoaded) return;
  _skillCmdsLoaded = true;
  const skills = await window.pywebview.api.list_skills();
  _skillCmds = skills.map(s => ({
    cmd: `/skill:${s.name}`,
    desc: s.description || '技能',
    action: async () => {
      slashMenuHide();
      const content = await window.pywebview.api.read_skill(s.name);
      msgInput.value = content;
      msgInput.focus();
    },
  }));
}

function allCmds() { return [...BUILTIN_CMDS, ..._skillCmds]; }

function slashMenuVisible() { return !slashMenu.classList.contains('hidden'); }

let _slashGen = 0;
function slashMenuHide() { _slashGen++; slashMenu.classList.add('hidden'); }

function slashMenuShow(cmds) {
  slashMenu.innerHTML = '';
  _slashIdx = 0;
  cmds.forEach((c, i) => {
    const li = document.createElement('li');
    if (i === 0) li.classList.add('active');
    li.innerHTML = `<span class="slash-cmd">${escapeHtml(c.cmd)}</span><span class="slash-desc">${escapeHtml(c.desc)}</span>`;
    li.addEventListener('mousedown', e => { e.preventDefault(); c.action(); });
    slashMenu.appendChild(li);
  });
  // close button at bottom
  const closeBtn = document.createElement('li');
  closeBtn.className = 'slash-menu-close';
  closeBtn.textContent = '× 关闭';
  closeBtn.addEventListener('mousedown', e => { e.preventDefault(); slashMenuHide(); });
  slashMenu.appendChild(closeBtn);
  slashMenu._cmds = cmds;
  slashMenu.classList.remove('hidden');
}

function slashMenuMove(dir) {
  const items = slashMenu.querySelectorAll('li');
  if (!items.length) return;
  items[_slashIdx].classList.remove('active');
  _slashIdx = (_slashIdx + dir + items.length) % items.length;
  items[_slashIdx].classList.add('active');
  items[_slashIdx].scrollIntoView({ block: 'nearest' });
}

function slashMenuConfirm() {
  const cmds = slashMenu._cmds;
  if (cmds && cmds[_slashIdx]) cmds[_slashIdx].action();
}

// /new with memory injection
async function newConvWithMemory() {
  await newConversation();
  const mem = await window.pywebview.api.get_memory_summary();
  if (mem) {
    msgInput.value = `[系统：以下是你的记忆文件，请阅读并记住]\n\n${mem}`;
  }
}

// ── Context bar ───────────────────────────────────────────────────
function updateContextBar(used, total) {
  const pct = Math.min(100, Math.round(used / total * 100));
  $('ctx-used').textContent = used >= 1000 ? (used/1000).toFixed(1)+'k' : used;
  $('ctx-total').textContent = total >= 1000 ? (total/1000).toFixed(0)+'k' : total;
  const fill = $('context-bar-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('warn',   pct >= 60 && pct < 85);
  fill.classList.toggle('danger', pct >= 85);
  const hint = $('context-bar-hint');
  if (pct >= 85) hint.textContent = '⚠ 即将自动压缩';
  else if (pct >= 60) hint.textContent = '上下文使用较多';
  else hint.textContent = '';
}

// ── Skill manager ─────────────────────────────────────────────────
let _editingSkill = null;

async function openSkillManager() {
  await refreshSkillList();
  $('skill-overlay').classList.remove('hidden');
}

async function refreshSkillList() {
  const skills = await window.pywebview.api.list_skills();
  const ul = $('skill-list');
  ul.innerHTML = '';
  skills.forEach(s => {
    const li = document.createElement('li');
    li.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:4px;font-size:13px';
    li.textContent = s.name;
    li.title = s.description;
    li.addEventListener('click', async () => {
      _editingSkill = s.name;
      $('skill-name').value = s.name;
      $('skill-desc').value = s.description;
      $('skill-content').value = await window.pywebview.api.read_skill(s.name);
    });
    li.addEventListener('mouseenter', () => li.style.background = 'var(--hover)');
    li.addEventListener('mouseleave', () => li.style.background = '');
    ul.appendChild(li);
  });
}

$('btn-skill-close').addEventListener('click', () => $('skill-overlay').classList.add('hidden'));
$('btn-skill-new').addEventListener('click', () => {
  _editingSkill = null;
  $('skill-name').value = '';
  $('skill-desc').value = '';
  $('skill-content').value = '';
  $('skill-name').focus();
});
$('btn-skill-save').addEventListener('click', async () => {
  const name = $('skill-name').value.trim();
  const desc = $('skill-desc').value.trim();
  const content = $('skill-content').value;
  if (!name) return;
  await window.pywebview.api.save_skill(name, desc, content);
  _editingSkill = name;
  await refreshSkillList();
});
$('btn-skill-del').addEventListener('click', async () => {
  const name = $('skill-name').value.trim() || _editingSkill;
  if (!name || !confirm(`删除技能 "${name}"？`)) return;
  await window.pywebview.api.delete_skill(name);
  _editingSkill = null;
  $('skill-name').value = '';
  $('skill-desc').value = '';
  $('skill-content').value = '';
  await refreshSkillList();
});
document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.addEventListener('dragleave', e => { if (e.relatedTarget === null) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', async e => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    await addFileChip(file);
  }
});

async function addFileChip(file) {
  const name = file.name;
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf:'📄', docx:'📝', xlsx:'📊', xls:'📊', png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', webp:'🖼' };
  const icon = icons[ext] || '📎';
  const isImg = ['png','jpg','jpeg','gif','webp','bmp'].includes(ext);

  const chip = document.createElement('div');
  chip.className = 'file-chip';
  chip.innerHTML = `<span>${icon} ${escapeHtml(name)}</span><span class="chip-status"> ⏳</span><button title="移除">✕</button>`;
  fileChips.appendChild(chip);

  const entry = { name, path: '', content: '' };
  state.attachedFiles.push(entry);

  chip.querySelector('button').addEventListener('click', () => {
    state.attachedFiles = state.attachedFiles.filter(f => f !== entry);
    chip.remove();
  });

  // Read as base64, save via Python to get a stable local path with unique suffix
  const base64 = await readFileAsBase64(file);
  const localPath = await window.pywebview.api.save_uploaded_file(name, base64);
  entry.path = localPath;
  chip.querySelector('.chip-status').textContent = '';

  if (isImg) {
    chip.querySelector('.chip-status').textContent = ' 🔍';
    window.pywebview.api.describe_image(localPath).then(desc => {
      entry.content = desc;
      chip.querySelector('.chip-status').textContent = ' ✓';
    });
  } else {
    const content = await window.pywebview.api.read_file_content(localPath);
    entry.content = content;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function clearFileChips() {
  state.attachedFiles = [];
  fileChips.innerHTML = '';
}

// ── Todo panel ───────────────────────────────────────────────────────
$('btn-todo-close').addEventListener('click', () => $('todo-panel').classList.add('hidden'));

// ── Thinking mode toggle ──────────────────────────────────────────
let _thinkingBubble = null;
let _thinkingContent = '';

$('btn-thinking').addEventListener('click', () => {
  const btn = $('btn-thinking');
  const active = btn.classList.toggle('active');
  window.pywebview.api.set_thinking(active);
});

// ── Export ────────────────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
  if (state.currentConvId) window.pywebview.api.export_conversation(state.currentConvId);
});

// ── Settings ──────────────────────────────────────────────────────
$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', () => $('settings-overlay').classList.add('hidden'));
$('btn-settings-cancel').addEventListener('click', () => $('settings-overlay').classList.add('hidden'));
$('btn-settings-save').addEventListener('click', saveSettings);
$('btn-allowlist-save').addEventListener('click', async () => {
  const cmds = $('allowlist-cmds').value.split('\n').map(s => s.trim()).filter(Boolean);
  await window.pywebview.api.save_allowed_commands_api(cmds);
  $('allowlist-cmds').value = cmds.join('\n');
});
$('btn-allowlist-clear').addEventListener('click', async () => {
  if (!confirm('确定清空所有允许的指令？')) return;
  await window.pywebview.api.save_allowed_commands_api([]);
  $('allowlist-cmds').value = '';
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

async function openSettings() {
  const cfg = state.config;
  $('tavily-key').value = cfg.tavily_api_key || '';
  $('cmd-safety').value = cfg.command_safety || 'confirm';
  $('cmd-timeout').value = cfg.command_timeout || 30;
  $('max-rounds').value = cfg.max_rounds || 50;
  $('vision-key').value = cfg.vision_api_key || '';
  $('vision-url').value = cfg.vision_base_url || '';
  $('vision-model').value = cfg.vision_model || '';
  $('ui-theme').value = cfg.theme || 'dark';
  $('ui-fontsize').value = String(cfg.font_size || 14);
  renderModelConfigList();
  // load allowlist
  const cmds = await window.pywebview.api.get_allowed_commands();
  $('allowlist-cmds').value = cmds.join('\n');
  $('settings-overlay').classList.remove('hidden');
}

async function saveSettings() {
  saveCurrentMc();
  state.config.tavily_api_key = $('tavily-key').value.trim();
  state.config.command_safety = $('cmd-safety').value;
  state.config.command_timeout = parseInt($('cmd-timeout').value) || 30;
  state.config.max_rounds = parseInt($('max-rounds').value) || 50;
  state.config.vision_api_key = $('vision-key').value.trim();
  state.config.vision_base_url = $('vision-url').value.trim();
  state.config.vision_model = $('vision-model').value.trim();
  state.config.theme = $('ui-theme').value;
  state.config.font_size = parseInt($('ui-fontsize').value) || 14;
  applyTheme(state.config.theme);
  applyFontSize(state.config.font_size);
  await window.pywebview.api.save_config(state.config);
  populateModelSelect();
  $('settings-overlay').classList.add('hidden');
}

// Model config list
function renderModelConfigList() {
  const ul = $('model-config-list');
  ul.innerHTML = '';
  (state.config.model_configs || []).forEach((mc, i) => {
    const li = document.createElement('li');
    li.textContent = mc.name;
    if (i === state.selectedMcIdx) li.classList.add('active');
    li.addEventListener('click', () => selectMc(i));
    ul.appendChild(li);
  });
}

function selectMc(idx) {
  state.selectedMcIdx = idx;
  const mc = state.config.model_configs[idx];
  $('mc-name').value = mc.name || '';
  $('mc-key').value = mc.api_key || '';
  $('mc-url').value = mc.base_url || '';
  $('mc-model').value = mc.model || '';
  $('mc-system').value = mc.system_prompt || '';
  renderModelConfigList();
}

function saveCurrentMc() {
  if (state.selectedMcIdx === null) return;
  const mc = state.config.model_configs[state.selectedMcIdx];
  mc.name = $('mc-name').value.trim() || mc.name;
  mc.api_key = $('mc-key').value.trim();
  mc.base_url = $('mc-url').value.trim();
  mc.model = $('mc-model').value.trim();
  mc.system_prompt = $('mc-system').value.trim();
  renderModelConfigList();
}

$('btn-save-mc').addEventListener('click', saveCurrentMc);
$('btn-add-model').addEventListener('click', () => {
  const configs = state.config.model_configs || [];
  configs.push({ name: `新配置 ${configs.length + 1}`, api_key: '', base_url: '', model: '', system_prompt: 'You are a helpful assistant.' });
  state.config.model_configs = configs;
  selectMc(configs.length - 1);
});
$('btn-del-mc').addEventListener('click', () => {
  const configs = state.config.model_configs || [];
  if (configs.length <= 1) { alert('至少保留一个模型配置'); return; }
  if (state.selectedMcIdx === null) return;
  configs.splice(state.selectedMcIdx, 1);
  state.selectedMcIdx = null;
  ['mc-name','mc-key','mc-url','mc-model'].forEach(id => $(id).value = '');
  $('mc-system').value = '';
  renderModelConfigList();
});

// ── Utilities ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scrollToBottom() {
  const area = $('chat-area');
  const threshold = 80;
  const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
  if (distFromBottom <= threshold) {
    area.scrollTop = area.scrollHeight;
  }
}

// ── Chat nav buttons ──────────────────────────────────────────────
$('btn-nav-bottom').addEventListener('click', () => {
  const area = $('chat-area');
  area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
});

$('btn-nav-prev').addEventListener('click', () => {
  const bubbles = Array.from(chatMessages.querySelectorAll('.bubble-user, .bubble-assistant'));
  if (!bubbles.length) return;
  const area = $('chat-area');
  const areaTop = area.getBoundingClientRect().top;
  // find last bubble whose top is above current viewport
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const rect = bubbles[i].getBoundingClientRect();
    if (rect.top < areaTop - 10) {
      bubbles[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
});

$('btn-nav-next').addEventListener('click', () => {
  const bubbles = Array.from(chatMessages.querySelectorAll('.bubble-user, .bubble-assistant'));
  if (!bubbles.length) return;
  const area = $('chat-area');
  const areaTop = area.getBoundingClientRect().top;
  for (let i = 0; i < bubbles.length; i++) {
    const rect = bubbles[i].getBoundingClientRect();
    if (rect.top > areaTop + 10) {
      bubbles[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
});
