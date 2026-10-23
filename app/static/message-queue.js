/* Window-lifetime queues, isolated by conversation (including background chats).
   Only generationReady may advance a queue: finishMessage precedes worker cleanup. */
'use strict';
const MESSAGE_QUEUE_LIMIT = 5;
let queuedMessageSerial = 0;

function renderMessageQueue() {
  const view = conversationView();
  const items = view.pendingMessages;
  const busy = view.running || view.awaitingReady || view.queueSending || view.queueStopping;
  $('message-queue').classList.toggle('hidden', items.length === 0);
  $('queue-status').textContent = `待发送 ${items.length} / ${MESSAGE_QUEUE_LIMIT} · ${view.queuePaused ? '已暂停' : '按顺序自动发送'}`;
  $('btn-queue-resume').classList.toggle('hidden', !view.queuePaused);
  $('queue-items').replaceChildren();
  for (const [index, item] of items.entries()) {
    const row = document.createElement('li');
    row.className = 'queue-item';
    const summary = document.createElement('span');
    summary.className = 'queue-summary';
    summary.textContent = `${index + 1}. ${item.text || '附件消息'}${item.files.length ? ` · ${item.files.map(f => f.name).join('、')}` : ''}`;
    summary.title = summary.textContent;
    const send = document.createElement('button');
    send.className = 'btn-action-pill';
    send.textContent = '立即发送';
    send.title = '中断当前生成，优先发送这条；其余消息保持顺序';
    const cid = state.currentConvId;
    send.addEventListener('click', () => prioritizeQueuedMessage(cid, item.id));
    const remove = document.createElement('button');
    remove.className = 'queue-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除第 ${index + 1} 条待发送消息`);
    remove.addEventListener('click', () => {
      view.pendingMessages = view.pendingMessages.filter(m => m.id !== item.id);
      renderMessageQueue();
    });
    row.append(summary, send, remove);
    $('queue-items').appendChild(row);
  }
  btnSend.disabled = items.length + Number(view.queueSending) >= MESSAGE_QUEUE_LIMIT;
  btnSend.textContent = busy || items.length ? '加入队列' : '发送';
  btnSend.title = 'Enter 发送；生成期间加入队列，最多等待 5 条';
  $('btn-send-now').classList.toggle('hidden', !busy && !items.length);
  $('btn-send-now').disabled = btnSend.disabled;
  btnStop.disabled = !busy;
  $('btn-undo').disabled = busy || items.length > 0 || _undoUsed;
  $('btn-retry').disabled = busy || items.length > 0;
  $('btn-debate').disabled = busy || items.length > 0;
}

function refreshMessageQueue(id) {
  if (id === state.currentConvId) renderMessageQueue();
}

function enqueueMessage(id, text, files, immediate = false) {
  const view = conversationView(id);
  if (view.pendingMessages.length + Number(view.queueSending) >= MESSAGE_QUEUE_LIMIT) {
    addNoticeBubble('待发送队列已满（5 条），请等待发送或移除一条后再试。');
    return false;
  }
  const item = {id: ++queuedMessageSerial, text, files};
  if (!view.pendingMessages.length && !view.running && !view.awaitingReady && !view.queueSending) view.queuePaused = false;
  if (immediate) view.pendingMessages.unshift(item);
  else view.pendingMessages.push(item);
  if (immediate) {
    view.queuePaused = false;
    interruptQueuedGeneration(id);
  } else {
    void pumpMessageQueue(id);
  }
  refreshMessageQueue(id);
  return true;
}

function prioritizeQueuedMessage(id, itemId) {
  const view = conversationView(id);
  const index = view.pendingMessages.findIndex(m => m.id === itemId);
  if (index < 0) return;
  view.pendingMessages.unshift(...view.pendingMessages.splice(index, 1));
  view.queuePaused = false;
  interruptQueuedGeneration(id);
  refreshMessageQueue(id);
}

function interruptQueuedGeneration(id) {
  const view = conversationView(id);
  view.interruptPending = Boolean(view.running || view.awaitingReady || view.queueSending);
  // The bridge may still be reserving the session. Stop after its acknowledgement.
  if (view.queueSending) view.stopAfterSubmit = true;
  else if (view.running || view.awaitingReady) void requestQueueStop(id);
  else void pumpMessageQueue(id);
}

async function requestQueueStop(id) {
  const view = conversationView(id);
  if (view.queueStopping) return;
  view.queueStopping = true;
  try {
    await window.pywebview.api.stop_generation(id);
  } catch (error) {
    view.queuePaused = true;
    view.interruptPending = false;
    receiveConversationEvent(id, () => addNoticeBubble(`停止失败，队列已暂停：${error}`));
  } finally {
    view.queueStopping = false;
    refreshMessageQueue(id);
    void pumpMessageQueue(id);
  }
}

function stopMessageQueue(id) {
  const view = conversationView(id);
  view.queuePaused = true;
  view.interruptPending = false;
  if (view.queueSending) view.stopAfterSubmit = true;
  else void requestQueueStop(id);
  refreshMessageQueue(id);
}

function showQueuedMessage(item) {
  _undoUsed = false;
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  const markers = item.files.map(file => {
    const kind = imageExts.includes(file.name.split('.').pop().toLowerCase()) ? '图片' : '附件';
    return `[${kind}: ${file.name} 路径: ${file.path}]`;
  });
  // /compact has no real user turn in persisted history.
  if (item.text !== '/compact' || item.files.length) {
    addUserBubble([...markers, item.text].filter(Boolean).join('\n\n'));
    startAssistantStream();
  }
  scrollToBottom(true);
  setRunning(true);
}

async function pumpMessageQueue(id) {
  const view = conversationView(id);
  if (view.queuePaused || view.queueSending || view.queueStopping || view.awaitingReady || view.running || !view.pendingMessages.length) return;
  const item = view.pendingMessages.shift();
  view.queueSending = true;
  view.awaitingReady = true;
  receiveConversationEvent(id, () => showQueuedMessage(item), 'start');
  refreshMessageQueue(id);
  try {
    const result = await window.pywebview.api.send_message(id, item.text, item.files);
    if (result && result.ok === false) throw new Error(result.error || '发送失败');
  } catch (error) {
    view.queuePaused = true;
    view.awaitingReady = false;
    // Keep a rejected submission available for explicit retry, never auto-loop.
    view.pendingMessages.unshift(item);
    receiveConversationEvent(id, () => Chat.showError(String(error)), 'done');
  } finally {
    view.queueSending = false;
    const stop = view.stopAfterSubmit;
    view.stopAfterSubmit = false;
    if (stop && view.awaitingReady) await requestQueueStop(id);
    refreshMessageQueue(id);
    // Handles a very fast generationReady arriving before send_message resolves.
    if (!view.awaitingReady) void pumpMessageQueue(id);
  }
}

Chat.generationReady = (id, failed = false) => {
  const view = conversationView(id);
  view.awaitingReady = false;
  view.running = false;
  // Some providers report cancellation as an error. An explicit interruption
  // still advances to the chosen message after cleanup; ordinary errors pause.
  if (failed && !view.interruptPending) view.queuePaused = true;
  view.interruptPending = false;
  refreshMessageQueue(id);
  void pumpMessageQueue(id);
};

$('btn-send-now').addEventListener('click', () => sendMessage(true));
$('btn-queue-resume').addEventListener('click', () => {
  const id = state.currentConvId;
  conversationView(id).queuePaused = false;
  refreshMessageQueue(id);
  void pumpMessageQueue(id);
});
