# ADR-019: 阶段 4 战斗领域与怪物运行时

- 状态：Accepted
- 日期：2026-11-24
- 关联：MVP 计划阶段 4、架构文档 4.2 / 8.5 / 9.1 / 9.2、ADR-004、ADR-009、ADR-011、ADR-013

## 背景

阶段 4 需要服务端权威的 PvE 战斗：命中、伤害、暴击、冷却、法力消耗、怪物 AI、
死亡与刷新。阶段 3 的 Room 已只承担连接适配，移动规则在 `game-simulation`。
如果把战斗公式、怪物状态机或技能表写进 Room，会违反 AGENTS 与架构 5.3。

同时 `game-domain` 尚未创建（ADR-013 约定在阶段 3/4 出现真实职责时创建），
`game-simulation` 的依赖被限定为 contracts，不能为了战斗反向依赖领域包。

## 决策

1. **创建 `@web-legend/game-domain`**，只依赖 `contracts`。它承载：
   - 职业战斗属性推导（`combatStatsFor`）；
   - 命中 / 暴击 / 伤害纯函数（`rollAttack`）；
   - 技能与怪物内容目录（固定 ID、schemaVersion、Effect DSL 参数）；
   - `CombatWorld`：无 IO 的内存战斗世界，持有玩家战斗状态、怪物 FSM、
     刷怪与复活计时器。
2. **依赖注入代替反向依赖**：`CombatWorld` 接收 `grid`、`pathfinder`、`rng`、
   `spawns` 与复活点。Room 把 `map-runtime` 的导航格和
   `game-simulation.findPath` 注入进去，因此 game-domain 不依赖
   game-simulation、map-runtime、Colyseus 或数据库。
3. **Room 仍只做适配**：解析/限频/幂等/序列号、调用 `CombatWorld`、把领域事件
   转成协议消息、同步 Colyseus 状态、AOI 过滤与持久 checkpoint。Room 内没有
   伤害公式、技能参数或怪物状态判断。
4. **战斗状态归属**：HP/MP、冷却、怪物 HP 与 FSM 都是内存瞬时状态，由
   `CombatWorld` 唯一持有；Room 只镜像到 `WorldState` 并在 checkpoint 写入
   PostgreSQL。阶段 5 的掉落、经验与升级仍走独立事务用例，不在本阶段实现。
5. **怪物与玩家共用 AOI**：地图刷点创建的怪物注册到现有 `InterestManager`，
   `WorldState.monsters` 使用 `.view()`，远处怪物不下发。怪物跨格时只刷新受影响
   的观察者。
6. **内容目录暂驻 game-domain**：技能/怪物使用稳定 ID 与 `phase4.1` 内容版本，
   Effect DSL 仅实现 `directDamage` 与 `heal` 两种代码 handler。阶段 7 引入
   `content-schema` 与内容 Release 后，参数迁移到版本化内容；handler 仍只能由
   代码发布增加（ADR-011）。
7. **协议增量**：新增 `combat.basicAttack`、`skill.cast`、`combat.event`、
   `combat.profile`；`WorldState` 增加玩家 `level` / `classId` / `alive` 与
   `monsters` 集合。新增消息与可选字段，保持 `PROTOCOL_VERSION = 1`。
8. **玩家死亡策略（MVP）**：HP 归零后停止移动与操作，3 秒后在同一地图的固定
   出生点满 HP/MP 复活，由服务端广播 `combat.event` 的 `respawn`。阶段 5 的
   资产事务不依赖该瞬时状态；阶段 6 再评估回城复活与惩罚。
9. **经验与掉落不在阶段 4**：击杀只产生权威 `death` 事件，不发经验、不发物品、
   不升级；这些属于阶段 5 的击杀奖励事务。客户端因此没有可伪造的经验结果。

## 理由

- 战斗是项目最容易被写进 Room 的规则集合，必须在第一次实现时就把边界钉死。
- 纯 `CombatWorld` + 注入的 RNG/时间推进使同一 seed、同一输入可复现，
  满足阶段 4 的确定性验收。
- 不引入 `game-application`、`content-schema` 或数据库事务，避免跨阶段堆叠；
  这些包仍在阶段 5/7 按真实消费者创建。

## 影响

- `pnpm-workspace` 新增 `packages/game-domain`；ESLint 增加 game-domain 边界。
- `game-server` 依赖 `game-domain`，Room 的 checkpoint 与转移读取
  `CombatWorld` 的 HP/MP。
- `contracts` 新增战斗命令、事件、档案与怪物状态 schema，并有契约测试。
- `content/maps/starter_wilds.tmj` 增加刷点，编译产物重新生成。
- 回归门禁保留阶段 3 的移动、AOI、传送、聊天、租约与 checkpoint 测试。

## 未来调整条件

- 多实例/线路时，`CombatWorld` 仍按 Room 实例创建，不需要改领域接口。
- 引入 PvP 时新增 `combat` 目标类型与安全区规则，不改现有命令语义。
- 阶段 5 击杀奖励以 `CombatWorld` 的 `death` 事件为输入，由
  `game-application` 执行事务，不把资产写回领域。
