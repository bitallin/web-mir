# Alpha 0.3 S1 切片报告：组队与共享击杀经验

- 日期：2026-11-27
- 切片：邀请/接受/拒绝/离开、队伍名单、同图共享击杀经验
- ADR：`docs/ADR/ADR-035-party-membership-and-shared-kill-experience.md`
- 执行计划：`docs/ALPHA_02_EXECUTION_PLAN.md` §4（Alpha 0.3 起步切片）
- 证据：`docs/phase-reports/alpha-02/party/`

## 1. 目标

`docs/GAMEPLAY_REVIEW.md` 把多人交互评为 2/5：玩家能看见彼此、能聊天、能决斗，
但没有任何合作目标。本切片交付最小的合作关系：两名玩家可以组队、看到彼此的
等级与 HP，并在同一张地图内分享击杀经验；队伍随角色跨地图保留（ADR-036），
但不做队伍聊天。

## 2. 实际改动

1. **契约**
   - 新增 `party.ts`：`PartyView` / `PartyMemberView` / `party.snapshot` /
     `party.invite` 与四条客户端命令（`party.invite`、`party.accept`、
     `party.decline`、`party.leave`）。
   - 线缆上限 `PARTY_MAX_MEMBERS = 8`、邀请距离 `PARTY_INVITE_RANGE_TILES = 15`、
     邀请有效期 `PARTY_INVITE_TTL_MS = 30_000`。
   - 拒绝码：`PARTY_SELF`、`PARTY_TARGET_UNAVAILABLE`、`PARTY_TARGET_BUSY`、
     `PARTY_ALREADY_IN_PARTY`、`PARTY_FULL`、`PARTY_INVITE_EXPIRED`、
     `PARTY_NOT_IN_PARTY`。
   - 内容 `rules.party = { maxMembers, assistSharePermille, assistRangeTiles }`
     （可选 section）；`assetCommandKind` 增加 `party_kill_reward`。
2. **内容与校验**
   - 基线规则：最多 4 人、队友在 12 格内获得怪物基础经验的 50%。
   - 校验警告：分享为 0（“组队不共享经验”）、范围小于 3 格。
3. **服务端**
   - `PartyRegistry`（内存）：邀请（同目标只保留一条，30 秒过期）、接受时创建
     队伍、队长按加入顺序提升、最后一人离开时解散、清理离队者的邀请。
   - `WorldMapRoom`：四条命令走与资产命令相同的 `CommandGuard`（协议、重复 id、
     序号、限频），同步执行；名单变更只向相关成员发送私有 `party.snapshot`。
     加入世界后补发快照；最终离开/宽限期结束时移除队员并通知剩余成员；传送时
     保留队伍（ADR-036）。
   - 共享经验：击杀者照常获得完整奖励；对同队、存活、在线、距离怪物 ≤ 12 格的
     其他成员，在资产队列中依次执行 `grantPartyKillExperience`。
4. **应用与持久化**
   - `AssetService.grantPartyKillExperience`：锁角色行、写入
     `party_kill:<reference>:<characterId>` 幂等命令，经验 =
     `floor(基础经验 × 千分比 / 1000)`，不消耗 RNG；可升级并回满；不改金币、
     掉落或任务进度。无新表、无迁移。
5. **客户端**
   - 附近玩家行增加「邀请」；收到邀请时显示接受/拒绝提示（30 秒后自动消失）；
     左上状态板下方显示队伍面板（人数、队长、等级、HP、在线/倒下）与「离队」。
   - 调试钩子 `inviteToParty`、`acceptPartyInvite`、`declinePartyInvite`、
     `leaveParty`、`partyState`、`partyInviteState`，供 E2E 断言。
6. **内容发布**
   - 保存 `rules` 草稿（deathPenalty + party）、校验 0 issue、发布并激活
     `2026.11.27.1`（checksum `01bcd16d…`，新增 1 条规则）。

## 3. 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
PLAYWRIGHT_SKIP_WEBSERVER=true E2E_GAME_WEB_PORT=84 E2E_GAME_SERVER_PORT=87 \
  npx playwright test tests/e2e/party.spec.ts --workers=1   # 开发栈 84–87
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 LOAD_OUTPUT=... pnpm load:scenario
```

| 检查        | 方式                        | 结果                                                       |
| ----------- | --------------------------- | ---------------------------------------------------------- |
| 格式/lint   | `pnpm format:check`、`lint` | 通过（0 error / 0 warning）                                |
| 类型        | `pnpm typecheck`            | 通过（根 + 15 个 workspace）                               |
| 单元/集成   | `pnpm test`                 | 73 文件、**490 测试**通过（新增 18 条）                    |
| 构建        | `pnpm build`                | 4 个应用成功                                               |
| 浏览器 E2E  | `pnpm test:e2e`             | **40/40 通过**（4.3 分钟，2 worker，独立库/端口）          |
| 组队 E2E    | `tests/e2e/party.spec.ts`   | 两人组队 → 名单 2/4 → 离队 → 再组队 → 传送后队伍保留；截图 |
| 开发栈实测  | 84 端口 + 真实 Chromium     | 同一用例通过；Game Server 内容刷新到 `2026.11.27.1`        |
| 资产不变量  | `pnpm verify:invariants`    | 7 项全部 0 违例                                            |
| 容量 sanity | 50 人 × 2 分钟              | 50/50、97.3%、tick p95 5.09ms / p99 6.78ms、0 资产失败     |
| 50×10 门禁  | 50 人 × 10 分钟             | 见 §3.1                                                    |

### 3.1 50 人 × 10 分钟

结果见 `docs/phase-reports/alpha-02/party/load-50p10a.json`：

- 50/50 加入、接受率 98.9%、741 击杀、0 资产失败；Room 内容版本 `2026.11.27.1`。
- tick p50 1.28ms / p95 **6.19ms** / p99 7.38ms / max 12.35ms（10ms 目标内）；
  资产事务 p50 31.12ms / p95 54.69ms / p99 71.96ms；RSS 峰值约 330MB。
- 本切片在无队伍时只增加一次“是否同队”判断；压测机器人不组队。

压测机器人不组队，共享经验路径由服务端集成测试覆盖（真实 PostgreSQL +
Colyseus：队友 +6 经验、超出范围队友 0、掉落仍只归击杀者）。

## 4. 遇到的问题及解决方法

1. **双人 E2E 各自“创建”了独立房间**：`?fresh=1` 是 `client.create`，两名玩家
   即使在同一张地图也互相不可见。改为第一名玩家 `?fresh=1` 创建房间、从 HUD
   读取 `room-id`，第二名玩家 `?join=<roomId>` 加入同一房间后通过。沉淀 EL-030。
2. **伪造的接受请求可以取消别人的邀请**：`acceptInvite` 最初在“接受者不是被
   邀请者”时也删除邀请，任何人都能拿 inviteId 试探并取消。改为只对被邀请者
   校验、仅在过期时删除；补单元测试。
3. **正式回归首次启动失败**：2 分钟 sanity 的机器人在 Room 中尚未完全断开时
   启动 10 分钟回归，报“room already has 49 players”。等待 Room 清空后重跑
   通过；记录为压测前置条件，而非代码缺陷。
4. **共享经验的数值必须可解释**：若队友再跑一次击杀奖励会重复掷掉落、重复发
   金币与任务进度；改为按内容基础经验的固定千分比分享，不消耗 RNG，重试不
   改变数值。

## 5. 未验证 / 已知限制

- 8584 完整双人试玩（组队打怪、队伍面板、离队与跨图保留）仍待用户完成；
  自动化已在开发栈用真实 Chromium 跑通。
- 远端 CI 结果仍待确认（本环境无 gh）。
- 队伍在进程内存中：进程重启或崩溃会丢失队伍；过图已保留（ADR-036）。
- 没有队伍聊天、掉落分配规则（窗口内队友可捡，先到先得）、金币共享、队长
  移交、踢人；名单暂不显示成员所在地图；1 人队伍需手动离队或解散（TD-CLI-17）。
- 共享经验让 4 人满队最多额外 150% 经验；由 `assistSharePermille` 与范围控制，
  需要试玩数据决定是否调整。

## 6. 下一步

1. 8584 双人试玩：组队、打怪、观察双方经验与名单，确认离队/传送后的提示。
2. 队伍聊天评估（需要频道与持久状态，按真实需求立项）；名单显示成员地图。
3. 继续 Alpha 0.3 的任务系统深化或组队分配规则，以试玩反馈决定先后。

## 7. 补充切片：队伍共享击杀掉落归属（2026-11-27）

**问题**：首版只共享经验，击杀掉落仍只归击杀者 30 秒；队友看得到却捡不起来，
而 30 秒后路人反而能捡，体验不合理。

**改动**：

- `PickupInput` 增加可选的 `partyMemberIds`（拾取者当前队伍成员，含本人），
  由 Room 从 `PartyRegistry` 读取并传入；资产事务的归属校验改为
  “归属者在集合内”，不新增物品行、不复制掉落。
- 拾取距离（1.5 格）、幂等命令与并发处理不变；窗口内离开队伍即失去共享资格，
  以拾取时的队伍为准。
- 客户端无需改动：附近掉落列表本来就不按归属禁用，服务端返回
  `NOT_OWNER` 时才提示；队友现在可以直接拾取。

**测试与结果**：

- 应用集成：陌生人拾取归属中的掉落被拒（`NOT_OWNER`）；队友拾取成功并入库；
  归属窗口过后任何人都能拾取。
- 服务端集成：三人组队击杀后，附近队友通过真实 Room 与拾取事务拿到
  `slime_gel`；测试按归属者挑选掉落，避免共享测试库中其他文件恢复的掉落干扰。
- 全量：73 文件、**492 测试**通过；浏览器 E2E **40/40**（客户端无改动，
  首轮 `skills.spec` 偶发超时、单跑与复跑全量均通过，属已知 TD-QA-11 抖动）。
- 50 人 × 2 分钟负载 sanity：50/50、接受率 99%、159 击杀、0 资产失败，
  tick p95 5.54ms / p99 6.12ms、资产事务 p95 58.72ms
  （`party/load-50p2a-loot.json`）；拾取只在资产事务内多一次集合判断，不进入
  tick。
- 负载后资产不变量出现 68 条过期未领取掉落（压测机器人不拾取），重启 Game
  Server 的启动清理后归零；这是既有已知行为，不是本切片的资产错误。
- 未验证：8584 双人真实浏览器拾取（服务端链路已由真实 PostgreSQL + Colyseus
  覆盖）；跨图共享掉落不做：跨图成员不在同图，自然不参与拾取。

## 8. 补充切片：过图保留队伍（2026-11-27）

**问题**：队伍状态原本只在地图 Room 内；传送是“离开旧 Room、加入新 Room”，
所以两人一起出城时队伍在传送瞬间散掉，需要重新邀请。

**改动**（ADR-036）：

- 新增进程级 `PartyService`，由 `createGameServer` 创建并注入所有地图 Room；
  队伍表、邀请与队长规则复用 `PartyRegistry`（状态机不变）。
- 在线状态由宿主 Room 上报：进入世界立即上报，之后每秒刷新等级/HP/存活/
  在线；传送时标记离线但保留席位，目标 Room 加入后恢复在线。
- 名单由在线状态构建，按“成员当前所在 Room”路由快照与邀请；被邀请者在传送
  空窗时，邀请保留并在进入新 Room 后补发。
- 真正离开世界（主动退出、宽限结束、踢下线）仍会移出队伍；Room 销毁只清理
  自己的会话。
- 共享经验与掉落仍要求同图且满足距离，跨图成员只出现在名单中。
- 队伍上限在内容 Store 启动后从 `rules.party.maxMembers` 读取，修改需重启。

**测试与结果**：

- 新增 `PartyService` 单元测试 4 条：邀请路由到被邀请者所在 Room、接受后
  刷新两个 Room、传送离线保留席位并在目的地恢复、离队与离开世界的区别。
- 服务端集成新增 1 条：主城两人组队 → 一人走到传送门 → 旧地图队友仍看到
  2 人名单（过图者短暂离线）→ 新地图恢复队伍与在线状态。
- 浏览器 E2E 更新：两人组队、离队、再组队，一人过图后双方名单仍为 2 人；
  证据 `party/party-after-transfer.png`（主城视角仍显示跨图的队友在线）。
- 全量：74 文件、**497 测试**通过；浏览器 E2E **40/40**。
- 50 人 × 2 分钟负载 sanity：50/50、98.8%、158 击杀、0 资产失败，tick p95
  4.52ms / p99 7.06ms、资产事务 p95 63.46ms
  （`party/load-50p2a-crossmap.json`）；无队伍时每秒只更新 presence，不发送
  名单消息。
- 负载后资产不变量出现 221 条过期未领取掉落（压测机器人不拾取），重启
  Game Server 的启动清理后归零；属既有已知行为。
- 未验证：8584 双人跨图试玩；进程重启仍会丢队伍（TD-SRV-11）；名单暂不显示
  成员所在地图。
