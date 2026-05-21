const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { SerialPort } = require('serialport');
const path = require('path');
const fs = require('fs');

// 开发环境热重载
try {
  require('electron-reloader')(module, {
    debug: true,
    watchRenderer: true,
    watchMain: true
  });
} catch (_) {}

let mainWindow;
let serialPort = null;
let isRunning = false;
let sendInterval = null;
let dataPackets = [];
let currentPacketIndex = 0;
let startTime = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== 串口操作 ==========

ipcMain.handle('get-serial-ports', async () => {
  try {
    const ports = await SerialPort.list();

    // 在 macOS 上额外添加 ttys 虚拟串口（用于串口模拟器）
    if (process.platform === 'darwin') {
      const devDir = '/dev/';
      try {
        const files = fs.readdirSync(devDir);
        const ttysDevices = files
          .filter(f => f.startsWith('ttys'))
          .map(f => ({ path: devDir + f }));
        // 去重合并
        const existingPaths = new Set(ports.map(p => p.path));
        ttysDevices.forEach(t => {
          if (!existingPaths.has(t.path)) {
            ports.push({ path: t.path, vendorId: 'virtual', productId: 'virtual' });
          }
        });
      } catch (e) {
        // 忽略读取 /dev 目录的错误
      }
    }

    // Windows平台：确保返回的串口路径格式正确（COMx）
    if (process.platform === 'win32') {
      // Windows串口路径已由SerialPort.list()正确返回为COMx格式
      // 过滤掉无效的串口路径
      return ports.filter(p => p.path && p.path.match(/^COM\d+$/i));
    }

    return ports;
  } catch (e) {
    console.error('获取串口列表失败:', e);
    return [];
  }
});

ipcMain.handle('open-serial', async (event, portPath, baudRate = 115200) => {
  if (serialPort && serialPort.isOpen) {
    await serialPort.close();
  }
  return new Promise(resolve => {
    serialPort = new SerialPort({ path: portPath, baudRate, autoOpen: false });
    serialPort.open(err => {
      err ? resolve({ success: false, message: err.message }) : resolve({ success: true });
    });
  });
});

ipcMain.handle('close-serial', async () => {
  if (serialPort && serialPort.isOpen) {
    await serialPort.close();
  }
  serialPort = null;
  return { success: true };
});

// ========== 数据文件操作 ==========

function loadDataSync() {
  // 兼容Windows和macOS的路径处理
  const dataPath = path.join(app.getAppPath(), 'src', 'my_data', 'sn_5.txt');
  try {
    // 使用UTF-8编码，Windows兼容
    const content = fs.readFileSync(dataPath, { encoding: 'utf-8', flag: 'r' });
    // 处理Windows换行符(\r\n)和Unix换行符(\n)
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    dataPackets = lines.map(line => Buffer.from(line.trim(), 'hex'));
    return dataPackets.length;
  } catch (e) {
    console.error('加载数据文件失败:', e);
    throw e;
  }
}

ipcMain.handle('load-data', async () => {
  try {
    const count = loadDataSync();
    return { success: true, count };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// ========== 发送控制 ==========

function sendLoop() {
  if (!isRunning || !serialPort || !serialPort.isOpen) return;

  if (currentPacketIndex >= dataPackets.length) {
    currentPacketIndex = 0; // 循环发送
  }

  const packet = dataPackets[currentPacketIndex];
  serialPort.write(packet);

  // 发送数据内容到前端显示
  const hexString = packet.toString('hex').toUpperCase();
  mainWindow.webContents.send('data-update', hexString, currentPacketIndex, dataPackets.length);

  currentPacketIndex++;

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  mainWindow.webContents.send('timer-update', elapsed);

  sendInterval = setTimeout(sendLoop, 67); // 15Hz
}

ipcMain.handle('start-sending', async () => {
  if (!serialPort || !serialPort.isOpen) return { success: false, message: '串口未打开' };
  if (dataPackets.length === 0) loadDataSync();

  isRunning = true;
  currentPacketIndex = 0;
  startTime = Date.now();
  sendLoop();
  return { success: true };
});

ipcMain.handle('stop-sending', async () => {
  isRunning = false;
  if (sendInterval) {
    clearTimeout(sendInterval);
    sendInterval = null;
  }
  return { success: true };
});

ipcMain.handle('refresh-data', async () => {
  // 重新加载文件，归零，重新开始发
  loadDataSync();
  currentPacketIndex = 0;
  startTime = Date.now();

  if (isRunning && sendInterval) {
    clearTimeout(sendInterval);
    sendLoop();
  }

  return { success: true };
});
