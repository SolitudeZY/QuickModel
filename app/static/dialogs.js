/* dialogs.js — 各类对话框：重命名 / 命令确认 / ask_user_question / 计划批准 /
   图片灯箱 / 文件 diff 模态框。依赖 core.js 的 $/state/convTitle/searchInput，
   render.js 的 escapeHtml，及 app.js 的 renderConvList（运行时调用，安全）。
   document 级 keydown 监听各自用 overlay.hidden 守卫，注册在哪个文件都等价。 */
'use strict';

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

// ── Confirm dialog ────────────────────────────────────────────────
let _confirmCommand = '';
let _confirmWildcard = '';
let _countdownTimer = null;
let _countdownSeconds = 0;

function _clearCountdown() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  $('confirm-countdown-wrap').classList.add('hidden');
  $('confirm-countdown-fill').style.width = '100%';
}

function _startCountdown() {
  _countdownSeconds = 5;
  $('confirm-countdown-wrap').classList.remove('hidden');
  $('confirm-countdown-text').textContent = `${_countdownSeconds} 秒后自动执行`;
  $('confirm-countdown-fill').style.transition = 'none';
  $('confirm-countdown-fill').style.width = '100%';
  // Force reflow then animate
  void $('confirm-countdown-fill').offsetWidth;
  $('confirm-countdown-fill').style.transition = 'width 1s linear';

  _countdownTimer = setInterval(() => {
    _countdownSeconds--;
    const pct = (_countdownSeconds / 5) * 100;
    $('confirm-countdown-fill').style.width = pct + '%';
    $('confirm-countdown-text').textContent = `${_countdownSeconds} 秒后自动执行`;
    if (_countdownSeconds <= 0) {
      _clearCountdown();
      $('confirm-overlay').classList.add('hidden');
      window.pywebview.api.confirm_tool(true, dialogConversationId);
    }
  }, 1000);
}

$('btn-confirm-yes').addEventListener('click', () => {
  _clearCountdown();
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool(true, dialogConversationId);
});
$('btn-confirm-no').addEventListener('click', () => {
  _clearCountdown();
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool(false, dialogConversationId);
});
$('btn-confirm-always').addEventListener('click', () => {
  _clearCountdown();
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool_always(_confirmCommand, dialogConversationId);
});
$('btn-confirm-auto').addEventListener('click', () => {
  // Switch to auto_countdown mode and start countdown for current dialog
  state.config.command_safety = 'auto_countdown';
  window.pywebview.api.save_config(state.config);
  $('btn-confirm-auto').style.display = 'none';
  _startCountdown();
});
$('btn-confirm-wildcard').addEventListener('click', () => {
  _clearCountdown();
  $('confirm-overlay').classList.add('hidden');
  window.pywebview.api.confirm_tool_always(_confirmWildcard, dialogConversationId);
});
// Keyboard shortcuts: Enter = allow, Shift+Enter = always allow (wildcard if available, else exact)
document.addEventListener('keydown', e => {
  if ($('confirm-overlay').classList.contains('hidden')) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    _clearCountdown();
    $('confirm-overlay').classList.add('hidden');
    window.pywebview.api.confirm_tool(true, dialogConversationId);
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    _clearCountdown();
    $('confirm-overlay').classList.add('hidden');
    if (_confirmWildcard && !$('btn-confirm-wildcard').classList.contains('hidden')) {
      window.pywebview.api.confirm_tool_always(_confirmWildcard, dialogConversationId);
    } else {
      window.pywebview.api.confirm_tool_always(_confirmCommand, dialogConversationId);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _clearCountdown();
    $('confirm-overlay').classList.add('hidden');
    window.pywebview.api.confirm_tool(false, dialogConversationId);
  }
});

// ── Ask user question dialog ─────────────────────────────────────
let _askSelectedIdx = -1;
let _askOptions = [];
let _askMultiSelect = false;
let _askSelected = new Set();

function showAskDialog(question, options, multiSelect) {
  _askOptions = options || [];
  _askMultiSelect = !!multiSelect;
  _askSelectedIdx = _askOptions.length > 0 ? 0 : -1;
  _askSelected = new Set();
  $('ask-question').textContent = question || '(AI 需要你的输入才能继续)';
  $('ask-hint').textContent = _askOptions.length > 0
    ? `↑↓ 选择 · Enter ${_askMultiSelect ? '切换选中' : '确认'} · ${_askMultiSelect ? 'Tab 提交 · ' : ''}下方可自由输入`
    : '';
  _renderAskOptions();
  $('ask-input').value = '';
  $('ask-input').style.display = '';
  $('ask-overlay').classList.remove('hidden');
  if (_askOptions.length > 0) {
    $('ask-options').focus();
  } else {
    $('ask-input').focus();
  }
}

function _renderAskOptions() {
  const ul = $('ask-options');
  ul.innerHTML = '';
  if (_askOptions.length === 0) { ul.style.display = 'none'; return; }
  ul.style.display = '';
  _askOptions.forEach((opt, i) => {
    const li = document.createElement('li');
    li.textContent = (_askMultiSelect ? (_askSelected.has(i) ? '☑ ' : '☐ ') : '') + opt;
    if (i === _askSelectedIdx) li.classList.add('ask-active');
    if (_askSelected.has(i)) li.classList.add('ask-checked');
    li.addEventListener('click', () => {
      _askSelectedIdx = i;
      if (_askMultiSelect) {
        _askSelected.has(i) ? _askSelected.delete(i) : _askSelected.add(i);
      }
      _renderAskOptions();
      if (!_askMultiSelect) _submitAskAnswer();
    });
    ul.appendChild(li);
  });
}

function _submitAskAnswer() {
  // Free-text input takes priority — if user typed something, use that
  const freeText = $('ask-input').value.trim();
  let answer = '';
  if (freeText) {
    answer = freeText;
  } else if (_askOptions.length > 0) {
    if (_askMultiSelect) {
      answer = [..._askSelected].map(i => _askOptions[i]).join(', ');
    } else {
      answer = _askSelectedIdx >= 0 ? _askOptions[_askSelectedIdx] : '';
    }
  }
  if (!answer) answer = '(无回答)';
  $('ask-overlay').classList.add('hidden');
  window.pywebview.api.answer_question(answer, dialogConversationId);
}

$('btn-ask-submit').addEventListener('click', _submitAskAnswer);

document.addEventListener('keydown', e => {
  if ($('ask-overlay').classList.contains('hidden')) return;
  // Enter in the free-input box always submits (regardless of whether options exist)
  if (e.key === 'Enter' && e.target === $('ask-input')) {
    e.preventDefault();
    _submitAskAnswer();
    return;
  }
  if (_askOptions.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _askSelectedIdx = Math.min(_askSelectedIdx + 1, _askOptions.length - 1);
    _renderAskOptions();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _askSelectedIdx = Math.max(_askSelectedIdx - 1, 0);
    _renderAskOptions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_askMultiSelect) {
      if (_askSelectedIdx >= 0) {
        _askSelected.has(_askSelectedIdx) ? _askSelected.delete(_askSelectedIdx) : _askSelected.add(_askSelectedIdx);
        _renderAskOptions();
      }
    } else {
      _submitAskAnswer();
    }
  } else if (e.key === 'Tab' && _askMultiSelect) {
    e.preventDefault();
    _submitAskAnswer();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    $('ask-overlay').classList.add('hidden');
    window.pywebview.api.answer_question('(用户取消)', dialogConversationId);
  }
});

// ── One-off secret dialog ─────────────────────────────────────────
function showSecretDialog(kind, host, username, port) {
  if (kind !== 'ssh_password') return;
  $('secret-title').textContent = '输入 SSH 密码';
  $('secret-question').textContent = `连接 ${username || '(unknown)'}@${host || '(unknown)'}:${port || 22}`;
  $('secret-input').value = '';
  $('secret-overlay').classList.remove('hidden');
  $('secret-input').focus();
}

function _submitSecret(value) {
  const input = $('secret-input');
  const answer = value !== undefined ? value : input.value;
  input.value = '';
  $('secret-overlay').classList.add('hidden');
  window.pywebview.api.answer_secret(answer || '', dialogConversationId);
}

$('btn-secret-submit').addEventListener('click', () => _submitSecret());
$('btn-secret-cancel').addEventListener('click', () => _submitSecret(''));

$('secret-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    _submitSecret();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _submitSecret('');
  }
});

// ── Plan approval dialog ─────────────────────────────────────────
function showPlanApproval(summary) {
  $('plan-summary').textContent = summary || '(模型已在上方输出计划内容，请查看后决定是否批准执行)';
  $('plan-overlay').classList.remove('hidden');
}
$('btn-plan-approve').addEventListener('click', () => {
  $('plan-overlay').classList.add('hidden');
  window.pywebview.api.approve_plan(true, dialogConversationId);
});
$('btn-plan-reject').addEventListener('click', () => {
  $('plan-overlay').classList.add('hidden');
  window.pywebview.api.approve_plan(false, dialogConversationId);
});

// ── Image lightbox ────────────────────────────────────────────────
function openLightbox(src) {
  if (!src) return;
  $('lightbox-img').src = src;
  $('lightbox-overlay').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox-overlay').classList.add('hidden');
  $('lightbox-img').src = '';
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeLightbox(); closeDiffModal(); }
});
$('lightbox-img').addEventListener('click', e => e.stopPropagation());

// ── 文件改动 diff 模态框 ──────────────────────────────────────────
async function openDiffModal(path, fname) {
  const overlay = $('diff-overlay');
  $('diff-title').textContent = fname || path;
  $('diff-stats').innerHTML = '';
  $('diff-body').innerHTML = '<div class="diff-loading">加载差异中…</div>';
  $('diff-path').textContent = path;
  overlay.classList.remove('hidden');
  let res;
  try {
    res = await window.pywebview.api.get_file_diff(path, state.currentConvId);
  } catch (e) {
    $('diff-body').innerHTML = `<div class="diff-empty">读取差异失败：${escapeHtml(String(e))}</div>`;
    return;
  }
  if (!res || !res.ok) {
    $('diff-body').innerHTML = `<div class="diff-empty">${escapeHtml(res && res.reason || '无法显示差异')}</div>`;
    return;
  }
  const a = res.added || 0, r = res.removed || 0;
  $('diff-stats').innerHTML = `<span class="fo-add">+${a}</span> <span class="fo-del">-${r}</span>`;
  if (!res.lines || res.lines.length === 0) {
    $('diff-body').innerHTML = '<div class="diff-empty">无内容差异</div>';
    return;
  }
  const rows = res.lines.map(ln => {
    if (ln.type === 'hunk') {
      return `<div class="diff-row diff-hunk"><span class="diff-gutter"></span>`
           + `<span class="diff-gutter"></span><span class="diff-text">${escapeHtml(ln.text)}</span></div>`;
    }
    const cls = ln.type === 'add' ? 'diff-add' : ln.type === 'del' ? 'diff-del' : 'diff-ctx';
    const sign = ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ' ';
    return `<div class="diff-row ${cls}">`
         + `<span class="diff-gutter">${ln.oldNo || ''}</span>`
         + `<span class="diff-gutter">${ln.newNo || ''}</span>`
         + `<span class="diff-sign">${sign}</span>`
         + `<span class="diff-text">${escapeHtml(ln.text) || '&nbsp;'}</span></div>`;
  }).join('');
  $('diff-body').innerHTML = `<div class="diff-lines">${rows}</div>`;
  $('diff-body').scrollLeft = 0;
}
function closeDiffModal() { $('diff-overlay').classList.add('hidden'); }
