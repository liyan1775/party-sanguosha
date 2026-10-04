# 无名杀接入研究

检查日期：2026-10-04。事实、推断和未验证项分开记录。

## 候选与校验

公开上游：[libnoname/noname](https://github.com/libnoname/noname)。本次检查 [v1.11.6 发布](https://github.com/libnoname/noname/releases/tag/v1.11.6)，commit 固定为 `2367607e246d21aae168dba15c01151ee0651f30`。

下载了 `noname.core.zip`（40,085,634 字节），与同一发布的 `.sha256` 核对一致：

```text
d35538c702f5acc4a18be805a0f15d2639613dbe0805bf62e4d574db5bbb869e
```

解压位置：`.local/noname/v1.11.6/`。当前房间服务没有公开该目录；独立验证程序会执行其中的编译 JS。核心包缺少完整图片、音频资源，已按固定 commit 补齐约 16.8 MB 的标准包验证资源；完整包约 1.22 GB，尚未下载。

## 源码确认

| 事项                                                                                           | 依据                                                                                                                                                                                                         | 对本项目的影响                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 当前源码采用 monorepo，核心位于 `apps/core`，联机包位于 `packages/server`                      | [发布说明](https://github.com/libnoname/noname/releases/tag/v1.11.6)、[联机包入口](https://github.com/libnoname/noname/blob/v1.11.6/packages/server/src/index.ts)                                            | 不直接照抄旧 `game/server.js` 教程                                 |
| 联机包通过 `ws` 管理房间，将玩家消息交给房主，再转发房主响应                                   | [createServer.ts](https://github.com/libnoname/noname/blob/v1.11.6/packages/server/src/server/createServer.ts)                                                                                               | 它主要承担转发；还需规则主机                                       |
| 联机服务默认端口 8082，入口提供 `start/stop`                                                   | [CLI](https://github.com/libnoname/noname/blob/v1.11.6/packages/server/src/cli.ts)、[类型](https://github.com/libnoname/noname/blob/v1.11.6/packages/server/src/types.ts)                                    | 当前大厅 3000 与未来引擎端口不能混为一谈                           |
| 普通联机主机在等待玩家时初始化本机玩家，在发牌映射时保留 `game.me`                             | [等待玩家实现](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/noname/library/element/content.ts)、[randomMapOL](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/noname/game/index.js) | 电脑不参赛需要单独适配，当前大厅的无席位主控不等于已经解决引擎问题 |
| 引擎导入映射和部分脚本采用根路径                                                               | [构建脚本](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/scripts/build.ts)                                                                                                                      | 挂在 `/engine/` 时必须验证路径，不能只加静态目录前缀               |
| 核心包 HTML 含 Service Worker/JIT 注册，不支持时会提示；原始源码 HTML 与发布包不同             | [JIT 入口](https://github.com/libnoname/noname/blob/v1.11.6/packages/jit/src/entry.ts)、已校验核心包的 `index.html`                                                                                          | 局域网 HTTP 下应验证预编译运行和扩展加载，不要求朋友安装证书       |
| 三国杀斗地主已有 `doudizhu`，联机分支人数为 3，休闲配置可赋予飞扬/跋扈，选将后增加地主体力上限 | [斗地主实现](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/mode/doudizhu.js)                                                                                                                    | 优先复用，固定变体和技能版本，关闭额外强化                         |
| 对决联机分支使用 `versus_mode: 2v2`，不是单机 `two` 标识                                       | [versus.js](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/mode/versus.js)                                                                                                                       | 映射配置需区分联机与单机                                           |
| 阴、雷具有独立分组；神话再临 12 神将有明确标识                                                 | [神话再临分组](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/character/shenhua/sort.js)、[神将分组](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/character/extra/sort.js)         | 已写入武将档要求，尚未在对局中应用                                 |

参考代码检查还包括 v1.10.17.3 的 [等待玩家逻辑](https://github.com/libnoname/noname/blob/v1.10.17.3/noname/library/element/content.js) 和 [启动逻辑](https://github.com/libnoname/noname/blob/v1.10.17.3/noname/init/index.js)：旧代码存在 `isNonameServer` 分支和 `?server=` 入口。它只是比较依据，不能据此声称旧版现在可直接部署，也没有选定为运行版本。

## 推断与待验证

- 常规局域网 HTTP 地址不满足 Service Worker 的安全上下文要求；这说明原样入口可能有提示或能力缺失，不等于已经证实所有 JS 对局都无法运行。浏览器要求参见 [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)。
- 首选验证已编译 JavaScript、同源静态资源、局域网 WebSocket、独立电脑规则主机的组合。
- 上游 `single` 的 `normal` 含阵亡换将；`dianjiang` 一名武将阵亡即结算。独立验证复用后者的死亡和原生规则，另做电脑不参赛与联机席位启动。
- 任意扩展不保证浏览器可用或支持联机。依赖 Node 文件系统、本地客户端 API 或私有资源的扩展需适配。

以下研究记录保留最初独立验证时的发现。v0.3.0 已正式集成大厅，四模式/两档已运行验证，`runtimeVerified` 为 true；具体范围见 `runtimeVerification` 与 `runtime-validation.md`。微信真机完整游戏尚未验收。

## 玩家房主与 AI 补位补充

产品已明确：电脑只提供服务，手机玩家创建房间成为参赛房主。源码中的规则 host 与产品房主必须分开处理；不能因为上游默认由 host 占位，就重新赋予电脑房主或参赛身份。

用户要求复用最强可用的无名杀内置 AI、不提供智力选项。已检查候选核心包的 `noname/library/index.js` 与 `noname/get/index.js`：配置 `difficulty` 显示为「AI 对人类态度」，`easy/normal/hard` 对应友好/一般/仇视；不是智力档位。`ai_strategy` 是内奸对阵营的策略，亦不能解释为通用智能等级。原始配置见 [上游 library 配置](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/noname/library/index.js)。

在已检查的配置中，未发现可直接等同于“最聪明”的统一档位。原生选择事件具有 `ai1/ai2`、`processAI` 与自动处理路径，具体由技能和模式提供评估函数；见 [事件内容](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/noname/library/element/content.ts)。接入时应使用完整原生决策路径；若所选版本另有明确智能优化开关，验证后固定开启，不能仅设 `difficulty: hard` 就声称完成要求。

当前 `config/ai-policy.json` 和适配契约固定 `strongest-native`，这是产品策略标识，不是上游原生配置键。正式大厅已执行原生选择、技能、出牌和阵亡结算，包含 5/8 席混合 AI、两档四模式与同会话刷新，没有设置 `difficulty: hard`。

## 2026-10-04 独立运行结果

程序位于 `packages/noname-adapter/lab/`，准备和验证入口分别是 `npm run engine:prepare`、`npm run engine:verify`。准备会校验核心 SHA-256、补齐固定资源的 Git blob 校验，并保留 GPL 原文；不会改动上游 JS。

已通过 Windows Edge、私有网卡 HTTP 地址测试：`isSecureContext` 为 `false`；一玩家 + 原生 AI、两独立玩家页面均完成单将选将、原生出牌与胜负。玩家自动化点击选将后开启原生托管，电脑 `game.me` 为脱离席位的规则视角，不出现在生存/阵亡列表。没有伪造伤害、手牌、胜者或换将；不等于真人手动打完或微信真机游戏。资源无缺失，外网请求为零，手机模拟页面收到结算。

发现的正式接入缺口：

- 原生 `get.cardInfoOL` 会序列化手牌的花色、点数和名称。客户端中虽标记对手手牌为未知，仍可从内存读取牌值；两个用例开局时均收到对手四张未公开牌的数据。不能把 UI 遮盖或 `isKnownBy === false` 当作消息已经保密。应按接收席位过滤手牌及牌堆，并验证公开/转移/技能查看/重连。
- 原生客户端控制消息包含设置、开局和牌堆等请求。产品接入必须验证 cookie 和动作白名单，不能直接沿用测试角色参数授权。
- 验证程序仍有原生普通菜单，尚未落实两档白名单、房间隔离、重连、结算回房和再次开局。

上述缺口已在正式 `NativeNonameService` 与 `runtime` 中处理；手牌过滤、认证通道、白名单、菜单、重连和回房不依赖实验服务。实验转发仍默认回环，不随启动器开放，见 [验证说明](../packages/noname-adapter/lab/README.md)。

## 接入验证顺序

1. 已通过独立局域网 HTTP / WebSocket 单挑和原生 AI 基础验证，保留可重复脚本，避免从头研究。
2. 在适配边界做玩家授权和私有信息过滤，验证公开牌、牌转移、技能与重连；为每个产品房间隔离规则宿主。
3. 将真实启动、手机跳转、结算、回房和再次开局接入 `NonameAdapter`，再确定正式运行基线。
4. 验证斗地主、2v2、5–8 人身份，严格落实两档选将池和菜单限制。
5. 做 Android/iPhone 微信完整游戏、后台恢复和聚会离线准备验收。
