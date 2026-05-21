# Windows 平台使用说明

## 前置要求

### 1. 安装 com0com 虚拟串口驱动

本工具在 Windows 平台上依赖 com0com 虚拟串口驱动来创建虚拟串口对。

#### 下载安装

1. 访问 com0com 官网：https://sourceforge.net/projects/com0com/
2. 下载最新版本的安装包（建议下载 `Setup_com0com_v3.0.0.0_W7_x64_signed.exe` 或更高版本）
3. 以管理员身份运行安装程序
4. 按照安装向导完成安装
5. **重启电脑**使驱动生效

#### 验证安装

安装完成后，可以通过以下方式验证：

1. 打开设备管理器
2. 查看"端口 (COM 和 LPT)"类别
3. 应该能看到 "com0com - serial port emulators"

或者在命令行中运行：
```
"C:\Program Files\com0com\setupc.exe" list
```

## 使用步骤

### 启动虚拟串口

1. 运行本应用程序
2. 选择波特率（默认 9600）
3. 点击"启动虚拟串口"按钮
4. 成功启动后会显示写入端口名称（如 `CNCB0` 或 `COM4`）

### 发送测试数据

使用任意串口调试工具（如串口助手、XCOM 等）：

1. 打开串口调试工具
2. 选择写入端口（如 `CNCB0`）
3. 设置相同的波特率
4. 发送数据
5. 数据会显示在本应用的接收面板中

## 常见问题

### Q: 提示"未找到com0com"

**解决方案：**
- 确认已安装 com0com 驱动
- 确认安装路径正确（默认 `C:\Program Files\com0com\` 或 `C:\Program Files (x86)\com0com\`）
- 重启电脑后重试

### Q: 启动成功但找不到端口

**解决方案：**
- 尝试手动在串口调试工具中输入 `CNCA0` 和 `CNCB0`
- 或者在设备管理器中查看实际分配的 COM 端口号
- 重启 com0com 服务或重启电脑

### Q: 串口调试工具无法连接 CNCB0

**解决方案：**
- 某些串口工具不识别 `CNCxx` 命名格式
- 可以使用 com0com 的 setupc 命令修改端口名称：
  ```
  "C:\Program Files\com0com\setupc.exe" change 0 PortName=COM3
  "C:\Program Files\com0com\setupc.exe" change 1 PortName=COM4
  ```

### Q: 安装 com0com 时提示驱动签名问题

**解决方案：**
- Windows 10/11 需要禁用驱动程序强制签名
- 或者下载已签名的 com0com 版本
- 参考：https://stackoverflow.com/questions/46080338/com0com-signed-driver-for-windows-10

## 替代方案

如果 com0com 无法使用，可以考虑以下替代方案：

### 1. VSPE (Virtual Serial Port Emulator)
- 下载地址：https://www.eterlogic.com/Products.VSPE.html
- 商业软件，但有免费版

### 2. HW VSP3
- 下载地址：https://www.hw-group.com/software/hw-vsp3-virtual-serial-port
- 免费版

### 3. 真实串口硬件
- 使用 USB 转串口适配器连接真实硬件
- 使用串口环回接头（短接 TX 和 RX）进行测试

## 开发和打包

### 在 Windows 上开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm start
```

### 打包 Windows 版本

```bash
# 在 Windows 上运行打包命令
npm run build
```

打包完成后，安装程序位于 `dist/` 目录下。

## 技术支持

如遇到问题，请检查：
1. com0com 是否已正确安装
2. 是否以管理员权限运行
3. 杀毒软件是否阻止了驱动程序
4. Windows 设备管理器中是否有感叹号设备
