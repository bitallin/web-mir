# Alpha 0.3 S4-E 切片报告：队伍在场感与「最近同玩」

- 日期：2026-11-28
- 切片：S4-E（TD-CLI-17 主要部分收口）
- ADR：`docs/ADR/ADR-047-party-presence-markers-and-recent-teammates.md`
- 关联：ADR-035/036（组队与进程级 `PartyService`）、ADR-044（队伍聊天与权限）、
  ADR-045（好友与跨图邀请）、ADR-046（在线目录与私聊）

## 1. 目标

1. 同图队伍成员在世界与小地图上可见，玩家能快速找到队友。
2. 解散后的队伍可以通过「最近同玩」重新邀请，不需要双方先加好友，也不引入
   全局按名字搜索的骚扰面。
3. 队伍成员关系仍只存在于私有消息与进程内状态，不进入公开 Room State；没有
   协议版本、数据库或内容发布变更。

## 2. 非目标

- 不提供全局玩家搜索、离线消息、私聊历史或黑名单（TD-CLI-17 剩余）。
- 不把队伍或最近同玩持久化到 PostgreSQL（与 TD-SRV-11 一起在需要跨重启时
  再设计）。
- 不新增跨图位置提示或队友方向箭头；跨图成员只出现在队伍名单里。
- 不改变战斗、掉落、任务与资产结算。

## 3. 实现

### 3.1 契约

`packages/contracts/src/friends.ts`：

- 新增 `RECENT_TEAMMATES_MAX = 20` 与 `recentTeammateViewSchema`：
  `playerId`、`displayName`、`classId`、`level`、`online`、`lastPlayedAt`。
- `friendSnapshotSchema` 增加 `recent`（最多 20 条，缺省 `[]`），旧快照仍能
  解析；不新增客户端命令或服务端消息。

### 3.2 服务端

`apps/game-server/src/world/partyService.ts`：

- 队伍真正形成（`acceptInvite` 成功）时，为所有成员两两记录最近同玩；只发
  邀请未接受不记录。
- 每位玩家最多 20 条，超出按 `lastPlayedAt` 淘汰最旧；`recentPartners` 按最近
  时间排序，`knowsTeammate` 供邀请授权使用。
- presence 缺失的成员（过图中）跳过，下次组队刷新。

`apps/game-server/src/rooms/worldMapRoom.ts`：

- 好友快照合并最近同玩：在线时使用当前 presence 的职业/等级/名字，离线时回退
  到记录值；在线优先排序。
- 跨图/超范围邀请在好友查询前先检查最近同玩；命中时跳过数据库读取，未命中
  仍走既有 `areFriends`。陌生人行为不变。

### 3.3 客户端

- `WorldScene`：`PlayerVisual` 增加绿色椭圆环与绿色名字；只标记同图、存活、
  非自己的队伍成员，死亡与离队立即隐藏。`setPartyMembers` 按 `playerId` 匹配
  当前 AOI 实体。
- `WorldBridge`：保存最近队伍名单，场景重建（过图/重启）后重放。
- `useWorldSession`：队伍快照变化与过图后同步标记；新增调试钩子
  `partyMarkerIds()`。
- `Minimap`：队友绿色圆点与外圈，图例增加「队友」，输出
  `data-party-markers` / `data-party-ids`。
- 好友面板：新增「最近同玩」区，显示名字、等级与在线状态；离线、已在队伍或
  队伍已满时禁用「邀请」。
- 样式：队友图例与最近同行行布局；不改变现有面板位置与可折叠行为。

## 4. 隐私与权威性

- 队伍名单仍只通过 `party.snapshot` 私有消息下发；公开 `PlayerState` 不新增
  任何队伍字段。
- 最近同玩只记录真实形成过的队伍，不提供搜索接口；客户端无法枚举陌生人。
- 邀请授权仍在服务端判定，客户端隐藏/禁用按钮不构成权限控制。
- 标记是展示派生，不影响服务端移动、战斗、掉落或任务判定。

## 5. 测试与验证

- 契约：历史快照缺省 `recent` 为空；最近同玩字段校验与上限 20。
- 服务单元：接受邀请后双向可查；邀请未接受不记录；25 次组队后只保留最新
  20 条。
- 服务集成（真实 PostgreSQL + 两个真实 Room）：组队 → 解散 → 好友快照出现
  最近同玩 → 成员过图 → 非好友跨图邀请成功并重新组队。
- 浏览器 E2E：组队后双方小地图 2 个队伍标记、世界标记只含对方；解散后变为
  1/0；好友面板「最近同玩」可重新邀请；过图后跨图成员不再有世界标记。
- 全量结果（本轮）：**633 个单元/集成测试通过**、**51/51 浏览器 E2E** 通过；
  构建、lint 与类型检查通过。

## 6. 证据

| 文件                                                                 | 内容                                 |
| -------------------------------------------------------------------- | ------------------------------------ |
| `docs/phase-reports/alpha-03/party-presence/dev-8584-markers.png`    | 8584 实测：队友绿环/绿色名字与小地图 |
| `docs/phase-reports/alpha-03/party-presence/dev-8584-recent.png`     | 8584 实测：好友面板「最近同玩」入口  |
| `docs/phase-reports/alpha-02/party/party-formed.png`                 | 组队后小地图队友图例与标记           |
| `docs/phase-reports/alpha-02/party/party-recent.png`                 | E2E：好友面板「最近同玩」与邀请入口  |
| `docs/phase-reports/alpha-02/party/party-after-transfer.png`         | 跨图保留队伍、跨图成员不显示世界标记 |
| `docs/phase-reports/alpha-03/party-presence/load-50p2a.json`         | 50 人 × 2 分钟容量 sanity            |
| `docs/phase-reports/alpha-03/party-presence/database-invariants.txt` | 容量压测后的资产不变量报告           |

## 7. 验收结果

- `pnpm test`：86 个测试文件、633 个测试通过。
- `pnpm test:e2e`：**51/51 通过（6.1 分钟，退出码 0）**；组队 spec 单跑 2/2。
- `pnpm lint` / `pnpm typecheck` / `pnpm build`：全部通过（Node 26）。
- 开发栈：84–87 已重启到本切片代码，4 个服务 `/health/ready` 200，Game Server
  内容 `2026.11.27.7` 刷新无错误。
- 8584 实测：两个真实浏览器上下文组队后看到绿色脚环、绿色名字、小地图队友点
  与「队友」图例；一人离队后好友面板出现「最近同玩」与可用「邀请」按钮。
- 容量：50 人 × 2 分钟 **50/50**、接受率 98.6%、191 击杀、**0 资产失败**；
  tick p50 1.38ms / p95 **3.62ms** / p99 5.75ms / max 8.94ms；资产事务 p95
  61.85ms（`party-presence/load-50p2a.json`）。
- 资产不变量：钱包/账本、负余额、装备槽、背包槽、地面/掉落一致性 7/7 为 0。

## 8. 已知限制

- 最近同玩为进程内状态，进程重启/换服后清空（TD-SRV-15）。
- 跨图队友不会显示世界标记或方向箭头；只在队伍名单中显示在线状态。
- 玩家之间仍无碰撞，出生点重叠时世界标记可能被彼此角色遮挡。
- 私聊/邀请仍无离线消息、黑名单或历史。
