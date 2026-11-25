# Alpha 0.1 阶段报告：可信度、战斗体验与架构质量加固

- 日期：2026-11-25
- 范围：里程碑 A–E
- 基线：MVP 阶段 0–9 + 全面审计
- 执行计划：`docs/ALPHA_01_EXECUTION_PLAN.md`
- 架构决策：`docs/ADR/ADR-025-alpha01-auto-attack-event-routing-and-room-decomposition.md`
- 证据目录：`docs/phase-reports/alpha-01/`

## 1. 结论

Alpha 0.1 的工程目标已完成：8 项 P1 全部有代码与测试证据；E2E 使用独立数据库
与独立端口；自动攻击、Toast、封禁重连、内容模板保护、击杀奖励装备属性、掉落
清理、checkpoint 地图约束与资产幂等键均已落地；`WorldMapRoom` 完成第一阶段
拆分；345 个单元/集成测试与 21 个浏览器 E2E 全绿；50 人 10 分钟容量回归与
SIGTERM/SIGKILL 恢复演练通过，资产不变量为 0 违例。

两项限制必须明确：

1. 本环境不能向 GitHub 推送，CI 的远端执行未实际发生；工作流已补齐
   PostgreSQL service、连接串与 E2E 隔离配置，本地以同等流程执行 21/21。
2. 50 人 10 分钟压测 tick p95 为 **10.25ms**，比路线图的 10ms 目标高 0.25ms
   （p99 16.08ms，max 17.57ms，均低于脚本 40/25ms 上限）。不接受为“完全达标”；
   见 §6 的分析与 Alpha 0.2 建议。

## 2. 里程碑 A：CI 与测试可靠性

- `.github/workflows/ci.yml` 的 e2e job 增加 PostgreSQL 18 service、
  `DATABASE_URL`、`E2E_DATABASE_URL`，超时提高到 30 分钟。
- `playwright.config.ts`：
  - 默认数据库 `web_legend_e2e`（`E2E_DATABASE_URL` 可覆盖），不再读写开发库；
  - 默认端口 5184/5185/3086/2587，显式 `E2E_*` 才改变；
  - 每个 webServer 收到同一套 DB/端口环境，避免进程间分裂；
  - `reuseExistingServer` 默认关闭，杜绝误连开发栈。
- `infra/scripts/e2e-database.ts`：删库重建 + 现有 Drizzle 迁移；
  Control API webServer 启动前执行，`tests/e2e/globalTeardown.ts` 结束后删库。
- 结果：本地隔离 E2E **21/21 通过**（2.4 分钟），开发库 outbox 不再被抢。

## 3. 里程碑 B：服务端安全和数据正确性

1. **封禁重连（TD-SRV-04）**：管理断开会话标记 `terminated`，`onLeave` 直接
   移除；`onReconnect` 重新查询账号状态与禁言；宽限期结束后不复活已终止会话。
   集成测试：封禁后旧 token 重连失败；宽限期内账号被封禁后重连被拒。
2. **内容模板保护（TD-DATA-04）**：发布与激活前查询 `item_instances` 的
   distinct 模板；缺失则 422 并列出受影响角色/实例。`loadOpenDrops` 逐条容错。
   集成测试覆盖“删除被持有模板的发布被阻断”。
3. **战斗事件 AOI/归属（TD-SRV-02）**：`broadcastCombatEvent` 按 source/target
   可见性投递；heal/respawn 只给本人。集成测试覆盖远处玩家收不到、AOI 内可见、
   旁听者收不到治疗；客户端日志同时按 `characterId` 过滤。
4. **击杀奖励装备属性（TD-DATA-01）**：事务内读取已装备物品，按
   `statsWithEquipment` 持久化 `max_hp/max_mp`。集成测试断言皮甲 +15 后击杀仍
   保持装备后上限。
5. **过期掉落清理（TD-DATA-02）**：未领取过期掉落与地面实例一并删除，已领取
   行保留 7 天；Room 创建时、每 30 秒以及 Game Server 启动时执行（单次上限
   500，启动时有界批量），避免空闲地图不触发清理。集成测试断言 ground 实例
   与 drop 行被删除、已领取物品仍在背包。
6. **checkpoint 地图约束（TD-DATA-03）**：更新条件加入 `map_id`；旧地图快照
   不能覆盖传送后的角色。持久化集成测试锁定。
7. **资产幂等键（TD-DATA-06）**：加入 `characterId`，不同角色复用 commandId
   不会互相丢弃。集成测试锁定。
8. **恢复 SHA-256（TD-OPS-08 部分）**：恢复演练先校验 `.sha256`；manifest 与
   dump 同一快照仍延期。

## 4. 里程碑 C：自动攻击与战斗体验

- 协议：`combat.engage`、`combat.autoAttack.start`、`combat.autoAttack.stop`
  （Client→Server）与 `combat.target.changed`（Server→Client）。
- 服务端 `SessionRecord.autoAttack` 状态机在固定 tick 中：
  - 校验目标存在、存活、可见、安全区与玩家状态；
  - 距离不足时用现有 BFS 接近并每 350ms 重寻路；
  - 进入射程后调用 `CombatWorld.basicAttack`，冷却/伤害/暴击仍由领域层裁定；
  - 目标死亡/消失/离开 AOI、玩家死亡、断线、传送、手动移动、无法到达时停止；
  - 全部意图复用 `CommandGuard` 的协议/序号/限频/幂等。
- 客户端：点击怪物一次即锁定；攻击条读取服务端 `nextAttackAt`；目标面板显示
  “停止攻击”；Esc 停止；点击地面取消自动攻击。
- Toast：拒绝与系统警告进入 4 秒自动消失的队列，同类 1.5 秒去重，最多 3 条，
  置于右上角；战斗面板 z-index 3、聊天 2、Toast 5。
- 证据：`tests/e2e/autoAttack.spec.ts` 一次点击击杀、Toast 不遮挡战斗面板并在
  8 秒内消失、停止按钮恢复；集成测试覆盖接近后多段攻击、目标死亡停止、两名
  玩家同时自动攻击互不串目标。

## 5. 里程碑 D：WorldMapRoom 结构整理

- 新增：
  - `apps/game-server/src/rooms/sessionRegistry.ts`（双索引、增删、按角色查找）；
  - `apps/game-server/src/rooms/commandGuard.ts`（transfer/协议/重复/序号/限频/
    幂等窗口统一门禁）；
  - `apps/game-server/src/rooms/stateViewPublisher.ts`（AOI 可见性 diff 与
    StateView 写入）。
- Room 现在约 2,500 行；新增自动攻击、事件路由、掉落清理带来净增长，但四套命令
  管线的重复守卫、会话索引和视图同步已移出。
- 行为等价由现有 move/combat/asset/chat/transfer/reconnect 集成测试与 21 个 E2E
  锁定；未修改协议、领域计算、事务或错误码顺序。
- 残余 `TransferService`、`AssetCommandPipeline`、`AdminCommandApplier`、
  `CheckpointService` 明确列为 TD-SRV-01b（P2，Alpha 0.2），理由与边界见 ADR-025。

## 6. 里程碑 E：回归与验收

### 6.1 质量门禁

| 检查         | 结果                                |
| ------------ | ----------------------------------- |
| format:check | 通过                                |
| lint         | 通过（0 error / 0 warning）         |
| typecheck    | 通过（根 + 15 workspace）           |
| test         | 63 文件、345 测试通过（22.9s）      |
| build        | 4 个应用成功                        |
| E2E          | 21/21 通过（2.4 分钟，独立库/端口） |

### 6.2 50 人 × 10 分钟容量

`pnpm load:regression`（50 玩家，10 名攻击者，600 秒）：

- 加入 50/50，接受 69,387，拒绝 649，接受率 **99.1%**；
- 拒绝码：COOLDOWN 247、TARGET_DEAD 399、OUT_OF_RANGE 3（攻击者已先接近）；
- tick p50 **1.98ms** / p95 **10.25ms** / p99 **16.08ms** / max **17.57ms**；
- 资产事务 p95 52.16ms；746 击杀；**0 资产失败**；重连率 0%；
- 出站 450.98MB、入站 8.79MB、patch 262.58MB；
- 内存：前 3 分钟为堆扩展期（190→310MB），稳态 165s 的 310MB 到 585s 的
  289MB（-7%），随后 GC 回落，无持续增长；不以首尾 15s 作比较。

**判定**：容量与资产目标达成；tick p95 比 10ms 高 2.5%。分析：本次攻击者改为
真实接近，击杀 746（审计基线 317），地面掉落密度约为基线的 2.3 倍；Room 的
AOI 视图 diff、掉落状态与 patch 分配带来的 GC 是主要嫌疑。脚本仍按 25ms/40ms
硬上限断言，接受率按 70% 断言。建议 Alpha 0.2 首项性能任务：降低 loot 视图
churn 或对掉落做分桶/过期更短，并将 p95 目标重新校准（当前证据见
`load-50p10a-10min.json`）。

### 6.3 恢复与不变量

- `pnpm drill:recovery`：SIGTERM 与 SIGKILL 均通过；重连位置=持久化位置，
  物品 2→2，租约释放/过期符合预期（`recovery-drill.json`/`.log`）。
- `pnpm verify:invariants`：钱包/账本差异 0、负余额 0、重复装备/背包槽 0、
  ground 无掉落行 0、已领取仍在 ground 0、超过 2 分钟未清理的过期掉落 0。
  当前 30 秒窗口内新过期的掉落允许短暂存在，报告同时输出数量。

## 7. 8 项 P1 关闭证据

| P1         | 证据                                                |
| ---------- | --------------------------------------------------- |
| TD-OPS-01  | `ci.yml` e2e job service/env；本地同等流程 21/21    |
| TD-OPS-02  | 独立库/端口、prepare/teardown、`e2e.txt`            |
| TD-SRV-04  | `admin.integration.test.ts` 两个重连安全用例        |
| TD-DATA-04 | `admin.integration.test.ts` 发布阻断用例            |
| TD-SRV-02  | `combat.integration.test.ts` AOI 泄漏与治疗归属用例 |
| TD-CLI-01  | `autoAttack.spec.ts`、自动攻击集成测试              |
| TD-CLI-02  | Toast 队列、样式分层、`autoAttack.spec.ts` 几何断言 |
| TD-SRV-01  | 三个职责类 + ADR-025；全量回归通过                  |

## 8. 新增与遗留技术债务

新增/调整：

- **TD-SRV-01b（P2）**：Room 残余编排拆分（传送、资产管线、管理命令、checkpoint）。
- **TD-OPS-08b（P2）**：备份与 manifest 同一快照（SHA-256 已校验）。

保留并影响 Alpha 0.2 的评估：

- **TD-DATA-05**（装备槽数据库唯一约束）：Alpha 0.2 商店/装备扩展应在迁移窗口
  用可延迟唯一约束补上，当前行锁串行化仍然有效。
- **TD-QA-01/02**：容量回归命令已建立；p95 10ms 目标需在 Alpha 0.2 重新校准或优化。
- **TD-OPS-03/04**（草稿发布/冲突）仍会影响内容运营，但不在本轮范围。

## 9. Alpha 0.2 开发前置条件

1. 三职业技能/外观与 4–6 种怪物开始前，复用本轮自动攻击状态机与
   `combat.target.changed`，不要在客户端另建攻击循环。
2. 商店/交易必须复用资产事务、ledger、幂等键（现已含角色）与行锁；新增装备槽
   约束迁移。
3. 新玩法逻辑进入 `game-domain`/`game-application`，Room 只做编排；继续向 Room
   堆规则会抵消本轮拆分。
4. 保持 E2E 独立库/端口与 `load:regression` 门禁；CI 远端首次运行需确认 21/21。
5. 容量 p95 目标与掉落密度/视图同步策略在 Alpha 0.2 首周复测。

## 10. 证据索引

| 证据         | 路径                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 门禁日志     | `docs/phase-reports/alpha-01/gates.txt`                                        |
| E2E 日志     | `docs/phase-reports/alpha-01/e2e.txt`                                          |
| 50 人压测    | `docs/phase-reports/alpha-01/load-50p10a-10min.json` / `.log`                  |
| 恢复演练     | `docs/phase-reports/alpha-01/recovery-drill.json` / `.log`                     |
| 资产不变量   | `docs/phase-reports/alpha-01/database-invariants.txt`                          |
| 自动攻击截图 | `docs/phase-reports/alpha-01/auto-attack-*.png`                                |
| 执行计划     | `docs/ALPHA_01_EXECUTION_PLAN.md`                                              |
| ADR          | `docs/ADR/ADR-025-alpha01-auto-attack-event-routing-and-room-decomposition.md` |
