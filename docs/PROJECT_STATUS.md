# Web Legend 项目状态

> 更新日期：2026-11-24
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 1：浏览器双人联网垂直切片 —— 已完成，等待 Tech Lead 审阅。**

阶段 0 已通过审阅。阶段 2（账号、角色和连接票据）尚未开始。按用户要求，阶段 1
报告提交后停止，等待审阅通过再继续。

## 2. 阶段进度

| 阶段                           | 状态           | 说明                                                               |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| 阶段 0：工程底座               | 已完成         | 工程、依赖、质量门禁、数据库、健康检查、文档                       |
| 阶段 1：双浏览器联机切片       | 已完成，待审阅 | 测试地图、world_map Room、服务端移动、双浏览器可见、重连、HUD、E2E |
| 阶段 2：账号与票据             | 未开始         | 等待阶段 1 审阅通过                                                |
| 阶段 3：地图与服务端移动       | 未开始         | —                                                                  |
| 阶段 4：怪物与战斗             | 未开始         | —                                                                  |
| 阶段 5：掉落与资产持久化       | 未开始         | —                                                                  |
| 阶段 6：聊天、PK 与体验        | 未开始         | —                                                                  |
| 阶段 7：运营后台与内容发布     | 未开始         | —                                                                  |
| 阶段 8：质量、压测、部署与恢复 | 未开始         | —                                                                  |

## 3. 当前正在进行的任务

无。当前处于阶段 1 审阅门禁。

## 4. 已完成内容

### 阶段 0 保留内容

- pnpm workspace Monorepo；Node.js 26.13.1、pnpm 11.7.0、TypeScript 5.9.3。
- ESLint 依赖边界、Prettier、Vitest、Playwright、Vite/tsup 构建。
- PostgreSQL 18 + Drizzle 迁移；Fastify Control API；Colyseus 健康检查与
  diagnostics Room；Pino 日志与脱敏。
- 工程文档、ADR-001…014、阶段 0 报告。

### 阶段 1：浏览器双人联网垂直切片

`packages/contracts`：

- `mapManifestSchema`（技术地图 manifest，校验尺寸、行宽、瓦片字符、出生点）。
- 实时协议：`move.to`、`command.ack`、`command.rejected`、`system.notice`、
  拒绝码、协议常量（20Hz、100ms、4000 units/s、1000 units/tile）。
- `worldJoinOptionsSchema`：严格校验的临时开发身份，拒绝额外字段。
- `PlayerState` / `WorldState` Colyseus schema（`contracts/world-state` 子路径），
  客户端与服务端共用同一份定义。

`packages/game-simulation`（阶段 1 新包）：

- `FixedStepRunner`：累积 delta、固定步长、5 步追赶上限。
- 四方向确定性 BFS；不可达、越界、阻挡格返回 null。
- `WorldSimulation`：整数子格坐标、速度推进、路径/朝向、出生点校验、移除。

`apps/game-server`：

- `world_map` Room：每房间一个地图实例，20Hz 模拟、100ms patch、50 人上限。
- 服务端权威 `move.to`：会话、协议、序号、幂等、令牌桶限频、边界/可走性校验，
  服务端 BFS 路径，ack 返回权威路径。
- 开发身份仅 `NODE_ENV=development|test`；生产无票据一律拒绝。
- 断线 15 秒重连宽限、恢复座位、超时移除；同一开发身份禁止双连接。
- `/metrics`：每房间 tick p50/p95/p99/max、玩家数、命令接受/拒绝与拒绝码统计。
- 4KB WebSocket payload 上限。

`content/maps/phase1_test_map.json`：

- 30×20 伪等距技术测试地图，含边界墙、柱体、草地和一个封闭房间（不可达测试）。

`apps/game-web`：

- 伪等距投影、按脚底 Y 深度排序的角色、墙体遮挡、摄像机跟随、窗口 resize。
- 点击移动；本地沿服务端 ack 路径短期预测，偏差 >0.9 格吸附校正；远端插值。
- HUD：连接状态、房间、延迟、在线玩家列表（位置/连线状态）、指令计数、拒绝提示、
  重新加入按钮。
- 同源 `/ws`（Vite 代理 matchmake HTTP + WebSocket upgrade）；sessionStorage
  重连 token；`room.reconnection.minUptime = 0` 支持早期断线重连。
- StrictMode 下延迟启动，避免双连接/双 Phaser 实例；Scene 重启清理输入与 scale
  监听并重新挂载 bridge。

`tests/e2e`：

- 双 Browser Context 同房可见、移动在 250ms 内被对方看到（浏览器内计时）。
- 页面刷新后使用重连 token 恢复且不产生重复玩家。
- 主动断开后显示“重连中”并自动恢复。
- Phaser Scene 重启后一次点击只发送一条指令（无重复输入监听）。

### 文档与治理

- ADR-015：临时开发身份与重连凭据（阶段 2 退出条件）。
- ADR-016：阶段 1 权威移动模型与技术测试地图。
- 阶段 1 报告与截图、WebSocket 帧日志、tick 指标证据。

## 5. 尚未完成内容

- 阶段 2 起全部玩法与业务：账号/票据、Tiled 正式地图、导航网格、AOI、怪物、
  战斗、技能、掉落、背包、装备、金币、聊天、PK、复活、运营后台和内容发布。
- 角色位置/HP/MP 持久化（阶段 3/5）；本阶段位置只在 Room 内存中。
- 多地图、地图切换、多线路、多 Game Server、Redis Presence/Driver。
- 生产部署、HTTPS/WSS、限频网关、监控接入、压测、备份恢复。
- 独立测试数据库/临时 schema（阶段 5 前）。
- 正式美术资源与 Tiled 管线；当前地图与角色是明确标识的技术占位资产。

## 6. 当前技术风险

| 风险                                   | 影响                            | 缓解                                                                    |
| -------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| 技术测试地图与占位角色视觉             | 不代表最终画面与手感            | 明确标注技术资产；阶段 3 接 Tiled/资源管线；当前不做视觉验收            |
| 250ms 可见性目标接近本机上限           | 容器/软件渲染下偶发接近 200ms   | 实测 136–204ms；浏览器内计时；若后续超标先查 patch 与渲染，不降低断言   |
| Colyseus 0.18 API 较新                 | 升级可能改变 Room/消息/重连行为 | 真实 WebSocket 集成测试锁定 join/移动/拒绝/重连/指标；升级必须重跑      |
| 单房间 30/50 人容量尚未实测            | 阶段 8 目标未知                 | 阶段 8 做真实压测；当前单图 50 人上限只是保护值                         |
| 开发身份仅限开发环境                   | 生产没有可用身份                | 生产 onAuth 无条件拒绝；阶段 2 用一次性 game ticket 替换（ADR-015）     |
| `joinOrCreate` 可能加入既有房间        | 多人测试/体验可能进入他人房间   | 开发参数 `?fresh=1` / `?join=<roomId>` 隔离测试；正式房间选择在阶段 2/3 |
| tick 指标窗口固定 240 样本（约 12 秒） | 长时间 p95 不可见               | 阶段 8 接 Prometheus；当前用于阶段验收和日志                            |
| 位置不持久化                           | Room 崩溃后角色回到出生点       | 阶段 3 checkpoint、阶段 5 资产持久化；符合当前阶段范围                  |
| 本地 PostgreSQL 18.3，CI/生产目标 18.7 | 补丁差异                        | 同属 18.x；CI 使用 18.7；升级本地镜像后重跑                             |
| 开发 PostgreSQL 端口发布在所有接口     | 共享主机暴露风险                | 仅本地开发；宿主机防火墙限制，生产使用私有网络                          |
| 容器 inotify 限额 8192                 | watcher ENOSPC                  | 默认后端无 watch、Vite 轮询                                             |
| Playwright 浏览器无法在当前系统下载    | E2E 依赖预装 Chromium           | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`                            |
| 集成测试使用共享开发库                 | 并行/残留数据风险               | 阶段 5 前建立独立测试库或临时 schema                                    |
| Redis 8.2 本地镜像不可用               | scale profile 暂不可启动        | MVP 不依赖 Redis                                                        |

## 7. 已知问题

- 当前环境 84–87 端口可能被上一阶段遗留的开发栈占用；本次阶段 1 验证在
  8844–8847 运行同一套服务（仅端口不同）。正常环境直接使用默认端口。
- `pnpm dev` 默认不热重载后端；修改后端需重启开发栈。前端 Vite 轮询热更新。
- 开发端口为 84/85/86/87，而非架构示例中的 5173/5174/3000/2567。
- 浏览器通过同源 `/ws` 访问实时服务器；生产反向代理必须转发该路径的 HTTP 与
  WebSocket，或设置 `VITE_GAME_SERVER_URL`。
- `?name/?key/?fresh/?join` 仅在开发构建生效；生产构建忽略。
- 管理后台仍只有阶段 0 健康状态与交付说明，没有业务页面（阶段 7）。
- 正式账号、角色名唯一、票据和单角色会话租约在阶段 2 实现。
- `pnpm test:e2e` 会启动 game-web、admin-web、game-server 三个服务；开发栈已
  运行时加 `PLAYWRIGHT_SKIP_WEBSERVER=true`。

## 8. 阻塞事项

无硬阻塞。阶段 2 开始前需要 Tech Lead 审阅阶段 1 报告并明确批准。

## 9. 最近一次测试结果

日期：2026-11-24

| 检查        | 命令                                                           | 结果                                    |
| ----------- | -------------------------------------------------------------- | --------------------------------------- |
| 格式        | `pnpm format:check`                                            | 通过                                    |
| Lint / 边界 | `pnpm lint`                                                    | 通过（0 error / 0 warning）             |
| 类型        | `pnpm typecheck`                                               | 通过（根配置 + 10 个 workspace）        |
| 单元/集成   | `pnpm test`                                                    | 21 个文件，94 个测试全部通过（约 3.0s） |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e`（开发栈运行中） | 6 个测试全部通过（约 23s）              |
| 构建        | `pnpm build`                                                   | 4 个应用全部成功                        |
| 迁移        | `pnpm db:migrate`                                              | 阶段 1 未改 schema；阶段 0 迁移仍可重跑 |

阶段 1 关键证据：

- 双浏览器移动可见延迟（浏览器内计时，5 次单独运行 + 完整套件）：136ms、145ms、
  152ms、179ms、180ms、204ms，全部 < 250ms。
- `world_map` 集成测试连续 3 次 8/8 通过：双客户端互相可见、服务端移动、伪造
  payload/错误协议/墙体/封闭房间拒绝、幂等、限频、重连、宽限期移除、指标。
- 实时指标（2 名玩家，52 个 tick 样本）：tick p50 0.02ms、p95 0.03ms、
  p99 0.07ms、max 0.07ms；接受命令 2，拒绝 0。
- E2E 证据：`docs/phase-reports/phase-01/two-players-{alice,bob}.png`、
  `after-refresh.png`、`websocket.log`。
- 生产服务器测试：开发身份 join 返回 525，`diagnostics` Room 未注册（520）。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
- 主题：`feat(phase-1): deliver browser two-player realtime slice`

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0；PostgreSQL 18.3。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目默认使用 84–87。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131。

## 12. 下一步

等待阶段 1 审阅。批准后按 `docs/phase-reports/PHASE_01_REPORT.md` 第 10 节进入
阶段 2：账号、角色、一次性 game ticket、单角色会话租约与角色持久化。阶段 2
验收通过前不得进入阶段 3。
