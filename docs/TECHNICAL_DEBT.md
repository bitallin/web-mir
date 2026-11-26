# Web Legend 技术债务清单

- 日期：2026-11-25
- 范围：MVP 阶段 0–9 全部代码、数据库、内容、测试与交付脚本
- 方法：逐文件阅读 + 本机真实运行 + 开发库不变量查询 + 双栈/独立库对照复现
- 关联：`docs/MVP_ACCEPTANCE_REPORT.md`、`docs/GAMEPLAY_REVIEW.md`、
  `docs/PROJECT_ROADMAP.md`

## 0. 等级定义与汇总

| 等级 | 定义                                                            |
| ---- | --------------------------------------------------------------- |
| P0   | 阻断正常游玩、造成资产丢失/重复、可被普通玩家直接利用的安全漏洞 |
| P1   | 明显影响 MVP 品质或验收可信度，Alpha 开始前应处理               |
| P2   | 已在真实运行中暴露风险，Alpha 0.2 内应处理                      |
| P3   | 可维护性、边界与长期演进问题，按触发条件安排                    |

本轮未发现 P0。P1 共 8 项，P2 共 25 项，P3 共 24 项，合计 57 项。所有 P1/P2 均有代码位置
或可复现操作，未列入“仅凭感觉”的重构建议。

## 0.1 Alpha 0.1 关闭与调整（2026-11-25）

证据与里程碑见 `docs/ALPHA_01_EXECUTION_PLAN.md`、
`docs/phase-reports/alpha-01/ALPHA_01_REPORT.md`、ADR-025。

### 已关闭 P1

| 编号       | 处置                                                                                           | 证据                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TD-OPS-01  | CI e2e job 增加 PostgreSQL service 与连接串                                                    | `.github/workflows/ci.yml`                                                              |
| TD-OPS-02  | E2E 专用数据库、专用端口、建库/删库；不再共享开发库与 outbox                                   | `playwright.config.ts`、`infra/scripts/e2e-database.ts`、`tests/e2e/globalTeardown.ts`  |
| TD-SRV-04  | 管理断开会话直接移除；重连重新校验账号状态；宽限结束不复活已终止会话                           | `apps/game-server/test/admin.integration.test.ts`                                       |
| TD-DATA-04 | 发布/激活前校验玩家持有模板；掉落恢复逐条容错                                                  | `apps/control-api/test/admin.integration.test.ts`、`assetService.loadOpenDrops`         |
| TD-SRV-02  | 战斗事件按 AOI/归属投递；治疗/复活只给本人                                                     | `worldMapRoom.broadcastCombatEvent`、`combat.integration.test.ts`                       |
| TD-CLI-01  | 服务端权威自动攻击状态机、接近与停止；客户端一次锁定                                           | `contracts/combat.ts`、`worldMapRoom.updateAutoAttacks`、`tests/e2e/autoAttack.spec.ts` |
| TD-CLI-02  | 提示改为 4 秒 Toast，移出战斗区并分层                                                          | `useWorldSession.pushNotice`、`styles.css`、`autoAttack.spec.ts`                        |
| TD-SRV-01  | 第一阶段拆分完成：`SessionRegistry`/`CommandGuard`/`StateViewPublisher`；残余职责转 TD-SRV-01b | ADR-025、`apps/game-server/src/rooms/*.ts`                                              |

### 已关闭 P2（本轮顺带处理）

| 编号       | 处置                                             | 证据                                                   |
| ---------- | ------------------------------------------------ | ------------------------------------------------------ |
| TD-DATA-01 | 击杀奖励按装备后属性裁剪并持久化                 | `assetService.grantKillReward`、资产集成测试           |
| TD-DATA-02 | 过期未领取掉落与地面实例清理；已领取行保留 7 天  | `purgeExpiredWorldDrops`、资产集成测试                 |
| TD-DATA-03 | checkpoint 条件加入 `map_id`，旧地图快照不再覆盖 | `characters.integration.test.ts`                       |
| TD-DATA-06 | 资产幂等键加入 `characterId`                     | 资产集成测试“scopes idempotency keys to the character” |
| TD-OPS-08  | 恢复演练先校验 `.sha256`；一致性快照仍延期       | `infra/scripts/db-restore-drill.sh`                    |
| TD-QA-01   | 50×10min 接入 `pnpm load:regression`             | `apps/game-server/package.json`                        |
| TD-QA-02   | 攻击者先接近；输出接受率与拒绝码分布并断言       | `scripts/worldScenario.ts`                             |

### 新增/调整

| 编号       | 内容                                                      | 说明                                      |
| ---------- | --------------------------------------------------------- | ----------------------------------------- |
| TD-SRV-01b | Room 残余编排拆分（传送、资产管线、管理命令、checkpoint） | P2，Alpha 0.2；ADR-025 记录理由           |
| TD-DATA-05 | 装备槽可延迟唯一约束                                      | 仍为 P3/P2 评估项，Alpha 0.2 迁移窗口处理 |
| TD-OPS-08b | 备份与 manifest 同一快照                                  | P2 保留，Beta 运营化处理                  |

## 0.2 Alpha 0.2 切片 1 关闭与调整（2026-11-25）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_SHOP_REPORT.md` 与 ADR-026。

### 已关闭

| 编号      | 处置                                               | 证据                                         |
| --------- | -------------------------------------------------- | -------------------------------------------- |
| TD-CLI-12 | 移除玩家可见的“阶段 6”内部标签                     | `GameScreen.tsx`；商店截图                   |
| （并发）  | 资产命令统一改为先锁角色行、再写幂等命令，消除死锁 | `assetService.ts` 五个命令；并发购买集成测试 |

### 新增并同轮关闭

| 编号     | 内容                                                           | 处置                                                                                                 |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TD-QA-10 | Vitest 多文件共享测试库，Room 实时清理会删除其他文件的掉落夹具 | 资产测试时钟改为从“当前时间 + 24 小时”起算，夹具不再被实时清理命中；共享库的长期隔离仍在 Beta 前评估 |

### 新增（未关闭）

| 编号      | 内容                                   | 等级 | 说明                                                           |
| --------- | -------------------------------------- | ---- | -------------------------------------------------------------- |
| TD-ECO-01 | 商店无买回、出售二次确认与手动数量输入 | P3   | 仅靠“初始武器绑定 + 已装备不可售”兜底；与 S4 背包/图标一起补齐 |

### 保留并影响本版

- TD-SRV-03（资产单队列）：商店买卖与拾取共用队列；切片 1 未拆分，压测需
  观察资产 p95。
- TD-DATA-05（装备槽唯一约束）：商店增加装备流转，最迟在 Alpha 0.2 装备扩展
  前处理。
- TD-OPS-03/04（草稿发布与冲突）：价格通过内容草稿发布，运营误改风险上升；
  当前有 schema 与“收购价必须低于售价”校验兜底。
- TD-OPS-07（经济合理性校验）：商店价格已限制在 0–1,000,000，但缺少按等级
  曲线的软上限；Beta 前补充。

## 0.3 Alpha 0.2 S2 任务 2 复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_SKILLS_REPORT.md` 与 ADR-028。

- 未新增 P0/P1/P2 债务。DoT 与护盾状态仅存于内存，进程崩溃会丢失，与既有
  “战斗/怪物状态仅内存”风险一致；资产与经验仍不在战斗中。
- 技能栏顺序问题（`jsonb` 键序）已修复并沉淀为 EL-018。
- **TD-CLI-06（P2）仍开放**：三职业已有 3 个技能与等级解锁，但外观、攻击/施法/
  受击/死亡动作仍共用占位贴图；这是 S2 剩余的核心交付。
- 护盾数值通过 `combat.profile.shield` 在重连后恢复；客户端没有独立倒计时，
  以服务端 `shield` 事件为准，不作为债务。

## 0.4 Alpha 0.2 S2 任务 3 复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_CLASS_APPEARANCE_REPORT.md` 与
ADR-029。

### 已关闭

| 编号      | 处置                                                        | 证据                                                     |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| TD-CLI-06 | 三职业独立贴图与待机/行走/攻击/施法/受击/死亡片段，事件驱动 | `ALPHA_02_CLASS_APPEARANCE_REPORT.md`、`classes.spec.ts` |

### 新增/调整

| 编号      | 内容                                     | 说明                                           |
| --------- | ---------------------------------------- | ---------------------------------------------- |
| TD-CLI-13 | 角色/怪物/地形仍为程序生成占位美术（P3） | 职业已可区分且有动作帧；正式美术与 S4 一起替换 |

- 新增资源生成脚本后，角色贴图可逐字节复现；不再直接手改 PNG。
- 动画状态机为客户端纯函数，未新增服务端、协议或数据库路径；无容量债务变化。

## 0.5 Alpha 0.2 S3 第一切片复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_MONSTER_THREAT_REPORT.md` 与
ADR-030。

- 未新增 P0/P1/P2 债务。前摇状态与怪物状态一样仅存于内存，进程崩溃后按规则
  重建，与既有“战斗/怪物状态仅内存”风险一致。
- 新增 TD-OPS-18（P3）：地图刷点与内容 Release 的耦合缺少部署预检。本轮重启
  开发栈时旧 Release 因新刷点引用未覆盖的怪物而校验失败，服务器保留基线快照
  并持续报错；发布 `2026.11.26.3` 后恢复。建议在部署/发布脚本中预检。
- 新怪物全部使用现有 AI 参数（远程射程、移速、防御），没有为单个怪物新增
  服务端分支；前摇只对配置了 `windupMs` 的怪物生效。

## 1. 服务端与实时网络

### TD-SRV-01（P1）Room 成为 2178 行的万能类

- 证据：`apps/game-server/src/rooms/worldMapRoom.ts` 2178 行，同时承担票据/租约、
  资产加载、移动、战斗命令、聊天、传送、掉落恢复、checkpoint、管理命令、
  指标与 AOI 视图。
- 影响：违反 AGENTS §5 “不要写超大 MapRoom”的精神；任何玩法扩展都要改同一
  文件，多 Agent 并行会冲突；命令管线重复代码（移动/战斗/资产三套幂等与限频）。
- 建议：先抽 `SessionRegistry`、`CommandGuard`（会话/协议/序号/限频/幂等）、
  `TransferService`、`AssetCommandPipeline`、`ViewSynchronizer`，Room 只保留
  Colyseus 生命周期与装配。必须先补集成测试再拆。
- 工作量：M（3–5 人日），风险中。

### TD-SRV-02（P1）CombatEvent 全 Room 广播

- 证据：`worldMapRoom.ts:979-982` 与 `:1371-1373` 对每条战斗事件
  `this.broadcast`，不经过 AOI。
- 影响：远处玩家收到无关攻击/受击/治疗事件；客户端战斗日志已因此把别人的
  治疗显示成自己的（见 TD-CLI-03）。50 人压测 10 分钟 5,649 条事件尚可，
  多人团战会线性放大。
- 建议：按事件涉及的 source/target 计算可见会话集合；或先按 AOI cell 过滤；
  治疗/复活事件只发给本人。保留击杀/升级等公共事件的全图广播。
- 工作量：M（2–4 人日），需要带宽指标复测。

### TD-SRV-03（P2）资产事务单队列 + 奖励重试阻塞

- 证据：`worldMapRoom.ts:1667-1679` 单个 `assetQueue`；`:1710-1729` 奖励失败
  在队列内 `setTimeout(200/400ms)` 重试。
- 影响：一次数据库抖动会让所有拾取/装备命令排队约 600ms；压测资产事务 p95
  33ms 已包含排队时间。
- 建议：奖励与玩家命令分队列；玩家命令使用有界并发（例如 4）；重试移到队列
  之外或使用数据库退避任务。
- 工作量：M（2–3 人日）。

### TD-SRV-04（P1）封禁可被 15 秒重连宽限期绕过

- 证据：`worldMapRoom.ts:1598` `client.leave(4000)`；`:684` 只有
  `CloseCode.CONSENTED` 才立即移除；`:696` 其余一律进入
  `allowReconnection(15s)`；`:641 onReconnect` 不重新校验账号状态。
- 影响：正常网页客户端在 4000 关闭时会清除重连令牌，但修改过的客户端可在
  15 秒内用 `reconnect(token)` 恢复已被封禁/踢下线的会话，且 outbox 命令已
  标记 applied，不会再次执行。封禁是运营的核心安全手段。
- 建议：为管理断开会话记录 `terminated` 原因；`onLeave` 对管理断开直接
  `removeSession`（或缩短到 0 宽限）；`onReconnect` 重新查询账号状态与
  `muted_until`。补一条集成测试：封禁后携带旧 token 重连必须失败。
- 工作量：S（0.5–1 人日）。

### TD-SRV-05（P2）传送后会话记录可能残留

- 证据：`worldMapRoom.ts:1084-1141` 传送提交后移除 simulation/combat/state，
  但保留 `sessions` 与 `sessionByPlayer`，等待客户端 `onLeave`。
- 影响：若客户端在收到 `session.transfer` 后网络中断且不再连接，旧 Room 内
  会留下无实体的 SessionRecord，直到 Room dispose；期间 `sessionByPlayer`
  会阻止同角色重新加入该 Room（正常情况下角色已不在该地图，影响小）。
- 建议：发送 transfer 后设置短定时器清理；或统一走 `removeSession` 的
  “已提交传送”分支。
- 工作量：S。

### TD-SRV-06（P2）管理命令幂等只在进程内存

- 证据：`apps/game-server/src/admin/commandHub.ts:11-16` 内存 Set，上限 1000；
  outbox 60 秒后重投 stale dispatched 行。
- 影响：进程重启或超过 1000 条命令后，重复投递会再次执行 kick；ban/mute 天然
  幂等，kick 不幂等（会踢掉同名角色重新登录后的新会话）。
- 建议：用 `outbox_events.status/command_id` 或 `admin_command_receipts` 表做
  持久幂等；或让 kick 也带“只踢指定 sessionId”的语义。
- 工作量：M。

### TD-SRV-07（P2）Outbox 不分区服/目标进程

- 证据：`outbox_events` 无 `realm_id`/`game_server_id`；dispatcher 轮询全表；
  本轮实测：开发 Control API（连 87）与隔离 Control API（连 2587）共享同一
  数据库时，E2E 的 kick 行被开发进程抢走并在错误进程执行 `applied=0`，导致
  E2E 失败；独立数据库后 20/20 通过。
- 影响：单区服单 API 时安全；多区服/多 Control API 会把命令投递到错误进程，
  且“applied=0”仍标记成功，运营看到成功但玩家未被处理。
- 建议：Outbox 增加 `realm_id`、`target_server_id`；dispatcher 只领取本进程
  负责的行；`applied=0` 不直接标记 applied（目标离线可单独定义）；多
  dispatcher 使用 PostgreSQL advisory lock 选主。
- 工作量：M。

### TD-SRV-08（P3）硬上限 50 人、无排队提示

- 证据：`worldMapRoom.ts:289` `maxClients = 50`；matchmaking 拒绝为 Colyseus
  默认错误。
- 影响：第 51 人看到通用失败，无排队/换线指引；扩容前体验断崖。
- 建议：Alpha 0.3 做实例路由时统一处理满员错误码与换线入口。
- 工作量：S（随路由一起做）。

### TD-SRV-09（P3）实体无碰撞

- 证据：移动只校验地形，玩家与怪物、玩家与玩家可重叠。
- 影响：点击判定重叠、视觉堆叠；不改变权威位置。
- 建议：软碰撞（同格减速/排开）或客户端选目标优先级；不要引入物理引擎。
- 工作量：S/M。

## 2. 数据、事务与经济

### TD-DATA-01（P2）击杀奖励按基础属性裁剪 HP/MP，忽略装备

- 证据：`packages/game-application/src/assetService.ts:237-251` 用
  `combatStatsFor(class, level)` 的 `base.maxHp/maxMp` 裁剪并写回；内存中的
  `outcome.stats` 却使用装备加成。
- 影响：穿 +最大生命装备的玩家击杀后，数据库 HP/最大 HP 回落到基础值，
  下一次 checkpoint 前崩溃/下线会持久化较低数值；后台玩家详情也读取基础值。
- 建议：事务内读取已装备物品并 `statsWithEquipment`；或不再持久化派生的
  `max_hp/max_mp`，只存当前 HP/MP 与装备。
- 工作量：S/M。

### TD-DATA-02（P2）过期/已领取掉落永不清理

- 证据：`worldMapRoom.ts:1654-1665` 只删内存 LootState；仓储层没有
  `world_drops` 删除路径。2026-11-25 开发库查询：781 条掉落全部过期，其中
  706 条未领取且对应 `item_instances.container='ground'` 永久滞留；审计结束
  时增至 763 条（`docs/phase-reports/audit-2026-11-25/database-invariants.txt`）。
- 影响：每次击杀永久增加 0–2 行；地面物品实例成为“看不见的资产”，表持续
  膨胀；运营无法解释物品总数。
- 建议：维护任务按 `expires_at < now()` 删除未领取掉落及其 item instance；
  已领取行按保留期归档；启动时也可清理。补一条集成测试。
- 工作量：S。

### TD-DATA-03（P2）Checkpoint 只按 id 更新，可能跨地图/跨世代覆盖

- 证据：`packages/persistence/src/repositories/characters.ts:128-145` 只按
  `characterId` 更新 x/y/hp/mp，不校验 `map_id` 或版本；Room 的
  `checkpointAll`（`worldMapRoom.ts:865-901`）与 `beginTransfer`
  （`:1084-1114`）并发时可能后提交旧坐标到新地图。
- 影响：传送后角色可能被旧的 20 秒 checkpoint 写回旧地图坐标；刚使用的
  药水 HP 也可能被旧 checkpoint 覆盖（20 秒内自愈，崩溃则持久化）。
- 建议：`WHERE map_id = expectedMapId` + 版本比较；或所有 checkpoint 走
  角色级串行队列。
- 工作量：S。

### TD-DATA-04（P1）内容发布删除物品模板会让持有者无法进入世界

- 证据：`assetService.ts:131-149, 752` 用 Room 固定 bundle 的 `requireItem`
  解析背包/装备模板；`loadOpenDrops`（`:180-200`）遇到一个未知模板会整体
  失败；`restoreLoot`（`worldMapRoom.ts:1601-1619`）只记录错误。
- 影响：运营在新 Release 删除或改名一个仍被玩家持有的物品，所有持有者加入
  时得到“角色资产加载失败”，且整个地图的未领取掉落都可能不再恢复。这是
  内容运营可以直接造成的登录事故。
- 建议：发布前校验候选 Release 是否覆盖 `item_instances` 中全部 distinct
  template_id；或服务端保留 retired-template 兼容表；`loadOpenDrops` 逐条
  容错并告警。必须补发布/回滚集成测试。
- 工作量：M。

### TD-DATA-05（P3）装备槽唯一性只靠应用层

- 证据：迁移 `0003` 将装备槽唯一索引改为普通索引；`assetService` 依赖角色行
  锁串行化交换。
- 影响：任何绕过 `equip` 的写入（脚本、未来接口、数据修复）都可能产生同槽
  两件装备，属性被重复累加。
- 建议：使用可延迟唯一约束（`DEFERRABLE INITIALLY DEFERRED`）或“先置 NULL
  再写目标槽”的两步交换，恢复数据库约束。
- 工作量：M。

### TD-DATA-06（P3）资产幂等键不含角色

- 证据：`assetService.ts:730` `cmd:${kind}:${commandId}`。
- 影响：两个角色使用同一 commandId 时，第二个命令被当成重复静默丢弃（不会
  刷资产，但会丢命令）。
- 建议：键加入 `characterId`。
- 工作量：S。

### TD-DATA-07（P3）角色数量上限存在并发竞态

- 证据：`apps/control-api/src/services/characters.ts:50-56` 先 count 再 insert。
- 影响：并发创建可超过每账号上限（当前 3）。
- 建议：账号级 advisory lock 或数据库约束。
- 工作量：S。

### TD-DATA-08（P3）删除角色会级联删除金币流水与资产命令

- 证据：迁移 `0002` 中 `currency_ledger`、`asset_commands` 对 characters 为
  `ON DELETE CASCADE`。
- 影响：未来上线角色删除/账号注销时，审计与经济历史丢失。
- 建议：改为 `SET NULL` 并保留匿名快照，或归档表。
- 工作量：S/M。

### TD-DATA-09（P3）内容校验允许“堆叠装备”和不可拾取掉落

- 证据：`content-schema/src/validation.ts:170-179` 未禁止可堆叠装备；
  `:206-208` 对非堆叠物品 `maxQuantity > 1` 只给 warning；`items.ts:128-130`
  拾取时放置失败。
- 影响：装备卸下只能合并堆叠 → `INVENTORY_FULL`；数量超过 maxStack 的掉落
  永远无法拾取，直到过期。
- 建议：把这两条提升为 error；或放置逻辑拆数量多次入包。
- 工作量：S。

### TD-DATA-10（P3）过期租约行不清理

- 证据：开发库 `character_sessions` 有 5 条已过期行；`acquireCharacterLease`
  会覆盖同角色行，但其他过期行保留。
- 影响：表增长缓慢；不影响正确性。
- 建议：维护任务删除过期行。
- 工作量：S。

## 3. 客户端与表现

### TD-CLI-01（P1）没有自动攻击，每次挥砍都要点一次

- 证据：`apps/game-web/src/game/WorldScene.ts:971-1002` 每次 pointerdown 只发
  一条 `basicAttack`；`GameScreen.tsx:160-166` 列表点击同理；服务端按
  `attackIntervalMs` 拒绝提前点击（`combatWorld.ts:484-485`）。
- 影响：玩家必须精确踩 900ms/1200ms 节奏，点快了只看到拒绝提示，点慢了输出
  中断；与传奇类“锁定目标持续攻击”的基本手感不符。本轮手动实测杀一只史莱姆
  点了 12 次，其中多次是冷却/超距拒绝。
- 建议：选中目标后自动按服务端冷却循环攻击；客户端维护“下一次可攻击时间”，
  在 HUD 显示攻击条；保留手动点击作为重新锁定。
- 工作量：S/M（1–2 人日），需服务端保持现有权威冷却。

### TD-CLI-02（P1）拒绝提示永久驻留并遮挡战斗面板

- 证据：`useWorldSession.ts:341-346` 写入 `state.notice`；只有重连等少数路径
  清空（`:584`）；`GameScreen.tsx:889-897` 渲染；`styles.css:299-311`
  `bottom:84px; z-index:2`，覆盖 `.combat-panel`（z-index 1）。
- 影响：在主城误点玩家触发 `SAFE_ZONE` 后，警告横幅会一直盖住技能栏/战斗
  面板直到刷新；目标死亡后的“目标已经死亡”同样常驻（截图
  `docs/phase-reports/audit-2026-11-25/07-inventory.png`）。
- 建议：改为可堆叠 toast，3–5 秒自动消失；同类提示去重；战斗面板与提示分层。
- 工作量：S。

### TD-CLI-03（P2）他人治疗/复活被记成自己的战斗日志

- 证据：`useWorldSession.ts:203-218` 对 `heal`/`respawn` 不校验
  `targetId/entityId === characterId`；服务端战斗事件全 Room 广播
  （TD-SRV-02）。
- 影响：玩家看到“你恢复了 N 点生命/你已复活”，实际是别人的事件。
- 建议：客户端按角色过滤；服务端同时收窄广播。
- 工作量：S。

### TD-CLI-04（P2）传送销毁并重建整个 Phaser.Game，且清空聊天历史

- 证据：`useWorldSession.ts:666-698` 重置 messages/systemMessages/combatLog，
  然后 `game.destroy(true)` + `createWorldGame`。
- 影响：每次过图重建 WebGL 上下文与纹理注册，低端机可能触发上下文回收；
  聊天/战斗记录在过图时全部丢失，不像 MMORPG 频道。
- 建议：只重启 Scene 并复用 Game/纹理；聊天历史按频道保留。
- 工作量：M。

### TD-CLI-05（P2）10Hz React 状态扇出 + 小地图重绘

- 证据：`useWorldSession.ts:291-318` 每个 patch 都 setState 新数组；
  `GameScreen` 全量列表渲染；`Minimap.tsx:20-63` 依赖这些数组重绘 canvas。
- 影响：软件渲染环境实测 25 FPS（`audit-manual` 记录），20Hz patch 下 React
  与 Phaser 争用主线程；50 人时列表更长。尚无 profiler 证据。
- 建议：把高频实体数据改为 ref + 增量订阅；小地图 4–5Hz 节流；列表虚拟化。
- 工作量：M。

### TD-CLI-06（已关闭，2026-11-26）三职业共用同一角色贴图与配色

- 原证据：`WorldScene.ts` 只用 `player_placeholder` 与 characterId 哈希色；
  无攻击动画帧。
- 处置：三套程序生成贴图 + manifest 动画片段 + 客户端状态机；攻击/施法/受击/
  死亡由 `combat.event` 驱动。见 ADR-029 与 S2 任务 3 报告。
- 剩余：正式美术替换属于 TD-CLI-13（S4）。

### TD-CLI-07（P3）无键盘移动、无停止指令

- 证据：`WorldScene.ts:295` 只注册 pointerdown；无 keydown/WASD；无
  “停止”命令。
- 影响：架构 3.1 要求键盘方向作为辅助；误点后只能再点一次纠正。
- 建议：键盘八方向短步进 + 停止键；仍由服务端寻路裁定。
- 工作量：M。

### TD-CLI-08（P3）死亡状态仍发送世界命令

- 证据：`WorldScene.handlePointerDown` 无存活判断。
- 影响：每次点击都收到 `PLAYER_DEAD` 拒绝，叠加 TD-CLI-02 的常驻提示。
- 建议：本地禁用移动/拾取，仅保留聊天。
- 工作量：S。

### TD-CLI-09（P3）窄窗口隐藏聊天

- 证据：`styles.css:666-668` `@media (max-width: 860px) .chat-panel { display:none }`。
- 影响：窄屏失去唯一社交通道；MVP 不要求移动端战斗，但至少应保留聊天入口。
- 建议：折叠为按钮而非消失。
- 工作量：S。

### TD-CLI-10（P3）两处坐标/常量写死

- 证据：`CharacterScreen.tsx:120` 用 `Math.floor(x / 1000)` 而非 `TILE_UNITS`；
  `WorldScene.ts:613-623` 的 `lootScreenPoint` 未加 canvas 偏移。
- 影响：当前布局下不显现；改布局或改 TILE_UNITS 时出错。
- 建议：统一投影/屏幕坐标工具。
- 工作量：S。

### TD-CLI-11（P3）重连遮罩冻结全部输入

- 证据：`GameScreen.tsx:840-866`、`styles.css` 重连层 `pointer-events:auto`。
- 影响：15 秒宽限期内整屏不可交互，场景仍在跑。
- 建议：半透明顶部条 + 保留场景输入（客户端命令会被服务端拒绝）。
- 工作量：S。

### TD-CLI-12（P3）玩家可见“阶段 6”内部标签

- 证据：`GameScreen.tsx:188`。
- 影响：泄露内部研发阶段，破坏产品感。
- 建议：移除或改为版本号。
- 工作量：S。

### TD-CLI-13（P3）角色/怪物/地形仍为程序生成占位美术

- 证据：`content/assets/generated/` 全部为 `procedural-placeholder`；职业已按
  剪影/配色区分并有动作帧（ADR-029），但不是可发布的正式美术。
- 影响：产品观感仍是技术演示；怪物为几何造型，地形只有 8 个 tile。
- 建议：S4 美术切片替换 tileset、三套角色与怪物，保持 manifest 结构与帧命名
  不变；届时删除或重做 `assets:generate` 的占位输出。
- 工作量：L（美术为主）。

## 4. 内容与运营

### TD-OPS-01（P1）CI 的 E2E job 无法启动

- 证据：`.github/workflows/ci.yml:69-94` e2e job 没有 PostgreSQL service、
  没有 `DATABASE_URL`/`CORS_ORIGINS`；`playwright.config.ts:62` 的 webServer
  会执行 `pnpm db:migrate && pnpm db:seed`，缺少连接串必然失败。
- 影响：浏览器门禁在 CI 中从未真正执行；合并请求只跑单测/类型/构建，回归
  依赖人工。阶段报告中的“20/20 E2E”是本地结果，不是 CI 结果。
- 建议：给 e2e job 加 postgres service 与 env（与 verify job 相同），或使用
  `infra/docker/compose.yml` 起库；把 E2E 设为合并门禁。
- 工作量：S（0.5 人日）。

### TD-OPS-02（P1）E2E 与开发栈共享数据库，隔离不完整

- 证据：阶段 9 只隔离了 Vitest 数据库；E2E 仍写开发库。本轮实测：在开发栈
  运行时用“独立端口”启动 E2E，kick 测试稳定失败（18/20），因为开发 Control
  API 与 E2E Control API 共用一个 outbox 表，开发进程抢走命令并投递给没有该
  会话的 87 端口；改用独立数据库后 20/20 通过。
- 影响：只要开发栈在跑，E2E 的运营类用例就会随机失败；测试结果不可复现；
  内容激活也会影响并行用例。
- 建议：E2E 默认使用专用数据库（或整套独立 compose），在
  `playwright.config.ts` 的 webServer 中建库/迁移/清理；文档写明“不要与开发
  栈共享库”。
- 工作量：S/M。

### TD-OPS-03（P2）发布/校验使用已保存草稿，而非编辑器内容

- 证据：`apps/admin-web/src/screens/ContentScreen.tsx:166-191`（publish）与
  `:303-325`（按钮）不读取编辑器 buffer；服务端 `services/content.ts:424-431`
  组装已保存草稿；切换 section 不提示未保存修改。
- 影响：运营改了数值但没点“保存草稿”就发布，线上使用旧值，UI 却显示新值；
  这是最容易造成“发布事故”的交互缺陷。
- 建议：脏标记 + 发布前自动保存/确认；切换 section 提示丢弃；发布页展示
  将要发布的 checksum 与差异。
- 工作量：M。

### TD-OPS-04（P2）草稿全局最后写入获胜，无冲突与历史

- 证据：`packages/persistence/src/repositories/content.ts:36-63` 按 section
  upsert；`services/content.ts:213-236` 审计记录 `before: null`。
- 影响：两个运营同时编辑会互相覆盖且不可恢复；无法回答“谁把数值改坏了”。
- 建议：草稿加 `updated_at/updated_by` 与乐观锁版本；审计写入变更 diff；
  按 Realm/用户分草稿。
- 工作量：M。

### TD-OPS-05（P2）Release 列表上限 100、无分页

- 证据：`apps/control-api/src/services/content.ts:416`；
  `ReleasesScreen.tsx:204-211`。
- 影响：超过 100 个 Release 后无法在后台选择更早版本回滚，违背“可回滚到上一
  版本”的运营承诺（上一版本仍可达，但更早的不行）。
- 建议：服务端分页或“最近 N + 搜索”。
- 工作量：S。

### TD-OPS-06（P2）内容操作隐式绑定第一个活跃区服

- 证据：`services/content.ts:89-95`（`listActiveRealms` 按 code 排序）被
  `state/publish/activate` 使用（`:127,292,365,414`）。
- 影响：多区服时后台可能对 A 区发布/激活，B 区 Game Server 永远看不到，UI
  却显示成功。
- 建议：所有内容接口显式接收 `realmId`，UI 提供区服选择；与 TD-SRV-07 一起做。
- 工作量：M。

### TD-OPS-07（P2）内容数值缺少经济合理性校验

- 证据：`packages/contracts/src/content.ts:151-165` 允许金币/经验 1e9、怪物
  HP 1,000 万、攻击 10 万；`validation.ts` 只校验结构与引用，不校验经济。
- 影响：一次误改就能发布无限金币或不可击杀怪物；只有人工差异预览兜底。
- 建议：按字段增加软上限与告警（例如单怪经验 ≤ 当前曲线 5 倍、金币 ≤ 1000），
  发布页突出异常；不要用硬编码阻断合法活动配置。
- 工作量：M。

### TD-OPS-08（P2）备份 manifest 与 dump 非同一快照，恢复校验不含 SHA-256

- 证据：`infra/scripts/db-backup.sh:29-38` 先 dump 后生成 manifest，无停写/
  快照；`db-restore-drill.sh` 恢复后只比 manifest，不校验 `.sha256`。
- 影响：写入流量下 manifest 可能描述更晚的状态，恢复演练会误报或掩盖损坏；
  SHA-256 目前只是文件存在。
- 建议：使用 `pg_dump --snapshot`/事务一致性导出；manifest 取自同一快照；
  恢复前校验 SHA-256 并在脚本失败。
- 工作量：S。

### TD-OPS-09（P2）回滚 runbook 环境变量不完整

- 证据：`infra/scripts/rollback.sh:30-35` 需要 compose 插值
  `POSTGRES_PASSWORD`/`INTERNAL_ADMIN_TOKEN`/`PUBLIC_ORIGINS`
  （`compose.prod.yml:19,44`），runbook §3.1 只导出 `IMAGE_TAG`。
- 影响：按文档执行回滚会在 compose 解析阶段失败，事故时不可用。
- 建议：runbook 与脚本同时校验并列出必需变量；提供 `.env.prod` 模板。
- 工作量：S。

### TD-OPS-10（P2）静态站点镜像以 root 运行

- 证据：`infra/docker/Dockerfile.game-web:18`、`Dockerfile.admin-web:18` 无
  `USER`；阶段 8 报告称四个镜像均 non-root，与实际不符。
- 影响：nginx master 以 root 运行，违反最小权限；安全审计不通过。
- 建议：`USER nginx`（需调整缓存/pid 路径）并验证容器健康检查。
- 工作量：S。

### TD-OPS-11（P3）提交文件把镜像站写成默认值

- 证据：`infra/docker/compose.prod.yml:16`、`db-backup.sh:10`、
  `db-restore-drill.sh:9` 默认 `docker.m.daocloud.io/...`；AGENTS §12 要求
  官方镜像为默认、镜像站只作覆盖。
- 影响：换到可访问 Docker Hub 的环境仍拉镜像站；供应链来源不透明。
- 建议：默认改回官方镜像，本环境通过 `.env` 覆盖。
- 工作量：S。

### TD-OPS-12（P3）部署脚本不自动迁移/备份

- 证据：`infra/scripts/deploy.sh` 只做 compose up 与健康检查；runbook 将
  `db:migrate` 与备份列为人工步骤。
- 影响：忘记迁移会用新代码打旧 schema；忘记备份会降低回滚能力。
- 建议：部署脚本增加迁移前置与自动备份开关；不可逆迁移需显式确认。
- 工作量：S。

### TD-OPS-13（P3）Outbox 失败告警对 gauge 使用 increase

- 证据：`infra/observability/alerts.yml:71-72` `increase(web_legend_outbox_commands...)`，
  而该指标是 gauge（`apps/control-api/src/metrics.ts:152-161`）。
- 影响：告警可能永不触发或在上报重置时误触发。
- 建议：改为 `web_legend_outbox_commands{status="failed"} > 0` 或持续时长条件。
- 工作量：S。

### TD-OPS-14（P3）后台会话无登录审计、无会话管理、无 MFA

- 证据：`services/adminAuth.ts:36-61`；`persistence/admin.ts:56-101`；
  `admin_sessions` 无清理任务。
- 影响：无法回答“谁在何时登录后台”，无法远程撤销单个会话；8 小时过期后
  只能重新登录。
- 建议：登录/失败登录写审计；会话列表与撤销；后续 OIDC/MFA。
- 工作量：M。

### TD-OPS-15（P3）16KB body 上限限制内容编辑

- 证据：`apps/control-api/src/server.ts:88`。
- 影响：items/lootTables 继续增长后草稿无法保存；当前刚好够用。
- 建议：内容接口单独提高上限（如 256KB）并保持其他接口 16KB。
- 工作量：S。

### TD-OPS-16（P3）审计 requestId 由客户端提供，失败审计尽力而为

- 证据：`server.ts:69-79`；`services/admin.ts:474-492`、
  `services/content.ts:486-504` 忽略审计插入错误。
- 影响：审计 trace 键不可信；数据库故障时“失败操作也有审计”不绝对。
- 建议：服务端生成 requestId；审计失败至少写日志并告警。
- 工作量：S。

### TD-OPS-17（P3）内部管理端点使用单一共享令牌

- 证据：`INTERNAL_ADMIN_TOKEN` 由 Control API 与 Game Server 共享；开发默认值
  固定。
- 影响：生产若误用默认值会暴露内部端点（env schema 已拒绝）；无令牌轮换、
  无来源 IP 限制。
- 建议：生产强制随机值（已有）、限制内网、后续 mTLS 或短期签名。
- 工作量：S/M。

### TD-OPS-18（P3）地图刷点与内容 Release 的部署耦合缺少预检

- 证据：S3 切片在编译地图新增 `alpha_wolf` 等刷点后，开发区服仍激活旧
  Release，`ContentStore` 每 5 秒报 “active content release failed
  validation”；校验把地图刷点与 Release 怪物表对齐（EL-021）。
- 影响：代码侧新增刷点若先于内容发布上线，服务器会退回基线 bundle 并持续
  报错，运营看到的激活版本与运行时不一致；目前只能靠日志发现。
- 建议：部署/发布脚本增加预检——候选 Release 的怪物表必须覆盖当前编译地图
  全部 `monsterId`，并在发布页提示；或让地图刷点也进入内容 Release。
- 工作量：S。

## 5. 测试与流程

### TD-QA-01（P2）容量场景未纳入 CI/定期回归门禁

- 现状：本轮审计已完成 30+10 与 50+10 各 10 分钟实测
  （`docs/phase-reports/audit-2026-11-25/load-30p10a-10min.json`、
  `load-50p10a-10min.json`），DoD 的一次性容量证据已补齐；但容量测试仍是
  人工运行，CI 与发布流程没有门禁。
- 影响：tick、内存、带宽或拒绝率的退化只能靠人工发现；下一次大改后没有自动
  回归。
- 建议：把 10 分钟容量场景接入夜间/发布前检查，保留趋势数据与阈值断言。
- 工作量：S（脚本已有，接入 CI/发布流程）。

### TD-QA-02（P2）压测指标是 Room 生命周期累计值，拒绝率未断言

- 证据：`worldScenario` 读取 `/metrics` 的 Room 快照；30 人运行（10 名攻击者
  是 `LOAD_PLAYERS` 的子集，不是额外的 10 人）`rejectedCommands=11,041`
  （23%），拒绝码为 OUT_OF_RANGE/COOLDOWN/TARGET_DEAD，脚本只断言
  `accepted > 0` 与 tick 目标；阶段 8 报告的“30+10”同样按 30 人理解。
- 影响：数值可解释，但“容量通过”没有对拒绝率/延迟窗口设门禁；指标包含
  压测前的样本（samples=240 滑动窗口）；场景命名容易让读者把 attackers 当成
  额外玩家，高估在线人数。
- 建议：攻击者先移动到目标攻击范围；按窗口记录接受率并断言阈值（例如
  有效命令接受率 ≥ 80%）；输出拒绝码分布。
- 工作量：S/M。

### TD-QA-03（P2）集成测试使用固定 sleep

- 证据：`apps/game-server/test/combat.integration.test.ts:490`、
  `pvp.integration.test.ts:286,374`、`economy.integration.test.ts:215`。
- 影响：违反 AGENTS §8；CI 负载高时抖动。
- 建议：改为轮询可观察条件（事件/状态/数据库行）。
- 工作量：S。

### TD-QA-04（P2）E2E 内容发布与并行用例共享全局状态

- 证据：`tests/e2e/admin.spec.ts:160-247` 激活全局 Release，其他 spec 并行
  创建 Room。
- 影响：其他用例可能使用不同内容；当前只改显示名所以不显现。
- 建议：独立数据库 + 内容用例串行，或按 Realm 隔离。
- 工作量：S（随 TD-OPS-02）。

### TD-QA-05（P2）LAN Origin 用例在 CI 静默跳过

- 证据：`tests/e2e/multiplayer.spec.ts:488-492` 找不到非内网 IPv4 就跳过。
- 影响：CI 环境必然跳过，生产局域网路径没有持续验证。
- 建议：用 `/etc/hosts` 或 `hostname -I` 固定一个非内网地址；或在 CI 明确
  标记 known-skip 并单独任务。
- 工作量：S。

### TD-QA-06（P2）缺少 Game Server 进程重启的 E2E 与“提交中断”测试

- 证据：MVP 计划 §14.3 第 10 条要求进程重启后重新取票恢复；现有
  `drill:recovery` 是脚本级演练，不在 E2E；没有“事务提交后、ACK 前杀进程”
  的用例。
- 影响：崩溃窗口的资产一致性只靠设计与单测推理。
- 建议：E2E 增加杀进程→重启→重连；集成测试注入提交后 ACK 前失败。
- 工作量：M。

### TD-QA-07（P3）内容发布 E2E 有“空通过”分支

- 证据：`tests/e2e/admin.spec.ts:171-174` `expect(gel).toBeDefined()` 后
  `if (gel === undefined) return;`。
- 影响：若模板消失，用例会静默通过而不验证发布。
- 建议：改为断言存在并失败。
- 工作量：S。

### TD-QA-08（P3）无视觉回归/性能预算门禁

- 证据：E2E 只截图，无像素对比；构建无 bundle size/首屏预算。
- 影响：HUD 遮挡、对比度、资源膨胀只能人工发现。
- 建议：关键 HUD 做截图基线；设置 JS/资源体积预算。
- 工作量：M。

### TD-QA-09（P3）E2E 数据清理缺失

- 证据：E2E 每次创建账号/角色/测试 Realm/Release，长期留在开发库。
- 影响：开发库 2,600+ 角色、35 个 Release、9 个测试 Realm；查询与后台列表
  噪声大。
- 建议：E2E 使用独立库并整库销毁；开发库做一次性清理脚本。
- 工作量：S。

## 6. 已验证良好、不建议“重构”的部分

以下不是债务，避免后续为了“更现代”而重写：

- 票据单次消费、角色租约、钱包+账本同事务、物品唯一位置 CHECK、并发拾取
  唯一结算、Outbox `SKIP LOCKED` 与重试、审计/Release append-only 触发器，
  均有真实 PostgreSQL 集成测试。
- 固定 tick 内无数据库/HTTP/文件 IO；资产事务异步队列；tick p95 在 30+10
  负载下 3.6ms。
- `contracts` 单一消息 schema、Zod 校验、限频、命令幂等、服务端权威战斗、
  AOI StateView 与传送后视图清理。
- 模块依赖边界由 ESLint 强制；无 `any`、无 `console.*`、无跨端导入违规。
- 内容 Release 不可变、Room 创建时固定快照、旧 Room 不受激活影响。

## 7. 建议处理顺序（2026-11-25 更新）

1. **已完成 Alpha 0.1**：TD-OPS-01/02、TD-SRV-04、TD-DATA-04、TD-CLI-01/02、
   TD-SRV-01（第一阶段）、TD-QA-01/02，以及 TD-SRV-02、TD-DATA-01/02/03/06、
   TD-OPS-08（部分）。
2. **已完成 Alpha 0.2 S1**：TD-CLI-12、TD-QA-10；资产命令锁顺序死锁已修复。
3. **已完成 Alpha 0.2 S2**：法力回复、9 个技能/等级解锁、DoT/护盾、三职业外观
   与动作已交付（TD-CLI-06 关闭）。TD-DATA-05（装备槽可延迟唯一约束）按计划
   在 S4 装备扩展前处理；TD-SRV-03（资产单队列）与 TD-CLI-05（高频 React 扇出）
   在 S3/S4 前评估。
4. **Alpha 0.2 S3/S4**：怪物/掉落/背包扩展前处理 TD-DATA-09（堆叠装备与
   不可拾取掉落）、TD-DATA-05；HUD 重排时处理 TD-CLI-04/07/08/11。
5. **Alpha 0.3 玩法扩展前**：TD-SRV-06/07、TD-OPS-05/06/07、TD-QA-06、
   TD-OPS-03/04。
6. **Beta 运营化前**：TD-OPS-08/09/10/12/14、TD-QA-08/09。
7. 其余 P3 按触发条件（多区服、角色删除、移动端、内容规模）安排。
