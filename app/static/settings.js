/* settings.js — 设置面板 / 命令白名单 / 更新检查 / 云同步 / 模型配置管理。
   依赖 core.js 的 $/state，dialogs 无关；openSettings/saveSettings/fillSettingsFields
   /renderModelConfigList 等被本文件内的按钮绑定与同步导入调用（均在本文件内）。
   顶层 $('btn-...').addEventListener 在 load 时执行，故须在 core.js 之后加载。 */
'use strict';

// ── Settings ──────────────────────────────────────────────────────
$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', closeSettingsWithoutSave);
$('btn-settings-cancel').addEventListener('click', closeSettingsWithoutSave);
$('btn-settings-save').addEventListener('click', saveSettings);
$('btn-allowlist-save').addEventListener('click', async () => {
  const cmds = $('allowlist-cmds').value.split('\n').map(s => s.trim()).filter(Boolean);
  await window.pywebview.api.save_allowed_commands_api(cmds);
  $('allowlist-cmds').value = cmds.join('\n');
  _updateAllowlistCount(cmds.length);
});
$('btn-allowlist-clear').addEventListener('click', async () => {
  if (!confirm('确定清空所有允许的指令？')) return;
  await window.pywebview.api.save_allowed_commands_api([]);
  $('allowlist-cmds').value = '';
  _updateAllowlistCount(0);
});
function _updateAllowlistCount(n) {
  const el = $('allowlist-count');
  if (el) el.textContent = `${n} 条`;
}
// Update count when allowlist textarea changes
$('allowlist-cmds').addEventListener('input', () => {
  const n = $('allowlist-cmds').value.split('\n').filter(s => s.trim()).length;
  _updateAllowlistCount(n);
});

// ── Update checker ───────────────────────────────────────────────
$('btn-check-update').addEventListener('click', async () => {
  $('update-status').textContent = '正在检查更新...';
  $('update-releases').innerHTML = '';
  const result = await window.pywebview.api.check_for_updates();
  $('update-current-ver').textContent = result.current_version || '-';
  if (result.error) {
    $('update-status').textContent = result.error;
    if (result.rate_limited) {
      const btn = document.createElement('button');
      btn.className = 'update-asset-btn';
      btn.textContent = '直接前往 GitHub Releases 页面';
      btn.style.marginTop = '8px';
      btn.addEventListener('click', () => window.pywebview.api.open_url('https://github.com/SolitudeZY/Deepseek-GUI/releases'));
      $('update-releases').appendChild(btn);
    }
    return;
  }
  const releases = result.releases || [];
  if (releases.length === 0) {
    $('update-status').textContent = '未找到任何发布版本。';
    return;
  }
  // Compare versions
  const current = result.current_version;
  const latest = releases[0].tag.replace(/^v/, '');
  if (latest === current) {
    $('update-status').textContent = `已是最新版本 (${current})`;
  } else {
    $('update-status').textContent = `发现新版本: ${releases[0].tag}`;
  }
  // Render release cards
  const container = $('update-releases');
  releases.forEach(r => {
    const tag = r.tag.replace(/^v/, '');
    const isNew = _compareVersions(tag, current) > 0;
    const card = document.createElement('div');
    card.className = 'update-card' + (isNew ? ' is-new' : '');
    const date = r.published ? new Date(r.published).toLocaleDateString('zh-CN') : '';
    card.innerHTML = `
      <div class="update-card-header">
        <span class="update-card-tag">${escapeHtml(r.tag)}</span>
        ${isNew ? '<span class="update-card-badge">新版本</span>' : ''}
        <span class="update-card-date">${date}</span>
      </div>
      <div class="update-card-body">${escapeHtml(r.body || '无说明')}</div>
      <div class="update-card-assets"></div>
    `;
    const assetsEl = card.querySelector('.update-card-assets');
    if (r.assets && r.assets.length > 0) {
      r.assets.forEach(a => {
        const btn = document.createElement('button');
        btn.className = 'update-asset-btn';
        const sizeMB = (a.size / 1048576).toFixed(1);
        btn.textContent = `${a.name} (${sizeMB}MB)`;
        btn.addEventListener('click', () => _downloadAsset(a.url, a.name));
        assetsEl.appendChild(btn);
      });
    } else {
      const link = document.createElement('button');
      link.className = 'update-asset-btn';
      link.textContent = '前往 GitHub 下载';
      link.addEventListener('click', () => window.pywebview.api.open_url(r.html_url));
      assetsEl.appendChild(link);
    }
    container.appendChild(card);
  });
});

function _compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// 下载进度回调入口（后端 download_update 通过 evaluate_js 调用）
window.Update = {
  onProgress(pct, downloaded, total) {
    const wrap = $('update-progress');
    if (wrap) wrap.classList.remove('hidden');
    const fill = $('update-progress-fill');
    const text = $('update-progress-text');
    if (pct >= 0) {
      if (fill) fill.style.width = pct + '%';
      if (text) {
        const mb = n => (n / 1048576).toFixed(1);
        text.textContent = total ? `${pct}%（${mb(downloaded)}/${mb(total)} MB）` : `${pct}%`;
      }
    } else {
      // 无 Content-Length，无法算百分比，显示已下载量 + 不确定态
      if (fill) fill.style.width = '100%';
      if (text) text.textContent = downloaded ? `已下载 ${(downloaded/1048576).toFixed(1)} MB` : '下载中...';
    }
  }
};

async function _downloadAsset(url, filename) {
  if (!confirm(`下载 ${filename}？\n\n下载完成后将自动替换当前版本并重启应用。`)) return;
  $('update-status').textContent = `正在下载 ${filename}...`;
  const wrap = $('update-progress');
  if (wrap) wrap.classList.remove('hidden');
  Update.onProgress(0, 0, 0);
  const result = await window.pywebview.api.download_update(url, filename);
  if (result.error) {
    $('update-status').textContent = `下载失败: ${result.error}`;
    if (wrap) wrap.classList.add('hidden');
    return;
  }
  $('update-status').textContent = '下载完成，正在应用更新...';
  if (wrap) wrap.classList.add('hidden');
  const applyResult = await window.pywebview.api.apply_update_and_restart(result.path);
  if (applyResult.error) {
    $('update-status').textContent = `更新失败: ${applyResult.error}`;
  }
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'memory') renderMemoryList();
    if (btn.dataset.tab === 'mcp') {
      renderMcpServers();
      _maybePromptExternalMcp();
    }
  });
});

// ── MCP server management ───────────────────────────────────────
let _mcpEditingIndex = -1;
let _mcpDiscoveredTools = [];
let _mcpDraftId = '';
let _mcpServersDraft = [];
let _externalMcpPrompted = false;
let _externalMcpCandidates = [];
let _externalModelCandidates = [];
let _modelConfigsBeforeOpen = null;

function closeSettingsWithoutSave() {
  if (_modelConfigsBeforeOpen !== null) {
    state.config.model_configs = _modelConfigsBeforeOpen;
    _modelConfigsBeforeOpen = null;
  }
  $('settings-overlay').classList.add('hidden');
}

function _settingsProjectPath() {
  const conv = (state.conversations || []).find(item => item.id === state.currentConvId);
  return conv?.project_path || '';
}

function _externalErrors(containerId, errors) {
  const box = $(containerId);
  box.innerHTML = '';
  (errors || []).forEach(item => {
    const row = document.createElement('div');
    row.textContent = `${item.source || '配置文件'}：${item.error || '读取失败'}`;
    box.appendChild(row);
  });
}

function _externalConflict(candidate, existing, idField) {
  const sameId = existing.find(item => item[idField] === candidate.id);
  if (sameId) return {kind: 'update', label: '将更新'};
  const sameName = existing.find(item => (item.name || '').toLowerCase() === (candidate.name || '').toLowerCase());
  if (sameName) return {kind: 'conflict', label: '名称冲突'};
  return {kind: 'add', label: '新增'};
}

function _renderExternalCandidates(kind, result) {
  const isMcp = kind === 'mcp';
  const list = $(isMcp ? 'mcp-import-list' : 'model-import-list');
  const existing = isMcp ? _mcpServersDraft : (state.config.model_configs || []);
  const idField = isMcp ? 'id' : '_import_id';
  const candidates = result.candidates || [];
  if (isMcp) _externalMcpCandidates = candidates;
  else _externalModelCandidates = candidates;
  list.innerHTML = '';
  if (!candidates.length) {
    list.innerHTML = '<div class="external-import-empty">未发现可读取的本地配置</div>';
  }
  const protocolLabels = {
    anthropic_messages: 'Anthropic Messages',
    openai_responses: 'OpenAI Responses',
    openai_chat: 'Chat Completions',
  };
  candidates.forEach(candidate => {
    const conflict = _externalConflict(candidate, existing, idField);
    const disabled = !candidate.importable || conflict.kind === 'conflict';
    const row = document.createElement('label');
    row.className = `external-import-item${disabled ? ' disabled' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.candidateId = candidate.id;
    checkbox.disabled = disabled;
    checkbox.checked = !disabled && conflict.kind === 'add';
    const main = document.createElement('div');
    main.className = 'external-import-main';
    const meta = isMcp
      ? `${candidate.source_label} · ${candidate.transport || '未知传输'}`
      : `${candidate.source_label} · ${protocolLabels[candidate.protocol] || candidate.protocol || '未知协议'} · ${candidate.model || '未填写模型'}${candidate.has_api_key ? ' · 已检测到密钥' : ' · 未检测到密钥'}`;
    main.innerHTML = `<div class="external-import-name">${escapeHtml(candidate.name)}</div>`
      + `<div class="external-import-meta">${escapeHtml(meta)}</div>`;
    (candidate.warnings || []).forEach(warning => {
      const warningEl = document.createElement('div');
      warningEl.className = 'external-import-warning';
      warningEl.textContent = warning;
      main.appendChild(warningEl);
    });
    if (conflict.kind === 'conflict') {
      const warningEl = document.createElement('div');
      warningEl.className = 'external-import-warning';
      warningEl.textContent = 'QuickModel 已有同名配置，请先重命名或删除后再导入';
      main.appendChild(warningEl);
    }
    const badge = document.createElement('span');
    badge.className = 'external-import-badge';
    badge.textContent = candidate.importable ? conflict.label : '不支持';
    row.appendChild(checkbox); row.appendChild(main); row.appendChild(badge); list.appendChild(row);
  });
  _externalErrors(isMcp ? 'mcp-import-errors' : 'model-import-errors', result.errors);
}

async function _loadExternalMcp(showPanel = true) {
  const result = await window.pywebview.api.discover_external_mcp_configs(_settingsProjectPath());
  _renderExternalCandidates('mcp', result || {});
  if (showPanel) $('mcp-import-panel').classList.remove('hidden');
  return result || {candidates: []};
}

async function _maybePromptExternalMcp() {
  if (_externalMcpPrompted) return;
  _externalMcpPrompted = true;
  try {
    const result = await _loadExternalMcp(false);
    const existingIds = new Set(_mcpServersDraft.map(item => item.id));
    const existingNames = new Set(_mcpServersDraft.map(item => (item.name || '').toLowerCase()));
    const hasNew = (result.candidates || []).some(item => item.importable
      && !existingIds.has(item.id) && !existingNames.has((item.name || '').toLowerCase()));
    if (hasNew && confirm('发现本地 Claude/Codex 配置，是否导入？')) {
      $('mcp-import-panel').classList.remove('hidden');
    }
  } catch (error) {
    // Manual import remains available if background discovery fails.
  }
}

function _newMcpId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function _mcpDefaultServer() {
  return {
    id: _newMcpId(), name: '', enabled: true, transport: 'stdio', trusted: false,
    connect_timeout: 15, call_timeout: 60, tool_policy: 'all', enabled_tools: [],
    stdio: {command: '', args: [], cwd: '', env: {}},
    http: {url: '', headers: {}},
  };
}

function _addMcpKvRow(containerId, key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'mcp-kv-row';
  const keyInput = document.createElement('input');
  keyInput.type = 'text'; keyInput.placeholder = 'KEY'; keyInput.value = key;
  const valueInput = document.createElement('input');
  valueInput.type = 'password'; valueInput.placeholder = '值或 ${ENV_VAR}'; valueInput.value = value;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.className = 'btn-ghost'; removeBtn.textContent = '×'; removeBtn.title = '删除';
  removeBtn.addEventListener('click', () => row.remove());
  row.appendChild(keyInput); row.appendChild(valueInput); row.appendChild(removeBtn);
  $(containerId).appendChild(row);
}

function _fillMcpKvRows(containerId, values) {
  $(containerId).innerHTML = '';
  Object.entries(values || {}).forEach(([key, value]) => _addMcpKvRow(containerId, key, value));
}

function _collectMcpKvRows(containerId) {
  const values = {};
  $(containerId).querySelectorAll('.mcp-kv-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const key = inputs[0].value.trim();
    if (key) values[key] = inputs[1].value;
  });
  return values;
}

function _updateMcpTransportFields() {
  const isStdio = $('mcp-transport').value === 'stdio';
  $('mcp-stdio-fields').classList.toggle('hidden', !isStdio);
  $('mcp-http-fields').classList.toggle('hidden', isStdio);
}

function _renderMcpToolList(server) {
  const box = $('mcp-tool-box');
  const list = $('mcp-tool-list');
  if (!_mcpDiscoveredTools.length) {
    box.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  list.innerHTML = '';
  const allow = new Set(server.enabled_tools || []);
  const allMode = server.tool_policy !== 'allowlist';
  _mcpDiscoveredTools.forEach(tool => {
    const row = document.createElement('label');
    row.className = 'mcp-tool-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.dataset.toolName = tool.name; cb.checked = allMode || allow.has(tool.name);
    const info = document.createElement('div');
    info.className = 'mcp-tool-info';
    info.innerHTML = `<div class="mcp-tool-name">${escapeHtml(tool.name)}</div>`
      + `<div class="mcp-tool-desc">${escapeHtml(tool.description || '')}</div>`;
    row.appendChild(cb); row.appendChild(info); list.appendChild(row);
  });
  $('mcp-tool-count').textContent = `${_mcpDiscoveredTools.length} 个`;
}

function _collectMcpEditor() {
  const existing = _mcpEditingIndex >= 0 ? _mcpServersDraft[_mcpEditingIndex] : {id: _mcpDraftId};
  const checkedTools = [...$('mcp-tool-list').querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.dataset.toolName);
  const hasToolSnapshot = _mcpDiscoveredTools.length > 0;
  const allToolsSelected = hasToolSnapshot && checkedTools.length === _mcpDiscoveredTools.length;
  return {
    id: existing.id || _newMcpId(),
    name: $('mcp-name').value.trim(),
    enabled: $('mcp-enabled').checked,
    transport: $('mcp-transport').value,
    trusted: $('mcp-trusted').checked,
    connect_timeout: parseInt($('mcp-connect-timeout').value) || 15,
    call_timeout: parseInt($('mcp-call-timeout').value) || 60,
    tool_policy: hasToolSnapshot ? (allToolsSelected ? 'all' : 'allowlist') : (existing.tool_policy || 'all'),
    enabled_tools: hasToolSnapshot ? (allToolsSelected ? [] : checkedTools) : (existing.enabled_tools || []),
    stdio: {
      command: $('mcp-command').value.trim(),
      args: $('mcp-args').value.split('\n').map(v => v.trim()).filter(Boolean),
      cwd: $('mcp-cwd').value.trim(),
      env: _collectMcpKvRows('mcp-env-rows'),
    },
    http: {
      url: $('mcp-url').value.trim(),
      headers: _collectMcpKvRows('mcp-header-rows'),
    },
  };
}

function _validateMcpDraft(server) {
  if (!server.name) return '请填写服务器名称';
  const duplicate = _mcpServersDraft.some((item, index) =>
    index !== _mcpEditingIndex && (item.name || '').toLowerCase() === server.name.toLowerCase());
  if (duplicate) return '服务器名称不能重复';
  if (server.enabled && server.transport === 'stdio' && !server.stdio.command) return '请填写 stdio Command';
  if (server.enabled && server.transport === 'http' && !/^https?:\/\//i.test(server.http.url)) return '请填写有效的 HTTP Endpoint URL';
  return '';
}

async function renderMcpServers() {
  const container = $('mcp-server-list');
  const servers = _mcpServersDraft;
  const statuses = await window.pywebview.api.get_mcp_statuses();
  const statusMap = new Map((statuses || []).map(item => [item.id, item]));
  container.innerHTML = '';
  if (!servers.length) {
    container.innerHTML = '<div class="mcp-server-empty">尚未配置 MCP 服务器</div>';
    return;
  }
  servers.forEach((server, index) => {
    const persisted = (state.config.mcp_servers || []).find(item => item.id === server.id);
    const isDraft = !persisted || JSON.stringify(persisted) !== JSON.stringify(server);
    const runtimeStatus = statusMap.get(server.id) || {state: 'disconnected', tool_count: 0};
    const status = isDraft
      ? {...runtimeStatus, state: 'draft', tool_count: 0}
      : (server.enabled ? runtimeStatus : {...runtimeStatus, state: 'disabled'});
    const item = document.createElement('div');
    item.className = 'mcp-server-item';
    const main = document.createElement('div');
    main.className = 'mcp-server-main';
    const endpoint = server.transport === 'stdio' ? (server.stdio?.command || '') : (server.http?.url || '');
    main.innerHTML = `<div class="mcp-server-name">${escapeHtml(server.name)}</div>`
      + `<div class="mcp-server-meta">${escapeHtml(server.transport)} · ${escapeHtml(endpoint)}</div>`;
    const stateEl = document.createElement('div');
    stateEl.className = `mcp-state ${status.state || ''}`;
    const stateLabels = {connected: '已连接', connecting: '连接中', error: '错误', disconnected: '未连接', disabled: '已禁用', draft: '待保存'};
    stateEl.textContent = `${stateLabels[status.state] || status.state}${status.tool_count ? ` · ${status.tool_count}` : ''}`;
    stateEl.title = status.last_error || status.server_info || '';
    const actions = document.createElement('div');
    actions.className = 'mcp-server-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary'; editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => openMcpEditor(index));
    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'btn-ghost'; reconnectBtn.textContent = '重连'; reconnectBtn.disabled = !server.enabled || isDraft;
    reconnectBtn.addEventListener('click', async () => {
      reconnectBtn.disabled = true; reconnectBtn.textContent = '连接中';
      await window.pywebview.api.reconnect_mcp_server(server.id);
      await renderMcpServers();
    });
    actions.appendChild(editBtn); actions.appendChild(reconnectBtn);
    item.appendChild(main); item.appendChild(stateEl); item.appendChild(actions); container.appendChild(item);
  });
}

function openMcpEditor(index) {
  _mcpEditingIndex = Number.isInteger(index) ? index : -1;
  const server = _mcpEditingIndex >= 0 ? _mcpServersDraft[_mcpEditingIndex] : _mcpDefaultServer();
  _mcpDraftId = server.id || _newMcpId();
  _mcpDiscoveredTools = [];
  $('mcp-name').value = server.name || '';
  $('mcp-enabled').checked = server.enabled !== false;
  $('mcp-transport').value = server.transport || 'stdio';
  $('mcp-trusted').checked = server.trusted === true;
  $('mcp-connect-timeout').value = server.connect_timeout || 15;
  $('mcp-call-timeout').value = server.call_timeout || 60;
  $('mcp-command').value = server.stdio?.command || '';
  $('mcp-args').value = (server.stdio?.args || []).join('\n');
  $('mcp-cwd').value = server.stdio?.cwd || '';
  $('mcp-url').value = server.http?.url || '';
  _fillMcpKvRows('mcp-env-rows', server.stdio?.env || {});
  _fillMcpKvRows('mcp-header-rows', server.http?.headers || {});
  $('mcp-test-status').textContent = '';
  $('mcp-test-status').className = 'mcp-status-text';
  $('mcp-tool-box').classList.add('hidden');
  $('btn-mcp-editor-delete').classList.toggle('hidden', _mcpEditingIndex < 0);
  _updateMcpTransportFields();
  $('mcp-editor').classList.remove('hidden');
  $('mcp-name').focus();
}

async function _testMcpDraft() {
  const draft = _collectMcpEditor();
  const error = _validateMcpDraft({...draft, enabled: true});
  if (error) { $('mcp-test-status').textContent = error; $('mcp-test-status').className = 'mcp-status-text error'; return; }
  const btn = $('btn-mcp-test');
  btn.disabled = true; btn.textContent = '测试中';
  $('mcp-test-status').textContent = '正在初始化并读取工具列表...';
  $('mcp-test-status').className = 'mcp-status-text';
  try {
    const result = await window.pywebview.api.test_mcp_server(draft);
    if (!result.ok) {
      $('mcp-test-status').textContent = result.error || '连接失败';
      $('mcp-test-status').className = 'mcp-status-text error';
      return;
    }
    _mcpDiscoveredTools = result.tools || [];
    $('mcp-test-status').textContent = `连接成功 · ${result.server_info || 'MCP Server'} · ${result.protocol_version || ''}`;
    $('mcp-test-status').className = 'mcp-status-text ok';
    _renderMcpToolList(draft);
  } catch (err) {
    $('mcp-test-status').textContent = String(err);
    $('mcp-test-status').className = 'mcp-status-text error';
  } finally {
    btn.disabled = false; btn.textContent = '测试连接';
  }
}

$('btn-mcp-add').addEventListener('click', () => openMcpEditor(-1));
$('btn-mcp-import').addEventListener('click', async () => {
  try {
    await _loadExternalMcp(true);
  } catch (error) {
    alert(`读取本地 MCP 配置失败：${error}`);
  }
});
$('btn-mcp-import-cancel').addEventListener('click', () => $('mcp-import-panel').classList.add('hidden'));
$('btn-mcp-import-selected').addEventListener('click', async () => {
  const selected = [...$('mcp-import-list').querySelectorAll('input[type="checkbox"]:checked')]
    .map(item => item.dataset.candidateId);
  if (!selected.length) { alert('请选择要导入的 MCP Server'); return; }
  const result = await window.pywebview.api.import_external_mcp_configs(selected, _settingsProjectPath());
  let imported = 0;
  (result.items || []).forEach(item => {
    const config = item.config;
    const existingIndex = _mcpServersDraft.findIndex(current => current.id === config.id);
    const nameConflict = _mcpServersDraft.some((current, index) => index !== existingIndex
      && (current.name || '').toLowerCase() === (config.name || '').toLowerCase());
    if (nameConflict) return;
    if (existingIndex >= 0) _mcpServersDraft[existingIndex] = config;
    else _mcpServersDraft.push(config);
    imported++;
  });
  _externalErrors('mcp-import-errors', result.errors);
  $('mcp-import-panel').classList.add('hidden');
  await renderMcpServers();
  alert(`已导入 ${imported} 个 MCP Server。点击设置窗口底部“保存”后生效。`);
});
$('btn-mcp-refresh').addEventListener('click', renderMcpServers);
$('mcp-transport').addEventListener('change', _updateMcpTransportFields);
$('btn-mcp-env-add').addEventListener('click', () => _addMcpKvRow('mcp-env-rows'));
$('btn-mcp-header-add').addEventListener('click', () => _addMcpKvRow('mcp-header-rows'));
$('btn-mcp-test').addEventListener('click', _testMcpDraft);
$('btn-mcp-editor-cancel').addEventListener('click', () => $('mcp-editor').classList.add('hidden'));
$('btn-mcp-editor-save').addEventListener('click', async () => {
  const draft = _collectMcpEditor();
  const error = _validateMcpDraft(draft);
  if (error) { alert(error); return; }
  if (_mcpEditingIndex >= 0) _mcpServersDraft[_mcpEditingIndex] = draft;
  else _mcpServersDraft.push(draft);
  $('mcp-editor').classList.add('hidden');
  await renderMcpServers();
});
$('btn-mcp-editor-delete').addEventListener('click', async () => {
  if (_mcpEditingIndex < 0) return;
  const server = _mcpServersDraft[_mcpEditingIndex];
  if (!confirm(`确定删除 MCP 服务器「${server.name}」？`)) return;
  _mcpServersDraft.splice(_mcpEditingIndex, 1);
  $('mcp-editor').classList.add('hidden');
  await renderMcpServers();
});

// ── 跨会话记忆管理 ────────────────────────────────────────────────
async function renderMemoryList() {
  const ul = $('memory-list');
  ul.innerHTML = '<li class="memory-empty">加载中…</li>';
  const items = await window.pywebview.api.list_memory();
  if (!items || items.length === 0) {
    ul.innerHTML = '<li class="memory-empty">暂无记忆。模型在完成任务后会询问是否记入，或点「+ 新增记忆」手动添加。</li>';
    return;
  }
  ul.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.className = 'memory-item';
    const info = document.createElement('div');
    info.className = 'memory-info';
    info.innerHTML = `<div class="memory-key">${escapeHtml(it.key)}</div>`
                   + `<div class="memory-preview">${escapeHtml(it.preview || '')}</div>`;
    const actions = document.createElement('div');
    actions.className = 'memory-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary'; editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => openMemoryEditor(it.key));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger'; delBtn.textContent = '删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`确定删除记忆「${it.key}」？新会话将不再带上它。`)) return;
      await window.pywebview.api.delete_memory(it.key);
      renderMemoryList();
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    li.appendChild(info);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

async function openMemoryEditor(key) {
  const editor = $('memory-editor');
  editor.classList.remove('hidden');
  $('memory-key').value = key || '';
  $('memory-key').readOnly = !!key;  // 编辑已有条目时 key 不可改（改名等于新建）
  $('memory-content').value = key ? await window.pywebview.api.read_memory(key) : '';
  $('memory-content').focus();
}

$('btn-memory-new').addEventListener('click', () => openMemoryEditor(''));
$('btn-memory-cancel').addEventListener('click', () => $('memory-editor').classList.add('hidden'));
$('btn-memory-save').addEventListener('click', async () => {
  const key = $('memory-key').value.trim();
  const content = $('memory-content').value;
  if (!key) { alert('请填写记忆名称'); return; }
  await window.pywebview.api.write_memory(key, content);
  $('memory-editor').classList.add('hidden');
  renderMemoryList();
});

// Sub-tab switching (图片工具内：图片理解 / 图片生成)
document.querySelectorAll('.subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const bar = btn.closest('.tab-panel');
    bar.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    bar.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    bar.querySelector('#subtab-' + btn.dataset.subtab).classList.add('active');
  });
});

async function requestModelList(modelId, boxId, btn, request) {
  const box = $(boxId);
  const oldLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '读取中...';
  box.innerHTML = '<span class="model-list-loading">正在拉取模型列表...</span>';
  try {
    const r = await request();
    if (!r.ok) { box.innerHTML = `<span class="model-list-err">${escapeHtml(r.error || '读取失败')}</span>`; return; }
    box.innerHTML = `<div class="model-list-head">共 ${r.models.length} 个模型（点击填入模型名）</div>`;
    const wrap = document.createElement('div');
    wrap.className = 'model-list-items';
    r.models.forEach(id => {
      const chip = document.createElement('span');
      chip.className = 'model-chip';
      chip.textContent = id;
      chip.title = '点击填入模型名';
      chip.addEventListener('click', () => { $(modelId).value = id; });
      wrap.appendChild(chip);
    });
    box.appendChild(wrap);
  } catch (e) {
    box.innerHTML = `<span class="model-list-err">${escapeHtml(String(e))}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = oldLabel;
  }
}
$('btn-vision-models').addEventListener('click', e =>
  fetchModelList('vision-key', 'vision-url', 'vision-model', 'vision-models-box', e.currentTarget));
$('btn-imagegen-models').addEventListener('click', e =>
  fetchModelList('imagegen-key', 'imagegen-url', 'imagegen-model', 'imagegen-models-box', e.currentTarget));
async function openSettings() {
  _mcpServersDraft = JSON.parse(JSON.stringify(state.config.mcp_servers || []));
  _modelConfigsBeforeOpen = JSON.parse(JSON.stringify(state.config.model_configs || []));
  _mcpEditingIndex = -1;
  _externalMcpPrompted = false;
  _externalMcpCandidates = [];
  _externalModelCandidates = [];
  $('mcp-editor').classList.add('hidden');
  $('mcp-import-panel').classList.add('hidden');
  $('model-import-panel').classList.add('hidden');
  fillSettingsFields(state.config);
  $('sync-list').innerHTML = '';
  $('sync-import-actions').style.display = 'none';
  $('sync-status').textContent = state.config.sync_folder ? '' : '未配置同步文件夹';
  renderModelConfigList();
  // load allowlist
  const cmds = await window.pywebview.api.get_allowed_commands();
  $('allowlist-cmds').value = cmds.join('\n');
  _updateAllowlistCount(cmds.length);
  // load current version
  const ver = await window.pywebview.api.get_app_version();
  $('update-current-ver').textContent = ver || '-';
  $('settings-overlay').classList.remove('hidden');
  if (document.querySelector('.tab-btn.active')?.dataset.tab === 'mcp') {
    _maybePromptExternalMcp();
  }
}

// 读取模型列表（图片理解 / 图片生成共用）
async function fetchModelList(keyId, urlId, modelId, boxId, btn) {
  const key = $(keyId).value.trim();
  const url = $(urlId).value.trim();
  if (!key || !url) {
    $(boxId).innerHTML = '<span class="model-list-err">请先填写 API Key 和 API 地址</span>';
    return;
  }
  return requestModelList(modelId, boxId, btn,
    () => window.pywebview.api.list_models(key, url));
}

// 用 cfg 填充设置面板各输入框（openSettings 与导入配置后共用）
function fillSettingsFields(cfg) {
  $('search-engine').value = cfg.search_engine || 'tavily';
  $('search-fallback').checked = cfg.search_fallback !== false;
  $('tavily-key').value = cfg.tavily_api_key || '';
  $('brave-key').value = cfg.brave_api_key || '';
  $('firecrawl-key').value = cfg.firecrawl_api_key || '';
  $('google-key').value = cfg.google_api_key || '';
  $('google-cx').value = cfg.google_cx || '';
  $('searxng-url').value = cfg.searxng_url || '';
  $('cmd-safety').value = cfg.command_safety || 'confirm';
  $('cmd-timeout').value = cfg.command_timeout || 30;
  $('max-rounds').value = cfg.max_rounds || 50;
  $('vision-key').value = cfg.vision_api_key || '';
  $('vision-url').value = cfg.vision_base_url || '';
  $('vision-model').value = cfg.vision_model || '';
  $('vision-timeout').value = cfg.vision_timeout || 90;
  $('imagegen-key').value = cfg.imagegen_api_key || '';
  $('imagegen-url').value = cfg.imagegen_base_url || '';
  $('imagegen-model').value = cfg.imagegen_model || '';
  $('imagegen-format').value = cfg.imagegen_format || 'openai';
  $('imagegen-use-full-url').checked = cfg.imagegen_use_full_url || false;
  const themeMode = ['auto', 'day', 'dusk', 'night'].includes(cfg.theme_mode)
    ? cfg.theme_mode : (cfg.theme === 'light' ? 'day' : cfg.theme === 'dark' ? 'night' : 'auto');
  $('ui-theme').value = themeMode;
  $('ui-fontsize').value = String(cfg.font_size || 14);
  $('starfield-enabled').checked = cfg.starfield_enabled === true;
  $('starfield-mode').value = cfg.starfield_mode || 'twinkle';
  $('background-quality').value = ['eco', 'balanced', 'high'].includes(cfg.background_quality)
    ? cfg.background_quality : 'balanced';
  const explicitWeather = ['cloudy', 'rain', 'snow', 'fog', 'thunder'].includes(cfg.weather_preview);
  $('weather-enabled').checked = cfg.weather_enabled !== false || explicitWeather;
  $('weather-preview').value = cfg.weather_preview || 'auto';
  $('weather-location-mode').value = cfg.weather_location_mode || 'ip';
  $('weather-city').value = cfg.weather_city || '';
  $('weather-intensity').value = String(cfg.weather_intensity ?? 70);
  $('weather-mist').value = String(cfg.weather_mist ?? 32);
  $('weather-refraction').value = String(cfg.weather_refraction ?? 65);
  syncWeatherRangeOutputs();
  syncWeatherLocationField();
  $('sync-folder').value = cfg.sync_folder || '';
  $('sync-auto-upload').checked = cfg.sync_auto_upload !== false;
  $('github-token').value = cfg.github_token || '';
}

function syncWeatherLocationField() {
  const automatic = $('weather-preview').value === 'auto';
  const manual = automatic && $('weather-location-mode').value === 'manual';
  const explicitWeather = ['cloudy', 'rain', 'snow', 'fog', 'thunder'].includes($('weather-preview').value);
  if (explicitWeather) $('weather-enabled').checked = true;
  $('weather-location-mode').disabled = !automatic;
  $('weather-city-wrap').style.opacity = manual ? '1' : '0.55';
  $('weather-city').disabled = !manual;
  $('starfield-mode').disabled = explicitWeather && $('weather-enabled').checked;
}

function syncWeatherRangeOutputs() {
  $('weather-intensity-value').textContent = `${$('weather-intensity').value}%`;
  $('weather-mist-value').textContent = `${$('weather-mist').value}%`;
  $('weather-refraction-value').textContent = `${$('weather-refraction').value}%`;
}

$('weather-location-mode').addEventListener('change', syncWeatherLocationField);
$('weather-preview').addEventListener('change', syncWeatherLocationField);
$('weather-enabled').addEventListener('change', () => {
  if (!$('weather-enabled').checked
      && ['cloudy', 'rain', 'snow', 'fog', 'thunder'].includes($('weather-preview').value)) {
    $('weather-preview').value = 'clear';
  }
  syncWeatherLocationField();
});
['weather-intensity', 'weather-mist', 'weather-refraction'].forEach(id => {
  $(id).addEventListener('input', syncWeatherRangeOutputs);
});

async function saveSettings() {
  saveCurrentMc();
  state.config.search_engine = $('search-engine').value;
  state.config.search_fallback = $('search-fallback').checked;
  state.config.tavily_api_key = $('tavily-key').value.trim();
  state.config.brave_api_key = $('brave-key').value.trim();
  state.config.firecrawl_api_key = $('firecrawl-key').value.trim();
  state.config.google_api_key = $('google-key').value.trim();
  state.config.google_cx = $('google-cx').value.trim();
  state.config.searxng_url = $('searxng-url').value.trim();
  state.config.command_safety = $('cmd-safety').value;
  state.config.command_timeout = parseInt($('cmd-timeout').value) || 30;
  state.config.max_rounds = parseInt($('max-rounds').value) || 50;
  state.config.vision_api_key = $('vision-key').value.trim();
  state.config.vision_base_url = $('vision-url').value.trim();
  state.config.vision_model = $('vision-model').value.trim();
  state.config.vision_timeout = Math.max(10, Math.min(parseInt($('vision-timeout').value) || 90, 300));
  state.config.imagegen_api_key = $('imagegen-key').value.trim();
  state.config.imagegen_base_url = $('imagegen-url').value.trim();
  state.config.imagegen_model = $('imagegen-model').value.trim();
  state.config.imagegen_format = $('imagegen-format').value;
  state.config.imagegen_use_full_url = $('imagegen-use-full-url').checked;
  state.config.theme_mode = $('ui-theme').value;
  state.config.theme = state.config.theme_mode === 'night' ? 'dark' : 'light';
  state.config.font_size = parseInt($('ui-fontsize').value) || 14;
  state.config.starfield_enabled = $('starfield-enabled').checked;
  state.config.starfield_mode = $('starfield-mode').value;
  state.config.background_quality = $('background-quality').value;
  state.config.weather_enabled = $('weather-enabled').checked;
  state.config.weather_preview = $('weather-preview').value;
  state.config.weather_location_mode = $('weather-location-mode').value;
  state.config.weather_location_mode_version = 1;
  state.config.weather_city = $('weather-city').value.trim();
  state.config.weather_intensity = parseInt($('weather-intensity').value) || 70;
  state.config.weather_mist = parseInt($('weather-mist').value) || 0;
  state.config.weather_refraction = parseInt($('weather-refraction').value) || 65;
  state.config.sync_auto_upload = $('sync-auto-upload').checked;
  state.config.github_token = $('github-token').value.trim();
  applyTheme(state.config.theme_mode);
  applyFontSize(state.config.font_size);
  if (typeof applyStarfieldSettings === 'function') applyStarfieldSettings(state.config);
  if (typeof startWeatherBackground === 'function') startWeatherBackground();
  const previousMcpServers = state.config.mcp_servers || [];
  state.config.mcp_servers = JSON.parse(JSON.stringify(_mcpServersDraft));
  const saved = await window.pywebview.api.save_config(state.config);
  if (saved && saved.ok === false) {
    state.config.mcp_servers = previousMcpServers;
    alert(`保存设置失败：${saved.error || 'MCP 配置无效'}`);
    return;
  }
  _modelConfigsBeforeOpen = null;
  populateModelSelect();
  $('settings-overlay').classList.add('hidden');
}

// ── Sync handlers ────────────────────────────────────────────────
$('btn-sync-choose').addEventListener('click', async () => {
  const folder = await window.pywebview.api.sync_choose_folder();
  if (folder) {
    $('sync-folder').value = folder;
    state.config.sync_folder = folder;
    $('sync-status').textContent = '已配置';
  }
});

$('btn-sync-upload-all').addEventListener('click', async () => {
  $('sync-status').textContent = '正在上传...';
  const result = await window.pywebview.api.sync_upload_all();
  $('sync-status').textContent = `已上传 ${result.uploaded} 个对话`;
});

$('btn-sync-detect').addEventListener('click', async () => {
  $('sync-status').textContent = '正在检测...';
  const items = await window.pywebview.api.sync_detect_new();
  if (!items || items.length === 0) {
    $('sync-status').textContent = '没有发现新对话';
    $('sync-list').innerHTML = '';
    $('sync-import-actions').style.display = 'none';
    return;
  }
  $('sync-status').textContent = `发现 ${items.length} 个可导入的对话：`;
  const list = $('sync-list');
  list.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.filename = item.filename;
    const label = document.createElement('span');
    const badge = item.is_new ? '<span style="color:var(--accent);font-size:11px;">[新]</span> ' : '<span style="color:#e0af68;font-size:11px;">[更新]</span> ';
    label.innerHTML = `${badge}${item.title} <span style="color:var(--text-muted);font-size:11px;">${item.updated_at ? item.updated_at.slice(0,16).replace('T',' ') : ''}</span>`;
    div.appendChild(cb);
    div.appendChild(label);
    list.appendChild(div);
  });
  $('sync-import-actions').style.display = '';
});

$('btn-sync-select-all').addEventListener('click', () => {
  const cbs = $('sync-list').querySelectorAll('input[type="checkbox"]');
  const allChecked = [...cbs].every(cb => cb.checked);
  cbs.forEach(cb => cb.checked = !allChecked);
});

$('btn-sync-import').addEventListener('click', async () => {
  const cbs = $('sync-list').querySelectorAll('input[type="checkbox"]:checked');
  const filenames = [...cbs].map(cb => cb.dataset.filename);
  if (!filenames.length) return;
  $('sync-status').textContent = '正在导入...';
  const result = await window.pywebview.api.sync_import_selected(filenames);
  $('sync-status').textContent = `成功导入 ${result.imported} 个对话`;
  $('sync-list').innerHTML = '';
  $('sync-import-actions').style.display = 'none';
  // 刷新对话列表
  state.conversations = await window.pywebview.api.list_conversations();
  renderConvList('');
});

// 一键上传全部（对话+配置）
$('btn-sync-all').addEventListener('click', async () => {
  $('sync-status').textContent = '正在同步上传...';
  const result = await window.pywebview.api.sync_all();
  const cfgList = result.config_uploaded.length ? `，配置: ${result.config_uploaded.join(', ')}` : '';
  const memUp = result.memory_uploaded ? `，记忆: ${result.memory_uploaded} 条` : '';
  const skillUp = result.skills_uploaded ? `，技能: ${result.skills_uploaded} 条` : '';
  $('sync-status').textContent = `已上传 ${result.conversations_uploaded} 个对话${cfgList}${memUp}${skillUp}`;
});

// 一键导入全部（对话+配置）
$('btn-sync-import-all').addEventListener('click', async () => {
  $('sync-status').textContent = '正在一键导入...';
  const result = await window.pywebview.api.sync_import_all();
  const cfgList = result.config_imported.length ? `，配置: ${result.config_imported.join(', ')}` : '';
  const memIn = result.memory_imported ? `，记忆: ${result.memory_imported} 条` : '';
  const skillIn = result.skills_imported ? `，技能: ${result.skills_imported} 条` : '';
  $('sync-status').textContent = `导入 ${result.conversations_imported} 个对话${cfgList}${memIn}${skillIn}`;
  // 刷新对话列表和配置
  state.conversations = await window.pywebview.api.list_conversations();
  renderConvList('');
  if (result.config_imported.length) {
    state.config = await window.pywebview.api.get_config();
    populateModelSelect();
    fillSettingsFields(state.config);  // 即时刷新设置面板输入框（vision/imagegen/github 等）
    applyTheme(state.config.theme_mode || state.config.theme);
    applyFontSize(state.config.font_size);
    if (typeof startWeatherBackground === 'function') startWeatherBackground();
  }
});

const MODEL_API_TYPE_META = Object.freeze({
  openai_chat: {
    protocol: 'openai_chat', provider: 'generic', client: 'generic',
    summary: 'Chat Completions · 通用参数', endpoint: '/chat/completions',
    placeholder: 'https://api.openai.com/v1',
  },
  openai_responses: {
    protocol: 'openai_responses', provider: 'generic', client: 'generic',
    summary: 'Responses · 通用 SDK', endpoint: '/responses',
    placeholder: 'https://api.openai.com/v1',
  },
  anthropic: {
    protocol: 'anthropic_messages', provider: 'generic', client: 'generic',
    summary: 'Anthropic Messages', endpoint: '/v1/messages',
    placeholder: 'https://api.anthropic.com',
  },
  deepseek: {
    protocol: 'openai_chat', provider: 'deepseek', client: 'generic',
    summary: 'Chat Completions · DeepSeek 思考参数', endpoint: '/chat/completions',
    placeholder: 'https://api.deepseek.com/v1',
  },
  qwen: {
    protocol: 'openai_chat', provider: 'qwen', client: 'generic',
    summary: 'Chat Completions · Qwen 思考参数', endpoint: '/chat/completions',
    placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  glm: {
    protocol: 'openai_chat', provider: 'glm', client: 'generic',
    summary: 'Chat Completions · GLM 思考参数', endpoint: '/chat/completions',
    placeholder: 'https://open.bigmodel.cn/api/paas/v4',
  },
  codex_chat: {
    protocol: 'openai_chat', provider: 'generic', client: 'codex',
    summary: 'Chat Completions · Codex 请求头', endpoint: '/chat/completions',
    placeholder: 'https://api.openai.com/v1',
  },
  codex_responses: {
    protocol: 'openai_responses', provider: 'generic', client: 'codex',
    summary: 'Responses · Codex 请求头', endpoint: '/responses',
    placeholder: 'https://api.openai.com/v1',
  },
});

const MODEL_PROMPT_TEMPLATES = Object.freeze({
  general: "You are a precise, pragmatic AI assistant. Understand the user's goal before acting, ask only when missing information materially blocks progress, use available tools when they improve reliability, distinguish verified facts from assumptions, and return concise, actionable results. Preserve user data and avoid unrelated changes.",
  explore: "You are an exploration and research assistant. Inspect the available context and evidence before concluding. Break ambiguous questions into testable parts, compare plausible explanations, cite concrete sources, files, commands, or results, and clearly separate observations from inference. Do not modify files or external state unless the user asks you to.",
  docs: "You are a technical documentation editor. Identify the intended audience and purpose, preserve factual and technical meaning, use consistent terminology, organize information for scanning, and produce complete paste-ready text. Flag missing evidence or ambiguity instead of inventing details, and keep examples aligned with the real implementation.",
  coding: "You are a senior software engineer. Inspect the repository and its instructions before editing, follow existing architecture and conventions, implement the requested behavior end to end, keep changes scoped, preserve unrelated work, and verify with tests or direct runtime checks. Explain important assumptions, failures, and remaining risks concisely.",
  review: "You are a rigorous code reviewer. Lead with actionable findings ordered by severity and grounded in concrete file and line references. Prioritize correctness bugs, behavioral regressions, security risks, data loss, compatibility issues, and missing tests. Keep summaries secondary, distinguish confirmed defects from questions, and do not modify code unless the user requests a fix.",
});

function inferPromptTemplate(value) {
  const prompt = String(value || '').trim();
  for (const [key, template] of Object.entries(MODEL_PROMPT_TEMPLATES)) {
    if (prompt === template) return key;
  }
  return 'custom';
}

function syncPromptTemplateSelection() {
  $('mc-prompt-template').value = inferPromptTemplate($('mc-system').value);
}

function inferModelApiType(mc) {
  if (MODEL_API_TYPE_META[mc.api_type]) return mc.api_type;
  const protocol = mc.api_protocol || 'openai_chat';
  if (mc.client_profile === 'codex') {
    return protocol === 'openai_responses' ? 'codex_responses' : 'codex_chat';
  }
  if (protocol === 'anthropic_messages') return 'anthropic';
  if (protocol === 'openai_responses') return 'openai_responses';
  return ['deepseek', 'qwen', 'glm'].includes(mc.provider_profile)
    ? mc.provider_profile : 'openai_chat';
}

function applyModelApiType(mc, apiType) {
  const type = MODEL_API_TYPE_META[apiType] ? apiType : 'openai_chat';
  const meta = MODEL_API_TYPE_META[type];
  mc.api_type = type;
  mc.api_protocol = meta.protocol;
  mc.provider_profile = meta.provider;
  mc.client_profile = meta.client;
  if (type !== 'anthropic') mc.auth_mode = 'api_key';
  if (meta.protocol !== 'openai_responses') mc.responses_server_state = false;
  delete mc.use_full_url;
  return meta;
}

// Model config list
function renderModelConfigList() {
  const ul = $('model-config-list');
  ul.innerHTML = '';
  (state.config.model_configs || []).forEach((mc, i) => {
    const li = document.createElement('li');
    if (i === state.selectedMcIdx) li.classList.add('active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mc-item-name';
    nameSpan.textContent = mc.name;
    li.appendChild(nameSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'mc-item-del';
    delBtn.textContent = '×';
    delBtn.title = '删除此配置';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const configs = state.config.model_configs || [];
      if (configs.length <= 1) { alert('至少保留一个模型配置'); return; }
      if (!confirm(`确定删除配置「${mc.name}」？`)) return;
      configs.splice(i, 1);
      if (state.selectedMcIdx === i) {
        state.selectedMcIdx = null;
        ['mc-name','mc-key','mc-url','mc-model'].forEach(id => $(id).value = '');
        $('mc-system').value = '';
      } else if (state.selectedMcIdx > i) {
        state.selectedMcIdx--;
      }
      renderModelConfigList();
    });
    li.appendChild(delBtn);

    li.addEventListener('click', () => selectMc(i));
    ul.appendChild(li);
  });
}

function selectMc(idx) {
  state.selectedMcIdx = idx;
  const mc = state.config.model_configs[idx];
  $('mc-name').value = mc.name || '';
  $('mc-api-type').value = inferModelApiType(mc);
  $('mc-auth-mode').value = mc.auth_mode || 'api_key';
  $('mc-responses-state').checked = mc.responses_server_state === true;
  $('mc-key').value = mc.api_key || '';
  $('mc-url').value = mc.base_url || '';
  $('mc-model').value = mc.model || '';
  $('mc-image-input-mode').value = mc.image_input_mode || 'auto';
  $('mc-system').value = mc.system_prompt || '';
  syncPromptTemplateSelection();
  updateModelApiTypeUI();
  // 上下文长度和压缩阈值（自动选择 K/M 单位）
  const ctxLen = mc.context_length || 600000;
  if (ctxLen >= 1000000 && ctxLen % 1000000 === 0) {
    $('mc-context-length').value = ctxLen / 1000000;
    $('mc-context-unit').value = 'M';
  } else {
    $('mc-context-length').value = Math.round(ctxLen / 1000);
    $('mc-context-unit').value = 'K';
  }
  const threshold = mc.compact_threshold || 600000;
  if (threshold >= 1000000 && threshold % 1000000 === 0) {
    $('mc-compact-threshold').value = threshold / 1000000;
    $('mc-compact-unit').value = 'M';
  } else {
    $('mc-compact-threshold').value = Math.round(threshold / 1000);
    $('mc-compact-unit').value = 'K';
  }
  renderModelConfigList();
}

function saveCurrentMc() {
  if (state.selectedMcIdx === null) return null;
  const mc = state.config.model_configs[state.selectedMcIdx];
  mc.name = $('mc-name').value.trim() || mc.name;
  applyModelApiType(mc, $('mc-api-type').value);
  mc.auth_mode = $('mc-auth-mode').value;
  mc.responses_server_state = $('mc-responses-state').checked;
  mc.api_key = $('mc-key').value.trim();
  mc.base_url = $('mc-url').value.trim();
  mc.model = $('mc-model').value.trim();
  mc.image_input_mode = $('mc-image-input-mode').value;
  mc.system_prompt = $('mc-system').value.trim();
  // 上下文长度和压缩阈值
  const ctxVal = parseFloat($('mc-context-length').value) || 600;
  const ctxUnit = $('mc-context-unit').value;
  mc.context_length = Math.round(ctxVal * (ctxUnit === 'M' ? 1000000 : 1000));
  const compVal = parseFloat($('mc-compact-threshold').value) || 600;
  const compUnit = $('mc-compact-unit').value;
  mc.compact_threshold = Math.round(compVal * (compUnit === 'M' ? 1000000 : 1000));
  renderModelConfigList();
  return mc;
}

function updateModelApiTypeUI() {
  const apiType = $('mc-api-type').value || 'openai_chat';
  const meta = MODEL_API_TYPE_META[apiType] || MODEL_API_TYPE_META.openai_chat;
  const isAnthropic = meta.protocol === 'anthropic_messages';
  const isResponses = meta.protocol === 'openai_responses';
  $('mc-auth-mode-wrap').classList.toggle('hidden', !isAnthropic);
  $('mc-responses-state-wrap').classList.toggle('hidden', !isResponses);
  $('mc-key-title').textContent = isAnthropic ? 'Anthropic 凭据' : 'API Key';
  $('mc-key').placeholder = isAnthropic ? 'API Key 或 Auth Token' : 'sk-...';
  $('mc-url').placeholder = meta.placeholder;
  $('mc-api-summary').textContent = meta.summary;
  $('mc-url-hint').textContent = `请求路径：${meta.endpoint}`;
  $('btn-mc-models').style.display = isAnthropic ? 'none' : '';
  if (isAnthropic) $('mc-models-box').innerHTML = '';
}

$('mc-api-type').addEventListener('change', updateModelApiTypeUI);
$('mc-system').addEventListener('input', syncPromptTemplateSelection);
$('btn-apply-prompt-template').addEventListener('click', () => {
  const key = $('mc-prompt-template').value;
  if (!MODEL_PROMPT_TEMPLATES[key]) return;
  $('mc-system').value = MODEL_PROMPT_TEMPLATES[key];
  syncPromptTemplateSelection();
  $('mc-system').focus();
});
$('btn-mc-models').addEventListener('click', e => {
  const mc = saveCurrentMc();
  if (!mc || !mc.api_key || !mc.base_url) {
    $('mc-models-box').innerHTML = '<span class="model-list-err">请先填写 API Key 和 API 地址</span>';
    return;
  }
  requestModelList('mc-model', 'mc-models-box', e.currentTarget,
    () => window.pywebview.api.list_text_models(mc));
});

$('btn-save-mc').addEventListener('click', saveCurrentMc);
$('btn-model-import').addEventListener('click', async () => {
  try {
    const result = await window.pywebview.api.discover_external_model_configs(_settingsProjectPath());
    _renderExternalCandidates('model', result || {});
    $('model-import-panel').classList.remove('hidden');
  } catch (error) {
    alert(`读取本地模型配置失败：${error}`);
  }
});
$('btn-model-import-cancel').addEventListener('click', () => $('model-import-panel').classList.add('hidden'));
$('btn-model-import-selected').addEventListener('click', async () => {
  const selected = [...$('model-import-list').querySelectorAll('input[type="checkbox"]:checked')]
    .map(item => item.dataset.candidateId);
  if (!selected.length) { alert('请选择要导入的模型配置'); return; }
  saveCurrentMc();
  const result = await window.pywebview.api.import_external_model_configs(selected, _settingsProjectPath());
  const configs = state.config.model_configs || [];
  let imported = 0;
  let selectedIndex = null;
  (result.items || []).forEach(item => {
    const config = item.config;
    const existingIndex = configs.findIndex(current => current._import_id === config._import_id);
    const nameConflict = configs.some((current, index) => index !== existingIndex
      && (current.name || '').toLowerCase() === (config.name || '').toLowerCase());
    if (nameConflict) return;
    if (existingIndex >= 0) {
      configs[existingIndex] = config;
      selectedIndex = existingIndex;
    } else {
      configs.push(config);
      selectedIndex = configs.length - 1;
    }
    imported++;
  });
  state.config.model_configs = configs;
  _externalErrors('model-import-errors', result.errors);
  $('model-import-panel').classList.add('hidden');
  if (selectedIndex !== null) selectMc(selectedIndex);
  else renderModelConfigList();
  alert(`已导入 ${imported} 个模型配置并自动匹配接口类型。请点击设置窗口底部“保存”。`);
});
$('btn-add-model').addEventListener('click', () => {
  const configs = state.config.model_configs || [];
  configs.push({ name: `新配置 ${configs.length + 1}`, api_key: '', base_url: '', model: '', system_prompt: MODEL_PROMPT_TEMPLATES.general, context_length: 1000000, compact_threshold: 600000, api_type: 'openai_chat', auth_mode: 'api_key', responses_server_state: false });
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

