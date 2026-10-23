/* One tick per real user input; tool images/notices never become navigation stops. */
'use strict';
const conversationRuler = $('conversation-ruler');
const rulerPreview = $('ruler-preview');
let rulerBubbles = [];
let rulerFrame = 0;
let rulerPointer = null;
let rulerMotionFrame = 0;
let rulerMotionTime = 0;
const rulerReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Animate explicitly: CSS transitions are unreliable in some WebView2 builds.
// Only line lengths change, so the chat and click targets never shift.
function scheduleRulerMotion() {
  if (!rulerMotionFrame) rulerMotionFrame = requestAnimationFrame(animateRulerMotion);
}

function animateRulerMotion(now) {
  rulerMotionFrame = 0;
  const elapsed = rulerMotionTime ? Math.min(now - rulerMotionTime, 40) : 16;
  rulerMotionTime = now;
  const blend = rulerReducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 75);
  const bounds = conversationRuler.getBoundingClientRect();
  const pointer = rulerPointer;
  const dx = pointer ? Math.max(bounds.left - pointer.x, 0, pointer.x - bounds.right) : Infinity;
  const dy = pointer ? Math.max(bounds.top - pointer.y, 0, pointer.y - bounds.bottom) : Infinity;
  const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / 96);
  let moving = false;
  Array.from(conversationRuler.children).forEach((tick, index) => {
    const line = tick.firstElementChild;
    const rect = tick.getBoundingClientRect();
    const distance = pointer ? Math.abs(pointer.y - (rect.top + rect.bottom) / 2) : Infinity;
    const local = Math.max(0, 1 - distance / 80);
    const base = index % 5 === 0 ? 10 : 7;
    const target = tick.matches(':focus-visible') ? 30
      : base + proximity * (4 + local * local * (26 - base));
    const current = parseFloat(line.style.width) || base;
    const next = Math.abs(target - current) < 0.08 ? target : current + (target - current) * blend;
    line.style.width = `${next}px`;
    if (Math.abs(target - next) >= 0.08) moving = true;
  });
  if (moving) scheduleRulerMotion();
  else rulerMotionTime = 0;
}

function resetRulerPointer() {
  rulerPointer = null;
  hideRulerPreview();
  scheduleRulerMotion();
}

function hideRulerPreview() { rulerPreview.classList.add('hidden'); }

function rebuildConversationRuler() {
  hideRulerPreview();
  rulerBubbles = Array.from(chatMessages.querySelectorAll('.bubble-user[data-user-input="true"]'));
  conversationRuler.replaceChildren();
  conversationRuler.classList.toggle('hidden', !rulerBubbles.length || !$('home-view').classList.contains('hidden'));
  rulerBubbles.forEach((bubble, index) => {
    const tick = document.createElement('button');
    tick.className = 'ruler-tick';
    const preview = (bubble.querySelector('.bubble-content')?.textContent || '附件消息').replace(/\s+/g, ' ').trim();
    tick.setAttribute('aria-label', `第 ${index + 1} 条提问：${preview.slice(0, 100)}`);
    tick.innerHTML = '<span></span>';
    const show = () => {
      rulerPreview.textContent = `${index + 1} / ${rulerBubbles.length}  ${preview.slice(0, 220)}`;
      rulerPreview.classList.remove('hidden');
      const rect = tick.getBoundingClientRect();
      rulerPreview.style.left = `${rect.right + 8}px`;
      rulerPreview.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rulerPreview.offsetHeight - 8))}px`;
    };
    tick.addEventListener('mouseenter', show);
    tick.addEventListener('focus', show);
    tick.addEventListener('mouseleave', hideRulerPreview);
    tick.addEventListener('blur', hideRulerPreview);
    tick.addEventListener('click', () => {
      const area = $('chat-area');
      smoothScrollTo(bubble.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop - 8);
      hideRulerPreview();
    });
    conversationRuler.appendChild(tick);
  });
  scheduleRulerHighlight();
  scheduleRulerMotion();
}

function scheduleRulerHighlight() {
  if (rulerFrame) return;
  rulerFrame = requestAnimationFrame(() => {
    rulerFrame = 0;
    if (!rulerBubbles.length) return;
    const area = $('chat-area');
    const top = area.getBoundingClientRect().top + 20;
    let active = 0;
    rulerBubbles.forEach((bubble, index) => {
      if (bubble.getBoundingClientRect().top <= top) active = index;
    });
    if (area.scrollHeight - area.scrollTop - area.clientHeight < 4) active = rulerBubbles.length - 1;
    Array.from(conversationRuler.children).forEach((tick, index) => {
      tick.classList.toggle('active', index === active);
      if (index === active) tick.setAttribute('aria-current', 'true');
      else tick.removeAttribute('aria-current');
    });
  });
}

new MutationObserver(rebuildConversationRuler).observe(chatMessages, {childList: true});
new MutationObserver(rebuildConversationRuler).observe($('home-view'), {attributes: true, attributeFilter: ['class']});
new ResizeObserver(scheduleRulerHighlight).observe(chatMessages);
$('chat-area').addEventListener('scroll', scheduleRulerHighlight, {passive: true});
conversationRuler.addEventListener('scroll', () => {
  hideRulerPreview();
  scheduleRulerMotion();
}, {passive: true});
conversationRuler.addEventListener('focusin', scheduleRulerMotion);
conversationRuler.addEventListener('focusout', scheduleRulerMotion);
document.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  rulerPointer = {x: event.clientX, y: event.clientY};
  scheduleRulerMotion();
}, {passive: true});
document.documentElement.addEventListener('pointerleave', resetRulerPointer);
window.addEventListener('blur', resetRulerPointer);
new ResizeObserver(() => {
  hideRulerPreview();
  scheduleRulerMotion();
}).observe(conversationRuler);
rulerReducedMotion.addEventListener('change', scheduleRulerMotion);
window.addEventListener('resize', resetRulerPointer);
