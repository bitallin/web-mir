# Web Legend

浏览器即开即玩、服务端权威、持久化、可持续更新内容的传奇类 2D 多人在线
MMORPG。仓库采用 pnpm Monorepo，包含 Phaser 游戏客户端、React 运营后台、
Fastify Control API 和 Colyseus 实时服务器。

## 当前状态

**阶段 4：怪物、战斗和技能，实现与自动化验收完成，等待用户在 8584 实测确认。**

- 阶段 0–3 的工程底座、双人实时切片、账号票据、Tiled 地图/AOI/传送/聊天均已
  通过用户验收。
- 阶段 4 交付：`game-domain` 战斗纯函数与 `CombatWorld`、两种怪物与六处刷点、
  怪物 FSM/追击/攻击/死亡/重生、三职业技能、服务端 RNG、CombatEvent、
  目标选择/伤害数字/战斗日志、玩家死亡复活与双浏览器战斗测试。
- 尚未实现：经验与等级成长、掉落、背包、装备、金币、PK、安全区、运营后台和
  内容发布（阶段 5–7）。
- 详细状态见 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，工作记录见
  [docs/WORKLOG.md](docs/WORKLOG.md)，阶段 4 报告见
  [docs/phase-reports/PHASE_04_REPORT.md](docs/phase-reports/PHASE_04_REPORT.md)。

## 阶段 4：如何体验

1. 按“从零启动”启动 PostgreSQL、执行迁移与 `pnpm db:seed`，再运行 `pnpm dev`。
   阶段 2 的旧角色可用 `pnpm repair:maps` 迁移到主城出生点。
2. 打开两个独立浏览器窗口（或一个普通窗口 + 一个无痕窗口）访问
   <http://localhost:8584/>。
3. 每个窗口注册独立账号，选择职业并创建角色，点击“进入世界”。
4. 两个角色在主城互相可见；点击地面移动，走到东侧传送门进入静语荒野。
5. 在野外点击史莱姆或森林狼：目标面板显示等级/HP，点击会提交普攻；按 `1`
   或点击技能栏施放本职业技能。伤害、暴击、冷却和法力都由服务端裁定。
6. 两名玩家同时攻击同一怪物时，两端看到同一个权威 HP；怪物死亡后约 8 秒在
   原刷点满 HP 重生。
7. 在左下角地图频道聊天；刷新页面后在宽限期内恢复原座位；同一角色不能在两个
   窗口同时进入世界。
8. 战斗 HUD 显示目标、附近怪物、技能冷却和战斗记录；角色倒下后 3 秒在原地图
   出生点满状态复活（阶段 4 的 MVP 策略）。

账号身份只来自服务端签发的会话 Cookie 与一次性票据（ADR-017），地图归属只由
服务端持久档案决定（ADR-018）。开发环境保留 `?fresh=1`（新建房间）与
`?join=<roomId>`（加入指定房间）用于测试隔离，生产构建忽略。

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

4. 在空数据库上执行迁移并写入默认区服：

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
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
| `pnpm db:seed`           | 幂等写入默认区服 `classic-01`            |
| `pnpm maps:compile`      | Tiled 源图编译为运行时 manifest          |
| `pnpm repair:maps`       | 幂等迁移退役地图上的角色                 |
| `pnpm load:world`        | 30 人地图负载检查并读取 tick 指标        |

E2E 会执行迁移与区服 seed，并启动 game-web、admin-web、control-api 和
game-server 四个开发服务；如果开发栈已运行，可复用现有服务：

```bash
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
```

E2E 使用真实账号、角色与票据，通过开发专用参数为每个场景创建独立 Room；证据
（认证页、角色页、双人截图、传送与聊天截图、WebSocket 帧日志、可见延迟）写入
`docs/phase-reports/phase-03/`。若默认端口被其他开发栈占用，可在运行时覆盖端口：

```bash
GAME_WEB_PORT=8844 ADMIN_WEB_PORT=8845 CONTROL_API_PORT=8846 GAME_SERVER_PORT=8847 pnpm test:e2e
```

## 目录结构

```text
apps/
  game-web/       Phaser 4 世界 + React HUD
  admin-web/      React + Ant Design 运营控制台
  control-api/    Fastify REST、健康检查、未来 Outbox
  game-server/    Colyseus 运行时与实时适配
packages/
  contracts/      协议、账号/角色 DTO、world-state schema、健康检查、错误 envelope
  auth/           Argon2id 密码、会话令牌、一次性票据令牌
  game-domain/    战斗纯函数、技能/怪物目录、无 IO 的 CombatWorld
  game-simulation/ 固定 tick、路径搜索、移动推进、AOI（纯逻辑）
  map-runtime/    Tiled 编译、checksum、导航格与传送门运行时
  config/         Zod 环境变量与 .env 加载
  observability/  Pino 日志与脱敏
  persistence/    Drizzle schema、账号/角色/票据仓储、迁移
  testkit/        可控 RNG、手动时钟
content/
  maps/           Tiled 源图与编译产物
  assets/         资源 manifest 与生成的占位 tileset/角色贴图
docs/
  ADR/            架构决策记录
  phase-reports/  阶段报告与证据截图
  PROJECT_STATUS.md
  WORKLOG.md
infra/docker/     PostgreSQL，Redis 为 scale profile
tests/e2e/        Playwright
```

`game-simulation` 在阶段 1 创建，`auth` 在阶段 2 创建，`map-runtime` 在阶段 3
创建，`game-domain` 在阶段 4 创建。未创建的包（`game-application`、
`content-schema`）在出现真实消费者时创建，原因见
[ADR-013](docs/ADR/ADR-013-package-realization.md)。地图与 AOI 决策见
[ADR-018](docs/ADR/ADR-018-phase3-map-runtime-aoi-transfer.md)，战斗边界见
[ADR-019](docs/ADR/ADR-019-phase4-combat-domain.md)。

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
- [PHASE_01_REPORT.md](docs/phase-reports/PHASE_01_REPORT.md)：阶段 1 验收报告
- [PHASE_02_REPORT.md](docs/phase-reports/PHASE_02_REPORT.md)：阶段 2 验收报告
