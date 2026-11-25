# Web Legend 项目状态

> 更新日期：2026-11-25
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 6：聊天、PK 和游戏体验完善 —— 实现完成，自动化验收通过；待用户在
8584 端口实测确认。**

阶段 0–3 已通过用户验收。阶段 4 与阶段 5 的实现和自动化验收完成；本次会话在
用户指示继续研发后启动阶段 6，未单独记录阶段 5 的手工验收结论。阶段 6 的
安全区、PvP、死亡复活、聊天过滤、系统消息、HUD/小地图和音效均已交付；在用户
实测通过前不标记“阶段完成”，也不进入阶段 7。

## 2. 阶段进度

| 阶段                           | 状态       | 说明                                                                |
| ------------------------------ | ---------- | ------------------------------------------------------------------- |
| 阶段 0：工程底座               | 已完成     | 工程、依赖、质量门禁、数据库、健康检查、文档                        |
| 阶段 1：双浏览器联机切片       | 已完成     | 测试地图、world_map Room、服务端移动、双浏览器可见、重连、HUD、E2E  |
| 阶段 2：账号与票据             | 已完成     | 账号/会话、Argon2id、角色、一次性 ticket、角色租约、位置持久化、E2E |
| 阶段 3：地图与世界状态         | 已完成     | Tiled 地图、map-runtime、地图实例/传送、AOI、节流 checkpoint、聊天  |
| 阶段 4：怪物与战斗             | 自动化完成 | game-domain、两怪物、技能、CombatEvent、复活；手工验收未单独记录    |
| 阶段 5：掉落与资产持久化       | 自动化完成 | game-application、物品/掉落/背包/装备/金币/经验、重登恢复、E2E      |
| 阶段 6：聊天、PK 与体验        | 待实测     | 安全区、PvP、死亡复活、聊天过滤、系统消息、小地图/角色面板、音效    |
| 阶段 7：运营后台与内容发布     | 未开始     | 等待阶段 6 用户验收                                                 |
| 阶段 8：质量、压测、部署与恢复 | 未开始     | —                                                                   |

## 3. 当前正在进行的任务

阶段 6 用户实测验收：在 `http://<LAN-IP>:8584/` 用两个独立窗口进入主城，确认：

- 顶部显示“主城安全区 · 禁止 PK”；点击对方角色或“攻击”按钮被服务端拒绝，
  双方 HP 不变；
- 进入野外后标识变为“野外 · 可自由 PK”，点击对方角色可攻击；
- 目标面板显示玩家名称/等级/HP，伤害浮字、死亡倒计时和系统公告生效；
- 被杀角色 3 秒后在野外出生点满 HP/MP 复活，击杀者经验/金币不变、无掉落；
- 小地图、`C` 角色面板、音效开关、断线/重连覆盖层可用；
- 含链接/“加微信”/刷屏的聊天被拦截，只显示系统警告；快速连发触发限频。

验收通过后再启动阶段 7。

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

## 5. 尚未完成内容

- 红名、爆装、罪恶值、死亡惩罚、竞技匹配与野外局部安全区（MVP 不做）。
- 聊天频道切换、持久化、人工审核、敏感词热更新、禁言/举报（阶段 7）。
- 正式音效、音乐与美术资源；当前音效为 WebAudio 合成占位，画面仍为占位美术。
- 运营后台、管理员 RBAC、Outbox、内容 Draft/Release/回滚（阶段 7）。
- 多地图线路、多 Game Server、Redis Presence/Driver、Room drain（阶段 8）。
- 50 人 10 分钟压测、战斗负载、patch bytes、带宽、崩溃恢复演练（阶段 8）。
- NPC 行为：当前只有编译 NPC 标记，没有对话/商店/任务。
- 独立测试数据库或临时 schema（仍未完成；当前集成/E2E 使用共享开发库）。
- 过期未领取掉落与 `asset_commands` 的定期清理；当前只从 Room 状态移除。
- 掉落归属剩余时间与掉落来源的客户端提示；当前只显示名称/数量。
- 装备外观：武器/护甲不改变角色 Sprite，只在面板与属性生效。
- 背包容量扩展、仓库、交易、摆摊、邮件与装备词条（非 MVP）。
- 密码找回、邮箱验证、MFA。
- 正式美术资源、怪物/技能动画与音效；当前为明确标识的几何占位表现与合成音效。
- 状态效果/Buff/范围伤害与投射物实体；阶段 4 只有 `directDamage` 与 `heal`。
- 经验/掉落内容仍在代码中，后台不可编辑（阶段 7）。

## 6. 当前技术风险

| 风险                                | 影响                             | 缓解                                                                  |
| ----------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| 单地图固定实例                      | 无法按人数开线路                 | MVP 单实例；阶段 8 增加实例与路由                                     |
| 传送为离开/重新加入                 | 切换有短暂加载                   | 服务端先提交再通知；客户端重建场景；后续优化体验                      |
| 传送提交后客户端未加入目标 Room     | 角色停留在目标地图               | 重新进入即可恢复；后续加传送回执与重试                                |
| AOI 依赖 Colyseus StateView 行为    | 升级可能改变过滤/带宽            | 集成测试锁定远处不可见、近处可见、离开释放                            |
| CombatEvent 全 Room 广播            | 远处玩家收到战斗表现事件         | MVP 事件量小；阶段 8 评估 AOI 事件过滤与带宽                          |
| 怪物/玩家无碰撞                     | 可重叠站位、点击判定重叠         | 不改变权威位置；后续增加软碰撞                                        |
| 怪物 AI 每 400ms 重算路径           | 大量怪物时寻路成本上升           | 当前 6 只；阶段 8 压测并优化                                          |
| 玩家复活固定在首个出生点            | 多人同时复活会堆叠               | MVP 可接受；阶段 6 评估最近安全点                                     |
| 战斗/怪物状态仅内存                 | 进程崩溃丢失怪物 HP 与冷却       | 允许按规则重建；资产与经验不在战斗中                                  |
| checkpoint 20 秒                    | 崩溃最多丢 20 秒瞬时状态         | 正常离开立即保存；资产不在 tick/内存中                                |
| 聊天无持久化/过滤                   | 无审核与跨图能力                 | 阶段 6/7 增加                                                         |
| 软件渲染下浏览器约 22–27 FPS        | 客户端帧率与可见延迟受影响       | 静态地表合批、nearest 渲染、20Hz patch；真机应更高                    |
| patch 20Hz 带宽约翻倍               | 30/50 人带宽需实测               | 阶段 8 记录 patch bytes 并重新评估                                    |
| Node fetch 拒绝 87 端口             | 负载脚本不能直连 matchmaking     | 通过 Vite `/ws` 代理 + `node:http` 读指标                             |
| 30 人短时负载不是容量承诺           | 不能据此宣称 50 人稳定           | 阶段 8 固定机器规格、10 分钟压测                                      |
| 进程崩溃后租约最长 30 秒仍有效      | 重启后短时间提示“另一台设备”     | 正常离开立即释放；阶段 8 增加进程注册与恢复策略                       |
| 票据/会话行不自动清理               | 表增长                           | MVP 数据量小；阶段 7/8 增加清理任务与指标                             |
| 认证/聊天限频为单进程内存           | 多实例下不一致                   | 阶段 8 使用网关或 Redis；MVP 单实例                                   |
| 共享开发数据库                      | 测试数据残留、掉落恢复污染       | 唯一账号/角色名、掉落按归属过滤、E2E 使用不同刷点；独立测试库仍未建立 |
| 掉落恢复按地图加载所有未过期记录    | 单实例假设；换实例会看到旧掉落   | MVP 每图固定单 Room；阶段 8 引入实例后需按实例归属                    |
| 过期掉落与资产命令行不自动清理      | 数据量随时间增长                 | MVP 数据量小；阶段 8 增加清理作业与指标                               |
| 资产队列按 Room 串行                | 数据库慢时拾取/装备 ACK 变慢     | 单 Room 资产量小；阶段 8 压测并按角色拆分或优化                       |
| 击杀奖励失败仅重试 3 次             | 数据库长时间不可用时奖励可能丢失 | 未提交不向玩家确认；阶段 8 增加持久奖励队列/Outbox                    |
| 生产掉落 RNG 使用 Math.random       | 无法回放单次奖励                 | 测试注入固定 RNG；运营争议阶段 7 记录内容与引用                       |
| 装备属性不写入 characters 表        | 派生属性需每次读取装备计算       | 单角色读路径简单；阶段 8 可加缓存并校验                               |
| 客户端点击优先攻击存活怪物          | 怪物脚下的掉落需从列表拾取       | HUD 掉落列表始终可用；阶段 6 调整交互                                 |
| PvP 数值未平衡                      | 职业/等级差异可能导致秒杀或拖沓  | 当前只验证机制；阶段 8 用压测与内容发布调参                           |
| 安全区按整张地图划分                | 野外无法设置局部安全区           | MVP 只做城镇/野外二分；后续按地图区域扩展                             |
| 聊天过滤为静态规则                  | 可能误杀正常词或漏掉变体         | 规则可注入并单测；阶段 7 接入词库/审核后台                            |
| 系统消息随人数增加                  | 大量加入/死亡消息占用 UI 与带宽  | 当前单图 30 人；阶段 8 评估频率、合并与开关                           |
| 合成音效为占位                      | 不代表最终听感                   | 音效可关闭；阶段 8 资源门禁后替换正式音频                             |
| 技术占位美术                        | 不代表最终画面                   | 阶段 8 前完成资源门禁与正式素材                                       |
| 开发 PostgreSQL 端口发布在所有接口  | 共享主机暴露风险                 | 仅本地开发；生产使用私有网络                                          |
| 容器 inotify 限额 8192              | watcher ENOSPC                   | 默认后端无 watch、Vite 轮询                                           |
| Playwright 浏览器无法在当前系统下载 | E2E 依赖预装 Chromium            | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`                          |
| Redis 8.2 本地镜像不可用            | scale profile 暂不可启动         | MVP 不依赖 Redis                                                      |

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
- 集成与 E2E 使用共享开发库，会留下测试账号/角色/票据/物品记录；当前库有
  1246 个角色（1136 个 `version > 0`）、652 条背包实例、19 条已装备实例、
  63 条地面实例、44 个钱包。
- Room 创建会恢复本图所有未过期掉落；共享库里残留的测试掉落会在 E2E 中出现，
  测试按 `ownerId` 过滤；存活怪物点击优先于掉落。
- 技术占位 tileset、角色 Sprite 与怪物几何造型为明确占位；Tiled 源图为正交
  逻辑网格，客户端做伪等距投影（ADR-018）。
- `patch` 为 20Hz；阶段 8 需重新评估带宽与频率。
- 战斗 HUD 位于底部中央，摄像机焦点上移 200px；极端窄屏会隐藏聊天面板。
- 怪物、玩家之间没有碰撞体积；两名玩家可以站在同一格。
- 技能栏只显示本职业技能 1；没有目标时敌方技能按钮禁用。
- 安全区只按地图划分：主城 `pvpMode=none` 禁止玩家互相攻击，野外 `open` 允许；
  没有野外局部安全区。
- PvP 击杀不产生经验、金币或掉落，也没有红名/爆装/死亡惩罚；死亡 3 秒后在
  本图出生点满状态复活。
- 玩家列表的“攻击”按钮在安全区仍会提交一次意图，由服务端返回安全区拒绝；
  目标面板的“攻击玩家”按钮在安全区禁用，避免误操作。
- 小地图只绘制碰撞、传送门、出生点与 AOI 内实体，不表现高低遮挡；系统消息最多
  显示最近 8 条，完整系统日志不持久化。
- 音效为 WebAudio 合成占位，首次点击/按键后才解锁 AudioContext；可在顶部关闭，
  设置保存在 localStorage。
- 击杀已发放经验、金币与掉落；升级会在原地回满 HP/MP，没有升级动画/音效。
- 背包 24 格、装备槽仅武器/护甲；没有背包整理、丢弃、出售或物品图标。
- 掉落归属 30 秒、2 分钟消失；客户端不显示归属倒计时，怪物脚下需从列表拾取。
- 退出世界后客户端会重新拉取角色列表；若 `/me` 失败则保留旧列表，重新入图会被
  服务端地图校验拒绝并提示。
- E2E 的并行战斗场景分别使用 `wilds_slime_2`（战斗）与 `wilds_slime_1`
  （经济），避免共享固定地图 Room 时互相击杀同一怪物。

## 8. 阻塞事项

无技术阻塞。阶段 6 等待用户在 8584 端口实测验收；验收通过前不启动阶段 7。

## 9. 最近一次测试结果

日期：2026-11-25

| 检查        | 命令                | 结果                                          |
| ----------- | ------------------- | --------------------------------------------- |
| 格式        | `pnpm format:check` | 通过                                          |
| Lint / 边界 | `pnpm lint`         | 通过（0 error / 0 warning）                   |
| 类型        | `pnpm typecheck`    | 通过（根配置 + 14 个 workspace）              |
| 单元/集成   | `pnpm test`         | 48 个文件，270 个测试全部通过（约 12.2s）     |
| 浏览器      | `pnpm test:e2e`     | 17 个测试全部通过（约 1.3 分钟）              |
| 构建        | `pnpm build`        | 4 个应用全部成功                              |
| 地图编译    | `pnpm maps:compile` | 2 张地图、schema 2、`pvpMode` 生效            |
| 负载        | `pnpm load:world`   | 30/30 玩家、750 接受、0 拒绝、tick p95 1.03ms |
| 迁移        | `pnpm db:migrate`   | 4 条迁移、11 张表（本阶段无新迁移）           |

阶段 6 关键证据：

- 契约与内容：`pvpMode` 进入编译地图 schema 2；town/wilds 分别编译为
  `none/open`，checksum 随内容变化；伪造 pvp 字段被严格 schema 拒绝。
- 领域：PvP 安全区拒绝不扣血/不耗蓝；玩家伤害/死亡/复活事件字段、复活位置与
  满状态、自伤/死亡/断线/超距拒绝、技能消耗、档案 `pvpEnabled/reviveMs` 均通过；
  聊天过滤覆盖正常中文、链接、交易引流、刷屏、注入规则。
- 服务端集成（真实 PostgreSQL + Colyseus）：主城攻击返回 `SAFE_ZONE` 且双方
  HP 不变；野外 PvP 死亡事件带 `killerId/reviveInMs`、系统公告、1.5 秒复活、
  满 HP、经验不变、`pvpKills` 指标；聊天 4/2s 限频与链接过滤、`chatFiltered`
  指标。
- 双浏览器 E2E：主城安全区拒绝、野外 PvP 击杀/公告/复活/无奖励、玩家 HP 条、
  小地图、角色面板、聊天过滤全部通过。
- 回归：阶段 1 双人移动、阶段 2 重连/租约、阶段 3 传送/AOI/聊天、阶段 4 双人
  战斗、阶段 5 经济/重登资产全部通过（17/17）。
- 负载：30/30 玩家、750 接受、0 拒绝、tick p50 0.16ms、p95 1.03ms、
  p99 1.72ms、max 2.27ms（233 个样本）。
- 数据库：4 条迁移、11 张表、1501 个角色、1049 条背包实例、30 条装备实例、
  101 条地面实例、130 条地面掉落、72 个钱包、75 条账本流水、166 条资产命令、
  0 个活跃租约；72 个钱包余额与流水合计不一致 0 个，最近流水幂等键缺失 0 个。
- 证据目录：`docs/phase-reports/phase-06/`（6 张截图、`load.txt`、
  `database.txt`、`metrics.json`；阶段 1–5 回归证据仍在各自目录）。

用户验收（历史）：

- 阶段 3 已于 2026-11-24 在 `http://<LAN-IP>:8584/` 通过用户实测验收。
- 阶段 4、阶段 5 自动化验收已通过；未单独记录手工验收结论。
- 阶段 6 已交付并等待同一地址的实测确认。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
- 阶段 1 修复提交：`954155f`、`5f2dbbf`、`f4b74ff`
- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
- 阶段 3 主提交：`80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
  主题：`feat(phase-3): deliver compiled maps, AOI, transfers and chat`
- 阶段 4 主提交：`cb3617bc5a1396df89661f206a0b9e0562fbe23e`
  主题：`feat(phase-4): deliver monsters, combat and skills`
- 阶段 5 主提交：`c5cc9e001772b2fa808f16f2a130ea46c5d441cc`
  主题：`feat(phase-5): deliver loot, inventory, equipment and persistent economy`
- 阶段 6 主提交：`029d2da`
  主题：`feat(phase-6): deliver pvp, safe zones, chat moderation and hud polish`

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0；PostgreSQL 18.3。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目默认使用 84–87。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131；浏览器在软件渲染下约 22–27 FPS。
- 开发库当前有 1501 个角色、1049 条背包实例、30 条装备实例、101 条地面实例、
  72 个钱包、166 条资产命令、0 个活跃租约。
- 阶段 2 创建的 132 个角色已通过 `pnpm repair:maps` 迁移到主城。
- 开发栈运行于 Node.js 26.13.1；服务端/Control API 为 `tsx`（无 watch），
  前端 Vite 轮询热更新。阶段 6 收尾时已重启 game-server/control-api 到本阶段
  代码；`http://<LAN-IP>:8584/` 可供实测。

## 12. 下一步

1. 在 `http://<LAN-IP>:8584/` 实测阶段 6：双窗口主城攻击被拒 → 进入野外 PvP →
   死亡倒计时/公告/复活 → 小地图/角色面板/音效 → 聊天过滤与限频 → 重连。
2. 用户验收通过后标记阶段 6 完成，再启动阶段 7：运营后台、RBAC、Outbox、
   内容 Draft/Release/回滚与审计。
3. 保持阶段 1–6 的移动/传送/AOI/聊天/租约/checkpoint/战斗/资产/PvP 测试为
   回归门禁。
4. 阶段 6 验收通过前不得进入阶段 7。
5. 阶段 7 前评估独立测试数据库、过期掉落/资产命令清理与聊天/系统消息的持久化
   与审核。正式音效与美术资源仍在阶段 8 门禁后替换。
