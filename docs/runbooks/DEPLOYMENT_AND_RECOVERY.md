# 部署、回滚与恢复 Runbook

> 适用版本：阶段 8（ADR-023）。所有命令在仓库根目录执行，Node 26 + pnpm 11。
> 生产差异只在于环境变量、证书和镜像仓库，命令一致。

## 0. 拓扑与边界

```text
浏览器 ──HTTPS/WSS──> edge (nginx, 443/8444)
                       ├─ /            -> game-web (静态)
                       ├─ /ws          -> game-server  (HTTP matchmaking + WS)
                       ├─ /api/,/health-> control-api
                       └─ admin 8444   -> admin-web + control-api
                       /internal, /metrics 一律 404
control-api ──HTTP──> game-server /internal/admin/*
control-api / game-server ──SQL──> PostgreSQL（唯一事实来源）
Prometheus ──内网抓取──> control-api:3000 / game-server:2567 /metrics/prometheus
```

- 不要公开 PostgreSQL、3000/2567 端口、`/metrics*`、`/internal/*`。
- Game Server 进程绑定一个 Realm（`GAME_SERVER_REALM`，默认 `classic-01`），
  只接受该区服角色；生产启动时区服不存在会直接失败。
- 指标：`/metrics` 是阶段 3 的 JSON（负载脚本使用），
  `/metrics/prometheus` 是 Prometheus 文本，两者同一份内存注册表。

## 1. 发布前检查

1. `git status` 干净；目标提交已通过 `pnpm verify`（format/lint/typecheck/test/build）。
2. 数据库迁移已审阅：Expand → Migrate → Contract，不假设可逆。
3. 新镜像标签使用 `WEB_LEGEND_VERSION` 或 `git-<short-sha>`，禁止 `latest`。
4. 最近一次备份完成且恢复演练通过（第 5 节）。
5. 内容发布走后台；代码回滚不等于内容回滚（第 3 节）。

## 2. 部署

```bash
export IMAGE_TAG="git-$(git rev-parse --short HEAD)"
export IMAGE_PREFIX=web-legend
export POSTGRES_PASSWORD='<secret>'
export INTERNAL_ADMIN_TOKEN='<至少 32 字符随机值，不能使用开发默认值>'
export PUBLIC_ORIGINS='https://game.example.com,https://admin.example.com'
export TLS_CERT_DIR=/etc/web-legend/certs

# 首次或数据库有未应用迁移时（在维护窗口内执行）
DATABASE_URL='postgres://...' pnpm db:migrate

pnpm prod:deploy       # 记录 tag、拉起 compose、等待健康检查
```

`deploy.sh` 会：

1. 校验 `IMAGE_TAG`（拒绝 `latest`）与必需变量；
2. `docker compose config` 校验；
3. `up -d --wait`；
4. 在容器内请求 `/metrics/prometheus` 与 edge `/healthz`；
5. 把新 tag 写入 `infra/docker/data/current-tag`，上一个 tag 写入
   `previous-tag`。

本地/离线环境：镜像仓库不可用时，可用 `NODE_IMAGE`、`NGINX_IMAGE`、
`PROMETHEUS_IMAGE`、`POSTGRES_IMAGE` 指向可达镜像，并设置 `BUILD=1` 本地构建。

## 3. 回滚

### 3.1 代码回滚

```bash
export IMAGE_TAG=$(cat infra/docker/data/previous-tag)
pnpm prod:rollback
```

- 回滚只切换镜像标签，**不执行任何数据库反向迁移**。若上一个版本不能读取当前
  schema，先按 Expand 策略补兼容迁移，再回滚应用。
- 回滚后重复 `deploy.sh` 的 `/metrics/prometheus` 与 `/healthz` 检查。

### 3.2 内容回滚

在后台「发布中心」重新激活上一个 Release（追加一条激活记录）；不要修改或删除
已发布 Release。已存在的 Room 保持创建时快照，新 Room 使用回滚后的版本。

## 4. Room drain 与重启

单地图固定 Room 没有独立 drain API，按以下顺序操作，目标是不丢已提交资产、最多
丢失 20 秒未 checkpoint 的位置：

1. **停止接收新连接**：在 edge 临时把 `/ws` 返回 `503`（维护页），或把
   `PUBLIC_ORIGINS` 暂时收紧后重新加载；不要直接停 Game Server。
2. **等待宽限期**：至少等待 `reconnectGraceSeconds`（默认 15 秒）+ 一个
   checkpoint 周期（20 秒），让在线玩家的位置/HP 落库。
3. **优雅停止**：向 Game Server 发送 `SIGTERM`；进程会保存 checkpoint、注销
   Room 并关闭 WebSocket。不要用 `SIGKILL`，除非进程已经无响应。
4. **重启并验证**：新进程启动后确认 `/health/ready` 为 200、
   `/metrics/prometheus` 有 `web_legend_game_server_up{realm="..."} 1`。
5. **恢复入口**：撤销 edge 维护规则；玩家重新取票入图，客户端会重新读取角色
   地图/坐标。

崩溃（SIGKILL / 进程异常）时：玩家会保留角色租约直至过期（最多 30 秒），
期间重连会被拒绝；等待租约释放后重新入图，已提交的物品/金币/经验不受影响，
位置回退到最近一次 checkpoint。

演练脚本：`pnpm drill:recovery`（SIGTERM 与 SIGKILL 两种场景，写
`docs/phase-reports/phase-08/recovery-drill.json`）。

## 5. 备份与恢复

### 5.1 备份

```bash
DATABASE_URL='postgres://...' pnpm db:backup
# 产出 infra/docker/data/backups/web_legend-<UTC>.dump(.sha256) 与 manifest.json
```

- 使用自定义格式 + SHA-256；manifest 记录迁移版本、表数量、关键行数与资产
  不变量（钱包/流水一致、物品唯一归属、内容激活 checksum）。
- 备份文件必须复制到独立存储（对象存储/另一台机器）；容器卷不是备份。
- 建议频率：每天一次全量 + 发布前一次；保留至少 14 天。

### 5.2 恢复演练（必做）

```bash
DATABASE_URL='postgres://...' pnpm db:restore-drill \
  infra/docker/data/backups/web_legend-<UTC>.dump \
  infra/docker/data/backups/web_legend-<UTC>.manifest.json
```

- 脚本创建 `web_legend_drill_<时间戳>` 独立库，真实 `pg_restore`，再用 manifest
  校验；成功后删除演练库。
- 任何情况下不会覆盖主库；`NODE_ENV=production` 时拒绝执行。

### 5.3 生产恢复

1. 停止写入：drain Game Server（第 4 节），Control API 可继续读但不要执行管理
   写操作。
2. 新建数据库并恢复：`createdb web_legend_restore` → `pg_restore` → 校验
   manifest。
3. 切换 `DATABASE_URL` 指向恢复库，重新部署 Control API 与 Game Server。
4. 抽查：管理员登录、玩家登录、资产行数、`realm_active_content` checksum。
5. 保留旧库只读，确认无误后再下线。

## 6. 数据库不可用

- Control API `GET /health/ready` 返回 503（探测有 2 秒超时）；
  Game Server 同样返回 503，`/health/live` 仍为 200。
- 进程不会退出；数据库恢复后 readiness 自动回到 200，无需重启应用。
- 告警：`DatabaseProbeFailing`、`ControlApiDown`、`GameServerDown`。
- tick 循环不访问数据库；数据库故障期间移动/战斗继续，击杀奖励进入重试队列，
  恢复后提交，提交成功前不会向玩家确认奖励。

## 7. Outbox 与运营指令

- pending 最老年龄超过 60 秒告警（`OutboxOldestPendingStale`）；
  `failed` 表示 4xx 或重试耗尽（`OutboxCommandsFailed`）。
- 排查顺序：Game Server `/health/ready` → 内部令牌是否一致 →
  `outbox_events.last_error`。
- 重投由 dispatcher 自动完成（stale dispatched 60 秒后重投）；幂等由
  `commandId` 保证，重复投递不会重复执行。
- 演练：`pnpm drill:outbox`（不可达端点重试 → 可达后 applied → 重复
  commandId 返回 duplicate）。

## 8. 监控与告警

- Prometheus 抓取 `game-server:2567/metrics/prometheus`、
  `control-api:3000/metrics/prometheus`、`edge:8080/healthz`。
- 关键指标：
  - `web_legend_game_server_tick_duration_ms{quantile}`（p95 > 25ms / p99 > 40ms
    告警）；
  - `web_legend_game_server_asset_commands_total{result="failed"}`；
  - `web_legend_game_server_patch_bytes_total`、`ws_sent_bytes_total`（带宽）；
  - `nodejs_event_loop_lag_seconds`、`process_resident_memory_bytes`；
  - `web_legend_http_requests_total` / `..._duration_seconds`（Control API）；
  - `web_legend_outbox_commands`、`web_legend_db_probe_up`。
- 告警定义在 `infra/observability/alerts.yml`，抓取配置在
  `infra/observability/prometheus.yml`。

## 9. 证书

- 生产使用 CA 证书挂载到 `TLS_CERT_DIR/fullchain.pem` 与 `privkey.pem`。
- 演练可用 `pnpm cert:dev` 生成自签名证书（30 天，CN 由 `TLS_CN` 指定）。
- 轮换：替换文件后 `docker compose exec edge nginx -s reload`，不影响在线
  WebSocket。
