# 第三方来源

## 无名杀研究候选

- 项目：[libnoname/noname](https://github.com/libnoname/noname)
- 检查版本：v1.11.6；commit `2367607e246d21aae168dba15c01151ee0651f30`
- 上游核心包元数据标注 `GPL-3.0-only`；参见 [package.json](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/package.json) 与 [上游许可证](https://github.com/libnoname/noname/blob/v1.11.6/LICENSE)。
- 固定核心包与资源位于被忽略的 `.local`，通过正式适配服务分发到局域网玩家；Windows 离线包保留版本、来源、许可证和本项目适配源码。
- `packages/noname-adapter/lab/duel-mode.js` 通过上游单挑模式复用原生规则，适配文件标记 GPL-3.0-only；上游原始许可证全文保存在 `packages/noname-adapter/licenses/noname-GPL-3.0.txt`。
- `packages/noname-adapter/runtime` 的衍生适配文件同样标记 GPL-3.0-only。未改写上游磁盘文件；兼容路径调整在 `src/service.ts` 的资源响应中进行，源码可审查。
- 验证资源清单 `config/noname-lab-assets.json` 固定上游 commit 和资源 Git blob 校验。资源所有权与原有许可不因下载或整理而改变。
- v0.3.2 增加 1686 个同 commit 的卡牌、技能与阵亡音频，保留原路径和逐项校验。`config/general-catalog.json` 的武将与技能文本来自该版本的原始定义，记录来源与 GPL-3.0-only 元数据，不改变原有资源所有权。
- `dist/engine` 是上述固定上游的浏览器构建产物，保留来源标记；对应上游源码及随包依赖仍完整保存在 `.local/noname/v1.11.6`，离线发行包一并携带原始代码与许可证。构建变换可在 `scripts/build-native-engine.mjs` 审查。
- v0.4.1 的 `dist/engine/portraits` 是同版本 189 张已验证原图的缩小 WebP 派生素材；保留原图、源 Git blob 与派生 SHA-256 清单，不改变资源原有权属与许可。

实际引擎、资源或扩展接入时，保留其原始来源、许可证和必要声明。发布前依据最终实际包含的文件完善本清单。

## 大厅依赖

`qrcode` 用于本机生成二维码。其原始许可证随 `node_modules/qrcode` 保留，版本和可复现依赖记录在 `package-lock.json`。其他开发工具版本见 `package.json` 和锁文件。

`ws` 8.22.0 用于正式认证 WebSocket 和独立验证，MIT 许可证保留。Windows 打包收集实际进入服务端 bundle 的 npm 包许可证到 `notices/npm`，另保留 qrcode、ws 许可证副本。

`sharp` 0.35.5 仅用于构建武将小图，锁定在开发依赖中。原始 Apache-2.0 许可证保存在 [notices/sharp-LICENSE.txt](notices/sharp-LICENSE.txt)；其可选原生依赖与 libvips 声明随开发环境 npm 包保留，不进入生产服务 bundle 或双击启动时的图片处理。

Windows 离线包携带当前 Node.js 24 的 Windows x64 二进制、版本、SHA-256 和对应 [Node.js 原始许可证](https://github.com/nodejs/node/blob/v24.12.0/LICENSE)，位于 `.local/runtime/node-LICENSE.txt`。打包脚本不携带本机代理、配置或服务凭据。

本项目当前为私有开发项目，尚未指定对外发布许可证。

## 公网联网组件

Cloudflared 来自 [Cloudflare 官方项目](https://github.com/cloudflare/cloudflared)，固定 [2026.9.3 发布](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3) 的 Windows x64 独立可执行文件，官方 SHA-256 与来源记录在 `config/public-connector.json`。不安装系统服务，不自动升级；缓存位于被忽略的 `.local/connector`，完整发行包携带该固定组件。原始 Apache-2.0 许可证保存在 [notices/cloudflared-LICENSE.txt](notices/cloudflared-LICENSE.txt)，不改变无名杀 GPL 或本项目未定的许可。

实际流量使用 Cloudflare Quick Tunnel 临时服务，能力与限制以 [官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 为依据；随机 HTTPS 域名、无可用性保证、200 个同时在途请求、不支持 SSE。公网方案不创建托管游戏服务器、远程仓库或用户账号。
