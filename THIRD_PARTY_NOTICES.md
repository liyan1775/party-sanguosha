# 第三方来源

## 无名杀研究候选

- 项目：[libnoname/noname](https://github.com/libnoname/noname)
- 检查版本：v1.11.6；commit `2367607e246d21aae168dba15c01151ee0651f30`
- 上游核心包元数据标注 `GPL-3.0-only`；参见 [package.json](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/package.json) 与 [上游许可证](https://github.com/libnoname/noname/blob/v1.11.6/LICENSE)。
- 当前下载包用于本机独立运行验证，位于被忽略的 `.local`；未集成进大厅服务，也没有在本仓库打包分发。
- `packages/noname-adapter/lab/duel-mode.js` 通过上游单挑模式复用原生规则，适配文件标记 GPL-3.0-only；上游原始许可证全文保存在 `packages/noname-adapter/licenses/noname-GPL-3.0.txt`。
- 验证资源清单 `config/noname-lab-assets.json` 固定上游 commit 和资源 Git blob 校验。资源所有权与原有许可不因下载或整理而改变。

实际引擎、资源或扩展接入时，保留其原始来源、许可证和必要声明。发布前依据最终实际包含的文件完善本清单。

## 大厅依赖

`qrcode` 用于本机生成二维码。其原始许可证随 `node_modules/qrcode` 保留，版本和可复现依赖记录在 `package-lock.json`。其他开发工具版本见 `package.json` 和锁文件。

`ws` 8.22.0 用于独立引擎验证程序的 WebSocket 转发，当前为开发依赖，MIT 许可证保留在 `node_modules/ws/LICENSE`。它不改变无名杀或衍生适配文件的 GPL 许可。

本项目当前为私有开发项目，尚未指定对外发布许可证。
