# ADR-024：测试数据隔离与 WebSocket 连接指标

- 状态：Accepted
- 日期：2026-11-25
- 阶段：9（MVP 收口）
- 关联：ADR-005、ADR-023、
  `docs/PROJECT_STATUS.md` 第 5 节“独立测试数据库”与技术风险“共享开发库”、
  `docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md` 第 15.1 节网络指标

## 1. 背景

阶段 0–8 已交付 MVP 功能，但两项验收基础仍不完整：

1. `pnpm test` 的 60 个测试文件全部连接共享开发库，用唯一 ID 规避冲突。多次
   运行会留下内容 Release、审计、Outbox、账号与物品实例，后台列表混杂，且
   并行运行之间没有数据库级隔离。PROJECT_STATUS 将其列为未完成项与风险。
2. 架构第 15.1 节要求 Network 指标包含“断线率、重连率、每玩家上下行 bytes”，
   MVP 计划阶段 8 任务也要求记录 WS bytes 与重连率。当前只有出站字节
   （`wsSentBytes` / `wsPatchBytes`），没有入站字节，也没有连接、断线、重连计数；
   且 `onJoin` 的出站包装在重连后的新 Client 上没有重新应用，重连后的出站字节
   会漏计。

本阶段不新增玩法，只补齐这两项验收基础。

## 2. 决策

### 2.1 每次测试运行使用独立临时数据库

- `pnpm test` 启动时由 `vitest.config.ts` 生成唯一数据库名
  `wl_test_<base36 时间戳>_<随机后缀>`，并把指向该库的 `DATABASE_URL`
  注入测试进程。
- `packages/persistence/test/databaseGlobalSetup.ts` 在测试开始前创建数据库并
  运行现有 Drizzle 迁移；测试结束后 `teardown` 删除该库（`WITH (FORCE)`）。
  启动时清理超过 24 小时、前缀为 `wl_test_` 的残留库，避免异常中断积累。
- 采用独立数据库而不是同库 schema：Drizzle 生成的迁移 SQL 显式使用
  `"public"."<type>"` 等全限定名，同库 schema 无法隔离枚举与表；临时数据库
  是唯一不改迁移文件、又能获得干净 `public` 的方案。
- 基础连接串优先取 `TEST_DATABASE_URL`，否则取 `DATABASE_URL`。目标角色需要
  `CREATEDB`；创建失败时给出明确提示。`NODE_ENV=production` 时拒绝执行。
- 迁移记录表回到新库自己的 `drizzle.__drizzle_migrations`，不复用开发库的
  迁移状态。

E2E 仍使用开发栈：它验证的是真实运行中的 Vite 代理、Control API、Game Server
与内容激活拓扑，拆成临时 schema 需要同时启动一套独立进程与端口，收益低于
成本。E2E 继续使用唯一账号/角色名，并在阶段报告中记录该边界。

### 2.2 在 Room 内按客户端采集网络指标

- 入站：在 `onJoin` / `onReconnect` 为底层 WebSocket 注册 `message` 监听，
  按 WS payload 字节累加 `wsReceivedBytes`。与出站 `client.raw` 的
  `data.byteLength` 口径一致，都是消息负载，不含 TCP/TLS/WS 帧头。
- 出站：把现有的 `client.raw` / `client.enqueueRaw` 包装提取为
  `instrumentClient`，初次加入和重连都应用，修复重连后出站字节漏计。
- 连接生命周期：
  - `wsConnections`：初次成功加入 Room；
  - `wsDisconnects`：非主动离开且未处于传送中（进入重连宽限期）；
  - `wsReconnects`：`onReconnect` 成功续接。
- 指标按 Room 聚合，JSON `/metrics` 与 `/metrics/prometheus` 读取同一注册表；
  Prometheus 新增四个计数器。每玩家上下行字节由 `bytes / players` 或
  Prometheus 查询计算，不再增加可能除以零的派生序列。
- 负载脚本输出入站字节、连接/断线/重连计数与重连率，并断言入站字节大于 0。

## 3. 后果

- 测试可以并行、重复运行而不污染开发库；残留数据库由启动清理兜底。
- 迁移仍只由 drizzle 生成并原样执行；测试不修改迁移文件。
- 网络指标仍按 Room 维度，不提供单会话标签，避免高基数；单玩家问题用日志与
  集成测试定位。
- E2E 的共享开发库边界保留，后续若需要独立 E2E 环境，可复用
  `TEST_DATABASE_URL` + 独立端口启动一套栈。
- 每次 `pnpm test` 多一次建库与全量迁移（本机约数秒）；这是换取可重复、
  不污染开发数据的代价。
