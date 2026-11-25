# ADR-023: 阶段 8 生产部署、可观测性与恢复演练

- 状态：Accepted
- 日期：2026-11-25
- 关联：架构文档 4.3、8.7、15、16；MVP 计划阶段 8；ADR-005、ADR-006、
  ADR-008、ADR-022

## 背景

阶段 0–7 已交付可玩的实时世界、持久资产、PvP、运营后台与内容发布；开发栈通过
`pnpm dev` 运行，指标只有 Game Server 的 JSON 快照，没有可部署镜像、TLS/WSS
入口、告警、容量证据或恢复演练。阶段 7 还遗留一个明确的架构缺口：内容发布
已按区服记录，但 Game Server 只读取“第一个活跃区服”的内容，Room 没有显式
归属某个 Realm。

阶段 8 的目标不是增加玩法，而是证明系统**可部署、可观测、可恢复**，并且
不引入新的领域服务或提前扩容组件。

## 决策

### 1. Room 显式归属 Realm，内容按 Realm 解析

- Game Server 进程通过 `GAME_SERVER_REALM`（区服 code，默认 `classic-01`）
  绑定一个 Realm；同一进程只服务该 Realm。
- `WorldMapRoom` 在 `onAuth` 中校验角色所属 Realm 的 code 与进程绑定值一致，
  不一致直接拒绝；不再使用“第一个活跃区服”的隐式选择。
- `ContentStore` 按 Realm code 查找 Realm id，再用
  `realm_active_content` 读取该 Realm 当前激活的 Release；找不到时保留
  baseline 快照并记录错误。生产模式下启动时 Realm 必须存在，否则启动失败。
- 内部状态端点和 Prometheus 指标暴露 `realm` 标签，后台可以确认 Room 归属。
- 多 Game Server、多 Realm 路由仍不在 MVP 范围；需要时按架构文档 6.4 增加
  进程注册与连接路由，而不是让单个进程服务多个 Realm。

### 2. 指标采用 Prometheus 文本协议，保留 JSON 供负载脚本使用

- 新增 `/metrics/prometheus`（`text/plain; version=0.0.4`）：
  - `game-server`：Room 数、玩家数、tick p50/p95/p99、命令/拒绝、资产失败、
    聊天过滤、WebSocket 出站字节与 patch 字节、内容版本、运行时内存/CPU/
    事件循环延迟/GC 暂停。
  - `control-api`：HTTP 请求计数与延迟直方图、进行中请求、Outbox
    pending/dispatched/failed、最老 pending 年龄、数据库探测延迟、运行时指标。
- 保留现有 `/metrics` JSON，避免破坏阶段 3 的负载脚本与已提交证据；两者读取
  同一份内存注册表。
- 不引入 `prom-client`：指标数量可控，文本渲染只依赖 Node 内置模块，避免为
  “看起来标准”增加依赖和版本核对成本。渲染器有单元测试（标签转义、直方图
  分桶、非法名称拒绝）。
- 事件循环延迟、RSS、堆、CPU、GC 暂停由 `@web-legend/observability` 的运行时
  采集器提供；采集器可在测试中启动/停止，不依赖全局单例。
- WebSocket 出站字节在 `Client.raw`/`enqueueRaw` 上按客户端计数；patch 字节
  通过包装 Room 的 `broadcastPatch` 标记时间窗口区分。入站字节暂不计数，
  因为 Colyseus 在交给 Room 前已完成解码；文档明确该限制。

### 3. TLS/WSS 与安全边界放在反向代理，应用保留纵深防护

- 生产拓扑：单个 nginx 反向代理终止 TLS，静态托管 `game-web` 与
  `admin-web`，把 `/api` 转发到 Control API，把 `/ws` 转发到 Game Server。
- nginx 负责：
  - HTTPS + WSS、HSTS、CSP、`X-Content-Type-Options`、`X-Frame-Options`、
    `Referrer-Policy`；
  - `client_max_body_size 16k`，请求限速（认证/后台登录/通用 API 分级）；
  - 拒绝公开访问 `/internal/*`、`/metrics*`；
  - WebSocket Upgrade 头与长连接超时。
- 应用保留：Zod 校验、16 KB body limit、4 KB WS frame limit、认证/后台登录
  限频、CORS/Origin 校验、内部端点共享令牌、WS Origin allowlist
  （`GAME_SERVER_ALLOWED_ORIGINS`，生产必填）。
- 反向代理只在生产 compose 中运行；开发环境继续使用 Vite 代理，不改变
  `pnpm dev` 的端口约定。

### 4. 发布使用不可变镜像标签，代码与内容回滚分离

- 四个应用各有生产镜像：`game-web`、`admin-web` 为静态构建 + nginx，
  `control-api`、`game-server` 为 Node 运行镜像。镜像标签使用
  `WEB_LEGEND_VERSION` + Git commit，禁止 `latest`。
- `infra/scripts/deploy.sh` 记录当前标签、拉起 compose、执行健康检查；
  `infra/scripts/rollback.sh` 把 `IMAGE_TAG` 切回上一个成功标签并重新健康
  检查。回滚不执行任何数据库反向迁移；迁移遵循 Expand → Migrate → Contract。
- 内容回滚继续使用阶段 7 的“追加激活记录”，与代码回滚互不影响。
- PostgreSQL 是唯一事实来源；容器不保存业务状态，数据卷与备份独立管理。

### 5. 备份与恢复以脚本和演练为准，不以“配置存在”为准

- `infra/scripts/db-backup.sh` 生成带时间戳的自定义格式备份，并计算
  SHA-256；优先使用本机 `pg_dump`，不可用时通过 PostgreSQL 容器执行，
  避免依赖开发机安装客户端。
- `infra/scripts/db-restore-drill.sh` 在独立数据库名中真实恢复备份，运行
  `infra/scripts/verifyRestore.ts` 比较迁移、表、关键行数与资产不变量
  （钱包/流水、物品唯一归属、内容激活 checksum），成功后删除演练库。
- 演练库名称带时间戳，绝不覆盖开发库或生产库；脚本拒绝在
  `NODE_ENV=production` 下运行。

### 6. 故障演练是可重复脚本，不是一次性手工操作

- `apps/game-server/scripts/recoveryDrill.ts`：使用真实 PostgreSQL、真实
  ticket 与 Room，分别在正常 SIGTERM 与 SIGKILL 后重启，验证已 checkpoint
  的位置/HP 可恢复、租约可重新获取、已提交资产不丢失。
- `infra/scripts/outbox-drill.ts`：使用不可达 Game Server 验证 Outbox 重试与
  退避，再启动可达端点验证 `applied`，重复 commandId 不重复执行。
- 数据库不可用：集成测试启动指向不可达端口的 Game Server/Control API，
  验证 `/health/ready` 返回 503 且进程不崩溃；恢复后 readiness 重新通过。
- Room drain 写入 runbook：停止接收新连接、广播维护通知、等待宽限期、
  graceful shutdown、重启后玩家重新取票入图。
- 演练脚本输出 JSON/文本证据到 `docs/phase-reports/phase-08/`；不把“演练脚本
  存在”当作通过，必须记录实际执行结果。

### 7. 压测目标按固定机器规格记录

- 场景 A：30 名玩家持续移动 + 10 名玩家周期性攻击，野外 20–40 只怪物，
  持续 10 分钟。
- 场景 B：50 名玩家短时（≥2 分钟）加入并持续移动，验证 `maxClients=50` 与
  tick 门禁。
- 记录 tick p50/p95/p99、事件循环延迟、RSS、CPU、WS 出站字节、patch 字节、
  命令接受/拒绝、资产失败、DB 探测延迟；写入阶段报告。
- 不把“连接成功”当容量通过：客户端必须持续移动/攻击，服务端必须有接受
  命令与状态广播。软件渲染的浏览器 E2E 不用于容量结论。

### 8. 不引入 Redis、Kafka、Kubernetes 或独立 Outbox worker

- 单 Game Server + 单 PostgreSQL + 单 nginx + Prometheus 即满足 MVP 容量与
  可观测性；Outbox dispatcher 仍与 Control API 同进程，但指标暴露积压。
- 达到真实瓶颈后再按架构文档 15.3 引入 Redis Presence、多 Game Server、
  独立 worker。阶段 8 只增加运维组件（反向代理、Prometheus），不改变
  领域部署单元。

## 替代方案

- **每个服务自己终止 TLS**：拒绝。证书、限速、静态资源与安全头会分散到四个
  进程，无法统一演练和回滚。
- **使用 `prom-client` 和默认指标**：拒绝。当前指标集小且需要按 Room/Realm
  打标签；手写渲染器可测试、无新增依赖。
- **继续让 Game Server 取第一个活跃区服内容**：拒绝。多 Realm 激活会静默
  串内容，违背服务端权威与内容版本可追踪原则。
- **用 `pg_dump` 配置代替恢复演练**：拒绝。阶段门禁要求至少完成一次实际恢复。
- **把压测客户端直接连 87 端口**：拒绝。Node fetch/SDK 拒绝 WHATWG bad port；
  继续通过同源 `/ws` 代理，和生产拓扑一致。

## 影响

- 生产部署需要证书、镜像仓库与 Prometheus；开发环境不受影响。
- Game Server 启动依赖绑定 Realm 存在；启动失败是显式错误，而不是静默使用
  其他区服内容。
- 指标端点包含内部运行信息，生产必须只允许内网/Prometheus 访问。
- 阶段 7 的“单活跃区服”限制被移除，但 MVP 仍是单 Realm 单实例。
- 备份/恢复脚本需要 Docker 或 PostgreSQL 客户端；演练脚本拒绝生产环境。
