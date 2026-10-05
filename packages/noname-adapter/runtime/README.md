# 正式无名杀适配

v0.5.1 的局域网入口直接使用本机素材和 WebSocket，不依赖临时公网；公网持续推送连续发送有序动作，不逐条等待前一 ACK，中断按序重试、服务端去重。HTTP/RTC 保持串行。诊断上报每 8 秒一次或线路变化时更新，单请求有超时且不并发堆积。`ENGINE_VERIFY_LOCAL_BRIDGE=1 ENGINE_VERIFY_HUMANS=5 ENGINE_VERIFY_MODES=identity ENGINE_VERIFY_LAN_PLAYERS=4 ENGINE_VERIFY_PUBLIC_DROP=1` 在桌面上验证四 LAN 加一公网代理同桌、真实切断/恢复代理及 LAN 原生操作持续；不等于物理 Wi-Fi/iPhone 测试。

开局期间手机早于规则 iframe 的认证消息暂存于 match 私有内存，规则连接后先 connect 再交付，当前连接身份必须仍匹配；最多 512 条/4MiB，失败/释放清空，旧连接消息丢弃。`ENGINE_VERIFY_DELAY_WORKER_MS=4000` 可在真实对局测试中延迟规则页 HTML，覆盖这一载入次序；范围 0–10000ms，不能与 CACHE 组合。

v0.5.0 的 `observer.js` 使用显式公开字段投影，仅本机控制台读取；不使用原生序列化快照作为观察者数据，不读手牌牌面、牌堆、私人选择或 storage。当前专门的公开牌桌视图不含完整原生动画及特殊技能标记。

公网 PlayerTransport 在同一 PollChannel 上尝试有确认的 WebSocket 持续推送，失败回 HTTP；RTC 同通道接管，不重入座或重复动作。公共 STUN 允许合法 UDP 公网候选、保留私网候选，无 TURN，不保证全部 NAT 穿透。`ENGINE_VERIFY_STREAM_DROP=1` 主动关闭推送并检查原通道继续，`ENGINE_VERIFY_NO_RTC=1` 复核公网路径。`npm run test:engine-api` 强制要求完整固定资源；纯源码常规检查明确跳过完整预加载资源清单一项。

固定基线：libnoname/noname v1.11.6，commit 与核心包校验见 `config/noname-candidate.json`。`lab` 保留基础研究程序，正式服务不复用其无授权转发端点。

## 运行职责

- `src/service.ts` 管理每房独立 match、认证 WebSocket、资源白名单与启动/结束通知。
- 电脑 `/server` 通过仅回环可用的事件流接收任务变化、创建隔离 iframe，服务器每 8 秒保活；旧服务器回退每 2 秒查询。宿主 cookie 仅回环、HttpOnly，不赋予房主权限。
- 玩家 `/join/房号` 保留大厅 SSE，选将/对局 iframe 按房间 cookie 取得本人身份；不能指定别人的玩家 ID 或使用其他房间。
- `bootstrap.js` 启动已编译 JS，普通 LAN HTTP 无需 Service Worker/HTTPS；配置与扩展由电脑提供。
- 入口与外层房间页显示六步载入进度、已完成资源数、载入量（含缓存）和耗时；动态导入失败可手动重试，两分钟载入检查不清空存储。固定引擎 360 个构建输入合并为同一个 ESM 单例，主体 gzip 为约 1.97MiB，内容哈希 URL 允许缓存；动态包仍共享该单例。package.js 仅枚举该武将档需要的定义包，不扩大选将或牌堆。
- `mode.js` 适配座位、身份、选将、武将档与发牌，复用上游牌、技能、回合、死亡、AI 和胜负；规则宿主是脱离参赛数组的 Player 视点。
- `privacy.js` 在原生 Client.send 序列化期间设置接收者，保留自己的牌、已公开牌、技能授权可知的牌；暗牌只发送 ID/占位值，提前编码的事件父链和原始元组也再次过滤。身份局 getState/重连快照过滤未公开身份。
- `relay.js` 入站物理卡牌只按现有 ID 解析，忽略客户端提供的牌名/点数/花色；`controls.js` 用 textContent 渲染昵称并关闭原生房间管理/更新/牌堆入口。
- 固定画布采用 overflow:clip，避免浏览器选将时滚动整个画布导致头像/手牌裁切；手牌与弹窗保留各自的滚动。自动化检查手机横屏中所有参赛头像位于可视范围。
- 微信竖屏默认旋转外层横向牌桌；方向按钮和尺寸变化保留 iframe。公开出牌在离开手牌前按事件材料识别，ordering 中的观星继续私有；占位牌以牌背显示。
- 身份阵亡适配显式发送公开身份并修正死亡标记；五谷丰登只公开 native useCard 的 wuguShownCards，涯角只公开 reyajiao 的翻牌，不扩大其他 ordering 的权限。
- 新手档为 slow、duration=1000ms，在 loadConfig 重设 duration 之后应用；进阶档 fast/500ms。电脑与手机使用相同节奏，AI 原生决策不变。
- audio.js 由真实手机触摸解锁 Web Audio，按需播放已校验的本地原生卡牌/技能/阵亡音效；对局工具条可静音，电脑不播放，音效不阻塞载入。原生菜单回调不可恢复，下滑设置与快捷入口关闭。
- v0.4.1 主页与 waiting 房间通过 `/engine/preload` 取得当前档/模式的公共静态清单，以低优先级逐项读取完整响应，由浏览器缓存复用；后台暂停、开局停止发起新请求，不执行引擎或播放声音。资源 URL 使用上游 commit/构建哈希，支持异步 gzip/Brotli、并发去重与压缩后 64MiB 缓存上限。
- `scripts/build-native-portraits.mjs` 对已验证原图生成 256px WebP 小图，189 张总量约 3.1MiB，源图约 34.1MiB 保留；服务验证派生 SHA-256 后供选将与牌桌使用。构建变换去掉进阶状态计数额外注册的大日文字体。
- `prompts.js` 在 GameEvent.send 前同步最终提示、补充说明、分支和目标标签，保留动态、自定义和关闭提示；南蛮/万箭/决斗根据最终过滤与每次选择数量补全杀/闪，原生连续响应总数保留。乱武区分最近合法目标、失去体力与结束时可选额外杀；界挑衅明确造成伤害条件，界明策明确虚拟杀与双方摸牌。拼点材料仅在 `$compare`/`$compareMultiple` 原生展示开始后公开，选择阶段仍隐藏。
- HTTP 长轮询首帧后留 12ms 合批相邻帧，MessageChannel 保持逐帧 Promise/观察器顺序并避免嵌套计时器等待。v0.4.2 提交 result 后超过 350ms 才展示等待提示，明确覆盖上游 div 的 hidden 样式，收包/确认后收起。语音抑制载入、后台与积压事件，fetch/decode 超过 1.5 秒跳过，静音后不补播，最多两段同时播放；启动完成才预热基本牌。
- v0.4.2 公网玩家直接使用有序 HTTP 通道，等待房间时与电脑建立无 STUN/TURN、无媒体的局域网 RTC 数据通道；电脑仅可转发原生 poll 与轻量 ping，私有授权仅在本机 jobs 流中交给电脑。每个 relay 请求仍验证宿主 cookie、当前房间/真人席位，privacy.js 和 relay.js 原保护保持不变。直连与公网复用通道/序号，失去直连自动回退公网；直连不加速静态素材。工具条显示最近三次往返样本的中位数，长轮询空等、原生动画不计入。

状态：`waiting → starting → playing → finished → waiting`。选将发牌后才确认 playing；启动失败或宿主丢失返回等待，真人重新准备。结算后房主回房，释放旧 worker、重新生成 match，保留房间码/座位。停止服务器不保存当前对局。

## 规则差异集中在一个文件

身份局使用经典 5–8 人身份配置；地主增加 1 体力上限并获得原生 feiyang/bahu，无额外地主强化；2v2 第 1、4 行动位同队，第 2、3 位同队，无替补，第四行动位多 1 起始手牌；单挑采用原生 single 的 dianjiang、每人一名武将、一局死亡结算。选将为不重复候选池，每人最多 5 名；不会打开商业选将/解锁或原生自由选将菜单。神将与多势力武将沿用原生势力选择。

新手为该版本 standard 的 33 将；进阶为 refresh 全包 128 将、阴雷 16 将和固定 12 神将，共 156 将。选将和原生变换候选受白名单约束。固定资源清单共 2223 项，其中 1686 个音频约 84.3MiB；上游缺少 xin_zhangliang 独立图片时复用同名张梁图片，见 manifest 的 portraitAliases。

`npm run engine:update-catalog` 静态读取固定核心，生成 `config/general-catalog.json`；`npm run engine:update-audio` 使用同 commit 的 `.local/research/upstream-tree.json` 更新音频 blob 清单，然后运行 `engine:prepare` 校验/准备。图鉴数据与清单受版本管理，生成器不执行第三方技能。两档图鉴合计 189 位武将，源文本与图片不由手工改写。

## 可重复验证

v0.4.0 玩家传输支持 WebSocket 首次失败/8 秒超时后的认证 HTTP 长轮询；规则宿主仍用本机 WebSocket。两种传输都保留 `privacy.js` 和入站卡牌引用保护。HTTP 逐条消息间保留浏览器任务边界，原生判定复制牌须等待前帧的 Promise 与观察器完成。公网连接经独立代理，不能访问宿主入口。`ENGINE_VERIFY_HTTP=1` 强制 HTTP，`ENGINE_VERIFY_BLOCK_WEBSOCKET=1` 拦截玩家 WebSocket 检查实际自动回退，`ENGINE_VERIFY_STALL_WEBSOCKET=1` 模拟连接始终无响应以检查八秒回退；与四模式、两真人、重连/第二局参数组合。使用已运行公网实例时，`ENGINE_VERIFY_EXISTING_URL` 指本机服务地址，`ENGINE_VERIFY_PLAYER_URL` 指公网 origin，电脑继续打开本机 `/server`。桌面合成微信 UA 不等于流量或微信真机验收。

```powershell
npm run engine:prepare
npm run engine:verify:rooms
$env:ENGINE_VERIFY_PRESET = 'advanced'
npm run engine:verify:rooms
```

可选环境变量：`ENGINE_VERIFY_MODES=duel,identity,doudizhu,versus`、`ENGINE_VERIFY_IDENTITY_SEATS=8`、`ENGINE_VERIFY_HUMANS=2`、`ENGINE_VERIFY_RECONNECT=1`（刷新）或 `socket`（自动恢复）、`ENGINE_VERIFY_MANUAL=1`、`ENGINE_VERIFY_SECOND_ROUND=1`。后两项分别触屏选牌/目标/确认并验证规则端历史、在原房间重新完成第二局。`ENGINE_VERIFY_EXISTING_URL` 可指定已运行的发行包局域网地址，脚本不会停止该实例。独立验证用随机端口，不占当前聚会服务。

`ENGINE_VERIFY_CACHE=1` 不拦截同源请求，允许浏览器真实 HTTP 缓存；配合 `ENGINE_VERIFY_RECONNECT=1` 检查刷新后主体 transferSize=0。不要与注入 CSS 慢载入、失败重试或候选 fixture 组合。`ENGINE_VERIFY_COLD_MOBILE_KBPS=128` 则通过浏览器网络模拟设置 128 KiB/s 上下行与 150ms 延迟，可与 CACHE 组合检查真实冷启动和缓存；等待实际客户端手牌到达，再检查大字体请求、纯 CSS 血条与音效。这是桌面限速模拟，不是微信流量测速。验证还检查实际音频解码/播放与静音、真实向下触摸滑动、原生五谷丰登广播/牌面及结算前阵亡身份。检查产品默认节奏后，验证脚本把原生速度改为 vvfast/100ms 加速完整结算；该加速不进入产品配置。

`ENGINE_VERIFY_PRELOAD=1` 配合 CACHE 等待大厅公共素材准备完成，再进入真实选将、发牌与对局，断言 iframe 引擎主体 transferSize=0。`ENGINE_VERIFY_EXPERIENCE=1` 检查 23 类选择提示，经原生 GameEvent.send、Client JSON 和逐接收者隐私过滤，在手机按原生 parsedResult 重建后核对当前文字/分支和对话框；进阶再调用原生乱武、界乱武、界挑衅内容，仅执行到选择构造器即停止，并核对两端合法目标。该构造探针不推进技能结算，不等于整局定向触屏验收。另将实际音频响应延迟 2.2 秒，等待二十次语音全部完成且过期丢弃。MANUAL 还测量原生 result 提交至电脑规则宿主收到的时间，区别于整个动画/下一次可操作的往返延迟。`engine:check-definitions` 同时生成静态选择入口审计；新增无参响应须补核对。

`ENGINE_VERIFY_GOD_FIXTURE=1` 仅用于定向神将势力选择回归：浏览器测试路由将候选限制为神赵云、神吕布，配合 `ENGINE_VERIFY_PRESET=advanced` 与 `ENGINE_VERIFY_MODES=duel` 使用。它不改变产品配置，也不替代完整 156 将白名单验证。结果文件按参数区分，记录验证时间和参数。

v0.3.1 默认模拟 Android 微信 UA，仍由桌面 Edge 执行；`ENGINE_VERIFY_USER_AGENT` 可替换该合成 UA。`ENGINE_VERIFY_PORTRAIT=1` 使用 390×844 窗口，检查横向牌桌/竖屏切换不换 iframe，并继续真实触屏操作。`ENGINE_VERIFY_SLOW_START=1` 将手机 CSS 响应延迟 12 秒，确保实际跨过原生十秒阈值；`ENGINE_VERIFY_RETRY_START=1` 中断首次核心模块下载，点击真实重试按钮后完成对局。两项支持与四模式组合。

`ENGINE_VERIFY_JUDGE_FIXTURE=1` 配合 `ENGINE_VERIFY_MODES=duel`、`ENGINE_VERIFY_HUMANS=2` 使用：测试路由限定甄姬/司马懿，执行原生洛神判定和鬼才改判，不改变产品配置或牌堆。检查发送的牌名/花色/点数，以及两端实际复制牌面的遮盖类与花色点数；新手档测试，不与神将 fixture 同时使用。

`ENGINE_VERIFY_COMPARE_FIXTURE=1` 配合 advanced、duel、两真人使用：测试路由限定界高顺/界太史慈，必须实际执行原生拼点，检查广播材料无占位且选择阶段/其他暗牌仍隐藏。fixture 不修改产品候选、牌堆、伤害或胜者，也不与 CACHE 或其他 fixture 组合。判定复制牌观察排除拼点先展示牌背的翻转动画，拼点另外检查发送牌面。

脚本观察实际原生出牌/响应及判定广播，检查对手打出的牌不含占位元组；另用真实原生卡牌做序列化上下文探针，验证观星排序区对旁观者隐藏、对获授权玩家可见。判定牌从 player.judging 与 event.result.card 识别；event.card 不是翻出的结果牌。对手手牌检查尊重原生 knowers（例如洛神公开获得的牌），不能把所有对手手牌都当作未知牌。静态定义检查是 `engine:verify:rooms` 的前置步骤，也可单独执行 `npm run engine:check-definitions`。

输出 `.runtime/native-runtime`；不提交私人牌值/运行凭据。默认选将后启用上游托管至结算，没有合成伤害、牌或胜者。桌面 Edge 手机视口与真机微信分别记录，不混作验收。

## Windows 离线包

`npm run package:windows` 构建 `dist/web` 与 `dist/server/main.js`，验证资源后生成 `.runtime/releases` 下的 ZIP、SHA-256。打包使用全新临时目录，完成后清理，避免混入曾运行的发行副本。包含 Node.js 24 x64、固定联网组件、引擎/图片/音频、相应许可证、项目源码与文档；不包含 `.env`、`.runtime` 内的个人实例信息、日志或会话。发行包通过 `portable.json` 跳过 npm/构建/下载，双击入口相同。

当前未承诺所有进阶技能的私有存储覆盖、恶意客户端全面防作弊、微信后台长时间恢复或多房容量。添加扩展需要单独验证原生协议与私有数据，不能只改白名单便开放。
