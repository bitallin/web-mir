# Alpha 0.3 S4-C：好友私聊与进程级在线目录

- 日期：2026-11-28
- 范围：Alpha 0.3 S4-C
- ADR：`docs/ADR/ADR-046-player-directory-and-friend-whispers.md`
- 证据：`docs/phase-reports/alpha-03/friends/e2e-whisper.png`、本文命令输出
- 前置：ADR-044/045（队伍聊天、好友与在线状态）、TD-SRV-14

## 1. 目标

好友列表已经能跨图邀请组队，但玩家之间仍不能在离开视野后单独沟通。本切片
交付一对一私聊：从好友列表发起、跨地图投递、仅好友可见、复用聊天治理链；
同时按 TD-SRV-14 把在线状态与跨 Room 路由从 `PartyService` 提取为独立的
`PlayerDirectory`，供队伍、好友与后续行会共用。

## 2. 实际改动

### 2.1 进程级 PlayerDirectory

- 新增 `apps/game-server/src/world/playerDirectory.ts`：
  - `PlayerPresence`（角色、名字、职业、等级、HP、存活、在线、当前 Room）。
  - `PlayerDelivery` 闭集联合：聊天、组队邀请、队伍名单刷新、好友事件。
  - `setPresence` / `markOffline` / `removePlayer` / `presenceOf` /
    `deliver` / `deliverMany` / `registerRoom` / `unregisterRoom`。
- `PartyService` 只保留队伍注册表，构造时注入目录；presence、端口与跨 Room
  投递全部移除。`FriendNotifier` 删除，好友刷新与上下线事件改由目录投递。
- Room 只注册一个投递端口，`deliverToPlayer` 按投递类型解码；跨 Room 状态不
  进入公开 Room State。

### 2.2 私聊协议

- `CHAT_CHANNELS` 追加 `whisper`；`chat.send` 增加可选 `targetPlayerId`，
  `chat.message` 增加可选 `targetPlayerId` / `targetDisplayName`。
- schema 强制：私聊必须带目标；其他频道不得携带目标。旧客户端省略频道仍是
  地图聊天，协议版本不变。
- 服务端 `handleChat` 复用过滤、限频、禁言与 `clientMessageId` 去重；私聊分支
  异步校验好友关系，再按目录投递给收件人，同时向发送者回显同一条消息。
- 离线、非好友、自己与目录无法投递统一返回 `CHAT_TARGET_UNAVAILABLE`，不泄露
  对方是否在线；关系查询失败返回 `SERVICE_UNAVAILABLE`。
- 消息不落库、不进入公开状态；发送者与收件人收到相同 `messageId`。

### 2.3 客户端

- 好友行新增「私聊」：选中目标、发言频道切到私聊、日志筛选切到私聊。
- 发言频道选择器新增「私聊·名字」，输入提示显示发送对象。
- 私聊行显示「→ 名字」（自己发出）或「私聊」（收到）；日志默认“全部”仍同时
  显示附近、队伍与私聊。
- 目标离线、被删除好友或好友快照变化时，自动清空目标并回到附近频道。

## 3. 测试与证据

### 3.1 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/friends.spec.ts
pnpm exec playwright test tests/e2e/party.spec.ts tests/e2e/hud.spec.ts
pnpm exec playwright test
pnpm build
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/whisper/load-50p2a.json pnpm load:scenario
```

- 格式 / lint / 类型检查：通过。
- 单元/集成：85 文件、**626 测试**通过（新增 3 条：2 条契约、1 条真实 Room +
  PostgreSQL 跨图私聊；`PartyService` 测试改为通过目录写入 presence）。
- 好友 E2E：1/1 通过（新增私聊收发、标签与地图频道隔离断言）。
- 队伍 + HUD E2E：6/6 通过。
- 全量 E2E：**51/51 通过（6.1 分钟）**。
- 构建：通过（全部 workspace 包）。
- 容量 sanity：50 人 × 2 分钟 50/50、接受率 98.9%、206 击杀、0 资产失败；
  tick p50 1.4ms / p95 **4.04ms** / p99 5.82ms / max 6.88ms；资产事务 p95
  59.14ms（`docs/phase-reports/alpha-03/whisper/load-50p2a.json`）。
- 资产不变量：7/7 为 0（压测后复跑）。

### 3.2 全量门禁

全量浏览器 E2E 51/51 通过（6.1 分钟，退出码 0），构建与 50 人 × 2 分钟容量
sanity 均通过；压测后资产不变量 7/7 为 0。

## 4. 覆盖的关键性质

1. 跨图：Alice 在野外、Bob 在主城，私聊仍能双向送达；发送者回显与收件人
   消息的 `playerId` / `targetPlayerId` / `targetDisplayName` 一致。
2. 隐私：陌生人私聊返回 `CHAT_TARGET_UNAVAILABLE`，不会泄露对方在线状态；
   地图频道收不到私聊。
3. 生命周期：Bob 离开世界后，Alice 的好友快照先变为离线，再私聊返回同一拒绝码。
4. 目录：过图只标记离线、最终离开才移除；队伍与好友的跨图投递继续工作。
5. 兼容：省略 `channel` 的旧客户端仍是地图聊天；私聊字段是加法扩展。

## 5. 已知缺口与后续

- 私聊只在双方同时在线时交付，没有离线消息、历史记录、黑名单或“最近同玩”
  入口；过图/重连会丢失客户端聊天记录（TD-CLI-04）。
- 按名字搜索/邀请仍属 TD-CLI-17 的剩余部分；行会频道先写 ADR。
- 在线目录仍为进程内状态（与 TD-SRV-11 同类）；多进程前需要共享协调。
- 容量只跑了 50 人 × 2 分钟 sanity：本切片不改变 tick 循环的每帧工作量，
  私聊只在事件路径增加一次好友查询与一次目录投递；正式 10 分钟回归在下一轮
  统一执行。
