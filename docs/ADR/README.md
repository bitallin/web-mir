# Architecture Decision Records

架构决策记录（ADR）用于记录重要技术选择、替代方案和调整条件。任何 Agent 不得
默默改变架构；先新增或更新 ADR，再修改实现和基线文档。

| ADR                                                                            | 决策                                     | 状态                  |
| ------------------------------------------------------------------------------ | ---------------------------------------- | --------------------- |
| [ADR-001](ADR-001-web-first-phaser.md)                                         | Web-first 2D / 伪等距，Phaser 4          | Accepted              |
| [ADR-002](ADR-002-react-hud.md)                                                | React DOM UI + Phaser Canvas             | Accepted              |
| [ADR-003](ADR-003-room-per-map-instance.md)                                    | 一个地图实例一个 Colyseus Room           | Accepted              |
| [ADR-004](ADR-004-server-authoritative.md)                                     | 服务端权威模拟                           | Accepted              |
| [ADR-005](ADR-005-postgres-source-of-truth.md)                                 | PostgreSQL 为持久事实来源                | Accepted              |
| [ADR-006](ADR-006-redis-scale-phase.md)                                        | Redis 仅在多进程协调阶段启用             | Accepted              |
| [ADR-007](ADR-007-modular-monolith.md)                                         | 模块化单体，不先做微服务                 | Accepted              |
| [ADR-008](ADR-008-fixed-room-content.md)                                       | 固定 Room 内容版本，不原地热改地图       | Accepted              |
| [ADR-009](ADR-009-transactional-assets.md)                                     | 关键资产事务化，tick 与 IO 分离          | Accepted              |
| [ADR-010](ADR-010-no-event-sourcing.md)                                        | 不做完整 Event Sourcing                  | Accepted              |
| [ADR-011](ADR-011-effect-dsl-whitelist.md)                                     | 后台 Effect DSL 白名单，不执行任意脚本   | Accepted              |
| [ADR-012](ADR-012-ai-ops-deferred.md)                                          | AI Ops 后置，先只读                      | Accepted              |
| [ADR-013](ADR-013-package-realization.md)                                      | 按真实消费者创建包，不预建空壳           | Accepted              |
| [ADR-014](ADR-014-toolchain-pinning.md)                                        | Node 26 / TypeScript 5.9.3 / 精确依赖    | Accepted              |
| [ADR-015](ADR-015-developer-identity.md)                                       | 阶段 1 临时开发身份与重连凭据            | Superseded by ADR-017 |
| [ADR-016](ADR-016-phase1-movement-model.md)                                    | 阶段 1 权威移动模型与技术测试地图        | Accepted              |
| [ADR-017](ADR-017-accounts-sessions-game-tickets.md)                           | 账号会话、一次性游戏票据与角色租约       | Accepted              |
| [ADR-018](ADR-018-phase3-map-runtime-aoi-transfer.md)                          | 阶段 3 地图运行时、AOI 与传送            | Accepted              |
| [ADR-019](ADR-019-phase4-combat-domain.md)                                     | 阶段 4 战斗领域与怪物运行时              | Accepted              |
| [ADR-020](ADR-020-phase5-asset-economy.md)                                     | 阶段 5 资产模型与事务化经济              | Accepted              |
| [ADR-021](ADR-021-phase6-pvp-safe-zone-chat.md)                                | 阶段 6 服务端 PvP、安全区与聊天治理      | Accepted              |
| [ADR-022](ADR-022-phase7-admin-console-outbox-content-releases.md)             | 阶段 7 运营后台、Outbox 与内容发布       | Accepted              |
| [ADR-023](ADR-023-phase8-production-observability-recovery.md)                 | 阶段 8 生产部署、可观测性与恢复演练      | Accepted              |
| [ADR-024](ADR-024-phase9-test-isolation-network-observability.md)              | 测试数据隔离与 WebSocket 连接指标        | Accepted              |
| [ADR-025](ADR-025-alpha01-auto-attack-event-routing-and-room-decomposition.md) | Alpha 0.1 自动攻击、事件路由与 Room 拆分 | Accepted              |
| [ADR-026](ADR-026-town-merchant-and-gold-sink.md)                              | 主城杂货商、物品价格内容化与金币消耗端   | Accepted              |
| [ADR-027](ADR-027-server-authoritative-mana-regeneration.md)                   | 服务端权威、内容驱动的法力回复           | Accepted              |
| [ADR-028](ADR-028-damage-over-time-and-shield-effects.md)                      | 持续伤害与护盾效果、技能解锁顺序         | Accepted              |
| [ADR-029](ADR-029-character-animation-clips.md)                                | 角色外观与动画片段由资源 manifest 描述   | Accepted              |
| [ADR-030](ADR-030-monster-windup-and-telegraph.md)                             | 怪物攻击前摇与扑击预警                   | Accepted              |
| [ADR-031](ADR-031-death-cost-and-respawn-content.md)                           | 死亡代价、新手保护与复活点内容化         | Accepted              |
| [ADR-032](ADR-032-equipment-tiers-quality-and-comparison.md)                   | 装备成长线、稀有品质与背包对比           | Accepted              |
| [ADR-033](ADR-033-item-icon-atlas-and-quality-presentation.md)                 | 物品图标由资源 manifest 提供             | Accepted              |
| [ADR-034](ADR-034-content-driven-quest-chain.md)                               | 内容驱动任务链、事务进度与交付           | Accepted              |
| [ADR-035](ADR-035-party-membership-and-shared-kill-experience.md)              | 队伍成员、共享击杀经验与掉落归属         | Accepted              |
| [ADR-036](ADR-036-process-wide-party-service.md)                               | 队伍提升为进程级服务，过图保留           | Accepted              |
| [ADR-037](ADR-037-world-boss-and-enrage-phase.md)                              | 世界首领、二阶段狂暴与地图公告           | Accepted              |
| [ADR-038](ADR-038-daily-repeatable-quests.md)                                  | 内容驱动的每日任务与周期键               | Accepted              |
| [ADR-039](ADR-039-one-click-quest-guidance.md)                                 | 一键任务导航、自动战斗与自动返回         | Accepted              |
| [ADR-040](ADR-040-collect-quest-objectives.md)                                 | 收集类任务目标、背包进度与交物交付       | Accepted              |

模板：[ADR-000-template.md](ADR-000-template.md)
