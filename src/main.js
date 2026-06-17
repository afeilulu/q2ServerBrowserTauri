// Safe wrappers for Tauri APIs, as window.__TAURI__ might not be immediately available during early script evaluation on mobile WebViews.
const getTauri = () => window.__TAURI__;
const invoke = (...args) => {
  const tauri = getTauri();
  if (tauri && tauri.core) {
    return tauri.core.invoke(...args);
  }
  console.warn("Tauri invoke called, but window.__TAURI__.core is not ready yet.");
  return Promise.reject("Tauri is not ready");
};
const listen = (...args) => {
  const tauri = getTauri();
  if (tauri && tauri.event) {
    return tauri.event.listen(...args);
  }
  console.warn("Tauri listen called, but window.__TAURI__.event is not ready yet.");
  return Promise.reject("Tauri is not ready");
};

// App State
let servers = [];
let selectedServerAddr = null;
let settings = {
  minimize_to_tray: false,
  refresh_interval: 30,
  disable_notifications: false,
  close_to_tray: true
};
let serverDetailsMap = new Map(); // addr -> queryResult

// DOM Elements
const appContainerEl = document.querySelector('.app-container');
const serverListEl = document.getElementById('server-list');
const emptyDetailsEl = document.getElementById('empty-details');
const serverDetailsEl = document.getElementById('server-details');
const backToListBtn = document.getElementById('back-to-list-btn');

// Expose goBackToList globally for direct inline onclick trigger
window.goBackToList = function() {
  window.history.back();
};

const detailNameEl = document.getElementById('detail-server-name');
const detailAddrEl = document.getElementById('detail-server-addr');
const detailMapEl = document.getElementById('detail-server-map');
const detailPlayersCountEl = document.getElementById('detail-server-players-count');
const detailPingEl = document.getElementById('detail-server-ping');
const playersListBodyEl = document.getElementById('players-list-body');

const statusTextEl = document.getElementById('status-text');

// Modals
const addModalEl = document.getElementById('add-modal');
const settingsModalEl = document.getElementById('settings-modal');

// Buttons
const addServerBtn = document.getElementById('add-server-btn');
const closeAddModalBtn = document.getElementById('close-add-modal');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addServerForm = document.getElementById('add-server-form');

const settingsBtn = document.getElementById('settings-btn');
const closeSettingsModalBtn = document.getElementById('close-settings-modal');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const settingsForm = document.getElementById('settings-form');

const refreshBtn = document.getElementById('refresh-btn');
const deleteBtn = document.getElementById('delete-btn');

// Init app
window.addEventListener('DOMContentLoaded', async () => {
  window.history.replaceState({ view: 'list' }, '');
  setupEventListeners();
  await loadSettings();
  await loadServers();
  setupTauriEventListeners();
});

// Listen to popstate for handling back navigation (both on-screen Back and physical Android Back buttons)
window.addEventListener('popstate', (event) => {
  if (event.state && event.state.view === 'details') {
    selectedServerAddr = event.state.addr;
    updateDetailsPanel(selectedServerAddr);
    if (appContainerEl) {
      appContainerEl.classList.add('show-details');
    }
  } else {
    if (appContainerEl) {
      appContainerEl.classList.remove('show-details');
    }
    selectedServerAddr = null;
  }
});

// Setup Events
function setupEventListeners() {
  // Add Server Modals
  addServerBtn.addEventListener('click', () => {
    document.getElementById('server-name-input').value = '';
    document.getElementById('server-addr-input').value = '';
    addModalEl.classList.remove('hidden');
    document.getElementById('server-name-input').focus();
  });
  closeAddModalBtn.addEventListener('click', () => addModalEl.classList.add('hidden'));
  cancelAddBtn.addEventListener('click', () => addModalEl.classList.add('hidden'));
  
  addServerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('server-name-input').value.trim();
    const addr = document.getElementById('server-addr-input').value.trim();
    
    if (name && addr) {
      try {
        updateStatus(`正在添加服务器 ${name}...`);
        await invoke('add_server', { name, addr });
        addModalEl.classList.add('hidden');
        updateStatus(`服务器 ${name} 添加成功`);
        await loadServers();
      } catch (err) {
        updateStatus(`添加服务器失败: ${err}`, true);
      }
    }
  });

  // Settings Modal
  settingsBtn.addEventListener('click', () => {
    document.getElementById('minimize-startup-input').checked = settings.minimize_to_tray;
    document.getElementById('close-tray-input').checked = settings.close_to_tray;
    
    const radios = document.getElementsByName('refresh-interval');
    for (let radio of radios) {
      if (parseInt(radio.value) === settings.refresh_interval) {
        radio.checked = true;
      }
    }
    
    document.getElementById('disable-notify-input').checked = settings.disable_notifications;
    
    // Disable notification checkbox if refresh is disabled
    const disableNotifyCheckbox = document.getElementById('disable-notify-input');
    if (settings.refresh_interval === 0) {
      disableNotifyCheckbox.disabled = true;
      disableNotifyCheckbox.checked = true;
    } else {
      disableNotifyCheckbox.disabled = false;
    }

    settingsModalEl.classList.remove('hidden');
  });

  // Handle settings modal refresh linkage
  document.getElementsByName('refresh-interval').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const disableNotifyCheckbox = document.getElementById('disable-notify-input');
      if (parseInt(e.target.value) === 0) {
        disableNotifyCheckbox.checked = true;
        disableNotifyCheckbox.disabled = true;
      } else {
        disableNotifyCheckbox.disabled = false;
      }
    });
  });

  closeSettingsModalBtn.addEventListener('click', () => settingsModalEl.classList.add('hidden'));
  cancelSettingsBtn.addEventListener('click', () => settingsModalEl.classList.add('hidden'));
  
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minimize = document.getElementById('minimize-startup-input').checked;
    const closeTray = document.getElementById('close-tray-input').checked;
    
    let interval = 30;
    const radios = document.getElementsByName('refresh-interval');
    for (let radio of radios) {
      if (radio.checked) {
        interval = parseInt(radio.value);
        break;
      }
    }
    
    const disableNotify = document.getElementById('disable-notify-input').checked;
    
    const newSettings = {
      minimize_to_tray: minimize,
      refresh_interval: interval,
      disable_notifications: disableNotify,
      close_to_tray: closeTray
    };

    try {
      updateStatus('正在保存设置...');
      await invoke('save_settings', { settings: newSettings });
      settings = newSettings;
      settingsModalEl.classList.add('hidden');
      updateStatus('设置保存成功');
    } catch (err) {
      updateStatus(`保存设置失败: ${err}`, true);
    }
  });

  // Details Actions
  refreshBtn.addEventListener('click', async () => {
    if (selectedServerAddr) {
      await refreshSingleServer(selectedServerAddr);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!selectedServerAddr) return;
    const srv = servers.find(s => s.addr === selectedServerAddr);
    if (!srv) return;
    
    if (confirm(`确定要删除服务器 "${srv.name}" 吗？`)) {
      try {
        updateStatus(`正在删除服务器 ${srv.name}...`);
        await invoke('delete_server', { addr: selectedServerAddr });
        updateStatus(`服务器已删除`);
        
        serverDetailsMap.delete(selectedServerAddr);
        serverDetailsEl.classList.add('hidden');
        emptyDetailsEl.classList.remove('hidden');
        window.history.back();
        
        await loadServers();
      } catch (err) {
        updateStatus(`删除服务器失败: ${err}`, true);
      }
    }
  });

  // Back button for mobile
  if (backToListBtn) {
    backToListBtn.addEventListener('click', () => {
      window.history.back();
    });
  }
}

// Listen for background updates from Rust
async function setupTauriEventListeners() {
  await listen('server-status-updated', (event) => {
    const { addr, result } = event.payload;
    serverDetailsMap.set(addr, result);
    
    // Update the UI card for this server in the sidebar
    updateServerListItemUI(addr, result);
    
    // If this is the currently selected server, update the details panel
    if (selectedServerAddr === addr) {
      updateDetailsPanel(addr);
      updateStatus('自动刷新完成');
    }
  });
}

// Load settings from backend
async function loadSettings() {
  try {
    settings = await invoke('get_settings');
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Load servers from backend
async function loadServers() {
  try {
    servers = await invoke('get_servers');
    renderServerList();
    
    // Query each server in background on startup to populate state
    servers.forEach(srv => {
      refreshSingleServer(srv.addr, false);
    });
  } catch (err) {
    updateStatus(`加载服务器列表失败: ${err}`, true);
  }
}

// Perform status query on single server
async function refreshSingleServer(addr, updateUI = true) {
  if (updateUI && selectedServerAddr === addr) {
    updateStatus('正在查询服务器状态...');
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }
  
  try {
    const result = await invoke('query_server', { addr });
    serverDetailsMap.set(addr, result);
    
    updateServerListItemUI(addr, result);
    
    if (selectedServerAddr === addr) {
      updateDetailsPanel(addr);
      updateStatus('服务器状态已更新');
    }
  } catch (err) {
    console.error(`Query failed for ${addr}:`, err);
    if (selectedServerAddr === addr) {
      updateStatus(`查询失败: ${err}`, true);
    }
  } finally {
    if (updateUI && selectedServerAddr === addr) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
  }
}

// Render server list in sidebar
function renderServerList() {
  serverListEl.innerHTML = '';
  
  if (servers.length === 0) {
    serverListEl.innerHTML = `
      <div class="list-empty-state">
        <p>暂无服务器，请添加</p>
      </div>
    `;
    return;
  }
  
  servers.forEach(srv => {
    const item = document.createElement('div');
    item.className = 'server-item';
    item.dataset.addr = srv.addr;
    if (selectedServerAddr === srv.addr) {
      item.classList.add('active');
    }
    
    const status = serverDetailsMap.get(srv.addr) || { is_online: false, players: [] };
    const onlineClass = status.is_online ? 'online' : 'offline';
    const playersText = status.is_online && status.server_info 
      ? `${status.players.length}/${status.server_info.max_clients}` 
      : '-/-';
      
    const mapText = status.is_online && status.server_info && status.server_info.map_name
      ? status.server_info.map_name
      : '';
      
    const pingText = status.is_online ? `● ${status.ping}ms` : '';
    let pingClass = 'ping-low';
    if (status.ping >= 150) pingClass = 'ping-high';
    else if (status.ping >= 50) pingClass = 'ping-medium';

    item.innerHTML = `
      <div class="server-item-row1">
        <div class="server-name-wrapper">
          <span class="status-dot ${onlineClass}"></span>
          <span class="server-name" title="${srv.name}">${srv.name}</span>
        </div>
        <span class="player-badge">${playersText}</span>
      </div>
      <div class="server-item-row2">
        <span class="server-address-map">${srv.addr}${mapText ? ' | ' + mapText : ''}</span>
        <span class="server-ping ${pingClass}">${pingText}</span>
      </div>
    `;
    
    item.addEventListener('click', () => {
      selectServer(srv.addr);
    });
    
    serverListEl.appendChild(item);
  });
}

// Update single item UI without full list re-render
function updateServerListItemUI(addr, result) {
  const item = serverListEl.querySelector(`.server-item[data-addr="${addr}"]`);
  if (!item) return;
  
  const statusDot = item.querySelector('.status-dot');
  const playerBadge = item.querySelector('.player-badge');
  const addrMapSpan = item.querySelector('.server-address-map');
  const pingSpan = item.querySelector('.server-ping');
  
  const srv = servers.find(s => s.addr === addr);
  if (!srv) return;
  
  if (result.is_online) {
    statusDot.className = 'status-dot online';
    const max = result.server_info ? result.server_info.max_clients : 0;
    playerBadge.textContent = `${result.players.length}/${max}`;
    
    const map = result.server_info && result.server_info.map_name ? result.server_info.map_name : '';
    addrMapSpan.textContent = `${addr}${map ? ' | ' + map : ''}`;
    
    pingSpan.textContent = `● ${result.ping}ms`;
    pingSpan.className = 'server-ping ' + (result.ping < 50 ? 'ping-low' : result.ping < 150 ? 'ping-medium' : 'ping-high');
  } else {
    statusDot.className = 'status-dot offline';
    playerBadge.textContent = '-/-';
    addrMapSpan.textContent = addr;
    pingSpan.textContent = '';
  }
}

// Select a server and display details
function selectServer(addr) {
  selectedServerAddr = addr;
  
  // Update sidebar active selection
  const items = serverListEl.querySelectorAll('.server-item');
  items.forEach(item => {
    if (item.dataset.addr === addr) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Show details panel
  emptyDetailsEl.classList.add('hidden');
  serverDetailsEl.classList.remove('hidden');
  
  // Push state to browser history so that physical Android back button works
  window.history.pushState({ view: 'details', addr: addr }, '');

  if (appContainerEl) {
    appContainerEl.classList.add('show-details');
  }
  
  // Fill in quick cache data
  updateDetailsPanel(addr);
  
  // Fetch fresh query
  refreshSingleServer(addr);
}

// Update the details panel based on cached/fresh results
function updateDetailsPanel(addr) {
  const srv = servers.find(s => s.addr === addr);
  if (!srv) return;
  
  detailNameEl.textContent = srv.name;
  detailAddrEl.textContent = srv.addr;
  
  const result = serverDetailsMap.get(addr);
  if (result && result.is_online) {
    const map = result.server_info ? result.server_info.map_name : '-';
    const max = result.server_info ? result.server_info.max_clients : 0;
    
    detailMapEl.textContent = `地图: ${map}`;
    detailPlayersCountEl.textContent = `玩家: ${result.players.length} / ${max}`;
    detailPingEl.textContent = `延迟: ${result.ping}ms`;
    
    // Render players table
    renderPlayersTable(result.players);
  } else {
    detailMapEl.textContent = '地图: -';
    detailPlayersCountEl.textContent = '玩家: -';
    detailPingEl.textContent = result && result.error ? '服务器离线 (无法连接)' : '延迟: -';
    
    playersListBodyEl.innerHTML = `
      <tr>
        <td colspan="3" class="table-empty">${result && result.error ? '服务器处于离线状态' : '正在获取数据...'}</td>
      </tr>
    `;
  }
}

// Render online players table
function renderPlayersTable(players) {
  playersListBodyEl.innerHTML = '';
  
  if (players.length === 0) {
    playersListBodyEl.innerHTML = `
      <tr>
        <td colspan="3" class="table-empty">暂无玩家在线</td>
      </tr>
    `;
    return;
  }
  
  players.forEach(p => {
    const tr = document.createElement('tr');
    
    const tdName = document.createElement('td');
    tdName.textContent = p.name;
    
    const tdScore = document.createElement('td');
    tdScore.textContent = p.score;
    
    const tdPing = document.createElement('td');
    const pingVal = parseInt(p.ping) || 0;
    let pingClass = 'ping-low';
    if (pingVal >= 150) pingClass = 'ping-high';
    else if (pingVal >= 50) pingClass = 'ping-medium';
    
    tdPing.innerHTML = `<span class="${pingClass}">● ${pingVal}ms</span>`;
    
    tr.appendChild(tdName);
    tr.appendChild(tdScore);
    tr.appendChild(tdPing);
    
    playersListBodyEl.appendChild(tr);
  });
}

// Update status bar text
function updateStatus(text, isError = false) {
  statusTextEl.textContent = text;
  if (isError) {
    statusTextEl.style.color = 'var(--danger)';
  } else {
    statusTextEl.style.color = 'var(--text-secondary)';
  }
}
