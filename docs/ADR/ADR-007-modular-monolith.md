# ADR-007: 模块化单体，不先做微服务

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 0.3、4、5

## 决策

共享 Monorepo 和领域模型，后端保留 `control-api` 与 `game-server` 两个进程边界；
不引入 Kafka、Kubernetes、Service Mesh 和独立微服务。

## 理由

先以真实负载证明瓶颈；清晰模块边界比分布式部署更早带来收益。

## 影响

- 依赖方向由 ESLint 强制。
- Outbox dispatcher 可以先在 control-api 内运行。
- 扩容按实测指标逐步进行。
