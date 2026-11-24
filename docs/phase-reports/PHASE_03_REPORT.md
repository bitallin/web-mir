# 阶段 3 报告：正式地图、服务端移动和世界状态

> 日期：2026-11-24
> 状态：已完成，并通过用户实测验收（2026-11-24，8584 端口）
> 前置：阶段 0、阶段 1、阶段 2 已通过审阅
> 相关决策：[ADR-018](../ADR/ADR-018-phase3-map-runtime-aoi-transfer.md)

---

## 1. 阶段概述

阶段 3 把阶段 1/2 的手写测试地图替换为真实的 Tiled 地图与世界运行时，并建立
地图实例、服务端传送、AOI、节流 checkpoint 和同图聊天：

```text
Tiled 源图（starter_town / starter_wilds）
  -> pnpm maps:compile 生成 MapRuntimeManifest + SHA-256 checksum
  -> Room 按地图模板固定实例：world_map:starter_town / world_map:starter_wilds
  -> 玩家持一次性 ticket 加入角色持久化所在地图的 Room
  -> 服务端在编译导航格上寻路、推进、校验碰撞
  -> 玩家站在传送门：事务写入新地图/坐标/HP/MP -> 释放租约 -> session.transfer
  -> 客户端重新取 ticket 并加入目标地图 Room，从 PostgreSQL 恢复位置
  -> 每 20 秒合并 checkpoint 位置/HP/MP；同图聊天按会话限频广播
```

阶段 3 不实现怪物、战斗、技能、掉落、背包、装备、金币、PK、复活或运营后台。

---

## 2. 开工前一致性检查

- 阅读 `AGENTS.md`、`PROJECT_STATUS.md`、`WORKLOG.md`、架构 v2、MVP 计划 v2、
  阶段 2 报告与 ADR-017。
- `git status` 干净，HEAD 为 `85badc2`（阶段 2 验收与交接文档）。
- 阶段 2 的 `world_map` Room 只加载一张手写技术测试地图；`contracts` 只有该
  地图的 manifest；没有 `map-runtime`、地图实例、AOI、传送或聊天。
- 数据库已有 2 条迁移和 132 个仍位于 `phase1_test_map` 的角色。
- 结论：阶段 3 的全部目标均未实现，与阶段计划一致；地图/AOI/传送属于新的
  架构决策，先写 ADR-018 再实施。

---

## 3. 目标与范围

### 3.1 本阶段完成

1. Tiled 源图 `starter_town`（40×30）与 `starter_wilds`（44×32）。
2. `MapRuntimeManifest` 编译：碰撞、导航、出生点、传送点、NPC 点、怪物刷点、
   asset manifest 版本与 checksum。
3. `map-runtime` 包：Tiled 解析、跨图校验、可达性校验、运行时导航与传送门。
4. Phaser 加载编译地图、tileset、角色 SpriteSheet 与资源 manifest。
5. 脚底锚点、Y-sort、墙体遮挡、摄像机跟随。
6. 点击移动、客户端路径预览、服务端权威寻路/推进/碰撞。
7. `MapTemplate` / `MapInstance` / Room 固定映射（每张地图一个固定实例）。
8. 主城 ↔ 野外传送与坐标恢复，服务端发起、无重复实体。
9. AOI：8×8 tile 分区、相邻 8 格可见、每客户端 `StateView`。
10. 同图玩家可见性与状态同步。
11. 断线宽限期、重连、离开清理与 AOI 资源释放。
12. 角色位置/朝向/HP/MP 每 20 秒节流 checkpoint。
13. 同图聊天：长度、控制字符、限频、去重与服务端广播。
14. 30 个虚拟玩家入图移动的 tick 指标。

### 3.2 明确不做

- 怪物实体、战斗、技能（阶段 4）。
- 掉落、背包、装备、金币、ledger（阶段 5）。
- PK、复活、聊天过滤与频道（阶段 6）。
- 运营后台、内容 Draft/Release（阶段 7）。
- 多线路、多 Game Server、Room drain、50 人长时压测（阶段 8）。

---

## 4. 交付内容

### 4.1 `content/`

- `maps/starter_town.tmj`、`maps/starter_wilds.tmj`：正交逻辑网格，图层
  `ground`、`deco_low`、`deco_high`、`collision`，对象层 `spawn_points`、
  `portals`、`npc_points`、`monster_spawns`。
- `maps/compiled/*.json`：由 `pnpm maps:compile` 生成并提交；测试会重新编译并
  逐字段比较，防止产物过期。
- `assets/manifest.json`：tileset/角色贴图的稳定 ID、尺寸、方向、帧数与版本。
- `assets/generated/starter_terrain.png`、`player_placeholder.png`：明确标注的
  技术占位美术，用于验证资源管线，不代表最终风格。

### 4.2 `packages/contracts`

- `mapRuntime.ts`：编译地图 schema、地图 ID、可走判定、`worldRoomNameFor` /
  `mapIdFromRoomName`。
- `maps.ts`（子路径 `@web-legend/contracts/maps`）：校验并导出两张编译地图。
- `assets.ts`：asset manifest / tileset / character / map entry schema。
- `realtime.ts`：`chat.send`、`chat.message`、`session.transfer`；patch 间隔
  调整为 50ms（20Hz，见 ADR-018）。
- `worldState.ts`：新增 `instanceId`、玩家 HP/MP；`players` 集合标记 `.view()`
  以支持 AOI 视图过滤。
- 移除阶段 1 的 `mapManifestSchema`、技术地图与 `phase1-map` 子路径。

### 4.3 `packages/map-runtime`（阶段 3 新建）

- `tiled.ts`：Tiled JSON 子集 schema。
- `compile.ts`：必需图层、网格尺寸、tile 范围、0/1 碰撞、出生/传送/NPC/刷点
  可走、传送 id 唯一、跨图目标存在且可走、传送门从出生点可达。
- `checksum.ts`：稳定序列化与 SHA-256；运行时不匹配则拒绝加载。
- `runtime.ts`：导航格、传送门索引、单位坐标转 tile。
- `compileMaps.ts`：读取 asset manifest，写出编译产物。
- 9 个测试覆盖真实双图编译、产物新鲜度、非法图层/出生点/跨图目标/不可达传送门、
  checksum 篡改。

### 4.4 `packages/game-simulation`

- `interest.ts`：`InterestManager` 按 8×8 tile 分格、radius 1；只在加入/离开/
  跨格时返回受影响视图，不做每 tick 全量距离扫描。
- 移除对技术地图的依赖；导航来源改为服务端编译地图。
- 6 个 AOI 测试 + 既有移动/寻路测试。

### 4.5 `packages/persistence`

- `saveCharacterTransfer`：事务写入 `map_id`、坐标、朝向、HP/MP 与版本号。
- `relocateCharactersFromMap`：退役地图角色的一次性幂等迁移。
- 无 schema 变更、无新迁移。

### 4.6 `apps/game-server`

- `world/mapRegistry.ts`：每个地图模板一个固定实例，room type 为
  `world_map:<mapId>`。
- `server.ts`：为每张编译地图注册 Room。
- `worldMapRoom.ts`：
  - 加入时校验票据、区服、角色 **持久化地图** 与 Room 一致；
  - 编译导航格寻路、碰撞与目标校验；
  - 站立传送门自动触发服务端传送；传送中拒绝指令；
  - 每客户端 `StateView` AOI，加入/离开/跨格增量更新；
  - 20 秒节流 checkpoint，离开/宽限期/Dispose 立即保存；
  - 同图聊天：Zod、120 字符、控制字符、令牌桶 4/2s、32 条去重；
  - 指标新增聊天数与传送数。
- `scripts/worldLoad.ts`：30 虚拟玩家的真实账号/角色/票据负载检查。

### 4.7 `apps/control-api`

- 新建角色出生点改为 `starter_town` 的编译出生点。
- `repair:maps` 脚本：把仍位于 `phase1_test_map` 的角色幂等迁移到主城出生点；
  本次执行迁移了 132 个角色。

### 4.8 `apps/game-web`

- `mapCatalog.ts`：加载两张编译地图与 asset manifest，解析 tileset 与角色帧。
- `WorldScene`：静态地表/低层装饰合成到单个 RenderTexture；墙体挤出、树冠遮挡、
  NPC 与传送门标记、脚底锚点玩家 Sprite、Y 深度排序、路径预览。
- 传送后销毁旧 Phaser 实例、丢弃旧快照，按新地图 manifest 重建场景。
- HUD：地图名/ID、附近玩家、HP/MP、地图频道聊天、指令/tick/延迟。
- 开发调试钩子新增 `moveToTile`、`currentMapId` 与可见性诊断时间。

### 4.9 测试与证据

- 33 个测试文件、167 个测试，全部通过。
- 12 个真实浏览器 E2E，覆盖注册/建角、双人可见、刷新、租约、断线、Scene 重启、
  登出、局域网、撞墙、双向传送、聊天。
- 30 玩家负载检查与数据库证据。
- 证据目录：`docs/phase-reports/phase-03/`。

---

## 5. 关键接口

### 5.1 地图编译

```text
pnpm maps:compile
  content/maps/starter_town.tmj  -> content/maps/compiled/starter_town.json
  content/maps/starter_wilds.tmj -> content/maps/compiled/starter_wilds.json
```

编译产物包含稳定 `mapId`、`width/height`、四个完整网格、出生/传送/NPC/刷点、
`assetManifestVersion` 与 SHA-256 `checksum`。

### 5.2 实时加入与地图归属

```json
{ "protocolVersion": 1, "ticket": "一次性 base64url 票据" }
```

Room type 由客户端根据角色的持久化 `mapId` 选择；服务端再次校验
`characters.map_id === room.mapId`，不一致返回 525。客户端不能提交地图。

### 5.3 传送

服务端 → 客户端：

```json
{ "mapId": "starter_wilds", "serverTime": 1763970000000 }
```

客户端收到后重新申请一次性 ticket，加入 `world_map:starter_wilds`。

### 5.4 聊天

客户端 → 服务端：

```json
{ "protocolVersion": 1, "clientMessageId": "uuid", "message": "一起打怪吗？" }
```

服务端 → 当前地图所有客户端：

```json
{
  "messageId": "uuid",
  "playerId": "uuid",
  "displayName": "角色名",
  "message": "一起打怪吗？",
  "channel": "map",
  "serverTime": 1763970000000
}
```

---

## 6. 验收标准对照

| 验收标准                                | 结果 | 证据                                                                               |
| --------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| Tiled 碰撞与服务端导航一致              | 通过 | 同一编译产物驱动服务端寻路；墙体点击不发指令（E2E）；非法目标 525/拒绝（集成测试） |
| 玩家不能穿墙、超速或传送到非法坐标      | 通过 | 服务端编译格寻路与固定速度推进；伪造/墙内/封闭区目标均拒绝；集成测试断言位置未变   |
| 主城 ↔ 野外传送不重复生成角色实体       | 通过 | 传送先移除旧实体再通知；集成测试旧 Room 实体消失、新 Room 人数 1；E2E 传送后人数 1 |
| 玩家离开 Room 后释放 AOI 订阅和资源     | 通过 | 离开时 `view.dispose()`、兴趣表删除、跨视图刷新；数据库 0 个活跃租约               |
| Room 重启后角色从 PostgreSQL 恢复       | 通过 | checkpoint 测试在离开后新建 Room 并断言坐标/朝向；版本号递增                       |
| 至少 30 个虚拟用户入图移动，tick 可观测 | 通过 | 30/30 加入，750 条移动被接受，0 拒绝；tick p95 1.53ms、p99 2.20ms、max 3.11ms      |
| 同图玩家可见性与状态更新                | 通过 | 双人 E2E 139ms 内看到对方移动；AOI 屏蔽远处玩家（集成测试）                        |
| 同图聊天服务端校验与限频                | 通过 | 广播、重复 id 去重、121 字符拒绝、突发限频（集成测试）；双浏览器 E2E 收到消息      |
| 节流 checkpoint                         | 通过 | 测试注入 250ms 间隔，未离开世界即写入 PostgreSQL；正常离开立即保存                 |
| 地图/资源版本可追踪                     | 通过 | 编译产物 checksum 与 asset manifest 版本；运行时拒绝 checksum 不匹配               |

---

## 7. 测试结果

执行时间：2026-11-24，Node 26.13.1 / pnpm 11.7.0。

| 检查        | 命令                                           | 结果                                          |
| ----------- | ---------------------------------------------- | --------------------------------------------- |
| 格式        | `pnpm format:check`                            | 通过                                          |
| Lint / 边界 | `pnpm lint`                                    | 通过（0 error / 0 warning）                   |
| 类型        | `pnpm typecheck`                               | 通过（根配置 + 12 个 workspace）              |
| 单元/集成   | `pnpm test`                                    | 33 个文件、167 个测试全部通过（约 6.3s）      |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e` | 12 个测试全部通过（约 1.1 分钟）              |
| 构建        | `pnpm build`                                   | 4 个应用全部成功                              |
| 地图编译    | `pnpm maps:compile`                            | 2 张地图编译成功；产物新鲜度测试通过          |
| 角色迁移    | `pnpm repair:maps`                             | 132 个阶段 2 角色迁移到 `starter_town`        |
| 负载        | `pnpm load:world`                              | 30/30 玩家、750 接受、0 拒绝、tick p95 1.53ms |

E2E 证据（`docs/phase-reports/phase-03/`）：

- `auth-screen.png`、`character-screen.png`、`two-players-{alice,bob}.png`、
  `after-reload.png`、`wilds-after-transfer.png`、`town-after-return.png`、
  `chat-received.png`。
- `websocket.log`：点击 → 意图 2ms；意图 → 服务端 ack 85ms；点击 → 远端首个
  moving 快照 101ms；点击 → 远端 DOM 139ms；浏览器 rAF 24/22 帧/秒。
- `load-test.txt`：30 人、750 条接受、0 拒绝、tick p50 0.15ms、p95 1.53ms、
  p99 2.20ms、max 3.11ms（229 个样本）。
- `database-evidence.txt`：2 条迁移、6 张表；`starter_town=509`、
  `starter_wilds=3` 个角色；481 个角色 `version > 0`；0 个活跃租约；
  548 张票据（520 已消费、28 已过期、0 张未消费未过期）。

> 负载客户端通过 Vite 的 `/ws` 代理连接，因为 Node 的 `fetch`（Colyseus SDK
> matchmaking 使用）拒绝 87 端口这个 WHATWG bad port；`/metrics` 通过
> `node:http` 读取。该约束已写入 `AGENTS.md`。

---

## 8. 问题与修复

1. **AOI 最初没有过滤实体**：`StateView` 只对 `isFiltered` 的树生效，而完全公开
   的 `players` 集合会被优化为全量下发。把集合字段声明为
   `t.map(PlayerState).view()` 后，`view.add/remove` 才会按客户端过滤；集成测试
   锁定“远处玩家不可见”。
2. **250ms 可见性门禁在软件渲染下抖动**：完整套件出现 248–273ms。诊断发现
   浏览器 rAF 仅约 13 FPS，WebSocket 回调被慢帧延迟。处理：
   - 静态地表/低层装饰合成到单个 RenderTexture，绘制对象从约 1250 降到几十；
   - Phaser 使用 nearest/`pixelArt`/关闭抗锯齿；
   - patch 间隔调整为 50ms（20Hz），保留带宽余量。
     修复后 rAF 22–27，点击到远端 DOM 139ms（完整 12 测试套件）。
3. **Node fetch 拒绝 87 端口**：Colyseus SDK 的 matchmaking 使用 `fetch`，失败于
   WHATWG bad port。负载客户端改用 Vite `/ws` 代理，指标用 `node:http` 读取。
4. **随机负载会穿过传送门**：随机目标导致 1–2 个虚拟玩家被传送到野外，房间人数
   降到 28–29。负载脚本改为只在出生点可达且位于传送门以西的区域移动。
5. **E2E 撞墙测试点到建筑内部**：(31,5) 是石地板而非墙；改用外墙 (30,5)，并
   验证指令计数保持 0、角色坐标不变。
6. **阶段 2 角色无法进入新地图**：角色仍持久化为已退役的 `phase1_test_map`。
   新增幂等 `pnpm repair:maps`，将 132 个角色迁移到主城出生点；不修改 schema。
7. **`client.view = undefined` 与 `exactOptionalPropertyTypes`**：改为
   `delete client.view` 后再 `dispose()`。
8. **Lint 类型细节**：未绑定方法传给 Zod parse、聊天控制字符正则、
   `node:crypto.randomUUID` 在 contracts 测试中的类型解析问题，均已修正。
9. **地图编译产物可能过期**：加入“重新编译并与提交产物逐字段比较”的测试，CI
   会在 Tiled 源图变更但未运行 `maps:compile` 时失败。

---

## 9. 未完成事项与已知限制

| 限制                                        | 影响                               | 后续                           |
| ------------------------------------------- | ---------------------------------- | ------------------------------ |
| 每张地图只有一个固定实例                    | 不能按人数开线路                   | 阶段 8 增加实例与路由          |
| 传送是“离开旧 Room + 新票据加入新 Room”     | 切换期间有短暂加载，不是无缝迁移   | 阶段 8 Room drain/重连体验优化 |
| 传送提交后客户端若不加入目标 Room           | 角色停留在目标地图，需重新进入     | 客户端重试与传送回执           |
| 聊天只在内存中，无过滤/频道/持久化          | 不支持跨图、私聊、审核             | 阶段 6/7                       |
| AOI 依赖 Colyseus 0.18 `StateView` 编码行为 | 升级需重新验证过滤与带宽           | 升级时保留集成测试为门禁       |
| checkpoint 间隔 20 秒                       | 进程崩溃最多丢失 20 秒移动/HP/MP   | 阶段 8 结合崩溃恢复调优        |
| 50 人 10 分钟压测、patch bytes、带宽未测    | 不能据此宣称最终容量               | 阶段 8                         |
| NPC 点与怪物刷点只有数据                    | 地图上只有 NPC 标记，没有行为      | 阶段 4（怪物）/阶段 6（NPC）   |
| 技术占位 tileset/角色贴图                   | 不代表最终美术风格                 | 资源门禁与正式美术             |
| 当前主机使用软件渲染                        | 浏览器帧率约 22–27 FPS；真机应更高 | 阶段 8 在目标机器测渲染与容量  |
| 负载客户端绕过 Node fetch 的端口限制        | 负载路径与浏览器同源代理一致       | 生产压测使用真实入口           |

---

## 10. 阶段 4 建议任务清单

1. `game-domain` 纯战斗函数：命中、伤害、暴击、抗性、冷却、资源消耗。
2. 怪物定义与刷点从编译 manifest 读取；`wild_slime`、`forest_wolf` 两种基础怪物。
3. 怪物 FSM：`idle → patrol → chase → attack → return → dead`，服务端固定 tick。
4. 战士普攻与 `slash`；法师/道士至少 1 个基础技能，复用受控 Effect DSL。
5. 服务端注入 RNG；相同 seed 与输入得到确定结果。
6. CombatEvent 表现事件、受击/伤害数字、死亡与刷新。
7. 双浏览器一致性测试：同一怪物唯一权威 HP、客户端不能伪造伤害/冷却/死亡。
8. 保持阶段 3 的 AOI、传送、租约、checkpoint、聊天测试为回归门禁。
9. 30 人 + 20–40 怪物的 tick 指标预演，为阶段 8 的 50 人压测做准备。

---

## 11. 审阅门禁

阶段 3 已完成并由用户在 8584 端口实测验收。阶段 4 可以启动；不得把 NPC/怪物
数据点当作已完成怪物系统，也不得用 30 人短时负载结果宣称 50 人容量。

---

## 12. Git 提交

- 阶段 3 主提交：`80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
  主题：`feat(phase-3): deliver compiled maps, AOI, transfers and chat`。
- 本报告、状态与证据随主提交归档；提交哈希由紧随其后的 `docs(phase-3)` 提交记录。
