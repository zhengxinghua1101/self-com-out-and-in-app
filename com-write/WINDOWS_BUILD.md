# Windows 平台构建说明

## 前置要求

在Windows上构建此项目，需要安装以下工具：

### 1. 安装 Node.js
- 版本要求：Node.js 16.x 或更高版本
- 下载地址：https://nodejs.org/
- 安装时勾选 "Automatically install the necessary tools" 选项（会自动安装Python和Visual Studio Build Tools）

### 2. 安装 Windows Build Tools（如果Node.js安装时未勾选）
以管理员身份运行PowerShell，执行：
```powershell
npm install --global windows-build-tools
```

或者单独安装：
- Visual Studio Build Tools 2019/2022
- Python 3.7+ (serialport 编译需要)

### 3. 安装 Visual Studio 组件
在 Visual Studio Installer 中确保安装了以下工作负载：
- "使用 C++ 的桌面开发" (Desktop development with C++)

## 构建步骤

### 1. 安装依赖
```cmd
npm install
```

### 2. 开发模式运行
```cmd
npm run dev
```

### 3. 打包成Windows安装包
```cmd
npm run dist:win
```

构建完成后，安装包将生成在 `release` 目录中。

## Windows 平台注意事项

### 串口权限
- Windows上访问串口（COM端口）不需要特殊权限
- 确保串口未被其他程序占用
- 如果打开失败，尝试以管理员身份运行程序

### 串口名称
- Windows串口名称格式：COM1, COM2, COM3...
- 串口大于COM9时，需要使用完整路径：`\\.\COM10`
- 代码已自动处理串口名称格式

### 已知问题
1. **serialport 编译失败**
   - 确保已安装 Windows Build Tools
   - 确保 Python 版本在 3.7-3.11 之间
   - 尝试删除 node_modules 后重新安装

2. **electron-builder 打包失败**
   - 确保有足够的磁盘空间（至少2GB）
   - 临时关闭杀毒软件（可能干扰打包过程）
   - 尝试使用 `npm run pack` 先测试目录打包

3. **运行时缺少 DLL**
   - 安装 Microsoft Visual C++ Redistributable
   - 下载地址：https://aka.ms/vs/17/release/vc_redist.x64.exe

## 跨平台构建

### 在 macOS 上构建 Windows 版本
需要安装 Wine：
```bash
brew install wine
npm run dist:win
```

## 技术支持

如果遇到构建问题，请检查：
1. Node.js 版本：`node --version`
2. npm 版本：`npm --version`
3. Python 版本：`python --version`
4. 是否有 C++ 编译环境
