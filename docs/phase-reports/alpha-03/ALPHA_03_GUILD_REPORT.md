# Alpha 0.3 S5-A：行会最小闭环报告

- 日期：2026-11-28
- 切片：创建行会、跨图邀请、名单、离会/踢人/解散、行会频道
- ADR：`docs/ADR/ADR-048-guilds-persistence-roles-and-chat.md`
- 证据：`docs/phase-reports/alpha-03/guild/`

## 1. 目标

行会是把一次性组队关系变成长期归属的社交结构。本切片交付一个可独立验收的
最小闭环：

1. 玩家可以在主城（任意地图）创建行会，归属在重启、过图与重新登录后保留。
2. 会长可以邀请在线玩家；被邀请者可以接受或拒绝；邀请跨地图可达。
3. 成员可以查看行会名单与在线状态；会长可以踢人与解散；成员可以离会。
4. 会长离会时行会交给最早加入的成员；最后一人离会时行会自动解散。
5. 行会频道只对成员可见，跨地图可读，复用既有聊天治理链。

本切片明确不做：金币创建费、行会资金/等级、入会申请、公告、副会长/职位、
改名与全局搜索。

## 2. 设计要点

### 2.1 持久化与权限

- 迁移 `0012_smart_starbolt.sql` 新建 `guilds` 与 `guild_members`。
- `guilds(realm_id, name_normalized)` 唯一；`guild_members.character_id`
  唯一，确保一人一行会；`guild_id` 上的部分唯一索引确保每会至多一个会长。
- 创建/加入/离会/踢人/解散都在一个 PostgreSQL 事务内完成；加入与离开先
  `SELECT ... FOR UPDATE` 锁行会行，避免并发超员或双会长。
- 行会名与角色名同规则：NFKC、去首尾空白、2–12 字符、字母/数字/汉字/下划线；
  归一化后小写作为唯一键。
- 创建要求角色 ≥ 5 级；邀请与加入要求同区服。

### 2.2 邀请与在线状态

- 邀请保存在进程级 `GuildInviteService`，30 秒过期，每个目标只保留最新一条；
  与队伍邀请同层，不进入数据库。
- 邀请通过 `PlayerDirectory` 投递到目标所在 Room；目标过图时邀请保留，
  重新加入后由新 Room 重发。
- 名单的在线、等级、职业与存活状态在生成快照时从 presence 合并；数据库只
  保存归属与职位。加入/最终离开世界时向在线行会成员推送 `guild.presence`。

### 2.3 协议与频道

- 新命令：`guild.create/invite/accept/decline/leave/kick/disband/list`。
- 新消息：`guild.snapshot/invite/presence/refresh`。
- `chat.send`/`chat.message` 的频道增加 `guild`；省略频道仍是地图聊天，
  协议版本不升级。
- 行会聊天只投递给在线成员（跨图由目录投递），复用过滤、限频、禁言与去重；
  不落库、不进入公开 Room State。

### 2.4 客户端

- 状态板新增「行会」入口与邀请角标；行会面板右侧停靠，不遮挡玩家与画面中心。
- 未加入时提供名称输入与创建按钮；已加入时显示行会名、人数、会长、名单、
  在线状态、离会/解散/踢出。
- 附近玩家列表为会长提供「邀请入会」；聊天标题栏与发言频道增加「行会」，
  未加入时禁用，离会/解散/被踢后自动回到「附近」。

## 3. 改动文件

- 契约：`packages/contracts/src/guild.ts`、`guild.test.ts`、`realtime.ts`、
  `index.ts`。
- 持久化：`schema/guilds.ts`、`repositories/guilds.ts`、迁移 `0012`；
  `findCharacterById` 参数放宽为 `DbExecutor`，允许在事务内读取角色。
- 应用：`packages/game-application/src/guildService.ts` 与集成测试。
- 服务端：`world/guildInvites.ts`、`playerDirectory.ts`、
  `rooms/sessionRegistry.ts`、`rooms/worldMapRoom.ts`、`server.ts`。
- 客户端：`net/worldClient.ts`、`session/useWorldSession.ts`、
  `screens/GameScreen.tsx`、`global.d.ts`、`styles.css`。
- 测试：`apps/game-server/test/guild.integration.test.ts`、
  `tests/e2e/guild.spec.ts`。

## 4. 验证

### 4.1 自动化

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/guild.spec.ts
pnpm test:e2e
pnpm build
```

- 格式 / lint / 类型检查：通过。本容器实际可用的 Node 为 v24.22.2（声明
  `engines >=26`，但 nvm 目录中的 v26 安装不完整）；Node 26 下的复跑仍需在
  具备该版本的环境确认。
- 单元/集成：89 文件、**650 测试**通过（较 S4-E 的 633 增加 17）。
- 行会 E2E：1/1 通过（13.2 秒）；全量 **52/52 通过（6.2 分钟）**。
- 构建：通过。

### 4.2 容量与资产

50 人 × 2 分钟（`guild/load-50p2a.json`）：

- 50/50 加入，接受率 **98.7%**，拒绝码 `COOLDOWN` 108、`TARGET_DEAD` 71；
- 195 击杀，0 资产失败；
- tick p50 1.41ms / p95 **3.64ms** / p99 5.56ms / max 6.03ms；
- 资产事务 p95 57.15ms；
- 资产不变量 7/7 为 0（`guild/database-invariants.txt`）。

### 4.3 开发栈实测

- 迁移 `0012` 已应用到开发库；84–87 已重启到本切片代码，4 个 `/health/ready`
  200；Game Server 内容 `2026.11.27.7` 刷新无错误。
- 8584 双浏览器真实流程：创建行会 → 邀请同图玩家 → 接受 → 名单 2 人 →
  行会频道消息成功；截图 `guild/dev-8584-guild.png`。

## 5. 发现并修正的问题

1. **会长转让违反唯一索引**：最初先提升新会长再删除旧会长，触发
   `guild_members_single_leader` 唯一索引。改为在同一事务内先删除旧会长行，
   再提升继承人；并用真实 PostgreSQL 测试覆盖。
2. **继承人查询包含自己**：`findOldestGuildMemberId` 最初返回最早加入的
   会长本人，导致会长离会错误地解散行会。增加排除参数并补测试。
3. **跨图 E2E 快照竞态**：会长名单刷新在成员接受时同时到达，测试却在之后才
   订阅；改为在发出接受前同时订阅两侧快照。
4. **HUD 高度超出预算**：新增「行会」按钮使状态板达到 203px，超过
   `hud.spec.ts` 的 200px 上限。收紧操作行间距与按钮内边距，而非放宽断言。

## 6. 未验证与后续

- 真人长时间试玩；邀请过期、过图期间邀请、会长离会后新会长的完整体验。
- 多人行会（>10 人）名单滚动与频道负载；当前容量 sanity 的机器人不组队。
- 远端 CI 仍待确认（本环境无 `gh`）。
- 本容器只有 Node v24.22.2；项目声明的 Node 26.13.1 安装不完整，门禁未在
  26 下复跑（与代码无关的环境差异）。
- 行会经济、职位、公告、申请与改名：TD-ECO-05、TD-CLI-25。
- 邀请与在线状态进程内：TD-SRV-16；行会聊天每消息查询成员表：TD-SRV-17。

## 7. 复盘

**做得对的**：把“持久归属”和“在线状态”分开——数据库保存行会与职位，
presence 只影响快照显示。这样不必把在线状态写入持久模型，也复用了
`PlayerDirectory` 的跨图投递。权限与生命周期集中在应用服务事务中，Room 只做
命令门禁、presence 合并与路由，符合“Room 只做适配”。

**不够好的**：行会聊天为了正确性每条消息查询成员表；在 30 人上限与低频使用
下可接受，但应在频道成为主通路前加缓存或专用频道服务。邀请仍是进程内状态，
与队伍/首领同类，多进程前必须统一设计。

**下一次**：先观察试玩是否真的需要“申请入会/公告”，再决定社交层级；经济
切片再把创建费、行会资金与成员上限内容化，避免为未验证的需求先加复杂度。

## 8. 提交

- `0dfebf4` `feat(alpha-03): add persistent guilds with invites and guild chat`
  （契约、迁移、应用服务、Room/目录、客户端、测试与 E2E）。
- 文档提交：ADR-048、本报告、执行计划、状态、日志、债务与演进记录。
