# 聚会三国杀

为线下聚会准备的三国杀网页项目：电脑提供局域网服务，朋友连接同一个 Wi-Fi，用微信扫码进入主页；玩家自己建房，在手机上充当房主并参加对局。

**当前 v0.3.0 已接入无名杀真实对局。** 支持经典身份局、斗地主、2v2、单武将单挑，两档武将和原生 AI；电脑不占席位，真人在手机选将和操作。已通过桌面浏览器模拟手机的完整对局验证；Android 微信此前验证到扫码建房，真实手机游戏仍需验收。

## 聚会时如何启动

在这台 Windows 电脑上，双击根目录的 **「启动聚会三国杀.cmd」**。启动器会准备页面、启动后台服务，自动打开电脑二维码页。不需要输入命令；重复双击会打开同一个运行实例。

1. 朋友连接电脑所在的 Wi-Fi 或电脑热点，扫描电脑上的**主页二维码**。
2. 一位玩家填写昵称，点击「创建房间并入座」。这位玩家成为房主，也是参赛者。
3. 房主在手机上选择模式、总席位、武将档和扩展。人数不足时可逐个添加 AI，或一键补满空位。
4. 每位已入座玩家都能点击「展示房间二维码」；朋友扫描后直接进入本房间，填写昵称入座。
5. 真人准备后由玩家房主开局，在手机选将和操作，建议横屏。电脑整局保持运行、页面开启并避免休眠。

聚会结束时，双击 **「停止聚会三国杀.cmd」**。关闭浏览器标签本身不会停止后台服务。停止会清空当前大厅，重启后需要重新创建房间。

源码版需要 **Node.js 24.x**，启动器会准备依赖、固定版本引擎与资源，首次需要联网。Windows x64 离线发行包包含 Node、引擎、两档武将图片及许可证，解压后双击即可启动，无需安装依赖。当前音频关闭，对局期间不访问外网。

服务信息、启动日志位于 `.runtime/`。启动默认使用 3000 端口；如果被其他程序占用，双击启动会尝试后续端口，不终止其他程序。以自动打开的服务页或 `.runtime/session.json` 中的 `serverUrl` 为准；本工作区 `.env` 当前使用 3001。

## 已有功能

- 电脑服务页 `/server`：主页二维码、网卡地址选择、刷新地址、公开房间概况；没有房主权限。
- 玩家主页 `/`：昵称建房、房间列表、返回本人房间；可创建相互独立的大厅。
- 手机房间 `/join/房号`：入座、准备、取消准备、离开、任意成员展示本房间邀请二维码。
- 玩家房主：模式、武将档、移人、AI 逐个添加/补满/移除与开局权限。
- 身份局 5–8 席、三国杀斗地主 3 席、2v2 4 席、单武将单挑 2 席；**总席位包含真人和 AI**。
- AI 自动准备，执行完整原生决策，不提供智力选项。
- 手机自动进入原生选将和对局界面，自己的手牌可见、对手暗手牌值经过过滤；未公开身份按接收玩家过滤。
- 同一浏览器刷新恢复原座位；结算后房主点击「回到房间，准备下一局」，真人重新准备。
- 刷新保留席位与房主身份；房主主动离开交接给下一位真人，最后真人离开关闭房间。
- 玩法或席位变化后真人重新准备；缩小房间只自动移除多余 AI，真人超额会拒绝修改。

房间和席位保存在内存中，重启即清空。主页二维码地址在同一网卡与端口下可继续使用，旧房间邀请会失效。cookie 属于同一个浏览器；从微信切换到系统浏览器目前会建立另一会话，需要原浏览器离开或请房主移除旧席位。

## 连接与配置

多个网卡时，在电脑服务页选择与手机同一个 Wi-Fi 的地址。电脑可用 `127.0.0.1` 查看服务页，手机必须使用二维码里的局域网地址。

如需指定端口或地址，将 `.env.example` 复制为 `.env` 后修改：

```dotenv
PORT=3000
BIND_HOST=0.0.0.0
# 可选；省略时自动枚举私有 IPv4 网卡。
# PUBLIC_URL=http://192.168.1.100:3000
```

显式设置 `PUBLIC_URL` 时必须与真实网卡、端口一致，启动器不会自动改用其他端口。手机无法连接时，检查同一 Wi-Fi、二维码地址、Windows 防火墙的专用网络访问权限、路由器客户端隔离。微信打不开可复制链接到系统浏览器排查。用户已于 2026-10-04 在 Android 微信中实测扫码进入主页和玩家开房，其他真机流程仍待验收。

## 开发与检查

```powershell
npm ci
npm start
npm run check
```

`npm start` 构建并以前台方式启动，终端显示电脑服务页和玩家主页地址，`Ctrl+C` 停止。开发者可用 `npm run dev` 监视服务端变化；网页源文件变化后执行 `npm run build` 再刷新。重启服务会清空大厅。

离线包也包含源码、测试与检查配置。接续开发时安装完整 Node.js 24、运行 `npm ci` 后使用 `npm start`；发行包双击入口直接运行 `dist`，不会自动编译修改过的源码。需要改用源码启动器时移走 `portable.json`。

`check` 包括类型、领域/HTTP 测试、构建与格式检查。修改大厅流程或页面后运行浏览器测试：

```powershell
# 使用本机 Microsoft Edge，无需下载测试浏览器。
$env:E2E_BROWSER_CHANNEL = 'msedge'
npm run test:browser
```

其他环境可安装 Playwright Chromium 后执行相同测试。浏览器测试覆盖电脑服务页、四个独立手机会话、成员邀请、AI 补位、权限与房主交接。截图位于 `.runtime/previews/`，其中二维码为测试地址；实际扫码请使用当前电脑服务页。

无界面的 Windows 启停验证可用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/launch.ps1 -Action Start -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/launch.ps1 -Action Stop
```

## 文件导航

| 路径                                                         | 用途                                    |
| ------------------------------------------------------------ | --------------------------------------- |
| [AGENTS.md](AGENTS.md)                                       | 开发接续与文件管理约定                  |
| [docs/product.md](docs/product.md)                           | 已确认的使用流程、玩法、武将与 AI 要求  |
| [docs/architecture.md](docs/architecture.md)                 | 模块边界、权限、API 和技术决策          |
| [docs/engine-investigation.md](docs/engine-investigation.md) | 无名杀候选、源码依据与待验证项          |
| [docs/roadmap.md](docs/roadmap.md)                           | 分阶段交付与验收                        |
| [docs/handoff.md](docs/handoff.md)                           | 当前状态、验证结果、下一项工作          |
| `apps/server/src`                                            | 大厅、各房间、会话、局域网 HTTP/SSE     |
| `apps/web/src`                                               | 电脑页、主页、房间页、共享 UI 与二维码  |
| `packages/shared/src`                                        | 跨端协议、模式和武将档                  |
| `packages/noname-adapter/src`                                | 对局生命周期、认证 WebSocket 与资源分发 |
| `packages/noname-adapter/runtime`                            | 原生启动、模式适配、私有信息、菜单边界  |
| `scripts`、根目录 `.cmd`                                     | 构建、Windows 启停及实例检查            |
| `config`                                                     | 引擎候选、模式要求、AI 要求、武将白名单 |
| [extensions/README.md](extensions/README.md)                 | 扩展开发入口                            |
| `tests`                                                      | 领域、HTTP、浏览器验证                  |

`.local` 存第三方下载和研究文件，`.runtime` 存临时会话、日志及截图，`dist` 存构建结果；均不提交 Git。不要编辑构建结果或把启动凭据当成房间数据。

## 无名杀来源

上游为 [libnoname/noname](https://github.com/libnoname/noname)，固定 v1.11.6 与 commit，核心包 SHA-256 在 `config/noname-candidate.json`。两档武将图片按固定 Git blob 校验；上游代码保存在 `.local`，正式适配集中在独立包内。标准包采用该版本的完整标准包（33 将），进阶档 156 将（128 界限突破、阴雷各 8 将、指定 12 神将）。

开发者执行 `npm run engine:prepare` 准备资源，`npm run engine:verify:rooms` 验证大厅中的四模式完整对局。详细参数、私有信息边界、打包方法见 [正式适配说明](packages/noname-adapter/runtime/README.md)。`npm run package:windows` 在 `.runtime/releases` 生成离线包和 SHA-256；不会包含 `.env`、运行凭据、个人房间或日志。

第三方来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
