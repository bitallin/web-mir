# Web Legend

浏览器即开即玩、服务端权威、持久化、可持续更新内容的传奇类 2D 多人在线
MMORPG。仓库采用 pnpm Monorepo，包含 Phaser 游戏客户端、React 运营后台、
Fastify Control API 和 Colyseus 实时服务器。

## 当前状态

**阶段 1：浏览器双人联网垂直切片，已完成，等待 Tech Lead 审阅。**

- 阶段 0 的工程底座已通过审阅并保留。
- 阶段 1 交付：一张服务端权威的测试地图、`world_map` Room、20Hz 固定模拟、
  10Hz 状态同步、意图式 `move.to`、服务端寻路与边界校验、双浏览器互相可见、
  断线重连、Phaser 伪等距世界与 React HUD。
- 尚未实现：正式账号与 game ticket（阶段 2）、Tiled 正式地图（阶段 3）、怪物、
  战斗、掉落、背包、金币、聊天、PK 和运营后台业务。
- 详细状态见 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，工作记录见
  [docs/WORKLOG.md](docs/WORKLOG.md)，阶段 1 验收报告见
  [docs/phase-reports/PHASE_01_REPORT.md](docs/phase-reports/PHASE_01_REPORT.md)。

## 阶段 1：如何体验双人联机

1. 按“从零启动”启动 `pnpm dev`。
2. 打开两个独立浏览器窗口（或一个普通窗口 + 一个无痕窗口）访问
   <http://localhost:8584/>。
3. 两个窗口会使用各自的开发身份进入同一个 `world_map` 房间，右侧列表显示彼此。
4. 点击地面移动；服务端寻路并推进，另一端在约 100–150ms 内看到移动。
5. 刷新任一窗口会优先使用 sessionStorage 中的重连 token 恢复原座位；网络断开会
   显示“重连中”，恢复后自动继续。

开发身份只存在于 `NODE_ENV=development|test`；生产服务器拒绝无票据的连接
（ADR-015）。开发环境可用 `?name=Alice&key=<8-64位>` 固定身份，`?fresh=1`
新建房间，`?join=<roomId>` 加入指定房间；这些参数在生产构建中被忽略。

## 技术架构

- 客户端：Phaser 4 + React 19 + Vite
- 实时服务器：Colyseus 0.18
- HTTP API：Fastify 5
- 数据库：PostgreSQL 18 + Drizzle ORM
- 校验：Zod 4
- 日志：Pino
- 测试：Vitest + Playwright
- 运行时：Node.js 26 LTS + pnpm 11

架构基线：
[docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md](docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md)
实施计划：
[docs/WEB_LEGEND_MVP_PLAN_v2.md](docs/WEB_LEGEND_MVP_PLAN_v2.md)
开发规范：[AGENTS.md](AGENTS.md)

## 环境要求

- Node.js 26 LTS（本仓库固定 `26.13.1`，见 `.nvmrc`）
- pnpm 11.7.0（`packageManager` 已锁定）
- Docker 与 Docker Compose
- 桌面版 Chrome / Edge（后续 E2E 与游戏验收）

安装 Node 26（使用 nvm）：

```bash
nvm install 26.13.1
```

```bash
nvm use
```

启用 pnpm（如果本机没有）：

```bash
corepack enable
```

## 从零启动

1. 创建本地环境文件：

```bash
cp .env.example .env
```

2. 安装依赖：

```bash
pnpm install
```

3. 启动 PostgreSQL：

```bash
pnpm db:up
```

4. 在空数据库上执行迁移：

```bash
pnpm db:migrate
```

5. 启动全部应用：

```bash
pnpm dev
```

默认端口来自 `.env`。本仓库示例环境使用：

| 服务        | 容器内端口 | 宿主机映射 |
| ----------- | ---------- | ---------- |
| game-web    | 84         | 8584       |
| admin-web   | 85         | 8585       |
| control-api | 86         | 8586       |
| game-server | 87         | 8587       |
| PostgreSQL  | 5432       | 未对外映射 |

访问：

- 游戏客户端：<http://localhost:8584/>
- 运营后台：<http://localhost:8585/>
- Control API 健康：<http://localhost:8586/health/ready>
- Game Server 健康：<http://localhost:8587/health/ready>

如果使用普通开发机（不使用容器映射），把 `.env` 中端口改回
`5173/5174/3000/2567`，并把 `DATABASE_URL` 中的主机改为 `127.0.0.1`。

## 本开发主机的重要约束

当前 SSH 环境本身是一个 Docker 容器，Docker daemon 在容器之外（DooD）：

- 宿主机只映射 `8580-8589 → 80-89`。容器内 80 已被环境自带 nginx 占用，因此
  项目使用 84–87。
- 本项目 PostgreSQL 容器发布在宿主机上。SSH 容器内不能通过 `127.0.0.1:5432`
  访问它，必须使用容器网关 `192.51.0.1:5432`（`.env.example` 已按此配置）。
  容器内 `127.0.0.1:5432` 是环境中另一个 PostgreSQL，连接会报
  `role "web_legend" does not exist`。
- PostgreSQL 的 5432 端口发布在宿主机所有接口上，SSH 容器才能经网关访问。这是
  开发环境配置；共享主机必须用防火墙限制外部访问，生产环境使用私有网络。
- `fs.inotify.max_user_watches` 仅为 8192。默认 `pnpm dev` 不启用后端 watch，
  Vite 使用轮询。需要后端热重载时运行 `pnpm --filter ... dev:watch`，但需先确认
  watcher 限额。
- Playwright 官方浏览器不支持在当前系统下载。使用预装 Chromium，并在 `.env`
  设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。普通开发机删除该变量并执行：

```bash
pnpm exec playwright install chromium
```

## 常用命令

| 命令                     | 作用                                     |
| ------------------------ | ---------------------------------------- |
| `pnpm dev`               | 并行启动四个应用                         |
| `pnpm build`             | 构建全部应用                             |
| `pnpm lint`              | ESLint（含依赖边界规则）                 |
| `pnpm typecheck`         | 根配置与全部 workspace 类型检查          |
| `pnpm test`              | Vitest 单元与集成测试                    |
| `pnpm test:e2e`          | Playwright 浏览器测试                    |
| `pnpm format`            | Prettier 格式化                          |
| `pnpm format:check`      | 校验格式                                 |
| `pnpm verify`            | format + lint + typecheck + test + build |
| `pnpm db:up` / `db:down` | 启动 / 停止 PostgreSQL                   |
| `pnpm db:generate`       | 根据 Drizzle schema 生成迁移             |
| `pnpm db:migrate`        | 对 `DATABASE_URL` 执行迁移               |

E2E 会启动 game-web、admin-web 和 game-server 三个开发服务；如果开发栈已运行，
可复用现有服务：

```bash
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
```

E2E 使用开发专用参数为每个场景创建独立 Room，证据（双人截图、WebSocket 帧日志、
可见延迟）写入 `docs/phase-reports/phase-01/`。

## 目录结构

```text
apps/
  game-web/       Phaser 4 世界 + React HUD
  admin-web/      React + Ant Design 运营控制台
  control-api/    Fastify REST、健康检查、未来 Outbox
  game-server/    Colyseus 运行时与实时适配
packages/
  contracts/      协议、实时消息、world-state schema、健康检查、错误 envelope
  game-simulation/ 固定 tick、路径搜索、移动推进（纯逻辑）
  config/         Zod 环境变量与 .env 加载
  observability/  Pino 日志与脱敏
  persistence/    Drizzle schema、客户端、迁移
  testkit/        可控 RNG、手动时钟
docs/
  ADR/            架构决策记录
  phase-reports/  阶段报告与证据截图
  PROJECT_STATUS.md
  WORKLOG.md
infra/docker/     PostgreSQL，Redis 为 scale profile
tests/e2e/        Playwright
```

`game-simulation` 在阶段 1 创建。未创建的包（`game-domain`、`game-application`、
`auth`、`map-runtime`、`content-schema`）在出现真实消费者时创建，原因见
[ADR-013](docs/ADR/ADR-013-package-realization.md)。

浏览器通过同源 `/ws` 访问实时服务器：开发环境由 Vite 代理到 `GAME_SERVER_PORT`，
`/matchmake` HTTP 和 WebSocket upgrade 共用该路径；生产部署需要在反向代理配置
同样的路由，或通过 `VITE_GAME_SERVER_URL` 指向独立地址。

## 健康检查与错误格式

所有服务返回结构化日志和统一健康响应：

```text
GET /health/live
GET /health/ready
```

Control API 的统一错误 envelope：

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found",
    "requestId": "uuid"
  }
}
```

## 测试与质量门禁

```bash
pnpm verify
```

```bash
pnpm test:e2e
```

验收规则：

- 单元测试覆盖纯逻辑与校验；
- 集成测试连接真实 PostgreSQL 和真实 Colyseus WebSocket；
- 浏览器测试使用真实 Chromium；
- 不使用 mock 数据库或硬编码成功响应冒充验收；
- 每个阶段必须提供真实命令和结果，见 `docs/phase-reports/`。

## 故障排查

| 现象                                                       | 原因 / 处理                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ENOSPC: System limit for number of file watchers reached` | 容器 inotify 限额低；使用默认无 watch 的 `pnpm dev`，或提高限额后使用 `dev:watch` |
| `role "web_legend" does not exist`                         | 连到了容器内的另一个 PostgreSQL；把 `DATABASE_URL` 主机改为 `192.51.0.1`          |
| `Port 84 is already in use`                                | 已有开发栈或其他服务占用；停止旧进程或修改 `.env` 端口                            |
| `Playwright does not support chromium on ubuntu20.04-x64`  | 设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 使用预装浏览器                              |
| `docker pull postgres:18.7-alpine` 连接失败                | 当前网络无法访问 Docker Hub；使用 compose 中已锁定的本地镜像摘要                  |
| Redis 镜像拉取失败                                         | Redis 属于扩容阶段，阶段 0 不启动；不要用错误版本替代 8.2                         |

## 文档

- [AGENTS.md](AGENTS.md)：开发规范、模块边界、协作规则和禁止事项
- [PROJECT_STATUS.md](docs/PROJECT_STATUS.md)：当前阶段、风险、阻塞和最近结果
- [WORKLOG.md](docs/WORKLOG.md)：追加式研发日志
- [ADR](docs/ADR/README.md)：架构决策记录
- [PHASE_00_REPORT.md](docs/phase-reports/PHASE_00_REPORT.md)：阶段 0 验收报告
