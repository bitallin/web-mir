# Alpha 0.3 S4-D：世界内到达任务目标标记

> 日期：2026-11-28
> 切片：到达目标在世界与小地图中可见，到达后自动移除
> 状态：完成
> 债务：关闭 TD-CLI-24

## 1. 背景与目标

S3-D2 的到达任务（`quest_town_east_gate`、`quest_daily_ruins_patrol`）已能
接取、自动寻路并在服务端权威位置完成，但世界与小地图上没有目标标记：玩家手动
完成时只能按面板里的坐标（如“到达 晨曦主城（35,15）”）寻找。TD-CLI-24 记录
了这一可发现性缺口。

本切片只做展示层：把“当前地图上未完成的到达目标”画成低干扰的地面圈、浮动
菱形与小地图标记；是否到达仍完全由服务端判定，协议、内容与数据库不变。

## 2. 设计

### 2.1 标记来源是服务端任务状态

`apps/game-web/src/lib/reachMarkers.ts` 的 `reachMarkersFor(quests, mapId)`
是唯一派生入口：

- 只取 `status === 'active'` 且 `progress < 1` 的任务；
- 只取 `objective.kind === 'reach'` 且 `objective.mapId` 等于当前地图；
- 输出 `questId / title / tile / radiusTiles`，不推断位置、不读客户端坐标。

因此接取后出现、完成或交付后消失，都以服务端快照/更新为准；换图后旧地图的
标记自动不匹配，不会残留。

### 2.2 世界标记

`WorldScene` 新增 `setQuestMarkers`：为每个标记绘制

- 与任务半径一致的地面椭圆（半透明填充 + 金色描边，呼吸式淡入淡出）；
- 一条很淡的竖直光柱与上下浮动的菱形；
- 任务标题文字（带描边，避免与地形混淆）。

整体深度为 `center.y - 2`，位于地面与实体之间，不遮挡玩家、怪物与 HUD；多个
到达任务同时激活时各自绘制。

### 2.3 小地图标记

`Minimap` 收到同一份派生列表，在任务目标格绘制金色圆环（半径按任务配格数
换算）与中心菱形，并在图例中增加「任务目标」。同时把数量与坐标写入
`data-quest-markers` / `data-quest-tiles`，供真实浏览器断言。

### 2.4 场景重建与过图

标记不放进 React DOM，而是通过 `WorldBridge` 推给 Phaser：

- 桥保存最近一次标记，场景 `create()` 完成并 `attach` 时自动重放，避免
  过图/场景重启后标记消失；
- `bridge.reset()` 清空标记；会话在 `switchMap` 与任务快照/更新时重新派生；
- 过图期间任务列表按既有行为先清空，新 Room 的任务快照到达后重新出现标记。

## 3. 验证

### 3.1 单元测试

新增 `apps/game-web/src/lib/reachMarkers.test.ts` 3 条：

1. 只标记当前地图上进行中的到达任务；
2. 进度为 1 或状态为 completed 时移除；
3. 击杀/收集目标不产生标记。

### 3.2 真实浏览器

扩展 `tests/e2e/reachQuests.spec.ts`：

1. 接取「东门巡视」（普通接取，不立即导航）；
2. 关闭任务面板，断言小地图 `data-quest-markers=1`、`data-quest-tiles=35,15`；
3. 断言场景确实绘制了该标记（`questMarkerScreenPoint` 非空）；
4. 点击追踪器「前往」自动探索，服务端判定到达后任务变为 completed；
5. 断言小地图标记归零、场景标记为 null；
6. 继续原有「去交付」与金币 +5 断言。

证据：

- `docs/phase-reports/alpha-03/reach-quests/reach-marker.png`：世界金色菱形/
  光柱/地面圈 + 小地图金环与图例 + 追踪器“未到达”；
- `docs/phase-reports/alpha-03/reach-quests/reach-completed.png`：到达后标记
  消失、任务变为“可交付”。

### 3.3 回归

- `pnpm test`：86 个文件、**629 个测试**通过；
- `pnpm exec playwright test`：**51/51** 通过（6.0 分钟）；
- `pnpm lint`、`pnpm typecheck`、`pnpm build`：通过；
- 变更只涉及 `game-web` 展示层；未改协议、内容、数据库或服务端热路径，因此
  未重跑 50 人容量回归。

## 4. 债务与限制

- **TD-CLI-24 关闭**：世界与小地图均有到达目标标记，到达后自动移除。
- 标记只对“当前地图、进行中”的到达任务生效；跨图任务仍通过任务面板与一键
  导航表达，不在当前地图画远处箭头。
- 标记为展示层派生，不新增协议字段；若后续需要“点击标记直接前往”，应复用
  既有 `quest.navigate` 意图，而不是在客户端改位置。
- 未验证：8584 人工试玩（E2E 已在 5184 隔离栈完成真实浏览器验证）。
