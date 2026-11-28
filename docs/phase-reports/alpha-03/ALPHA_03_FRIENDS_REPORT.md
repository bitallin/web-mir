# Alpha 0.3 S4-B 切片报告：好友系统与聊天频道筛选

- 日期：2026-11-28
- 阶段：Alpha 0.3（多人目标与社交）
- ADR：`docs/ADR/ADR-045-friends-presence-and-friend-invites.md`
- 债务：TD-CLI-17 进一步关闭（附近加好友、好友跨图邀请）；新增 TD-SRV-14
- 证据：本文、`docs/phase-reports/alpha-03/friends/`

## 1. 目标与范围

用户已确认社交顺序：频道筛选 + 好友（申请/列表/在线状态/邀请组队）→ 私聊 →
行会。本切片交付第一阶段；行会/私聊频道不提前展示空入口。

范围：

1. 持久化好友关系（`friendships`，迁移 `0011`）。
2. 好友命令：申请、接受、拒绝、删除、刷新列表；跨图通知。
3. 在线状态：复用进程级 presence，上下线事件推送给在线好友；好友快照合并
   在线/等级/存活。
4. 好友组队：同图近距离规则不变；跨图或超范围只允许已接受好友（目标在线）。
5. 客户端：好友面板（申请、已发送、在线列表、邀请、删除）、附近玩家「加好友」
   与未处理申请角标。
6. 聊天日志筛选：全部 / 附近 / 队伍，纯客户端展示。
7. 不属于本切片：私聊、行会、世界频道、黑名单/举报、按名字搜索、拉黑。

## 2. 设计要点

### 2.1 关系持久化，状态实时

好友关系落 PostgreSQL；在线状态不落库。快照中的在线标志来自当前进程的
presence，离线玩家信息来自数据库。这样“好友关系”可以跨重启，而“是否在线”
永远不会因为一行旧数据而撒谎。

### 2.2 无序对与幂等

`friendships` 以 `(low_character_id, high_character_id)` 唯一，发起方单独记录。
重复申请返回同一行；重复接受返回同一关系；双方互相申请时自动成为好友。拒绝
删除 pending 行，删除好友删除 accepted 行。检查约束保证 low < high、发起方属于
该对、pending 与 responded_at 一致。

### 2.3 复用 presence，而不是再造一份

每个地图 Room 每秒上报所有会话的等级/HP/在线状态（ADR-036）。好友快照直接
读取这份 presence；加入/真正离开世界时向在线好友推送 `friend.presence`，过图
不发送离线事件。好友关系变化时，对方在线则收到 `friend.refresh`，其客户端
重新拉取快照。

### 2.4 好友跨图组队

`party.invite` 的目标校验改为：目标必须在线且不在队伍中；同图 15 格内维持原
规则；跨图或超范围时异步查询好友关系，只有好友可以通过。拒绝仍然发生在
创建邀请之前，目标的接受流程、跨图保留与名单完全复用 ADR-035/036。

### 2.5 聊天筛选只是展示

新增「全部 / 附近 / 队伍」筛选按钮，只影响本地渲染。服务器仍只向有权限的玩家
投递队伍消息；客户端过滤不承担隐私职责。

### 2.6 修复幽灵在线

实现过程中发现：未加入队伍的玩家离开世界后，presence 从未清理，好友列表可能
显示“在线”，跨图邀请也可能落到已经离开的 Room。现在最终离开世界时无条件调用
`PartyService.removePlayer` 清理 presence；过图只 `markOffline`，由目标 Room
重新上报。

## 3. 代码改动

| 层     | 文件                                                                            | 改动                                                        |
| ------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 持久化 | `packages/persistence/src/schema/friendships.ts`、`repositories/friendships.ts` | 新表、约束、关系/申请/资料查询                              |
| 迁移   | `packages/persistence/migrations/0011_flawless_amazoness.sql`                   | 新建 `friendships`；无数据回填                              |
| 契约   | `packages/contracts/src/friends.ts`、`realtime.ts`、`index.ts`                  | 好友视图/命令/事件、拒绝码与消息名                          |
| 应用   | `packages/game-application/src/friendsService.ts`、`errors.ts`                  | 关系事务、幂等收敛、`SocialError`                           |
| 服务端 | `apps/game-server/src/world/friendNotifier.ts`                                  | 进程级好友事件路由（presence → Room 端口）                  |
| 服务端 | `apps/game-server/src/rooms/worldMapRoom.ts`、`sessionRegistry.ts`              | 好友命令与快照、上下线通知、好友跨图邀请、离开清理 presence |
| 服务端 | `apps/game-server/src/server.ts`                                                | 进程级 `FriendNotifier` 注入                                |
| 客户端 | `apps/game-web/src/net/worldClient.ts`、`session/useWorldSession.ts`            | 好友消息、命令、状态与调试钩子                              |
| 客户端 | `apps/game-web/src/screens/GameScreen.tsx`、`styles.css`                        | 好友面板、加好友、申请角标、聊天筛选                        |
| 测试   | 契约 / 应用集成 / Room 集成 / E2E                                               | 见 §4                                                       |

## 4. 测试与验证

### 4.1 新增测试

1. 契约：好友快照、申请视图、presence/refresh、好友命令；拒绝未知字段与
   客户端自报关系状态。
2. 应用（真实 PostgreSQL）：
   - 申请→接受→双方列表、重复接受幂等、删除与重复删除；
   - 重复申请收敛、互相申请自动成为好友；
   - 自己/不存在目标/非参与者接受/重复拒绝的错误码；
   - 已是好友时再次申请返回 `FRIEND_ALREADY_FRIENDS`，删除后可重新申请。
3. Room 集成（真实 PostgreSQL + Colyseus）：
   - 好友申请通过 `friend.refresh` 到达对方，对方拉取快照并接受；
   - 双方列表出现好友并显示在线；
   - 好友过图后仍在线；跨图组队邀请成功并形成 2 人队伍；
   - 同图但超出范围的非好友邀请返回 `PARTY_TARGET_UNAVAILABLE`。
4. E2E（真实 Chromium，双 Browser Context）：附近玩家加好友 → 对方申请列表
   接受 → 双方好友列表在线 → 好友列表邀请组队 → 队伍成立 → 地图/队伍消息
   与频道筛选。

### 4.2 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
pnpm exec playwright test tests/e2e/friends.spec.ts
pnpm exec playwright test
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：85 文件、**623 测试**通过（新增 10 条）。
- 好友 E2E：1/1 通过（13.2 秒），全量套件 51/51。
- 容量 sanity：50 人 × 2 分钟 50/50、接受率 98.7%、202 击杀、0 资产失败；
  tick p50 1.38ms / p95 **3.6ms** / p99 4.36ms / max 4.89ms；资产事务
  p95 54.8ms。证据 `friends/load-50p2a.json`。
- 迁移 `0011` 已应用到开发库；E2E 使用独立库并在启动时迁移。

### 4.3 浏览器证据

- `docs/phase-reports/alpha-03/friends/e2e-friend-request.png`：申请出现在好友
  面板。
- `docs/phase-reports/alpha-03/friends/e2e-friend-list.png`：好友在线列表与
  在线计数。
- `docs/phase-reports/alpha-03/friends/e2e-chat-filter.png`：仅显示队伍频道的
  筛选结果。
- `docs/phase-reports/alpha-03/friends/load-50p2a.json`：50 人 × 2 分钟容量
  sanity。

## 5. 未被验证 / 已知限制

1. 好友关系与 presence 仍为单进程：多进程前需要共享在线目录（TD-SRV-14，
   与 TD-SRV-11 同类）。
2. 没有黑名单、举报、离线消息、好友分组或最近同玩；按名字搜索未实现。
3. 好友申请只有命令限频，没有单独的每日上限/冷却；试玩后视骚扰情况补充。
4. 好友列表没有分页；线上限 200 条，超出部分不展示。
5. 只跑了 50 人 × 2 分钟 sanity，没有 10 分钟正式回归；好友命令不在 tick 内，
   presence 仍是每秒一次。
6. 远端 CI 仍未执行（本环境无 gh）。
7. 被好友邀请仍需对方在线；离线好友不能收到组队邀请（没有离线队列）。

## 6. 复盘

**正确**：关系入库、状态实时；无序对与条件更新让重复申请/接受自然收敛；复用
presence 而不是再造一份；好友规则只放宽“距离”，不改变队伍创建、接受、共享
奖励与跨图保留的既有语义；聊天筛选明确放在展示层。

**不足**：发现并修复了 presence 生命周期的历史漏洞——这是一个“共享事实没有
唯一所有者”的典型问题，说明 TD-SRV-14 的提取应在私聊/公会前完成。好友申请
缺少年度上限与黑名单，按名字查找与离线消息也尚未提供。

**下一步**：私聊（好友/最近同玩入口、跨图投递、隐私与限频）；随后行会 ADR；
世界内到达目标标记与按名字邀请可作为小切片穿插。
