# 正式无名杀适配

固定基线：libnoname/noname v1.11.6，commit 与核心包校验见 `config/noname-candidate.json`。`lab` 保留基础研究程序，正式服务不复用其无授权转发端点。

## 运行职责

- `src/service.ts` 管理每房独立 match、认证 WebSocket、资源白名单与启动/结束通知。
- 电脑 `/server` 每 2 秒查询仅回环可用的任务，创建隔离 iframe；宿主 cookie 仅回环、HttpOnly，不赋予房主权限。
- 玩家 `/join/房号` 保留大厅 SSE，选将/对局 iframe 按房间 cookie 取得本人身份；不能指定别人的玩家 ID 或使用其他房间。
- `bootstrap.js` 启动已编译 JS，普通 LAN HTTP 无需 Service Worker/HTTPS；配置与扩展由电脑提供。
- `mode.js` 适配座位、身份、选将、武将档与发牌，复用上游牌、技能、回合、死亡、AI 和胜负；规则宿主是脱离参赛数组的 Player 视点。
- `privacy.js` 在原生 Client.send 序列化期间设置接收者，保留自己的牌、已公开牌、技能授权可知的牌；暗牌只发送 ID/占位值，提前编码的事件父链和原始元组也再次过滤。身份局 getState/重连快照过滤未公开身份。
- `relay.js` 入站物理卡牌只按现有 ID 解析，忽略客户端提供的牌名/点数/花色；`controls.js` 用 textContent 渲染昵称并关闭原生房间管理/更新/牌堆入口。
- 固定画布采用 overflow:clip，避免浏览器选将时滚动整个画布导致头像/手牌裁切；手牌与弹窗保留各自的滚动。自动化检查手机横屏中所有参赛头像位于可视范围。

状态：`waiting → starting → playing → finished → waiting`。选将发牌后才确认 playing；启动失败或宿主丢失返回等待，真人重新准备。结算后房主回房，释放旧 worker、重新生成 match，保留房间码/座位。停止服务器不保存当前对局。

## 规则差异集中在一个文件

身份局使用经典 5–8 人身份配置；地主增加 1 体力上限并获得原生 feiyang/bahu，无额外地主强化；2v2 第 1、4 行动位同队，第 2、3 位同队，无替补，第四行动位多 1 起始手牌；单挑采用原生 single 的 dianjiang、每人一名武将、一局死亡结算。选将为不重复候选池，每人最多 5 名；不会打开商业选将/解锁或原生自由选将菜单。神将与多势力武将沿用原生势力选择。

新手为该版本 standard 的 33 将；进阶为 refresh 全包 128 将、阴雷 16 将和固定 12 神将，共 156 将。选将和原生变换候选受白名单约束。固定资源清单共 537 项；上游缺少 xin_zhangliang 独立图片时复用同名张梁图片，见 manifest 的 portraitAliases。音频关闭。

## 可重复验证

```powershell
npm run engine:prepare
npm run engine:verify:rooms
$env:ENGINE_VERIFY_PRESET = 'advanced'
npm run engine:verify:rooms
```

可选环境变量：`ENGINE_VERIFY_MODES=duel,identity,doudizhu,versus`、`ENGINE_VERIFY_IDENTITY_SEATS=8`、`ENGINE_VERIFY_HUMANS=2`、`ENGINE_VERIFY_RECONNECT=1`（刷新）或 `socket`（自动恢复）、`ENGINE_VERIFY_MANUAL=1`、`ENGINE_VERIFY_SECOND_ROUND=1`。后两项分别触屏选牌/目标/确认并验证规则端历史、在原房间重新完成第二局。`ENGINE_VERIFY_EXISTING_URL` 可指定已运行的发行包局域网地址，脚本不会停止该实例。独立验证用随机端口，不占当前聚会服务。

`ENGINE_VERIFY_GOD_FIXTURE=1` 仅用于定向神将势力选择回归：浏览器测试路由将候选限制为神赵云、神吕布，配合 `ENGINE_VERIFY_PRESET=advanced` 与 `ENGINE_VERIFY_MODES=duel` 使用。它不改变产品配置，也不替代完整 156 将白名单验证。结果文件按参数区分，记录验证时间和参数。

输出 `.runtime/native-runtime`；不提交私人牌值/运行凭据。默认选将后启用上游托管至结算，没有合成伤害、牌或胜者。桌面 Edge 手机视口与真机微信分别记录，不混作验收。

## Windows 离线包

`npm run package:windows` 构建 `dist/web` 与 `dist/server/main.js`，验证资源后生成 `.runtime/releases` 下的 ZIP、SHA-256。打包使用全新临时目录，完成后清理，避免混入曾运行的发行副本。包含 Node.js 24 x64、相应许可证、固定引擎/图片、项目源码与文档；不包含 `.env`、`.runtime` 内的个人实例信息、日志或会话。发行包通过 `portable.json` 跳过 npm/构建/下载，双击入口相同。

当前未承诺所有进阶技能的私有存储覆盖、恶意客户端全面防作弊、微信后台长时间恢复或多房容量。添加扩展需要单独验证原生协议与私有数据，不能只改白名单便开放。
