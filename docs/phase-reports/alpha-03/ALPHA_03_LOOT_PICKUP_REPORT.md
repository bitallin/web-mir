# Alpha 0.3 S3-E 报告：怪物归属、自动拾取与争夺掉落

- 日期：2026-11-27
- 范围：简化拾取操作、引入怪物归属、加入无归属争夺掉落、远处点击自动走近。
- ADR：`docs/ADR/ADR-041-monster-claims-and-smart-loot-pickup.md`
- 证据：`tests/e2e/economy.spec.ts`、`apps/game-server/test/economy.integration.test.ts`、
  `apps/game-server/test/boss.integration.test.ts`、`packages/game-domain/src/combatWorld.test.ts`、
  `packages/game-application/test/assetService.integration.test.ts`

## 1. 结论

战斗后的拾取不再需要逐件点击：归属者在 3 格内的普通掉落会通过既有的拾取事务
自动进入背包，并在客户端播放物品从地面飞向拾取者、背包按钮脉冲的动效。掉落
归属改为“怪物归属”而不是最后一击：第一次造成伤害的玩家拥有该怪物的经验、
金币、掉落与任务进度，最后一击不会抢走奖励。世界首领的专属掉落改为无归属、
锁定 60 秒、只能手动拾取的争夺掉落。点击超出拾取距离的掉落会先自动走过去，
到达后再提交既有拾取命令。

## 2. 设计要点

1. **怪物归属**：`CombatWorld` 记录首次伤害者；10 秒内任何伤害刷新归属计时，
   但不改归属；死亡事件的 `ownerId` 决定奖励归属；离开地图、重生或超时释放。
2. **奖励仍走既有事务**：`scheduleKillReward` 以归属者作为角色 id 调用
   `grantKillReward`；队伍共享经验按归属者所在队伍计算；任务进度、金币账本
   与掉落仍是同一事务与幂等引用。
3. **自动拾取**：Room 每 4 tick 检查归属窗口内的掉落；归属者存活、在线、
   未过图且距离小于 `rules.loot.autoPickupRangeTiles`（默认 3）时，提交一次
   既有 `AssetService.pickup`；背包已满退避 5 秒并提示一次。
4. **争夺掉落**：内容 `lootEntry.contested` 标记；创建时无归属、
   `pickup_locked_until = now + rules.loot.contestedDelayMs`（默认 60 秒），
   过期时间为锁定 + 120 秒；锁定期间拾取返回 `DROP_LOCKED` 与剩余毫秒，
   解锁后手动拾取，永不自动。
5. **远处拾取**：客户端在点击超出 1.5 格时发送既有 `move.to` 到掉落格，
   到达后发送既有 `loot.pickup`；锁定掉落不走近，只提示倒计时。
6. **表现**：`loot.claimed` 触发物品图标沿曲线飞向拾取者；本地拾取时背包
   按钮脉冲；争夺掉落在地面标签与“附近掉落”列表显示剩余锁定时间。

## 3. 改动清单

- `packages/contracts`：死亡事件 `ownerId`、`LootState` 的归属/锁定字段、
  `DROP_LOCKED`、`rules.loot` 与争夺条目标记、自动范围/锁定默认值。
- `packages/game-domain`：怪物归属与超时、离开/重生释放、死亡事件归属、
  战利品滚动的 `contested` 标记。
- `packages/persistence`：迁移 `0010` 增加 `world_drops.pickup_locked_until`。
- `packages/content-schema`：争夺条目与 `rules.loot` 校验；首领专属掉落标记
  争夺；基线内容增加 `autoPickupRangeTiles=3`、`contestedDelayMs=60000`。
- `packages/game-application`：掉落视图携带归属/锁定；争夺掉落创建；拾取事务
  校验锁定。
- `apps/game-server`：奖励按归属者发放、队伍助攻按归属者队伍；自动拾取 tick、
  锁定拒绝、状态字段与测试开关。
- `apps/game-web`：掉落视图字段；自动走近、锁定倒计时、物品飞行与背包脉冲。
- 测试：领域归属、契约字段、内容校验、应用争夺掉落与锁定、房间自动拾取、
  首领归属与锁定拒绝、浏览器自动拾取流程；旧的按击杀者拾取用例改为新规则。

## 4. 验证结果

| 检查        | 命令/方式                            | 结果                                    |
| ----------- | ------------------------------------ | --------------------------------------- |
| 格式        | `pnpm format:check`                  | 通过                                    |
| Lint        | `pnpm lint`                          | 通过（0 error / 0 warning）             |
| 类型        | `pnpm typecheck`                     | 通过（根 + 15 个 workspace）            |
| 单元/集成   | `pnpm test`                          | 82 文件、**575 测试**通过               |
| 构建        | `pnpm build`                         | 4 个应用成功                            |
| 浏览器 E2E  | `PLAYWRIGHT_WORKERS=1 pnpm test:e2e` | **47/47 通过**（10.6 分钟，串行全量）   |
| 容量 sanity | 50 人 × 2 分钟                       | 50/50、接受率 98.9%、175 击杀、0 失败   |
| tick        | 同上                                 | p50 1.39ms / p95 **3.4ms** / p99 4.54ms |
| 资产不变量  | `pnpm verify:invariants`             | **7/7 为 0**                            |
| 开发栈实测  | 84 端口 + 真实 Chromium              | 自动拾取入包、背包脉冲可见、地面无残留  |

新增测试：

- 领域：首次伤害归属、最后一击不抢归属、10 秒后重新归属、离开/重生释放。
- 契约/内容：死亡事件归属字段、争夺条目、掉落规则范围校验、首领条目标记。
- 应用：争夺掉落无归属与锁定、锁定期间拒绝、解锁后可拾取、普通掉落带归属。
- 服务端：击杀奖励与自动拾取进入背包、首领由归属者获得经验、争夺掉落锁定
  拒绝；队伍共享掉落测试使用显式关闭自动拾取的测试开关。
- 浏览器：击杀后不点击即进入背包，另一玩家不会获得归属掉落。

## 5. 发布与实测

1. **开发栈重启**：84–87 于 11:29 重启到本切片代码；迁移 `0010` 已应用。
2. **内容发布**：draft 200、validate 200（valid=true，0 issue）、publish 201、
   activate 200；版本 `2026.11.27.6`（checksum
   `8acd4f4517862a8f37fab3861741b68d274db858047ba3ee74f37c2a96dd7d6e`，
   新增 `rules.loot`、变更首领掉落表）；Game Server 日志确认刷新。
3. **8584 实测**（真实 Chromium 新角色）：击杀野地史莱姆后，凝胶无需点击自动
   进入背包，背包按钮脉冲被 MutationObserver 捕获，地面掉落行数为 0，金币
   50 → 52；截图 `loot-pickup/dev-auto-pickup-8584.png`。
4. **容量 sanity**：50 人 × 2 分钟 50/50、接受率 98.9%、175 击杀、0 资产
   失败；tick p50 1.39ms / p95 **3.4ms** / p99 4.54ms / max 5.32ms，资产事务
   p95 50.65ms；证据 `loot-pickup/load-50p2a.json`。
5. **资产不变量**：压测后 7/7 为 0。
6. **未纳入自动化的验证**：远处自动走近与物品飞行动效由 8584 人工试玩确认；
   客户端决策（距离/锁定/掉落格）有纯函数单测，自动走近的端到端用例待补。

## 6. 未覆盖与风险

- 怪物归属是进程内内存状态，不持久化；多进程/多实例部署需要共享协调
  （TD-SRV-13）。
- 其他玩家仍可攻击已归属怪物，只是拿不到奖励；攻击锁定未实现。
- 没有可见的怪物归属标识（TD-CLI-22）。
- 争夺掉落只能在解锁后手动拾取；没有“自动走近并等待解锁”的操作。
- 队伍手动共享掉落变成归属者自动拾取之后的兜底，语义见 ADR-035 §8。

## 7. 下一步

1. 发布新内容 Release 并在 8584 实测自动拾取、锁定倒计时与远处走近。
2. 跑容量 sanity 与资产不变量，回填结果并提交。
3. 下一片：S3-D2 到达类任务目标或社交深化（副本先写 ADR）。
