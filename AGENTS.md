# Web Legend 开发规范

> 本文件对所有 Agent 和开发者生效。开始任何任务前必须先阅读本文件，再阅读
> `docs/PROJECT_STATUS.md`、`docs/WORKLOG.md` 最近记录和当前 Git 状态。
>
> 架构基线：`docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md`
> 实施基线：`docs/WEB_LEGEND_MVP_PLAN_v2.md`

## 1. 项目目标

Web Legend 是浏览器即开即玩、服务端权威、数据持久化、可持续更新内容的传奇类
2D 多人在线 MMORPG。

目标不是做单机演示，也不是先搭庞大中台。每个阶段必须交付真实可玩、可测试、
可复现的纵向切片；没有通过阶段验收不得进入下一阶段。

## 2. 不可违反的原则

1. **服务端权威**：伤害、命中、暴击、掉落、金币、经验、装备属性和角色最终位置
   只能由服务端决定。客户端只提交意图。
2. **tick 与 IO 分离**：20Hz 模拟循环内禁止 `await` 数据库、HTTP、文件系统、
   Redis 或模型 API。持久资产操作走异步 Application Service。
3. **PostgreSQL 是唯一持久事实来源**：Redis 只用于协调与缓存，不能存唯一资产。
4. **资产事务化 + 幂等**：物品、金币、经验、装备变更必须在同一事务内完成；命令
   必须带幂等键；事务提交成功后才能向玩家确认奖励。
5. **内容与代码分离**：数值、掉落、地图等通过版本化内容发布；后台不能执行任意
   JavaScript、`eval`、动态 import 或任意 SQL。新增行为必须走代码发布。
6. **Room 只做适配**：连接、鉴权、限频、路由、状态同步和生命周期。战斗公式、
   掉落算法、背包规则、SQL 和 HTTP 路由不得写入 Room。
7. **模块化单体优先**：不提前引入微服务、Kafka、Kubernetes、Service Mesh。
8. **先定义契约再并行开发**：contracts / schema / migration 先定，再写实现。
9. **不用假实现通过验收**：禁止 Mock 业务结果、硬编码成功响应、空壳页面和
   TODO 冒充完成。测试可以用测试替身隔离，但验收必须走真实链路。
10. **不默默改架构**：任何重要架构变化先写 ADR，再更新文档和代码。

## 3. 技术基线

| 领域          | 当前选择                              | 版本                            |
| ------------- | ------------------------------------- | ------------------------------- |
| 运行时        | Node.js LTS                           | 26.13.1（`engines >=26 <27`）   |
| 包管理        | pnpm workspace                        | 11.7.0（`packageManager` 锁定） |
| 语言          | TypeScript strict                     | 5.9.3                           |
| 游戏渲染      | Phaser                                | 4.2.1                           |
| 客户端 UI     | React                                 | 19.3.1                          |
| 构建          | Vite                                  | 8.3.8                           |
| 实时服务器    | Colyseus core / schema / ws-transport | 0.18.28 / 5.0.50 / 0.18.5       |
| HTTP API      | Fastify                               | 5.12.8                          |
| 数据库        | PostgreSQL                            | 18.x（本地镜像 18.3）           |
| ORM           | Drizzle ORM / Kit                     | 0.45.4 / 0.31.11                |
| 校验          | Zod                                   | 4.6.7                           |
| 日志          | Pino                                  | 10.4.0                          |
| 后台 UI       | Ant Design                            | 6.7.2                           |
| 测试          | Vitest / Playwright                   | 5.1.1 / 1.65.1                  |
| Lint / Format | ESLint / Prettier                     | 10.15.0 / 3.10.1                |

版本纪律：

- 依赖必须写精确版本，不使用 `latest`、`*` 或无约束范围。
- 必须提交 `pnpm-lock.yaml`，CI 使用 `pnpm install --frozen-lockfile`。
- 升级依赖必须：查官方兼容性 → 改版本 → 安装 → lint/typecheck/test/build →
  在 WORKLOG 记录原因和结果。
- TypeScript 当前固定在 5.9.3：`typescript-eslint@8.74.0` 尚不支持 TypeScript 7。
  升级 TypeScript 前先确认 lint 工具链支持范围（见 ADR-014）。

## 4. 目录结构与模块边界

```text
web-mir/
├─ apps/
│  ├─ game-web/       Phaser 世界 + React HUD
│  ├─ admin-web/      运营控制台
│  ├─ control-api/    Fastify REST + 未来 Outbox dispatcher
│  └─ game-server/    Colyseus Room 与实时适配
├─ packages/
│  ├─ contracts/      API/协议/健康/错误码，客户端与服务端共享
│  ├─ game-simulation/ 固定 tick、移动推进、路径与边界（阶段 1 创建）
│  ├─ config/         Zod 环境变量校验与 .env 加载
│  ├─ observability/  Pino 结构化日志与脱敏
│  ├─ persistence/    Drizzle schema、数据库客户端、migrations
│  └─ testkit/        可控 RNG、手动时钟等测试基础设施
├─ docs/              ADR、阶段报告、状态与日志
├─ infra/docker/      PostgreSQL / Redis（scale profile）
├─ tests/e2e/         Playwright
└─ AGENTS.md
```

`game-simulation` 已在阶段 1 创建，承载固定 tick、路径与移动推进，不依赖
Colyseus、Phaser、数据库或 HTTP。

当前**尚未创建**的包及创建时机（ADR-013）：`content-schema`（阶段 7 内容发布）、
`game-domain`（阶段 3 移动/阶段 4 战斗）、`game-application`（阶段 5 事务用例）、
`auth`（阶段 2）、`map-runtime`（阶段 3）。不要提前创建空壳包。

强制依赖方向：

- `contracts`、`config` 不依赖任何 app。
- `persistence` 只依赖 `config` 和数据库库，不依赖 app。
- `game-simulation` 只依赖 `contracts`；不得依赖 Colyseus、Phaser、数据库或 HTTP。
- `game-web` 只能导入 `contracts`、自身表现层与资源 manifest；不能导入服务端包
  （含 `game-simulation`）、数据库、Fastify、Colyseus 服务端或 Pino。
- `admin-web` 只能通过 Control API 访问数据；只能导入 `contracts`，不得导入
  Phaser、服务端包或数据库。
- `control-api` 与 `game-server` 不得互相导入。
- 任何 package 不得导入任何 app。
- 上述规则由 `eslint.config.js` 的 `no-restricted-imports` 在 CI 中强制检查。
  新增共享包时必须同步更新边界规则。

## 5. 编码规范

### TypeScript

- 全仓库 strict，禁止 `any`、`as unknown as`、非空断言绕过类型。
- 类型不匹配先修真实类型，不要用断言压过去。
- 使用 `import type` / inline `type` 导入类型；`verbatimModuleSyntax` 已开启。
- 公共函数显式返回类型；内部实现可推断。
- 禁止全局可变状态。依赖通过参数或显式接口注入。
- 领域逻辑必须是纯函数或显式副作用接口；随机数、时钟必须注入。
- 文件保持单一职责。不要写超大 `GameScene.ts`、`MapRoom.ts` 或万能 Service。
- 注释只解释“为什么”，不复述代码。禁止大段注释块。

### 命名与结构

- 包名：`@web-legend/<kebab-case>`。
- 文件名：组件 PascalCase；模块 camelCase；SQL migration 由工具生成。
- 环境变量：`SCREAMING_SNAKE_CASE`；浏览器可见变量必须 `VITE_` 前缀。
- API 错误统一使用 `@web-legend/contracts` 的 envelope，不自定义成功/失败格式。
- 日志禁止 `console.*`；使用 `@web-legend/observability`。

### 安全

- 不把密钥、令牌、连接串写入 Git、前端 bundle、日志或错误响应。
- 对外 500 错误只返回通用消息；详细错误只进日志。
- 日志必须脱敏 password/token/authorization/cookie 等字段。
- 所有外部输入（REST、WebSocket、内容配置、环境变量）必须 Zod 校验。
- 权限在服务端校验，前端隐藏按钮不算权限控制。

## 6. 数据库与迁移

- PostgreSQL 是唯一持久事实来源。ID 使用 UUIDv7（PG18 `uuidv7()`）。
- Drizzle schema 位于 `packages/persistence/src/schema/`，迁移只通过
  `pnpm db:generate` 生成，不手改已提交的 migration。
- 迁移策略：Expand → Migrate → Contract。禁止假设所有迁移可逆。
- 并发写使用行锁、唯一约束或乐观锁；不能只靠内存判断。
- 金币必须同时更新 wallet 和 currency ledger，余额与流水同事务。
- 物品实例必须有唯一归属，不能同时存在于地面和背包。
- 所有资产命令必须有 idempotency key 和唯一奖励引用。
- 本地数据库可重置；测试不得在 `NODE_ENV=production` 下执行破坏性操作。
- 集成测试必须连接真实 PostgreSQL，不能用 mock 数据库冒充事务正确性。

## 7. 实时协议

- 协议版本 `PROTOCOL_VERSION` 与前后端、内容、数据库版本相互独立。
- 每条 Client → Server 消息必须有：Zod schema、字段上下限、限频、身份校验、
  幂等策略和错误码。
- 客户端只提交意图（如 `move.to` 的目标 tile），不得提交最终坐标、伤害、掉落、
  金币或经验结果。
- 服务端移动使用权威导航网格；客户端预测必须可被服务端校正。
- Room 启动时固定 Content Release 和 Asset Manifest 版本。
- 私有数据（背包、账号、GM 标记）不得进入公开 Room State。
- 重连、断线、Room 崩溃必须按架构文档第 8.7 节处理。

## 8. 测试与验收

每个阶段必须提供可复现证据，不接受“看起来没问题”。

- Unit：纯领域函数、校验、状态机、边界条件。
- Integration：真实 PostgreSQL、迁移、事务、并发、Room join/leave/reconnect。
- Contract：REST/WS schema、协议兼容。
- E2E：真实浏览器，后续必须覆盖两个独立 Browser Context 联机。
- Load / Recovery：阶段 8 按架构验收目标执行。

命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

测试要求：

- 测试名称描述行为，不描述实现。
- 不用固定 sleep 等待异步结果；使用可观察条件或事件。
- 不为了让测试通过而降低断言或跳过失败测试。确需跳过时必须在报告中说明。
- 验收截图、日志和指标存入 `docs/phase-reports/<phase>/`。

## 9. Git 规范

- 提交信息使用 Conventional Commits：
  `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `build:`, `ci:`。
- 一次提交只做一件事；阶段结束形成清晰的阶段提交。
- 禁止提交 `.env`、密钥、数据库数据文件、`node_modules`、`dist`、coverage。
- 提交前必须运行受影响的 lint、typecheck 和测试。
- 不覆盖用户未提交的变更；不使用破坏性 Git 命令清理工作区。
- 不 force push 主分支。

## 10. 多 Agent 协作

角色与边界：

| 角色                   | 职责                             | 允许修改                         |
| ---------------------- | -------------------------------- | -------------------------------- |
| Architect / Integrator | 架构、contracts、ADR、集成、门禁 | `docs/`、`AGENTS.md`、跨模块接口 |
| Client                 | Phaser、React、资源管线          | `apps/game-web/`                 |
| Server                 | Colyseus、Room、同步、AOI        | `apps/game-server/`              |
| Domain / Persistence   | 领域、事务、schema、迁移         | 领域与 persistence 包            |
| Platform               | API、认证、数据库接入            | `apps/control-api/`              |
| Admin                  | 运营后台                         | `apps/admin-web/`                |
| QA                     | 测试、E2E、压测、恢复演练        | `tests/`、`testkit/`、测试脚本   |

规则：

- Architect 先定义 contracts、schema、migration 和验收标准，再派发并行任务。
- 多个 Agent 不得同时修改同一 migration、公共 DTO、共享配置或同一核心文件。
- 共享接口变化由 Architect 统一合并。
- 每个 Agent 提交前运行受影响模块的 lint/typecheck/test。
- 发现需求冲突或架构风险，先写 ADR 或提出问题，不得私自改架构。
- 最终集成、代码审查和验收由 Tech Lead 负责。

## 11. 文档维护

- `docs/PROJECT_STATUS.md`：阶段、完成项、风险、阻塞、最近测试和提交。每个重要
  任务或阶段结束后更新。
- `docs/WORKLOG.md`：追加式日志。记录目标、实际改动、命令、测试结果、问题与
  下一步；不得删除或覆盖历史。
- `docs/ADR/`：重要架构决策。不得默默修改架构。
- `docs/phase-reports/`：每阶段报告，必须有代码、测试和验收证据。
- 文档与代码同步演进。代码是交付物，文档是记忆，测试是质量证明。

## 12. 本开发环境约束

当前 SSH 环境本身是一个 Docker 容器，Docker daemon 位于容器之外：

- 宿主机映射 `8580-8589 → 80-89`。容器内 80 已被 nginx 占用，本项目使用
  84/85/86/87（对应宿主机 8584/8585/8586/8587）。
- 本项目 PostgreSQL 容器发布在宿主机上，需通过容器网关 `192.51.0.1:5432`
  访问；`127.0.0.1:5432` 是环境中另一个 PostgreSQL。详见 `.env.example`。
- `fs.inotify.max_user_watches=8192`，file watcher 容易 ENOSPC。默认 `pnpm dev`
  不启用后端 watch；前端 Vite 使用轮询。需要热重载时使用 `dev:watch`，但必须
  先确认 watcher 限额。
- Playwright 官方浏览器在当前系统不可下载；使用预装 Chromium 并通过
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定。普通开发机应删除该变量并运行
  `pnpm exec playwright install chromium`。
- Redis 属于扩容阶段，当前未启动；本地镜像不可用时不得用其他版本冒充 8.2。

## 13. 禁止事项

- 未经 ADR 更换 Phaser、Colyseus、PostgreSQL 等主技术。
- 把游戏逻辑写进一个 HTML、一个 Phaser Scene 或一个 Room 类。
- 客户端决定位置、伤害、掉落、金币或装备属性。
- 在固定 tick 中等待 SQL、HTTP、文件 IO 或 AI 服务。
- 把 Redis 当作角色、金币或物品的唯一存储。
- 绕过 ledger、物品事务或 idempotency key。
- 后台执行任意 JS、`eval`、动态 import 或任意 SQL。
- 用前端隐藏按钮代替服务端权限。
- 不经验证直接升级依赖。
- 一次性生成大量只有目录和接口的空壳模块。
- 把“页面能打开”或“本机单人能动”当成多人 MVP 完成。
- 提交密钥或覆盖用户现有变更。

## 14. 会话启动检查清单

1. 阅读本文件。
2. 阅读 `docs/PROJECT_STATUS.md`。
3. 查看 `docs/WORKLOG.md` 最近记录。
4. 查看 `git status`、`git log --oneline -10`。
5. 确认当前阶段、未完成任务、已知风险和阻塞。
6. 阅读相关 ADR 和阶段报告。
7. 需要改架构时先写 ADR。
8. 完成任务后更新 WORKLOG、PROJECT_STATUS 和阶段报告（如适用）。
