# Repository Guidelines

## 项目结构与模块组织

本项目是使用原生模块的 Node.js 咪咕直播与回放服务。`app.js` 处理 HTTP 路由，`config.js` 读取环境变量；`utils/` 包含频道获取、播放地址解析、加密、缓存和文件更新逻辑。

根目录的 `interface.txt`、`interfaceTXT.txt` 和 `playback.xml` 保存播放列表与节目指南；没有独立资源或测试目录。`Dockerfile` 定义镜像，`.github/workflows/` 管理数据同步和发布，`.workflow/` 保存 Gitee 流水线。

## 构建、测试与开发命令

使用 Node.js 18 及以上版本，推荐与容器一致的 Node.js 22。无外部依赖或 npm 脚本。在根目录执行：

- `node app.js`：启动服务，默认端口为 `1234`。
- `mport=3000 mhost=http://localhost:3000 node app.js`：设置端口和访问地址。
- `node fetchURLByAndroid720p.js`：联网获取频道并重新生成列表与节目指南。
- `docker build -t migu_video .`：构建镜像。
- `docker run --rm -p 1234:1234 migu_video`：运行容器。

启动会更新根目录数据；需保留数据时，在副本中运行。

## 编码风格与命名约定

使用两个空格缩进、`import`／`export`，相对导入带 `.js` 扩展名。函数、变量和新增工具文件采用小驼峰命名，如 `channelCache`。引号与分号遵循所在文件，避免格式化无关代码。说明与注释使用中文。没有配置 ESLint 或 Prettier。

## 测试指南

目前没有测试框架或覆盖率要求。对修改文件执行 `node --check 文件路径`。启动后，用 `curl -i http://localhost:1234/m3u` 检查列表，用 `curl -I http://localhost:1234/频道ID` 检查 HEAD 重定向，频道ID替换为实际值。

播放逻辑变更应验证匿名高清、可选登录、回放参数及缓存，记录网络与账号条件。新增测试优先使用原生 `node:test`，放在 `tests/`，命名为 `*.test.js`，通过 `node --import ./tests/setup.mjs --test tests/*.test.js` 运行。`tests/setup.mjs` 会固定限流阈值、关闭请求间隔并清空用户本地配置，避免 `mRateLimitThreshold`、`mignoreCategory` 等环境变量导致测试误报。

## 提交与合并请求指南

人工提交采用 `fix: 简短描述`。提交主题应简洁、范围明确；`Update by GitHub Actions` 用于自动数据同步。

合并请求说明问题、行为变化和验证步骤，关联相关问题；数据变更提供输出示例，排除无关的定时更新结果。

## 配置与凭据

通过环境变量设置 `muserId`、`mtoken`、`mpass`，含义见 `README.md`。保留匿名运行能力；不要提交真实凭据，日志和播放地址示例须脱敏。
