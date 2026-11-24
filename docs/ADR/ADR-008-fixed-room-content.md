# ADR-008: 固定 Room 内容版本，不原地热改地图

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 6.3、12

## 决策

内容以不可变 Release 发布。Room 创建时固定 contentReleaseId 和
assetManifestVersion；地图结构变化通过新建实例并排空旧实例生效。

## 理由

运行中的房间需要稳定快照，避免战斗数值和地图在半途变化导致不可复现问题。

## 影响

- 正在运行的 Room 不读取新 Release。
- 回滚通过切换 Realm 的活动 Release，而不是修改旧 Release。
- 发布需要 checksum、引用校验和资源校验。
