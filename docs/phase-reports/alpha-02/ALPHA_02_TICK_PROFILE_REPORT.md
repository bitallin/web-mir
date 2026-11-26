# Alpha 0.2 S4-F：50 人 tick p95 剖析与 AOI 批处理

- 日期：2026-11-26
- 触发：S4-B 的 50 人 × 10 分钟回归 tick p95 14.75ms、p99 21.01ms，高于
  Alpha 0.2 的 10ms 目标；p50 只有 1.1ms，说明问题在长尾而不是稳态计算量。
- 关联：`docs/PROJECT_ROADMAP.md` Alpha 0.2 验收、TD-SRV-03、TD-CLI-05

## 1. 方法

1. 用生产构建 `apps/game-server/dist/index.js`（`NODE_ENV=test`，避免开发日志
   transport）配合 Vite 84 与 Control API 86，排除 tsx 转译与开发日志干扰。
2. 先跑 50 人 × 2 分钟无剖析基线，记录 tick p50/p95/p99 与资产队列。
3. 用 `node --cpu-prof --cpu-prof-interval=500` 重跑同样负载，按
   `simulateTick` 子树聚合自耗时（`perf/profile-tick-hotspots.txt`）。
4. 只改剖析证明的热点，再用完全相同的 2 分钟场景对比，最后跑 50 人 × 10 分钟
   门禁。

## 2. 剖面结果

`simulateTick` 子树只占进程墙钟的 2.9%，但占非空闲 CPU 的约 39%。子树内部：

| 热点                           | 占 tick 自耗时 | 说明                                      |
| ------------------------------ | -------------- | ----------------------------------------- |
| `visibleIdsFor` + `refresh`    | 54.3%          | AOI 每个受影响观察者都重建 Set 与邻居数组 |
| `neighbourhoodIds`             | 6.7%           | 每次移动都分配数组                        |
| `writev` + msgpackr `pack`     | 28.2%          | tick 内战斗事件逐客户端序列化与写入       |
| `findPath` / `isWalkable`      | 0.4%           | 寻路不是瓶颈                              |
| `syncPlayers` / `syncMonsters` | 0.9%           | 状态同步本身很轻                          |

关键发现：`simulateTick` 里玩家与怪物移动各自调用 `views.refresh(affected)`；
同一 tick 内多个实体跨格时，同一个观察者会被重复刷新。50 人同时移动时，AOI
重复计算是 p95 长尾的主要来源。GC 全进程约 0.9s/333s，主要来自这些临时
Set/数组与消息序列化，不是独立问题。

## 3. 改动

1. **AOI 每 tick 只刷新一次**
   - `WorldMapRoom` 新增 `pendingViewRefresh` 集合；玩家与怪物移动把受影响
     观察者入队，tick 末尾 `flushViewRefresh()` 去重后统一刷新。
   - 刷新仍在 tick 内完成，`session.visible` 对下一 tick 与战斗事件有效；未改变
     可见性语义。
2. **去掉每次刷新的中间分配**
   - `InterestManager.collectVisibleIds(id, target)` 直接把可见实体填入调用方
     Set，不再先建邻居数组再建 Set。
   - `collectNeighbourhood` 供 `move` 复用；`visibleIdsFor` 仍保留原 API 供测试
     与其它调用方使用。
   - `StateViewPublisher` 复用 `requested` 与 `desired` 两个 Set，每次刷新不再
     分配。
3. **每个 tick 只取一次玩家列表**
   - `simulateTick` 复用 `players` 数组给位置快照、传送门检测、AOI 移动与
     `syncPlayers`，少 3 次数组分配/复制。

没有改协议、内容、数据库或客户端；没有降低任何 tick 业务逻辑。

## 4. 结果

### 4.1 相同 2 分钟场景（50 人 / 10 攻击者）

| 指标 | 改前   | 改后   |
| ---- | ------ | ------ |
| p50  | 1.71ms | 1.11ms |
| p95  | 12.59  | 5.15   |
| p99  | 17.30  | 7.87   |
| max  | 20.28  | 9.29   |

两次都是生产构建、无剖析、同一脚本与同一地图；证据
`perf/load-50p10a-2min-before.json`、`perf/load-50p10a-2min-after.json`。

### 4.2 50 人 × 10 分钟门禁

| 指标         | S4-B 基线 | 本轮    |
| ------------ | --------- | ------- |
| 加入         | 50/50     | 50/50   |
| 接受率       | 99.1%     | 99.0%   |
| 击杀         | 780       | 784     |
| 资产失败     | 0         | 0       |
| tick p50     | 1.10ms    | 0.69ms  |
| tick p95     | 14.75ms   | 5.34ms  |
| tick p99     | 21.01ms   | 6.67ms  |
| tick max     | 23.00ms   | 6.92ms  |
| 资产事务 p95 | 47.37ms   | 48.40ms |
| RSS 峰值     | 329MB     | 289MB   |

证据：`perf/load-50p10a-10min-s4f.json`。p95 已低于 10ms 目标，p99 也低于
40ms 目标；资产队列与网络量级与基线一致，说明提升来自 tick 内部而不是负载
变化。

## 5. 验证与回归

| 检查       | 命令/方式                                  | 结果                                         |
| ---------- | ------------------------------------------ | -------------------------------------------- |
| 单元/集成  | `pnpm test`                                | 69 文件、**455 测试**通过（新增 1 条）       |
| AOI/战斗   | `world.integration` + `combat.integration` | 32/32 通过                                   |
| 浏览器 E2E | `pnpm test:e2e`                            | **38/38 通过**（4.3 分钟，2 worker，独立库） |
| 构建       | `pnpm build`                               | 4 个应用成功                                 |
| 格式/lint  | `pnpm format:check`、`lint`                | 通过（0 error / 0 warning）                  |
| 类型       | `pnpm typecheck`                           | 通过（根 + 15 个 workspace）                 |

全量 E2E 首轮仍在 `multiplayer.spec.ts` 的“两账号 250ms 内可见”上超时
（307ms）。该用例单跑 `--repeat-each=3` 3/3、随后全量重跑 38/38；与本切片
之前的表现一致，是软件渲染下的已知时序抖动，未降低断言阈值，也未通过放宽
AOI 刷新频率来迁就测试。

## 6. 剩余风险与后续

- **AOI 刷新延迟上限**：现在一次 tick 内最多延迟 50ms 才把可见性写入
  `session.visible`；与原来“逐个实体在中段刷新”相比，对下一 tick 的生效时间
  一致。若未来同一 tick 内需要“移动后立刻按新视野裁定”，应显式刷新而非依赖
  tick 末批次。
- **事件序列化**：tick 内 28% 自耗时是战斗事件的 msgpackr 打包与 `writev`。
  事件按 AOI 投递已生效；若未来团战事件量继续增长，再评估按 tick 批量发送
  或降低非关键事件频率，不能在没有协议设计的情况下直接合并消息。
- **资产队列 p95 48ms**：本轮未变化，也未阻塞 tick；按 TD-SRV-03 在需要时
  单独评估。
- 10 分钟门禁已达标，但建议在后续版本继续用 `pnpm load:regression` 观察
  共享机器上的趋势；单次 2 分钟与 10 分钟结果会受同时运行的浏览器/测试影响。
