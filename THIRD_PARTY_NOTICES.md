# 第三方来源

## 无名杀研究候选

- 项目：[libnoname/noname](https://github.com/libnoname/noname)
- 检查版本：v1.11.6；commit `2367607e246d21aae168dba15c01151ee0651f30`
- 上游核心包元数据标注 `GPL-3.0-only`；参见 [package.json](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/package.json) 与 [上游许可证](https://github.com/libnoname/noname/blob/v1.11.6/LICENSE)。
- 固定核心包与资源位于被忽略的 `.local`，通过正式适配服务分发到局域网玩家；Windows 离线包保留版本、来源、许可证和本项目适配源码。
- `packages/noname-adapter/lab/duel-mode.js` 通过上游单挑模式复用原生规则，适配文件标记 GPL-3.0-only；上游原始许可证全文保存在 `packages/noname-adapter/licenses/noname-GPL-3.0.txt`。
- `packages/noname-adapter/runtime` 的衍生适配文件同样标记 GPL-3.0-only。未改写上游磁盘文件；兼容路径调整在 `src/service.ts` 的资源响应中进行，源码可审查。
- 验证资源清单 `config/noname-lab-assets.json` 固定上游 commit 和资源 Git blob 校验。资源所有权与原有许可不因下载或整理而改变。

实际引擎、资源或扩展接入时，保留其原始来源、许可证和必要声明。发布前依据最终实际包含的文件完善本清单。

## 大厅依赖

`qrcode` 用于本机生成二维码。其原始许可证随 `node_modules/qrcode` 保留，版本和可复现依赖记录在 `package-lock.json`。其他开发工具版本见 `package.json` 和锁文件。

`ws` 8.22.0 用于正式认证 WebSocket 和独立验证，MIT 许可证保留。Windows 打包收集实际进入服务端 bundle 的 npm 包许可证到 `notices/npm`，另保留 qrcode、ws 许可证副本。

Windows 离线包携带当前 Node.js 24 的 Windows x64 二进制、版本、SHA-256 和对应 [Node.js 原始许可证](https://github.com/nodejs/node/blob/v24.12.0/LICENSE)，位于 `.local/runtime/node-LICENSE.txt`。打包脚本不携带本机代理、配置或服务凭据。

本项目当前为私有开发项目，尚未指定对外发布许可证。
