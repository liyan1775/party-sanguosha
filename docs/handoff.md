# 开发交接

最后更新：2026-10-04；当前版本 v0.3.0，Windows LAN 真实对局预览。

## 当前状态

已从扫码大厅接到真实无名杀：四种玩法、两档武将、原生 AI、手机原生界面、同会话重连、结算回房和下一局。电脑只运行规则与显示主页码，不是玩家房主，不占任何座位。扩展目录仍为空；Android 微信此前已由用户验证扫码建房，完整真机游戏与 iPhone 还需覆盖。

本地 Git，未创建远程仓库或云服务。Node.js 24、TypeScript、HTTP/SSE/DOM、esbuild、qrcode、ws；对局资源全部同源。Windows 离线发行包已制作，包含 Node、固定引擎、两档图片、源码和许可证，音频关闭。

## 已确定的产品约束

- 手机玩家创建房间，成为参赛房主；所有真人成员可展示房间直达码。
- 一台电脑、同 Wi-Fi/热点、无需账号/好友/解锁/教学流程。电脑页面整局保持开启，避免休眠。
- 身份局 5–8 席，斗地主 3 席，2v2 4 席，单挑 2 席、每人一将、一局定胜负；总数包含 AI。
- 地主体力上限 +1，飞扬、跋扈，无额外地主强化。
- 新手为上游完整 standard（33 将）；进阶 refresh（128 将）+ 阴雷（16 将）+ 指定 12 神将，共 156 将。
- AI 直接使用完整原生事件决策，没有单独随机机器人或智力选项；difficulty 是态度，不能设 hard 就声称更聪明。
- 改配置/席位后真人重新准备；AI 自动准备。主动离开交接房主，临时断线保留身份，最后真人离开关房。

详情以 product.md 为准。不要恢复 v0.1.0 电脑房主能力链接方案。

## 文件与职责

- apps/server：大厅、单间权限、房间生命周期、HTTP/SSE、二维码、本机停止协议。
- apps/web：电脑页、玩家主页、手机房间；engine-supervisor.ts 管理电脑上的隔离规则 iframe，room-page.ts 保持 SSE 与游戏 iframe。
- packages/shared：公共协议、玩法、房间状态和 matchId，不放私有牌/身份/token。
- packages/noname-adapter/src/service.ts：正式 match 管理、会话认证 WebSocket、只读引擎资源。
- packages/noname-adapter/runtime：启动、四模式座位/规则差异、白名单、序列化过滤、入站物理牌引用保护、菜单边界。复用上游牌/技能/回合/AI/死亡/胜负。
- packages/noname-adapter/lab：独立基础研究与回归，未授权的实验转发端点不能用于产品。
- config：固定引擎 tag/commit/SHA、537 项资源 Git blob 校验、武将档、规则与 AI 的验证范围。
- scripts：构建、资源准备、真实对局验证、Windows 启停、离线打包。dist 只存构建结果。
- docs/runtime-validation.md：验证范围；runtime/README.md：适配细节、命令与参数。

上游 v1.11.6 / commit 2367607e246d21aae168dba15c01151ee0651f30，不自动升级；.local/noname/v1.11.6 为原始编译引擎和资源。响应中的路径兼容改动可在 service.ts 审查，不编辑上游磁盘文件。

## 接入边界

正式 main.ts 使用 NativeNonameService。默认不带 adapter 的领域/HTTP 测试仍使用未配置占位器；测试 fake 不能当作游戏可玩。资源校验通过、电脑服务页心跳在线才 ready，真实选将和发牌确认后才 playing。

状态 waiting → starting → playing → finished → waiting。手机选将发生在 starting；失败或规则宿主丢失回到等待，真人重新准备；结算后房主回房释放旧 worker、保留房间和席位，下一局创建新的 match。

规则宿主凭据为仅回环 HttpOnly cookie，手机对局凭据来自大厅 cookie；都不进 QR/公共 API。套接字按原有席位绑定 ID，拒绝跨房、跨源、原生配置/开局/牌堆/任意执行。原生昵称必须 textContent。

privacy.js 过滤接收玩家不可知的暗牌值、身份、提前编码的事件父链和重连状态；公开牌/原生授权查看保持可用。入站物理牌只按现有 ID 解析，不接受客户端改写牌值。原生技能的额外 storage 和全面恶意客户端决策校验没有穷尽验证；新增扩展要逐项补覆盖。

同一 cookie 刷新恢复本人；短暂对局连接中断由外层恢复 iframe。上游在离线期间可临时用 AI 行动，重新连上恢复人工控制。跨微信/系统浏览器不共享 cookie；服务器重启清空对局与大厅。

## 验证结果

- 类型、20 项领域/HTTP/认证网关测试、页面/服务构建通过；3 组 Edge 大厅交互回归通过。
- 四模式 × 两档武将：一真人 + AI 原生完整结算；身份 5、6、7、8 席通过，8 席刷新恢复；电脑不在任何生存/阵亡席位。
- 两真人单挑：真实触屏选牌、目标、确认，规则端记录动作；原房间返回后第二局完整结束。
- 自己的牌可见，对手暗手牌无真实牌名/花色/点数；未公开身份、提前编码的事件和刷新快照经过过滤。
- 对局 WebSocket 中断后外层自动恢复原座位；神将定向候选测试完成原生势力选择和结算。
- 修复选将后整个原生画布被滚动偏移的裁切，手机横屏头像可完整显示；手牌与弹窗滚动保持可用。
- 地主 +1 上限、feiyang/bahu 正确；客户端收到原生结算；资源无缺失、对局外网请求为零。
- Windows 离线包用随包 Node 启动、跳过 npm/下载，端口冲突自动换位、正常停止。
- 真实 Android 微信仅扫码主页和模拟开房由用户确认（2026-10-04）。不要把 Edge 手机视口写成真机微信完整验收。

结果与截图在 .runtime/native-runtime，发行文件在 .runtime/releases；不提交本机运行数据。

## 启动与接续

非程序员：根目录启动/停止 .cmd；离线包完整解压后使用相同入口。源码版首次准备需要 Node.js 24 和网络，之后资源缓存校验复用。发行包 portable.json 让启动跳过依赖安装/构建/下载。

本机 3000 为其他程序，工作区 .env 使用 3001；不要按端口或批量 Node 杀进程。当前服务以 .runtime/session.json 中的 serverUrl 为准，停止脚本校验实例与本机控制凭据。不要完整打印 session.json，它含停止 token；不用于游戏存档。

开发：npm run check；页面变化 npm run test:browser；原生改动 npm run engine:verify:rooms，按 runtime/README.md 分别补 advanced、8 席、两真人、手动、重连、第二局。上游或资源变更后重新准备/校验，更新固定来源与验证矩阵。

下一项：真实 Android/iPhone 微信完整对局与后台恢复；5–8 席全真人与多房容量覆盖；进阶技能私有数据定向验证；扩展 manifest/联机加载。保持现有可玩流程，先补证据和针对性修复，不从头重研。
