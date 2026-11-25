# ADR-025：Alpha 0.1 自动攻击、战斗事件路由、E2E 隔离与 Room 第一阶段拆分

- 状态：Accepted
- 日期：2026-11-25
- 阶段：Alpha 0.1
- 关联：ADR-003、ADR-004、ADR-018、ADR-019、ADR-021、ADR-024；
  `docs/TECHNICAL_DEBT.md`（TD-CLI-01、TD-CLI-02、TD-SRV-01、TD-SRV-02、
  TD-SRV-04、TD-DATA-01/02/03/04/06、TD-OPS-01/02、TD-QA-01/02）

## 1. 背景

MVP 审计确认 8 项 P1 与两个会直接影响 Alpha 0.2 的体验问题：

1. 每次普通攻击都要客户端点击一次，服务端冷却成为“拒绝提示生成器”；
2. 战斗事件全 Room 广播，不按 AOI，也不区分事件归属，远处玩家的治疗会被
   记到本地玩家日志；
3. 封禁/踢下线仍进入 15 秒重连宽限，修改过的客户端可用旧 token 恢复会话；
4. 内容发布删除玩家仍持有的物品模板会导致该角色无法进入世界；
5. 击杀奖励按基础职业属性裁剪 HP/MP，忽略装备加成；
6. 过期地面掉落永不清理；
7. CI 的 E2E job 无 PostgreSQL，E2E 与开发栈共享数据库与 outbox；
8. `WorldMapRoom` 2,178 行，承担票据、租约、移动、战斗、聊天、掉落、
   传送、checkpoint、管理命令、指标与 AOI。

## 2. 决策

### 2.1 自动攻击由服务端状态机执行

- 协议新增客户端意图：`combat.engage`、`combat.autoAttack.start`、
  `combat.autoAttack.stop`；服务端新增 `combat.target.changed`。
- 所有命令沿用现有 `CommandGuard` 的会话、协议、序号、限频与幂等窗口；
  重复 `commandId` 只重发当前权威状态，不重复启动或停止。
- `SessionRecord.autoAttack` 保存目标、阶段、下一次可攻击与重寻路时间。
  Room 在固定 tick 中推进：目标有效 → 距离不足则寻路接近 → 进入射程后调用
  既有 `CombatWorld.basicAttack`；冷却、伤害、命中、暴击仍由领域层裁定。
- 停止条件：目标死亡/消失/离开 AOI、玩家死亡、断线、传送、安全区、手动
  移动、无法到达。客户端只显示服务端给出的攻击进度。
- 自动攻击不发送逐次 `combat.basicAttack`，不产生 COOLDOWN 拒绝提示；它不会
  绕过冷却，因为每次仍走 `CombatWorld` 的同一权威入口。

### 2.2 战斗事件按 AOI 与归属投递

新增 `WorldMapRoom.broadcastCombatEvent`：

- `attack` / `hit` / `miss` / `death`（怪物）：只发给 AOI 内能看到 source 或
  target 的会话；
- `death`（玩家）：同上，另含 killer；公共死亡公告仍走
  `broadcastSystemNotice`；
- `heal`：只发给施法者与目标本人；
- `respawn`：只发给该玩家本人；
- `spawn`（怪物刷新）：只发给能看到该怪物的会话。

客户端同时按 `characterId` 过滤 heal/respawn 日志，形成双重保护。

### 2.3 封禁与重连

- 管理断开在 `SessionRecord.terminated` 标记 `kicked` / `banned`；`onLeave`
  直接移除会话，不进入宽限期。
- `onReconnect` 重新查询 `accounts.status` 与 `muted_until`；账号非 active 时
  拒绝重连（失败关闭）。宽限期结束后，若会话已被标记终止或已移除，不再复活。
- 集成测试覆盖“封禁命令后旧 token 重连失败”和“宽限期内账号被封禁后重连被拒”。

### 2.4 内容发布与资产安全

- 发布与激活前查询 `item_instances` 的 distinct `template_id`；候选 bundle
  未覆盖任一仍被持有的模板时阻断，并列出受影响角色/实例数。激活是同一事故的
  第二扇门，因此同样校验。
- `loadOpenDrops` 对未知模板逐条跳过并告警，不再让一条坏数据阻止整张地图恢复。
- 击杀奖励事务内读取已装备物品，按 `statsWithEquipment` 计算并持久化
  `max_hp/max_mp`。
- 过期未领取掉落按 `expires_at` 清理并为地面 item instance 级联删除；已领取行
  保留 7 天后归档。Room 创建时与每 30 秒异步执行；Game Server 启动时再做一次
  有界批量清理，避免一张没有玩家的地图永远不触发 Room 定时器。
- checkpoint 更新条件加入 `map_id`，旧的跨地图快照不能覆盖新地图位置。
- 资产幂等键加入 `characterId`，不同角色偶然复用同一 `commandId` 不会互相丢弃。

### 2.5 E2E 使用独立数据库与独立端口

- `playwright.config.ts` 使用 `E2E_DATABASE_URL`（默认由 `DATABASE_URL`
  派生 `web_legend_e2e`），端口默认 5184/5185/3086/2587，显式覆盖才改变；
  不再复用开发栈端口或开发库。
- Control API 的 webServer 命令先执行 `infra/scripts/e2e-database.ts prepare`
  （删库重建 + 迁移），再 seed 和启动；`globalTeardown` 在测试结束后删库。
- CI 的 e2e job 增加 PostgreSQL 18 service、`DATABASE_URL` 与
  `E2E_DATABASE_URL`，真实执行浏览器测试。
- 这样 E2E 的 outbox、内容激活、账号与角色不进入开发库，也不会被开发 Control
  API 抢走管理命令。

### 2.6 WorldMapRoom 第一阶段拆分与延期边界

已抽出（行为等价，现有集成测试全通过）：

- `SessionRegistry`：session id / character id 双索引与增删；
- `CommandGuard`：transfer、协议、重复 id、序号、限频顺序与幂等窗口；
- `StateViewPublisher`：AOI 可见性 diff 与 Colyseus StateView 写入。

Room 保留：连接生命周期、票据/租约装配、固定 tick 编排、传送、checkpoint、
掉落视图、管理命令适配与指标。

**延期项（明确不把 P1 静默标记完成）**：进一步抽出
`TransferService`、`AssetCommandPipeline`、`AdminCommandApplier` 与
`CheckpointService` 属于结构优化，不改变协议、领域计算与事务边界。Alpha 0.1
结束后 Room 仍约 2,500 行（新增自动攻击、事件路由与掉落清理带来净增长），但
重复命令守卫、会话索引与视图同步已不再散落。延期理由：Alpha 0.2 的三职业、
技能与商店会改动同一编排路径；在没有新用例层接口前拆成更多类只会增加跳转，
且当前没有第二个消费者。该残余记为 TD-SRV-01b（P2，Alpha 0.2 内处理）。

## 3. 后果

- 自动攻击把客户端从“每次挥砍一条消息”变为“一次锁定”，同时保持服务端权威
  冷却、射程、安全区与目标有效性裁定。
- 战斗事件带宽随 AOI 而非房间人数增长；治疗/复活不再串台。
- E2E 可并行于开发栈运行，CI 浏览器门禁成为真实门禁。
- 内容删除保护把“运营可造成的登录事故”前移到发布阶段。
- 掉落与 checkpoint 的维护任务消除了长期数据膨胀与跨图覆盖。
- 自动攻击的“接近”使用现有 BFS 与 tick 移动，不引入物理或客户端寻路。
- Room 仍是编排中心；后续新玩法应优先扩展 `game-domain`/`game-application`
  并用参数注入 Room，而不是继续向 Room 添加规则。
