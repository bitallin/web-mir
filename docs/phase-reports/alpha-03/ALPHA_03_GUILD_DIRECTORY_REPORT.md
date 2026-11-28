# Alpha 0.3 S5-B：行会目录与入会申请报告

- 日期：2026-11-28
- 切片：行会目录、入会申请、会长审批
- ADR：`docs/ADR/ADR-049-guild-directory-and-join-applications.md`
- 证据：`docs/phase-reports/alpha-03/guild/`

## 1. 目标

S5-A 的行会只能由在线会长邀请，玩家无法主动发现行会。本切片按试玩反馈交付：

1. 点击「行会」时，未入会玩家能看到本区服所有行会（名称、会长、人数）。
2. 玩家可以向任意未满行会提交入会申请；重复申请幂等。
3. 会长在行会面板看到待处理申请，可接受或拒绝；接受后申请人立即成为成员。
4. 申请持久化：会长离线时提交的申请在其上线后仍可处理。
5. 目录只暴露公开摘要；成员名单、在线状态与申请列表保持私有。

## 2. 设计要点

- 新表 `guild_applications`：`(guild_id, character_id)` 唯一，角色/行会删除级联；
  一个角色可同时申请多个行会，接受其中一个时清理其余申请。
- 新命令 `guild.directory`、`guild.apply`、`guild.apply.accept`、
  `guild.apply.decline`；新消息 `guild.directory`；`guild.snapshot` 增加默认空
  的 `applications`，仅会长可见。
- 目录摘要只包含行会 id、名称、会长名、成员数/上限与“当前玩家是否已申请”；
  按人数降序、创建时间升序，最多 50 条。
- 申请前置：未加入任何行会、同区服、行会未满；满员返回 `GUILD_FULL`，
  已有行会返回 `GUILD_ALREADY_IN_GUILD`。
- 接受在事务内锁行会行、复核申请人未加入其他行会与人数上限，插入成员并删除
  申请人的全部申请；申请人已加入其他行会时删除过期申请后返回
  `GUILD_ALREADY_IN_GUILD`（删除在事务内提交，错误在提交后抛出）。
- 拒绝删除该申请并通知申请人；重复处理返回 `GUILD_APPLICATION_NOT_FOUND`。
- 申请提交时向在线会长推送 `guild.refresh` 与提示；会长离线时申请保留，
  上线后的快照携带申请。

## 3. 改动文件

- 契约：`packages/contracts/src/guild.ts`、`guild.test.ts`、`realtime.ts`、
  `index.ts`（目录/申请 schema、两条命令、拒绝码）。
- 持久化：`schema/guilds.ts`、`repositories/guilds.ts`、迁移 `0013`。
- 应用：`game-application/src/guildService.ts`（目录、申请、审批、拒绝）与
  `index.ts` 导出。
- 服务端：`rooms/worldMapRoom.ts`（命令、目录快照、会长申请列表、通知）。
- 客户端：`net/worldClient.ts`、`session/useWorldSession.ts`、
  `screens/GameScreen.tsx`、`global.d.ts`、`styles.css`。
- 测试：`packages/game-application/test/guildService.integration.test.ts`、
  `apps/game-server/test/guild.integration.test.ts`、`tests/e2e/guild.spec.ts`。
- 工具：`apps/game-server/scripts/worldScenario.ts` 为移动目标增加传送门路径
  检查，并在报告写完后显式退出，避免压测进程悬挂。

## 4. 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/guild.spec.ts
pnpm test:e2e
pnpm build
pnpm db:migrate
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/guild/load-50p2a-directory.json \
  pnpm --filter @web-legend/game-server load:scenario
```

- 格式 / lint / 类型检查：通过（本容器实际 Node v24.22.2；Node 26 安装不完整）。
- 单元/集成：89 文件、**659 测试**通过（较 S5-A 的 650 增加 9）。
- 行会 E2E：1/1 通过（16.2 秒）；全量 **52/52 通过（6.3 分钟）**。
- 构建：通过。
- 容量：50 人 × 2 分钟 50/50、接受率 98.8%、201 击杀、0 资产失败；
  tick p50 1.42ms / p95 **3.8ms** / p99 5.12ms / max 5.76ms；资产事务
  p95 52.49ms（`guild/load-50p2a-directory.json`）。
- 资产不变量：7/7 为 0（`guild/database-invariants.txt`）。
- 开发栈：迁移 `0013` 已应用；84–87 已重启到本切片代码，4 个健康 200；
  8584 双浏览器实测目录→申请→会长接受→名单 2 人通过
  （`guild/dev-8584-guild-directory.png`）。

## 5. 发现并修正的问题

1. **过期申请删除被事务回滚**：接受申请时若申请人已加入其他行会，最初在事务
   内删除申请后直接抛错，删除随错误回滚，申请残留。改为事务提交“已加入其他
   行会”的标记，提交后再抛 `GUILD_ALREADY_IN_GUILD`，删除得以保留。
2. **压测机器人被传送门带走**：全量容量首跑有 4 名机器人在 2 分钟内走进主城
   传送门，`wilds.players` 只有 46，触发“未全部留在野区”的断言。移动目标与
   攻击接近路径现在先做一次八方向寻路，路径经过传送门就改选安全目标；复跑
   50/50、0 资产失败。
3. **压测脚本写完报告不退出**：SDK 在传送后残留的定时器/套接字让脚本在报告
   写完后继续存活；在 teardown 末尾显式 `process.exit`，并用 2 人 3 秒冒烟
   验证立即退出。
4. **全量 E2E 的 combat 抖动**：首轮全量在 `combat.spec.ts` 技能冷却断言失败，
   单跑与次轮全量通过；属于既有共享刷点/时序抖动（TD-QA-11），本轮未降低
   断言。

## 6. 未验证与后续

- 真人长时间试玩；大量行会（>50）的目录分页与搜索、申请过期与限制。
- 行会公告、副会长/职位、改名与成员审批流（TD-CLI-25 剩余）。
- 申请无 TTL、目录无分页/搜索（TD-SRV-18）。
- 远端 CI 与 Node 26 复跑仍待环境支持。

## 7. 复盘

**做得对的**：目录与申请分离——目录只读公开摘要，申请持久化并只对会长可见；
接受时把“加入”与“清理其他申请”放在同一事务，避免一人多会。申请提交只通知
会长，不广播给全体成员，减少无关流量。

**不够好的**：申请没有过期与数量限制，目录固定 50 条且不能搜索；这些在有
真实行会规模前不应急着做，但必须记录触发条件。压测脚本的两处问题说明测试
工具也需要像产品代码一样验证退出与边界。

**下一次**：观察试玩是否真的需要搜索/公告；交易最小版仍应先写 ADR。正式美术
与远端 CI 持续开放。

## 8. 提交

- `8100200` `feat(alpha-03): add a guild directory and join applications`。
- `5b765d2` `fix(game-server): keep load bots off the portal and exit cleanly`。
- 文档提交：ADR-049、本报告、执行计划、状态、日志、债务与演进记录。
