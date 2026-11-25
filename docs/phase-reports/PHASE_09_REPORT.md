# 阶段 9 报告：MVP 收口（测试数据隔离与 WebSocket 观测）

- 日期：2026-11-25
- 状态：实现与自动化验收完成；等待用户确认
- 关联：`docs/ADR/ADR-024-phase9-test-isolation-network-observability.md`、
  `docs/WEB_LEGEND_MVP_PLAN_v2.md` 第 19 节、
  `docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md` 第 15.1 节

## 1. 背景与阶段判定

MVP 计划定义的阶段 0–8 已全部交付：阶段 0–3 通过用户验收，阶段 4–8 的实现与
自动化验收完成。本阶段开始时没有第 9 个预定义阶段，因此先对照 MVP
Definition of Done 与 PROJECT_STATUS 的未完成项做差距审计。

审计结论：游戏体验、后台、容量、备份恢复与版本追踪的 DoD 项均已有真实实现与
证据；仍属 MVP 验收基础、且不新增玩法的缺口有两项：

1. **测试数据不隔离**：60 个 Vitest 文件全部连接共享开发库，重复/并行运行会
   留下账号、物品、审计、Content Release 与 Outbox 数据；PROJECT_STATUS 将其
   列为未完成项和技术风险。
2. **网络观测不完整**：架构 15.1 要求断线率、重连率与每玩家上下行 bytes，
   MVP 计划阶段 8 任务也要求记录 WS bytes 与重连率；现有指标只有出站字节，
   没有入站字节与连接生命周期计数，且重连后的出站字节漏计。

因此阶段 9 定位为“MVP 收口”，只补验收基础，不新增玩法、不改协议语义、不改
数据库 schema。阶段 7 的用户实测与阶段 8 的证据确认仍是待办，不因本阶段改变。

## 2. 完成内容

### 2.1 一次性测试数据库（ADR-024）

- `vitest.config.ts` 每次运行生成 `wl_test_<base36 时间戳>_<随机后缀>`，把
  `DATABASE_URL` 指向该库；基础连接优先 `TEST_DATABASE_URL`，否则
  `DATABASE_URL`。
- `packages/persistence/test/testDatabase.ts` 负责建库、运行现有 Drizzle
  迁移、删库与残留清理；`databaseGlobalSetup.ts` 作为 Vitest 全局
  setup/teardown。
- 采用临时数据库而不是同库 schema：Drizzle 生成的迁移显式使用
  `"public"."<type>"`，同库 schema 会在枚举上冲突。
- 异常中断残留库在下次运行启动时清理（默认 24 小时）；
  `TEST_DATABASE_STALE_MS=0 pnpm test` 可立即清理。
- `NODE_ENV=production` 拒绝建库/删库；`CREATEDB` 缺失时给出明确错误。

### 2.2 WebSocket 入站与连接生命周期指标

- `RoomMetrics` 新增：
  - `wsReceivedBytes`：客户端 WS payload 字节；
  - `wsConnections`：初次成功加入 Room；
  - `wsDisconnects`：非主动、非传送断线进入重连宽限期；
  - `wsReconnects`：宽限期内成功续接。
- `WorldMapRoom.instrumentClient` 统一包装出站 `raw`/`enqueueRaw` 与底层
  WebSocket `message` 事件；初次加入与重连都会应用，修复重连后出站漏计。
- JSON `/metrics` 与 `/metrics/prometheus` 同步输出；Prometheus 指标：
  `web_legend_game_server_ws_received_bytes_total`、
  `ws_connections_total`、`ws_disconnects_total`、`ws_reconnects_total`。
- 负载脚本输出 `wsIn`、连接/断线/重连计数与重连率，并断言入站字节大于 0。

### 2.3 测试与文档

- 新增 `testDatabase.test.ts`（命名、URL 替换、临时库与迁移表断言）。
- 扩展 `metrics.test.ts`、`prometheus.test.ts` 与
  `world.integration.test.ts`（重连计数、入站字节、JSON 指标）。
- AGENTS、README、PROJECT_STATUS、WORKLOG、ADR-024 与本报告。

## 3. 验收证据

| 证据         | 位置                                              | 结果                                                                             |
| ------------ | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| 测试隔离     | `docs/phase-reports/phase-09/test-isolation.txt`  | 测试前后开发库账号/角色/物品/审计/Release/Outbox 计数一致；0 残留库              |
| 指标 JSON    | `docs/phase-reports/phase-09/metrics.json`        | totals 含 `wsReceivedBytes` / `wsConnections` / `wsDisconnects` / `wsReconnects` |
| Prometheus   | `docs/phase-reports/phase-09/metrics.txt`         | 4 个 WS 指标带 room/realm/map/instance 标签与实时数值                            |
| 短时负载     | `docs/phase-reports/phase-09/load-short.json`     | 6/6 加入、360 接受、tick p95 0.75ms、出站 1,353,745B、入站 58,638B、0 资产失败   |
| 重连集成测试 | `apps/game-server/test/world.integration.test.ts` | 断线 → 宽限期 → 重连后 `wsDisconnects≥1`、`wsReconnects=1`、出站/入站均有计数    |

实时 Prometheus 快照（4 人负载期间）：

```text
web_legend_game_server_room_players{room="uhxTbnqzY",realm="classic-01",map="starter_wilds",instance="1"} 4
web_legend_game_server_ws_sent_bytes_total{...} 30624
web_legend_game_server_patch_bytes_total{...} 8467
web_legend_game_server_ws_received_bytes_total{...} 1220
web_legend_game_server_ws_connections_total{...} 4
web_legend_game_server_ws_disconnects_total{...} 0
web_legend_game_server_ws_reconnects_total{...} 0
```

## 4. 自动化门禁

| 检查        | 命令                                                                        | 结果                                      |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| 格式        | `pnpm format:check`                                                         | 通过                                      |
| Lint / 边界 | `pnpm lint`                                                                 | 通过（0 error / 0 warning）               |
| 类型        | `pnpm typecheck`                                                            | 通过（根配置 + 15 个 workspace）          |
| 单元/集成   | `pnpm test`                                                                 | 61 个文件、329 个测试全部通过（约 13.3s） |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e`（2 workers）                 | 20/20 通过（约 1.8 分钟）                 |
| 构建        | `pnpm build`                                                                | 4 个应用成功                              |
| 短时负载    | `LOAD_PLAYERS=6 LOAD_ATTACKERS=2 LOAD_DURATION_MS=30000 pnpm load:scenario` | 通过；入站字节 > 0、0 资产失败            |

## 5. 未完成项与边界

- E2E 仍连接开发栈数据库，只靠唯一账号/角色名隔离；完全隔离需要独立端口与
  一套测试栈，未在本阶段实施。
- 网络指标按 Room 聚合，没有单会话标签；需要定位单玩家问题时仍依赖日志与
  集成测试。
- 入站字节为应用层 WebSocket payload，不含 TCP/TLS/WS 帧头；与出站
  `data.byteLength` 口径一致。
- 阶段 7 的 8584/8585 实测与阶段 8 的部署/恢复确认仍待用户完成；本阶段不改变
  这两项待办。
- 数据库角色需要 `CREATEDB`；受限环境需设置 `TEST_DATABASE_URL`。

## 6. 决策记录

- ADR-024：一次性测试数据库与 Room 级网络指标。
- 不修改已提交的迁移文件；隔离通过临时数据库实现。
- 不引入 `prom-client`；继续使用手写 Prometheus 渲染器。
- 不新增派生指标（如每玩家 bytes）：避免除以零与高基数，查询侧计算。

## 7. 阶段提交

- 阶段 9 主提交：`8e3e534`
  主题：`feat(phase-9): isolate test databases and complete websocket metrics`。

## 8. 下一步

1. 用户确认本报告与 `docs/phase-reports/phase-09/` 证据。
2. 在其数据库角色上验证 `pnpm test` 的一次性库创建/删除，或配置
   `TEST_DATABASE_URL`。
3. 完成阶段 7 实测与阶段 8 生产演练确认后，再评估 E2E 独立环境、Outbox
   独立 worker、审计/Release 归档、多 Realm 路由与聊天持久化。
