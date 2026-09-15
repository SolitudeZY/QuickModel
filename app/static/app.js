/* app.js — AI Desktop Assistant 主逻辑（会话/气泡/流式/输入/Chat 回调/init）。
   加载顺序见 index.html：vendor → core.js → render.js → drag.js → dialogs.js
   → settings.js → app.js。core.js 提供 state/$/DOM 引用，render.js 提供
   renderMarkdown/escapeHtml/scrollToBottom，本文件依赖它们（运行时解析，安全）。 */
'use strict';

// ── Init ──────────────────────────────────────────────────────────
// ── Scroll speed boost (removed: was blocking native scroll) ─────

window.addEventListener('pywebviewready', async () => {
  state.config = await window.pywebview.api.get_config();
  applyTheme(state.config.theme_mode || state.config.theme || 'auto');
  applyFontSize(state.config.font_size || 14);
  if (typeof applyStarfieldSettings === 'function') applyStarfieldSettings(state.config);
  startWeatherBackground();
  populateModelSelect();
  // Restore persistent toggle states
  const uiState = await window.pywebview.api.get_ui_state();
  initThinkingBtn(uiState.thinking);
  initSearchBtn(uiState.search_mode, uiState.search_enabled);
  state.conversations = await window.pywebview.api.list_conversations();
  updateArchiveViewButton();
  renderConvList();
  const firstActiveConversation = state.conversations.find(conv => !conv.archived);
  if (firstActiveConversation) {
    await openConversation(firstActiveConversation.id);
  } else {
    await newConversation();
  }
  // 启动时自动检测云同步新对话
  if (state.config.sync_folder) {
    const newItems = await window.pywebview.api.sync_detect_new();
    if (newItems && newItems.length > 0) {
      document.title = `QuickModel — ${newItems.length} 个云端新对话可导入`;
    }
  }
  // Track page visibility for system notifications
  document.addEventListener('visibilitychange', () => {
    window.pywebview.api.set_window_visible(!document.hidden);
  });
  window.addEventListener('focus', () => window.pywebview.api.set_window_visible(true));
  window.addEventListener('blur', () => window.pywebview.api.set_window_visible(false));
});

// ── Theme / font ──────────────────────────────────────────────────
let _themeTimer = 0;
let _weatherTimer = 0;
let _weatherInFlight = false;
let _themeAnimation = 0;
let _activeThemePalette = null;
let _weatherRequestSeq = 0;
let _lastWeatherResult = null;
let _lastWeatherGoodAt = 0;
let _lastWeatherKey = '';

const _WEATHER_PREVIEWS = {
  clear: { weather_code: 0, condition: 'clear', label: '晴天', cloud_cover: 0, wind_speed: 3 },
  cloudy: { weather_code: 3, condition: 'cloudy', label: '多云', cloud_cover: 88, wind_speed: 8 },
  rain: { weather_code: 63, condition: 'rain', label: '雨', cloud_cover: 92, wind_speed: 14, precipitation: 2 },
  snow: { weather_code: 73, condition: 'snow', label: '雪', cloud_cover: 90, wind_speed: 8, snowfall: 2 },
  fog: { weather_code: 45, condition: 'fog', label: '雾', cloud_cover: 100, wind_speed: 2 },
  thunder: { weather_code: 95, condition: 'thunder', label: '雷暴', cloud_cover: 100, wind_speed: 22, precipitation: 4 },
};

function _weatherEffectsEnabled(cfg) {
  if (!cfg) return false;
  const preview = cfg.weather_preview || 'auto';
  const explicitWeather = ['cloudy', 'rain', 'snow', 'fog', 'thunder'].includes(preview);
  return cfg.weather_enabled !== false || explicitWeather;
}

const _THEME_PALETTES = {
  night: {
    '--bg': '#1a1b26', '--bg2': '#16161e', '--bg3': '#292e42', '--surface': '#24283b',
    '--border': '#3b4261', '--text': '#c0caf5', '--text-muted': '#565f89', '--text-dim': '#9aa5ce',
    '--accent': '#7aa2f7', '--accent-hover': '#89b4fa', '--user-bubble': '#1a2744',
    '--asst-bubble': '#24283b', '--tool-bubble': '#1a2a1e', '--error-bubble': '#321621',
    '--code-bg': '#16161e', '--code-fg': '#c0caf5', '--danger': '#f7768e', '--danger-hover': '#ff9e9e',
    '--hover': 'rgba(255,255,255,0.05)', '--glow-accent': 'rgba(122,162,247,0.20)',
    '--main-overlay': 'rgba(12,14,27,0.62)', '--panel-overlay': 'rgba(18,20,34,0.78)', '--chat-overlay': 'rgba(9,11,22,0.14)',
  },
  day: {
    '--bg': '#f3f5f6', '--bg2': '#eaedef', '--bg3': '#dde3e5', '--surface': '#ffffff',
    '--border': '#c8d0d3', '--text': '#1f2930', '--text-muted': '#69767d', '--text-dim': '#4b5a62',
    '--accent': '#2e6f95', '--accent-hover': '#245b79', '--user-bubble': '#e5f0f4',
    '--asst-bubble': '#ffffff', '--tool-bubble': '#e4f5e8', '--error-bubble': '#fde8ec',
    '--code-bg': '#e9edef', '--code-fg': '#1f2930', '--danger': '#c0392b', '--danger-hover': '#e74c3c',
    '--hover': 'rgba(0,0,0,0.04)', '--glow-accent': 'rgba(46,111,149,0.12)',
    '--main-overlay': 'rgba(248,251,255,0.62)', '--panel-overlay': 'rgba(255,255,255,0.84)', '--chat-overlay': 'rgba(255,255,255,0.22)',
  },
  dusk: {
    '--bg': '#f4ebe7', '--bg2': '#eee1dc', '--bg3': '#e3d2ca', '--surface': '#fffaf7',
    '--border': '#d8c0b6', '--text': '#392b29', '--text-muted': '#876e67', '--text-dim': '#654e49',
    '--accent': '#b35f4d', '--accent-hover': '#944c3d', '--user-bubble': '#fae6dc',
    '--asst-bubble': '#fffaf7', '--tool-bubble': '#edf0dd', '--error-bubble': '#fce5e0',
    '--code-bg': '#eee1db', '--code-fg': '#392b29', '--danger': '#b84436', '--danger-hover': '#96382d',
    '--hover': 'rgba(106,64,49,0.06)', '--glow-accent': 'rgba(179,95,77,0.14)',
    '--main-overlay': 'rgba(255,247,242,0.64)', '--panel-overlay': 'rgba(255,250,247,0.86)', '--chat-overlay': 'rgba(255,247,242,0.24)',
  },
};

function _parseCssColor(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
  }
  const match = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map(item => Number(item.trim()));
  return parts.length >= 3 ? [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1] : null;
}

function _formatCssColor(color) {
  const [r, g, b, a] = color.map((value, index) => index < 3 ? Math.round(value) : value);
  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function _setThemePalette(palette) {
  Object.entries(palette).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
  _activeThemePalette = palette;
}

function _animateThemePalette(from, to, duration) {
  if (_themeAnimation) cancelAnimationFrame(_themeAnimation);
  if (!duration || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    _setThemePalette(to);
    return;
  }
  const started = performance.now();
  const keys = Object.keys(to);
  const source = from || to;
  const frames = keys.map(key => [_parseCssColor(source[key]), _parseCssColor(to[key])]);
  const tick = now => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = progress * (2 - progress);
    const palette = {};
    keys.forEach((key, index) => {
      const [a, b] = frames[index];
      palette[key] = a && b ? _formatCssColor(a.map((value, channel) => value + (b[channel] - value) * eased)) : to[key];
    });
    _setThemePalette(palette);
    if (progress < 1) _themeAnimation = requestAnimationFrame(tick);
    else _themeAnimation = 0;
  };
  _themeAnimation = requestAnimationFrame(tick);
}

function _themeModeValue(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'light') return 'day';
  if (mode === 'dark') return 'night';
  return ['auto', 'day', 'dusk', 'night'].includes(mode) ? mode : 'auto';
}

function applyTheme(themeMode, force = false) {
  const mode = _themeModeValue(themeMode);
  const period = resolveThemePeriod(mode);
  const periodChanged = document.documentElement.dataset.period !== period;
  const targetPalette = _THEME_PALETTES[period] || _THEME_PALETTES.night;
  const previousPalette = _activeThemePalette || _THEME_PALETTES[document.documentElement.dataset.period] || _THEME_PALETTES.night;
  document.documentElement.dataset.theme = period === 'night' ? 'dark' : 'light';
  document.documentElement.dataset.period = period;
  document.documentElement.style.colorScheme = period === 'night' ? 'dark' : 'light';
  if (state.config) state.config.resolved_period = period;
  _animateThemePalette(previousPalette, targetPalette, periodChanged ? 1400 : 0);
  if (force || periodChanged || !document.documentElement.dataset.starfield) {
    if (typeof applyStarfieldSettings === 'function') applyStarfieldSettings(state.config);
  }
  if (_themeTimer) clearInterval(_themeTimer);
  _themeTimer = mode === 'auto' ? setInterval(() => applyTheme(mode), 60000) : 0;
}

function _getDeviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('当前 WebView 不支持定位')); return; }
    navigator.geolocation.getCurrentPosition(
      position => resolve(position.coords),
      error => reject(new Error(error && error.message ? error.message : '定位未授权')),
      { enableHighAccuracy: false, maximumAge: 3600000, timeout: 5000 },
    );
  });
}

async function refreshWeatherBackground() {
  if (!state.config || !_weatherEffectsEnabled(state.config) || state.config.starfield_enabled !== true || !window.pywebview) return;
  const preview = state.config.weather_preview || 'auto';
  if (preview !== 'auto' && _WEATHER_PREVIEWS[preview]) {
    _weatherRequestSeq += 1;
    const previewWeather = {
      ok: true,
      fallback: false,
      ..._WEATHER_PREVIEWS[preview],
      location: { name: '手动预览', source: 'preview' },
    };
    setStarfieldWeather(previewWeather);
    const previewStatus = $('weather-status');
    if (previewStatus) previewStatus.textContent = `天气预览：${_WEATHER_PREVIEWS[preview].label}`;
    return;
  }
  if (_weatherInFlight) return;
  _weatherInFlight = true;
  const requestId = ++_weatherRequestSeq;
  try {
    const locationMode = state.config.weather_location_mode || 'ip';
    const requestKey = `${locationMode}:${state.config.weather_city || ''}`;
    let result;
    if (locationMode === 'ip') {
      result = await window.pywebview.api.get_weather(null, null, state.config.weather_city || '', true);
    } else if (locationMode === 'manual') {
      result = await window.pywebview.api.get_weather(null, null, state.config.weather_city || '');
    } else {
      try {
        const coords = await _getDeviceLocation();
        result = await window.pywebview.api.get_weather(coords.latitude, coords.longitude, '');
      } catch (error) {
        result = await window.pywebview.api.get_weather(null, null, state.config.weather_city || '');
      }
    }
    if (requestId !== _weatherRequestSeq) return;
    if (result && !result.fallback) {
      _lastWeatherResult = result;
      _lastWeatherGoodAt = Date.now();
      _lastWeatherKey = requestKey;
    } else if (_lastWeatherResult && _lastWeatherKey === requestKey && Date.now() - _lastWeatherGoodAt < 7200000) {
      result = { ..._lastWeatherResult, cached: true, stale: true };
    }
    const safeResult = result || { ok: true, fallback: true, weather_code: 0 };
    setStarfieldWeather(safeResult);
    const status = $('weather-status');
    if (status) {
      const source = safeResult.location && safeResult.location.source;
      const sourceLabel = source === 'ip' ? '（IP 大致定位）' : source === 'manual' ? '（手动城市）' : '';
      status.textContent = safeResult.fallback
        ? '天气：晴天（未获取到定位或天气数据）'
        : `天气：${safeResult.location && safeResult.location.name ? safeResult.location.name : '已更新'}${sourceLabel}`;
    }
  } catch (error) {
    if (requestId === _weatherRequestSeq) setStarfieldWeather({ ok: true, fallback: true, weather_code: 0 });
  } finally {
    _weatherInFlight = false;
  }
}

function startWeatherBackground() {
  if (_weatherTimer) clearInterval(_weatherTimer);
  _weatherTimer = 0;
  _weatherRequestSeq += 1;
  if (!state.config || !_weatherEffectsEnabled(state.config) || state.config.starfield_enabled !== true) {
    setStarfieldWeather({ ok: true, fallback: true, weather_code: 0 });
    return;
  }
  refreshWeatherBackground();
  if ((state.config.weather_preview || 'auto') !== 'auto') return;
  const minutes = Math.max(15, Math.min(Number(state.config.weather_refresh_minutes) || 30, 180));
  _weatherTimer = setInterval(refreshWeatherBackground, minutes * 60000);
}

window.addEventListener('focus', () => {
  if (_weatherEffectsEnabled(state.config)) refreshWeatherBackground();
});
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
function _fmtConvTime(iso, full = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  if (full) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
                  : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setTemporaryMode(temporary) {
  state.temporaryConversation = Boolean(temporary);
  $('temporary-badge').classList.toggle('hidden', !state.temporaryConversation);
}

function updateBatchConversationBar() {
  $('batch-conversation-bar').classList.toggle('hidden', !state.conversationManageMode);
  $('btn-manage-convs').classList.toggle('active', state.conversationManageMode);
  $('btn-manage-convs').textContent = state.conversationManageMode ? '完成' : '管理';
  $('batch-selected-count').textContent = `已选 ${state.selectedConversationIds.size}`;
  $('btn-batch-archive').textContent = state.showArchived ? '恢复' : '归档';
  const hasSelection = state.selectedConversationIds.size > 0;
  $('btn-batch-clear').disabled = !hasSelection;
  $('btn-batch-archive').disabled = !hasSelection;
  $('btn-batch-delete').disabled = !hasSelection;
}

function setConversationSelected(convId, selected, li = null) {
  if (selected) state.selectedConversationIds.add(convId);
  else state.selectedConversationIds.delete(convId);
  if (li) {
    li.classList.toggle('batch-selected', selected);
    const checkbox = li.querySelector('.conv-batch-check');
    if (checkbox) checkbox.checked = selected;
  }
  updateBatchConversationBar();
}

function toggleConversationManageMode(force) {
  state.conversationManageMode = typeof force === 'boolean'
    ? force : !state.conversationManageMode;
  state.selectedConversationIds.clear();
  updateBatchConversationBar();
  renderConvList(searchInput.value);
}

async function refreshConversationsAfterBulkAction() {
  state.conversations = await window.pywebview.api.list_conversations();
  state.selectedConversationIds.clear();
  updateArchiveViewButton();
  renderConvList(searchInput.value);
  if (state.temporaryConversation) return;
  const current = state.conversations.find(item => item.id === state.currentConvId);
  if (!current || Boolean(current.archived) !== state.showArchived) {
    await showFirstConversationInCurrentView();
  }
}

async function bulkArchiveSelected() {
  const ids = [...state.selectedConversationIds];
  if (!ids.length) return;
  const result = await window.pywebview.api.bulk_archive_conversations(ids, !state.showArchived);
  if (!result || !result.ok) {
    alert((result && result.error) || '批量操作失败');
    return;
  }
  await refreshConversationsAfterBulkAction();
}

async function bulkDeleteSelected() {
  const ids = [...state.selectedConversationIds];
  if (!ids.length) return;
  if (!confirm(`确定永久删除选中的 ${ids.length} 条会话吗？\n\n此操作不可撤销。`)) return;
  const result = await window.pywebview.api.bulk_delete_conversations(ids);
  if (!result || !result.ok) {
    alert((result && result.error) || '批量删除失败');
    return;
  }
  await refreshConversationsAfterBulkAction();
}

function _makeConvLi(conv, idx) {
  const li = document.createElement('li');
  li.dataset.id = conv.id;
  li.dataset.idx = idx;
  if (conv.id === state.currentConvId) {
    li.classList.add('active');
    li.style.borderLeftColor = _randomConvColor();
    li.style.boxShadow = `inset 4px 0 0 ${li.style.borderLeftColor}, 0 0 12px ${li.style.borderLeftColor}33`;
  }
  if (state.conversationManageMode) {
    li.classList.add('manage-selecting');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'conv-batch-check';
    checkbox.checked = state.selectedConversationIds.has(conv.id);
    li.classList.toggle('batch-selected', checkbox.checked);
    checkbox.addEventListener('click', event => {
      event.stopPropagation();
      setConversationSelected(conv.id, checkbox.checked, li);
    });
    li.appendChild(checkbox);
  }

  const titleWrap = document.createElement('div');
  titleWrap.className = 'conv-title-wrap';
  titleWrap.style.flex = '1';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'conv-title';
  titleSpan.textContent = conv.title;
  titleWrap.appendChild(titleSpan);
  const timeSpan = document.createElement('span');
  timeSpan.className = 'conv-time';
  timeSpan.textContent = _fmtConvTime(conv.updated_at);
  titleWrap.appendChild(timeSpan);
  li.appendChild(titleWrap);
  // hover 显示完整创建/更新时间
  const _c = _fmtConvTime(conv.created_at, true);
  const _u = _fmtConvTime(conv.updated_at, true);
  li.title = `创建：${_c || '未知'}\n更新：${_u || '未知'}`;

  const actions = document.createElement('div');
  actions.className = 'conv-actions';
  const btnRename = document.createElement('button');
  btnRename.textContent = '✏';
  btnRename.title = '重命名';
  btnRename.addEventListener('click', e => { e.stopPropagation(); showRenameDialog(conv.id, conv.title); });
  const btnArchive = document.createElement('button');
  btnArchive.textContent = conv.archived ? '↩' : '▣';
  btnArchive.title = conv.archived ? '恢复会话' : '归档会话';
  btnArchive.addEventListener('click', e => {
    e.stopPropagation();
    archiveConversation(conv.id, !conv.archived);
  });
  const btnDel = document.createElement('button');
  btnDel.textContent = '🗑';
  btnDel.title = '删除';
  btnDel.addEventListener('click', e => { e.stopPropagation(); deleteConversation(conv.id); });
  actions.appendChild(btnRename);
  actions.appendChild(btnArchive);
  actions.appendChild(btnDel);
  if (!state.conversationManageMode) li.appendChild(actions);

  li.addEventListener('click', () => {
    if (state.conversationManageMode) {
      setConversationSelected(conv.id, !state.selectedConversationIds.has(conv.id), li);
      return;
    }
    // 刚结束一次拖拽时抑制点击（mouseup 与 click 会连续触发）
    if (_drag.justDragged) { _drag.justDragged = false; return; }
    openConversation(conv.id);
  });

  // 手动拖拽排序：WebView2 对 HTML5 原生拖放（draggable/dragstart/drop）支持不可靠
  // （与 CSS transition 失效同源，见 memory css-transition-bug），改用 mouse 事件实现。
  li.draggable = false;
  // ⚠ 关键：阻止 WebView2 启动原生拖放。否则 mousedown 后浏览器接管为原生 drag，
  // mousemove 停止触发（变成 dragover），手动引擎收不到移动 → 只剩「禁止」光标+拖影。
  // 注意不能在 mousedown 上 preventDefault（会连带阻止 click，单击就打不开会话了），
  // 只在 dragstart 上挡；文本选中触发的拖放由 CSS user-select/-webkit-user-drag 兜底。
  li.addEventListener('dragstart', e => e.preventDefault());
  li.addEventListener('mousedown', e => {
    if (state.conversationManageMode) return;
    if (e.button !== 0) return;            // 仅左键
    if (e.target.closest('.conv-actions')) return;  // 点重命名/删除按钮不触发拖拽
    _beginDragCandidate(conv.id, li, e);
  });
  return li;
}

function renderConvList(filter = '', contentResults = []) {
  convList.innerHTML = '';
  state.visibleConversationIds = [];
  const kw = filter.toLowerCase();
  const resultIds = new Set(contentResults.map(result => result.id));
  const contentMatches = new Map(
    contentResults.filter(result => result.match === 'content')
      .map(result => [result.id, result])
  );

  // 按 project_path 分组（保持 state.conversations 的全局顺序）
  const groups = new Map();  // path -> [{conv, idx}]
  state.conversations.forEach((conv, idx) => {
    if (Boolean(conv.archived) !== state.showArchived) return;
    if (kw && !(conv.title || '').toLowerCase().includes(kw) && !resultIds.has(conv.id)) return;
    const key = conv.project_path || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ conv, idx });
  });
  state.visibleConversationIds = [...groups.values()]
    .flatMap(items => items.map(item => item.conv.id));
  updateBatchConversationBar();

  if (groups.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'conv-list-empty';
    empty.textContent = kw
      ? '没有匹配的会话'
      : (state.showArchived ? '暂无归档会话' : '暂无会话');
    convList.appendChild(empty);
    return;
  }

  const projName = path => {
    if (!path) return '未分类';
    return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
  };

  for (const [path, items] of groups) {
    const group = document.createElement('div');
    group.className = 'conv-group';
    // 搜索时强制展开命中组
    const collapsed = !kw && state.collapsedGroups[path];

    const header = document.createElement('div');
    header.className = 'conv-group-header';
    header.title = path || '未绑定项目的会话';
    header.innerHTML = `<span class="cg-arrow">${collapsed ? '▶' : '▼'}</span>`
                     + `<span class="cg-name">${escapeHtml(projName(path))}</span>`
                     + `<span class="cg-count">${items.length}</span>`;
    header.addEventListener('click', () => {
      state.collapsedGroups[path] = !state.collapsedGroups[path];
      renderConvList(searchInput.value);
    });
    // 真实项目组（path 非空）加「+新对话」按钮：直接在该项目下开新会话。
    // 用 addEventListener + stopPropagation，避免触发折叠；不用内联 onclick（Windows 路径转义坑）。
    if (path && !state.showArchived && !state.conversationManageMode) {
      const addBtn = document.createElement('button');
      addBtn.className = 'cg-add';
      addBtn.textContent = '+';
      addBtn.title = '在该项目中新建对话';
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        startConvWithProject(path);
      });
      header.appendChild(addBtn);
    }

    if (path && !state.conversationManageMode) {
      const archiveProjectBtn = document.createElement('button');
      archiveProjectBtn.className = 'cg-archive';
      archiveProjectBtn.textContent = state.showArchived ? '↩' : '▣';
      archiveProjectBtn.title = state.showArchived ? '恢复整个项目' : '归档整个项目';
      archiveProjectBtn.addEventListener('click', e => {
        e.stopPropagation();
        archiveProject(path, !state.showArchived, projName(path));
      });
      header.appendChild(archiveProjectBtn);
    }
    // 供手动拖拽 _updateDropTarget 命中组标题时读取目标组（拖到组头=归入该组）
    header._groupKey = path;
    group.appendChild(header);

    if (!collapsed) {
      const ul = document.createElement('ul');
      ul.className = 'conv-group-items';
      const expanded = Boolean(state.expandedConversationGroups[path]);
      const visibleItems = (kw || expanded || state.conversationManageMode) ? items : items.slice(0, 5);
      visibleItems.forEach(({ conv, idx }) => {
        const item = _makeConvLi(conv, idx);
        const match = contentMatches.get(conv.id);
        if (match) {
          item.classList.add('search-content-match');
          const snippet = document.createElement('div');
          snippet.className = 'conv-snippet';
          snippet.textContent = match.snippet || '';
          item.querySelector('.conv-title-wrap').appendChild(snippet);
        }
        ul.appendChild(item);
      });
      if (!kw && !state.conversationManageMode && items.length > 5) {
        const more = document.createElement('button');
        more.className = 'conv-group-more';
        more.textContent = expanded ? '收起较早会话' : `显示另外 ${items.length - 5} 条`;
        more.addEventListener('click', e => {
          e.stopPropagation();
          state.expandedConversationGroups[path] = !expanded;
          renderConvList(searchInput.value);
        });
        ul.appendChild(more);
      }
      group.appendChild(ul);
    }
    convList.appendChild(group);
  }
}

searchInput.addEventListener('input', () => {
  const kw = searchInput.value.trim();
  state.searchSerial += 1;
  // Instant title filter for responsiveness
  renderConvList(kw);
  // Debounced content search for deeper matches
  clearTimeout(searchInput._debounce);
  if (!kw) { _clearSearchHighlights(); return; }
  searchInput._debounce = setTimeout(() => _runContentSearch(kw), 300);
});

async function _runContentSearch(kw) {
  if (!kw) return;
  const serial = state.searchSerial;
  const results = await window.pywebview.api.search_conversations(kw);
  if (serial !== state.searchSerial || searchInput.value.trim() !== kw) return;
  _applyContentSearchResults(results, kw);
}

function _clearSearchHighlights() {
  convList.querySelectorAll('.conv-snippet').forEach(el => el.remove());
  convList.querySelectorAll('li.search-content-match').forEach(li => li.classList.remove('search-content-match'));
}

function _applyContentSearchResults(results, kw) {
  _clearSearchHighlights();
  if (!results || results.length === 0) return;
  results = results.filter(result => Boolean(result.archived) === state.showArchived);
  if (results.length === 0) return;
  renderConvList(kw, results);
}

async function openConversation(convId) {
  if (state.temporaryConversation && state.currentConvId !== convId) {
    const discarded = await window.pywebview.api.discard_temporary_conversation(state.currentConvId);
    if (!discarded || !discarded.ok) {
      alert((discarded && discarded.error) || '临时会话仍在生成，暂时无法切换');
      return;
    }
  }
  const conv = await window.pywebview.api.open_conversation(convId);
  if (!conv) return;
  hideHome();
  state.currentConvId = convId;
  setTemporaryMode(conv.temporary === true);
  convTitle.textContent = conv.title;
  const summary = state.conversations.find(item => item.id === convId);
  if (summary) {
    const groupPath = summary.project_path || '';
    const groupIndex = state.conversations
      .filter(item => (item.project_path || '') === groupPath
        && Boolean(item.archived) === state.showArchived)
      .findIndex(item => item.id === convId);
    if (groupIndex >= 5) state.expandedConversationGroups[groupPath] = true;
  }
  const kw = searchInput.value.trim();
  renderConvList(kw);
  // Re-apply content search results so the list doesn't disappear
  if (kw) _runContentSearch(kw);
  loadHistory(conv.messages || []);
  // 项目目录在本机不存在时提示（多为跨机器同步导致的绝对路径失效）
  if (conv.project_path && conv.project_exists === false) {
    const banner = document.createElement('div');
    banner.className = 'project-missing-banner';
    banner.innerHTML = `⚠ 该会话绑定的项目目录在本机不存在：<code>${escapeHtml(conv.project_path)}</code>`
                     + `<br>模型读写文件/执行命令可能失败。`
                     + `<button class="btn-reset-project btn-secondary">重设目录</button>`;
    banner.querySelector('.btn-reset-project').addEventListener('click', () => resetConversationProject(convId));
    chatMessages.insertBefore(banner, chatMessages.firstChild);
  }
  // If this conversation is currently streaming, re-attach all stream nodes
  if (_streamingConvId === convId && _streamNodes.length > 0) {
    _streamNodes.forEach(node => chatMessages.appendChild(node));
    if (_typingEl) chatMessages.appendChild(_typingEl);
    scrollToBottom();
  }
  Chat.updateFileOps(conv.file_ops || []);
  // 刷新上下文用量
  const ctx = await window.pywebview.api.get_context_usage(convId);
  updateContextBar(ctx.used, ctx.total);
  // Highlight and scroll to keyword match in chat
  if (kw) {
    requestAnimationFrame(() => _highlightAndScrollTo(kw));
  } else {
    requestAnimationFrame(() => scrollToBottom(true));
  }
}

// 重设会话绑定的项目目录（用于修复跨机器同步导致的失效路径）
async function resetConversationProject(convId) {
  if (!confirm('重新选择本机的项目目录？\n\n注意：项目目录在系统提示中，重设后下一条消息会重新计算一次上下文（一次性变慢/变贵），之后恢复正常缓存。')) return;
  const r = await window.pywebview.api.set_conversation_project(convId, '');
  if (!r || r.cancelled) return;
  // 更新本地会话的 project_path，使侧边栏重新分组
  const c = state.conversations.find(x => x.id === convId);
  if (c) c.project_path = r.path;
  renderConvList(searchInput.value);
  // 若当前正打开此会话，重新加载以移除失效 banner
  if (state.currentConvId === convId) await openConversation(convId);
}

function _highlightAndScrollTo(keyword) {
  // Remove previous highlights
  chatMessages.querySelectorAll('mark.search-highlight').forEach(m => {
    const parent = m.parentNode;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
  if (!keyword) return;

  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const walker = document.createTreeWalker(chatMessages, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentNode;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
      if (regex.test(node.nodeValue)) { regex.lastIndex = 0; return NodeFilter.FILTER_ACCEPT; }
      return NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  let firstMark = null;
  for (const textNode of nodes) {
    const parts = textNode.nodeValue.split(regex);
    if (parts.length <= 1) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (regex.test(part)) {
        regex.lastIndex = 0;
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = part;
        frag.appendChild(mark);
        if (!firstMark) firstMark = mark;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  // Scroll to first match
  if (firstMark) {
    firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// 点击"+ 新对话"：先显示主页选择项目，而非直接建会话
async function newConversation() {
  if (state.running) {
    alert('请先停止当前生成，再开始新对话。');
    return;
  }
  if (state.temporaryConversation && state.currentConvId) {
    await window.pywebview.api.discard_temporary_conversation(state.currentConvId);
    state.currentConvId = null;
    convTitle.textContent = '';
  }
  setTemporaryMode(false);
  await showHome();
}

async function startTemporaryConversation() {
  if (state.running) {
    alert('请先停止当前生成，再开始临时对话。');
    return;
  }
  const conv = await window.pywebview.api.new_temporary_conversation();
  state.showArchived = false;
  state.currentConvId = conv.id;
  setTemporaryMode(true);
  toggleConversationManageMode(false);
  updateArchiveViewButton();
  convTitle.textContent = conv.title || '临时对话';
  hideHome();
  chatMessages.innerHTML = '';
  renderConvList(searchInput.value);
  updateContextBar(0, 80000);
  msgInput.focus();
}

// 真正创建会话（绑定可选的项目目录）并进入
async function startConvWithProject(projectPath = '') {
  if (state.running) {
    alert('请先停止当前生成，再开始新对话。');
    return;
  }
  state.showArchived = false;
  setTemporaryMode(false);
  toggleConversationManageMode(false);
  updateArchiveViewButton();
  const conv = await window.pywebview.api.new_conversation(projectPath);
  state.conversations.unshift({
    id: conv.id,
    title: conv.title,
    project_path: conv.project_path || '',
    archived: false,
  });
  state.currentConvId = conv.id;
  convTitle.textContent = conv.title;
  hideHome();
  renderConvList(searchInput.value);
  chatMessages.innerHTML = '';
  updateContextBar(0, 80000);
}

// ── 主页（项目选择）────────────────────────────────────────────────
function hideHome() {
  $('home-view').classList.add('hidden');
  chatMessages.style.display = '';
}

async function showHome() {
  $('home-view').classList.remove('hidden');
  chatMessages.style.display = 'none';
  $('home-project-convs').classList.add('hidden');
  await renderHomeProjects();
}

async function renderHomeProjects() {
  const box = $('home-project-list');
  box.innerHTML = '<span class="home-empty">加载中...</span>';
  const projects = (await window.pywebview.api.list_recent_projects())
    .filter(project => !project.archived);
  box.innerHTML = '';
  if (!projects.length) {
    box.innerHTML = '<span class="home-empty">暂无最近项目，点击上方“添加新项目”。</span>';
    return;
  }
  projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'home-project-card';
    const missing = p.exists === false;
    if (missing) card.classList.add('hp-missing');
    const warn = missing ? '<span class="hp-warn" title="该目录在本机不存在，可能是从其他机器同步而来">⚠ 路径不存在</span>' : '';
    card.innerHTML = `<div class="hp-name">📁 ${escapeHtml(p.name || '')}${warn}</div>`
                   + `<div class="hp-path">${escapeHtml(p.path || '')}</div>`;
    // 单击：展示该项目历史会话；“新建”按钮：直接以该项目开新会话
    card.addEventListener('click', () => showProjectConvs(p.path, p.name));
    const acts = document.createElement('div');
    acts.className = 'hp-actions';
    const startBtn = document.createElement('button');
    startBtn.className = 'hp-start btn-secondary';
    startBtn.textContent = '+ 新对话';
    startBtn.addEventListener('click', e => { e.stopPropagation(); startConvWithProject(p.path); });
    const editBtn = document.createElement('button');
    editBtn.className = 'hp-edit btn-secondary';
    editBtn.textContent = '✏ 改地址';
    editBtn.title = '修改项目目录（该项目下所有会话一并改绑）';
    editBtn.addEventListener('click', e => { e.stopPropagation(); editProjectPath(p.path, p.name); });
    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'hp-archive btn-secondary';
    archiveBtn.textContent = '归档';
    archiveBtn.title = '归档该项目下的全部会话';
    archiveBtn.addEventListener('click', e => {
      e.stopPropagation();
      archiveProject(p.path, true, p.name);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'hp-del btn-danger';
    delBtn.textContent = '🗑 移除';
    delBtn.title = '从最近项目移除（不删会话，会话变为未分类）';
    delBtn.addEventListener('click', e => { e.stopPropagation(); removeProject(p.path, p.name); });
    acts.appendChild(startBtn);
    acts.appendChild(editBtn);
    acts.appendChild(archiveBtn);
    acts.appendChild(delBtn);
    card.appendChild(acts);
    box.appendChild(card);
  });
}

async function editProjectPath(oldPath, name) {
  // new_path 传空 → 后端弹文件夹选择框
  const r = await window.pywebview.api.update_project_path(oldPath, '');
  if (r && r.cancelled) return;
  if (r && r.ok) {
    // 改了项目目录 = 该项目所有会话缓存失效一次（项目路径在系统提示前缀），下条消息重算
    state.conversations = await window.pywebview.api.list_conversations();
    renderConvList('');
    await renderHomeProjects();
  } else {
    alert('修改失败：' + ((r && r.error) || '未知错误'));
  }
}

async function removeProject(path, name) {
  if (!confirm(`从最近项目移除「${name}」？\n\n该项目下的会话不会被删除，只是变为未分类。`)) return;
  const r = await window.pywebview.api.remove_recent_project(path);
  if (r && r.ok) {
    state.conversations = await window.pywebview.api.list_conversations();
    renderConvList('');
    await renderHomeProjects();
  } else {
    alert('移除失败：' + ((r && r.error) || '未知错误'));
  }
}

async function showProjectConvs(projectPath, projectName) {
  const wrap = $('home-project-convs');
  const list = $('home-conv-list');
  $('home-convs-label').textContent = `“${projectName}” 的历史会话`;
  wrap.classList.remove('hidden');
  list.innerHTML = '<span class="home-empty">加载中...</span>';
  const convs = await window.pywebview.api.get_project_conversations(projectPath);
  list.innerHTML = '';
  if (!convs.length) {
    list.innerHTML = '<span class="home-empty">该项目暂无会话，点击右侧“+ 新对话”开始。</span>';
    return;
  }
  convs.forEach(c => {
    const item = document.createElement('div');
    item.className = 'home-conv-item';
    item.textContent = c.title || '新对话';
    item.addEventListener('click', async () => { hideHome(); await openConversation(c.id); });
    list.appendChild(item);
  });
}

async function deleteConversation(convId) {
  if (!confirm('确定删除这条对话？')) return;
  await window.pywebview.api.delete_conversation(convId);
  state.conversations = state.conversations.filter(c => c.id !== convId);
  if (state.currentConvId === convId) {
    chatMessages.innerHTML = '';
    state.currentConvId = null;
    setTemporaryMode(false);
    convTitle.textContent = '';
    if (state.conversations.length > 0) await openConversation(state.conversations[0].id);
    else await newConversation();
  }
  renderConvList(searchInput.value);
}

function updateArchiveViewButton() {
  const button = $('btn-archive-view');
  if (!button) return;
  const archivedCount = state.conversations.filter(conv => conv.archived).length;
  button.classList.toggle('active', state.showArchived);
  button.textContent = state.showArchived ? '返回' : `归档${archivedCount ? ` ${archivedCount}` : ''}`;
  button.title = state.showArchived ? '返回当前会话' : '查看已归档会话';
}

async function showFirstConversationInCurrentView() {
  const first = state.conversations.find(
    conv => Boolean(conv.archived) === state.showArchived
  );
  if (first) {
    await openConversation(first.id);
    return;
  }
  state.currentConvId = null;
  setTemporaryMode(false);
  convTitle.textContent = '';
  chatMessages.innerHTML = '';
  if (state.showArchived) {
    hideHome();
    chatMessages.innerHTML = '<div class="archive-empty-state"><b>暂无归档会话</b></div>';
  } else {
    await showHome();
  }
}

async function archiveConversation(convId, archived) {
  if (state.running && convId === state.currentConvId) {
    alert('请先停止当前生成，再归档该会话。');
    return;
  }
  const result = await window.pywebview.api.set_conversation_archived(convId, archived);
  if (!result || !result.ok) return;
  state.conversations = await window.pywebview.api.list_conversations();
  updateArchiveViewButton();
  renderConvList(searchInput.value);
  const current = state.conversations.find(conv => conv.id === state.currentConvId);
  if (!current || Boolean(current.archived) !== state.showArchived) {
    await showFirstConversationInCurrentView();
  }
}

async function archiveProject(path, archived, name) {
  const current = state.conversations.find(conv => conv.id === state.currentConvId);
  if (state.running && current && (current.project_path || '') === path) {
    alert('请先停止当前生成，再归档这个项目。');
    return;
  }
  const action = archived ? '归档' : '恢复';
  if (!confirm(`${action}项目“${name}”的全部会话？`)) return;
  const result = await window.pywebview.api.set_project_archived(path, archived);
  if (!result || !result.ok) {
    alert((result && result.error) || `${action}项目失败`);
    return;
  }
  state.conversations = await window.pywebview.api.list_conversations();
  updateArchiveViewButton();
  renderConvList(searchInput.value);
  if (!$('home-view').classList.contains('hidden')) {
    await renderHomeProjects();
    return;
  }
  const visibleCurrent = state.conversations.find(conv =>
    conv.id === state.currentConvId && Boolean(conv.archived) === state.showArchived
  );
  if (!visibleCurrent) await showFirstConversationInCurrentView();
}

async function toggleArchiveView() {
  if (state.temporaryConversation && state.currentConvId) {
    const discarded = await window.pywebview.api.discard_temporary_conversation(state.currentConvId);
    if (!discarded || !discarded.ok) {
      alert((discarded && discarded.error) || '临时会话仍在生成，暂时无法切换');
      return;
    }
    state.currentConvId = null;
    setTemporaryMode(false);
  }
  state.showArchived = !state.showArchived;
  state.selectedConversationIds.clear();
  searchInput.value = '';
  state.searchSerial += 1;
  updateArchiveViewButton();
  renderConvList();
  await showFirstConversationInCurrentView();
}

$('btn-new-conv').addEventListener('click', newConversation);
$('btn-temp-conv').addEventListener('click', startTemporaryConversation);
$('btn-archive-view').addEventListener('click', toggleArchiveView);
$('btn-manage-convs').addEventListener('click', () => toggleConversationManageMode());
$('btn-batch-select-all').addEventListener('click', () => {
  state.visibleConversationIds.forEach(id => state.selectedConversationIds.add(id));
  updateBatchConversationBar();
  renderConvList(searchInput.value);
});
$('btn-batch-clear').addEventListener('click', () => {
  state.selectedConversationIds.clear();
  updateBatchConversationBar();
  renderConvList(searchInput.value);
});
$('btn-batch-archive').addEventListener('click', bulkArchiveSelected);
$('btn-batch-delete').addEventListener('click', bulkDeleteSelected);
$('btn-token-heatmap').addEventListener('click', openUsageHeatmap);
$('btn-home-add').addEventListener('click', async () => {
  const proj = await window.pywebview.api.choose_project_folder();
  if (proj && proj.path) await startConvWithProject(proj.path);
});
$('btn-home-noproject').addEventListener('click', () => startConvWithProject(''));

// ── Token 用量热力图 ─────────────────────────────────────────────
let _usageMonth = new Date();
_usageMonth.setDate(1);
let _usageWeek = new Date();
let _usagePeriod = 'month';
let _usageMetric = 'output_tokens';
let _usageData = null;

function _fmtTokens(n) {
  n = Number(n || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

async function openUsageHeatmap() {
  $('usage-overlay').classList.remove('hidden');
  await renderUsageHeatmap();
}

function closeUsageHeatmap() {
  hideUsageTooltip();
  $('usage-overlay').classList.add('hidden');
}

async function renderUsageHeatmap() {
  if (_usagePeriod === 'month') {
    const year = _usageMonth.getFullYear();
    const month = _usageMonth.getMonth() + 1;
    $('usage-month-label').textContent = `${year} 年 ${String(month).padStart(2, '0')} 月`;
    _usageData = await window.pywebview.api.get_token_usage_month(year, month);
  } else {
    const anchor = _localDateKey(_usageWeek);
    _usageData = await window.pywebview.api.get_token_usage_week(anchor);
    $('usage-month-label').textContent = `${_usageData.start_date || '-'}  -  ${_usageData.end_date || '-'}`;
  }
  renderUsageDashboard(_usageData || {});
}

function _localDateKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function renderUsageDashboard(data) {
  const stats = data.stats || {};
  const metricLabels = {
    output_tokens: '模型输出',
    total_tokens: 'Token 总量',
    input_tokens: '输入 Token',
  };
  const cacheTotal = Number(stats.cache_hit_tokens || 0) + Number(stats.cache_miss_tokens || 0);
  const cacheRate = cacheTotal > 0
    ? `${Math.round(Number(stats.cache_hit_tokens || 0) / cacheTotal * 100)}%`
    : '-';
  $('usage-stats').innerHTML = `
    <div><b>${_fmtTokens(stats[_usageMetric])}</b><span>${metricLabels[_usageMetric]}</span></div>
    <div><b>${_fmtTokens(stats.input_tokens)}</b><span>输入</span></div>
    <div><b>${_fmtTokens(stats.output_tokens)}</b><span>输出</span></div>
    <div><b>${cacheRate}</b><span>缓存命中</span></div>`;

  if (data.error) {
    $('usage-heatmap').innerHTML = `<div class="usage-empty">读取失败：${escapeHtml(data.error)}</div>`;
    $('usage-week-chart').innerHTML = '';
    renderUsageModels({});
    return;
  }
  const isMonth = _usagePeriod === 'month';
  $('usage-month-chart').classList.toggle('hidden', !isMonth);
  $('usage-week-chart').classList.toggle('hidden', isMonth);
  if (isMonth) renderUsageMonth(data);
  else renderUsageWeek(data);
  renderUsageModels(data.models || {});
}

function renderUsageMonth(data) {
  const box = $('usage-heatmap');
  box.innerHTML = '';
  const days = data.days || {};
  const values = Object.values(days).map(item => Number(item[_usageMetric] || 0));
  const maxValue = Math.max(0, ...values);
  for (let day = 1; day <= (data.days_in_month || 31); day++) {
    const date = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const item = days[date] || { date, total_tokens: 0, input_tokens: 0, output_tokens: 0 };
    const value = Number(item[_usageMetric] || 0);
    const level = value <= 0 || maxValue <= 0 ? 0 : Math.max(1, Math.ceil(value / maxValue * 4));
    const cell = document.createElement('div');
    cell.className = 'usage-cell';
    cell.dataset.level = level;
    cell.textContent = day;
    cell.addEventListener('mouseenter', event => showUsageTooltip(event, item));
    cell.addEventListener('mousemove', moveUsageTooltip);
    cell.addEventListener('mouseleave', hideUsageTooltip);
    box.appendChild(cell);
  }
}

function renderUsageWeek(data) {
  const box = $('usage-week-chart');
  box.innerHTML = '';
  const order = data.day_order || Object.keys(data.days || {});
  const items = order.map(key => (data.days || {})[key]).filter(Boolean);
  const maxValue = Math.max(0, ...items.map(item => Number(item[_usageMetric] || 0)));
  const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  items.forEach((item, index) => {
    const value = Number(item[_usageMetric] || 0);
    const column = document.createElement('div');
    column.className = 'usage-bar-column';
    const bar = document.createElement('div');
    bar.className = 'usage-bar';
    bar.style.height = value > 0 && maxValue > 0 ? `${Math.max(4, value / maxValue * 100)}%` : '2px';
    bar.title = `${item.date}: ${_fmtTokens(value)}`;
    const valueLabel = document.createElement('b');
    valueLabel.textContent = _fmtTokens(value);
    const dayLabel = document.createElement('span');
    dayLabel.textContent = weekday[index] || item.date.slice(5);
    const dateLabel = document.createElement('small');
    dateLabel.textContent = item.date.slice(5);
    column.appendChild(valueLabel);
    column.appendChild(bar);
    column.appendChild(dayLabel);
    column.appendChild(dateLabel);
    box.appendChild(column);
  });
}

function renderUsageModels(models) {
  const palette = ['#35c78a', '#4d8df7', '#f2b84b', '#e56b6f', '#8f78d7', '#27a9b8'];
  const entries = Object.entries(models)
    .map(([name, metrics]) => [name, Number((metrics || {})[_usageMetric] || 0)])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 5);
  const rest = entries.slice(5).reduce((sum, item) => sum + item[1], 0);
  if (rest > 0) top.push(['其他', rest]);
  const total = top.reduce((sum, item) => sum + item[1], 0);
  const donut = $('usage-donut');
  const legend = $('usage-model-legend');
  legend.innerHTML = '';
  if (total <= 0) {
    donut.style.background = 'var(--bg3)';
    donut.innerHTML = '<span>0</span>';
    legend.innerHTML = '<div class="usage-empty">暂无模型用量</div>';
    return;
  }
  let cursor = 0;
  const stops = [];
  top.forEach(([name, value], index) => {
    const start = cursor;
    cursor += value / total * 100;
    stops.push(`${palette[index]} ${start}% ${cursor}%`);
    const row = document.createElement('div');
    row.innerHTML = `<i style="background:${palette[index]}"></i><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${_fmtTokens(value)}</b>`;
    legend.appendChild(row);
  });
  donut.style.background = `conic-gradient(${stops.join(',')})`;
  donut.innerHTML = `<span>${_fmtTokens(total)}</span>`;
}

function getUsageTooltip() {
  const tip = $('usage-tooltip');
  // Keep the tooltip directly under <body>. A fixed-position element inside
  // the animated modal can be offset because the modal uses CSS transform.
  if (tip && tip.parentElement !== document.body) {
    document.body.appendChild(tip);
  }
  return tip;
}

function showUsageTooltip(e, item) {
  const models = Object.entries(item.model_metrics || {})
    .map(([name, metrics]) => [name, Number((metrics || {})[_usageMetric] || 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, tokens]) => `<div><span>${escapeHtml(name)}</span><b>${_fmtTokens(tokens)}</b></div>`)
    .join('') || '<div><span>无调用记录</span><b>0</b></div>';
  const tip = getUsageTooltip();
  tip.innerHTML = `<strong>${escapeHtml(item.date || '')}</strong><p>${_fmtTokens(item[_usageMetric] || 0)} tokens</p>${models}`;
  tip.classList.remove('hidden');
  moveUsageTooltip(e);
}

function moveUsageTooltip(e) {
  const tip = getUsageTooltip();
  if (!tip) return;
  const offset = 6;
  const rect = tip.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  tip.style.left = `${Math.max(8, Math.min(e.clientX + offset, maxLeft))}px`;
  tip.style.top = `${Math.max(8, Math.min(e.clientY + offset, maxTop))}px`;
}

function hideUsageTooltip() {
  const tip = getUsageTooltip();
  if (tip) tip.classList.add('hidden');
}

$('usage-heatmap').addEventListener('mouseleave', hideUsageTooltip);
$('usage-modal').addEventListener('mouseleave', hideUsageTooltip);
$('usage-overlay').addEventListener('mousemove', e => {
  if (!$('usage-overlay').classList.contains('hidden') && !e.target.closest('.usage-cell')) {
    hideUsageTooltip();
  }
});

$('btn-usage-close').addEventListener('click', closeUsageHeatmap);
$('btn-usage-prev').addEventListener('click', async () => {
  if (_usagePeriod === 'month') _usageMonth.setMonth(_usageMonth.getMonth() - 1);
  else _usageWeek.setDate(_usageWeek.getDate() - 7);
  await renderUsageHeatmap();
});
$('btn-usage-next').addEventListener('click', async () => {
  if (_usagePeriod === 'month') _usageMonth.setMonth(_usageMonth.getMonth() + 1);
  else _usageWeek.setDate(_usageWeek.getDate() + 7);
  await renderUsageHeatmap();
});
$('usage-period-switch').addEventListener('click', async event => {
  const button = event.target.closest('button[data-period]');
  if (!button) return;
  _usagePeriod = button.dataset.period;
  $('usage-period-switch').querySelectorAll('button').forEach(item =>
    item.classList.toggle('active', item === button)
  );
  await renderUsageHeatmap();
});
$('usage-metric-switch').addEventListener('click', event => {
  const button = event.target.closest('button[data-metric]');
  if (!button) return;
  _usageMetric = button.dataset.metric;
  $('usage-metric-switch').querySelectorAll('button').forEach(item =>
    item.classList.toggle('active', item === button)
  );
  renderUsageDashboard(_usageData || {});
});

// ── History rendering ─────────────────────────────────────────────
function loadHistory(messages) {
  chatMessages.classList.add('no-animate');
  chatMessages.innerHTML = '';
  _resetToolStreak();
  // tool_call_id → 工具名映射：tool 结果消息只带 id，需借此还原真实工具名，
  // 这样回放能复用实时的 addToolCallBubble/addToolResultBubble（按名字匹配），
  // 渲染出和实时一致的「调用气泡（参数+结果可折叠）」。
  const tcNameById = {};
  messages.forEach(msg => {
    const role = msg.role;
    const content = msg.content || '';
    if (role === 'user') {
      addUserBubble(content);
    } else if (role === 'assistant') {
      if (content) addAssistantBubble(content);
      // 还原该轮的工具调用气泡（含参数、占位「等待中…」）
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls.forEach(tc => {
          const name = tc.function && tc.function.name || 'tool';
          let args = {};
          try { args = JSON.parse((tc.function && tc.function.arguments) || '{}'); }
          catch { args = {}; }
          if (tc.id) tcNameById[tc.id] = name;
          addToolCallBubble(name, args);
        });
      }
    } else if (role === 'tool') {
      // 用真实工具名匹配上面的占位气泡并填入结果
      const name = tcNameById[msg.tool_call_id] || 'tool';
      addToolResultBubble(name, content);
    }
  });
  scrollToBottom(true);
  // Re-enable animations after history is rendered
  requestAnimationFrame(() => chatMessages.classList.remove('no-animate'));
}

function addUserBubble(text) {
  _resetToolStreak();
  const div = document.createElement('div');
  div.className = 'bubble bubble-user';
  const collapsible = document.createElement('div');
  collapsible.className = 'bubble-collapsible';
  collapsible.innerHTML = `<div class="bubble-label">You</div><div class="bubble-content">${buildUserContent(text)}</div>`;
  div.appendChild(collapsible);
  chatMessages.appendChild(div);
  // Load image thumbnails + wire doc cards (shared with tool-result bubbles)
  _hydrateImgThumbs(collapsible);
  // Check if content exceeds collapse threshold after render
  requestAnimationFrame(() => {
    if (collapsible.scrollHeight > 130) {
      collapsible.classList.add('needs-collapse');
      const btn = document.createElement('button');
      btn.className = 'bubble-toggle-btn';
      btn.textContent = '展开 ▼';
      btn.addEventListener('click', () => {
        const expanded = collapsible.classList.toggle('expanded');
        btn.textContent = expanded ? '收起 ▲' : '展开 ▼';
      });
      div.appendChild(btn);
    } else {
      collapsible.classList.add('expanded');
    }
  });
  return div;
}

function buildUserContent(text) {
  // Python 用 \n\n 连接各部分。附件标记形如：
  //   [图片: name 路径: abs]\n...提示语...
  //   [附件: name 路径: abs]\n...正文...
  // 图片渲染为缩略图卡片（点击放大），文档渲染为可点击卡片（在文件夹中定位）。
  // 兼容旧格式 [图片: name] / [附件: name]（无路径）。
  const docIcon = name => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ({ pdf:'📕', doc:'📄', docx:'📄', xls:'📊', xlsx:'📊', csv:'📊',
              ppt:'📑', pptx:'📑', txt:'📃', md:'📃', json:'🗂', zip:'🗜' })[ext] || '📎';
  };
  // 分离文字段与附件段：文字在上、图片/附件缩略图统一排到气泡下方。
  const textParts = [];
  const attachParts = [];
  text.split(/\n\n/).forEach(seg => {
    const mImg = seg.match(/^\[图片: (.+?)(?: 路径: ([^\]]*))?\]/);
    if (mImg) {
      const fname = mImg[1];
      const fpath = mImg[2] || fname;
      attachParts.push(
        `<span class="attach-card attach-image">`
        + `<img class="chat-img-thumb" data-path="${escapeHtml(fpath)}" src="" alt="${escapeHtml(fname)}">`
        + `<span class="attach-name">🖼 ${escapeHtml(fname)}</span></span>`);
      return;
    }
    const mDoc = seg.match(/^\[附件: (.+?)(?: 路径: ([^\]]*))?\]/);
    if (mDoc) {
      const fname = mDoc[1];
      const fpath = mDoc[2] || '';
      const openable = fpath ? ' attach-openable' : '';
      attachParts.push(
        `<span class="attach-card attach-doc${openable}" data-path="${escapeHtml(fpath)}" title="${fpath ? '在文件夹中定位' : ''}">`
        + `<span class="attach-icon">${docIcon(fname)}</span>`
        + `<span class="attach-name">${escapeHtml(fname)}</span></span>`);
      return;
    }
    textParts.push(escapeHtml(seg).replace(/\n/g, '<br>'));
  });
  let html = textParts.join('<br>');
  if (attachParts.length) {
    html += `<div class="attach-row">${attachParts.join('')}</div>`;
  }
  return html;
}

// 在容器内加载图片缩略图（按 data-path）并绑定点击放大 / 文档卡片定位。
// 供用户气泡和工具结果气泡（generate_image）共用。
function _hydrateImgThumbs(container) {
  container.querySelectorAll('img.chat-img-thumb[data-path]').forEach(async img => {
    const dataUrl = await window.pywebview.api.get_image_data(img.dataset.path);
    if (dataUrl) img.src = dataUrl;
    img.addEventListener('click', () => openLightbox(img.src));
  });
  container.querySelectorAll('.attach-doc.attach-openable[data-path]').forEach(card => {
    card.addEventListener('click', () => {
      if (card.dataset.path) window.pywebview.api.open_file_location(card.dataset.path);
    });
  });
}

function addAssistantBubble(content) {
  _resetToolStreak();
  const div = document.createElement('div');
  div.className = 'bubble bubble-assistant';
  div.innerHTML = `<div class="bubble-label">Assistant</div><div class="bubble-content">${renderMarkdown(content)}</div>`;
  chatMessages.appendChild(div);
  hydrateMermaid(div.querySelector('.bubble-content'));
  _hydrateImgThumbs(div);
  scrollToBottom();
  return div;
}

// ── 连续工具调用折叠 ──────────────────────────────────────────────
// 同一段连续工具调用超过阈值后，后续气泡收进可展开的折叠块（被 assistant
// 文本气泡打断则重置计数，见各文本气泡入口的 _resetToolStreak 调用）。
const _TOOL_FOLD_THRESHOLD = 5;
let _toolStreak = 0;          // 当前连续工具调用数
let _toolFoldContainer = null; // 当前折叠容器（超阈值后创建）

function _resetToolStreak() {
  _toolStreak = 0;
  _toolFoldContainer = null;
}

function _ensureFoldContainer() {
  if (_toolFoldContainer && _toolFoldContainer.parentNode) return _toolFoldContainer;
  const wrap = document.createElement('div');
  wrap.className = 'tool-fold collapsed';
  wrap.innerHTML =
    `<div class="tool-fold-header">`
    + `<span class="tool-fold-chevron">▶</span>`
    + `<span class="tool-fold-label">已折叠 <b class="tool-fold-count">0</b> 个工具调用</span>`
    + `</div>`
    + `<div class="tool-fold-body"></div>`;
  wrap.querySelector('.tool-fold-header').addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
  });
  chatMessages.appendChild(wrap);
  _toolFoldContainer = wrap;
  return wrap;
}

function _placeToolBubble(div) {
  _toolStreak += 1;
  if (_toolStreak <= _TOOL_FOLD_THRESHOLD) {
    chatMessages.appendChild(div);
    return;
  }
  const wrap = _ensureFoldContainer();
  wrap.querySelector('.tool-fold-body').appendChild(div);
  const cnt = _toolStreak - _TOOL_FOLD_THRESHOLD;
  wrap.querySelector('.tool-fold-count').textContent = cnt;
}

function addToolCallBubble(toolName, args) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-tool-call';
  const argsStr = JSON.stringify(args, null, 2);
  const icons = { web_search:'🔍', web_read:'🌐', extract_images:'🖼', analyze_image:'👁', ocr_image:'🔤', read_file:'📄', run_command:'⚙️', ssh_connect:'🔐', ssh_exec:'🖥️', ssh_close:'🔌', ssh_list_sessions:'📡', write_file:'✏️', list_directory:'📁' };
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
  _placeToolBubble(div);
  scrollToBottom();
  return div;
}

// 只有这些工具的结果按图片缩略图渲染（其余工具结果即便文本里含 "[图片: ...]"
// 也按普通文本截断折叠，避免 read_file 读到讲解附件格式的文档时铺开整个文件）。
const _IMAGE_TOOLS = new Set(['generate_image', 'edit_image', 'extract_images']);
const _isImageResultTool = toolName => _IMAGE_TOOLS.has(toolName) || toolName.startsWith('mcp__');

function addToolResultBubble(toolName, result) {
  // find the last tool-call bubble for this tool and update its result inline
  // Search both attached (chatMessages) and detached (_streamNodes) bubbles
  const attached = Array.from(chatMessages.querySelectorAll('.bubble-tool-call'));
  const detached = _streamNodes.filter(n => n.classList && n.classList.contains('bubble-tool-call') && !n.parentNode);
  const bubbles = [...attached, ...detached];
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const nameEl = bubbles[i].querySelector('.tool-name');
    if (nameEl && nameEl.textContent === toolName) {
      const resultEl = bubbles[i].querySelector('.tool-result-content');
      if (resultEl && resultEl.textContent === '等待中…') {
        // 仅图片生成类工具的结果按缩略图渲染；其他工具（如 read_file 读到含
        // "[图片: ...]" 文本的文件）一律走截断文本路径，避免误判铺开整个文件。
        if (_isImageResultTool(toolName) && /\[图片: .+?(?: 路径: [^\]]*)?\]/.test(result)) {
          resultEl.innerHTML = buildUserContent(result);
          _hydrateImgThumbs(resultEl);
          // 默认展开，让缩略图可见
          bubbles[i].classList.add('tool-expanded');
          return;
        }
        const preview = result.replace(/\n/g,' ').trim().slice(0, 200) + (result.length > 200 ? '…' : '');
        resultEl.textContent = preview;
        // Add file link for write/patch tools
        if (['write_file', 'apply_patch'].includes(toolName)) {
          _appendFileLinks(bubbles[i], result);
        }
        return;
      }
    }
  }
  // fallback: orphaned result bubble
  const div = document.createElement('div');
  div.className = 'bubble bubble-tool-call';
  const icons = { web_search:'🔍', web_read:'🌐', extract_images:'🖼', analyze_image:'👁', ocr_image:'🔤', read_file:'📄', run_command:'⚙️', ssh_connect:'🔐', ssh_exec:'🖥️', ssh_close:'🔌', ssh_list_sessions:'📡', write_file:'✏️', apply_patch:'🩹', list_directory:'📁', glob_files:'🔎', grep_files:'🔎' };
  const icon = icons[toolName] || '🔧';
  // 含图片标记且是图片生成工具 → 展开并渲染缩略图
  if (_isImageResultTool(toolName) && /\[图片: .+?(?: 路径: [^\]]*)?\]/.test(result || '')) {
    div.classList.add('tool-expanded');
    div.innerHTML = `<div class="tool-header"><span class="tool-icon">🖼</span><span class="tool-name">${escapeHtml(toolName)}</span><span class="tool-chevron">▶</span></div>`
      + `<div class="tool-body"><div class="tool-result-content"></div></div>`;
    const rc = div.querySelector('.tool-result-content');
    rc.innerHTML = buildUserContent(result);
    chatMessages.appendChild(div);
    _hydrateImgThumbs(rc);
    scrollToBottom();
    return;
  }
  div.innerHTML = `<div class="tool-header"><span class="tool-icon">${icon}</span><span class="tool-name">${escapeHtml(toolName)}</span></div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function _appendFileLinks(bubble, result) {
  // Extract file paths from write_file/apply_patch results (lines starting with ✅)
  const pathRegex = /[A-Z]:\\[^\n]+|\/[^\n\s]+/g;
  const paths = [];
  for (const line of result.split('\n')) {
    if (line.includes('✅') || line.includes('📁')) {
      const matches = line.match(pathRegex);
      if (matches) {
        for (const m of matches) {
          if (line.includes('✅') && !paths.includes(m)) paths.push(m);
        }
      }
    }
  }
  if (paths.length === 0) return;
  const linkDiv = document.createElement('div');
  linkDiv.className = 'tool-file-links';
  paths.forEach(fp => {
    const a = document.createElement('span');
    a.className = 'file-link';
    a.textContent = `📂 ${fp.split(/[/\\]/).pop()}`;
    a.title = fp;
    a.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      window.pywebview.api.open_file_location(fp);
    });
    linkDiv.appendChild(a);
  });
  bubble.appendChild(linkDiv);
}

function addErrorBubble(msg) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-error';
  div.innerHTML = `<div class="bubble-label">Error</div><div>${escapeHtml(msg)}</div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function addNoticeBubble(msg) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-notice';
  div.innerHTML = `<div class="bubble-label">Notice</div><div>${escapeHtml(msg)}</div>`;
  chatMessages.appendChild(div);
  if (_streamingConvId) _streamNodes.push(div);
  scrollToBottom();
}

// ── Streaming assistant bubble ────────────────────────────────────
let _streamBubble = null;
let _streamContent = '';
let _typingEl = null;
let _streamingConvId = null;  // tracks which conv is currently streaming
let _streamNodes = [];        // all DOM nodes added during this streaming session

function startAssistantStream() {
  removeTypingIndicator();
  $('cost-round').textContent = '本轮输出: 0';
  $('cost-session').textContent = '本次输出: 0';
  $('cost-cache').textContent = '缓存: -';
  _streamContent = '';
  _streamingConvId = state.currentConvId;
  _streamNodes = [];
  _streamBubble = document.createElement('div');
  _streamBubble.className = 'bubble bubble-assistant';
  _streamBubble.innerHTML = `<div class="bubble-label">Assistant</div><div class="bubble-content"></div>`;
  chatMessages.appendChild(_streamBubble);
  _streamNodes.push(_streamBubble);
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
    // 本轮首个文本 token 到达 → 模型开口说话，打断连续工具调用，重置折叠计数
    if (!_streamContent && token) _resetToolStreak();
    _streamContent += token;
    if (_streamBubble) {
      const contentEl = _streamBubble.querySelector('.bubble-content');
      contentEl.innerHTML = renderMarkdown(_streamContent);
      hydrateMermaid(contentEl);
      if (state.currentConvId === _streamingConvId) scrollToBottom();
    }
  },
  showToolCall(toolName, args) {
    const el = addToolCallBubble(toolName, args);
    if (_streamingConvId) _streamNodes.push(el);
    // If viewing a different conv, detach immediately (will re-attach on switch back)
    if (state.currentConvId !== _streamingConvId && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  },
  showToolResult(toolName, result) {
    addToolResultBubble(toolName, result);
    if (toolName.startsWith('worktree_')) refreshWorktreePanel();
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
    if (_streamBubble) _hydrateImgThumbs(_streamBubble);
    _streamBubble = null;
    _streamContent = '';
    _streamingConvId = null;
    _streamNodes = [];
    _thinkingBubble = null;
    _thinkingContent = '';
    setRunning(false);
    renderConvList(searchInput.value);
  },
  updateFileOps(ops) {
    const panel = $('fileops-panel');
    const list = $('fileops-list');
    if (!ops || ops.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = '';
    // Show newest first
    const sorted = [...ops].reverse();
    sorted.forEach(op => {
      const li = document.createElement('li');
      li.className = 'fileops-item';
      const fname = op.path.split(/[/\\]/).pop();
      const icon = op.tool === 'apply_patch' ? '🩹' : '✏️';
      // 增删行数（绿/红），无快照时不显示
      let stats = '';
      if (typeof op.added === 'number' || typeof op.removed === 'number') {
        const a = op.added || 0, r = op.removed || 0;
        stats = `<span class="fileops-stats">`
              + (a ? `<span class="fo-add">+${a}</span>` : '')
              + (r ? `<span class="fo-del">-${r}</span>` : '')
              + (!a && !r ? `<span class="fo-none">±0</span>` : '')
              + `</span>`;
      }
      li.innerHTML = `<span class="fileops-icon">${icon}</span>`
                   + `<span class="fileops-name" title="${escapeHtml(op.path)}">${escapeHtml(fname)}</span>`
                   + stats;
      li.addEventListener('click', () => openDiffModal(op.path, fname));
      list.appendChild(li);
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
    // Refresh worktree panel on team activity
    refreshWorktreePanel();
  },
  updateContext(used, total) {
    updateContextBar(used, total);
  },
  updateUsage(data) {
    const r = data.round || {};
    const s = data.session || {};
    const roundOutput = r.completion || 0;
    const sessionOutput = s.completion_tokens || 0;
    const cacheHit = s.cache_hit_tokens || 0;
    const cacheMiss = s.cache_miss_tokens || 0;
    const cacheRate = (cacheHit + cacheMiss) > 0
      ? Math.round(cacheHit / (cacheHit + cacheMiss) * 100) + '%'
      : '-';
    const fmt = n => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
    $('cost-round').textContent = `本轮输出: ${fmt(roundOutput)}`;
    $('cost-session').textContent = `本次输出: ${fmt(sessionOutput)}`;
    $('cost-cache').textContent = `缓存: ${cacheRate}`;
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
      if (state.currentConvId === _streamingConvId) {
        chatMessages.appendChild(_thinkingBubble);
      }
      if (_streamingConvId) _streamNodes.push(_thinkingBubble);
    }
    _thinkingContent += token;
    _thinkingBubble.querySelector('.thinking-body').textContent = _thinkingContent;
    if (state.currentConvId === _streamingConvId) scrollToBottom();
  },
  showError(msg) {
    removeTypingIndicator();
    _streamBubble = null;
    _streamingConvId = null;
    _streamNodes = [];
    addErrorBubble(msg);
    setRunning(false);
  },
  showNotice(msg) {
    addNoticeBubble(msg);
  },
  showConfirmDialog(toolName, args, wildcard) {
    $('confirm-title').textContent = `确认执行：${toolName}`;
    $('confirm-detail').textContent = JSON.stringify(args, null, 2);
    _confirmCommand = args.command || '';
    _confirmWildcard = wildcard || '';
    $('btn-confirm-always').style.display = (toolName === 'run_command' && _confirmCommand) ? '' : 'none';
    // Show wildcard button when backend suggests a pattern
    const btnWild = $('btn-confirm-wildcard');
    if (btnWild) {
      if (_confirmWildcard) {
        btnWild.style.display = '';
        btnWild.textContent = `允许所有 ${_confirmWildcard}`;
      } else {
        btnWild.style.display = 'none';
      }
    }
    _clearCountdown();
    $('confirm-overlay').classList.remove('hidden');
    // Show "开启自动确认" button only in confirm mode
    $('btn-confirm-auto').style.display = (state.config.command_safety === 'confirm') ? '' : 'none';
    // Auto-countdown mode
    if (state.config.command_safety === 'auto_countdown') {
      _startCountdown();
    }
  },
};

function removeTypingIndicator() {
  if (_typingEl) { _typingEl.remove(); _typingEl = null; }
}

// ── Send message ──────────────────────────────────────────────────
function setRunning(running) {
  state.running = running;
  btnSend.disabled = running;
  btnStop.disabled = !running;
}

// Paste image from clipboard into input
msgInput.addEventListener('paste', async e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) await addFileChip(file);
    } else if (item.kind === 'file') {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) await addFileChip(file);
    }
  }
  // Handle files from clipboard (e.g. copied file in Explorer)
  if (e.clipboardData.files && e.clipboardData.files.length > 0) {
    e.preventDefault();
    for (const file of Array.from(e.clipboardData.files)) {
      await addFileChip(file);
    }
  }
});

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

// ── Undo last message ────────────────────────────────────────────
let _undoUsed = false;
function restoreUndoneInput(value) {
  const restored = typeof value === 'string' ? { text: value, files: [] } : value;
  msgInput.value = restored.text || '';
  clearFileChips();
  for (const file of restored.files || []) {
    const entry = { name: file.name, path: file.path, content: file.content || '', loading: false };
    state.attachedFiles.push(entry);
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `<span>🖼 ${escapeHtml(entry.name)}</span><span class="chip-status"> 已恢复</span><button title="移除">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.attachedFiles = state.attachedFiles.filter(f => f !== entry);
      chip.remove();
    });
    fileChips.appendChild(chip);
  }
}

$('btn-undo').addEventListener('click', async () => {
  if (!state.currentConvId) return;
  if (_undoUsed) { return; }
  _undoUsed = true;
  $('btn-undo').disabled = true;
  const undone = await window.pywebview.api.undo_last_message(state.currentConvId);
  if (undone === null || undone === undefined) {
    _undoUsed = false;
    $('btn-undo').disabled = false;
    return;
  }
  // Reload conversation to reflect removed messages
  const conv = await window.pywebview.api.open_conversation(state.currentConvId);
  if (conv) {
    loadHistory(conv.messages || []);
    Chat.updateFileOps(conv.file_ops || []);
  }
  // Restore structured attachments, not just their display path markers.
  restoreUndoneInput(undone);
  msgInput.focus();
  setRunning(false);
  _streamBubble = null;
  _streamContent = '';
  _streamingConvId = null;
  _streamNodes = [];
});

// ── Retry last message ───────────────────────────────────────────
$('btn-retry').addEventListener('click', async () => {
  if (!state.currentConvId || state.running) return;
  // Undo last exchange, then immediately resend
  const undone = await window.pywebview.api.undo_last_message(state.currentConvId);
  if (undone === null || undone === undefined) return;
  // Reload conversation
  const conv = await window.pywebview.api.open_conversation(state.currentConvId);
  if (conv) {
    loadHistory(conv.messages || []);
    Chat.updateFileOps(conv.file_ops || []);
  }
  _streamBubble = null;
  _streamContent = '';
  _streamingConvId = null;
  _streamNodes = [];
  // Use the normal send path so image attachments survive retry.
  restoreUndoneInput(undone);
  await sendMessage();
});

// ── Model debate ─────────────────────────────────────────────────
$('btn-debate').addEventListener('click', () => {
  if (!state.currentConvId) return;
  // Populate message list for selection
  const container = $('debate-messages');
  container.innerHTML = '';
  const conv = state.conversations.find(c => c.id === state.currentConvId);
  // Get messages from DOM bubbles
  const bubbles = chatMessages.querySelectorAll('.bubble-user, .bubble-assistant');
  let msgIdx = 0;
  const messages = [];
  // We need actual message indices from the conversation
  // Fetch from backend
  window.pywebview.api.open_conversation(state.currentConvId).then(convData => {
    if (!convData) return;
    const msgs = convData.messages || [];
    msgs.forEach((m, i) => {
      if (m.role !== 'user' && m.role !== 'assistant') return;
      if (!m.content) return;
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = i;
      cb.checked = true; // default select last few
      if (i >= msgs.length - 4) cb.checked = true;
      else cb.checked = false;
      const role = document.createElement('span');
      role.className = 'debate-role';
      role.textContent = m.role === 'user' ? '用户' : 'AI';
      const preview = document.createElement('span');
      preview.className = 'debate-preview';
      preview.textContent = m.content.slice(0, 120);
      label.appendChild(cb);
      label.appendChild(role);
      label.appendChild(preview);
      container.appendChild(label);
    });
    // Populate model select (exclude current active model)
    const select = $('debate-model-select');
    select.innerHTML = '';
    const configs = state.config.model_configs || [];
    configs.forEach(mc => {
      const opt = document.createElement('option');
      opt.value = mc.name;
      opt.textContent = mc.name;
      // Pre-select first non-active model
      if (mc.name !== state.config.active_model_config) opt.selected = !select.value;
      select.appendChild(opt);
    });
    $('debate-overlay').classList.remove('hidden');
  });
});

$('btn-debate-close').addEventListener('click', () => $('debate-overlay').classList.add('hidden'));
$('btn-debate-cancel').addEventListener('click', () => $('debate-overlay').classList.add('hidden'));
$('btn-debate-send').addEventListener('click', async () => {
  const checkboxes = $('debate-messages').querySelectorAll('input[type="checkbox"]:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.value));
  const modelName = $('debate-model-select').value;
  const userPrompt = $('debate-user-prompt').value.trim();
  if (indices.length === 0) { alert('请至少选择一条消息'); return; }
  if (!modelName) { alert('请选择评审模型'); return; }
  $('debate-overlay').classList.add('hidden');
  // Show stream bubble for the debate response
  startAssistantStream();
  scrollToBottom(true);
  setRunning(true);
  await window.pywebview.api.debate_review(state.currentConvId, indices, modelName, userPrompt);
});

async function sendMessage() {
  if (state.running) return;
  const text = msgInput.value.trim();
  if (!text && state.attachedFiles.length === 0) return;
  if (state.attachedFiles.some(f => f.loading || !f.path)) {
    addNoticeBubble('请等待附件上传完成；上传失败的附件请移除后重新添加。');
    return;
  }
  const isHomeVisible = !$('home-view').classList.contains('hidden');
  if (isHomeVisible || !state.currentConvId) await startConvWithProject('');

  // Reset undo state — user sent a new message, allow undo again
  _undoUsed = false;
  $('btn-undo').disabled = false;

  msgInput.value = '';
  // 实时构造与后端一致的附件标记，让用户气泡即时显示缩略图（否则要刷新会话、
  // 重新从带标记的历史 JSON 加载才显示）。格式同 webview_app.send_message：
  // [图片: 名称 路径: 绝对路径] / [附件: 名称 路径: 绝对路径]，附件标记在前、文字在后。
  const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  const markers = state.attachedFiles.map(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const kind = imgExts.includes(ext) ? '图片' : '附件';
    return f.path ? `[${kind}: ${f.name} 路径: ${f.path}]` : `[${kind}: ${f.name}]`;
  });
  const bubbleText = [...markers, text].filter(Boolean).join('\n\n');
  addUserBubble(bubbleText || '[附件]');
  startAssistantStream();
  scrollToBottom(true);
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
$('btn-skill-import').addEventListener('click', async () => {
  const skills = await window.pywebview.api.import_skill();
  if (!skills || skills.length === 0) return;
  if (skills.length === 1) {
    // Single skill: populate form for review before saving
    const s = skills[0];
    _editingSkill = null;
    $('skill-name').value = s.name;
    $('skill-desc').value = s.description;
    $('skill-content').value = s.content;
    $('skill-name').focus();
  } else {
    // Batch import: confirm then save all
    if (!confirm(`发现 ${skills.length} 个技能，全部导入？`)) return;
    let count = 0;
    for (const s of skills) {
      if (s.name) {
        await window.pywebview.api.save_skill(s.name, s.description, s.content);
        count++;
      }
    }
    await refreshSkillList();
    // Show first imported skill in form
    if (skills[0]) {
      _editingSkill = skills[0].name;
      $('skill-name').value = skills[0].name;
      $('skill-desc').value = skills[0].description;
      $('skill-content').value = skills[0].content;
    }
    alert(`已导入 ${count} 个技能`);
  }
});
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
  try {
    const result = await window.pywebview.api.save_skill(name, desc, content);
    if (result && result.startsWith('错误')) { alert(result); return; }
  } catch (e) { alert('保存失败: ' + e.message); return; }
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
document.addEventListener('dragover', e => { e.preventDefault(); if (state.dragSrcId) return; document.body.classList.add('drag-over'); });
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

  const entry = { name, path: '', content: '', loading: true };
  state.attachedFiles.push(entry);

  chip.querySelector('button').addEventListener('click', () => {
    state.attachedFiles = state.attachedFiles.filter(f => f !== entry);
    chip.remove();
  });

  // Read as base64, save via Python to get a stable local path with unique suffix
  try {
    const base64 = await readFileAsBase64(file);
    const localPath = await window.pywebview.api.save_uploaded_file(name, base64);
    if (!localPath) throw new Error('附件上传失败');
    entry.path = localPath;
    if (isImg) {
      // 发送时后端按模型能力选择直传或独立视觉工具。
      chip.querySelector('.chip-status').textContent = ' 🖼';
    } else {
      const content = await window.pywebview.api.read_file_content(localPath);
      entry.content = content;
      chip.querySelector('.chip-status').textContent = content ? ' ✓' : ' ⚠';
    }
  } catch (error) {
    entry.path = '';
    chip.querySelector('.chip-status').textContent = ' 上传失败，请重新添加';
  } finally {
    entry.loading = false;
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

// ── Worktree panel ──────────────────────────────────────────────────
$('btn-wt-close').addEventListener('click', () => $('wt-panel').classList.add('hidden'));
$('btn-fileops-close').addEventListener('click', () => $('fileops-panel').classList.add('hidden'));
$('btn-diff-close').addEventListener('click', closeDiffModal);
$('diff-overlay').addEventListener('click', e => { if (e.target === $('diff-overlay')) closeDiffModal(); });
$('btn-diff-open-file').addEventListener('click', () => {
  const p = $('diff-path').textContent;
  if (p) window.pywebview.api.open_file_location(p);
});

async function refreshWorktreePanel() {
  try {
    const wts = await window.pywebview.api.get_worktrees();
    const panel = $('wt-panel');
    const list = $('wt-list');
    // Only show active/kept worktrees
    const visible = (wts || []).filter(w => w.status !== 'removed');
    if (visible.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = '';
    visible.forEach(wt => {
      const li = document.createElement('li');
      const statusCls = wt.status || 'active';
      const labels = { active: 'ACTIVE', kept: 'KEPT' };
      const taskStr = wt.task_id != null ? `task #${wt.task_id}` : '';
      li.innerHTML = `<span class="wt-status ${statusCls}">${labels[statusCls] || statusCls}</span>`
        + `<span class="wt-info"><span class="wt-name">${escapeHtml(wt.name)}</span>`
        + `<span class="wt-detail">${escapeHtml(wt.branch || '')}${taskStr ? ' · ' + taskStr : ''}</span></span>`;
      list.appendChild(li);
    });
  } catch { /* ignore if API not ready */ }
}

// ── Thinking mode toggle (off / high / max) ─────────────────────
let _thinkingBubble = null;
let _thinkingContent = '';
const _thinkingLevels = ['off', 'high', 'max'];
const _thinkingLabels = { off: '关', high: 'high', max: 'max' };

function initThinkingBtn(level) {
  // Migrate old bool values
  if (level === true) level = 'high';
  if (level === false) level = 'off';
  const btn = $('btn-thinking');
  btn.dataset.level = level || 'high';
  btn.textContent = `💭 ${_thinkingLabels[btn.dataset.level] || 'high'}`;
  btn.classList.toggle('active', btn.dataset.level !== 'off');
}

$('btn-thinking').addEventListener('click', () => {
  const btn = $('btn-thinking');
  const cur = btn.dataset.level || 'off';
  const idx = (_thinkingLevels.indexOf(cur) + 1) % _thinkingLevels.length;
  const next = _thinkingLevels[idx];
  btn.dataset.level = next;
  btn.textContent = `💭 ${_thinkingLabels[next]}`;
  btn.classList.toggle('active', next !== 'off');
  window.pywebview.api.set_thinking(next);
});

// ── Toggle tool calls visibility ─────────────────────────────────
$('btn-toggle-tools').addEventListener('click', () => {
  const btn = $('btn-toggle-tools');
  const msgs = $('chat-messages');
  const hidden = msgs.classList.toggle('hide-tools');
  btn.classList.toggle('active', !hidden);
  btn.textContent = hidden ? '🔧 工具(隐)' : '🔧 工具';
});

// ── Search mode button ────────────────────────────────────────────
// state: search_mode = 'auto' | 'manual', search_enabled = bool
let _searchMode = 'auto';
let _searchEnabled = true;

function initSearchBtn(mode, enabled) {
  _searchMode = mode || 'auto';
  _searchEnabled = enabled !== false;
  _renderSearchBtn();
}

function _renderSearchBtn() {
  const btn = $('btn-search');
  const items = document.querySelectorAll('.search-dropdown-item');
  if (_searchMode === 'auto') {
    // Auto mode: button always lit, shows current mode label
    btn.classList.add('active');
    btn.title = '联网搜索：自动（模型决定）';
  } else {
    // Manual mode: button lit/dim based on _searchEnabled
    btn.classList.toggle('active', _searchEnabled);
    btn.title = _searchEnabled ? '联网搜索：已开启（点击关闭）' : '联网搜索：已关闭（点击开启）';
  }
  items.forEach(el => {
    el.classList.toggle('selected', el.dataset.mode === _searchMode);
  });
}

// Main button click: auto mode → no-op (mode is always on); manual mode → toggle enabled
$('btn-search').addEventListener('click', () => {
  if (_searchMode === 'manual') {
    _searchEnabled = !_searchEnabled;
    window.pywebview.api.set_search_enabled(_searchEnabled);
    _renderSearchBtn();
  }
  // auto mode: clicking the main button does nothing (use arrow to change mode)
});

// Arrow button: toggle dropdown
let _searchDropdownOpen = false;
function _openSearchDropdown() {
  _searchDropdownOpen = true;
  $('search-dropdown').classList.remove('hidden');
}
function _closeSearchDropdown() {
  _searchDropdownOpen = false;
  $('search-dropdown').classList.add('hidden');
}

$('btn-search-arrow').addEventListener('click', (e) => {
  e.stopPropagation();
  _searchDropdownOpen ? _closeSearchDropdown() : _openSearchDropdown();
});

// Dropdown item click
document.querySelectorAll('.search-dropdown-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    _searchMode = el.dataset.mode;
    if (_searchMode === 'auto') _searchEnabled = true;
    window.pywebview.api.set_search_mode(_searchMode);
    window.pywebview.api.set_search_enabled(_searchEnabled);
    _closeSearchDropdown();
    _renderSearchBtn();
  });
});

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (_searchDropdownOpen && !$('search-btn-wrap').contains(e.target)) {
    _closeSearchDropdown();
  }
});

// ── Export & Import ──────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
  if (state.currentConvId) window.pywebview.api.export_conversation(state.currentConvId);
});

$('btn-import').addEventListener('click', async () => {
  const result = await window.pywebview.api.import_conversation();
  if (result) {
    // 刷新对话列表并打开导入的对话
    state.conversations = await window.pywebview.api.list_conversations();
    renderConvList('');
    await openConversation(result.id);
  }
});

// ── Chat nav buttons ──────────────────────────────────────────────
function smoothScrollTo(targetScrollTop, duration = 320) {
  const area = $('chat-area');
  const start = area.scrollTop;
  const delta = targetScrollTop - start;
  if (Math.abs(delta) < 2) return;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
    area.scrollTop = start + delta * ease;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

$('btn-nav-bottom').addEventListener('click', () => {
  smoothScrollTo($('chat-area').scrollHeight);
});

$('btn-nav-prev').addEventListener('click', () => {
  const bubbles = Array.from(chatMessages.querySelectorAll('.bubble-user, .bubble-assistant'));
  if (!bubbles.length) return;
  const area = $('chat-area');
  const areaScrollTop = area.scrollTop;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const bubbleTop = bubbles[i].offsetTop - chatMessages.offsetTop;
    if (bubbleTop < areaScrollTop - 10) {
      smoothScrollTo(bubbleTop - 8);
      return;
    }
  }
});

$('btn-nav-next').addEventListener('click', () => {
  const bubbles = Array.from(chatMessages.querySelectorAll('.bubble-user, .bubble-assistant'));
  if (!bubbles.length) return;
  const area = $('chat-area');
  const areaScrollTop = area.scrollTop;
  for (let i = 0; i < bubbles.length; i++) {
    const bubbleTop = bubbles[i].offsetTop - chatMessages.offsetTop;
    if (bubbleTop > areaScrollTop + 10) {
      smoothScrollTo(bubbleTop - 8);
      return;
    }
  }
});
