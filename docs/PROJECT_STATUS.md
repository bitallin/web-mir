# Web Legend 项目状态

> 更新日期：2026-11-24
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 0：工程底座与规则冻结 —— 已完成，等待 Tech Lead 审阅。**

阶段 1（浏览器双人联网垂直切片）尚未开始。按用户要求，阶段 0 报告提交后停止，
等待审阅通过再继续。

## 2. 阶段进度

| 阶段                           | 状态           | 说明                                         |
| ------------------------------ | -------------- | -------------------------------------------- |
| 阶段 0：工程底座               | 已完成，待审阅 | 工程、依赖、质量门禁、数据库、健康检查、文档 |
| 阶段 1：双浏览器联机切片       | 未开始         | 等待阶段 0 审阅通过                          |
| 阶段 2：账号与票据             | 未开始         | —                                            |
| 阶段 3：地图与服务端移动       | 未开始         | —                                            |
| 阶段 4：怪物与战斗             | 未开始         | —                                            |
| 阶段 5：掉落与资产持久化       | 未开始         | —                                            |
| 阶段 6：聊天、PK 与体验        | 未开始         | —                                            |
| 阶段 7：运营后台与内容发布     | 未开始         | —                                            |
| 阶段 8：质量、压测、部署与恢复 | 未开始         | —                                            |

## 3. 当前正在进行的任务

无。当前处于阶段 0 审阅门禁。

## 4. 已完成内容

### 工程与工具链

- pnpm workspace Monorepo，9 个 workspace 项目（4 个 app + 5 个 package）。
- Node.js 26.13.1 LTS，pnpm 11.7.0，TypeScript 5.9.3 strict。
- ESLint 10 + typescript-eslint 8 + Prettier，含依赖边界规则。
- Vitest 5 单元/集成测试；Playwright 1.65 浏览器测试。
- Vite 8 前端构建；tsup 9 后端构建；所有应用可生产构建。
- GitHub Actions CI：format、lint、typecheck、migration、test、build、E2E。

### 应用入口

- `game-web`：Phaser 4 启动场景、脚底锚点预留、窗口 resize 清理、React HUD、
  Control API 在线状态。
- `admin-web`：自定义暗色运营工作台外壳，Ant Design 6，真实健康检查和刷新。
- `control-api`：Fastify 5，Zod 环境变量校验，Pino 结构化日志，CORS，requestId，
  统一错误 envelope，`/health/live` 与 `/health/ready`（真实数据库探针），优雅退出。
- `game-server`：Colyseus 0.18 运行时，HTTP 健康检查，开发环境 diagnostics Room，
  真实 WebSocket 消息校验和重连验证。

### 数据与基础设施

- PostgreSQL 18.3（本地镜像，18.x）与 Docker Compose。
- Drizzle ORM 0.45 + drizzle-kit 0.31，首个迁移 `realms` 表。
- 使用 PostgreSQL 18 原生 `uuidv7()`。
- `.env.example`、环境变量 schema、日志脱敏、相对 `.env` 向上查找。

### 文档与治理

- `AGENTS.md`：架构边界、编码规范、测试、Git、多 Agent 协作和禁止事项。
- ADR-001 至 ADR-014，包括包实现策略和工具链锁定。
- README、PROJECT_STATUS、WORKLOG、阶段报告目录。

## 5. 尚未完成内容

- 所有游戏玩法：账号、角色、地图、移动、战斗、怪物、掉落、背包、装备、金币、
  聊天、PK、复活、后台业务与内容发布。
- 阶段 1 的双浏览器实时可见和移动。
- 生产部署、HTTPS/WSS、限频、监控指标、备份恢复和压测。
- Redis 协调、多 Game Server、Room drain。
- 官方 OpenAPI 文档和协议兼容测试。
- 独立测试数据库/测试 schema；当前集成测试使用开发库并自行清理。

## 6. 当前技术风险

| 风险                                   | 影响                                        | 缓解                                                                      |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Colyseus 0.18 API 仍较新               | 版本升级可能改变 Room/消息/重连行为         | 已用真实 WebSocket join/ping/reconnect 集成测试锁定当前行为；升级必须重跑 |
| Phaser 4 客户端包体积大                | game-web 生产 JS 约 1.89 MB（gzip 0.51 MB） | 阶段 8 前做路由/场景级代码拆分与资源按需加载；当前为可接受警告            |
| 本地 PostgreSQL 18.3，CI/生产目标 18.7 | 补丁版本差异可能影响边界行为                | 同属 18.x；CI 使用 18.7；升级本地镜像后重跑迁移与全量测试                 |
| 当前开发主机 Docker 在 SSH 容器外      | 端口与数据库地址非标准，易误连              | README/AGENTS/PROJECT_STATUS 明确端口和网关；错误信息写入故障排查         |
| 容器 inotify 限额 8192                 | 文件 watcher 触发 ENOSPC                    | 默认后端无 watch、Vite 轮询；提供 `dev:watch` 供限额充足环境使用          |
| Playwright 浏览器无法在当前系统下载    | E2E 依赖预装 Chromium                       | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`；普通环境使用官方安装        |
| 集成测试使用共享开发库                 | 并行测试或残留数据风险                      | 测试插入唯一 code 并清理；阶段 5 前建立独立测试库/临时 schema             |
| Redis 8.2 本地镜像不可用               | scale profile 暂不可启动                    | MVP 不依赖 Redis；扩容阶段再解决镜像来源，禁止降级冒充                    |

## 7. 已知问题

- `pnpm dev` 默认不热重载后端（受 watcher 限额影响）；修改后端需重启开发栈。
- 开发端口为 84/85/86/87，而非架构示例中的 5173/5174/3000/2567；这是当前宿主机
  映射和 nginx 占用导致的本地调整，不改变架构。
- `game-server` 在生产环境不注册 diagnostics Room；阶段 1 会加入正式世界 Room。
- 管理后台当前只有真实健康状态和阶段交付说明，没有玩家/内容数据页面（阶段 7）。
- 游戏客户端当前只有技术启动场景，没有地图、角色或游戏资源（阶段 1 起）。
- `pnpm test:e2e` 在开发栈已运行时需加 `PLAYWRIGHT_SKIP_WEBSERVER=true`；普通环境
  会自动启动两个 Vite 服务。
- `apps/*` 和 `packages/*` 版本统一为 `0.1.0`，尚未建立自动发布/镜像版本流程。

## 8. 阻塞事项

无硬阻塞。阶段 1 开始前需要用户审阅阶段 0 报告并明确批准。

## 9. 最近一次测试结果

日期：2026-11-24

| 检查        | 命令                                           | 结果                                     |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| 格式        | `pnpm format:check`                            | 通过                                     |
| Lint / 边界 | `pnpm lint`                                    | 通过                                     |
| 类型        | `pnpm typecheck`                               | 通过                                     |
| 单元/集成   | `pnpm test`                                    | 10 个文件，38 个测试全部通过（约 0.95s） |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e` | 2 个测试全部通过（约 2.8s）              |
| 构建        | `pnpm build`                                   | 4 个应用全部成功                         |
| 迁移        | `pnpm db:migrate`                              | 空库执行成功，`realms` 表创建            |

集成证据包括：真实 PostgreSQL 迁移与唯一约束、Fastify readiness 真实数据库探针、
Colyseus 真实 WebSocket join / Zod 消息校验 / 未授权断线重连。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 主题：`chore(phase-0): establish engineering foundation`
- 后续仅允许文档补记提交；代码变更需等待阶段 1 批准。

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0。
- PostgreSQL 18.3，镜像
  `docker.m.daocloud.io/postgres@sha256:a9abf4275f9e99bff8e6aed712b3b7dfec9cac1341bba01c1ffdfce9ff9fc34a`。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目使用 84–87。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131。

## 12. 下一步

等待阶段 0 审阅。批准后按 `docs/phase-reports/PHASE_00_REPORT.md` 第 11 节的阶段 1
任务清单执行；阶段 1 验收通过前不得进入阶段 2。
