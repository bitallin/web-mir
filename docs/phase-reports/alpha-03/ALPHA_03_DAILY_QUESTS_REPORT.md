# Alpha 0.3 S3 报告：每日任务与留存循环

- 日期：2026-11-27
- 范围：内容驱动的每日任务、区服重置规则、周期键持久化、在线重置刷新、
  任务面板日常呈现
- ADR：`docs/ADR/ADR-038-daily-repeatable-quests.md`
- 内容：`2026.11.27.3`（checksum `1cd1199a…`），新增 3 项
  （`rules.dailyReset` + 2 个日常任务）
- 证据目录：`docs/phase-reports/alpha-03/dailies/`

## 1. 目标与产品判断

Alpha 0.3 S1 交付组队、S2 交付世界首领后，玩家每天上线仍只有一个选择：
继续推三步一次性任务链或刷怪。路线图把“日常/循环任务”列为本版本的留存
核心。本切片先交付机制，再按机制补内容：

1. 更愿意再玩 30 分钟：是——日常给出明确的当日目标，完成后有可预期的
   经验、金币与药水。
2. 更愿意明天回来：是——日常在区服重置后重新可接取，这是本切片的核心。
3. 更愿意和别人一起玩：间接——日常与队伍共享击杀经验叠加，但不要求组队；
   本切片不为社交专门加规则。

## 2. 交付内容

### 2.1 内容

| 类型 | id                          | 说明                                              |
| ---- | --------------------------- | ------------------------------------------------- |
| 规则 | `rules.dailyReset`          | `{ hour: 5, utcOffsetMinutes: 480 }`（05:00）     |
| 任务 | `quest_daily_slime_cleanup` | Lv.1，击杀 5 只野地史莱姆；50 经验、15 金、金创药 |
| 任务 | `quest_daily_wolf_hunt`     | Lv.3，击杀 6 只森林狼；120 经验、30 金、凝神药    |

日常任务不能设置前置，也不能作为一次性任务的前置；发布含日常但不含
重置规则的内容会被内容校验拒绝。

### 2.2 契约

- `QuestContent.repeat?: 'daily'`（封闭白名单 `QUEST_REPEAT_KINDS`）。
- `QuestView.repeat?` 与 `QuestView.nextResetAt?`（epoch 毫秒）。
- `rulesContentSchema.dailyReset?: { hour, utcOffsetMinutes }`。
- 旧 Release 不含这些字段时行为不变。

### 2.3 持久化（迁移 0009）

- `character_quests` 新增 `period_key text NOT NULL DEFAULT ''`。
- 唯一索引从 `(character_id, quest_id)` 改为
  `(character_id, quest_id, period_key)`。
- 一次性任务写 `''`，日常写 `YYYY-MM-DD`；每个周期一行，历史保留。
- 旧数据自动获得空周期键，不需要回填。

### 2.4 领域

- `dailyPeriodKey(now, rule)`：把时间戳平移到区服本地时区后按重置小时
  划分日期；`nextDailyResetAt` 返回下一次重置的 epoch 毫秒。
- 视图解析：日常记录不属于当前周期时视为不存在（可接取、进度 0）；
  一次性任务不受影响。
- 击杀推进拒绝旧周期的日常记录。

### 2.5 应用事务

- `acceptQuest` / `claimQuest` 使用注入时钟计算周期键，按
  `(character, quest, period)` 查询、插入与更新。
- 同一周期内重复接取返回 `QUEST_UNAVAILABLE`，重复交付返回
  `QUEST_ALREADY_CLAIMED`。
- `advanceQuestsOnKill` 只读取一次性和当前周期日常，仍在击杀奖励事务内
  推进；交付奖励仍与任务状态同事务。

### 2.6 服务端与客户端

- Room 每 30 秒检查周期键；跨过重置点时向所有会话重发任务快照，并广播
  「每日任务已重置，可以重新接取」。快照由内存记录与当前时间计算，
  没有新增数据库读取。
- 任务面板与追踪器显示「日常」标签、重置时刻与「今日已完成」。
- 重置时刻按玩家本地时区格式化，服务端只下发权威的 epoch 毫秒。

## 3. 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：78 文件、**530 测试**通过（新增 11 条）。
- 构建：4 个应用成功。
- 全量 E2E：**43/43 通过**（5.0 分钟），其中 `quests.spec.ts` 在真实浏览器
  中接取日常、击杀 5 只史莱姆、交付并断言「今日已完成」（1.3 分钟）。
- 复跑记录：提交后复跑全量 E2E 时 `movement.spec.ts` 的平滑度断言一次失败
  （`longestStill=5`，阈值 ≤3）；同文件单跑 2/2、随后全量 **43/43** 通过；
  未降低阈值，按软件渲染 2 worker 的时序抖动记录（EL-027）。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 2 分钟：50/50、接受率 98.9%、164 击杀、**0 资产失败**、tick
  p50 2.53ms / p95 **5.11ms** / p99 6.14ms、资产事务 p95 52.74ms
  （`dailies/load-50p2a-dailies.json`）。
- 真实浏览器（宿主机 8584）：新角色在守卫处看到「日常」标签与
  「每日 21:00 重置」（浏览器为 UTC；中国时区显示 05:00），接取后追踪器
  显示 `日常 每日：清理史莱姆 野地史莱姆 0/5`。截图
  `dailies/dev-daily-offer.png`、`dailies/dev-daily-tracker.png`。

## 4. 内容发布

- 通过 Control API 保存 `rules` 与 `quests` 草稿；校验 200（valid=true、
  0 issue，新增 3 项）。
- 发布 `2026.11.27.3`（checksum
  `1cd1199a2b2ccb0f92f080f4ff5171e00074095884c0f4b778b3b10615389022`）并
  激活；Game Server 日志确认内容已刷新，新 Room 使用新版本。
- 开发栈 84–87 已重启到本切片代码（06:44），4 个服务健康 200。

## 5. 遇到的问题及解决方法

1. **新增跨 section 约束让历史测试失效**：两个“无 rules 的旧 Release”
   测试仍包含日常任务，因而被新校验拒绝；把测试夹具改为同时移除日常任务
   （旧 Release 本来也不会有日常），并保留“一次性任务无 rules 仍有效”的
   语义。
2. **死亡代价测试重写整个 rules 对象**：替换 `bundle.rules` 时丢掉了
   `dailyReset`，被新校验判为无效；改为展开旧 rules 再覆盖
   `deathPenalty`。
3. **Control API 仍运行旧契约**：首次保存草稿返回 422（`dailyReset` /
   `repeat` 未识别）；重启开发栈后保存、校验、发布、激活全部通过。
4. **旧 Room 固定旧内容**：激活后当前 Room 仍没有日常；重启 Game Server
   使新 Room 使用 `2026.11.27.3`，这是既有的内容版本模型。
5. **E2E 产物刷新**：全量 E2E 会重写历史截图与 `websocket.log`；本轮只
   提交源码、迁移、测试与新增日常证据，不把无关截图变更混入提交。

## 6. 尚未解决

- 日常任务只有击杀目标；`collect`/对话/到达等目标仍需代码发布。
- 在线重置最多延迟一个 30 秒扫描周期；UI 只有静态重置时刻，没有倒计时。
- 每日历史行没有清理策略（TD-DATA-12）。
- 主线任务链仍是 3 步；10 步主线内容属下一切片。
- 远端 CI 与 8584 人工试玩仍待确认。

## 7. 提交

- `8cfc209` `feat(alpha-03): add daily quests with content-driven resets`
  （24 个文件：契约、内容、领域、应用、持久化迁移、服务端、客户端、
  11 条测试、E2E 扩展）。

## 8. 下一步

1. 8584 试玩：接受两个日常、跨地图击杀、交付，确认重置标签与追踪器。
2. S3-B：任务链扩展（10 步主线）或日常目标类型（collect）——按试玩反馈
   与内容产能选择。
3. 正式美术（TD-CLI-13）与远端 CI 结果确认。
