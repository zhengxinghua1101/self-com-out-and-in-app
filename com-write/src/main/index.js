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
let timerInterval = null;
let dataPackets = [];
let startTime = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
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
  isRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
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

// 封装原生的 write，配合 drain 实现等待硬件缓冲区完全排空的阻塞 Promise
function writeAndDrain(packet) {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) return reject(new Error('串口未打开'));
    
    serialPort.write(packet, (err) => {
      if (err) return reject(err);
      
      // 🌟 等待当前的 512 字节硬件数据完全在电平线上发射完毕，单片机安全接收后，才释放阻塞
      serialPort.drain((drainErr) => {
        if (drainErr) return reject(drainErr);
        resolve();
      });
    });
  });
}

async function sendLoop() {
  if (!isRunning || !serialPort || !serialPort.isOpen) return;

  const cycleStartTime = Date.now(); // 记录当前大包开始倾倒的时间点

  try {
    // 🌟【优化点二】：摒弃原本导致数据挤爆乱码的 forEach 盲发
    // 改用 async-for 串行异步循环，一包发完并排空，才发下一包
    for (let i = 0; i < dataPackets.length; i++) {
      if (!isRunning) break; // 允许随时在中途点击停止
      
      await writeAndDrain(dataPackets[i]);
      
      // 给单片机预留 15 毫秒的基础时间间隙去处理中断并写入 Flash，防止连续轰炸导致片上死机
      await new Promise(resolve => setTimeout(resolve, 15));
    }

    // 发送数据内容到前端显示（显示第一组作为示例）
    if (isRunning) {
      const firstPacketHex = dataPackets[0]?.toString('hex').toUpperCase() || '';
      mainWindow.webContents.send('data-update', firstPacketHex, 0, dataPackets.length);
    }

  } catch (err) {
    console.error('串口数据倾倒失败:', err);
    mainWindow.webContents.send('data-update', 'ERROR: 写入失败', 0, 0);
  }

  // 🌟【优化点三】：流控时间平滑补偿
  // 串口发送这么大批块需要物理时间。通过计算本轮排空实际用时，
  // 动态收缩下一个 setTimeout 的等待跨度，完美保持原工具严格的“大体 5 秒重新报一遍”频率。
  const processingTime = Date.now() - cycleStartTime;
  const nextDelay = Math.max(100, 5000 - processingTime);

  if (isRunning) {
    sendInterval = setTimeout(sendLoop, nextDelay);
  }
}

ipcMain.handle('start-sending', async () => {
  if (!serialPort || !serialPort.isOpen) return { success: false, message: '串口未打开' };
  loadDataSync();

  isRunning = true;
  startTime = Date.now();
  mainWindow.webContents.send('start-time', startTime);

  // 每秒更新运行时长
  timerInterval = setInterval(() => {
    if (isRunning) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      mainWindow.webContents.send('timer-update', elapsed);
    }
  }, 1000);

  sendLoop();
  return { success: true };
});

ipcMain.handle('stop-sending', async () => {
  isRunning = false;
  if (sendInterval) {
    clearTimeout(sendInterval);
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

  if (isRunning && sendInterval) {
    clearTimeout(sendInterval);
    sendInterval = null;
  }

  if (isRunning) {
    sendLoop();
  }

  return { success: true };
});