# 无名杀局域网运行验证

这是与大厅分开的开发验证程序，运行真实单武将单挑，根目录启动器不会开放它。正式 v0.3.0 接入与验证见 [runtime](../runtime/README.md)；本实验服务不负责产品授权。

## 重复运行

在 Windows、Node.js 24、本机 Edge 和私有 IPv4 网卡环境下执行：

```powershell
npm ci
npm run engine:prepare
npm run engine:verify
```

准备脚本下载并校验固定 v1.11.6 核心包，缺少解压目录时通过 PowerShell 解压；补齐标准包验证使用的图片和许可证。已有且校验正确的文件复用，不自动升级引擎。非 Windows 环境需先自行解压核心包；验证浏览器可由 `E2E_BROWSER_CHANNEL` 改为已安装的 Playwright 通道。

需要代理时，准备命令读取 `HTTPS_PROXY` / `HTTP_PROXY`，例如本机已配置系统代理可在当前 PowerShell 会话中继承：

```powershell
$taskEngineProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]'https://raw.githubusercontent.com')
if ($taskEngineProxy.AbsoluteUri -ne 'https://raw.githubusercontent.com/') {
  $env:HTTPS_PROXY = $taskEngineProxy.AbsoluteUri
}
npm run engine:prepare
```

验证命令临时监听可访问的局域网地址，测试结束关闭自身服务，不重启大厅。多个网卡时可显式设置 `ENGINE_LAB_LAN_ADDRESS`。每个用例建立独立浏览器上下文，拒绝外部 HTTP 请求，确认 `isSecureContext === false`。结果与截图在 `.runtime/noname-lab/`。

手动开发可运行 `npm run engine:lab`，默认只监听 `127.0.0.1:3010`。规则页是 `/`，另开浏览器上下文访问 `/?role=human-1` 作为玩家；默认另一席为原生 AI。测试服务只有固定的测试身份，没有大厅 cookie 权限校验，不用于聚会。

## 文件职责

| 文件                                      | 职责                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `serve.mjs`                               | 仅提供固定引擎目录的静态文件、只读文件查询和验证配置                         |
| `index.html`、`bootstrap.js`              | 使用已编译 JS，跳过原入口的 TypeScript / Service Worker 检测                 |
| `relay.mjs`、`relay.js`                   | 同源 WebSocket 转发和原生 Client 的浏览器适配                                |
| `duel-mode.js`                            | 电脑不参赛、席位绑定、单将选将和单挑启动；牌、技能、回合、死亡由原生引擎执行 |
| `../../../scripts/prepare-noname-lab.mjs` | 核心 SHA-256 与资源 Git blob 校验、准备                                      |
| `../../../scripts/verify-noname-lab.mjs`  | 一玩家 + AI、两玩家的真实浏览器回归                                          |

资源清单沿用 `config/noname-lab-assets.json` 名称，当前扩大到 537 项，覆盖两档画像、牌面、占位图、背景和许可证；语音关闭。固定 commit 与 Git blob SHA-1，资源与正式适配共用。上游解压文件不改动。

## 已验证与接入限制

- 一玩家 + 原生 AI、两独立玩家页面均完成选将、原生出牌和阵亡结算；电脑不在生存或阵亡席位中，阵亡不换将。
- 自动化玩家先点击选将，再启用原生托管以覆盖整局。没有伪造手牌、伤害或胜负；不代表真人手动打完整局、Android/iPhone 微信游戏或重连已通过。
- 标准包验证所需资源无缺失、运行无外网请求；玩家结算通知已到达手机模拟页面。
- **上游序列化原本包含对手未公开手牌值。** 本程序现共享正式 privacy.js，断言暗手牌没有真实牌名、点数和花色；产品授权、重连、白名单仍须使用正式服务验证。
- 转发服务尚未验证大厅会话、动作权限、房间隔离或规则宿主凭据。上游控制消息也不能直接向产品玩家开放。
- 上游普通菜单尚未锁定；本程序只验证新手单挑，没有证明四模式、进阶档或扩展配置生效。
- 规则宿主的脱离席位视角需取消向手机广播它的玩家计时器，录像关闭；这些边界集中在 `duel-mode.js`，不修改上游。

正式适配已另行实现大厅授权、独立宿主、资源准备、重连、结算回房和第二局。本实验结果只作为基础回归，不能取代正式验证。

上游为 [libnoname/noname v1.11.6](https://github.com/libnoname/noname/releases/tag/v1.11.6)，GPL-3.0-only。模式适配文件按 GPL-3.0-only 标记；完整上游许可证保存在 `../licenses/noname-GPL-3.0.txt`，来源汇总见根目录 `THIRD_PARTY_NOTICES.md`。
