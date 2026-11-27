# Alpha 0.3 S4-A 切片报告：队伍社交（聊天、移交、踢人）

- 日期：2026-11-27
- 阶段：Alpha 0.3（多人目标与社交）
- ADR：`docs/ADR/ADR-044-party-management-and-chat.md`
- 债务：TD-CLI-17 部分关闭（剩余按名字邀请与世界内队伍标记）
- 证据：本文、`docs/phase-reports/alpha-03/party-social/`

## 1. 目标与范围

S1 交付了组队、共享经验与掉落、跨图保留，但队伍面板只有名单与「离队」：
没有队伍聊天、队长移交、踢人（TD-CLI-17）。本切片补齐这三项，让组队从
“一起打”变成“能协调、能管理”。

范围：

1. 契约：`party.transfer`、`party.kick`；`chat.send`/`chat.message` 增加可选
   `channel: 'map' | 'party'`；新增拒绝码 `PARTY_NOT_LEADER`、
   `PARTY_TARGET_NOT_MEMBER`、`PARTY_TARGET_SELF`。
2. 服务端：`PartyRegistry` 权限判定；`PartyService` 名单刷新与队伍聊天按成员
   所在 Room 投递；Room 命令解析与聊天频道处理。
3. 客户端：附近/队伍频道切换、队伍消息标签、队长的移交/踢人操作、离队或被踢
   后自动回到附近频道。
4. 不属于本切片：按名字邀请、世界内队伍标记、离线聊天记录、公会/世界频道。

## 2. 设计要点

### 2.1 权限在注册表，不在 UI

`PartyRegistry.transferLeader` / `kick` 统一判定：必须是队长、目标必须是同队
成员、不能对自己操作。Room 只解析并复用既有命令门禁（协议版本、commandId
去重、序号、限频），然后调用服务。客户端不渲染非队长的管理按钮，但隐藏按钮
不构成权限。

### 2.2 被踢者的世界状态不变

踢人移除队伍归属、丢弃其邀请，但保留 presence 与世界会话。被踢者可能在其他
地图，`PartyService.kick` 按 presence 路由刷新（而非只刷新剩余成员），其 Room
生成的快照自然为 `party: null`，面板消失。队长不能被踢，因此队伍至少保留队长。

### 2.3 队伍聊天复用聊天治理

`chat.send` 省略频道时默认 `map`，旧客户端行为不变。服务端在 `handleChat`
中判定 `party` 频道要求队伍成员身份；过滤、禁言、限频与 `clientMessageId`
去重与地图聊天共用。地图频道仍由 Room 广播；队伍频道通过 `PartyService`
向每个成员所在 Room 的端口投递，不进入公开 Room State，也不会发给同图陌生人。

### 2.4 跨图投递

成员过图后由目标 Room 注册 presence 与端口；队伍聊天按 `presence.roomId` 找到
端口。成员正在两个 Room 之间（无端口）时会漏掉消息，与名单显示“断线”一致。

### 2.5 兼容性与数据

- 协议版本不变（字段可选/默认）；无内容发布；无数据库迁移。
- 队伍仍是进程内状态（TD-SRV-11 不变），聊天不持久化。

## 3. 代码改动

| 层        | 文件                                                         | 改动                                                            |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| contracts | `packages/contracts/src/party.ts`、`realtime.ts`、`index.ts` | 新命令与拒绝码；聊天频道枚举与默认值；导出                      |
| 服务端    | `apps/game-server/src/world/partyRegistry.ts`                | `transferLeader`、`kick` 与统一拒绝原因                         |
| 服务端    | `apps/game-server/src/world/partyService.ts`                 | 移交/踢人刷新、`deliverChat`、Room 端口新增 `sendChat`          |
| 服务端    | `apps/game-server/src/rooms/worldMapRoom.ts`                 | 消息注册、移交/踢人处理、权限映射、队伍频道投递、端口发送       |
| 客户端    | `apps/game-web/src/net/worldClient.ts`                       | `sendChat(channel)`、`sendPartyTransferLeader`、`sendPartyKick` |
| 客户端    | `apps/game-web/src/session/useWorldSession.ts`               | 会话 API 与调试钩子                                             |
| 客户端    | `apps/game-web/src/screens/GameScreen.tsx`                   | 频道切换、队伍标签、队长操作、被踢后回退频道                    |
| 客户端    | `apps/game-web/src/styles.css`                               | 频道标签、成员操作样式                                          |
| 测试      | 契约/注册表/服务/Room 集成/E2E                               | 见 §4                                                           |

## 4. 测试与验证

### 4.1 新增测试

1. 契约：移交/踢人命令校验（目标必须是 UUID、拒绝客户端自报队长）、聊天频道
   默认值与非法频道。
2. 注册表：仅队长可移交/踢人、目标必须是成员、不能对自己、非成员被拒绝；
   队长移交后旧队长失去权限；被踢成员发出的邀请被丢弃；被踢者不再是成员。
3. 服务：移交/踢人后刷新相关 Room；被踢者的 Room 也收到刷新；队伍聊天按成员
   所在 Room 投递；过图间隙的成员不收消息。
4. Room 集成（真实 PostgreSQL + Colyseus）：
   - 队伍消息到达队友，且同图陌生人只收到随后的地图消息、从未收到队伍消息；
   - 队长移交给队友后，旧队长踢人被拒绝（`PARTY_NOT_LEADER`）；
   - 新队长踢掉旧队长：旧队长名单清空为 `party: null`，世界 presence 保留；
   - 被踢者再发队伍消息被拒绝（`PARTY_NOT_IN_PARTY`）；
   - 跨图保留测试追加：A 在荒野说话，B 在王城 Room 收到队伍消息。
5. E2E（真实 Chromium，双 Browser Context）：组队 → 队伍频道发言并看到标签 →
   队长移交（管理按钮随队长转移）→ 新队长踢人（旧成员面板消失、频道回退）。

### 4.2 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/party.spec.ts
pnpm exec playwright test
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：83 文件、**613 测试**通过（新增 13 条）。
- 队伍 E2E：2/2 通过（含新用例，8.8 秒）。
- 全量 E2E：**50/50 通过**（5.8 分钟）。
- 资产不变量：本切片不触碰资产事务；全量集成测试使用既有路径。
- 开发栈：84–87 已重启到本切片代码（17:11），4 个服务健康，内容
  `2026.11.27.7` 刷新无错误。

### 4.3 浏览器证据

- `docs/phase-reports/alpha-03/party-social/e2e-party-chat.png`：队友收到队伍
  频道消息与「队伍」标签。
- `docs/phase-reports/alpha-03/party-social/e2e-leader-transferred.png`：队长
  移交后，管理按钮出现在新队长一侧。
- `docs/phase-reports/alpha-03/party-social/e2e-member-kicked.png`：被踢后队长
  名单只剩一人。

## 5. 未被验证 / 已知限制

1. 跨进程/多服务器部署：队伍仍是进程内状态（TD-SRV-11）。
2. 离线消息：过图间隙或断线成员不会补收队伍消息。
3. 按名字邀请、世界内队伍成员标记：仍开放（TD-CLI-17 剩余部分）。
4. 被踢者没有单独的“你已被移出队伍”提示；剩余成员会收到系统提示。
5. 远端 CI 仍未执行（本环境无 gh）。
6. 未做容量回归：本切片不改变 tick 热路径（聊天仅在收到消息时投递，移交/踢人
   为低频命令），但未复跑 50 人负载。
7. 本轮尝试在 8584 上用脚本复验双人流程时，沙箱内的 Chromium 无法跨命令访问
   开发栈的监听端口（curl 健康检查正常）；双人流程的浏览器证据来自全量 E2E
   （同命令内启动服务与浏览器），开发栈已重启并完成 HTTP 健康检查。

## 6. 复盘

**正确**：把权限放进注册表而不是 Room/UI；被踢者保留世界会话、只清空队伍；
复用聊天治理而不是新增一套协议；跨图投递复用 ADR-036 的 presence + Room 端口。

**不足**：被踢提示只发给剩余成员，被踢者只能从面板消失推断；队伍聊天依赖
成员当前在 Room 中，没有离线队列；按名字邀请仍缺失，临时队伍只能靠附近列表。

**下一步**：TD-CLI-24 世界内到达目标标记；按名字邀请需要先定在线目录与隐私
边界；3 人副本实例先写 ADR。
