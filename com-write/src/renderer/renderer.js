const { ipcRenderer } = require('electron');

const portSelect = document.getElementById('portSelect');
const baudSelect = document.getElementById('baudSelect');
const initBtn = document.getElementById('initBtn');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const timerEl = document.getElementById('timer');
const startTimeEl = document.getElementById('startTime');
const dataDisplay = document.getElementById('dataDisplay');
const loadingOverlay = document.getElementById('loadingOverlay');

let isPortOpen = false;
let isRunning = false;

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateButtons() {
  connectBtn.textContent = isPortOpen ? '断开' : '连接';
  connectBtn.className = isPortOpen ? 'btn btn-danger' : 'btn btn-primary';
  startBtn.disabled = !isPortOpen || isRunning;
  stopBtn.disabled = !isRunning;
  refreshBtn.disabled = !isPortOpen;
  timerEl.className = isRunning ? 'time-value running' : 'time-value';
}

async function refreshPorts() {
  const ports = await ipcRenderer.invoke('get-serial-ports');
  portSelect.innerHTML = '<option value="">请选择...</option>';
  ports.forEach(port => {
    const option = document.createElement('option');
    option.value = port.path;
    option.textContent = port.path;
    portSelect.appendChild(option);
  });
}

// 重置：停止发送，关闭串口，刷新端口
initBtn.addEventListener('click', async () => {
  loadingOverlay.classList.add('show');

  await ipcRenderer.invoke('stop-sending');
  await ipcRenderer.invoke('close-serial');
  await refreshPorts();
  isPortOpen = false;
  isRunning = false;
  portSelect.value = '';
  timerEl.textContent = '00:00:00';
  startTimeEl.textContent = '--:--:--';
  updateButtons();

  // 至少显示 1 秒 loading
  setTimeout(() => {
    loadingOverlay.classList.remove('show');
  }, 1000);
});

// 连接/断开 串口
connectBtn.addEventListener('click', async () => {
  if (isPortOpen) {
    await ipcRenderer.invoke('stop-sending');
    await ipcRenderer.invoke('close-serial');
    isPortOpen = false;
    isRunning = false;
    timerEl.textContent = '00:00:00';
    startTimeEl.textContent = '--:--:--';
  } else {
    if (!portSelect.value) {
      alert('请先选择串口');
      return;
    }
    const baudRate = parseInt(baudSelect.value, 10);
    const result = await ipcRenderer.invoke('open-serial', portSelect.value, baudRate);
    if (result.success) {
      isPortOpen = true;
    } else {
      alert('串口打开失败: ' + result.message);
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
    }, 1000);
  } catch (e) {
    alert('复制失败');
  }
});

const MAX_LINES = 10000;
let lineCount = 0;

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
  if(dataDisplay.textContent.includes("...")){
    dataDisplay.textContent = ""
  }
  dataDisplay.textContent += line;
  lineCount++;
  // 自动滚动到底部
  dataDisplay.scrollTop = dataDisplay.scrollHeight;
});

// 初始化应用
refreshPorts();
updateButtons();
