# Web Legend 项目状态

> 更新日期：2026-11-24
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 4：怪物、战斗和技能 —— 实现完成，自动化验收通过；待用户在 8584 端口
实测确认。**

阶段 0、阶段 1、阶段 2、阶段 3 已通过用户验收。阶段 4 的领域、协议、服务端、
客户端和测试均已交付；在用户实测通过前不标记“阶段完成”，也不进入阶段 5。

## 2. 阶段进度

| 阶段                           | 状态   | 说明                                                                 |
| ------------------------------ | ------ | -------------------------------------------------------------------- |
| 阶段 0：工程底座               | 已完成 | 工程、依赖、质量门禁、数据库、健康检查、文档                         |
| 阶段 1：双浏览器联机切片       | 已完成 | 测试地图、world_map Room、服务端移动、双浏览器可见、重连、HUD、E2E   |
| 阶段 2：账号与票据             | 已完成 | 账号/会话、Argon2id、角色、一次性 ticket、角色租约、位置持久化、E2E  |
| 阶段 3：地图与世界状态         | 已完成 | Tiled 地图、map-runtime、地图实例/传送、AOI、节流 checkpoint、聊天   |
| 阶段 4：怪物与战斗             | 待实测 | 实现与自动化验收完成：game-domain、两种怪物、技能、CombatEvent、复活 |
| 阶段 5：掉落与资产持久化       | 未开始 | 等待阶段 4 用户验收                                                  |
| 阶段 6：聊天、PK 与体验        | 未开始 | —                                                                    |
| 阶段 7：运营后台与内容发布     | 未开始 | —                                                                    |
| 阶段 8：质量、压测、部署与恢复 | 未开始 | —                                                                    |

## 3. 当前正在进行的任务

阶段 4 用户实测验收：在 `http://<LAN-IP>:8584/` 进入野外，确认点击怪物、普攻、
技能、冷却、双人同一 HP、怪物死亡与 8 秒重生。验收通过后启动阶段 5。

## 4. 已完成内容

### 阶段 0 保留内容

- pnpm workspace Monorepo；Node.js 26.13.1、pnpm 11.7.0、TypeScript 5.9.3。
- ESLint 依赖边界、Prettier、Vitest、Playwright、Vite/tsup 构建。
- PostgreSQL 18 + Drizzle 迁移；Fastify Control API；Colyseus 健康检查与
  diagnostics Room；Pino 日志与脱敏。
- 工程文档、ADR-001…014、阶段 0 报告。

### 阶段 1 保留内容

- `contracts` 的实时协议、严格 join 校验、world-state schema。
- `game-simulation`：固定 tick、四方向 BFS、整数子格移动推进。
- `world_map` Room：20Hz 模拟、服务端权威移动、幂等、限频、重连。
- 伪等距 Phaser 世界、React HUD、本地预测与远端插值。
- 双人可见、刷新重连、断线恢复、Scene 重启、局域网 HTTP 的 E2E。

### 阶段 2 保留内容

- 账号/密码/登录/注册 schema、职业目录、角色名归一与唯一、一次性 ticket。
- `auth`：Node 26 内置 Argon2id、256 bit 令牌、refresh 轮换。
- `persistence`：accounts、account_sessions、characters、character_sessions、
  game_tickets 与仓储；区服 seed。
- `control-api`：注册/登录/刷新/登出、/me、区服、角色、ticket；HttpOnly Cookie、
  CSRF Origin、16KB body、认证限频。
- `game-server`：票据原子消费、区服/角色校验、单角色租约、位置恢复。
- 登录/角色选择/世界三段式页面；E2E 与数据库证据。

### 阶段 3：正式地图、服务端移动和世界状态

`content/`：

- Tiled 源图 `starter_town`（40×30）与 `starter_wilds`（44×32），图层
  `ground`/`deco_low`/`deco_high`/`collision`，对象层 `spawn_points`/
  `portals`/`npc_points`/`monster_spawns`。
- 编译产物 `content/maps/compiled/*.json`，含 checksum、asset manifest 版本；
  `pnpm maps:compile` 可重建，测试校验产物新鲜度。
- `content/assets/manifest.json` 与生成的占位 tileset/角色贴图（8 个 tile、
  2 帧 × 4 方向）。

`packages/contracts`：

- 编译地图 schema、`worldRoomNameFor`、`mapIdFromRoomName`、`/maps` 子路径。
- asset manifest schema。
- `chat.send`/`chat.message`/`session.transfer`；patch 间隔 50ms。
- `WorldState` 增加 `instanceId`、HP/MP；`players` 集合 `.view()` 支持 AOI。
- 移除阶段 1 技术地图与 `mapManifestSchema`。

`packages/map-runtime`（新包）：

- Tiled 解析、图层/碰撞/对象校验、跨图传送校验、可达性校验、SHA-256 checksum。
- 运行时导航格、传送门查询、单位坐标转 tile。
- 9 个测试，包含真实双图编译与非法地图用例。

`packages/game-simulation`：

- `InterestManager`：8×8 tile 分格、radius 1、增量视图更新。
- AOI 单元测试；移动/寻路测试改为本地夹具，不再依赖已退役技术地图。

`packages/persistence`：

- `saveCharacterTransfer` 事务写入地图/坐标/朝向/HP/MP。
- `relocateCharactersFromMap` 幂等迁移退役地图角色。
- 无 schema 变更、无新迁移。

`apps/game-server`：

- 每张地图固定 Room：`world_map:starter_town`、`world_map:starter_wilds`。
- 加入时校验角色持久化地图与 Room 一致；不接受客户端选图。
- 编译导航格寻路/碰撞/目标校验；站立传送门自动服务端传送。
- 传送：写入新地图/坐标 -> 释放租约 -> 移除旧实体 -> `session.transfer`；
  客户端重新取 ticket 加入目标 Room。
- 每客户端 `StateView` AOI；增量加入/移除；离开释放视图。
- 20 秒节流 checkpoint，离开/宽限期/Dispose 立即保存。
- 同图聊天：120 字符、控制字符拒绝、4/2s 令牌桶、32 条去重、Room 广播。
- 指标增加 chat/transfer；30 玩家负载脚本。

`apps/control-api`：

- 新建角色出生在主城编译出生点。
- `pnpm repair:maps` 将 132 个阶段 2 角色迁移到主城（幂等）。

`apps/game-web`：

- 加载编译地图 + asset manifest；tileset 与角色帧注册。
- 静态地表/低层装饰合成到单个 RenderTexture；墙体挤出、树冠遮挡、NPC/传送门标记。
- 脚底锚点、Y 深度排序、摄像机跟随、路径预览。
- 传送后重建场景并丢弃旧快照；HUD 地图名/ID、附近玩家、HP/MP、聊天、tick。
- 开发调试钩子增加 `moveToTile`、`currentMapId` 与可见性诊断。

`tests` 与文档：

- 33 个测试文件、167 个测试；12 个真实浏览器 E2E。
- ADR-018；AGENTS/README 更新；阶段 3 报告与截图/日志/负载/数据库证据。

### 阶段 4：怪物、战斗和技能

`packages/game-domain`（新包）：

- `combatStatsFor`：职业基础属性 + 等级成长；命中/暴击/攻击间隔/射程。
- `rollAttack`：固定 3 次 RNG（命中、暴击、浮动），伤害下限 1，防御减半。
- `content.ts`：`phase4.1` 技能/怪物目录；两种怪物、三种职业技能与
  `directDamage` / `heal` effect handler。
- `CombatWorld`：无 IO 内存战斗世界；注入导航格、寻路、RNG、刷点、复活点；
  玩家 HP/MP/冷却、怪物 FSM、追击/脱战/巡逻、死亡/重生、玩家死亡复活、
  断线玩家不可被选中。
- 19 个领域测试（含确定性回放与固定 RNG 抽取）。

`packages/contracts`：

- `combat.basicAttack`、`skill.cast`；`combat.event` 7 种变体；
  `combat.profile` 技能/冷却档案；5 个战斗错误码与 `retryAfterMs`。
- 玩家 `classId`/`level`/`alive`；`.view()` 的 `monsters` 集合与 `MonsterState`。
- 契约测试覆盖范围、事件、档案与伪造字段拒绝。

`content/maps`：

- 野外刷点 2 → 6（3 史莱姆 + 3 森林狼）；编译产物重新生成。

`apps/game-server`：

- Room 创建 `CombatWorld`；玩家加入移交职业/等级/HP/MP；HP 0 角色满状态复活。
- 战斗命令统一管线：会话/协议/命令 ID 幂等/序号/限频/领域结果/事件广播。
- 重复 commandId 重发原事件，不再掷骰；断线宽限期不可被怪物选中。
- 每 tick 同步玩家 HP/MP/存活与怪物位置/HP/状态；怪物共用 AOI。
- 传送/checkpoint 读取战斗世界 HP/MP；指标新增战斗命令/事件/击杀/死亡。
- 7 个真实 PostgreSQL + Colyseus 战斗集成测试。

`apps/game-web`：

- 怪物渲染、血条、名称/等级、点击选怪与普攻、选中环。
- 目标面板、附近怪物、技能栏（MP/冷却/快捷键 1）、战斗记录、死亡遮罩。
- 伤害/暴击/闪避/治疗浮字、技能弹道/治疗环、受击/死亡/重生表现；
  摄像机上移 200px 避开底部战斗 HUD。
- 战斗日志按 `eventId` 去重；技能冷却只由服务端事件触发。
- 调试钩子 `attackMonster` / `castSkill` / `monsterScreenPoint`。

`tests` 与文档：

- 40 个测试文件、211 个测试；13 个真实浏览器 E2E（新增双人战斗）。
- ADR-019；AGENTS/ESLint game-domain 边界；阶段 4 报告、回放、指标、
  数据库、负载、截图与阶段 3 回归证据。

## 5. 尚未完成内容

- 经验、等级成长、击杀奖励、掉落、地面物品、拾取、背包、装备与金币
  （阶段 5）。
- PK、安全区、复活惩罚、聊天过滤/频道/持久化与审核（阶段 6/7）。
- 运营后台、管理员 RBAC、Outbox、内容 Draft/Release/回滚（阶段 7）。
- 多地图线路、多 Game Server、Redis Presence/Driver、Room drain（阶段 8）。
- 50 人 10 分钟压测、战斗负载、patch bytes、带宽、崩溃恢复演练（阶段 8）。
- NPC 行为：当前只有编译 NPC 标记，没有对话/商店/任务。
- 独立测试数据库或临时 schema（阶段 5 前）。
- 密码找回、邮箱验证、MFA。
- 正式美术资源、怪物/技能动画与音效；当前为明确标识的几何占位表现。
- 状态效果/Buff/范围伤害与投射物实体；阶段 4 只有 `directDamage` 与 `heal`。

## 6. 当前技术风险

| 风险                                | 影响                         | 缓解                                               |
| ----------------------------------- | ---------------------------- | -------------------------------------------------- |
| 单地图固定实例                      | 无法按人数开线路             | MVP 单实例；阶段 8 增加实例与路由                  |
| 传送为离开/重新加入                 | 切换有短暂加载               | 服务端先提交再通知；客户端重建场景；后续优化体验   |
| 传送提交后客户端未加入目标 Room     | 角色停留在目标地图           | 重新进入即可恢复；后续加传送回执与重试             |
| AOI 依赖 Colyseus StateView 行为    | 升级可能改变过滤/带宽        | 集成测试锁定远处不可见、近处可见、离开释放         |
| CombatEvent 全 Room 广播            | 远处玩家收到战斗表现事件     | MVP 事件量小；阶段 8 评估 AOI 事件过滤与带宽       |
| 怪物/玩家无碰撞                     | 可重叠站位、点击判定重叠     | 不改变权威位置；后续增加软碰撞                     |
| 怪物 AI 每 400ms 重算路径           | 大量怪物时寻路成本上升       | 当前 6 只；阶段 8 压测并优化                       |
| 玩家复活固定在首个出生点            | 多人同时复活会堆叠           | MVP 可接受；阶段 6 评估最近安全点                  |
| 战斗/怪物状态仅内存                 | 进程崩溃丢失怪物 HP 与冷却   | 允许按规则重建；资产与经验不在战斗中               |
| checkpoint 20 秒                    | 崩溃最多丢 20 秒瞬时状态     | 正常离开立即保存；资产不在 tick/内存中             |
| 聊天无持久化/过滤                   | 无审核与跨图能力             | 阶段 6/7 增加                                      |
| 软件渲染下浏览器约 22–27 FPS        | 客户端帧率与可见延迟受影响   | 静态地表合批、nearest 渲染、20Hz patch；真机应更高 |
| patch 20Hz 带宽约翻倍               | 30/50 人带宽需实测           | 阶段 8 记录 patch bytes 并重新评估                 |
| Node fetch 拒绝 87 端口             | 负载脚本不能直连 matchmaking | 通过 Vite `/ws` 代理 + `node:http` 读指标          |
| 30 人短时负载不是容量承诺           | 不能据此宣称 50 人稳定       | 阶段 8 固定机器规格、10 分钟压测                   |
| 进程崩溃后租约最长 30 秒仍有效      | 重启后短时间提示“另一台设备” | 正常离开立即释放；阶段 8 增加进程注册与恢复策略    |
| 票据/会话行不自动清理               | 表增长                       | MVP 数据量小；阶段 7/8 增加清理任务与指标          |
| 认证/聊天限频为单进程内存           | 多实例下不一致               | 阶段 8 使用网关或 Redis；MVP 单实例                |
| 共享开发数据库                      | 测试数据残留、并行污染       | 唯一账号/角色名；阶段 5 前建立独立测试库           |
| 技术占位美术                        | 不代表最终画面               | 阶段 8 前完成资源门禁与正式素材                    |
| 开发 PostgreSQL 端口发布在所有接口  | 共享主机暴露风险             | 仅本地开发；生产使用私有网络                       |
| 容器 inotify 限额 8192              | watcher ENOSPC               | 默认后端无 watch、Vite 轮询                        |
| Playwright 浏览器无法在当前系统下载 | E2E 依赖预装 Chromium        | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`       |
| Redis 8.2 本地镜像不可用            | scale profile 暂不可启动     | MVP 不依赖 Redis                                   |

## 7. 已知问题

- 当前开发栈在 84–87（宿主机 8584–8587）运行；`http://<LAN-IP>:8584/` 可供实测。
- `pnpm dev` 默认不热重载后端；修改后端需重启开发栈。前端 Vite 轮询热更新。
- Node 的 `fetch`（含 Colyseus SDK matchmaking）拒绝 87 端口；负载脚本通过
  Vite `/ws` 代理连接并用 `node:http` 读取 `/metrics`。
- 浏览器通过同源 `/ws` 访问实时服务器；生产反向代理必须转发该路径的 HTTP 与
  WebSocket，或设置 `VITE_GAME_SERVER_URL`。
- `/api` 与 `/ws` 开发代理必须保留原始 Host（`changeOrigin: false`），否则
  CSRF Origin 校验会拒绝局域网来源。
- `?fresh/?join` 仅在开发构建生效；`?join` 指向的房间必须与角色当前地图一致，
  传送后不要用旧 roomId 重载。
- 角色被另一客户端控制时统一返回 525；客户端展示服务端消息，但不区分“租约被占”
  与“票据失效/地图不一致”的错误码。
- `pnpm test:e2e` 会执行迁移与区服 seed，并启动四个服务；开发栈已运行时加
  `PLAYWRIGHT_SKIP_WEBSERVER=true`。本次 E2E 在 84–87 上运行。
- 集成与 E2E 使用共享开发库，会留下测试账号/角色/票据记录；当前库有 784 个
  `starter_town` 角色、98 个 `starter_wilds` 角色。
- 技术占位 tileset、角色 Sprite 与怪物几何造型为明确占位；Tiled 源图为正交
  逻辑网格，客户端做伪等距投影（ADR-018）。
- `patch` 为 20Hz；阶段 8 需重新评估带宽与频率。
- 战斗 HUD 位于底部中央，摄像机焦点上移 200px；极端窄屏会隐藏聊天面板。
- 怪物、玩家之间没有碰撞体积；两名玩家可以站在同一格。
- 技能栏只显示本职业技能 1；没有目标时敌方技能按钮禁用。
- 击杀不发放经验或掉落；阶段 4 的“成长”闭环尚未开始。

## 8. 阻塞事项

无技术阻塞。阶段 4 等待用户在 8584 端口实测验收；验收通过前不启动阶段 5。

## 9. 最近一次测试结果

日期：2026-11-24

| 检查        | 命令                                           | 结果                                          |
| ----------- | ---------------------------------------------- | --------------------------------------------- |
| 格式        | `pnpm format:check`                            | 通过                                          |
| Lint / 边界 | `pnpm lint`                                    | 通过（0 error / 0 warning）                   |
| 类型        | `pnpm typecheck`                               | 通过（根配置 + 13 个 workspace）              |
| 单元/集成   | `pnpm test`                                    | 40 个文件，211 个测试全部通过（约 11.9s）     |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e` | 13 个测试全部通过（约 1.1 分钟）              |
| 构建        | `pnpm build`                                   | 4 个应用全部成功                              |
| 地图编译    | `pnpm maps:compile`                            | 2 张地图、野外 6 个刷点、checksum 稳定        |
| 负载        | `pnpm load:world`                              | 30/30 玩家、750 接受、0 拒绝、tick p95 0.96ms |

阶段 4 关键证据：

- 领域回放：`phase-04/combat-replay.json` 固定 seed 产生 14 次攻击、13 次命中、
  1 次闪避、2 次死亡、1 次重生；相同 seed 完全一致。
- 契约/领域：伤害、暴击、RNG 固定抽取、冷却、法力、距离、治疗、怪物 FSM、
  脱战、死亡/重生、玩家死亡复活、双攻击者共享 HP、断线玩家不可被选中。
- 战斗集成（真实 PostgreSQL + Colyseus）：普攻 11 点、二次普攻 900ms
  `COOLDOWN`、技能 6 MP、伪造 `damage` 拒绝、重复 commandId 只结算一次、
  怪物 2 秒重生、玩家 400ms 在 (2,16) 满状态复活。
- 双浏览器 E2E：两人从主城传送到野外并攻击同一史莱姆，两端 `data-hp` 同步；
  技能使 MP 30 → 24 并生成服务端冷却；怪物死亡 0/50，8 秒后满 HP 重生。
- 指标（E2E 后累计）：14 个房间、4 条战斗命令、18 个战斗事件、1 次击杀、
  0 次玩家死亡、0 个活跃租约。
- 数据库：2 条迁移、6 张表、784 个主城角色 + 98 个野外角色、824 个
  `version > 0`、0 个活跃租约；阶段 4 未新增迁移或表。
- 证据目录：`docs/phase-reports/phase-04/`（含阶段 3 回归证据子目录）。

用户验收（历史）：

- 阶段 3 已于 2026-11-24 在 `http://<LAN-IP>:8584/` 通过用户实测验收。
- 阶段 4 已交付并等待同一地址的实测确认。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
- 阶段 1 修复提交：`954155f`、`5f2dbbf`、`f4b74ff`
- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
- 阶段 3 主提交：`80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
  主题：`feat(phase-3): deliver compiled maps, AOI, transfers and chat`
- 阶段 4 主提交：`cb3617bc5a1396df89661f206a0b9e0562fbe23e`
  主题：`feat(phase-4): deliver monsters, combat and skills`

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0；PostgreSQL 18.3。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目默认使用 84–87。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131；浏览器在软件渲染下约 22–27 FPS。
- 开发库当前有 971 个账号、882 个角色（784 主城 / 98 野外）、992 张票据
  （951 消费 / 41 过期 / 0 开放）、0 个活跃租约。
- 阶段 2 创建的 132 个角色已通过 `pnpm repair:maps` 迁移到主城。

## 12. 下一步

1. 在 `http://<LAN-IP>:8584/` 实测阶段 4：传送到野外，点击史莱姆/森林狼，
   验证普攻、按 1 施放技能、冷却、双人同一 HP、死亡与 8 秒重生。
2. 用户验收通过后标记阶段 4 完成，再启动阶段 5：物品/掉落/背包/装备/金币/
   经验事务与崩溃恢复。
3. 保持阶段 3 的移动/传送/AOI/聊天/租约/checkpoint 与阶段 4 的战斗测试为
   回归门禁。
4. 阶段 4 验收通过前不得进入阶段 5。
