# ADR-016: 阶段 1 权威移动模型与技术测试地图

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 7.2、8.2、8.4、10.4；MVP 计划阶段 1 任务 5–7、阶段 3

## 背景

阶段 1 需要真实的服务端权威移动，但正式 Tiled 地图、导航网格和 map-runtime 属于
阶段 3。需要先冻结一套简单、确定、可测试的移动模型，并明确它将被什么替换。

## 决策

### 坐标与速度

- 逻辑坐标使用**整数子格单位**：`TILE_UNITS = 1000`，一格 1000 单位；
- 玩家位于格中心时坐标为 `x * 1000 + 500`；
- 默认速度 `4000 units/s`（4 格/秒），由服务端配置并通过 ack/state 告知客户端；
- 屏幕像素只用于表现层投影，不参与碰撞、寻路和距离判定。

### 服务端移动

1. 客户端只发送 `move.to`：`protocolVersion`、`commandId`、`clientSequence`、
   目标 tile。
2. Room 校验会话、协议、序号、令牌桶限频、目标边界与可走性。
3. `game-simulation` 在 4 方向网格上做确定性 BFS，得到 tile 中心路径。
4. 固定 20Hz 步进沿路径推进；`FixedStepRunner` 累积实际 delta，单次最多追赶
   5 步，避免事件循环卡顿后的雪崩。
5. 状态 patch 频率 10Hz（100ms）。
6. 客户端收到 `command.ack` 后获得服务端裁定的路径，可做短期预测；快照与预测
   偏差超过 900 单位（0.9 格）时吸附到权威位置。远端玩家使用插值。

### 协议与状态

- `move.to`、`command.ack`、`command.rejected`、`system.notice` 的 Zod schema
  与拒绝码在 `@web-legend/contracts`。
- `WorldState` / `PlayerState` Colyseus schema 通过
  `@web-legend/contracts/world-state` 子路径共享；根入口不引入 Colyseus schema，
  避免 Control API / 管理后台无谓打包。
- `commandId` 幂等：重复命令返回原 ack 并标记 `deduplicated=true`；
  更小的 `clientSequence` 返回 `STALE_SEQUENCE`。

### 技术测试地图

- `content/maps/phase1_test_map.json` 是客户端和服务端共同加载的同一份数据；
- `mapManifestSchema` 校验尺寸、行宽、瓦片字符、出生点边界与可走性；
- 地图包含一个封闭房间，用于证明不可达目标会被拒绝；
- 该地图是**技术资产**，视觉上明确是占位地图，不冒充最终美术。

## 替代方案

1. **浮点坐标**：跨端序列化与插值容易出现精度差异，不利于确定性和回放。
2. **客户端寻路/客户端坐标**：违反服务端权威，直接拒绝。
3. **阶段 1 就接 Tiled + 完整导航网格**：超出本阶段范围，且会推迟“双浏览器可玩”
   这一核心验证。
4. **把地图放到 `map-runtime` 包**：该包按 ADR-013 在阶段 3 创建；阶段 1 的 manifest
   schema 暂由 `contracts` 承载。

## 影响

- `game-simulation` 可以在没有 Colyseus、Phaser 和数据库的情况下做确定性测试。
- 阶段 3 用 Tiled 编译产物替换测试地图时，保留 `move.to` / ack / 状态字段和
  20Hz/10Hz 节奏，只替换地图数据源与导航实现。
- 当前 BFS 是四方向，斜向移动和更丰富的导航代价在阶段 3 评估。
