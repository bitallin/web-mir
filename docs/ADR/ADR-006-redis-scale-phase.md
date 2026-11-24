# ADR-006: Redis 仅在多进程协调阶段启用

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 4.3、6.4、15.3

## 决策

MVP 单 Game Server 使用内存 Presence / Driver。Redis 8.2 Extended 作为扩容阶段
的 Presence、Driver、短期缓存和协调组件，不作为资产数据库。

## 理由

第一天引入 Redis 没有收益，反而增加运维和一致性风险。

## 影响

- 本地 compose 中 Redis 位于 `scale` profile，不默认启动。
- 多 Game Server 时再引入，并保留 adapter 边界。
- 不得把 Redis 当作唯一金币或装备存储。
