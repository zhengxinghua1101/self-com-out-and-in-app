const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { spawn, exec } = require('child_process');

let mainWindow;
let serialPort = null;
let virtualPortProcess = null;
let readPortPath = null;
let writePortPath = null;

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  if (virtualPortProcess) {
    virtualPortProcess.kill();
  }
  if (!isMac) app.quit();
});

// Windows平台：检查com0com是否安装
function checkCom0ComInstalled() {
  return new Promise((resolve) => {
    // 方法1：检查文件是否存在（最可靠）
    const setupcPaths = [
      'C:\\Program Files (x86)\\com0com\\setupc.exe',
      'C:\\Program Files\\com0com\\setupc.exe'
    ];

    for (const p of setupcPaths) {
      if (fs.existsSync(p)) {
        resolve(true);
        return;
      }
    }

    // 方法2：检查注册表
    exec('reg query "HKLM\\SOFTWARE\\com0com" /v "InstallPath" 2>nul', (error, stdout) => {
      if (!error && stdout.trim()) {
        resolve(true);
        return;
      }

      // 方法3：检查设备管理器
      exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\com0com" 2>nul', (error2) => {
        resolve(!error2);
      });
    });
  });
}

// 重试获取串口列表（最多5次）
async function findCom0ComPorts(retries = 5) {
  for (let i = 0; i < retries; i++) {
    const ports = await SerialPort.list();
    const com0comPorts = ports.filter(p =>
      p.manufacturer && p.manufacturer.includes('com0com') ||
      p.path.toLowerCase().includes('cnca') ||
      p.path.toLowerCase().includes('cncb') ||
      p.friendlyName && p.friendlyName.includes('com0com')
    );

    if (com0comPorts.length >= 2) {
      com0comPorts.sort((a, b) => {
        const numA = parseInt(a.path.replace(/\D/g, ''));
        const numB = parseInt(b.path.replace(/\D/g, ''));
        return numA - numB;
      });
      return {
        readPort: com0comPorts[0].path,
        writePort: com0comPorts[1].path
      };
    }

    // 等待1秒后重试
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 重试失败，返回默认名称
  return { readPort: 'CNCA0', writePort: 'CNCB0' };
}

// Windows平台：使用com0com创建虚拟串口
function createWindowsVirtualPorts() {
  return new Promise((resolve, reject) => {
    const setupcPaths = [
      'C:\\Program Files (x86)\\com0com\\setupc.exe',
      'C:\\Program Files\\com0com\\setupc.exe'
    ];

    let setupcPath = null;
    for (const p of setupcPaths) {
      if (fs.existsSync(p)) {
        setupcPath = p;
        break;
      }
    }

    if (!setupcPath) {
      reject(new Error('未找到com0com，请先安装com0com虚拟串口驱动'));
      return;
    }

    // 先列出已有端口，不强制移除（避免驱动错误）
    exec(`"${setupcPath}" list`, (listError, listStdout, listStderr) => {
      // 检查是否已有端口存在
      const hasExistingPorts = listStdout && listStdout.includes('CNC');

      if (hasExistingPorts) {
        // 已有端口，直接使用
        setTimeout(() => {
          findCom0ComPorts().then(resolve).catch(reject);
        }, 1000);
        return;
      }

      // 没有现有端口，尝试创建
      exec(`"${setupcPath}" install - -`, (error, stdout, stderr) => {
        if (error) {
          // 创建失败，显示详细错误信息
          const errorMsg = stderr || error.message;

          // 如果是驱动安装问题，给用户友好提示
          if (errorMsg.includes('ERROR') || errorMsg.includes('inf')) {
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: '驱动警告',
              message: 'com0com驱动可能未正确安装',
              detail: '错误信息: ' + errorMsg + '\n\n建议：\n1. 请确保已安装带数字签名的com0com驱动\n2. 安装时需要管理员权限\n3. 建议从 GitHub 下载 com0com-modern 版本'
            });
          }

          // 即使失败也尝试查找端口（可能已经有了）
          findCom0ComPorts().then(resolve).catch(() => {
            // 最后手段：直接返回默认名称，让用户手动连接
            resolve({ readPort: 'CNCA0', writePort: 'CNCB0' });
          });
          return;
        }

        // 等待驱动加载完成后，查找端口（带重试机制）
        setTimeout(() => {
          findCom0ComPorts().then(resolve).catch(reject);
        }, 2000);
      });
    });
  });
}

// macOS平台：使用socat创建虚拟串口
function createMacVirtualPorts() {
  return new Promise((resolve, reject) => {
    const socat = spawn('socat', [
      '-d', '-d',
      'pty,raw,echo=0',
      'pty,raw,echo=0'
    ]);

    let ptyPaths = [];

    socat.stderr.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/PTY is (\S+)/);
      if (match) {
        ptyPaths.push(match[1]);
      }
    });

    socat.on('error', reject);

    socat.on('spawn', () => {
      virtualPortProcess = socat;

      setTimeout(() => {
        if (ptyPaths.length >= 2) {
          resolve({
            readPort: ptyPaths[0],
            writePort: ptyPaths[1],
            process: socat
          });
        } else {
          reject(new Error('无法创建虚拟串口，请确保已安装socat'));
        }
      }, 500);
    });

    socat.on('close', () => {
      virtualPortProcess = null;
    });
  });
}

// 创建并打开虚拟串口（一键完成）
ipcMain.handle('start-virtual-serial', async (event, baudRate) => {
  // 先关闭已有的
  if (serialPort && serialPort.isOpen) {
    await serialPort.close();
  }
  if (virtualPortProcess) {
    virtualPortProcess.kill();
  }

  try {
    let portInfo;

    if (isWindows) {
      // Windows平台：检查com0com
      const com0comInstalled = await checkCom0ComInstalled();
      if (!com0comInstalled) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '缺少依赖',
          message: 'Windows平台需要安装com0com虚拟串口驱动',
          detail: '请访问 https://sourceforge.net/projects/com0com/ 下载并安装com0com后重试'
        });
        return { success: false, message: '请先安装com0com虚拟串口驱动' };
      }
      portInfo = await createWindowsVirtualPorts();
    } else {
      // macOS/Linux平台：使用socat
      portInfo = await createMacVirtualPorts();
    }

    readPortPath = portInfo.readPort;
    writePortPath = portInfo.writePort;

    // 自动打开读取端口
    serialPort = new SerialPort({
      path: readPortPath,
      baudRate: parseInt(baudRate) || 9600,
      autoOpen: false
    });

    return new Promise((resolve) => {
      serialPort.open((error) => {
        if (error) {
          resolve({ success: false, message: error.message });
          return;
        }

        serialPort.on('data', (data) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const now = new Date();
          const timestamp = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

          // 转换为十六进制显示（大写，空格分隔）
          const hexStr = Array.from(data).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
          event.sender.send('data-received', `[${timestamp}] ${hexStr}`);
        });

        serialPort.on('error', (error) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            event.sender.send('serial-error', error.message);
          }
        });

        resolve({
          success: true,
          readPort: readPortPath,
          writePort: writePortPath,
          message: isWindows ? '虚拟串口已创建并打开 (CNCA0<->CNCB0)' : '虚拟串口已创建并打开'
        });
      });
    });
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// 停止虚拟串口
ipcMain.handle('stop-virtual-serial', async () => {
  if (serialPort && serialPort.isOpen) {
    await serialPort.close();
    serialPort = null;
  }
  if (virtualPortProcess) {
    virtualPortProcess.kill();
    virtualPortProcess = null;
  }
  readPortPath = null;
  writePortPath = null;
  return { success: true, message: '已停止' };
});
