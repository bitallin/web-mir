# ADR-031：死亡代价与复活点内容化

- 状态：Accepted
- 日期：2026-11-26
- 阶段：Alpha 0.2 S3（切片 2）
- 关联：ADR-021（PvP 无死亡惩罚）、ADR-022（内容发布）、ADR-026（商店资产事务）、
  EL-004（内容 checksum）、EL-012/EL-015（锁顺序）、EL-016（幂等键作用域）、
  TD-DATA-11（待补的经验流水）；`docs/ALPHA_02_EXECUTION_PLAN.md` §4

## 1. 背景

S3 第一切片让野外有了可反应的威胁（远程/重甲/精英、扑击预警），但死亡仍然只
意味着“等待 3 秒后满状态复活”：玩家不会为了成长冒风险，也不会在濒死时做出
撤退或用药的决策。`docs/GAMEPLAY_REVIEW.md` 把“死亡无代价”列为战斗威胁偏低的
核心原因之一。

Alpha 0.2 路线要求：死亡损失少量当前经验、不降级、10 级前保护，复活点与保护
规则内容化（`docs/PROJECT_ROADMAP.md` §3）。

## 2. 问题

1. 经验目前只在击杀奖励事务中增加，没有任何扣减路径；需要一条可审计、幂等、
   不会与击杀奖励并发出错的扣减事务。
2. 经验没有独立流水表，扣减必须可证明“只发生一次”，否则重发死亡事件会重复扣。
3. 惩罚强度与保护阈值必须能由运营调整，且不能改变历史 Release 的 checksum
   （EL-004）。
4. 死亡事件由领域层产生、由 Room 转换成带 `eventId` 的线缆事件；命令产生的
   死亡与 tick 产生的死亡走不同代码路径，需要一个统一出口。
5. PvP 死亡在 MVP 明确“无惩罚”（ADR-021）；新增规则不能悄悄改变 PvP 语义。
6. 复活点目前隐式为编译地图 `spawnPoints[0]`，地图设计者无法在 Tiled 中指定。

## 3. 备选方案

1. **固定数值扣经验。** 简单，但对高等级玩家无感、对低等级玩家过重，且无法
   随等级曲线调整。
2. **按累计经验百分比扣、允许降级。** 更接近老式传奇，但会让升级进度倒退，
   在当前浅曲线（`30 × 等级`）下挫折感过强，也与“不降级”的版本验收不符。
3. **扣金币或掉装备。** 金币已有商店消耗端，重复惩罚；爆装在 MVP 明确排除。
4. **在 Room 内存里扣经验并异步写库。** 违反权威事实来源；崩溃或重试会丢账。
5. **新增内容 section `rules` + 事务内扣当前等级进度（采纳）。** 规则内容化、
   不降级、幂等、与击杀奖励共用资产队列与锁顺序。
6. **复活点继续用 `spawnPoints[0]`（不采纳）。** 零改动，但“复活点”仍是代码
   约定；Tiled 设计者无法表达意图，后续多复活点/城镇回城也没有落点。

## 4. 决策

### 4.1 适用范围

- **只有被怪物击败（PvE）才扣经验。** 被玩家击败（PvP）保持无惩罚（ADR-021）。
- 死因判定在 Room：`killerId` 属于房间玩家 → PvP；属于怪物 → PvE；无击杀者
  （未来环境伤害）不扣。
- 掉落物、金币、装备不受影响；不做爆装、红名或罪恶值。

### 4.2 扣减公式

内容规则：

```json
{
  "deathPenalty": {
    "xpLossPermille": 100,
    "protectBelowLevel": 10
  }
}
```

- `xpLossPermille`：按**当前等级内的经验进度**扣除的千分比；100 = 10%。
  0 表示关闭死亡代价。
- `protectBelowLevel`：等级低于该值的角色死亡不扣经验。
- `lost = floor(exp × xpLossPermille / 1000)`；`exp` 是当前等级内进度，
  最多扣到 0，**等级永不下降**；满级（`exp` 恒为 0）不会被扣。
- 规则缺失（历史 Release、或运营删掉 section）→ 不扣经验，行为与升级前一致。

默认值（基线内容与 `2026.11.26.4`）：10% 当前等级进度，10 级前保护。按现有
曲线，10 级死亡最多损失约 1–2 只普通怪的经验。

### 4.3 内容模型

- 新增 `rules` section（首个非实体 section）：`{ deathPenalty?: {...} }`。
- `contentBundleSchema.rules` 为**可选**，历史 payload 解析后不会补默认值，
  checksum 不变（EL-004）。
- `content_drafts.section` 的 PostgreSQL 枚举增加 `rules`（迁移 `0006`，
  expand-only）；运营可在内容工作台以 JSON 编辑并发布。
- 内容校验：`xpLossPermille` 0–1000、`protectBelowLevel` 1–100 由 schema
  拒绝越界；校验器对“无新手保护”“关闭死亡代价”“超过 30% 的严厉配置”给出
  warning，不阻断发布。

### 4.4 事务与幂等

`AssetService.applyDeathPenalty({ characterId, deathId })`：

1. 读取 Room 固定内容快照中的规则；缺失则直接返回（不写任何行）。
2. 单事务内**先锁角色行**（`FOR UPDATE`），再写 `asset_commands`
   （`kind='death_penalty'`，`idempotencyKey='death:<deathId>'`）；
   与击杀奖励使用同一锁顺序（EL-012/EL-015）。
3. 幂等行冲突 → 返回 `null`，不重复扣。
4. 按公式更新 `characters.exp`（与 `version + 1`），不改 `level/hp/mp`。
5. 同事务重新计算资产快照返回；提交后 Room 才向玩家确认。

`deathId` 是 `combat.event` 的 `eventId`。Room 在记录战斗结果前先把领域事件
转换成线缆事件，因此 tick 死亡与命令死亡共用同一个死亡 ID 锚点。

### 4.5 服务端与客户端

- 每次 PvE 死亡入队一次扣减任务（与击杀奖励同一条串行资产队列），失败重试
  3 次（200ms 退避），最终失败计入资产失败指标并记录日志。
- 提交后：
  - `xpLost > 0`：更新会话资产快照、发送 `character.progress`，并向该玩家
    单独发送 `system.notice`（warning，Toast）说明损失数量；
  - 受保护：发送 `system.notice`（info，仅系统日志）“新手保护：本次死亡没有
    损失经验”；
  - 玩家已断线：数据库已是权威，重连时读取。
- `combat.profile` 增加可选 `deathPenalty`，客户端据此在角色面板显示
  “-10% 经验 · 10 级前保护”，不自行计算扣减。缺少该字段的 Release 显示“无”。
- 客户端不做任何经验扣减或免伤判断。

### 4.6 复活点内容化

- 编译地图 manifest 增加可选 `respawnPoint`。
- Tiled `spawn_points` 图层中，设计者把某个点标记布尔属性 `respawn: true`；
  编译器至多接受一个标记，多个 → `MapCompileError`；未标记 → 回退到第一个
  出生点（兼容历史地图）。
- `playerRespawnPointOf(manifest)` 供 Room/领域使用；旧编译产物无该字段时
  行为不变。
- 两张正式地图都显式标记了传送门旁的出生点为复活点（与既有位置一致）。

## 5. 理由

- 按“当前等级内进度”扣减且不降级，既让死亡有代价，又不会抹掉升级成果；
  惩罚随等级进度自然缩放，低经验时几乎无感，符合“少量”目标。
- PvE-only 保持 ADR-021 的 PvP 契约不变，避免野外互杀成为恶意惩罚工具。
- 扣减进入资产事务 + 行锁 + 幂等行，符合“资产事务化 + 幂等”的不可违反原则；
  经验虽然还没有独立流水（TD-DATA-11），但同一死亡 ID 只会写一行。
- 规则放在内容 Release，运营可调，且可选 section 不改变历史 checksum。
- 复活点显式编译进不可变地图，服务端不读客户端或可变配置。

## 6. 影响范围

- `contracts`：`rules` section 与规则 schema；`combat.profile.deathPenalty`；
  编译地图可选 `respawnPoint` 与 `playerRespawnPointOf`。
- `content-schema`：基线规则、校验与 warning；`rules` 参与 compose/diff。
- `persistence`：迁移 `0006` 为 `content_section` 枚举增加 `rules`（仅 expand）。
- `game-domain`：`applyDeathPenalty` 纯函数。
- `game-application`：`AssetService.applyDeathPenalty` 事务与幂等。
- `game-server`：死亡结果统一使用线缆事件；PvE 死亡入队扣减；私有提示；
  profile 携带规则；复活点来自编译地图。
- `admin-web`：内容工作台自动出现“全局规则”section（JSON 编辑）。
- `content/maps`：两张地图显式复活点，重新编译。
- 运维：新 Release `2026.11.26.4`（checksum `7f6c6914…`）。

## 7. 未包含与后续

- 经验变更仍没有连续流水（只记录幂等命令行）；新增 `TD-DATA-11`，Beta 前评估
  统一经验流水。
- PvP 死亡、环境伤害、爆装、红名、罪恶值不在本切片。
- 死亡时 Buff/DoT 清理沿用现有领域逻辑；不做“死亡掉落尸体/找回”。
- 客户端不做死亡前“预计损失”提示；规则由角色面板与死亡后的私有提示表达。
- 复活点跨图（回主城复活）不在本切片；当前仍在本地图复活点复活。

## 8. 未来调整条件

- 若需要“按等级段设置不同比例”，把 `deathPenalty` 从单值扩展为区间表，
  仍由领域纯函数计算。
- 若 PvP 需要惩罚（红名/爆装），必须另写 ADR 并更新 ADR-021，而不是复用
  本条规则。
- 若经验需要审计或找回，先建经验流水表，再让击杀奖励与死亡扣减共同写入。
