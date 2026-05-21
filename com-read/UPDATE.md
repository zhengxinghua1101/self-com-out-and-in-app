# 热更新配置说明

## 配置更新服务器

1. 在 `package.json` 中修改 `publish.url` 为你的更新服务器地址
2. 构建应用: `npm run build`
3. 将构建产物（dist 目录下的文件）上传到你的服务器
4. 确保服务器可以通过 HTTP 访问这些文件

## 自动更新流程

1. 应用启动时自动检查更新
2. 发现新版本时自动下载
3. 下载完成后显示更新按钮
4. 用户点击后自动安装并重启

## 本地测试

可以使用 `http-server` 搭建本地测试服务器:
```bash
npm install -g http-server
cd dist
http-server -p 8080
```

然后将 package.json 中的 publish.url 改为 `http://localhost:8080`
