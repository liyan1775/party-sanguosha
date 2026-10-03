# 聚会三国杀

为线下聚会准备的三国杀网页项目：电脑开服，朋友连接同一个 Wi-Fi，用微信扫码入座，手机充当自己的游戏终端。

**当前版本 v0.1.0 是可运行的扫码房间底座，还不能进行真实三国杀对局。** 无名杀正在验证接入，开始对局按钮保持关闭。

## 已有功能

- 电脑房主页面、局域网 IPv4 地址选择、离线生成玩家二维码、邀请链接。
- 玩家无需账号，用昵称入座、准备、取消准备、离开；刷新不会重复占座。
- 身份局 5–8 人、斗地主 3 人、2v2 4 人、单挑 2 人的房间设置。
- 新手档和进阶档的设置；切换模式或武将档会撤销所有玩家的准备。
- 房主权限检查、实时大厅更新、断线状态、移出玩家、满房限制。

上述模式和武将档目前用于大厅配置；实际规则由下一阶段的无名杀适配器落实。没有内置假对局。

## 启动

开发环境：Node.js 24.x 和 npm。首次安装依赖需要联网，安装完成后的扫码大厅运行不访问 CDN 或外部服务。

```powershell
npm ci
npm start
```

终端显示两类链接：

1. **电脑房主**：在电脑浏览器打开 `http://127.0.0.1:3000/host#…` 的完整链接。
2. **玩家入口**：形如 `http://192.168.1.100:3000/join/ABC123`，这个地址用于二维码。

房主页面选择电脑所在 Wi-Fi 的网卡地址。朋友连接同一 Wi-Fi 或热点后扫码。不能在手机上使用 `127.0.0.1`。房主能力链接仅用于电脑，二维码仅包含玩家链接。

当前启动链接也保存在 `.runtime/session.json`。服务重启会生成新房间和新邀请，旧链接失效；房间设置和玩家席位暂不落盘。

需要自定义端口或指定网卡时，将 `.env.example` 复制为 `.env` 后修改，再运行 `npm start`：

```dotenv
PORT=3000
BIND_HOST=0.0.0.0
PUBLIC_URL=http://192.168.1.100:3000
```

`PUBLIC_URL` 省略时自动枚举私有 IPv4 网卡。`BIND_HOST` 默认允许局域网访问。手机无法访问时，依次检查 Wi-Fi 是否相同、二维码地址是否正确、Windows 防火墙是否允许该 Node 进程的专用网络访问、路由器是否开启客户端隔离。微信内打不开时先复制到系统浏览器排查；真实微信兼容性尚待手机验收。

## 开发与检查

```powershell
npm run check
npm run dev
```

`check` 执行类型检查、领域与 HTTP 测试、页面构建、格式检查。`dev` 监视服务端依赖变化并重启服务，重启会清空房间；修改网页源文件后执行 `npm run build` 再刷新。

浏览器流程测试会启动一个临时端口，模拟电脑与四个独立手机会话：

```powershell
# 使用已安装的 Microsoft Edge，无需下载测试浏览器
$env:E2E_BROWSER_CHANNEL = 'msedge'
npm run test:browser
```

其他环境可执行 `npx playwright install chromium`，随后运行 `npm run test:browser`。预览截图保存于 `.runtime/previews/`，测试诊断文件被 Git 忽略。

## 文件导航

| 路径                                                         | 用途                                 |
| ------------------------------------------------------------ | ------------------------------------ |
| [AGENTS.md](AGENTS.md)                                       | 开发接续和文件管理约定               |
| [docs/product.md](docs/product.md)                           | 用户已确认需求、玩法、武将范围       |
| [docs/architecture.md](docs/architecture.md)                 | 模块边界、权限、引擎接入决策         |
| [docs/engine-investigation.md](docs/engine-investigation.md) | 无名杀版本、源码证据、接入问题       |
| [docs/roadmap.md](docs/roadmap.md)                           | 分阶段交付及验收标准                 |
| [docs/handoff.md](docs/handoff.md)                           | 当前状态、验证结果、下一项工作       |
| `apps/server/src`                                            | 房间服务和局域网入口                 |
| `apps/web/src`                                               | 房主与手机大厅页面                   |
| `packages/shared/src`                                        | 共享类型、模式和武将档               |
| `packages/noname-adapter/src`                                | 真实对局适配器边界，目前未接入       |
| `config`                                                     | 可追踪的引擎候选、玩法要求、武将名单 |
| [extensions/README.md](extensions/README.md)                 | 扩展开发入口                         |
| `tests`                                                      | 领域、HTTP 和浏览器验证              |

## 无名杀来源

上游为 [libnoname/noname](https://github.com/libnoname/noname)。已下载并校验 v1.11.6 核心包用于研究，候选版本和 SHA-256 见 `config/noname-candidate.json`。研究文件位于 `.local`，不进入 Git，也不在当前服务中公开提供。当前候选尚未通过运行验证。

来源和许可证记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
