# Alpha 0.2 S4-G：主城守卫任务链

- 日期：2026-11-26
- 范围：Alpha 0.2 S4 收尾（关闭“NPC 无目标”体验缺口）
- ADR：`docs/ADR/ADR-034-content-driven-quest-chain.md`
- 内容 Release：`2026.11.26.7`（checksum `e1c97389…`）
- 证据：`docs/phase-reports/alpha-02/quests/`

## 1. 目标

Alpha 0.2 已有商店、三职业、怪物威胁、死亡代价、装备与三张地图，但新角色进入
主城后没有目标：守卫只是标记，击杀没有指引，回城只有买卖。本切片交付一条
**内容驱动、服务端权威、可交付**的三步任务链：

1. 清理史莱姆：击杀 3 只野地史莱姆。
2. 狼群的踪迹：击杀 3 只森林狼（需 3 级且完成前一任务）。
3. 白狼王的威胁：击杀白狼王（需 5 级且完成前一任务）。

任务由主城守卫接取与交付；奖励为经验、金币与通用药水/材料。

## 2. 交付内容

### 2.1 契约

- `contracts/content.ts`：新增可选 `quests` section、`QuestContent`、
  `questObjectiveSchema`（v1 仅 `kill` 白名单）、`questRewardsSchema`；
  `CONTENT_SECTIONS` / 标签 / `contentSectionDataSchemas` 同步。
- `contracts/quests.ts`（新文件）：`QuestView`、`QuestSnapshot`、
  `QuestUpdate`、`quest.accept` / `quest.claim` 命令 schema、
  `QUEST_NPC_RANGE_TILES = 3`。
- `CLIENT_MESSAGES` / `SERVER_MESSAGES` 增加 `quest.*`；拒绝码增加
  `QUEST_UNAVAILABLE`、`QUEST_NOT_ACTIVE`、`QUEST_NOT_COMPLETE`、
  `QUEST_ALREADY_CLAIMED`；`assetCommandKind` 增加
  `quest_accept` / `quest_claim`。
- `adminContentDraftUpdateSchema` 增加 `quests` 分支（手写 section 联合类型，
  见 §4.1）。

### 2.2 内容与校验

- 基线内容新增三条任务，`giverNpcId` 使用既有 `town_guard`，不新增 NPC 或
  地图；任务奖励只使用通用药水与材料。
- 校验：键名与 id 一致、发布 NPC 存在于编译地图、前置存在且无循环、目标怪物
  存在且有刷点、奖励物品存在且不超过堆叠上限、空奖励告警、任务等级远低于目标
  怪物等级告警。
- `quests` 为可选 section，历史 Release 的 canonical checksum 不变（EL-004）。

### 2.3 持久化

- 迁移 `0007`：`character_quests` 表（`active | completed | claimed`、
  `progress`、`accepted_at`、`completed_at`、`claimed_at`、`version`），
  唯一约束 `(character_id, quest_id)`，三个 CHECK 保证进度非负与时间戳一致。
- 迁移 `0008`：`content_section` 枚举增加 `quests`（expand-only）。
- 仓储：`listCharacterQuests`、`findCharacterQuestForUpdate`、
  `insertCharacterQuest`、`advanceCharacterQuest`、`markCharacterQuestClaimed`。

### 2.4 应用层

- `AssetService.loadQuestRecords`：加入握手时读取任务状态。
- `grantKillReward`：在同一个事务内推进所有匹配的活动任务；只有提交成功才
  返回 `questUpdates`，重复击杀引用不会重复推进。
- `acceptQuest`：锁角色、写 `quest_accept` 幂等行、校验任务/等级/前置/未接取、
  插入 active 记录。
- `claimQuest`：锁角色、写 `quest_claim` 幂等行、校验 completed、单事务内加
  经验（可升级并回满）、加金币（钱包 + `currency_ledger`
  `reason='quest_reward'`）、放奖励物品（背包不足整体回滚）、标记 claimed。
- 纯规则在 `game-domain/quests.ts`：状态推导（locked/available/active/
  completed/claimed）、前置必须 claimed、视图解析、击杀推进与封顶。

### 2.5 服务端

- 加入世界后发送私有 `quest.snapshot`；击杀奖励提交后向本人发送
  `quest.update`，完成时提示“回到守卫处交付”。交付与击杀升级会改变其它任务的
  可接状态，两条路径会重新下发整条 `quest.snapshot`，无需重登即可看到下一任务
  解锁（E2E 断言交付后「狼群的踪迹」变为 available）。
- `quest.accept` / `quest.claim` 走统一资产命令管线（会话、协议、序号、限频、
  幂等），并校验 NPC 在当前地图且距离 ≤ 3 格；不在本图的发布 NPC 不可交互。
- 任务状态不进入公开 Room State；重登/传送后从数据库恢复。

### 2.6 客户端

- 角色状态板增加「任务 J」按钮、任务追踪（最多 3 条，active/completed）与
  可接任务提示；追踪器在状态板内，不覆盖玩家与画面中心。
- 任务面板停靠右侧（与商店/背包互斥），显示描述、目标进度、经验/金币/物品
  奖励、等级/前置原因；接取与交付按钮在距离不足时禁用并提示“走近守卫”。
- NPC 点击：商人优先打开商店，任务发布者打开任务面板；切图时关闭面板。
- 只渲染服务端视图，不自行计算进度或发奖。

## 3. 测试与验收

### 3.1 自动化门禁

| 检查        | 命令/方式                  | 结果                                                     |
| ----------- | -------------------------- | -------------------------------------------------------- |
| 格式        | `pnpm format:check`        | 通过                                                     |
| Lint        | `pnpm lint`                | 通过（0 error / 0 warning）                              |
| 类型        | `pnpm typecheck`           | 通过（根 + 15 个 workspace）                             |
| 单元/集成   | `pnpm test`                | 70 文件、**472 测试**通过（新增 17 条）                  |
| 构建        | `pnpm build`               | 4 个应用成功                                             |
| 浏览器 E2E  | `pnpm test:e2e`            | **39/39 通过**（4.3 分钟，2 worker，独立库/端口）        |
| 任务 E2E    | `tests/e2e/quests.spec.ts` | 接取 → 3 次击杀 → 回城交付 → 金币 +20、药水 +1、追踪清空 |
| 容量 sanity | 50 人 × 2 分钟             | 50/50、接受率 98.8%、tick p95 **4.37ms**、0 资产失败     |
| 资产不变量  | `pnpm verify:invariants`   | 7 项全部 0 违例                                          |

交付后解锁用例：E2E 在交付第一个任务后断言「狼群的踪迹」从 locked 变为
available，验证服务端重新下发整条任务链快照。

全量 E2E 有一次中间运行在 `skills.spec.ts` 等待怪物进入 `attack` 时超时
（TD-QA-11 类共享世界/时序问题）；该文件单跑 2/2、全量重跑 **39/39** 通过，
未降低阈值。

新增测试覆盖：

- 契约/内容：quests section 可选、未知 NPC、缺失奖励物品、前置循环、历史
  Release 不含 quests 仍有效；key-order checksum 回归包含 quests。
- 领域：等级锁定、前置必须 claimed、进度/奖励名称解析、击杀只推进匹配任务、
  进度封顶与完成。
- 应用（真实 PostgreSQL）：接取与重复命令、等级/前置拒绝、击杀推进与重复引用
  不推进、交付奖励与账本只写一次、未完成交付回滚后同 commandId 仍可用、背包满
  时整体回滚且任务保持 completed。
- 服务端（真实 Colyseus + PostgreSQL）：快照下发、接取幂等、锁定任务拒绝、
  远离 NPC 拒绝、击杀推进到完成、重登后状态保留。

### 3.2 开发栈实测

- 迁移 `0007`/`0008` 已应用到开发库；内容草稿保存 200、校验 200（0 issue）、
  发布 201、激活 200；Game Server 日志
  `content release refreshed; new rooms will use it`。
- 真实 Chromium（1280×720，8584）：注册新角色 → 可接任务提示 →
  走近守卫 → 点击 NPC 打开任务面板 → 接取；服务端返回
  `quest_slime_cleanup=active`，后续两条任务为 `locked`。
  截图 `dev-quest-offer.png`、`dev-quest-active.png`。

### 3.3 容量

`load-50p-2min.json`：50/50 加入、接受率 98.8%、145 击杀、0 资产失败；
tick p50 2.13ms / p95 4.37ms / p99 6.17ms；资产事务 p95 59.22ms。
压测机器人不接受任务，因此该结果只证明击杀奖励事务新增的任务查询没有破坏
tick 预算；任务路径本身由集成与 E2E 覆盖。

## 4. 问题与修正

### 4.1 新增内容 section 的横切成本再次出现（EL-022）

首次保存 `quests` 草稿返回 422：`adminContentDraftUpdateSchema` 是手写的
section 判别联合，不随 `CONTENT_SECTIONS` 自动扩展。补上 `quests` 分支并重启
Control API 后正常。沉淀 EL-029：新增内容 section 的清单必须包含
`contracts/admin.ts` 的草稿联合类型。

### 4.2 E2E 抢走 combat.spec 的刷点

第一版任务 E2E 选择“视野内第一只活史莱姆”，与 `combat.spec` 的
`wilds_slime_2` 重叠，导致后者技能冷却断言偶发失败。改为独占
`wilds_slime_9`（靠近野外入口，避开狼/蜘蛛区域），并在注释中登记；随后
全量 39/39 通过。复用了 EL-019 的教训。

### 4.3 压测脚本未注册新消息

50 人压测时每个机器人打印 `onMessage() not registered for type
'quest.snapshot'`。已在 `worldScenario.ts` 注册空处理器；不影响指标。

### 4.4 任务链 E2E 的战斗路径

最初让 1 级角色横穿野区击杀三只分散史莱姆，角色会被狼/蜘蛛击杀导致攻击命令
被拒绝。改为在入口附近的独占刷点等待刷新，三次击杀都在同一安全区域完成。

## 5. 未验证 / 后续

- 2 分钟容量是 sanity，不是 50 人 × 10 分钟门禁；下一次正式回归需要补跑并
  记录 tick 与资产 p95 趋势。
- 8584 的人工试玩仍待用户完成（接取 → 出城 → 交付的完整手感）。
- 任务 UI 没有 NPC 头顶感叹号、追踪折叠、任务日志历史、放弃任务；收集/到达
  目标、每日任务、组队共享留给 Alpha 0.3 任务系统。
- 经验交付仍没有连续流水（TD-DATA-11）；金币已有账本。
- 远端 CI 结果仍待确认（本环境无法查看）。
