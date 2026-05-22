const { ipcRenderer } = require('electron');

const initBtn = document.getElementById('initBtn');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const timerEl = document.getElementById('timer');
const startTimeEl = document.getElementById('startTime');
const dataDisplay = document.getElementById('dataDisplay');
const loadingOverlay = document.getElementById('loadingOverlay');
const portSelect1 = document.getElementById('portSelect1');

// 帮助按钮元素
const helpBtn = document.getElementById('helpBtn');

// 设置弹窗元素
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const baudSelectModal = document.getElementById('baudSelectModal');
const portSelect1Modal = document.getElementById('portSelect1Modal');
const portSelect2Modal = document.getElementById('portSelect2Modal');
const portSelect3Modal = document.getElementById('portSelect3Modal');
const portSelect4Modal = document.getElementById('portSelect4Modal');

// 帮助弹窗元素
const helpModal = document.getElementById('helpModal');
const closeHelpBtn = document.getElementById('closeHelpBtn');
const knowBtn = document.getElementById('knowBtn');

let isPortOpen = false;
let isRunning = false;
let availablePorts = []; // 缓存可用串口列表
let currentBaudRate = 115200; // 当前波特率

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateButtons() {
  connectBtn.textContent = isPortOpen ? '断开' : '连接';
  connectBtn.className = isPortOpen ? 'connect-btn connect-btn-danger' : 'connect-btn connect-btn-primary';
  startBtn.disabled = !isPortOpen || isRunning;
  stopBtn.disabled = !isRunning;
  refreshBtn.disabled = !isPortOpen;
  timerEl.className = isRunning ? 'time-value running' : 'time-value';
}

// 缓存所有已选串口（用于刷新后恢复）
let selectedPortsCache = {};

// 填充所有串口选择框（主界面和弹窗）
function fillAllPortSelects() {
  const selects = [portSelect1, portSelect1Modal, portSelect2Modal, portSelect3Modal, portSelect4Modal];
  // 先保存当前选择
  selects.forEach((select, idx) => {
    if (select && select.value) {
      selectedPortsCache[idx] = select.value;
    }
  });
  // 然后重新填充
  selects.forEach((select, idx) => {
    if (!select) return;
    select.innerHTML = '<option value="">请选择...</option>';
    availablePorts.forEach(port => {
      const option = document.createElement('option');
      option.value = port.path;
      option.textContent = port.path;
      select.appendChild(option);
    });
    // 恢复之前的选择
    if (selectedPortsCache[idx]) {
      select.value = selectedPortsCache[idx];
    }
  });
}

async function refreshPorts() {
  availablePorts = await ipcRenderer.invoke('get-serial-ports');
  fillAllPortSelects();
}

// 获取所有选择的串口（从弹窗的4个串口）
function getSelectedPorts() {
  const ports = [];
  const selects = [portSelect1Modal, portSelect2Modal, portSelect3Modal, portSelect4Modal];
  selects.forEach((select, index) => {
    if (select && select.value) {
      ports.push({ path: select.value, index });
    }
  });
  return ports;
}

// 重置：停止发送，关闭串口，刷新端口
initBtn.addEventListener('click', async () => {
  loadingOverlay.classList.add('show');

  await ipcRenderer.invoke('stop-sending');
  await ipcRenderer.invoke('close-serial');
  await refreshPorts();
  isPortOpen = false;
  isRunning = false;
  timerEl.textContent = '00:00:00';
  startTimeEl.textContent = '--:--:--';
  updateButtons();

  // 至少显示 1 秒 loading
  setTimeout(() => {
    loadingOverlay.classList.remove('show');
  }, 1000);
});

// 连接/断开 串口（支持多串口）
connectBtn.addEventListener('click', async () => {
  if (isPortOpen) {
    await ipcRenderer.invoke('stop-sending');
    await ipcRenderer.invoke('close-serial');
    isPortOpen = false;
    isRunning = false;
    timerEl.textContent = '00:00:00';
    startTimeEl.textContent = '--:--:--';
  } else {
    let selectedPorts = getSelectedPorts();
    // 如果弹窗没选，用主界面的
    if (selectedPorts.length === 0) {
      if (portSelect1.value) {
        selectedPorts = [{ path: portSelect1.value, index: 0 }];
      } else {
        alert('请先选择串口（可在设置中选择多个串口）');
        return;
      }
    }

    let allSuccess = true;
    for (let i = 0; i < selectedPorts.length; i++) {
      const result = await ipcRenderer.invoke('open-serial', selectedPorts[i].path, currentBaudRate, selectedPorts[i].index);
      if (!result.success) {
        alert(`串口${i + 1}打开失败: ${result.message}`);
        allSuccess = false;
        break;
      }
    }
    if (allSuccess) {
      isPortOpen = true;
    }
  }
  updateButtons();
});

// 开始发送
startBtn.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('start-sending');
  if (result.success) {
    isRunning = true;
  } else {
    alert('启动失败: ' + result.message);
  }
  updateButtons();
});

// 结束发送
stopBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('stop-sending');
  isRunning = false;
  timerEl.textContent = '00:00:00';
  startTimeEl.textContent = '--:--:--';
  updateButtons();
});

// 刷新：重新读取文件，时间归零，重新开始
refreshBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('refresh-data');
  timerEl.textContent = '00:00:00';
  if (!isRunning) {
    const result = await ipcRenderer.invoke('start-sending');
    if (result.success) isRunning = true;
  }
  updateButtons();
});

// 开始时间更新
ipcRenderer.on('start-time', (event, timestamp) => {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  startTimeEl.textContent = `${h}:${m}:${s}`;
});

// 计时更新
ipcRenderer.on('timer-update', (event, seconds) => {
  timerEl.textContent = formatTime(seconds);
});

// 复制按钮
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(dataDisplay.textContent);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '已复制';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 500);
  } catch (e) {
    alert('复制失败');
  }
});

// 更新按钮显示状态
function updateDataButtons() {
  if (dataDisplay.textContent.trim() === '') {
    copyBtn.classList.add('btn-hidden');
    clearBtn.classList.add('btn-hidden');
  } else {
    copyBtn.classList.remove('btn-hidden');
    clearBtn.classList.remove('btn-hidden');
  }
}

// 清空按钮
clearBtn.addEventListener('click', () => {
  dataDisplay.textContent = '';
  lineCount = 1;
  updateDataButtons();
});

const MAX_LINES = 10000;
let lineCount = 1;

function formatDateTime(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

// 发送数据更新
ipcRenderer.on('data-update', (event, hexString, index, total) => {
  const time = formatDateTime(new Date());
  const line = `[${time}] 发送了数据，编号：${lineCount}\n`;
  dataDisplay.textContent += line;
  lineCount++;
  updateDataButtons();
  // 自动滚动到底部
  dataDisplay.scrollTop = dataDisplay.scrollHeight;
});

// ========== 设置弹窗逻辑 ==========

settingsBtn.addEventListener('click', () => {
  baudSelectModal.value = currentBaudRate.toString();
  // 打开弹窗时先刷新串口列表
  refreshPorts().then(() => {
    // 然后同步主界面选择的串口
    portSelect1Modal.value = portSelect1.value;
  });
  settingsModal.classList.add('show');
});

function closeSettings() {
  settingsModal.classList.remove('show');
}

closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    closeSettings();
  }
});

saveSettingsBtn.addEventListener('click', () => {
  currentBaudRate = parseInt(baudSelectModal.value, 10);
  // 同步主界面串口选择（用第一个非空的）
  const selects = [portSelect1Modal, portSelect2Modal, portSelect3Modal, portSelect4Modal];
  for (const select of selects) {
    if (select && select.value) {
      portSelect1.value = select.value;
      break;
    }
  }
  closeSettings();
});

// ========== 帮助弹窗逻辑 ==========

helpBtn.addEventListener('click', () => {
  helpModal.classList.add('show');
});

function closeHelp() {
  helpModal.classList.remove('show');
}

closeHelpBtn.addEventListener('click', closeHelp);
knowBtn.addEventListener('click', closeHelp);

helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) {
    closeHelp();
  }
});

// 初始化应用
refreshPorts();
updateButtons();
updateDataButtons();
