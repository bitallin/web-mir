# Alpha 0.2 S3 切片 2：死亡代价与复活点内容化

- 日期：2026-11-26
- 范围：PvE 死亡损失当前等级经验的一小部分（不降级、10 级前保护）、规则内容化、
  复活点显式编译进地图
- 关联：`docs/ADR/ADR-031-death-cost-and-respawn-content.md`、
  `docs/ALPHA_02_EXECUTION_PLAN.md` §4、`docs/PROJECT_STATUS.md`

## 1. 目标

让“野外变危险”真正影响成长决策，而不是只影响血量：

- 被怪物击败要付出可感知、但不摧毁进度代价；
- 低等级玩家在学会战斗前受到保护；
- 代价强度与保护阈值由内容 Release 决定，运营可调；
- 扣减经验必须与击杀奖励一样事务化、幂等，不能重复扣或扣成负数；
- 复活点由地图内容明确表达，而不是代码默认取第一个出生点。

PvP 死亡维持 ADR-021 的“无惩罚”契约不变。

## 2. 实际改动

### 2.1 契约（加法）

- 内容 bundle 新增 `rules` section：`{ deathPenalty?: { xpLossPermille,
protectBelowLevel } }`。section 在 bundle 根部**可选**，历史 Release 解析后
  不会补默认值，checksum 不变（EL-004）。
- `combat.profile` 增加可选 `deathPenalty`，客户端据此展示规则；旧服务端不发送
  时客户端显示“无”。
- 编译地图 manifest 增加可选 `respawnPoint` 与 `playerRespawnPointOf()`；
  旧编译产物无该字段时回退到第一个出生点。
- `PROTOCOL_VERSION` 不变（同版本前后端加法发布）。

### 2.2 内容与校验

- 基线内容新增规则：`xpLossPermille: 100`（10%）、`protectBelowLevel: 10`。
- 校验：schema 拒绝 `xpLossPermille` 越界（0–1000）与
  `protectBelowLevel` 越界（1–100）；语义校验 warning 覆盖“无新手保护”
  “关闭死亡代价”“单次超过 30%”。
- 内容 diff/compose 自动覆盖 `rules`，发布预览显示 `rules.deathPenalty`。
- 迁移 `0006` 为 `content_sections` 枚举增加 `rules`（expand-only，不触碰历史行）。

### 2.3 领域

- 新增纯函数 `applyDeathPenalty(level, exp, rule)`：
  - 等级低于保护阈值、比例 0 或经验为 0 → 不扣；
  - 否则扣 `floor(exp × permille / 1000)`，`level` 不变、`exp` 不小于 0。
- 单元测试覆盖：正常扣减、最低为 0、保护阈值边界、关闭规则与非法输入。

### 2.4 应用事务

- `AssetService.applyDeathPenalty({ characterId, deathId })`：
  - 读取 Room 固定内容快照；无规则时直接返回，不写任何行；
  - 单事务先锁角色行，再写 `asset_commands`（`kind='death_penalty'`，
    `death:<deathId>`）；冲突即重复事件，返回 `null`；
  - 只更新 `exp` 与 `version`，不碰 `level/hp/mp`；同事务重算资产快照。
- 真实 PostgreSQL 集成测试：扣减与快照、重复 deathId 只扣一次、保护阈值、
  无 `rules` 的历史发布不扣经验。

### 2.5 服务端

- 战斗结果记录统一改用**线缆事件**（带 `eventId`），tick 死亡与命令死亡共享
  同一死亡 ID 锚点。
- `recordCombatOutcomes` 判定死因：击杀者为房间玩家 → PvP，不扣；击杀者为
  怪物 → PvE，入队扣减；无击杀者不扣。
- 扣减任务与击杀奖励共用 Room 的串行资产队列，失败重试 3 次（200ms 退避），
  最终失败计入资产失败指标并记录日志。
- 提交后更新会话快照并发送 `character.progress`；损失 > 0 时向该玩家单独发送
  `system.notice`（warning，Toast）说明数量；受保护时发送 info（仅系统日志）。
- 加入世界时 `combat.profile` 携带房间 Release 的 `deathPenalty`。
- 复活点改为 `playerRespawnPointOf(manifest)`。

### 2.6 客户端

- 角色面板在“经验”下新增“死亡代价”行：`-10% 经验 · 10 级前保护`；
  内容无规则或关闭时显示“无”。行位置保证 1280×720 下无需滚动即可看到。
- 死亡后由服务端私有提示给出实际损失；客户端不计算经验，也不做免伤判断。
- 无新增面板或遮挡：角色面板仍在左侧栏，游戏区域与技能坞不变。

### 2.7 地图与复活点

- `starter_town`（17,10）与 `starter_wilds`（2,16）的出生点对象增加 Tiled
  布尔属性 `respawn: true`；编译器最多接受一个标记，多个报错，未标记回退到
  第一个出生点。
- 两张地图重新编译，checksum 更新；编译测试覆盖标记、回退与重复标记。

## 3. 测试与证据

命令均在 Node 26.13.1 下执行。

| 检查       | 命令/方式                                  | 结果                                         |
| ---------- | ------------------------------------------ | -------------------------------------------- |
| 格式       | `pnpm format:check`                        | 通过                                         |
| Lint       | `pnpm lint`                                | 通过（0 error / 0 warning）                  |
| 类型       | `pnpm typecheck`                           | 通过（根 + 15 个 workspace）                 |
| 单元/集成  | `pnpm test`                                | 66 文件、**424 测试**通过（约 30.4s）        |
| 构建       | `pnpm build`                               | 4 个应用成功                                 |
| 浏览器 E2E | `pnpm test:e2e`                            | **31/31 通过**（3.6 分钟，2 worker，独立库） |
| 死亡集成   | `combat.integration.test.ts -t experience` | 2/2 通过（见 §3.2 日志）                     |
| 资产不变量 | `pnpm verify:invariants`                   | 全部 0 违例（`death/invariants.txt`）        |
| 开发栈实测 | 84 端口 + 真实 Chromium                    | 规则行可见，截图 `death/dev-death-rule.png`  |
| 容量回归   | 50 人 × 10 分钟                            | 见 §3.1                                      |

E2E 说明：最终全量首次运行时 `classes.spec.ts` 的战士普攻用例等待怪物进入
`attack` 超时（怪物 chase → return → patrol），单跑 5/5、全量复跑 **31/31**
通过；该用例依赖共享世界实体的 AI 状态，非本切片代码路径，记为 TD-QA-11。

新增/扩展测试：

- 领域：4 个死亡代价单元测试。
- 应用：3 个真实 PostgreSQL 事务测试（含重复 deathId 与历史发布）。
- 服务端：2 个真实 PostgreSQL + Colyseus 测试（扣 20 经验且不降级；保护等级
  不扣）；PvP 测试断言 10 级、200 经验的被击杀者经验不变且无扣减行。
- 内容：4 个测试（基线规则、历史 payload 不变、越界拒绝、warning）。
- 地图：复活点标记/回退/重复标记。
- E2E：角色面板按房间内容显示 `10%` 与 `10 级前保护`。

### 3.1 50 人 × 10 分钟容量回归

见 `docs/phase-reports/alpha-02/load-50p10a-10min-s3-death.json`。

- 50/50 加入；命令接受率 99.0%（拒绝：TARGET_DEAD 374、COOLDOWN 307、
  OUT_OF_RANGE 3）；787 次击杀、0 玩家死亡、0 资产失败、0 重连。
- tick p50 1.34ms、p95 11.58ms、p99 14.89ms、max 16.91ms；p95 仍高于 10ms
  目标 1.58ms，但比上一轮 12.17ms 略低，p99 从 18.10ms 降到 14.89ms。
- 资产事务 p95 46.37ms（上一轮 48.45ms）；RSS 峰值 317MB（上一轮 324MB），
  无持续增长；进程未重启。
- 房间 `contentVersion` 为 `2026.11.26.4`，负载场景确实运行在新内容上。
- 场景中玩家死亡为 0，因此本轮容量不覆盖死亡扣减事务本身；该路径由
  `assetService.integration.test.ts` 与两条 Room 集成测试覆盖。
- tick p95 仍作为已知风险（TD-SRV-03/CLI-05），不在本切片内继续优化。

### 3.2 证据文件

- `docs/phase-reports/alpha-02/death/death-penalty-test.log`：两条死亡扣减
  集成测试的实际输出。
- `docs/phase-reports/alpha-02/death/dev-death-rule.png`：开发栈 1280×720
  角色面板，规则行无需滚动可见。
- `docs/phase-reports/alpha-02/death/invariants.txt`：资产不变量快照。

## 4. 部署与内容

- 迁移 `0006_busy_ravenous.sql`：`ALTER TYPE "public"."content_section" ADD
VALUE 'rules';`，已在开发库执行。
- 通过运营 API 保存 `rules` 草稿并发布 `2026.11.26.4`（checksum
  `7f6c6914d54c2d4c276f240a5ad0d0b8426286530c2025c3952a027278219a26`，
  差异仅 `rules.deathPenalty` 新增），12:53 激活；Game Server 12:53 刷新到该
  版本。
- 开发栈以最终代码重启（84–87）；旧 Room 仍固定旧快照，需要新 Room 才会
  生效（ADR-008/022）。

## 5. 未验证 / 后续

- 远端 CI（本环境无法查询 `gh`）仍未确认。
- 8584 人工试玩：规则显示已实测；实际死亡扣减由真实 PostgreSQL 集成测试与
  E2E 面板断言覆盖，未在 8584 上制造一次真实死亡。
- 经验仍无连续流水（新增 TD-DATA-11）；当前只有幂等命令行可证明“只扣一次”。
- PvP、环境伤害、爆装/红名不在本切片；跨图回城复活未做。
- 死亡后 Buff/DoT 清理、尸体表现与正式美术仍属 S4。

## 6. 复盘

- **正确**：把扣减放进与击杀奖励相同的资产事务与锁顺序，并用死亡事件 ID 做
  幂等键；命令死亡与 tick 死亡共用线缆事件后，只有一条死亡记录路径。
- **正确**：规则作为可选内容 section，历史 Release 不补默认值、checksum 不变；
  PvP 语义没有因为新规则被悄悄改变。
- **正确**：先写截图再检查可见性，发现规则行被面板裁剪后把它移到“经验”下方，
  而不是只依赖 `textContent` 断言。
- **不够好**：新增内容 section 的代价比预期高（PostgreSQL 枚举、运营契约联合
  类型、diff 假设），已沉淀 EL-022；Beta 前若要更多全局规则，应一次性设计
  section 注册机制。
- **不够好**：经验没有独立流水，运营无法像金币那样对账；当前靠幂等行与快照。
