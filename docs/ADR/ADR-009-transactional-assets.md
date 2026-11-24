# ADR-009: 关键资产事务化，tick 与 IO 分离

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 10.3、10.4

## 决策

固定 tick 只更新内存模拟。拾取、金币、经验、装备变更通过异步 Application
Service + PostgreSQL 事务执行，提交成功后才向客户端确认。

## 理由

20Hz 循环等待数据库会造成 tick 抖动；未提交就发奖励会产生不可回滚的错误资产。

## 影响

- Simulation step 中禁止 `await` 数据库/HTTP/文件/Redis。
- 命令 ID 幂等，重试不重复发奖。
- 位置和 HP/MP 使用节流 checkpoint；已提交资产不因进程崩溃丢失。
