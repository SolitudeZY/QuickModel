/* Per-conversation view state. Background callbacks are replayed in order only
   when their conversation is visible; the model continues running in Python. */
'use strict';
const conversationViews = new Map();
let conversationOpenSerial = 0;
let dialogConversationId = null;

function conversationView(id = state.currentConvId) {
  if (!conversationViews.has(id)) conversationViews.set(id, {
    draft: '', files: [], chips: [], nodes: null, running: false, events: [], runtime: null,
  });
  return conversationViews.get(id);
}

function saveConversationView() {
  const view = conversationView();
  view.draft = msgInput.value;
  view.files = state.attachedFiles;
  view.chips = Array.from(fileChips.childNodes);
  view.nodes = Array.from(chatMessages.childNodes);
  view.running = state.running;
  view.runtime = { _streamBubble, _streamContent, _typingEl, _streamingConvId,
    _streamNodes, _thinkingBubble, _thinkingContent, _toolStreak, _toolFoldContainer, _undoUsed };
  view.panels = ['todo-panel', 'fileops-panel'].map(id => ({
    id, hidden: $(id).classList.contains('hidden'),
    nodes: Array.from($(id === 'todo-panel' ? 'todo-list' : 'fileops-list').childNodes),
  }));
  view.usage = ['cost-round', 'cost-session', 'cost-cache'].map(id => $(id).textContent);
}

function switchConversationView(id, carryDraft = false) {
  saveConversationView();
  const previous = conversationView();
  state.currentConvId = id;
  const view = conversationView(id);
  // Idle history must still refresh from disk (sync, edits, project changes).
  const retainHistory = view.nodes !== null && (view.running || view.events.length > 0
    || Boolean(view.runtime && view.runtime._streamingConvId));
  if (carryDraft) {
    view.draft = previous.draft; view.files = previous.files; view.chips = previous.chips;
    previous.draft = ''; previous.files = []; previous.chips = [];
  }
  msgInput.value = view.draft;
  state.attachedFiles = view.files;
  fileChips.replaceChildren(...view.chips);
  const r = view.runtime || {};
  _streamBubble = r._streamBubble || null;
  _streamContent = r._streamContent || '';
  _typingEl = r._typingEl || null;
  _streamingConvId = r._streamingConvId || null;
  _streamNodes = r._streamNodes || [];
  _thinkingBubble = r._thinkingBubble || null;
  _thinkingContent = r._thinkingContent || '';
  _toolStreak = r._toolStreak || 0;
  _toolFoldContainer = r._toolFoldContainer || null;
  _undoUsed = r._undoUsed || false;
  chatMessages.replaceChildren(...(view.nodes || []));
  for (const panel of view.panels || []) {
    $(panel.id).classList.toggle('hidden', panel.hidden);
    $(panel.id === 'todo-panel' ? 'todo-list' : 'fileops-list').replaceChildren(...panel.nodes);
  }
  if (!view.panels) { Chat.updateTodo([]); Chat.updateFileOps([]); }
  ['cost-round', 'cost-session', 'cost-cache'].forEach((id, i) => {
    $(id).textContent = view.usage ? view.usage[i] : ['本轮输出: 0', '本次输出: 0', '缓存: -'][i];
  });
  setRunning(view.running);
  const events = view.events.splice(0);
  for (const event of events) receiveConversationEvent(id, event.callback, event.kind);
  slashMenuHide();
  return retainHistory;
}

function receiveConversationEvent(id, callback, kind = 'event') {
  if (kind === 'title') { callback(); return; }
  const view = conversationView(id);
  if (kind === 'dialog') view.waiting = true;
  if (kind === 'done' || kind === 'dialogEnd') {
    if (kind === 'done') view.running = false;
    view.waiting = false;
    view.events = view.events.filter(event => event.kind !== 'dialog');
  }
  if (['done', 'dialog', 'dialogEnd'].includes(kind)) renderConvList(searchInput.value);
  if (id !== state.currentConvId) {
    view.events.push({ callback, kind });
    return;
  }
  if (kind === 'dialog') dialogConversationId = id;
  if (['done', 'dialogEnd'].includes(kind) && dialogConversationId === id) {
    _clearCountdown();
    ['confirm-overlay', 'ask-overlay', 'secret-overlay', 'plan-overlay'].forEach(id => $(id)?.classList.add('hidden'));
    $('secret-input').value = '';
    dialogConversationId = null;
  }
  callback();
}
