const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
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
  autoUpdater.checkForUpdatesAndNotify();

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

// 自动更新事件
autoUpdater.on('update-available', () => {
  if (mainWindow) mainWindow.webContents.send('update-available');
});

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('update-downloaded');
});

ipcMain.handle('restart-and-update', () => {
  autoUpdater.quitAndInstall();
});

// Windows平台：检查com0com是否安装
function checkCom0ComInstalled() {
  return new Promise((resolve) => {
    exec('"C:\\Program Files (x86)\\com0com\\setupc.exe" --version', (error) => {
      if (!error) {
        resolve(true);
      } else {
        exec('"C:\\Program Files\\com0com\\setupc.exe" --version', (error2) => {
          resolve(!error2);
        });
      }
    });
  });
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

    // 先移除所有现有端口
    exec(`"${setupcPath}" remove=0,1`, () => {
      // 创建新的虚拟串口对
      exec(`"${setupcPath}" install - -`, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        // 查找创建的端口名称
        setTimeout(() => {
          SerialPort.list().then((ports) => {
            // 查找com0com创建的虚拟串口
            const com0comPorts = ports.filter(p =>
              p.manufacturer && p.manufacturer.includes('com0com') ||
              p.path.toLowerCase().includes('cnca') ||
              p.path.toLowerCase().includes('cncb')
            );

            if (com0comPorts.length >= 2) {
              // 按端口号排序
              com0comPorts.sort((a, b) => {
                const numA = parseInt(a.path.replace(/\D/g, ''));
                const numB = parseInt(b.path.replace(/\D/g, ''));
                return numA - numB;
              });
              resolve({
                readPort: com0comPorts[0].path,
                writePort: com0comPorts[1].path
              });
            } else {
              // 如果找不到，尝试使用标准命名CNCA0和CNCB0
              resolve({
                readPort: 'CNCA0',
                writePort: 'CNCB0'
              });
            }
          }).catch(reject);
        }, 1000);
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
