# ADR-018: Tiled 地图运行时、地图实例、AOI 与服务端传送

- 状态：Accepted
- 日期：2026-11-24
- 关联：MVP 计划阶段 3；架构文档 6、7、8.4、8.6、8.7、10.3–10.4、12
- 实施：阶段 3

## 背景

阶段 1 和阶段 2 共用一张手写技术测试地图和一个 `world_map` Room。阶段 3 必须
交付真实世界：两张 Tiled 地图、碰撞/导航编译、主城 ↔ 野外传送、AOI、节流
checkpoint 和同图聊天。验收条件要求：

- Tiled 中的碰撞与服务端导航一致；
- 玩家不能穿墙、超速或到达非法坐标；
- 传送不会重复生成角色实体；
- 玩家离开后释放 AOI 订阅；
- Room 重启后角色从 PostgreSQL 恢复；
- 至少 30 个虚拟用户可以入图移动，tick 指标可观测。

同时必须继续遵守既有约束：Room 只做适配、tick 内无 IO、PostgreSQL 是唯一
持久事实来源、资产操作事务化、客户端只能提交意图。

## 决策

### 1. Tiled 源图是正交逻辑网格，客户端负责伪等距投影

- `content/maps/starter_town.tmj` 与 `starter_wilds.tmj` 使用 Tiled 正交
  （orthogonal）方向、32×32 逻辑格。图层固定为 `ground`、`deco_low`、
  `deco_high`、`collision`，对象层为 `spawn_points`、`portals`、
  `npc_points`、`monster_spawns`。
- 碰撞是独立的 0/1 网格；地形 tile id 只影响表现，不参与通行判定。
- 客户端继续使用既有 `(x - y) * 32 + offset` 伪等距投影渲染；逻辑坐标、碰撞、
  寻路和攻击距离都不使用屏幕像素。
- 备选方案是让 Tiled 直接使用 isometric 方向。放弃原因：对象坐标与编辑器
  投影耦合、负坐标与偏移难以在客户端和服务端之间稳定对齐，而且逻辑网格与
  表现投影没有必要绑定。

### 2. `map-runtime` 编译 Tiled 源为不可变 `MapRuntimeManifest`

- 新包 `@web-legend/map-runtime` 只依赖 `contracts` 与 Node 内置模块，不依赖
  Colyseus、Fastify、数据库或任何 app。
- `pnpm maps:compile` 读取 `content/assets/manifest.json` 中声明的源图，编译到
  `content/maps/compiled/<mapId>.json`，并写入：
  - 地图稳定 ID、名称、类型、宽高、逻辑 tile 尺寸；
  - tileset 引用与 asset manifest 版本；
  - ground/decoLow/decoHigh/collision 四个完整网格；
  - 出生点、传送门、NPC 点、怪物刷点；
  - SHA-256 checksum。
- 编译期校验：必需图层、网格尺寸、tile id 范围、碰撞值只能是 0/1、出生/
  传送/NPC/刷怪点必须在可走格、传送门 id 唯一、传送目标地图存在且目标格可走、
  传送门从出生点可达、地图 ID 唯一。
- 运行期 `createMapRuntime` 校验 checksum 后才提供导航网格和传送门查询。
  客户端与服务端使用同一份编译产物，但只有服务端把它当作权威导航。
- Tiled 源文件不进入运行时；运行时只信任已校验的编译产物。

### 3. Map Template / Map Instance / Room 固定映射

- MVP 每个地图模板只有一个固定实例：`starter_town-1`、`starter_wilds-1`。
- Colyseus room type 为 `world_map:<mapId>`；`WorldState` 公开 `mapId` 和
  `instanceId`，保留未来多线路的扩展点。
- 客户端**不能选择地图**：Control API 签发的票据绑定角色，Game Server 读取
  PostgreSQL 中的 `characters.map_id`，加入的 Room 必须与之一致，否则 525。
- 一个地图实例只允许一个权威 Room（ADR-003）。后续新增线路时，实例 ID 与
  room type 一起扩展。

### 4. 传送由服务端发起，客户端只跟随指令

```text
玩家站在传送门格
  -> Room 标记 transferring（拒绝后续指令）
  -> 事务性写入 characters.map_id + 目标坐标 + HP/MP
  -> 释放角色租约
  -> 从旧 Room 的模拟/状态/AOI 中移除实体
  -> 发送 session.transfer { mapId }
  -> 客户端重新向 Control API 申请一次性 ticket
  -> 客户端加入目标地图 Room，获取租约并从 PostgreSQL 恢复位置
```

- 传送目标坐标来自编译 manifest，客户端不能提交目标地图或坐标。
- 传送状态在目标存档提交成功后才对客户端可见；写入失败则取消传送并恢复可操作。
- 先移除旧实体、再通知客户端离开，保证角色不会在两个 Room 中同时存在。
- 离开旧 Room 时不重复 checkpoint 或释放租约（已在传送流程完成）。
- 客户端不得通过 `?join`、join options 或房间名绕过地图归属校验。

### 5. AOI 使用按格分区 + Colyseus StateView

- `@web-legend/game-simulation` 新增 `InterestManager`：地图按 8×8 tile 分格，
  每个实体可见自身所在格及相邻 8 格（radius 1）。它只在实体加入/离开/跨格时
  返回受影响的可视者，不做每 tick 全量 O(N²) 距离扫描。
- 每个客户端拥有一个 `StateView`；`WorldState.players` 声明为
  `t.map(PlayerState).view()`，只向该视图编码被加入的实体。
- 加入、离开、跨格时增量 `view.add`/`view.remove`；断线宽限期内实体保留并
  标记 `connected=false`，但仍在 AOI 内可见。
- `mapId`、`instanceId`、`serverTick`、`playerCount` 等根字段保持公开；背包、
  账号、GM 标记等私有数据不进入 Room State。
- 备选方案是每 tick 计算所有客户端距离并广播。放弃原因：实现简单但违背
  “不要用每 tick 全量 O(N²)”的约束，且不能利用 Colyseus 的编码能力。

### 6. 节流 checkpoint 与 HP/MP

- 位置、朝向、HP/MP 每 20 秒合并 checkpoint；测试可注入更短间隔。
- 正常离开、宽限期结束、Room dispose 时立即 checkpoint。
- 地图切换只通过传送事务写入 `map_id`；普通 checkpoint 永不改变地图。
- checkpoint 是异步 Application 层操作，不在 20Hz tick 内 `await`；同一会话
  同时最多一个进行中的 checkpoint。

### 7. 同图聊天

- 新消息 `chat.send` / `chat.message`：
  - `chat.send` 严格校验 `{protocolVersion, clientMessageId, message}`；
  - 消息 1–120 字符，拒绝空白和控制字符；
  - 每个会话令牌桶 4 突发、2 条/秒；
  - 32 条最近 `clientMessageId` 去重；
  - 服务端广播到当前 Room（即当前地图实例），不回写数据库。
- 聊天不是资产操作，不去重持久化；跨地图聊天、私聊、过滤词库不在本阶段。

### 8. 状态同步频率

- 阶段 3 将 Room patch 间隔从架构初始的 100ms（10Hz）调整为 50ms（20Hz），与
  模拟 tick 对齐。
- 原因：AOI 使用 per-client `StateView` 编码后，10Hz patch 加 50ms tick 在
  CPU 争用下使“点击到远端可见”接近甚至超过 250ms 验收门禁；20Hz 后独立测量
  约 165ms、完整浏览器套件仍低于门禁。
- 代价：patch 带宽约翻倍。当前地图与玩家数下可忽略，阶段 8 必须用 30/50 人
  压测重新评估频率、patch bytes 和带宽，不以本阶段的数值作为最终容量承诺。

### 9. 客户端表现与资源

- `content/assets/manifest.json` 描述 tileset 与角色贴图的稳定 ID、帧尺寸、
  方向顺序和占位实现类型。
- Phaser 加载编译地图、tileset PNG 与角色 SpriteSheet；草地/道路/水面/墙/
  装饰按 manifest 绘制，角色使用脚底锚点并按世界 Y 深度排序。
- 传送后客户端销毁旧 Phaser 实例并基于新 manifest 重建场景；桥接层丢弃旧
  地图快照，避免残留实体。
- 当前 PNG 是明确标注的技术占位美术，阶段 8 前的视觉门禁不在本阶段范围。

## 影响与代价

- **一致性**：Tiled、服务端导航和客户端画面共用一份编译产物与 checksum，
  编译期即可发现不可走出生点、断开的传送门和非法图层。
- **可测试性**：地图编译、AOI 和传送都是纯逻辑或可注入依赖，单元/集成测试
  不依赖浏览器。
- **性能**：AOI 只在跨格/加入/离开时更新；30 人实测 tick p95 < 1ms。
- **限制**：
  - 每个地图模板只有一个固定实例；多线路/多进程路由仍未实现。
  - 传送通过“离开旧 Room + 新票据加入新 Room”完成，不能在同一 WebSocket
    内无缝切换；切换期间客户端显示“正在前往新的地图”。
  - 聊天不持久化，AOI 依赖 Colyseus 0.18 的 `StateView` 编码行为，升级时
    必须用集成测试锁定。
  - 阶段 2 创建的 132 个角色原本位于已退役技术地图；使用
    `pnpm repair:maps` 一次性迁移到主城出生点（幂等，不修改 schema）。
- **未改变**：数据库 schema、协议版本、一次性票据、租约、资产事务和
  PostgreSQL 唯一事实来源。

## 备选方案

| 方案                                       | 结论                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Tiled isometric 直接作为源格式             | 放弃：逻辑与表现耦合，对象坐标难以跨端对齐                       |
| 每 tick 全量距离计算 AOI                   | 放弃：O(N²)，且客户端仍会收到全量实体                            |
| 客户端自行选择目标地图                     | 放弃：违反服务端权威，地图归属可被伪造                           |
| Game Server 直接签发传送票据               | 暂缓：Control API 已有票据签发与归属校验；复用可减少一条签发路径 |
| 传送后保留旧 Room 实体直到新 Room 加入成功 | 放弃：会出现短暂双实体；先移除再通知更符合验收                   |

## 后续

- 多线路/多实例与 Room 归属路由（阶段 8 扩容）。
- 传送失败与网络中断的补偿重试、传送审计事件。
- 聊天过滤、频道与持久化（阶段 6/7 按产品需要）。
- 真实美术资源替换占位 tileset 与角色贴图。
