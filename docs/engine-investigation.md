# 无名杀接入研究

检查日期：2026-10-03。事实、推断和未验证项分开记录。

## 候选与校验

公开上游：[libnoname/noname](https://github.com/libnoname/noname)。本次检查 [v1.11.6 发布](https://github.com/libnoname/noname/releases/tag/v1.11.6)，commit 固定为 `2367607e246d21aae168dba15c01151ee0651f30`。

下载了 `noname.core.zip`（40,085,634 字节），与同一发布的 `.sha256` 核对一致：

```text
d35538c702f5acc4a18be805a0f15d2639613dbe0805bf62e4d574db5bbb869e
```

解压位置：`.local/noname/v1.11.6/`。该目录仅用于研究；当前房间服务没有公开该目录，也没有执行其中代码。核心包缺少完整图片、音频资源；完整包约 1.22 GB，本次未下载。

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
- 单武将单挑不得直接套用含阵亡换将的上游单挑规则。下一步检查联机 1v1 及胜负分支，必要时用小扩展实现。
- 任意扩展不保证浏览器可用或支持联机。依赖 Node 文件系统、本地客户端 API 或私有资源的扩展需适配。

本次尚未运行真实无名杀多人对局，也未进行微信真机测试。候选版本的 `runtimeVerified` 保持 `false`。

## 接入验证顺序

1. 用一个最小验证程序从局域网 HTTP 地址加载核心及所需资源，记录错误与外部网络请求。
2. 两个独立浏览器会话完成单武将单挑：电脑不占席位，手机双方选将、出牌、结束对局。
3. 失败则比较仍维护的公开 tag，或创建最小、可审查、可重复应用的适配补丁；记录选择理由。
4. 通过后选定运行版本，落地下载/校验/预编译脚本和来源声明，再接入 `NonameAdapter`。
5. 验证斗地主、2v2、5–8 人身份，严格检查两档选将池；随后做 Android/iPhone 微信验收。
