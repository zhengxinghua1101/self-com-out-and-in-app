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
let serialPorts = []; // 支持多个串口
let isRunning = false;
let sendInterval = null;
let timerInterval = null;
let dataPackets = [];
let startTime = null;
let isSending = false; // 标记是否正在发送数据

function createWindow() {
  let iconPath;
  if (process.platform === 'win32') {
    // Windows平台优先使用.ico文件，兼容开发和打包环境
    const icoPath = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'icon.ico');
    if (fs.existsSync(icoPath)) {
      iconPath = icoPath;
    } else {
      iconPath = path.join(__dirname, '../my_data/logo.png');
    }
  } else {
    iconPath = path.join(__dirname, '../my_data/logo.png');
  }

  mainWindow = new BrowserWindow({
    width: 720,
    height: 620,
    resizable: false,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// 设置应用图标
if (process.platform === 'darwin') {
  app.whenReady().then(() => {
    app.dock.setIcon(path.join(__dirname, '../my_data/logo.png'));
  });
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

    // Windows平台：确保返回的串口路径格式正确（支持COMx和com0com的CNCxx格式）
    if (process.platform === 'win32') {
      // 同时支持标准COM端口和com0com虚拟串口（CNCA0, CNCB0等）
      return ports.filter(p => p.path && p.path.match(/^(COM\d+|CNC[A-Z]\d+)$/i));
    }

    return ports;
  } catch (e) {
    console.error('获取串口列表失败:', e);
    return [];
  }
});

ipcMain.handle('open-serial', async (event, portPath, baudRate = 115200, index = 0) => {
  // 关闭指定索引的旧串口
  if (serialPorts[index] && serialPorts[index].isOpen) {
    try {
      await serialPorts[index].close();
    } catch (e) {}
  }
  return new Promise(resolve => {
    const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });

    // 监听串口错误事件（Windows下Operation aborted会触发这个事件）
    port.on('error', (err) => {
      console.error(`串口${index}错误:`, err.message);
      // 发生错误时停止发送，防止崩溃
      isRunning = false;
      if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
      }
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      if (mainWindow) {
        mainWindow.webContents.send('data-update', `串口错误: ${err.message}`, 0, 0);
      }
    });

    port.open(err => {
      if (err) {
        resolve({ success: false, message: err.message });
      } else {
        serialPorts[index] = port;
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('close-serial', async () => {
  // 关闭所有串口
  for (const port of serialPorts) {
    if (port && port.isOpen) {
      try {
        await port.close();
      } catch (e) {
        console.error('关闭串口失败:', e.message);
      }
    }
  }
  serialPorts = [];
  isRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  console.log('[关闭串口] 所有定时器已清理');
  return { success: true };
});

// ========== 数据文件操作【仅优化了内部的 512 字节分块打包逻辑】 ==========

function loadDataSync() {
  // 兼容Windows和macOS的路径处理
  const dataPath = path.join(app.getAppPath(), 'src', 'my_data', 'sn_5.txt');
  try {
    // 使用UTF-8编码，Windows兼容
    const content = fs.readFileSync(dataPath, { encoding: 'utf-8', flag: 'r' });
    // 处理Windows换行符(\r\n)和Unix换行符(\n)
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line);

    // 🌟【优化点一】：根据抓包数据，每行原始数据是 8 个字节（16个Hex字符）。
    // 512 字节恰好等于 64 行数据 (512 / 8 = 64)。我们按 64 行物理块分包。
    const LINES_PER_BLOCK = 64;
    dataPackets = [];
    
    for (let i = 0; i < lines.length; i += LINES_PER_BLOCK) {
      const groupLines = lines.slice(i, i + LINES_PER_BLOCK);
      
      // 将整组 64 行的十六进制字符串无缝拼接（去掉空格和换行），一次性转化为 Buffer 块
      const blockHexString = groupLines.join('');
      const groupBuffer = Buffer.from(blockHexString, 'hex');
      
      dataPackets.push(groupBuffer);
    }

    return lines.length;
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

// ========== 发送控制【重构发送逻辑，引入异步等待流控机制】 ==========

// 封装原生的 write，配合 drain 实现等待硬件缓冲区完全排空的阻塞 Promise（支持多串口）
async function writeAndDrainAll(packet) {
  const openPorts = serialPorts.filter(p => p && p.isOpen);
  if (openPorts.length === 0) throw new Error('无可用串口');

  const promises = openPorts.map(port => {
    return new Promise((resolve, reject) => {
      try {
        port.write(packet, (err) => {
          if (err) return reject(err);
          port.drain((drainErr) => {
            if (drainErr) return reject(drainErr);
            resolve();
          });
        });
      } catch (writeErr) {
        // Windows下串口断开时write会抛出同步异常 Operation aborted
        reject(writeErr);
      }
    });
  });

  await Promise.all(promises);
}

// 后台异步发送函数，不阻塞定时器
async function sendDataAsync() {
  if (!isRunning || isSending) return;
  isSending = true;

  const openPorts = serialPorts.filter(p => p && p.isOpen);
  if (openPorts.length === 0) {
    isSending = false;
    return;
  }

  try {
    // 发送所有数据包
    for (let i = 0; i < dataPackets.length; i++) {
      if (!isRunning) break;
      await writeAndDrainAll(dataPackets[i]);
      // 单片机处理间隔
      await new Promise(resolve => setTimeout(resolve, 15));
    }

    // 通知前端
    if (isRunning && mainWindow) {
      const firstPacketHex = dataPackets[0]?.toString('hex').toUpperCase() || '';
      mainWindow.webContents.send('data-update', firstPacketHex, 0, dataPackets.length);
    }
  } catch (err) {
    console.error('串口发送失败:', err.message);
    // 发生写入错误时停止发送，防止循环崩溃
    isRunning = false;
    if (sendInterval) {
      clearInterval(sendInterval);
      sendInterval = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('data-update', `错误: ${err.message}`, 0, 0);
    }
  }

  isSending = false;
}

// 立即执行一次发送
function sendLoop() {
  sendDataAsync(); // 异步后台执行，不阻塞
}

ipcMain.handle('start-sending', async () => {
  const openPorts = serialPorts.filter(p => p && p.isOpen);
  if (openPorts.length === 0) return { success: false, message: '串口未打开' };

  // 如果已经在运行，先清理旧定时器
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  loadDataSync();
  isRunning = true;
  isSending = false;
  startTime = Date.now();
  if (mainWindow) {
    mainWindow.webContents.send('start-time', startTime);
  }

  // 每秒更新运行时长
  timerInterval = setInterval(() => {
    if (isRunning && mainWindow) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      mainWindow.webContents.send('timer-update', elapsed);
    }
  }, 1000);

  // 精确5秒定时器，发送逻辑异步执行不影响间隔
  sendLoop(); // 立即发一次
  sendInterval = setInterval(sendLoop, 5000); // 之后每5秒准时触发

  console.log('[发送启动] 定时器已创建，间隔5秒');
  return { success: true };
});

ipcMain.handle('stop-sending', async () => {
  isRunning = false;
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  return { success: true };
});

ipcMain.handle('refresh-data', async () => {
  // 重新加载文件，时间归零，重新开始发
  loadDataSync();
  startTime = Date.now();

  if (isRunning) {
    // 先清掉旧定时器
    if (sendInterval) {
      clearInterval(sendInterval);
      sendInterval = null;
    }
    // 立即发一次，然后按5秒周期
    sendLoop();
    sendInterval = setInterval(sendLoop, 5000);
    console.log('[刷新] 定时器已重置，间隔5秒');
  }

  return { success: true };
});