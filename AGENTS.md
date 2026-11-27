# Web Legend 开发规范

> 本文件对所有 Agent 和开发者生效。开始任何任务前必须先阅读本文件，再按
> §14.1 的顺序阅读 `docs/PROJECT_STATUS.md`、`docs/EVOLUTION_LOG.md`、
> `docs/WORKLOG.md` 最近记录、当前版本计划与 Git 状态。
>
> 架构基线：`docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md`
> 历史实施基线：`docs/WEB_LEGEND_MVP_PLAN_v2.md`（阶段 0–9）
> 当前版本计划：`docs/ALPHA_02_EXECUTION_PLAN.md`（随版本更新）

## 1. 项目目标与长期使命

Web Legend 是浏览器即开即玩、服务端权威、数据持久化、可持续更新内容的传奇类
2D 多人在线 MMORPG。

目标不是做单机演示，也不是先搭庞大中台。每个阶段必须交付真实可玩、可测试、
可复现的纵向切片；没有通过阶段验收不得进入下一阶段。

长期使命：把它做成有游戏深度、多人互动价值和持续演进能力的 MMORPG，而不是
功能堆砌的网页小游戏；也不要过度抽象成通用引擎。优先把产品做好，在真实需求
中逐渐形成可复用能力。产品原则、体验循环与成功度量以
`docs/PRODUCT_VISION.md` 为准。

### 1.1 判断需求的三个问题

任何需求排期前先问：它是否让玩家更愿意再玩 30 分钟？是否让玩家更愿意明天
回来？是否让玩家更愿意和别人一起玩？三个都答“否”的功能，即使技术上正确，
也不应优先做。

### 1.2 自主研发与反思机制

每个版本和可玩切片按“观察 → 分析 → 设计 → 实施 → 验证 → 复盘 → 沉淀 →
迭代”执行：

1. **开发前**：确认它解决真实产品问题；评估更简单方案、耦合、边界、并发/
   安全/性能/数据一致性风险；必要时先写 ADR 或提出质疑。
2. **开发中**：持续检查模块职责、重复逻辑、过大类/函数、多余抽象、状态管理、
   tick 与客户端性能；及时补单元/集成/E2E，不等最后。
3. **开发后**：回答哪些设计正确、哪些不够好、是否引入债务、遗漏哪些测试、
   玩家能否感受到价值、下次如何做得更好。
4. **主动发现**：技术债务、玩法缺陷、体验问题、架构瓶颈、性能与一致性风险；
   按影响排序，重大问题及时提出，不被琐事打断节奏。
5. **沉淀**：可复用经验写入 `docs/ENGINEERING_LEARNINGS.md`；里程碑级判断写入
   `docs/EVOLUTION_LOG.md`；只有需要所有 Agent 强制遵守的才提炼进本文件。

### 1.3 自主推进与人工决策边界

在已确定的产品方向与版本范围内，可自主：拆分任务、安排顺序、选择局部实现、
小范围重构、补测试、修缺陷、优化性能、更新规范与记录。不需要为每个小任务
请求许可。

以下重大决策必须先给推荐方案与理由，由用户审阅：更换核心引擎/实时框架/
数据库核心模型；破坏兼容性的协议调整；核心架构大规模重构；引入新的重大基础
设施；大幅调整长期产品方向；正式环境不可逆数据操作；大规模经济与平衡规则
调整。

### 1.4 游戏体验与技术质量同等重要

所有重要玩法同时评价：功能是否真实可用、是否稳定、操作是否自然、反馈是否
及时、是否有趣、是否形成成长目标、是否鼓励探索、是否为多人创造价值。美术、
动画、音效、UI 不是附属工作；占位资源必须统一风格并明确标注，不用默认组件
堆出“能运行”的假成品。

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
│  ├─ contracts/      API/协议/角色 DTO/健康/错误码，客户端与服务端共享
│  ├─ auth/           Argon2id 密码、会话令牌与一次性票据令牌（阶段 2 创建）
│  ├─ content-schema/ 内容 bundle schema、基线内容、校验、checksum 与差异（阶段 7）
│  ├─ game-domain/    战斗纯函数、技能/怪物/物品/掉落规则与内存战斗世界（阶段 4/5）
│  ├─ game-application/ 事务用例：击杀奖励、拾取、背包、装备、金币（阶段 5）
│  ├─ game-simulation/ 固定 tick、移动推进、寻路、AOI（阶段 1/3）
│  ├─ map-runtime/    Tiled 编译、导航与传送门运行时（阶段 3 创建）
│  ├─ config/         Zod 环境变量校验与 .env 加载
│  ├─ observability/  Pino 结构化日志与脱敏
│  ├─ persistence/    Drizzle schema、数据库客户端、migrations
│  └─ testkit/        可控 RNG、手动时钟等测试基础设施
├─ content/
│  ├─ maps/           Tiled 源图（.tmj）与编译产物（compiled/）
│  └─ assets/         资源 manifest 与生成的占位 tileset/角色贴图
├─ docs/              ADR、阶段报告、状态与日志
├─ infra/docker/      PostgreSQL / Redis（scale profile）
├─ tests/e2e/         Playwright
└─ AGENTS.md
```

`game-simulation` 已在阶段 1 创建并承载固定 tick、路径与移动推进，阶段 3 增加
基于格子的 AOI；它不依赖 Colyseus、Phaser、数据库或 HTTP。`auth` 已在阶段 2
创建，承载 Argon2id 密码哈希、会话令牌与票据令牌，只使用 Node 内置 `crypto`，
不依赖 contracts、数据库或 app。`map-runtime` 已在阶段 3 创建，承载 Tiled 编译、
checksum、导航格与传送门查询，只依赖 `contracts` 与 Node 内置模块。
`content-schema` 已在阶段 7 创建，承载内容 bundle 的 Zod schema、基线内容、
引用/范围校验、规范化 checksum 与差异；它只依赖 `contracts`（含
`contracts/maps`），不依赖数据库、app 或 game-domain。
`game-domain` 已在阶段 4 创建，承载战斗纯函数、技能/怪物/物品/掉落规则与无 IO 的
`CombatWorld`；阶段 5 增加物品、掉落表、经验曲线与背包/装备纯规则；阶段 6 增加
玩家目标战斗（PvP）、死亡复活计时与纯函数聊天过滤；阶段 7 改为消费
`content-schema/base` 的基线 bundle，并允许调用方注入 Room 固定的
`ContentBundle`。它只依赖 `contracts` 与 `content-schema/base`，移动格、寻路、
RNG 与复活点由调用方注入。安全区由编译地图的 `pvpMode` 决定，Room 不得从客户端
字段推断。
`game-application` 已在阶段 5 创建，承载击杀奖励、拾取、装备、卸下与消耗品使用
的事务用例，依赖 `contracts`、`game-domain` 与 `persistence`；阶段 7 接受 Room
注入的内容 bundle。

ADR-013 中的包均已创建；阶段 8 如需新包必须先有真实消费者、测试与 ADR。
不要创建空壳包。

强制依赖方向：

- `contracts`、`config` 不依赖任何 app。
- `auth` 只依赖 Node 内置模块；不得依赖 contracts、数据库、HTTP 框架或 app。
- `persistence` 只依赖 `config` 和数据库库，不依赖 app。
- `game-simulation` 只依赖 `contracts`；不得依赖 Colyseus、Phaser、数据库或 HTTP。
- `content-schema` 依赖 `contracts`（含 `contracts/maps`）；不得依赖数据库、
  Colyseus、Phaser、HTTP、其他领域包或 app。
- `game-domain` 只依赖 `contracts` 与 `content-schema/base`；不得依赖
  game-simulation、map-runtime、Colyseus、Phaser、数据库、HTTP 或 app。导航格、
  寻路函数、RNG 与内容 bundle 通过参数注入。
- `map-runtime` 只依赖 `contracts` 与 Node 内置模块；不得依赖 Colyseus、数据库、
  HTTP 框架、app 或 `game-simulation`。
- `game-application` 依赖 `contracts`、`game-domain`、`persistence`；不得导入
  Colyseus、Fastify、Pino、Phaser、`game-simulation`、`map-runtime` 或任何 app。
- `control-api` 依赖 `auth`、`persistence`、`contracts`（含 `contracts/maps`）、
  `content-schema` 与 `game-domain`；不得导入 game-server 或 map-runtime。
- `game-server` 依赖 `auth`、`persistence`、`game-simulation`、`game-domain`、
  `game-application`、`map-runtime`、`content-schema`、`contracts`；不得导入
  control-api。
- `game-web` 只能导入 `contracts`（含 `contracts/maps`）、自身表现层与资源
  manifest；不能导入服务端包（含 `game-simulation`、`map-runtime`、`auth`）、
  数据库、Fastify、Colyseus 服务端或 Pino。
- `admin-web` 只能通过 Control API 访问数据；只能导入 `contracts`，不得导入
  Phaser、服务端包（含 `content-schema`）或数据库。
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
- PvP 是否允许只能由 Room 绑定的编译地图 `pvpMode` 决定；不得信任客户端上报的
  区域、坐标或地图字段。主城默认 `none`，野外默认 `open`。
- 运营指令（Kick/Ban/Mute）只能由 Control API 在审计 + Outbox 事务中写入，经
  受信内部端点投递；Game Server 必须按 `commandId` 幂等执行，客户端不得触发。
- 聊天内容必须经过服务端过滤与限频后才能广播；被拦截消息只向发送者返回警告。
- Room 启动时固定 Content Release 和 Asset Manifest 版本。
- Game Server 进程通过 `GAME_SERVER_REALM` 绑定一个区服（ADR-023）；Room 在
  `onAuth` 校验角色所属区服，不再取“第一个活跃区服”的内容。生产启动时区服
  不存在应直接失败。
- 生产 WebSocket 必须校验 Origin（`GAME_SERVER_ALLOWED_ORIGINS`，生产必填）。
- `/metrics` JSON 与 `/metrics/prometheus` 文本读取同一内存注册表；运营指标
  端点只能在内网/Prometheus 可达，不得经公网反向代理暴露。
- 私有数据（背包、账号、GM 标记、队伍名单）不得进入公开 Room State。
- 队伍状态属于 Room：传送、最终离开与宽限期结束必须移除队员；共享击杀经验
  必须是独立幂等事务，不得让队友重复领取击杀奖励（ADR-035）。
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
pnpm maps:compile        # 从 Tiled 源图生成编译产物；提交产物后测试会校验一致性
pnpm repair:maps         # 幂等迁移退役地图上的角色（阶段 3 一次性维护命令）
pnpm load:world          # 30 人地图负载检查，读取 /metrics 的 tick 指标
pnpm load:scenario       # 容量场景；LOAD_PLAYERS/LOAD_ATTACKERS/LOAD_DURATION_MS 可调
pnpm load:regression     # 50 人 × 10 分钟容量回归，输出接受率与拒绝码分布
pnpm verify:invariants   # 钱包/账本/物品位置/过期掉落等资产不变量
pnpm drill:recovery      # Game Server SIGTERM/SIGKILL 恢复演练（先 pnpm build）
pnpm drill:outbox        # Outbox 重试、退避与重复 commandId 演练
pnpm db:backup           # 自定义格式备份 + manifest + SHA-256
pnpm db:restore-drill <dump> <manifest>  # 独立演练库真实恢复并校验
pnpm cert:dev            # 生成自签名 TLS 证书（仅演练）
pnpm prod:deploy         # 生产 compose 发布（IMAGE_TAG 等变量见 runbook）
pnpm prod:rollback       # 回滚到 previous-tag，无数据库反向迁移
```

阶段 8 运行手册见 `docs/runbooks/DEPLOYMENT_AND_RECOVERY.md`。

测试要求：

- 测试名称描述行为，不描述实现。
- 不用固定 sleep 等待异步结果；使用可观察条件或事件。
- 不为了让测试通过而降低断言或跳过失败测试。确需跳过时必须在报告中说明。
- 验收截图、日志和指标存入 `docs/phase-reports/<phase>/`。
- `pnpm test` 使用一次性 PostgreSQL 数据库（`wl_test_*`，ADR-024），结束后
  删除；测试不得依赖或写入共享开发库数据。目标角色需要 `CREATEDB`，可用
  `TEST_DATABASE_URL` 指向独立实例。
- E2E 使用专用数据库 `web_legend_e2e`（可用 `E2E_DATABASE_URL` 覆盖）与独立
  端口 5184/5185/3086/2587；Playwright 启动前建库并迁移，结束后删库。E2E 不得
  连接开发栈数据库或其 outbox，否则管理命令会被开发进程抢走（ADR-025）。

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

- `docs/PROJECT_STATUS.md`：**新会话恢复上下文的唯一权威入口**。必须包含当前
  版本/阶段、已完成里程碑、进行中工作、未完成任务、已知问题、阻塞、最近测试、
  下一步与文档地图。每个重要任务或阶段结束后更新。
- `docs/WORKLOG.md`：追加式任务日志。记录目标、实际改动、命令、测试结果、问题
  与下一步；不得删除或覆盖历史。
- `docs/EVOLUTION_LOG.md`：里程碑级演进记录（为什么做、关键决策、结果、复盘），
  与 WORKLOG 不重复。
- `docs/PRODUCT_VISION.md`：产品使命、核心体验循环、产品支柱、成功度量与决策
  边界。
- `docs/PROJECT_ROADMAP.md`：版本路线、范围、里程碑、验收与门禁。
- `docs/<VERSION>_EXECUTION_PLAN.md`：当前版本切片、依赖、验收与债务影响。
- `docs/ADR/`：重要架构决策。不得默默修改架构。
- `docs/TECHNICAL_DEBT.md`：逐项债务，必须有编号、证据、影响、建议与版本。
- `docs/ENGINEERING_LEARNINGS.md`：真实案例沉淀的可复用经验；只写有证据的
  经验，不为反思而制造总结。需要所有 Agent 强制遵守的才提炼进本文件。
- `docs/phase-reports/`：每阶段/切片报告，必须有代码、测试和验收证据。
- 文档与代码同步演进。代码是交付物，文档是记忆，测试是质量证明。

### 持续进化闭环

每个版本与可玩切片按“观察 → 分析 → 设计 → 实施 → 验证 → 复盘 → 沉淀 →
迭代”执行：先复核真实状态与债务，再选当前最有价值的问题；设计时评估替代
方案；实施后必须真实验证；复盘写清哪些设计正确、哪些不够好；可复用经验进入
`ENGINEERING_LEARNINGS.md`，需要强制执行的门禁进入本文件或 CI。不要机械按
路线图阶段名开发；调整顺序必须说明理由与影响。

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
  `pnpm exec playwright install chromium`。软件渲染下默认限制 2 个 worker
  （`PLAYWRIGHT_WORKERS` 可覆盖），否则 250ms 可见性与攻击时序断言会抖动。
- 开发管理员由 `pnpm db:seed` 创建，账号/密码来自 `ADMIN_SEED_USERNAME` /
  `ADMIN_SEED_PASSWORD`。`INTERNAL_ADMIN_TOKEN` 的默认值只用于本地开发，
  `NODE_ENV=production` 时必须显式覆盖。
- Node 的 `fetch`（含 Colyseus SDK 的 matchmaking）拒绝 87 端口（WHATWG
  bad port）。负载脚本因此通过 Vite 的 `/ws` 代理连接实时服务器，并用
  `node:http` 读取 `/metrics`；不要把负载脚本改成直连 `fetch`。
- Docker Hub 在本环境不可达；镜像通过本地镜像站拉取。构建生产镜像时用
  `--build-arg NODE_IMAGE=docker.1ms.run/library/node:26-bookworm-slim`、
  `--build-arg NGINX_IMAGE=docker.1ms.run/library/nginx:1.27-alpine`，compose
  用 `NODE_IMAGE`/`NGINX_IMAGE`/`PROMETHEUS_IMAGE`/`POSTGRES_IMAGE` 覆盖；
  默认值留给能访问 Docker Hub 的环境。不得把镜像站地址写成唯一来源。
- 生产 compose 的容器网络在 Docker daemon 所在的宿主机上；从本 SSH 容器
  不能直接访问其发布端口。演练用 `infra/docker/compose.drill.yml` 暴露
  PostgreSQL 到宿主机端口，再经网关 `192.51.0.1:<port>` 访问。
- 本机没有 `psql`/`pg_dump` 客户端，备份/恢复脚本自动回退到固定的 PostgreSQL
  容器镜像；`pg_restore` 从 stdin 读取归档（不能传 `-`）。
- Redis 属于扩容阶段，当前未启动；本地镜像不可用时不得用其他版本冒充 8.2。

## 13. 禁止事项

- 未经 ADR 更换 Phaser、Colyseus、PostgreSQL 等主技术。
- 把游戏逻辑写进一个 HTML、一个 Phaser Scene 或一个 Room 类。
- 客户端决定位置、伤害、掉落、金币或装备属性。
- 在固定 tick 中等待 SQL、HTTP、文件 IO 或 AI 服务。
- 把 Redis 当作角色、金币或物品的唯一存储。
- 绕过 ledger、物品事务或 idempotency key。
- 后台执行任意 JS、`eval`、动态 import 或任意 SQL。
- 修改或删除已发布的 Content Release、审计日志与激活历史。
- 用前端隐藏按钮代替服务端权限。
- 不经验证直接升级依赖。
- 一次性生成大量只有目录和接口的空壳模块。
- 把“页面能打开”或“本机单人能动”当成多人 MVP 完成。
- 提交密钥或覆盖用户现有变更。

## 14. 会话启动与工作交接规范

### 14.1 开始工作前必须读取

1. 本文件（规则、边界、环境约束）。
2. `docs/PROJECT_STATUS.md` 的“会话入口”（当前版本、工作、阻塞、下一步）。
3. `docs/EVOLUTION_LOG.md` 最近条目（里程碑级决策与反思）。
4. `docs/WORKLOG.md` 最近 1–2 条（任务级命令与结果）。
5. `docs/PROJECT_ROADMAP.md` 与当前版本计划（如 `docs/ALPHA_02_EXECUTION_PLAN.md`）。
6. `docs/TECHNICAL_DEBT.md` 中与当前任务相关的债务。
7. 相关 ADR 与最近阶段报告。
8. `git status`、`git log --oneline -10`，确认工作区是否有未提交改动。

### 14.2 开工前确认

- 当前版本、阶段门禁是否通过；是否存在 P0/P1 或阻塞。
- 本轮任务属于“可自主”还是“必须先提方案”的决策边界。
- 任务的契约、数据迁移、共享接口与文件边界；共享接口未冻结前不并行写入。
- 验收标准：真实代码、测试、浏览器/E2E、资产不变量或容量证据。

### 14.3 结束工作前必须更新

- `docs/PROJECT_STATUS.md`：会话入口、阶段进度、风险、最近测试、下一步、提交。
- `docs/WORKLOG.md`：追加目标、改动、命令、结果、问题、下一步（不覆盖历史）。
- `docs/EVOLUTION_LOG.md`：仅当产生里程碑级决策/复盘时追加。
- `docs/TECHNICAL_DEBT.md`：新增、关闭或调整债务。
- 重要决策写 `docs/ADR/`；可复用经验写 `docs/ENGINEERING_LEARNINGS.md`。
- 阶段/切片证据写入 `docs/phase-reports/<phase>/`（截图、日志、指标、数据库）。
- 提交前运行受影响模块的 `pnpm verify` 与隔离 E2E；不得用“本地看起来通过”
  替代真实执行。

### 14.4 交接摘要模板

```text
当前版本/阶段：
本轮完成（含提交哈希）：
未完成/阻塞：
门禁结果（命令 + 通过数）：
未验证项：
新债务/风险：
下一步（按优先级）：
```

交接以 `docs/PROJECT_STATUS.md` 为准；对话中的口头总结不能替代文档更新。
