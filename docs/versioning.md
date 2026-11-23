# 版本号与发布规范（SemVer）

从 **v1.0.0** 起，本项目严格遵循 [语义化版本 2.0.0（SemVer）](https://semver.org/lang/zh-CN/)：`主版本号.次版本号.修订号`（`MAJOR.MINOR.PATCH`）。

## 版本递增规则

| 变更级别              | 示例              | 适用场景                                                    |
| --------------------- | ----------------- | ----------------------------------------------------------- |
| **主版本号（MAJOR）** | `1.0.0` → `2.0.0` | 架构级大改版、不兼容既有本机资料格式或入口契约的重大迭代    |
| **次版本号（MINOR）** | `1.0.0` → `1.1.0` | 向后兼容的新玩法、新《山河图》剧本/难度、重要体验与界面升级 |
| **修订号（PATCH）**   | `1.0.0` → `1.0.1` | 向后兼容的缺陷修复、技能/隐私回归补丁、启动与网络稳定性修复 |

## 升级与本机资料保护约定

升级覆盖程序文件夹时，以下目录属于玩家个人资料，**务必保留，不要删除**：

- `data/shanhetu/`：单人《山河图》山河册通关进度、解锁记录与探索履历
- `data/rosters/`：玩家自建与修订的自定义将池库及备份

## 发布门禁清单

每次正式发布标签前均须满足：

1. `package.json`、`package-lock.json` 与 `packages/shared/src/contracts.ts` 中的 `APP_VERSION` 完全一致；
2. 固定上游引擎版本与 commit 不变（或完成完整升级审计并同步更新 `THIRD_PARTY_NOTICES.md`）；
3. `npm run check`、`npm run release:check`、`npm run test:browser` 及对应原生引擎回归脚本通过；
4. Windows 公开启动包（`party-sanguosha-vX.Y.Z-windows-x64-setup.zip`）连同 `.sha256` 校验文件完成隔离目录实测；
5. GitHub Actions（Ubuntu + Windows 检查）与 GitHub Pages 部署全部亮绿通过。
