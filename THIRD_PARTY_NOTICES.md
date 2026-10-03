# 第三方来源

## 无名杀研究候选

- 项目：[libnoname/noname](https://github.com/libnoname/noname)
- 检查版本：v1.11.6；commit `2367607e246d21aae168dba15c01151ee0651f30`
- 上游核心包元数据标注 `GPL-3.0-only`；参见 [package.json](https://github.com/libnoname/noname/blob/v1.11.6/apps/core/package.json) 与 [上游许可证](https://github.com/libnoname/noname/blob/v1.11.6/LICENSE)。
- 当前下载包用于本机接入研究，位于被忽略的 `.local`；未集成进大厅服务，也没有在本仓库打包分发。

实际引擎、资源或扩展接入时，保留其原始来源、许可证和必要声明。发布前依据最终实际包含的文件完善本清单。

## 大厅依赖

`qrcode` 用于本机生成二维码。其原始许可证随 `node_modules/qrcode` 保留，版本和可复现依赖记录在 `package-lock.json`。其他开发工具版本见 `package.json` 和锁文件。

本项目当前为私有开发项目，尚未指定对外发布许可证。
