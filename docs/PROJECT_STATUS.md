# Web Legend 项目状态

> 更新日期：2026-11-25
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 9：MVP 收口（测试数据隔离与 WebSocket 观测）—— 实现与自动化验收完成，
等待用户确认。**

阶段 0–3 已通过用户验收；阶段 4–8 的实现和自动化验收完成，阶段 6/7 的用户
实测与阶段 8 的证据确认仍未单独记录。阶段 9 在 MVP 计划定义的 0–8 阶段全部
交付后，按 `docs/WEB_LEGEND_MVP_PLAN_v2.md` 第 19 节 Definition of Done 做差距
审计，补齐两项验收基础：`pnpm test` 改为每次运行创建一次性 PostgreSQL 数据库，
不再写入共享开发库；WebSocket 观测补齐入站字节、连接/断线/重连计数，并修复
重连后出站字节漏计。阶段 7 的后台实测与阶段 8 的生产演练确认仍等待用户完成。

## 2. 阶段进度

| 阶段                           | 状态       | 说明                                                                  |
| ------------------------------ | ---------- | --------------------------------------------------------------------- |
| 阶段 0：工程底座               | 已完成     | 工程、依赖、质量门禁、数据库、健康检查、文档                          |
| 阶段 1：双浏览器联机切片       | 已完成     | 测试地图、world_map Room、服务端移动、双浏览器可见、重连、HUD、E2E    |
| 阶段 2：账号与票据             | 已完成     | 账号/会话、Argon2id、角色、一次性 ticket、角色租约、位置持久化、E2E   |
| 阶段 3：地图与世界状态         | 已完成     | Tiled 地图、map-runtime、地图实例/传送、AOI、节流 checkpoint、聊天    |
| 阶段 4：怪物与战斗             | 自动化完成 | game-domain、两怪物、技能、CombatEvent、复活；手工验收未单独记录      |
| 阶段 5：掉落与资产持久化       | 自动化完成 | game-application、物品/掉落/背包/装备/金币/经验、重登恢复、E2E        |
| 阶段 6：聊天、PK 与体验        | 自动化完成 | 安全区、PvP、死亡复活、聊天过滤、系统消息、小地图/角色面板、音效      |
| 阶段 7：运营后台与内容发布     | 待实测     | 管理员 RBAC、审计、Outbox、Kick/Ban/Mute、内容 Draft/Release/回滚     |
| 阶段 8：质量、压测、部署与恢复 | 自动化完成 | 生产镜像/edge、指标告警、Realm 绑定、备份恢复、重启/Outbox 演练、压测 |
| 阶段 9：MVP 收口与工程隔离     | 自动化完成 | 一次性测试库、WS 入站/连接/断线/重连指标、负载证据、ADR-024           |

## 3. 当前正在进行的任务

阶段 9 确认（自动化证据已就绪）：

1. 阅读 `docs/phase-reports/PHASE_09_REPORT.md` 与
   `docs/phase-reports/phase-09/`（隔离前后计数、指标快照、短时负载）。
2. 若使用自己的数据库角色，确认其具备 `CREATEDB`，或设置
   `TEST_DATABASE_URL`；`pnpm test` 会创建并删除 `wl_test_*` 数据库。

阶段 7 实测（仍待用户确认）：

1. 游戏侧在 `http://<LAN-IP>:8584/` 用两个独立窗口进入主城/野外，确认阶段 6 的
   移动、战斗、掉落、聊天、PvP 与复活无回归。
2. 后台在 `http://<LAN-IP>:8585/` 使用 `admin` / `web-legend-admin` 登录（如
   设置过 `ADMIN_SEED_PASSWORD` 则使用该密码），按阶段 7 报告逐项检查 Kick/
   Mute/Ban、内容发布与回滚。

阶段 8 确认（自动化证据已就绪）：

1. 阅读 `docs/phase-reports/PHASE_08_REPORT.md` 与
   `docs/phase-reports/phase-08/` 下的证据。
2. 生产拓扑演练已在本地 compose 完成（HTTPS/WSS/安全头/限流/内部端点隔离/
   Prometheus 抓取与告警）；用户可按
   `docs/runbooks/DEPLOYMENT_AND_RECOVERY.md` 在自己的证书与镜像仓库上复跑。
3. 容量与恢复结论：30+10 玩家 10 分钟、50 玩家短时、SIGTERM/SIGKILL、数据库
   中断、Outbox 重试与真实恢复。

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

### 阶段 5：掉落、背包、装备和资产持久化

`packages/game-domain`：

- 物品目录（3 职业武器、2 防具、2 药水、2 材料）、职业初始装备、掉落表、
  经验曲线与背包/装备纯规则。
- `findInventoryPlacement`、`canEquip`、`equipmentBonuses`、`statsWithEquipment`、
  `applyExperience`、`rollLoot`；固定 RNG 抽取次数，可复现。
- `CombatWorld` 支持注入装备后属性、提交后的等级/属性更新与药水 HP/MP 写回。

`packages/contracts`：

- `loot.pickup`、`inventory.equip`、`inventory.unequip`、`inventory.use`；
  `inventory.snapshot`、`asset.result`、`character.progress`、
  `character.levelUp`、`loot.claimed`。
- 物品/背包/装备/进度 schema；`WorldState.loot`（公开、AOI 过滤）；
  11 个资产拒绝码；`phase5.1` 内容版本。

`packages/persistence`：

- 新表 `item_instances`、`world_drops`、`wallets`、`currency_ledger`、
  `asset_commands`；CHECK 约束保证物品唯一位置；钱包余额非负；账本与命令幂等键
  唯一。
- 迁移 `0002`（建表/索引）与 `0003`（装备槽唯一索引改为普通索引，交换装备需要
  瞬时中间态）。
- 背包/装备/掉落查询仓储；`insertCharacterWithItems` 事务创建角色与初始物品。

`packages/game-application`（新包）：

- `AssetService`：击杀奖励、拾取、装备、卸下、使用、资产快照读取。
- 所有写操作单事务 + 幂等键 + 行锁；拾取锁掉落行，装备锁角色行；金币更新钱包
  并写账本；奖励创建地面实例与掉落；升级可跨多级并回满 HP/MP。
- 10 个真实 PostgreSQL 集成测试：重复发奖、账本一致、升级、归属窗口、并发
  拾取（仅一次成功）、背包满、装备交换/职业/等级限制、满包卸下、药水幂等、
  重登快照。

`apps/game-server`：

- 加入时读取资产快照与装备后属性，注入 `CombatWorld`；私有快照在握手后发送。
- 击杀死亡事件进入异步资产队列（tick 不等待 SQL）；提交后发经验/金币/升级、
  生成地面掉落并加入 AOI；失败退避重试 3 次。
- `loot.pickup` / `inventory.*` 统一资产命令管线：会话、协议、命令幂等、序号、
  限频、范围/存活校验、提交后 ACK。
- Room 创建恢复未过期掉落；每秒清理过期掉落；指标新增资产命令/失败/掉落/金币/
  经验。
- 2 个真实 PostgreSQL + Colyseus 经济集成测试：击杀→进度→掉落→拾取→重复
  命令→账本/背包；装备→属性→重登恢复。

`apps/control-api`：

- 创建角色与职业初始武器/药水在同一事务提交（`STARTER_KIT`）。

`apps/game-web`：

- 经验条、金币、等级、附近掉落列表、背包/装备面板（`B`）、装备/卸下/使用操作、
  升级提示、拾取日志。
- 地面掉落标记、AOI 渲染、点击拾取；存活怪物优先于脚下掉落，掉落列表始终可
  拾取。
- 退出世界后重新读取角色列表（地图/坐标/等级），避免用旧的 mapId 重新入图；
  角色卡暴露 `data-map-id` 供 E2E 校验。

`tests` 与文档：

- 46 个测试文件、253 个测试；14 个真实浏览器 E2E（新增击杀/拾取/装备/重登）。
- ADR-020；AGENTS/ESLint `game-application` 边界；阶段 5 报告、掉落回放、指标、
  数据库、负载、截图与阶段 4 回归证据。

### 阶段 6：聊天、PK 和游戏体验完善

`packages/contracts` / `content`：

- 编译地图增加 `pvpMode: 'none' | 'open'`，schema 升到 `2`，town/wilds 分别
  编译为安全区/开放 PvP；checksum 覆盖该字段。
- `combat.profile` 增加 `pvpEnabled`、`reviveMs`；`death` 增加 `reviveInMs`；
  新增 `SAFE_ZONE`、`CHAT_BLOCKED` 拒绝码；`system.notice` 首次投入使用。

`packages/game-domain`：

- `CombatWorld` 支持玩家目标普攻/伤害技能；安全区、自伤、死亡、断线宽限、
  超距校验；玩家死亡/复活事件；PvP 无经验/金币/掉落。
- `ChatFilter` 纯函数：NFKC 匹配、保留原始标点、拦截链接/交易引流/刷屏、规则
  可注入。
- 新增 PvP 领域测试与聊天过滤测试。

`apps/game-server`：

- Room 从编译产物读取 `pvpMode` 注入战斗世界；客户端无法伪造区域/坐标。
- 聊天过滤在限频与幂等之后执行；被拦截消息不广播，只向发送者发系统警告。
- 系统消息覆盖加入/离开、PvP/PvE 死亡、升级；指标新增 `chatFiltered`、
  `pvpKills`。
- 3 个真实 PostgreSQL + Colyseus 集成测试：安全区拒绝、野外 PvP 死亡/复活/
  无奖励、聊天限频/过滤。
- 负载脚本补充 `system.notice` 空处理器。

`apps/game-web`：

- 玩家目标点击/列表攻击、玩家头顶等级与 HP 条、目标面板玩家信息。
- 小地图（碰撞、传送门、出生点、玩家/怪物/掉落）、角色面板（`C`）、安全区/
  野外标识、复活倒计时、连接/重连/失败覆盖层。
- WebAudio 合成占位音效（攻击/命中/受伤/击杀/死亡/治疗/拾取/升级）与开关。
- 阶段 5 的背包/装备/掉落/技能/聊天功能保持。

`tests` 与文档：

- 48 个测试文件、270 个测试；17 个真实浏览器 E2E（新增主城安全区、野外 PvP、
  小地图/聊天过滤）。
- ADR-021；AGENTS 安全区与聊天规则；阶段 6 报告、截图、负载、数据库与指标证据；
  阶段 1–5 回归通过。

### 阶段 7：运营后台与内容发布

`packages/contracts`：

- 管理员角色/权限矩阵、登录/会话 DTO、总览/玩家/Room/审计/指令查询 DTO、
  草稿/校验/Release/激活 DTO、内部 Kick/Ban/Mute 指令 envelope。
- 内容 bundle schema：职业、技能、怪物、物品、掉落表；Effect handler 白名单。
- `WorldState` 增加 `contentVersion`/`contentChecksum`；新增 `session.kicked`。

`packages/content-schema`（新包）：

- 基线 `BASE_CONTENT_BUNDLE`（原阶段 4/5 数值）、Zod 校验后加载。
- Schema + 引用/范围/刷点校验、警告分级、稳定 JSON checksum、Release 差异。
- 12 个测试覆盖未知 effect、缺失物品、缺少掉落表、初始装备、槽位、治疗目标、
  checksum 顺序无关、草稿合并与版本号。

`packages/game-domain` / `game-application`：

- 改为消费 `ContentBundle`；`CombatWorld`、`combatStatsFor`、物品/掉落规则支持
  注入 Room 固定版本；省略时使用基线。
- `AssetService` 接受内容 bundle，击杀奖励/掉落/背包/装备使用该版本。
- 新增内容注入测试：怪物 HP/名称、职业技能倍率、物品属性、掉落经验与显示名。

`packages/persistence`：

- 新表：`admin_users`、`admin_sessions`、`admin_audit_logs`、`outbox_events`、
  `content_drafts`、`content_releases`、`realm_active_content`、
  `content_activations`；`accounts` 增加 `muted_until`。
- 迁移 `0004` 建表/索引；`0005` 为审计、Release、激活历史增加 append-only 触发器。
- 管理员/审计/Outbox/内容 Release 仓储、玩家服务端分页查询、Outbox 状态统计。

`apps/control-api`：

- 管理员登录（Argon2id、8 小时 HttpOnly Cookie、独立 `wl_admin_access`）、RBAC。
- 总览、玩家列表/详情、Room、审计、运营指令 API；服务端分页/筛选/排序。
- Kick/Ban/Mute：审计 + Outbox 同事务；Ban 持久化账号状态、Mute 持久化到期时间；
  权限拒绝/参数非法/目标不存在也写失败审计。
- Outbox dispatcher：SKIP LOCKED 领取、stale 重投、指数退避、4xx 直接失败、
  `pending → dispatched → applied/failed`。
- 内容：草稿保存（schema 校验）、全量校验与差异、不可变 Release、按区服激活/
  回滚；发布/激活写审计。
- 创建角色使用区服激活内容的职业属性与初始装备。

`apps/game-server`：

- 内容 Store 周期读取激活 Release；Room 只在 `onCreate` 取快照，新 Room 用新版、
  旧 Room 不变（集成测试证明）。
- 内部 `/internal/admin/status` 与 `/internal/admin/commands`（共享令牌）；按
  commandId 幂等；Kick/Ban 断开会话并发送 `session.kicked`，Mute 即时生效。
- 登录时校验账号封禁与 `muted_until`；聊天禁言提示计入 `chatMuted` 指标。
- 指标新增 `chatMuted`；Room 状态/内容版本通过内部端点提供给后台。

`apps/admin-web`：

- 自定义深色运营工作台（非默认 AntD 模板）：登录、总览、玩家、世界/Room、
  内容工作台、发布中心、审计、运营指令。
- 服务端分页/筛选表、危险操作目标/影响/原因确认、状态标签、校验问题与差异预览。
- 新增 E2E 与截图证据。

`tests` 与文档：

- 53 个测试文件、307 个测试；20 个真实浏览器 E2E（新增管理员总览/Kick/审计、
  内容发布/激活/回滚）。
- ADR-022；AGENTS/ESLint 边界；阶段 7 报告、截图、负载、数据库与指标证据。

### 阶段 8：质量、压测、部署与恢复

`observability` / `game-server` / `control-api`：

- 手写 Prometheus 文本渲染器（无 `prom-client`）与运行时采集器（事件循环、
  RSS/堆、CPU、GC、ELU），渲染器单测覆盖转义、直方图与非法名称。
- Game Server `/metrics/prometheus`：Room/玩家/tick/命令/聊天/战斗/资产/掉落/
  WebSocket 出站与 patch 字节、资产事务队列 p50/95/99，全部带 Realm 标签。
- Control API `/metrics/prometheus`：HTTP 计数与延迟直方图、Outbox 状态与最老
  pending、DB 探测、运行时指标；`TRUST_PROXY` 只在可信代理后启用。
- edge 内部端口提供合成 `/metrics`；Prometheus 抓取 4 个目标，10 条告警规则
  健康。

`game-server`：

- `GAME_SERVER_REALM` 绑定进程，Room 校验角色区服；`ContentStore` 按 Realm 读取
  激活 Release，生产启动时区服缺失直接失败；内部状态与指标带 `realm`。
- `new Server({ gracefullyShutdown: false })` 由 `index.ts` 独占 SIGTERM：
  先 drain/释放租约/checkpoint，再关闭连接池。
- `WorldRoomTuning.monsterSpawns` 注入点（测试用空刷怪列表隔离 PvP）。
- 新增数据库中断集成测试：`/health/ready` 503 → 恢复 200，`/health/live` 保持
  200；`pingDatabase` 有 2 秒超时。

`infra`：

- 四个生产镜像（Node 运行镜像 + nginx 静态镜像）、非 root、健康检查；基础镜像
  可用 `NODE_IMAGE`/`NGINX_IMAGE` 覆盖，构建包含 `content/`。
- nginx edge：HTTPS/WSS、HSTS/CSP/XFO/Referrer/Permissions、16KB body、限流、
  `/internal` 与 `/metrics` 404；compose 生产拓扑含 PostgreSQL/Prometheus。
- `compose.drill.yml` 演练覆盖：发布 PostgreSQL 与 edge 到空闲宿主端口。
- `deploy.sh`/`rollback.sh`（`prod:deploy`/`prod:rollback`）：不可变标签、
  `up --wait`、容器内指标与 edge 健康检查、record previous tag、无数据库反向
  迁移。
- `db-backup.sh`/`db-restore-drill.sh`/`verifyRestore.ts`：自定义格式备份、
  manifest、SHA-256；独立演练库真实恢复并比较行数与资产不变量。
- `recoveryDrill.ts`/`worldScenario.ts`/`outbox-drill.ts`/`prod-check.mjs`。

`content` / `tests` / 文档：

- `starter_wilds` 刷点 6 → 30；两只狼移出 PvP E2E 决斗区域，决斗点改到
  (12,10)/(13,10)。
- 新增 Control API / Game Server 数据库中断测试、Realm 绑定部署测试、资产队列
  指标测试；E2E 20/20 通过。
- ADR-023、部署与恢复 runbook、AGENTS/README、阶段 8 报告与证据目录。

### 阶段 9：MVP 收口（测试数据隔离与 WebSocket 观测）

`packages/persistence` / `vitest.config.ts`：

- `pnpm test` 每次生成一次性数据库 `wl_test_<base36 时间戳>_<随机后缀>`，
  `globalSetup` 建库并运行现有 Drizzle 迁移，`teardown` 删除；测试连接串优先取
  `TEST_DATABASE_URL`，否则取 `DATABASE_URL`。
- 迁移 SQL 显式使用 `"public".` 全限定名，因此采用临时数据库而不是同库 schema；
  迁移文件本身不做任何改写。
- 异常中断残留的 `wl_test_*` 库在下次运行启动时清理（默认 24 小时，
  `TEST_DATABASE_STALE_MS=0` 可立即清理）。
- 新增 `testDatabase.test.ts`：断言测试进程位于临时库、迁移表齐全；全量测试
  前后开发库账号/角色/物品/审计/Release/Outbox 计数完全一致。

`apps/game-server`：

- `RoomMetrics` 新增 `wsReceivedBytes`、`wsConnections`、`wsDisconnects`、
  `wsReconnects`，注册表在 Room 销毁后汇总到 totals。
- `WorldMapRoom.instrumentClient` 同时包装出站 `raw`/`enqueueRaw` 与底层
  WebSocket `message` 事件；初次加入与重连都会应用，修复重连后出站字节漏计。
- 非主动、非传送的断线进入宽限期时记录 disconnect，`onReconnect` 记录
  reconnect。
- JSON `/metrics` 与 `/metrics/prometheus` 同步输出四个新指标；Prometheus
  名称：`ws_received_bytes_total`、`ws_connections_total`、
  `ws_disconnects_total`、`ws_reconnects_total`，均带 Room/Realm/地图标签。
- 负载脚本输出 `wsIn`、连接/断线/重连计数与重连率，并断言入站字节大于 0。

`tests` 与文档：

- 61 个测试文件、329 个测试全部通过；20 个浏览器 E2E 回归通过。
- 短时负载：6 玩家 + 2 攻击者 30 秒，入站 58,638 B、出站 1,353,745 B、
  tick p95 0.75ms、0 资产失败。
- ADR-024；AGENTS/README 补充测试库与指标说明；阶段 9 报告与证据目录。

## 5. 尚未完成内容

- 多 Game Server / 多 Realm 路由与实例注册：阶段 8 已让每个 Game Server 进程
  绑定一个 Realm，但没有进程注册、连接路由或按人数开新实例。
- 独立 Outbox worker、审计/Release/Outbox 归档仍未建立。
- WebSocket 指标已覆盖上下行与连接生命周期，但按 Room 聚合，没有单会话标签；
  入站字节在应用层按 WS payload 统计，不包含 TCP/TLS/WS 帧头。
- 聊天持久化、人工审核、敏感词热更新、禁言历史查询、举报与跨图频道。
- 红名、爆装、罪恶值、死亡惩罚、竞技匹配与野外局部安全区（MVP 不做）。
- NPC 对话/商店/任务；当前只有编译 NPC 标记。
- 正式美术资源、怪物/技能动画与音效；当前为占位美术与 WebAudio 合成音。
- 内容工作台当前按类型保存完整 JSON section，未提供逐字段表单、审批流或按
  Realm 的独立草稿；新增内容类型需要新增 schema 与校验规则。
- `pnpm test` 已使用一次性数据库；E2E 仍连接开发栈数据库（验证真实开发拓扑），
  仅靠唯一账号/角色名隔离。
- 过期掉落、`asset_commands`、审计与 Outbox 历史没有定期归档/清理任务。
- 后台会话无 refresh token，8 小时后需重新登录；无 MFA/OIDC。
- Outbox dispatcher 与 Control API 同进程；吞吐不足时需要独立 worker。
- Kick/Ban/Mute 目前只有命令结果，没有禁言历史列表或申诉流程。

## 6. 当前技术风险

| 风险                                | 影响                                | 缓解                                                                    |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| 单地图固定实例                      | 无法按人数开线路                    | MVP 单实例；扩容时按架构文档 6.4 增加实例与路由                         |
| 单 Game Server 绑定单 Realm         | 无法水平扩展或跨区服共进程          | `GAME_SERVER_REALM` 显式绑定；扩容时按区服拆进程 + 连接路由             |
| 内容激活只影响新 Room               | 旧 Room 需重新进入才用新数值        | ADR-008/022 明确固定快照；运营流程提示重启或等待新实例                  |
| 内部管理端点与 Game Server 同端口   | 若反向代理暴露 `/internal` 可被伪造 | 共享令牌 + nginx 对 `/internal` 返回 404；runbook 明确禁止暴露          |
| 开发默认 `INTERNAL_ADMIN_TOKEN`     | 生产误用会暴露内部端点              | 生产 schema 拒绝默认值；部署时显式设置                                  |
| Outbox 与 Control API 同进程        | 进程终止时投递暂停                  | PostgreSQL 保留 pending；stale dispatched 60 秒后重投                   |
| Outbox dispatcher 单实例            | 吞吐有限                            | SKIP LOCKED 支持多实例；当前命令量小                                    |
| 资产事务队列串行                    | 压测 p95 反映排队+提交（约 35ms）   | tick 不等待事务；队列指标可观测；扩容前评估批量/并行                    |
| 生产会话/证书由部署方提供           | 自签证书只用于演练                  | runbook 要求 CA 证书与过期轮换；edge reload 不影响在线连接              |
| 内容草稿为全局 section              | 多区服/多人编辑会互相覆盖           | 当前单区服单运营；扩容前评估按 Realm/按人草稿                           |
| 内容 JSON 直接编辑                  | 运营误改需要校验拦截                | Schema + 引用/范围校验 + 差异预览 + 不可变 Release                      |
| 审计/Outbox/Release 表持续增长      | 长期数据量上升                      | append-only 设计；归档与保留策略仍待数据库专项                          |
| 后台会话无 refresh                  | 8 小时后重新登录                    | MVP 可接受；后续接入 OIDC/MFA                                           |
| Playwright 并行数过高               | 250ms 可见性/攻击时序抖动           | 默认 2 worker；`PLAYWRIGHT_WORKERS` 可覆盖                              |
| 共享开发库残留内容 Release/审计     | 后台列表较长、测试数据混杂          | `pnpm test` 使用一次性库；E2E 使用唯一 ID；历史数据未清理               |
| 传送为离开/重新加入                 | 切换有短暂加载                      | 服务端先提交再通知；客户端重建场景；后续优化体验                        |
| AOI 依赖 Colyseus StateView 行为    | 升级可能改变过滤/带宽               | 集成测试锁定远处不可见、近处可见、离开释放                              |
| CombatEvent 全 Room 广播            | 远处玩家收到战斗表现事件            | MVP 事件量小；扩容前评估 AOI 事件过滤与带宽                             |
| 怪物/玩家无碰撞                     | 可重叠站位、点击判定重叠            | 不改变权威位置；后续增加软碰撞                                          |
| 怪物 AI 每 400ms 重算路径           | 大量怪物时寻路成本上升              | 野外 30 只压测 tick p95 仍低于 25ms；扩容前优化                         |
| 战斗/怪物状态仅内存                 | 进程崩溃丢失怪物 HP 与冷却          | 允许按规则重建；资产与经验不在战斗中                                    |
| checkpoint 20 秒                    | 崩溃最多丢 20 秒瞬时状态            | 正常离开立即保存；资产不在 tick/内存中                                  |
| 软件渲染下浏览器约 22–27 FPS        | 客户端帧率与可见延迟受影响          | 静态地表合批、nearest 渲染、20Hz patch；真机应更高                      |
| Node fetch 拒绝 87 端口             | 负载脚本不能直连 matchmaking        | 通过 Vite `/ws` 代理 + `node:http` 读指标；内部客户端也使用 `node:http` |
| E2E 共享开发数据库                  | E2E 数据残留、掉落/内容恢复污染     | 唯一账号/角色名、测试按 owner 过滤；需要完全隔离时用独立栈              |
| 临时测试库需要 CREATEDB             | 权限不足时 `pnpm test` 失败         | 明确错误提示；`TEST_DATABASE_URL` 指向有权限的实例                      |
| 开发 PostgreSQL 端口发布在所有接口  | 共享主机暴露风险                    | 仅本地开发；生产使用私有网络                                            |
| 容器 inotify 限额 8192              | watcher ENOSPC                      | 默认后端无 watch、Vite 轮询                                             |
| Playwright 浏览器无法在当前系统下载 | E2E 依赖预装 Chromium               | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`                            |

## 7. 已知问题

- 当前开发栈在 84–87（宿主机 8584–8587）运行；`http://<LAN-IP>:8584/` 与
  `http://<LAN-IP>:8585/` 可供实测。开发管理员为 `admin` / `web-legend-admin`
  （除非设置了 `ADMIN_SEED_PASSWORD`）。
- `pnpm dev` 默认不热重载后端；修改后端需重启开发栈。前端 Vite 轮询热更新。
- Node 的 `fetch`（含 Colyseus SDK matchmaking）拒绝 87 端口；负载脚本通过
  Vite `/ws` 代理连接并用 `node:http` 读取 `/metrics`；Control API 的内部
  Game Server 客户端同样使用 `node:http`。
- 浏览器通过同源 `/ws` 访问实时服务器；生产反向代理必须转发该路径的 HTTP 与
  WebSocket，并禁止公网访问 `/internal/admin/*`。
- `/api` 与 `/ws` 开发代理必须保留原始 Host（`changeOrigin: false`），否则
  CSRF Origin 校验会拒绝局域网来源。
- 阶段 7 测试在共享开发库留下 17 个 Content Release、31 条激活记录、21 个
  管理员账号与 114 条审计记录；当前激活内容已恢复为 `baseline`，但发布中心会
  显示这些测试历史。阶段 9 起 `pnpm test` 不再增加这类数据。
- `pnpm test` 当前使用一次性数据库，每次增加一次建库与全量迁移（约 1–3 秒）；
  数据库角色需要 `CREATEDB`。E2E 仍写入开发库，只靠唯一名称隔离。
- 完整 `pnpm test:e2e` 会重写阶段 3–7 的截图与 WebSocket 日志；提交前只保留
  本阶段新增证据，历史文件用 `git checkout` 恢复（阶段 8 起沿用此做法）。
- 内容工作台以 JSON 编辑完整 section；便于技术运营，但不是最终面向非技术运营的
  表单化编辑器。校验问题与差异会阻止发布，但保存草稿只做 schema 校验。
- 内容激活/回滚只影响之后创建的 Room；固定地图 Room 需要玩家重新进入或等待
  Room 重建才能使用新数值。
- Outbox 对离线目标返回 applied（applied=0）；Ban/Mute 的持久状态已由 Control
  API 写入，Kick 对离线角色没有可见效果。
- Mute 是账号级、持久化到 `accounts.muted_until`；后台不展示禁言历史，也不支持
  提前解除（再次 Mute 一个过去时间可解除）。
- 管理员会话 8 小时有效且无 refresh token；退出登录只撤销当前令牌。
- 内部管理端点的共享令牌在开发环境使用默认值，生产必须显式覆盖。
- 后台 `/api` 开发代理必须保留原始 Host（`changeOrigin: false`），否则 Control
  API 的 CSRF Origin 校验会拒绝局域网来源；已修复并验证 LAN 登录 200。
- 阶段 6 的安全区、PvP、聊天过滤、小地图、音效与阶段 1–5 行为保持不变；本次
  回归门禁 20/20 通过。
- 阶段 8 的生产演练在本机 docker compose 完成：7 个容器 healthy，HTTPS/WSS/
  安全头/内部端点隔离/Prometheus 12 项检查通过；本环境的浏览器无法访问
  compose 在宿主机发布的端口，因此未采集生产页面截图。
- 生产镜像构建需可访问基础镜像仓库；本环境通过镜像站覆盖
  `NODE_IMAGE`/`NGINX_IMAGE`/`PROMETHEUS_IMAGE`，默认值仍为官方镜像。
- 演练 compose 使用 38180/38443/38444/38543，避免占用宿主机 80/443 与已占用
  端口；`compose.drill.yml` 仅用于演练，不用于生产流量。
- edge 的 Prometheus 目标是内部合成指标（`web_legend_edge_up`），不含 nginx
  内部状态；需要时增加 exporter。
- 资产事务队列指标包含排队与提交时间（30 人压测 p95 约 35ms），不是纯 SQL
  耗时；入站 WebSocket 字节未计数。
- 技术占位 tileset、角色 Sprite 与怪物几何造型仍为占位；Tiled 源图为正交逻辑
  网格，客户端做伪等距投影（ADR-018）。
- 背包 24 格、装备槽仅武器/护甲；没有背包整理、丢弃、出售或物品图标。
- 掉落归属 30 秒、2 分钟消失；客户端不显示归属倒计时。

## 8. 阻塞事项

无技术阻塞。阶段 7 等待用户在 8584（游戏）与 8585（后台）实测验收；阶段 8 与
阶段 9 的自动化验收已完成，等待用户确认证据。本阶段按用户“继续研发、确定下一
阶段”的明确指令执行，不改变阶段 7/8 仍需用户确认的事实。

## 9. 最近一次测试结果

日期：2026-11-25

| 检查        | 命令                                                                                                    | 结果                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 格式        | `pnpm format:check`                                                                                     | 通过                                                                                        |
| Lint / 边界 | `pnpm lint`                                                                                             | 通过（0 error / 0 warning）                                                                 |
| 类型        | `pnpm typecheck`                                                                                        | 通过（根配置 + 15 个 workspace）                                                            |
| 单元/集成   | `pnpm test`                                                                                             | 61 个文件，329 个测试全部通过（约 13.3s）                                                   |
| 隔离验证    | `pnpm test` 前后查询开发库计数                                                                          | 账号/角色/物品/审计/Release/Outbox 完全一致；无 `wl_test_*` 残留                            |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e`（2 workers）                                             | 20 个测试全部通过（约 1.8 分钟）                                                            |
| 构建        | `pnpm build`                                                                                            | 4 个应用全部成功                                                                            |
| 迁移        | `pnpm db:migrate`                                                                                       | 6 条迁移、19 张表                                                                           |
| 容量 A      | `LOAD_PLAYERS=30 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 pnpm load:scenario`                          | 30/30、36000 接受、11069 拒绝、tick p95 4.3ms / p99 5.84ms、资产队列 p95 33.3ms、0 资产失败 |
| 容量 B      | `LOAD_PLAYERS=50 LOAD_DURATION_MS=150000 pnpm load:scenario`                                            | 50/50、15000 接受、0 拒绝、tick p95 6.05ms / p99 7.83ms、0 资产失败                         |
| 生产演练    | `docker compose -f compose.prod.yml -f compose.drill.yml up -d --wait` + `infra/scripts/prod-check.mjs` | 7 容器 healthy，12/12 检查通过                                                              |
| 回滚        | `rollback.sh`（drill-b → drill-a）                                                                      | 镜像标签与 state 正确，12/12 检查通过                                                       |
| 恢复        | `pnpm db:restore-drill`                                                                                 | 19 张表、6 条迁移、行数与不变量一致，演练库删除                                             |
| 重启演练    | `pnpm drill:recovery`                                                                                   | SIGTERM 租约 1ms 释放；SIGKILL 周期 checkpoint 生效                                         |
| Outbox      | `pnpm drill:outbox`                                                                                     | 失败退避 → applied → 重复 commandId duplicate                                               |
| 短时负载    | `LOAD_PLAYERS=6 LOAD_ATTACKERS=2 LOAD_DURATION_MS=30000 pnpm load:scenario`                             | 6/6 加入、360 接受、tick p95 0.75ms、出站 1,353,745B、入站 58,638B、0 资产失败              |

阶段 8 关键证据：

- Realm：跨区服角色被拒绝；绑定区服使用自己的激活版本；内部状态/指标带
  `realm`。
- 指标：Game Server 与 Control API `/metrics/prometheus` 可抓取；10 条告警规则
  加载健康；JSON `/metrics` 保留给负载脚本。
- 生产边界：HTTPS/WSS、HSTS/CSP/XFO、16KB body、认证限流、`/internal` 与
  `/metrics` 404、控制 API 经 `/api` 代理可用、Prometheus 4 个目标 up。
- 恢复：备份 dump + manifest + SHA-256；独立库真实恢复并校验行数与资产不变量；
  SIGTERM 优雅保存并释放租约，SIGKILL 保留 20 秒 checkpoint。
- 数据库中断：Control API / Game Server `/health/ready` 503、`/health/live` 200，
  恢复后自动 200。
- 容量：30+10 玩家 10 分钟 tick p95 4.3ms、p99 5.84ms；50 玩家 tick p95 6.05ms；
  0 资产失败、0 重复或丢失（不变量 0）。
- 证据目录：`docs/phase-reports/phase-08/`（deployment-check、rollback-drill、
  recovery-drill.json、restore-drill、backup、outbox-drill、database.txt、
  metrics、两份容量 JSON）。

阶段 9 关键证据：

- 测试隔离：全量测试前后开发库账号/角色/物品/审计/Release/Outbox 计数一致；
  测试库 `wl_test_*` 在结束时删除，无残留。
- 网络指标：Room JSON 与 Prometheus 均输出 `wsReceivedBytes`、
  `wsConnections`、`wsDisconnects`、`wsReconnects`；重连集成测试断言计数与
  入站字节。
- 负载：短时场景记录 `wsIn`、`wsOut`、patch 与重连率，并断言入站字节大于 0。
- 证据目录：`docs/phase-reports/phase-09/`（test-isolation.txt、
  metrics.json、metrics.txt、load-short.json）。

用户验收（历史）：

- 阶段 3 已于 2026-11-24 在 `http://<LAN-IP>:8584/` 通过用户实测验收。
- 阶段 4–8 自动化验收已通过；阶段 6/7 手工实测与阶段 8 证据确认仍待用户完成。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
- 阶段 1 修复提交：`954155f`、`5f2dbbf`、`f4b74ff`
- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
- 阶段 3 主提交：`80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
- 阶段 4 主提交：`cb3617bc5a1396df89661f206a0b9e0562fbe23e`
- 阶段 5 主提交：`c5cc9e001772b2fa808f16f2a130ea46c5d441cc`
- 阶段 6 主提交：`029d2da`
- 阶段 7 主提交：`23ee461c0d196217cf2b192e3893fb59db8a6bea`
  主题：`feat(phase-7): deliver admin console, outbox operations and content releases`
- 阶段 8 主提交：`d079b9644e4d9aff7a88358fadc7d002698e2c4f`
  主题：`feat(phase-8): deliver production deployment, observability and recovery`
- 阶段 9 主提交：（待提交）
  主题：`feat(phase-9): isolate test databases and complete websocket metrics`

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0；PostgreSQL 18.3。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目使用 84–87。
- 开发栈当前运行：game-web 84（8584）、admin-web 85（8585）、control-api 86
  （8586）、game-server 87（8587）。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131；默认 2 workers，软件渲染约 22–27 FPS。
- 开发库当前有 2819 账号、2652 角色、3860 物品实例、205 条审计、34 个 Release、
  48 条 Outbox；钱包/流水、物品放置不变量均为 0。阶段 9 的全量测试未改变这些
  计数。
- 开发管理员：`admin` / `web-legend-admin`（除非 `ADMIN_SEED_PASSWORD` 覆盖）。
- 激活内容为 `baseline`，checksum
  `732f923b8c9a0637af7f78644aa5e2d6be616376d2d649af4b5004f268ed245c`。

## 12. 下一步

1. 确认阶段 9 证据（`docs/phase-reports/PHASE_09_REPORT.md`）；在目标数据库
   角色上验证 `pnpm test` 的一次性库创建/删除，必要时设置 `TEST_DATABASE_URL`。
2. 在 `http://<LAN-IP>:8584/` 与 `http://<LAN-IP>:8585/` 按第 3 节完成阶段 7
   实测，并确认阶段 1–6 游戏行为无回归。
3. 确认阶段 8 证据与部署方式（`docs/phase-reports/PHASE_08_REPORT.md`、
   `docs/runbooks/DEPLOYMENT_AND_RECOVERY.md`）；在自己的证书与镜像仓库上复跑
   一次 `prod:deploy` / `prod:rollback`。
4. 后续评估：E2E 独立环境、Outbox 独立 worker、审计/Release/Outbox 归档、
   多 Realm 路由与聊天持久化/审核。
5. 保持阶段 1–9 的 329 个测试与 20 个浏览器 E2E 为回归门禁；软件渲染环境默认
   2 个 Playwright worker。压测/演练脚本已并入 `pnpm load:scenario`、
   `pnpm drill:*` 与 `pnpm db:*`。
6. 正式音效与美术资源在用户确认阶段 8 后替换。
