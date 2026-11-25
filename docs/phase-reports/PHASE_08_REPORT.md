# 阶段 8 报告：质量、压测、部署与恢复

- 日期：2026-11-25
- 状态：实现与自动化验收完成；等待用户确认
- 关联：`docs/WEB_LEGEND_MVP_PLAN_v2.md` 阶段 8、
  `docs/ADR/ADR-023-phase8-production-observability-recovery.md`、
  `docs/runbooks/DEPLOYMENT_AND_RECOVERY.md`

## 1. 目标与范围

证明系统不只是“开发机可玩”，而是可部署、可观测、可恢复，并且不增加玩法：

- 生产镜像、compose 拓扑与 nginx 反向代理（HTTPS/WSS、安全头、限流）；
- Prometheus 指标与告警；保留已有 JSON `/metrics` 供负载脚本使用；
- Game Server 进程显式绑定 Realm，内容按 Realm 激活版本解析；
- 不可变镜像标签、发布与回滚脚本；代码回滚与内容回滚互不影响；
- PostgreSQL 备份、独立演练库真实恢复与不变量校验；
- Game Server 正常/崩溃重启、数据库不可用、Outbox 重试的演练；
- 30+10 玩家 10 分钟容量场景与 50 玩家短时场景；
- 发布、回滚、Room drain、内容回滚与数据库恢复 runbook。

不在本阶段：新玩法、正式美术/音效、多 Game Server/多 Realm 路由、独立 Outbox
worker、Redis/Kafka/Kubernetes。

## 2. 完成内容

### 2.1 Realm 绑定与按区服内容

- `GAME_SERVER_REALM`（默认 `classic-01`）绑定进程；`WorldMapRoom.onAuth` 校验
  角色所属区服，不再使用“第一个活跃区服”的隐式选择。
- `ContentStore` 按 Realm code 查询 `realm_active_content`；生产启动时区服缺失
  直接失败，运行期查询失败保留上一个快照并记录错误。
- 内部状态端点和 Prometheus 指标带 `realm` 标签；部署集成测试证明跨区服角色
  被拒绝、绑定区服使用自己的激活版本。
- `WorldRoomTuning.monsterSpawns` 支持测试注入刷怪列表（阶段 8 压测地图有 30 个
  刷点，PvP 隔离测试用空列表）。

### 2.2 Prometheus 指标与运行时采集

- `@web-legend/observability`：手写 Prometheus 文本渲染器（标签转义、直方图
  分桶、非法名称拒绝、单测覆盖）与运行时采集器（事件循环延迟、RSS、堆、
  CPU、GC 暂停、ELU）。不引入 `prom-client`。
- Game Server `/metrics/prometheus`：Room 数、玩家、tick p50/95/99、命令接受/
  拒绝与原因、聊天、战斗事件、击杀、资产命令/失败、**资产事务队列延迟
  p50/95/99**、掉落、经验/金币、传输、WebSocket 出站字节与 patch 字节、内容
  版本，运行时指标，全部带 `realm/room/map/instance` 标签。
- Control API `/metrics/prometheus`：HTTP 请求计数/延迟直方图/并发数、Outbox
  各状态、最老 pending 年龄、DB 探测延迟与结果、运行时指标。
- `infra/observability/prometheus.yml` 抓取 4 个目标；`alerts.yml` 覆盖进程
  不可用、DB 探测失败、tick p95/p99、事件循环延迟、Outbox 积压/失败、资产失败
  与 5xx 比例。edge 在内部端口暴露合成存活样本（`fallback_scrape_protocol`）。

### 2.3 生产镜像与安全边界

- 四个应用各有生产镜像（Node 运行镜像 / nginx 静态镜像），非 root 运行、
  健康检查；构建基础镜像可通过 `NODE_IMAGE` / `NGINX_IMAGE` 覆盖。
- nginx edge：HTTP→HTTPS、HSTS、CSP、X-Frame-Options、Referrer-Policy、
  Permissions-Policy、16KB body、连接数限制、认证限流；`/ws` 同时转发
  matchmaking HTTP 与 WebSocket；`/internal/*`、`/metrics*` 一律 404。
- 应用侧保留纵深防护：Zod、body limit、4KB WS frame、Origin 校验
  （`GAME_SERVER_ALLOWED_ORIGINS`，生产必填）、内部令牌、CSRF Origin。
- `TRUST_PROXY=true` 只在可信代理后启用，避免伪造 `X-Forwarded-For` 绕过限频。

### 2.4 发布与回滚

- `infra/scripts/deploy.sh`：拒绝 `latest`、校验必需变量、compose 配置校验、
  `up --wait`、容器内检查 `/metrics/prometheus` 与 edge `/healthz`、记录
  `current-tag` / `previous-tag`。
- `infra/scripts/rollback.sh`：切回上一个标签并重新健康检查；不执行数据库
  反向迁移。内容回滚仍走后台激活记录。
- 演练：同一批镜像以 `drill-a` / `drill-b` 两个不可变标签部署，回滚脚本切回
  `drill-a`，12 项检查全部通过，标签状态正确记录。

### 2.5 备份与恢复

- `db-backup.sh`：自定义格式 + manifest（迁移、表数、关键行数、资产不变量、
  激活内容 checksum）+ SHA-256；本机无客户端时回退到固定 PostgreSQL 镜像。
- `db-restore-drill.sh`：创建带时间戳的独立库、真实 `pg_restore`、按 manifest
  校验、成功后删除；拒绝 `NODE_ENV=production`。
- 修正：claim 过的掉落保留 `world_drops` 行（历史），不变量只约束“未领取的
  掉落必须在‘ground’”；`pg_restore` 从 stdin 读取归档。

### 2.6 故障演练

- `drill:recovery`：真实 PostgreSQL、真实票据与 Room；SIGTERM 优雅退出
  checkpoint 并立即释放租约，SIGKILL 只保留周期 checkpoint，租约到期后可重新
  入图；两种场景物品实例数量不变。
- 修复：Colyseus 默认的 SIGTERM 处理器会与自有 shutdown 竞争并提前
  `process.exit`，导致租约释放被数据库关闭打断；现在由 `index.ts` 独占信号，
  Room 释放租约后再关闭连接池。
- `drill:outbox`：不可达 Game Server → `pending` + 错误 + 未来重试时间；
  可达后 `applied`；相同 `commandId` 第二次投递返回 `duplicate` 且不重复执行。
- 新增集成测试：Control API 与 Game Server 在数据库 TCP 通路中断时
  `/health/ready` 返回 503、`/health/live` 仍为 200，恢复后 readiness 自动
  回到 200（`/health/ready` 探测有 2 秒超时，避免黑洞挂起）。

### 2.7 容量场景

- `scripts/worldScenario.ts`：30 名移动玩家 + 10 名攻击者持续 10 分钟；另以
  50 名玩家短时加入。通过 Vite `/ws` 代理连接（与生产同源拓扑），读取 JSON
  `/metrics` 与 Prometheus 文本；失败条件包括未全部加入、命令无接受、tick
  p95≥25ms / p99≥40ms、资产失败、无 patch 字节、攻击者无战斗事件。
- 地图 `starter_wilds` 增加到 30 个刷点（20–40 的目标区间），并调整两个狼刷点
  避开 PvP E2E 决斗区域。

## 3. 验收证据

| 证据                                              | 位置                                                             | 结果                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生产拓扑（HTTPS/WSS/头/代理/404/登录/Prometheus） | `docs/phase-reports/phase-08/deployment-check.txt`               | 12/12 通过                                                                                                                                                                                            |
| 回滚演练                                          | `docs/phase-reports/phase-08/rollback-drill.txt`                 | drill-b → drill-a，健康检查通过                                                                                                                                                                       |
| 恢复演练                                          | `docs/phase-reports/phase-08/restore-drill.txt`                  | 行数与不变量一致，演练库已删除                                                                                                                                                                        |
| 备份                                              | `docs/phase-reports/phase-08/backup.txt`                         | dump + manifest + SHA-256                                                                                                                                                                             |
| Game Server 重启                                  | `docs/phase-reports/phase-08/recovery-drill.json`                | SIGTERM 租约 1ms 释放；SIGKILL 周期 checkpoint 生效                                                                                                                                                   |
| 容量场景 A                                        | `docs/phase-reports/phase-08/load-2026-11-25T13-11-17-659Z.json` | 30/30 加入；36000 接受 / 11069 拒绝；tick p50 1.12ms、p95 4.3ms、p99 5.84ms、max 7.17ms；资产队列 p95 33.3ms；324 击杀、0 资产失败；WS 198.7MB / patch 92.7MB；事件循环 p99 max 21.5ms、RSS max 249MB |
| 容量场景 B                                        | `docs/phase-reports/phase-08/load-2026-11-25T13-21-33-673Z.json` | 50/50 加入；15000 接受 / 0 拒绝；tick p50 1.44ms、p95 6.05ms、p99 7.83ms、max 8.54ms；0 击杀（仅移动）、0 资产失败；WS 122.8MB / patch 60.3MB                                                         |
| 指标快照                                          | `docs/phase-reports/phase-08/metrics.json`                       | 见文件                                                                                                                                                                                                |
| 数据库快照                                        | `docs/phase-reports/phase-08/database.txt`                       | 见文件                                                                                                                                                                                                |

## 4. 自动化门禁

| 检查        | 命令                         | 结果                                      |
| ----------- | ---------------------------- | ----------------------------------------- |
| 格式        | `pnpm format:check`          | 通过                                      |
| Lint / 边界 | `pnpm lint`                  | 通过（0 error / 0 warning）               |
| 类型        | `pnpm typecheck`             | 通过（根配置 + 15 个 workspace）          |
| 单元/集成   | `pnpm test`                  | 60 个文件，325 个测试全部通过（约 12.4s） |
| 浏览器      | `pnpm test:e2e`（2 workers） | 20/20 通过（1.8 分钟）                    |
| 构建        | `pnpm build`                 | 4 个应用全部成功                          |

## 5. 已知限制与风险

- 单 Realm、单 Game Server、单 nginx；多实例路由与独立 Outbox worker 不在
  MVP 范围。`GAME_SERVER_REALM` 让扩容时可以按区服拆进程，但没有进程注册与
  连接路由。
- 资产事务队列包含等待与提交，压测中的 p95 反映真实排队；不是纯 SQL 耗时。
- WebSocket 出站字节与 patch 字节按客户端统计；入站字节未计数（Colyseus 在交给
  Room 前已解码），因此带宽结论只覆盖下行。
- 负载场景的重连率没有单独统计；重连由集成测试（租约、宽限期）与 E2E
  （断线恢复）覆盖。DB 事务延迟通过资产队列指标与 Control API 探测延迟观测。
- 共享开发库仍有历史测试数据；恢复演练验证的是“备份可恢复”，不清理历史。
- 生产浏览器截图未采集：本环境的浏览器无法访问 docker compose 在宿主机发布
  的端口；HTTPS/WSS/页面/安全头由 compose 网络内的 Node 客户端验证。
- edge 的 `/metrics` 是合成存活样本，不包含 nginx 内部状态（需要额外 exporter）。
- 内容激活仍只影响新 Room；运营流程需等待新实例或按 runbook drain。

## 6. 结论

阶段 8 的自动化验收目标全部达成：可构建、可部署、可回滚、可观测、可备份恢复，
并在真实数据库与真实 Room 上完成了正常重启、崩溃、数据库不可用与 Outbox
重试演练。等待用户确认后标记阶段完成。
