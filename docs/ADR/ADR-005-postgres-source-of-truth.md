# ADR-005: PostgreSQL 为持久事实来源

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 10

## 决策

账号、角色、物品、金币、经验、内容 Release、审计和 Outbox 以 PostgreSQL 为
唯一事实来源。

## 理由

需要事务、约束、行锁和可审计的一致性；内存与缓存不能承担资产正确性。

## 影响

- 金币必须 wallet + ledger 同事务。
- 物品实例唯一归属，不能用内存判断替代数据库约束。
- Room 内存中的瞬时状态允许崩溃后重建。
- 迁移采用 Expand → Migrate → Contract。
