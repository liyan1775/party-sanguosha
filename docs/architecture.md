# 架构与决策

## 部署与职责

```mermaid
flowchart LR
  PC[电脑服务页 /server\n主页二维码与服务概况] --> Gateway[电脑上的 Node 服务\nHTTP、静态资源、大厅 SSE]
  Home[手机主页 /\n玩家创建房间] --> Gateway
  Owner[玩家房主 /join/房号\n参赛、设置、AI、开局] --> Gateway
  Members[普通成员 /join/房号\n参赛、分享房间二维码] --> Gateway
  Gateway --> Lobby[大厅与独立房间\n公开状态和权限]
  Lobby --> Adapter[无名杀适配器\n真人/AI 席位契约]
  Adapter -. 待接入 .-> Worker[电脑规则执行宿主\n不占玩家席位]
  Members -. 待接入 .-> Relay[同源无名杀对局通道]
  Relay -. 待接入 .-> Worker
```

实线是当前大厅，虚线是待验证的真实对局。电脑页面不承担产品房主职责。手机房主是普通参赛席位加房间管理权限，不自动等同于引擎规则宿主。

## ADR-001：局域网电脑服务与规则宿主

状态：产品方向已确认，对局执行方式待验证。

电脑提供局域网服务、展示主页二维码，整局保持页面开启。无名杀候选联机包主要转发客户端消息，不能视为 Node 中的完整规则服务器。首选验证电脑浏览器承载规则、Node 提供静态资源与同源联机转发。

无名杀原生 host/`game.me` 可能占据席位，必须适配电脑规则执行宿主不参赛，不能变成“电脑加 7 部手机”。玩家房主的公共管理权限由本项目的房间会话决定，不交给电脑 host 身份决定。多房间大厅不等于已经支持多个并发真实对局，未来适配器必须为每个房间隔离规则状态与资源。

## ADR-002：大厅与引擎分离

状态：大厅与契约已实现，引擎尚未接入。

`LobbyStore` 管理房间索引、会话所在房间和公开摘要；`RoomStore` 管理单间公开席位、设置、准备、玩家房主、AI 席位与状态。房间由玩家创建，不在服务启动时预创建。

`EngineAdapter.start` 接收 `roomCode`、`ownerPlayerId`、配置、带 `human/bot` 类型的席位和固定 `aiPolicy: strongest-native`。此契约表达接入要求，不会执行原生 AI。启动必须得到真实引擎确认，状态才从 `waiting → starting → playing` 转换；失败回到 `waiting`。

当前 `NonameAdapter.status().ready` 始终为 `false`，添加 AI 也不能解锁开局。不得用 mock、随机操作或广播成功替代真实无名杀完成选将与开局的确认。

## ADR-003：协议、页面和模块

状态：已实现。

Node.js 24、TypeScript、原生 HTTP/DOM、esbuild、本机生成二维码。大厅用 HTTP 修改状态、SSE 广播公共快照；无名杀动作和私有状态将使用独立适配通道。

| 路径                          | 模块职责                                         |
| ----------------------------- | ------------------------------------------------ |
| `apps/server/src/main.ts`     | 环境配置、监听、运行会话信息                     |
| `apps/server/src/server.ts`   | HTTP/SSE、cookie、二维码、静态文件、本机停止协议 |
| `apps/server/src/lobby.ts`    | 多房间索引、创建、加入、成员所在房间、摘要       |
| `apps/server/src/room.ts`     | 单间房主、真人/AI 席位、准备、模式、启动状态机   |
| `apps/web/src/main.ts`        | 页面路由与初始请求                               |
| `apps/web/src/lobby-page.ts`  | 电脑服务页和玩家主页                             |
| `apps/web/src/room-page.ts`   | 手机房间、根据玩家身份显示控制                   |
| `apps/web/src/ui.ts`、`qr.ts` | 公共请求、反馈、SSE、二维码组件                  |
| `packages/shared`             | 跨端类型、公开协议和枚举                         |
| `packages/noname-adapter`     | 真实引擎和原生 AI 的接入边界                     |

页面依据 `session.playerId === room.ownerId` 判断房主。HTTP 响应晚于 SSE 时用单间 `revision` 防止旧状态回退；创建/加入后先更新本地会话，再连接 SSE。

## ADR-004：会话与房间权限

状态：大厅已实现；替代 v0.1.0 的电脑房主能力链接方案。

真人席位使用随机 HttpOnly、SameSite cookie 和独立公开 ID。服务端在单间房间内验证 token 对应的真人 ID 是否等于 `ownerId`，设置、移人、添加 AI、开局都必须通过此检查。公开二维码与快照不包含 token。一个浏览器会话同一时间只占一个房间。

所有已入座真人都能请求本房间二维码。电脑主页二维码只含 `/`，成员二维码只含 `/join/房号`；生成服务只接受本机实际宣告的地址。旧 `/host` 路径跳转 `/server`，旧 fragment 不兑换权限。

SSE 连接数支持同一玩家多个标签，最后一个连接断开标记离线并撤销准备，保留席位和房主。房主显式离开，按入座顺序将权限交给下一位真人；最后真人离开使房间 `closed`，清空 AI 并从大厅移除。移除席位后，旧 SSE 清理不会改变已移交的房间状态。

当前不承诺微信与系统浏览器之间无缝切换会话。真实对局的断线恢复、私有状态分发、动作与 AI 身份绑定仍需单独验证。

## ADR-005：AI 补位与准备

状态：席位管理已实现，原生 AI 运行待接入。

总席位包含真人和 AI。AI 没有玩家 cookie 或人工准备权限，不做房主。AI 自动准备，房主可逐个添加、一键补满、按席位移除；缩小配置只裁掉多余 AI，真人超额时拒绝修改。

模式、武将或成员构成发生变化都会撤销真人准备。开始后锁定增加 AI、移人、离开、配置和重复开始。原生 AI 固定使用最强可用完整决策，不提供难度选择。`difficulty` 在候选源码中是态度配置，不能简单设成 `hard` 后声称提高了智力；见 `engine-investigation.md` 与 `config/ai-policy.json`。

## ADR-006：Windows 双击启动与本机管理

状态：源码版启动器已实现，便携发行包未制作。

根目录 `.cmd` 调用 `scripts/launch.ps1` 寻找本机或 `.local/runtime/node.exe` 的 Node，再执行 `scripts/launcher.mjs`。无需用户输入命令；首次缺依赖时安装锁定依赖，构建页面后隐藏启动后台 Node 并打开 `/server`。启动器使用 `.runtime/launcher.lock` 防止重复启动竞争；失效锁根据进程是否存在清理。

实例通过 `.runtime/session.json` 的应用 ID、版本、随机 `instanceId` 和本机健康接口验证，重复启动复用实例。先检查本机回环端口，再监听；Windows 可允许不同地址的绑定交叠，仅依赖 `listen` 失败会误开其他程序页面。双击启动遇到端口冲突时最多尝试后续 20 个端口；显式 `PUBLIC_URL` 时不自动改端口。前台 `npm start` 保持显式端口语义。启动等待失败时只清理本次刚创建的后台进程。

停止由本机脚本读取当前实例凭据，向回环 `/api/shutdown` 发请求。服务同时校验回环来源与随机控制凭据，然后结束 SSE 和 HTTP。该凭据只存在本机运行文件，不是房主权限，不通过二维码、主页、API 或日志公开。不按端口、进程名或所有 Node 进程批量终止。

## ADR-007：上游、扩展和数据生命周期

状态：边界已建立，真实执行待完成。

上游下载放 `.local`，固定 tag、commit、校验值；本项目源码、适配补丁和扩展源代码与上游隔离。第三方保留来源与许可证，不自动升级。`config/noname-candidate.json` 是研究候选；模式、AI 与武将配置也是产品要求，尚未在引擎中生效。

扩展目录当前为空；联机、武将范围与运行兼容验证通过才开放。真实对局不能热替换扩展或规则。未来每个扩展保留 manifest、版本、来源、资源和模式兼容说明。

大厅与席位存内存，重启清空。`.runtime/session.json` 是本机进程信息，不是游戏存档；旧房间邀请重启后失效。`.local`、`.runtime`、`dist` 均忽略，不提交运行凭据、第三方大资源、依赖和截图。
