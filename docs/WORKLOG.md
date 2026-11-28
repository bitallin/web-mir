# Web Legend 研发工作日志

> 追加式记录。不要删除或覆盖历史。每项工作记录目标、实际改动、命令、测试结果、
> 问题与下一步。

---

## 2026-11-24 · 阶段 0：工程底座与规则冻结

### 本次任务目标

按 `WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md` 与 `WEB_LEGEND_MVP_PLAN_v2.md`
完成阶段 0：建立可复现 Monorepo、锁定技术版本、建立质量门禁、数据库与健康检查、
项目治理文档；不实现游戏业务。

### 环境检查

- 初始仓库只有两份 docs，无 Git 仓库。
- 系统 Node.js 为 24.22.2；架构要求 Node 26 LTS。通过既有 nvm 安装 26.13.1，
  不替换系统 Node。
- pnpm 11.7.0、Docker 24.0.5、Docker Compose v5.7.0 可用；无本地 psql。
- Docker Hub 不可直连；宿主机已有
  `docker.m.daocloud.io/postgres:18`（实际 18.3），按摘要锁定使用。
- SSH 环境本身是容器，宿主机映射 8580-8589 → 80-89；80 被环境 nginx 占用。
- Docker daemon 在 SSH 容器之外（DooD），PostgreSQL 发布端口需经网关
  `192.51.0.1:5432` 访问。
- `fs.inotify.max_user_watches=8192`，不足以支撑 tsx watch。

### 版本核对（2026-11-24）

- 最新稳定：Phaser 4.2.1、Colyseus core 0.18.28、Schema 5.0.50、
  `@colyseus/sdk` 0.18.10、Fastify 5.12.8、Drizzle 0.45.4、React 19.3.1、
  Ant Design 6.7.2、Vite 8.3.8、Zod 4.6.7、Vitest 5.1.1、Playwright 1.65.1。
- `typescript@latest` 为 7.0.2，但 `typescript-eslint@8.74.0` 只支持
  `<6.1.0`，因此固定 TypeScript 5.9.3。
- Node 26.13.1 是当前 LTS；Colyseus 要求 Node >=22，其他依赖均兼容。

### 实施内容

1. **Monorepo**
   - `pnpm-workspace.yaml` 管理 `apps/*`、`packages/*`。
   - 根 `package.json` 锁定 Node 26、pnpm 11.7.0、精确依赖版本和脚本。
   - 统一 `tsconfig.base.json`：strict、noUncheckedIndexedAccess、
     exactOptionalPropertyTypes、verbatimModuleSyntax。

2. **应用**
   - `apps/game-web`：Vite + React 19 + Phaser 4.2.1；技术启动场景绘制暗色网格、
     品牌标题和版本信息；React HUD 显示 Control API 真实状态；resize 监听在
     Scene shutdown 时清理；StrictMode 下销毁 Phaser 实例。
   - `apps/admin-web`：Vite + React + Ant Design 6；自定义暗色运营工作台外壳，
     展示真实 API/数据库健康状态和阶段交付清单，不虚构玩家或经济数据。
   - `apps/control-api`：Fastify 5；Zod 环境校验；Pino 日志；CORS；requestId；
     `/health/live`、`/health/ready`；数据库探针 2s 超时；500 错误不泄露细节；
     SIGINT/SIGTERM 优雅关闭。
   - `apps/game-server`：Colyseus 0.18 `Server` + `WebSocketTransport`；
     Express 健康路由；开发环境 `diagnostics` Room；Zod 校验 ping；10s 重连宽限。

3. **共享包**
   - `contracts`：PROTOCOL_VERSION、健康/就绪/错误 envelope schema。
   - `config`：Zod 环境 schema、向上查找 `.env`、错误不输出值。
   - `observability`：Pino 结构化日志、ISO 时间、敏感字段脱敏。
   - `persistence`：postgres.js + Drizzle 客户端、`realms` 表、迁移 CLI。
   - `testkit`：mulberry32 可复现 RNG、手动时钟。

4. **数据库**
   - `realms` 表：UUIDv7 主键、唯一 code、status、created_at。
   - 迁移 `0000_public_queen_noir.sql` 由 drizzle-kit 生成。
   - 本地 PostgreSQL 18.3 执行迁移成功。

5. **质量门禁**
   - ESLint 10 flat config + 类型感知规则；禁止 `any`、浮动 Promise、console。
   - `no-restricted-imports` 强制应用/包依赖边界；实测阻止 game-web 导入
     `@web-legend/persistence`。
   - Prettier；Vitest；Playwright；GitHub Actions。

6. **文档**
   - `AGENTS.md`、`README.md`、`PROJECT_STATUS.md`、`WORKLOG.md`。
   - ADR-001 至 ADR-014（含 ADR-013 包实现策略、ADR-014 工具链锁定）。
   - 阶段 0 报告与两张真实页面截图。

### 修改和新增的主要文件

- 根：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`、
  `eslint.config.js`、`vitest.config.ts`、`playwright.config.ts`、`.env.example`、
  `.nvmrc`、`.gitignore`、`.prettierrc.json`、`README.md`、`AGENTS.md`。
- 应用：`apps/{game-web,admin-web,control-api,game-server}/**`。
- 包：`packages/{contracts,config,observability,persistence,testkit}/**`。
- 基础设施：`infra/docker/compose.yml`、`.github/workflows/ci.yml`。
- 文档：`docs/PROJECT_STATUS.md`、`docs/WORKLOG.md`、`docs/ADR/**`、
  `docs/phase-reports/phase-00/*.png`。
- 测试：`tests/e2e/foundation.spec.ts`、各包/应用测试文件。

### 关键技术决策

- 采用 ADR-013：只创建有真实实现和消费者的包；`game-simulation`、`auth`、
  `game-domain`、`map-runtime`、`game-application`、`content-schema` 延后到真实
  需求出现时创建，避免空壳。
- 采用 ADR-014：Node 26.13.1、TypeScript 5.9.3、全部依赖精确版本。
- 当前环境端口改为 84/85/86/87（宿主机 8584-8587）。
- 后端默认不启用 watch，Vite 使用轮询，规避 inotify ENOSPC。
- Playwright 使用预装 Chromium 131，`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 注入。
- PostgreSQL 18.3 使用 18+ 官方镜像要求的挂载点 `/var/lib/postgresql`。

### 执行的命令与结果

```bash
pnpm install
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm format
pnpm verify
pnpm test
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
```

结果：

- frozen install 通过。
- 迁移在空库执行成功，`realms` 表存在，`uuidv7()` 返回合法 UUIDv7。
- `pnpm verify`：format、lint、typecheck、38 个测试、4 个应用构建全部通过。
- E2E：2/2 通过。
- 边界探针：game-web 导入 persistence 被 ESLint 拒绝。

### 遇到的问题及解决方法

1. **Node 版本不符**：系统 Node 24，架构要求 26。使用 nvm 安装 26.13.1，`.nvmrc`
   和 engines 锁定；不修改系统 Node。
2. **TypeScript 7 与 lint 不兼容**：typescript-eslint 只支持 <6.1.0。固定 5.9.3，
   记录 ADR-014。
3. **JSON 版本导入路径错误**：`../../package.json` 指向 apps 目录；改为
   `../package.json`。
4. **Phaser 4 颜色 API 差异**：Graphics 使用数字颜色，Text style 使用字符串颜色；
   拆分 `GOLD_HEX` 与 `GOLD`。`Scene.create` 不使用 `override`。
5. **PostgreSQL 18 容器反复重启**：18+ 镜像要求卷挂载到 `/var/lib/postgresql`。
   修正 compose 后健康。
6. **迁移报 `role "web_legend" does not exist`**：SSH 容器内 127.0.0.1:5432 是
   环境自带 PostgreSQL；本项目容器发布在宿主机。改用网关 `192.51.0.1:5432`。
   同时在迁移错误中输出 cause，便于定位。
7. **Docker Hub 不可达**：使用本地镜像并按 digest 锁定 PostgreSQL 18.3。
8. **inotify ENOSPC**：tsx watch 无法启动；后端改为普通 tsx，Vite 使用轮询，
   保留 `dev:watch` 供其他环境使用。
9. **端口 80 被 nginx 占用**：项目端口调整到 84-87。
10. **Playwright 浏览器缺失且系统不受支持**：使用预装 Chromium 131，通过
    `executablePath` 启动；E2E 通过。
11. **Playwright webServer 无法复用已运行 Vite**：增加
    `PLAYWRIGHT_SKIP_WEBSERVER=true` 本地开关；CI 仍自行启动服务。
12. **测试硬编码版本 0.0.0**：版本提升到 0.1.0 后改为 schema 校验 + semver 匹配。
13. **exactOptionalPropertyTypes 与 Playwright 配置**：`webServer: undefined` 不合法，
    改为条件展开对象。

### 尚未解决的问题

- 集成测试仍使用共享开发数据库；需在阶段 5 前建立独立测试库或临时 schema。
- Redis 8.2 镜像在当前网络不可用；扩容阶段再解决。
- 生产构建存在大 chunk 警告（Phaser/AntD）；阶段 8 前优化。
- 后端默认无热重载；当前环境限制，非架构问题。
- CI 尚未在真实 GitHub Runner 上执行过（本机无远端仓库）；工作流已静态编写。

### 阶段提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
  `chore(phase-0): establish engineering foundation`。

### 下一步计划

1. 等待 Tech Lead 审阅阶段 0 报告。
2. 批准后执行阶段 1：`game-simulation` 固定 tick、world_map Room、双浏览器
   实时可见和服务端权威移动，详见阶段报告第 11 节。

---

## 2026-11-24 · 阶段 1：浏览器双人联网垂直切片

### 本次任务目标

在阶段 0 基础上交付第一条真实多人纵向切片：两个独立浏览器进入同一 Colyseus
`world_map` Room，互相可见，点击移动由服务端权威裁定；不做正式账号、数据库资产、
战斗或背包。只执行阶段 1，不进入阶段 2。

### 开工前检查

- 阅读 AGENTS、PROJECT_STATUS、WORKLOG、技术架构 v2、MVP 计划 v2、阶段 0 报告。
- `git status` 干净；最近提交为阶段 0 文档补记 `0aa3798`。
- 当前实现与架构一致性：阶段 0 只有工程底座；`contracts` 只有协议/健康/错误；
  game-server 只有 diagnostics Room；game-web 只有启动场景。阶段 1 所需内容均未实现。
- 当前主机 84–87 已被上一阶段遗留的 `pnpm dev` 占用；本次验证在 8844–8847
  启动同一套新代码，端口仅本地测试用途。

### 实施内容

1. **contracts**
   - `map.ts`：`mapManifestSchema`、tile 字符、可走性/边界 helper；
   - `realtime.ts`：`move.to`、ack/rejected/notice、拒绝码、20Hz/100ms/4000 units/s、
     `worldJoinOptionsSchema`；
   - `worldState.ts`：`WorldState` / `PlayerState` Colyseus schema，通过
     `@web-legend/contracts/world-state` 子路径导出，根入口不打包 schema；
   - 新增 contract 测试（地图、实时消息、状态 schema）。
2. **game-simulation（新包）**
   - `FixedStepRunner`、四方向 BFS、`WorldSimulation`；
   - 移动使用整数子格（1000/格），路径推进、朝向、速度、出生点与路径校验；
   - 单元测试覆盖直路、绕墙、封闭区域、越界、确定性、速度、重定向、移除。
3. **content/maps/phase1_test_map.json**
   - 30×20 技术测试地图；边界墙、柱体、草地、封闭房间；客户端服务端同一份数据。
4. **game-server**
   - `WorldMapRoom`：20Hz 固定步进、100ms patch、50 人上限；服务端权威移动；
   - 开发身份门禁：生产无条件拒绝；同 playerKey 单连接；
   - commandId 幂等、clientSequence 过期拒绝、token bucket 限频；
   - 4KB payload 上限；断线 15s 宽限与恢复；`/metrics` 指标；
   - 新增 room/identity/metrics/rate-limit/生产门禁集成与单元测试。
5. **game-web**
   - 伪等距投影、脚底锚点 Y 排序、墙体、摄像机、resize；
   - 点击移动、服务端 ack 路径、本地预测 + 吸附校正、远端插值；
   - HUD 在线列表/连接/延迟/指令计数/拒绝提示/重新加入；
   - 同源 `/ws`（Vite 代理 matchmake + WebSocket）、sessionStorage 重连 token、
     早期重连、StrictMode 延迟启动、Scene 重启清理监听；
   - 开发调试参数 `?name/?key/?fresh/?join`（仅 DEV）。
6. **配置与测试**
   - Playwright 启动 game-web、admin-web、game-server；
   - 双 Browser Context、250ms 可见性（浏览器内计时）、刷新重连、断线恢复、
     Scene 重启无重复输入监听；
   - 截图、WebSocket 帧日志、指标证据。
7. **文档**
   - ADR-015（临时开发身份与重连凭据）、ADR-016（阶段 1 移动模型与技术地图）；
   - 更新 AGENTS 包边界、README、PROJECT_STATUS、阶段 1 报告。

### 关键技术决策

- 整数子格坐标 + 服务端 BFS + ack 返回权威路径（ADR-016）；客户端只提交目标 tile。
- 固定 20Hz 模拟、10Hz patch；追赶上限 5 步，防止事件循环卡顿雪崩。
- 状态 schema 放入 contracts 子路径，避免 Control API/管理后台打包 Colyseus schema。
- 技术地图 JSON 由客户端和服务端共同加载并 Zod 校验，阶段 3 换 map-runtime。
- 临时开发身份严格隔离到 development/test，生产拒绝（ADR-015）。
- 浏览器实时连接使用同源 `/ws`，开发代理、生产反代，不把游戏服端口暴露给浏览器。
- 测试隔离使用开发参数 `?fresh=1`/`?join=<roomId>`，避免 `joinOrCreate` 带来的
  跨测试房间污染。

### 执行的命令与结果

```bash
pnpm install
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
GAME_WEB_PORT=8844 ADMIN_WEB_PORT=8845 GAME_SERVER_PORT=8847 \
  PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
```

结果：

- format / lint / typecheck 通过。
- 单元与集成：21 个文件、94 个测试通过（world_map 集成测试连续 3 次 8/8）。
- 构建：4 个应用成功。
- E2E：6/6 通过；移动可见延迟 136–204ms（5 次单独运行 136/145/152/179/180ms）。
- 指标：tick p95 0.03ms、p99 0.07ms（2 玩家、52 样本）。
- 生产门禁：开发身份 join 被拒绝（525）；diagnostics Room 不存在（520）。

### 遇到的问题及解决方法

1. **Colyseus Room 注册是进程级全局**：生产门禁测试与开发服务器同进程时，
   `diagnostics` 仍可见。将生产门禁拆到独立测试文件（独立 worker）后通过。
2. **客户端状态异步到达**：集成测试在创建房间后立即读取 `state.players` 为空；
   改为等待可观察条件（玩家数/服务端 tick）后再断言。
3. **Phaser 4 多边形 API**：`fillPoints` 需要 `Phaser.Math.Vector2[]`；增加
   `toVector2` 转换。
4. **Vite 代理 WebSocket**：浏览器不应直连游戏服端口；使用同源 `/ws`，Vite
   同时代理 matchmake HTTP 与 WS upgrade，并移除 `.env` 中过期
   `VITE_GAME_SERVER_URL` 用法。
5. **StrictMode 双连接风险**：effect 内延迟 0ms 启动，cleanup 取消定时器，避免
   开发模式重复建连/重复 Phaser 实例。
6. **SDK 早期重连限制**：默认入房前 5 秒不自动重连；客户端设置
   `room.reconnection.minUptime = 0`，让早期断线也走恢复流程。
7. **E2E 计时受 Playwright IPC 干扰**：改为浏览器内 `pointerdown` 时间戳和对方
   DOM MutationObserver 时间戳，Node 侧只做差值；测得 136–204ms。
8. **跨测试房间污染**：`joinOrCreate` 会加入遗留 Room；增加 DEV 参数
   `?fresh=1` / `?join=<roomId>` 并为每个 E2E 场景创建独立房间。
9. **Control API 打包体积**：共享 schema 进入根入口使 bundle 从 183KB 增至 449KB；
   改为 `contracts/world-state` 子路径后回到约 188KB。
10. **旧开发栈占用 84–87**：无法在本会话重启用户进程；新栈运行在 8844–8847
    完成验证，默认端口配置未改。
11. **刷新后首条指令被判过期（自查发现）**：页面刷新会新建客户端并从
    `clientSequence=0` 开始，但 Room 保留了刷新前的序号，首条 `move.to` 被
    `STALE_SEQUENCE` 拒绝。修复为在 `onReconnect` 重置该会话的序号与幂等窗口；
    集成测试改为“移动 → 断线 → 重连 → 序号 0 再次移动”，E2E 刷新测试增加刷新后
    移动断言。修复提交 `954155f`。
12. **局域网 HTTP 访问黑屏（用户实测发现）**：`crypto.randomUUID()` 只在安全上下文
    （HTTPS/localhost）存在，通过 `http://10.30.0.25:8588` 访问时抛
    `TypeError: crypto.randomUUID is not a function`，React 崩溃、Phaser 未启动，
    页面只剩标题。新增 `createUuid()`：优先 `randomUUID`，否则用
    `getRandomValues` 生成 UUIDv4；单元测试 + 非 localhost HTTP 的 Playwright
    回归测试覆盖。同时为 Chromium 加 `--no-proxy-server`，避免本机代理拦截
    局域网地址。修复提交 `5f2dbbf`。

### 尚未解决的问题

- 位置只在 Room 内存；Room 崩溃后角色回到出生点（阶段 3/5）。
- 单图 30/50 人容量尚未实测（阶段 8）。
- 正式账号/票据、角色名唯一、单角色租约（阶段 2）。
- Tiled、导航网格、AOI、地图切换（阶段 3）。
- 独立测试数据库仍未建立（阶段 5 前）。
- 生产反向代理的 `/ws` 路由尚未配置（阶段 8 部署）。
- 当前主机有一个旧开发栈占用 84–87，需要用户自行重启才能看到阶段 1 页面。

### 阶段提交

- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
  `feat(phase-1): deliver browser two-player realtime slice`。
- 阶段 1 修复提交：`954155f` `fix(phase-1): reset the command sequence when a client reconnects`
  和 `5f2dbbf` `fix(phase-1): support plain-HTTP LAN origins without secure-context crypto`。

### 下一步计划

1. 等待 Tech Lead 审阅阶段 1 报告与证据。
2. 批准后执行阶段 2：账号、角色、Argon2id、刷新令牌、一次性 game ticket、
   单角色会话租约、角色持久化与角色列表 API。

---

## 2026-11-24 · 阶段 2：账号、角色和连接票据

### 本次任务目标

用真实账号与角色身份替换阶段 1 的开发身份，完成注册/登录/刷新/登出、Argon2id、
角色创建与区服内唯一名称、一次性 game ticket、单角色会话租约、角色位置持久化，
并保持阶段 1 的双人移动与重连能力。只执行阶段 2，不进入阶段 3。

### 开工前检查

- 阅读 AGENTS、PROJECT_STATUS、WORKLOG、架构 v2、MVP 计划 v2、阶段 1 报告、
  ADR-013/015/016。
- `git status` 干净；HEAD `f4b74ff`。
- 数据库已有 `realms` 与 1 条迁移；84–87 被用户已有开发栈占用，阶段 2 的 E2E
  使用 8844–8847（同一套代码，仅端口覆盖）。
- 当前实现与架构一致：阶段 1 仅开发身份；账号/角色/票据/租约均未实现。

### 实施内容

1. **contracts**
   - `auth.ts`：账号/密码/登录/注册 schema、`normalizeUsername`、认证响应；
   - `character.ts`：职业目录、角色名 NFKC + 小写归一、角色视图、创建/列表、
     ticket 请求/响应、60 秒 TTL；
   - `realtime.ts`：join 改为严格 `{protocolVersion, ticket}`；
   - `phase1Map.ts`：Control API 与 Game Server 共享地图/出生点；
   - 扩展 API 错误码。
2. **auth（新包，ADR-013 阶段 2）**
   - Node 26 内置 Argon2id（m=19456,t=2,p=1），PHC 编码与常量时间校验；
   - 256 bit 不透明 access/refresh 令牌与 SHA-256 摘要。
3. **persistence**
   - 新表 accounts、account_sessions、characters、character_sessions、
     game_tickets；迁移 `0001_peaceful_rachel_grey.sql`；
   - 角色名 `(realm_id, name_normalized)` 唯一；
   - 仓储：会话轮换/撤销、角色归属、位置 checkpoint、票据原子消费、租约；
   - `db:seed` 幂等写入 `classic-01`。
4. **control-api**
   - `/auth/register|login|refresh|logout`、`/me`、`/realms`、`/characters*`、
     `/game/ticket`；
   - HttpOnly/SameSite=Lax Cookie，生产 Secure；access 15m / refresh 30d；
   - 旧 refresh token 轮换后立即失效；未知账号占位 Argon2 校验；
   - CSRF Origin 校验、16KB body、认证限频；统一错误 envelope。
5. **game-server**
   - `DATABASE_URL`、`GAME_SERVER_ID`；就绪探针增加数据库；
   - `onAuth` 条件 UPDATE 原子消费票据、读取角色/区服、获取租约；
   - 删除开发身份；入图恢复持久化坐标/朝向；
   - 离开/宽限期/dispose checkpoint 并释放租约；租约 30s、10s 续租。
6. **game-web**
   - 登录/注册、角色选择/创建、世界三段式页面；
   - API 自动 refresh 重试；每次入图取新 ticket；重连 token 绑定角色；
   - 移除 `?name/?key`，保留 DEV-only `?fresh/?join`。
7. **测试**
   - 新增 auth/contracts/cookie/rate-limit origin 单元测试；
   - control-api 认证、轮换、登出、CSRF、限频、角色重名、所有权、ticket、
     API 重启集成测试；
   - game-server 票据/租约/位置恢复/checkpoint/重连/指标集成测试；
   - E2E：注册→建角→双人可见→刷新→重复登录拒绝→断线恢复→Scene 重启→登出→
     局域网 HTTP。
8. **文档**
   - ADR-017；ADR-015 Superseded；ADR-013 实施记录；
   - README、PROJECT_STATUS、阶段 2 报告、数据库证据。

### 关键技术决策

- 采用数据库不透明令牌 + HttpOnly Cookie，而非 JWT；支持即时撤销与轮换。
- Argon2id 使用 Node 26 内置实现，避免原生扩展依赖。
- 票据只存 SHA-256，由 Game Server 用条件 UPDATE 消费，数据库是唯一并发边界。
- 单角色租约采用 `(character_id)` 主键 + 原子插入/条件接管；重复登录拒绝。
- 角色位置在离开时 checkpoint，入图恢复；tick 内无 IO。
- 开发代理保留 Host，Origin 校验允许同 hostname 的端口变化（反向代理）。

### 执行的命令与结果

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm format
pnpm verify
pnpm test
GAME_WEB_PORT=8844 ADMIN_WEB_PORT=8845 CONTROL_API_PORT=8846 GAME_SERVER_PORT=8847 \
  PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
```

结果：

- 迁移 2 条在真实 PostgreSQL 18.3 执行；默认区服写入成功。
- format / lint / typecheck 通过。
- 单元与集成：31 个文件、146 个测试通过（约 4.5s）。
- 构建：4 个应用成功。
- E2E：9/9 通过（约 44s）；双人可见 141ms（完整套件）与 184ms（单独运行）。
- 数据库证据：110 张票据（101 消费/9 过期/0 开放），测试结束 0 活跃租约，
  90 个角色 version > 0。
- 生产门禁：伪造票据与自报身份字段均 525；diagnostics 520。

### 遇到的问题及解决方法

1. **Argon2id 依赖**：Node 26 内置 `crypto.argon2` 可用，避免新增原生包；
   单元测试覆盖 PHC 格式、错误密码与篡改哈希。
2. **Drizzle 唯一冲突被包装**：`isUniqueViolation` 沿 `cause` 链查找 SQLSTATE
   23505，修复重名账号/角色返回 500 的问题。
3. **Vite 代理改写 Host 导致局域网注册 403**：`/api`、`/health`、`/ws` 显式
   `changeOrigin: false`；Origin 校验同 hostname 允许端口变化（反向代理）。
4. **路由注册函数 async 无 await**：改为同步注册，满足 lint。
5. **刷新后不再自动入图**：阶段 2 刷新回到角色选择；E2E 改为再次点击“进入世界”，
   验证 reconnection token 在宽限期内恢复原座位且不重复玩家。
6. **Fastify 泛型与 pino Logger**：路由模块使用显式 `AppServer` 类型，解决
   `exactOptionalPropertyTypes` 下的实例类型不兼容。
7. **共享开发库中的数据冲突**：集成/E2E 使用随机账号与角色名，避免历史数据冲突。

### 尚未解决的问题

- 进程崩溃后租约最长 30 秒仍有效，期间用户会看到“另一台设备”。
- 位置仅在正常离开/dispose 时保存；阶段 3 做节流 checkpoint。
- 票据/会话不自动清理；限频为单进程内存。
- 无密码找回、邮箱验证、MFA。
- 共享开发数据库仍用于集成测试；阶段 5 前建立独立测试库。
- 后台仍无账号/角色管理页面（阶段 7）。
- 前端 bundle 仍较大（Phaser 约 2.1MB）。

### 阶段提交

- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
  主题：`feat(phase-2): deliver accounts, characters and one-time game tickets`。

### 下一步计划

1. 等待 Tech Lead 审阅阶段 2 报告与证据。
2. 批准后执行阶段 3：Tiled 地图、map-runtime、MapTemplate/Instance、主城 ↔ 野外
   传送、AOI、节流 checkpoint、同图聊天与 30 人 tick 指标。

---

## 2026-11-24 · 阶段 2 验收与交接

### 目标

记录阶段 2 的用户验收结果、环境清理与下一次会话的启动约定。

### 验收结果

- 用户在 `http://<LAN-IP>:8584/` 完成注册、创建角色并进入世界，确认测试通过。
- 期间发现并定位 8588 遗留演示栈问题：game-web 88 已热更新到阶段 2，但
  game-server 89 仍是阶段 1 进程，日志为 `ServerError 525: Invalid join options`。
  该演示栈已停止，阶段 2 统一使用 84–87。
- 用户决定保留 PostgreSQL 容器，下一次会话沿用现有数据。

### 环境清理

- 停止 84–87 阶段 2 开发栈、88–89 阶段 1 演示栈、8844–8847 后台 E2E 栈。
- 端口 84–89、8844–8847 均无监听；无残留 vite/tsx/esbuild/pnpm 进程。
- 未修改源码；文档更新后提交。

### 下一步计划

下一次会话直接开始阶段 3：先执行 `pnpm db:migrate`（如有新迁移）并按需
`pnpm db:seed`，启动 84–87 开发栈，把 `http://<LAN-IP>:8584/` 交给用户测试；
然后按阶段 2 报告第 10 节完成 Tiled 地图、map-runtime、地图实例/传送、AOI、
节流 checkpoint 与同图聊天。

---

## 2026-11-24 · 阶段 3：正式地图、服务端移动和世界状态

### 本次任务目标

用真实 Tiled 地图替换阶段 1/2 的技术测试地图，完成地图编译、地图实例与 Room
固定映射、服务端权威寻路/碰撞、主城 ↔ 野外传送、AOI、节流 checkpoint、同图
聊天与 30 人 tick 指标。只执行阶段 3，不进入阶段 4。

### 开工前检查

- 阅读 AGENTS、PROJECT_STATUS、WORKLOG、架构 v2、MVP 计划 v2、阶段 2 报告与
  ADR-017。
- `git status` 干净；HEAD `85badc2`。
- 数据库 2 条迁移；132 个角色仍位于已退役的 `phase1_test_map`。
- 当前实现只有手写技术地图、单 `world_map` Room、无 AOI/传送/聊天；与阶段 3
  计划一致，需要新的架构决策，先写 ADR-018。

### 实施内容

1. **content**
   - 新增 Tiled 正交源图 `starter_town`（40×30）、`starter_wilds`（44×32），
     四个地形/装饰图层与四个对象层（出生、传送、NPC、怪物刷点）。
   - 生成并提交编译产物 `content/maps/compiled/*.json`（checksum、asset 版本）。
   - 新增 `content/assets/manifest.json`、占位 tileset（8 tile）与
     2 帧 × 4 方向角色 SpriteSheet。
2. **contracts**
   - 编译地图 schema、地图 ID、可走判定、room type 编解码、`/maps` 子路径。
   - asset manifest schema。
   - `chat.send`/`chat.message`/`session.transfer`；patch 间隔改为 50ms（20Hz）。
   - `WorldState` 增加 `instanceId`、HP/MP；`players` 集合 `.view()`。
   - 移除阶段 1 技术地图、`mapManifestSchema` 与 `phase1-map` 子路径。
3. **map-runtime（新包）**
   - Tiled 子集 schema；编译必需图层/网格/对象校验；跨图目标与可达性校验；
     SHA-256 checksum；运行时导航格/传送门；`maps:compile` CLI。
   - 9 个测试覆盖真实双图、产物新鲜度、非法图层/出生点/跨图目标/不可达传送门、
     checksum 篡改。
4. **game-simulation**
   - `InterestManager`：8×8 分格、radius 1、加入/离开/跨格增量刷新；
     6 个单元测试。
   - 移除技术地图依赖；移动/寻路测试使用本地夹具。
5. **persistence**
   - `saveCharacterTransfer`（事务写入地图/坐标/朝向/HP/MP）。
   - `relocateCharactersFromMap`（幂等迁移退役地图角色）。
   - 无 schema 变更、无新迁移。
6. **game-server**
   - 每张地图固定 Room：`world_map:<mapId>`；加入时校验角色持久化地图。
   - 编译导航格寻路/碰撞；站立传送门自动传送；传送中拒绝指令。
   - 传送：写库 -> 释放租约 -> 移除旧实体 -> `session.transfer`。
   - 每客户端 `StateView` AOI；离开释放视图。
   - 20 秒节流 checkpoint；离开/宽限期/Dispose 立即保存。
   - 同图聊天：Zod、120 字符、控制字符、4/2s 令牌桶、32 条去重、广播。
   - 指标增加 chat/transfer；30 玩家负载脚本。
7. **control-api**
   - 建角出生点改为 `starter_town` 编译出生点。
   - `repair:maps` 一次性迁移 132 个阶段 2 角色。
8. **game-web**
   - 编译地图 + asset manifest + tileset/角色帧加载。
   - 静态地表合成 RenderTexture；墙体挤出、树冠遮挡、NPC/传送门标记、
     脚底锚点 Sprite、Y 排序、路径预览、摄像机跟随。
   - 传送后重建 Phaser 场景并丢弃旧快照。
   - HUD 地图名/ID、HP/MP、附近玩家、聊天、tick；调试钩子增加传送与诊断。
9. **测试**
   - 新增地图编译、AOI、聊天、传送、AOI 集成、节流 checkpoint、错误地图加入、
     真实浏览器传送/聊天/撞墙测试。
   - 适配阶段 1/2 测试到新地图与新 room type。
10. **文档**
    - ADR-018；AGENTS/README；阶段 3 报告、PROJECT_STATUS、本日志与证据。

### 关键技术决策

- 地图源文件采用正交逻辑网格，伪等距投影只在客户端；逻辑与表现解耦。
- 编译产物是运行时唯一信任的地图数据；checksum 不匹配拒绝启动。
- 每张地图模板在 MVP 只有一个固定实例；room type 携带 mapId。
- 客户端不能选图；角色持久化 `map_id` 决定加入哪个 Room。
- 传送由服务端站立触发：先提交、再移除、再通知，避免双实体。
- AOI 用格子兴趣 + Colyseus `StateView`；`players` 集合必须 `.view()` 才可过滤。
- checkpoint 20 秒；地图只在传送事务中变化。
- patch 20Hz（架构初始 10Hz）以满足 250ms 可见性门禁；阶段 8 重新评估带宽。

### 执行的命令与结果

```bash
pnpm install
pnpm maps:compile
pnpm db:migrate
pnpm db:seed
pnpm repair:maps
pnpm format
pnpm verify
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
pnpm load:world
```

结果：

- 2 张地图编译成功；产物新鲜度测试通过。
- 迁移 2 条；区服 seed 成功；132 个角色迁移到主城。
- format / lint / typecheck 通过；33 个文件、167 个测试通过（约 6.3s）。
- 4 个应用构建成功。
- E2E 12/12 通过（约 1.1 分钟）；点击 → 远端 DOM 139ms，首个 moving 快照
  101ms，服务端 ack 85ms；rAF 24/22 FPS（软件渲染）。
- 30 人负载：30/30 加入、750 条移动接受、0 拒绝、tick p50 0.15ms、
  p95 1.53ms、p99 2.20ms、max 3.11ms。
- 数据库：2 条迁移、6 张表、481 个角色 `version > 0`、0 个活跃租约、
  0 张未消费未过期票据。

### 遇到的问题及解决方法

1. **AOI 未过滤**：完全公开的 `players` 集合不会被 `StateView` 过滤；改为
   `t.map(PlayerState).view()`，并用集成测试锁定远处玩家不可见。
2. **250ms 可见性抖动（248–273ms）**：诊断为软件渲染下 rAF 约 13 FPS，WebSocket
   回调被慢帧延迟。将静态地表/低层装饰合成到单个 RenderTexture，启用
   nearest/`pixelArt`/关闭抗锯齿，并把 patch 调到 20Hz；修复后 rAF 22–27，
   完整套件 139ms。
3. **Node fetch 拒绝 87 端口**：Colyseus SDK matchmaking 使用 fetch，87 是 WHATWG
   bad port。负载客户端改走 Vite `/ws` 代理，`/metrics` 用 `node:http` 读取。
4. **随机负载穿过传送门**：1–2 个虚拟玩家被传送，房间人数不符。负载移动限定在
   可达且传送门以西的区域。
5. **E2E 撞墙点选到建筑内部**：(31,5) 是可走石地板；改用外墙 (30,5)。
6. **阶段 2 角色无法进入新地图**：新增幂等 `pnpm repair:maps` 迁移 132 个角色。
7. **`client.view = undefined` 与 exactOptionalPropertyTypes**：改为
   `delete client.view`。
8. **Lint 细节**：未绑定 Zod parse、控制字符正则、contracts 测试中的 node:crypto
   类型解析问题，逐一修正。
9. **地图产物过期风险**：编译测试重新生成并与提交产物逐字段比较。

### 尚未解决的问题

- 每张地图单固定实例；无多线路/Room drain。
- 传送为离开/重新加入，非无缝迁移；无传送回执重试。
- 聊天无过滤/频道/持久化。
- 50 人 10 分钟压测、patch bytes、带宽未测。
- NPC/怪物刷点只有数据；怪物与战斗在阶段 4。
- 占位美术与软件渲染帧率；正式资源与目标机器渲染在后续阶段。
- 集成/E2E/负载继续使用共享开发库。

### 阶段提交

- 阶段 3 主提交：`80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
  主题：`feat(phase-3): deliver compiled maps, AOI, transfers and chat`。

### 下一步计划

1. 等待 Tech Lead 审阅阶段 3 报告与证据。
2. 批准后执行阶段 4：`game-domain` 战斗纯函数、两种怪物与刷点、服务端 RNG、
   战士普攻/技能、CombatEvent、死亡与刷新、双浏览器一致性测试。
3. 保持阶段 3 的 AOI、传送、租约、checkpoint、聊天测试为回归门禁。

---

## 2026-11-24 · 阶段 3 验收与交接

### 目标

记录阶段 3 的用户验收结果与阶段 4 的启动约定。

### 验收结果

- 用户在 `http://<LAN-IP>:8584/` 完成阶段 3 验收，确认通过。
- 验收覆盖：Tiled 主城/野外渲染、点击移动、双向传送、AOI 可见性、同图聊天、
  断线重连与租约回归。
- 验收期间未修改源码；阶段 3 主提交 `80cb003aa2cdd3767c5ec62a9914c52cd26f6cca`
  保持不变。

### 环境状态

- 84–87 开发栈保持运行，`8584` 继续提供给用户测试。
- PostgreSQL 数据保留；阶段 2 的 132 个角色已迁移到主城出生点。
- 当前工作区干净，HEAD 为 `docs(phase-3)` 提交。

### 下一步计划

1. 启动阶段 4：怪物、战斗和技能。
2. 先定义 `game-domain` 战斗纯函数、怪物/刷点内容 schema 与 CombatEvent 契约，
   再实现服务端 RNG、怪物 FSM、战士普攻/技能和死亡/刷新。
3. 保持阶段 3 的 AOI、传送、租约、checkpoint、聊天测试为回归门禁。

---

## 2026-11-24 · 阶段 4：怪物、战斗和技能

### 目标

交付第一条服务端权威 PvE 链路：`game-domain` 战斗纯函数、两种怪物与刷点、
怪物 FSM、服务端 RNG、三职业技能、CombatEvent、死亡/刷新、玩家复活与双浏览器
一致性测试；不跨入经验/掉落/背包。

### 开工前状态

- HEAD `fa708d0`，工作区干净；阶段 3 已由用户验收。
- 无 `game-domain`、无战斗命令/事件、无技能/冷却、无怪物实体；野外只有 2 个刷点。
- 结论：阶段 4 目标全部未实现；先写 ADR-019 固定战斗边界。

### 实际改动

1. **ADR-019 + 边界**
   - 新建 `@web-legend/game-domain`，只依赖 contracts；导航格、寻路、RNG、
     复活点由 Room 注入。
   - AGENTS、ESLint、README 同步包边界。
2. **contracts**
   - `combat.basicAttack`、`skill.cast`、`combat.event`、`combat.profile`；
     7 种战斗事件；5 个战斗错误码与 `retryAfterMs`。
   - 玩家 `classId`/`level`/`alive`；`.view()` 的 `monsters` 与 `MonsterState`。
3. **game-domain**
   - `combatStatsFor`、`rollAttack`（固定 3 次 RNG）、技能/怪物目录。
   - `CombatWorld`：玩家 HP/MP/冷却、怪物 FSM、追击/脱战/巡逻、死亡/重生、
     玩家死亡复活、断线不可被选中。
   - 领域测试覆盖伤害/暴击/冷却/法力/距离/治疗/FSM/回放。
4. **内容与地图**
   - 野外刷点 2 → 6（3 史莱姆 + 3 森林狼），重新编译并格式化产物。
5. **game-simulation**
   - `WorldSimulation.setPosition`：复活传送并校验可走格。
6. **game-server**
   - Room 创建 `CombatWorld`，加入时移交职业/等级/HP/MP；HP 0 角色满状态复活。
   - 战斗命令统一管线：会话/协议/命令 ID 去重/序号/限频/领域结果/事件广播。
   - 重复 commandId 重发原事件；断线宽限期不可被选中。
   - 每 tick 同步玩家 HP/MP/存活与怪物状态；怪物共用 AOI。
   - 传送/checkpoint 读取战斗世界 HP/MP；指标增加战斗命令/事件/击杀/死亡。
   - 7 个真实 PostgreSQL + Colyseus 战斗集成测试。
7. **game-web**
   - 怪物渲染、血条、点击选怪/普攻、选中环与摄像机上移 200px。
   - 目标面板、附近怪物、技能栏（MP/冷却/快捷键 1）、战斗记录、死亡遮罩。
   - 伤害/暴击/闪避/治疗浮字、技能弹道/治疗环、受击/死亡/重生表现。
   - 战斗日志按 eventId 去重；冷却只由服务端攻击事件触发。
8. **测试与证据**
   - 契约/领域/集成/E2E；回放摘要、指标、数据库、负载、截图与阶段 3 回归证据。
9. **文档**
   - 阶段 4 报告、PROJECT_STATUS、WORKLOG、README、ADR 索引。

### 关键技术决策

- 战斗领域与怪物运行时归 `game-domain`，Room 只做适配（ADR-019）。
- 每次攻击固定消耗 3 个 RNG，命中与否不改变后续序列，回放可复现。
- 命令幂等按 commandId 重发原事件，客户端按 eventId 去重。
- 怪物与玩家共用 `InterestManager` 和 `.view()`。
- 玩家死亡 3 秒后在同地图首个出生点满状态复活；经验/掉落延后阶段 5。
- 断线玩家保留状态但不可被怪物选中。
- 摄像机上移 200px，避免底部战斗 HUD 遮挡近身目标。

### 执行的命令与结果

```bash
pnpm install
pnpm maps:compile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
pnpm load:world
```

结果：

- 格式 / lint / typecheck 通过；40 个文件、211 个测试通过（约 11.9s）。
- 4 个应用构建成功；地图 2 张、野外 6 个刷点。
- E2E 13/13 通过（约 1.1 分钟），新增双人战斗测试 29.5s。
- 30 人主城负载：30/30、750 接受、0 拒绝、tick p50 0.12ms、p95 0.96ms、
  p99 1.37ms、max 1.77ms、230 样本。
- E2E 后指标：14 房间、4 战斗命令、18 战斗事件、1 击杀、0 玩家死亡。
- 数据库：2 迁移、6 表、784 主城 + 98 野外角色、824 个 `version > 0`、
  0 活跃租约；无新迁移。
- 回放：14 攻击、13 命中、1 闪避、2 死亡、1 重生，seed 固定可复现。

### 遇到的问题及解决方法

1. **底部战斗 HUD 遮挡近身怪物**：E2E 点击落在 `.panel-heading`；摄像机焦点
   上移 200px，使玩家与近身怪物位于 HUD 之上。
2. **点击时角色尚未到达目标格**：等待自身权威 tile 与摄像机稳定后再点击。
3. **两人站位过远**：怪物追击一人后另一人超出射程；两人都站到刷点上并用真实
   攻击重试确认 HP 变化。
4. **击杀未计入指标**：命令路径的死亡事件未经过 tick 统计；抽出
   `recordCombatOutcomes` 供两条路径共用。
5. **宽限期玩家被怪物击杀**：增加 `setPlayerTargetable`，断线取消被选资格。
6. **编译产物格式化抖动**：`maps:compile` 后执行 `pnpm format`。
7. **负载脚本 SDK 告警**：消费 `combat.profile`。

### 尚未解决的问题

- 经验、等级成长、击杀奖励、掉落、背包、装备、金币（阶段 5）。
- PK、安全区、复活惩罚与聊天过滤（阶段 6）。
- CombatEvent 全 Room 广播、无实体碰撞、无 Buff/范围伤害/投射物实体。
- 战斗负载、patch bytes、50 人容量（阶段 8）。
- 内容目录仍在代码中，后台不可编辑（阶段 7）。
- 占位怪物/技能表现与无音效。

### 阶段提交

- 阶段 4 主提交：`cb3617bc5a1396df89661f206a0b9e0562fbe23e`
  主题：`feat(phase-4): deliver monsters, combat and skills`。

### 下一步计划

1. 用户在 8584 实测阶段 4：野外选怪、普攻、技能、冷却、双人同一 HP、死亡与
   8 秒重生。
2. 验收通过后启动阶段 5：物品/掉落/背包/装备/金币/经验事务与崩溃恢复。
3. 保持阶段 3 与阶段 4 的测试为回归门禁。

---

## 2026-11-25 · 阶段 5：掉落、背包、装备和资产持久化

### 目标

交付“击杀 → 掉落 → 拾取 → 穿戴 → 成长 → 重登恢复”的真实服务端权威闭环：
物品/掉落/经验/金币/背包/装备的事务用例、地面掉落与归属、公开掉落状态与私有
资产状态分离、客户端背包与装备 UI、真实 PostgreSQL 并发与幂等测试。不跨入
PK、安全区、运营后台与内容发布。

### 开工前状态

- HEAD `de71d05`，工作区干净；阶段 0–3 已由用户验收，阶段 4 自动化验收完成但
  未单独记录手工验收结论。
- 没有 `game-application`，没有物品/掉落/背包/金币表与命令，击杀只产生死亡事件。
- 结论：阶段 5 目标全部未实现；本次按用户“继续研发下一阶段”的指示启动阶段 5，
  先写 ADR-020 固定资产与事务边界。

### 实际改动

1. **ADR-020 + 包边界**
   - 新建 `@web-legend/game-application`，只组合 contracts、game-domain、
     persistence；ESLint 增加边界，浏览器不可导入。
   - `control-api` 增加对 `game-domain` 的依赖（职业初始装备目录）；AGENTS、
     README 同步。
2. **contracts**
   - 4 条客户端资产命令、5 条私有/公开结果消息、物品/背包/装备/进度/掉落 schema。
   - `WorldState.loot` 公开集合（AOI 过滤）；11 个资产拒绝码；`phase5.1` 内容版本。
3. **game-domain**
   - 物品目录、职业初始装备、掉落表、经验曲线、背包放置、装备规则与属性加成。
   - `CombatWorld` 支持注入装备后属性、升级/装备后的属性更新、药水 HP/MP 写回。
   - 物品/掉落/进度/CombatWorld 新增测试；固定 RNG 抽取次数。
4. **persistence**
   - `item_instances`（inventory/equipment/ground 单一位置 + CHECK）、
     `world_drops`、`wallets`、`currency_ledger`、`asset_commands`。
   - 迁移 `0002` 建表/索引、`0003` 将装备槽唯一索引改为普通索引（交换装备需要
     瞬时中间态，唯一性由角色行锁保证）。
   - 背包/装备/掉落查询仓储；`insertCharacterWithItems` 事务创建角色和初始装备。
5. **game-application**
   - `AssetService`：击杀奖励、拾取、装备、卸下、使用、资产快照。
   - 单事务 + 幂等键 + 行锁；金币钱包与账本同事务；升级跨级与回满；地面掉落
     归属 30 秒、过期 120 秒。
   - 10 个真实 PostgreSQL 集成测试，覆盖重复发奖、并发拾取、背包满、装备交换、
     职业/等级限制、药水幂等、重登快照。
6. **game-server**
   - 加入时加载资产与装备后属性并注入 `CombatWorld`；私有快照在握手后发送。
   - 死亡事件进入异步资产队列，tick 不等待 SQL；提交后发进度/升级、生成掉落、
     加入 AOI；失败退避重试 3 次。
   - 统一资产命令管线：会话/协议/幂等/序号/限频/范围/存活校验，提交后 ACK。
   - Room 创建恢复未过期掉落；每秒清理过期掉落；指标增加资产/掉落/金币/经验。
   - 2 个真实 PostgreSQL + Colyseus 集成测试。
7. **control-api**
   - 创建角色与职业初始武器/药水同事务提交。
8. **game-web**
   - 经验条、金币、等级、附近掉落列表、背包/装备面板（B）、装备/卸下/使用、
     升级提示、拾取日志；场景掉落标记与 AOI 同步。
   - 点击优先攻击存活怪物，掉落列表始终可拾取。
   - 退出世界后重新拉取角色列表，修复传送后用旧 mapId 重新入图的问题。
9. **测试与证据**
   - 掉落回放 JSON、E2E 截图、指标、数据库、负载与阶段 4 回归。
10. **文档**

- 阶段 5 报告、PROJECT_STATUS、WORKLOG、README、ADR 索引、AGENTS。

### 关键技术决策

- 物品实例用单一 `container` 字段表达唯一归属；地面掉落与背包行不能同时存在。
- 所有资产命令共享 `asset_commands` 幂等表；击杀奖励另用唯一 kill reference。
- 击杀奖励在异步队列中提交，tick 只入队；提交后才发进度并创建公开掉落。
- 装备交换在角色行锁下完成；不使用立即唯一索引，因为 swap 必然经过瞬时重复槽。
- 掉落恢复按地图加载所有未过期记录（MVP 每图单 Room）。
- 有效属性 = 等级基础 + 装备加成，由 application 计算并注入领域世界。
- 药水以 Room 当前权威 HP/MP 为输入，而不是可能落后的 checkpoint。
- 客户端只收到自己的背包/金币/进度；公开状态只有掉落。

### 执行的命令与结果

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
pnpm load:world
```

结果：

- 格式 / lint / typecheck 通过（14 个 workspace）。
- 46 个测试文件、253 个测试通过（约 12.1s）。
- 4 个应用构建成功。
- E2E 14/14 通过（约 1.2 分钟）；新增经济 E2E 30.3s。
- 30 人主城负载：30/30、750 接受、0 拒绝、tick p50 0.17ms、p95 1.61ms、
  p99 2.59ms、max 3.26ms。
- 指标：8 条资产命令、0 次资产失败、7 件掉落、4 次拾取、19 金币、84 经验。
- 数据库：4 条迁移、11 张表、1246 角色、652 背包实例、19 装备实例、
  63 地面实例、44 钱包、44 条账本（余额 95 = 流水 95）、0 活跃租约。

### 遇到的问题及解决方法

1. **装备交换触发立即唯一索引**：先装备新武器时旧武器仍在同槽。将装备槽唯一
   索引改为普通索引，并由角色行锁保证唯一性；新增迁移 0003。
2. **共享库残留掉落污染测试**：Room 恢复未过期掉落，经济测试读到其他测试的
   掉落。测试按 `ownerId` 过滤；经济 E2E 使用 `wilds_slime_1`，战斗 E2E 使用
   `wilds_slime_2`，避免并行套件争抢同一怪物。
3. **掉落标记拦截怪物点击**：掉落与怪物重叠时 canvas 点击命中掉落，战斗 E2E
   无法选中目标。改为存活怪物优先，掉落从 HUD 列表拾取。
4. **退出重进使用旧 mapId**：角色列表未刷新，重进加入主城 Room 被服务端拒绝。
   退出世界后重新请求 `/me`，角色卡暴露 `data-map-id` 供 E2E 等待。
5. **auth 密码测试偶发失败**：篡改 base64 末位只影响填充位，可能解码出相同
   hash。改为篡改派生密钥首位（测试修复，不降低断言）。
6. **测试进程 Node 版本**：命令行默认 Node 24，项目要求 26；统一使用 nvm 26.13.1
   运行质量门禁。
7. **Colyseus 消息警告**：负载脚本未注册 `inventory.snapshot`；补充空处理器。

### 尚未解决的问题

- 独立测试数据库仍未建立；集成/E2E 继续使用共享开发库。
- 过期未领取掉落与 `asset_commands` 没有定期清理。
- 击杀奖励数据库长时间不可用时只重试 3 次。
- 装备不改变角色外观；没有物品图标、背包整理/丢弃/出售。
- PK、安全区、聊天过滤（阶段 6）与后台内容发布（阶段 7）。
- 50 人 10 分钟压测、patch bytes、崩溃恢复演练（阶段 8）。

### 阶段提交

- 阶段 5 主提交：`c5cc9e001772b2fa808f16f2a130ea46c5d441cc`
  主题：`feat(phase-5): deliver loot, inventory, equipment and persistent economy`。

### 下一步计划

1. 用户在 `http://<LAN-IP>:8584/` 实测阶段 5：击杀、掉落、拾取、装备、药水、
   升级与重登恢复。
2. 验收通过后启动阶段 6：PK、安全区、复活规则、聊天过滤/频道与体验完善。
3. 保持阶段 1–5 的测试为回归门禁；阶段 6 前评估独立测试库与数据清理。

---

## 2026-11-25 · 阶段 6：聊天、PK 和游戏体验完善

### 目标

交付服务端权威的主城安全区、野外基础 PvP、死亡倒计时与复活、同图聊天过滤与
系统消息、玩家 HUD/小地图/角色面板，以及加载/断线/重连/错误状态；不进入运营
后台、内容发布、压测与正式美术/音频资源管线。

### 开工前状态

- HEAD `ccbb5c1`，工作区干净；阶段 0–3 已由用户验收，阶段 4/5 自动化验收完成
  但未单独记录手工验收结论。
- 战斗目标只有怪物；地图 manifest 没有 PvP 规则；聊天只有长度/控制字符/限频，
  没有内容过滤与系统消息；玩家 HUD 没有玩家 HP 条、小地图或角色面板。
- 结论：阶段 6 目标全部未实现；本次按用户“继续研发下一阶段”的指示启动阶段 6，
  先写 ADR-021 固定安全区与聊天边界。

### 实际改动

1. **契约与地图内容**
   - `MapRuntimeManifest` 增加 `pvpMode`，schema 升到 2；编译按 `kind` 生成
     town `none`、wilds `open`，并纳入 checksum。
   - `combat.profile` 增加 `pvpEnabled/reviveMs`；`death` 增加 `reviveInMs`；
     新增 `SAFE_ZONE`、`CHAT_BLOCKED` 拒绝码。
   - 两张编译地图重新生成并格式化。
2. **game-domain**
   - `CombatWorld` 支持玩家目标普攻/伤害技能、安全区/自伤/死亡/断线/超距校验、
     玩家死亡/复活事件；PvP 无经验、金币、掉落。
   - 新增 `ChatFilter` 纯函数（NFKC 匹配、保留原始标点、链接/交易引流/刷屏规则、
     可注入规则集）。
3. **game-server**
   - Room 读取编译地图 `pvpMode` 注入战斗世界；客户端无法伪造区域/坐标。
   - 聊天过滤在限频与幂等后执行；拦截只提示发送者，不广播。
   - 系统消息覆盖加入/离开、PvP/PvE 死亡、升级；指标增加 `chatFiltered`、
     `pvpKills`。
   - 新增 3 个真实 PostgreSQL + Colyseus 集成测试；负载脚本补充
     `system.notice` 空处理器。
4. **game-web**
   - 玩家目标点击/列表攻击、玩家头顶等级与 HP 条、目标面板玩家信息。
   - 小地图、角色面板（`C`）、安全区/野外标识、复活倒计时、连接覆盖层。
   - WebAudio 合成占位音效与开关。
5. **测试与证据**
   - 领域/契约/地图/服务端/浏览器测试；阶段 6 截图、负载、数据库、指标。
6. **文档**
   - ADR-021、AGENTS、README、PROJECT_STATUS、WORKLOG、阶段 6 报告。

### 关键技术决策

- 安全区编译进不可变地图产物；服务端只信任自己绑定的 `pvpMode`。
- PvP 复用 `rollAttack` 与固定 RNG 抽取，玩家与怪物共享同一套伤害公式。
- 死亡倒计时是事件字段；复活时间与位置由服务端决定，客户端只显示。
- 聊天过滤是纯领域函数；Room 只负责身份、限频、发送。
- 系统消息独立于玩家聊天，不伪造 playerId。
- 音效使用 WebAudio 合成占位，不引用不存在的音频资源。

### 执行的命令与结果

```bash
pnpm maps:compile
pnpm typecheck
pnpm test
pnpm lint
pnpm build
GAME_WEB_PORT=5184 ADMIN_WEB_PORT=5185 CONTROL_API_PORT=3086 GAME_SERVER_PORT=2587 \
  NO_PROXY=127.0.0.1,localhost pnpm exec playwright test
pnpm load:world
```

结果：

- 格式 / lint / typecheck 通过（14 个 workspace）。
- 48 个测试文件、270 个测试通过（约 12.2s）。
- 17 个 Playwright E2E 通过（约 1.3 分钟，隔离端口）。
- 4 个应用构建成功。
- 30 人主城负载：30/30、750 接受、0 拒绝、tick p50 0.16ms、p95 1.03ms、
  p99 1.72ms、max 2.27ms。
- 数据库：4 条迁移、11 张表、1501 角色、1049 背包实例、30 装备实例、101 地面
  实例、130 地面掉落、72 钱包、75 账本流水、166 资产命令、0 活跃租约；
  钱包余额与流水不一致 0。

### 遇到的问题及解决方法

1. **E2E 双玩家不在同一主城房间**：`?fresh=1` 让每个客户端 `create` 新房间，
   城镇安全区测试彼此不可见。新增 `joinWorld`：第二名玩家注册后跳到
   `?join=<roomId>` 再加入；野外传送仍使用 `joinOrCreate`。
2. **PvP E2E 击杀耗时**：Lv.1 战士约 8 点伤害对 120 HP，需要十余次攻击；循环
   放宽到 24 次并等待 `data-alive=false`，测试约 37 秒完成。
3. **领域测试怪物干扰**：决斗夹具放在默认史莱姆刷点上，怪物攻击导致目标回满
   并位移。把决斗位置移到 `(12,12)/(13,12)`，远离刷点。
4. **死亡后立即断言失败**：测试服务 400ms 复活，死亡断言前角色已复活；改为
   1.5 秒复活并分阶段断言。
5. **负载 SDK 警告**：新增 `system.notice` 后负载客户端未注册处理器；补充空
   处理器。
6. **E2E 端口与代理**：84–87 正被用户实测栈占用，使用 5184/5185/3086/2587
   隔离运行；本机代理导致 Playwright 就绪探测 502，设置
   `NO_PROXY=127.0.0.1,localhost` 并保证 Vite 以 workspace 脚本启动。
7. **开发栈代码过期**：tsx 无 watch；收尾时重启 game-server/control-api，Vite
   保持轮询热更新，84–87 现运行阶段 6 代码。
8. **250ms 可见性测试一次抖动**：首次全量并行运行得到 424ms（6 个浏览器、软件
   渲染、新增小地图）；单独运行与第二次全量运行均通过。未降低断言；如再次出现，
   阶段 8 应固定机器负载并评估小地图增量渲染。

### 尚未解决的问题

- 红名/爆装/罪恶值/死亡惩罚/竞技匹配与野外局部安全区（MVP 不做）。
- 聊天频道、持久化、人工审核、敏感词热更新、禁言/举报。
- 正式音效/音乐与美术资源；当前为合成占位音与占位美术。
- 独立测试数据库、过期掉落/资产命令清理仍属阶段 7/8。
- PvP 数值尚未平衡；阶段 8 压测与内容发布后调参。

### 阶段提交

- 阶段 6 主提交：`029d2da`
  主题：`feat(phase-6): deliver pvp, safe zones, chat moderation and hud polish`。

### 下一步计划

1. 用户在 `http://<LAN-IP>:8584/` 实测阶段 6：主城拒绝、野外 PvP、死亡复活、
   小地图/角色面板/音效、聊天过滤/限频、重连。
2. 验收通过后启动阶段 7：运营后台、RBAC、Outbox、内容 Draft/Release/回滚与审计。
3. 保持阶段 1–6 测试为回归门禁；阶段 7 前评估独立测试库与数据清理。

---

## 2026-11-25 · 阶段 7：运营后台与内容发布

### 目标

把项目从“开发者能玩”推进到“运营人员可以管理和更新”：交付独立管理员身份与
RBAC、总览/玩家/Room/审计/运营指令、Kick/Ban/Mute 的审计 + PostgreSQL Outbox
可靠投递、Game Server 按 commandId 幂等执行，以及内容 Draft → 校验 → 不可变
Release → 按区服激活/回滚。不进入阶段 8 的压测、部署与恢复。

### 开工前状态

- HEAD `c2ca247`，工作区干净；阶段 0–3 已由用户验收，阶段 4–6 自动化验收完成。
- 运营后台仍是阶段 0 的静态状态页；没有管理员身份、审计、Outbox、内容 schema
  或 Release；数值写死在 `game-domain`；Game Server 没有受信内部端点。
- 结论：阶段 7 目标全部未实现；按用户“继续研发下一阶段”的指示启动，先写
  ADR-022 固定身份、Outbox、内容发布与版本固定边界。

### 实际改动

1. **ADR 与边界**
   - 新增 ADR-022：管理员身份分离、RBAC、审计 + Outbox、不可变 Release、
     Room 创建时固定内容、单活跃区服限制。
   - AGENTS/ESLint：新增 `content-schema` 包；`game-domain` 允许依赖
     `content-schema/base`；`admin-web` 仍只依赖 contracts；禁止修改/删除
     Release、审计与激活历史。
2. **contracts**
   - 管理员角色/权限矩阵、登录/会话 DTO、总览/玩家/Room/审计/指令查询、
     草稿/校验/Release/激活 DTO、内部 Kick/Ban/Mute envelope。
   - 内容 bundle schema（职业、技能、怪物、物品、掉落表），effect handler
     白名单；`WorldState` 增加内容版本/checksum；新增 `session.kicked`。
3. **content-schema（新包）**
   - 基线 bundle、schema + 引用/范围/刷点校验、稳定 JSON checksum、差异、
     草稿合并与版本号；12 个测试。
4. **game-domain / game-application**
   - 删除写死目录，改为消费 `ContentBundle`；`CombatWorld`、属性、物品、掉落
     规则和 `AssetService` 支持 Room 注入；默认使用基线。
   - 新增内容注入测试。
5. **persistence**
   - 8 张新表 + `accounts.muted_until`；迁移 0004；迁移 0005 为审计/Release/
     激活历史增加 append-only 触发器。
   - 管理员/审计/Outbox/内容仓储、玩家服务端分页、Outbox 状态统计。
6. **control-api**
   - 管理员登录/Cookie/RBAC；总览、玩家、Room、审计、运营指令 API。
   - Kick/Ban/Mute 同事务写审计 + Outbox；Ban/Mute 持久化账号状态；失败也审计。
   - Outbox dispatcher：SKIP LOCKED、stale 重投、退避、4xx 直接失败。
   - 内容草稿/校验/发布/激活/回滚，发布与激活写审计；创建角色使用激活内容。
   - `node:http` 内部客户端避开 87 端口 fetch 限制。
7. **game-server**
   - 内容 Store 周期读取激活 Release；Room `onCreate` 固定快照。
   - 内部状态/命令端点（共享令牌）；commandId 幂等；Kick/Ban/Mute；封禁/禁言
     在登录时校验；`chatMuted` 指标。
8. **game-web**
   - 处理 `session.kicked`，显示被踢/封禁覆盖层与原因。
9. **admin-web**
   - 自定义深色运营工作台：登录、总览、玩家、世界/Room、内容工作台、发布中心、
     审计、运营指令；服务端分页/筛选、危险操作原因与影响、校验问题/差异。
10. **测试与证据**
    - 新增契约、content-schema、领域/应用、Control API、Game Server 测试；
      E2E 新增管理员总览/Kick/审计与内容发布/激活/回滚。
    - 截图、负载、数据库、指标写入 `docs/phase-reports/phase-07/`。
11. **文档**
    - ADR-022、AGENTS、README、PROJECT_STATUS、WORKLOG、阶段 7 报告。

### 关键技术决策

- 管理员身份与玩家账号完全分离；后台 Cookie Path 限定 `/api/v1/admin`。
- 运营动作先写 PostgreSQL 审计 + Outbox，再由 dispatcher 投递；HTTP 只是传输。
- Game Server 按 commandId 去重；重复投递返回 duplicate，不重复执行。
- Ban/Mute 的持久状态由 Control API 事务写入；Kick 只是在线会话动作。
- 内容 Release 不可变；回滚是新的激活记录；数据库触发器拒绝 UPDATE/DELETE。
- Game Server 只在 Room 创建时取内容快照；新 Room 用新版本，旧 Room 不变。
- 内容数据与行为分离：后台只提交结构化数值，effect handler 必须在代码中。
- 单活跃区服下 Room 未绑定 Realm；阶段 8 必须显式绑定，不能默认多区服可用。
- Playwright 默认 2 worker，避免软件渲染下的时序抖动；可用环境变量覆盖。

### 执行的命令与结果

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm exec playwright test --workers=2
pnpm load:world
```

结果：

- 格式 / lint / typecheck 通过（根配置 + 15 个 workspace）。
- 53 个测试文件、307 个测试通过（约 12.4s）。
- 4 个应用构建成功；admin-web bundle 较大（1.36MB，阶段 8 评估拆包）。
- 20 个 Playwright E2E 通过（2 workers，约 1.9 分钟）。
- 30 人主城负载：30/30、750 接受、0 拒绝、tick p50 0.1ms、p95 1.13ms、
  p99 1.67ms、max 1.93ms。
- 数据库：6 条迁移、19 张表、2131 账号、1989 角色、2359 物品实例、130 钱包、
  114 条审计（98 成功/16 失败）、24 条 Outbox（全部 applied）、17 个 Release、
  31 条激活、激活内容 baseline；钱包/流水不一致 0。

### 遇到的问题及解决方法

1. **game-domain 引入 node:crypto**：content-schema 的 checksum 使用
   `node:crypto`，而 game-domain 没有 Node 类型。拆分 `content-schema/base`
   子路径，game-domain 只导入基线数据，服务端工具仍留在主入口。
2. **Zod record 枚举键**：`z.record(characterClassSchema, ...)` 在 Zod 4 中要求
   所有职业键，正好符合“职业必须完整”的约束；技能/怪物/物品使用 string 键。
3. **Outbox 状态机**：dispatcher 先标记 dispatched 再 HTTP 投递；崩溃后会卡在
   dispatched，增加 60 秒 stale 重投。4xx 视为不可重试，网络/5xx 指数退避。
4. **Ban/Mute 目标**：Outbox 目标使用 account id（Ban/Mute 是账号级），审计目标
   仍记录角色 id 方便运营理解；Kick 使用角色 id。
5. **失败审计**：写操作在参数校验/权限/目标校验失败时也写入 failed 审计；服务
   层集中做 RBAC，避免路由预检查绕过审计。
6. **Game Server 87 端口**：Control API 不能使用 `fetch`（WHATWG bad port），
   改用 `node:http` 的内部客户端。
7. **E2E 角色名超长**：新辅助函数使用 9 字符前缀 + 6 字符 token，超过 12 字符；
   改为截断到 12。
8. **AntD 两字按钮可访问名**：`激活` 被渲染为“激 活”，Playwright 精确名称
   匹配失败；改用正则 `/激\s*活/`。
9. **抽屉遮挡导航**：Kick 后抽屉仍打开，遮罩拦截导航点击；测试先点抽屉关闭。
10. **RPC/内容版本测试**：为避免与其它文件共享数据库的激活操作竞争，新增
    `ContentProvider` 接口，用内存 fake 在 Game Server 集成测试中证明“新 Room
    使用新快照、旧 Room 保持旧快照”。
11. **E2E 并行抖动**：7/4 worker 下出现 250ms 可见性 279ms 和攻击循环未击杀；
    默认降到 2 worker，并把经济测试攻击循环放宽到 20 次/1000ms。未降低断言。
12. **旧阶段截图被 E2E 重新生成**：执行完整回归会重写阶段 3–6 证据截图；已用
    `git checkout` 恢复旧证据，只提交阶段 7 证据。
13. **旧开发进程占用 84–87**：停止上一会话遗留的 Vite/tsx 进程后重新启动
    84–87；当前栈运行本阶段代码。
14. **局域网后台登录报 Request origin is not allowed**：admin-web 的 Vite
    `/api`/`/health` 代理使用字符串简写，转发的 Host 被改写为 `127.0.0.1:86`，
    Control API 的 CSRF Origin 同源判断因此拒绝 `http://<LAN-IP>:8585`。改为
    `{ changeOrigin: false }` 保留浏览器 Host；用 LAN Origin 直接请求登录返回
    200。
15. **被踢后弹窗一直存在**：`session.kicked` 写入的 `kicked` 状态在点击“重新
    加入”后没有清除，覆盖层一直挡住页面。`rejoin()`/`leave()` 和连接成功回调
    现在都会清空 `kicked`；E2E 增加“被踢 → 点击重新加入 → 覆盖层消失 →
    connected”断言并通过。
16. **共享野外房间导致 portal E2E 抖动**：阶段 3 的传送测试断言野外
    `player-count=1`，用户实测时另一个角色在野外会让断言失败。重复检测改为
    “自己的角色恰好 1 个”，总人数允许 ≥1；回到新建主城房间仍断言 1。

### 尚未解决的问题

- 多区服内容未绑定 Room；当前只使用默认活跃区服。
- 内容工作台是 JSON section 编辑器，不是逐字段表单；无审批流/按人草稿。
- 独立测试库、审计/Outbox/Release 归档、过期数据清理仍未建立。
- 后台无 refresh token/MFA；禁言历史与申诉未实现。
- 正式美术/音效、压测/部署/恢复演练属于阶段 8。

### 阶段提交

- 阶段 7 主提交：`23ee461c0d196217cf2b192e3893fb59db8a6bea`
  主题：`feat(phase-7): deliver admin console, outbox operations and content releases`。

### 下一步计划

1. 用户在 `http://<LAN-IP>:8584/` 与 `http://<LAN-IP>:8585/` 实测阶段 7，并
   回归阶段 1–6 的游戏行为。
2. 验收通过后启动阶段 8：生产镜像、HTTPS/WSS、指标告警、50 人 10 分钟压测、
   备份恢复与故障演练。
3. 阶段 8 前评估独立测试数据库、Outbox 独立 worker、审计与 Release 归档、
   多区服内容路由。

## 2026-11-25 · 阶段 8：质量、压测、部署与恢复

### 目标

把项目推进到“可部署、可观测、可恢复”：生产镜像与 nginx edge（HTTPS/WSS、
安全头、限流）、Prometheus 指标与告警、Game Server 按 Realm 绑定内容、不可变
镜像发布/回滚、数据库备份与真实恢复、Game Server 正常/崩溃重启与 Outbox 重试
演练，以及 30+10 玩家 10 分钟与 50 玩家短时容量场景。

### 开工前状态

- HEAD `291f200`；上一会话在阶段 8 中途因环境配置中断，留下大量未提交改动
  （ADR-023、Prometheus 指标、infra 镜像/脚本/告警、部署集成测试、压测与恢复
  脚本、30 个野外刷点），文档尚未更新，门禁未通过。
- 本环境 shell 默认 Node 24，项目要求 26.13.1；需要用 nvm 路径运行所有命令。
- `pnpm format:check` 11 个文件未格式化；`pnpm lint` 4 个错误；
  `pnpm test` 53 个失败（16 个 Room 测试因 Realm 绑定拒绝、Control API 测试
  整体 30 秒超时）。

### 实际改动

1. **门禁与既有代码修复**
   - 重新编译地图并格式化产物；修复 Control API `onRequest`/`onClose` hook
     与 `verifyRestore` 的 lint 错误（Fastify 5 的非 async onRequest 会挂起，
     保留 async 并注明原因）。
   - `worldTestHelpers` 改为按 `classic-01` 查询 Realm，不再取任意一行；共享库
     中其他区服曾让所有 Room 测试被拒绝。
   - 新增 `WorldRoomTuning.monsterSpawns` 注入点；PvP 集成测试注入空刷怪列表，
     与 30 刷点的野外隔离。
2. **指标与可观测性**
   - `@web-legend/observability`：Prometheus 文本渲染器与运行时采集器（事件
     循环、RSS/堆、CPU、GC、ELU），渲染器含单测；不引入 `prom-client`。
   - Game Server：`/metrics/prometheus` 全部 Room 指标 + `realm` 标签；新增
     WebSocket 出站/patch 字节与资产事务队列 p50/95/99（`assetTx`）。
   - Control API：HTTP 计数/延迟直方图/并发、Outbox 状态与最老 pending、DB
     探测、运行时指标；`TRUST_PROXY` 只在可信代理后启用。
   - edge 内部端口提供合成 `/metrics`；Prometheus 边抓取需要
     `fallback_scrape_protocol`。告警 10 条规则加载健康。
3. **Realm 绑定**
   - `GAME_SERVER_REALM`（默认 `classic-01`）绑定进程，Room 校验角色区服；
     `ContentStore` 按 Realm 读取激活 Release，生产启动时区服缺失直接失败。
   - 部署集成测试证明跨区服拒绝、绑定区服使用自己的激活版本。
4. **生产镜像与 edge**
   - 四个 Dockerfile（Node 运行镜像 / nginx 静态镜像），非 root、健康检查；
     基础镜像支持 `NODE_IMAGE`/`NGINX_IMAGE` 覆盖；构建需包含 `content/`
     （contracts 导入编译地图）。
   - edge：HTTP→HTTPS、HSTS/CSP/XFO/Referrer/Permissions、16KB body、连接与
     认证限流；`/ws` 转发 matchmaking 与 WebSocket；`/internal`、`/metrics`
     返回 404；内部端口合成存活指标。
   - `compose.drill.yml` 用于本机演练：发布 PostgreSQL 到宿主机并改用
     38180/38443/38444 端口，避免占用真实 80/443。
5. **发布/回滚与备份恢复**
   - 根脚本 `deploy`/`rollback` 改名为 `prod:deploy`/`prod:rollback`：pnpm 11
     会把 `deploy` 当作内置命令，与 `pnpm --filter <pkg> deploy` 冲突。
   - 修复 `pg_restore` 从 stdin 读取（不能传 `-`）；恢复不变量只约束“未领取
     掉落必须在 ground”，已领取物品保留 `world_drops` 历史行。
   - `.gitignore` 忽略 `infra/docker/nginx/certs/` 与 `infra/docker/data/`。
6. **故障演练与测试**
   - `recoveryDrill`：启动生产构建、进程组 kill、关闭 SDK 自动重连；SIGKILL
     场景等待越过第二个 checkpoint 周期（会话节流从 join 起算，首次周期保存
     在 t+40s）。
   - **关键修复**：Colyseus 默认注册自己的 SIGTERM 处理器并在 finally
     `process.exit()`，与自有 shutdown 竞争，导致租约释放被提前关闭的数据库
     打断；`new Server({ gracefullyShutdown: false })` 后由 `index.ts` 独占
     信号，SIGTERM 租约释放从 28s 降到 1ms。
   - `outboxDrill`：修复 raw SQL 时间戳为字符串的解析；增加相同 commandId
     二次投递验证 `duplicate`。
   - 新增 Control API / Game Server 数据库中断集成测试（TCP 代理断开与恢复，
     readiness 503→200、liveness 200）；`pingDatabase` 增加 2 秒超时。
   - `worldScenario`/`recoveryDrill` 从仓库根 `.env` 加载配置（pnpm 以包目录为
     cwd 运行脚本）。
7. **内容与 E2E**
   - 野外刷点 6 → 30（阶段 8 目标 20–40）；移动靠近 PvP 决斗点的两只狼，PvP
     E2E 决斗改到无仇恨 tile（12,10)/(13,10)，避免怪物击杀污染断言。
8. **文档**
   - ADR-023、`docs/runbooks/DEPLOYMENT_AND_RECOVERY.md`、AGENTS 命令/环境
     约束、README、阶段 8 报告与证据目录。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
pnpm load:scenario
pnpm drill:recovery
pnpm drill:outbox
pnpm db:backup
pnpm db:restore-drill <dump> <manifest>
```

- 格式 / lint / typecheck / build：通过。
- 单元/集成：见阶段 8 报告（最终门禁）。
- 浏览器 E2E：20/20 通过（约 1.8 分钟，2 workers）。
- 容量场景 A：30/30 加入、36000 接受、11069 拒绝、tick p50 1.12ms / p95 4.3ms / p99 5.84ms / max 7.17ms、资产队列 p95 33.3ms、324 击杀、0 资产失败。
- 容量场景 B：50/50 加入、15000 接受、0 拒绝、tick p50 1.44ms / p95 6.05ms / p99 7.83ms / max 8.54ms、0 资产失败。
- 恢复演练：SIGTERM 租约 1ms 释放、位置 checkpoint 正确；SIGKILL 周期
  checkpoint 正确、物品实例数量不变。
- Outbox 演练：不可达时 pending + 退避；可达后 applied；重复 commandId 返回
  duplicate。
- 备份/恢复：19 张表、6 条迁移、行数与资产不变量一致，演练库自动删除。
- 生产演练：compose 全部 7 个容器 healthy；HTTPS/WSS/安全头/代理/404/登录/
  Prometheus 12/12 通过；drill-b → drill-a 回滚后同样 12/12。

### 遇到的问题及解决方法

1. **Node 版本**：默认 Node 24 与 engines 不符；所有命令使用
   `~/.nvm/versions/node/v26.13.1/bin`。
2. **Realm 测试**：共享库存在 `other-*` 区服；helper 取第一行导致角色不属于
   绑定区服。改为按 code 查询。
3. **30 刷点与 PvP 测试**：野外刷点覆盖了原决斗点；注入 `monsterSpawns: []`
   给集成测试，E2E 移动决斗点并挪走两只狼。
4. **Fastify hook**：非 async `onRequest` 被视为 callback 风格且不调用 done，
   请求永久挂起；保持 async 并加注释禁用 `require-await`。
5. **pnpm 与 deploy 重名**：根脚本名 `deploy` 让 `pnpm --filter <pkg> deploy`
   变成跑脚本；改名为 `prod:deploy`/`prod:rollback`。
6. **Docker Hub 不可达**：镜像站拉取并允许覆盖基础镜像；`content/` 不在构建
   上下文导致 contracts 找不到编译地图，补 `COPY content`。
7. **宿主端口占用**：18080/25432 已被占用；演练改用 38180/38443/38444/38543。
8. **Prometheus 抓 edge**：v3 拒绝非指标 Content-Type；edge 内部端口返回
   `text/plain; version=0.0.4` 并配置 `fallback_scrape_protocol`。
9. **pg_restore**：`-` 被当作文件名；省略文件名从 stdin 读取。
10. **恢复不变量**：已领取掉落保留 `world_drops` 行；查询只检查未领取掉落。
11. **恢复演练租约**：tsx 包装进程、Colyseus 自带 SIGTERM 退出、会话 checkpoint
    节流；分别用生产构建 + 进程组 kill + `gracefullyShutdown: false` + 等待
    40 秒解决。
12. **E2E 覆盖旧证据**：完整 E2E 会重写阶段 3–7 截图；已用 `git checkout`
    恢复，只提交阶段 8 新证据。

### 尚未解决的问题

- 单 Realm、单 Game Server、单 edge；多实例路由、独立 Outbox worker、审计/
  Release 归档仍待扩容阶段。
- 负载脚本不单独统计重连率；由集成/E2E 覆盖。入站字节未计数。
- 生产浏览器截图未采集（浏览器无法访问 compose 在宿主机发布的端口）。
- 共享开发库仍有历史测试数据。

### 阶段提交

- 阶段 8 主提交：`d079b9644e4d9aff7a88358fadc7d002698e2c4f`
  主题：`feat(phase-8): deliver production deployment, observability and recovery`。

### 下一步计划

1. 用户在 8584/8585 完成阶段 7 实测，并确认阶段 8 的部署/恢复证据。
2. 进入下一阶段前评估独立测试库、Outbox worker、审计/Release 归档、多 Realm
   路由与正式美术/音效。

---

## 2026-11-25 阶段 9：MVP 收口（测试数据隔离与 WebSocket 观测）

### 目标

MVP 计划定义的阶段 0–8 已全部交付。按用户“确定下一个尚未完成的 MVP 阶段”的
指令，对照 `docs/WEB_LEGEND_MVP_PLAN_v2.md` 第 19 节 Definition of Done 与
`docs/PROJECT_STATUS.md` 未完成项做差距审计，选择仍属 MVP 验收基础、且不新增
玩法的两项：

1. `pnpm test` 全部连接共享开发库，重复/并行运行会留下账号、物品、审计、
   Release 与 Outbox 数据；PROJECT_STATUS 将其列为未完成项与风险。
2. 架构 15.1 与 MVP 计划要求“断线率、重连率、每玩家上下行 bytes”；现有指标
   只有出站字节，且 `onJoin` 的出站包装在重连后的新 Client 上未重新应用，
   重连后出站字节漏计。

### 实际改动

1. **ADR-024**：记录一次性测试数据库与 Room 级网络指标的决策、替代方案与
   后果；说明为什么不用同库 schema（Drizzle 迁移显式写 `"public".` 全限定名）。
2. **测试数据隔离**
   - `packages/persistence/test/testDatabaseNaming.ts`：生成
     `wl_test_<base36 时间戳>_<随机>`、替换连接串中的数据库名、解析残留库年龄。
   - `packages/persistence/test/testDatabase.ts`：建库、运行现有迁移、删库、
     清理 24 小时前的 `wl_test_*` 残留库；`NODE_ENV=production` 拒绝执行。
   - `packages/persistence/test/databaseGlobalSetup.ts`：Vite/Vitest 全局
     setup/teardown；使用命名导出（默认导出会让 Vitest 忽略 `teardown`）。
   - `vitest.config.ts`：每次运行生成库名并把带临时库的 `DATABASE_URL` 注入
     worker；`TEST_DATABASE_URL` 可覆盖基础连接。
   - `testDatabase.test.ts`：断言当前数据库是本次临时库、迁移表齐全。
3. **WebSocket 观测**
   - `RoomMetrics` / `MetricsSnapshot` 增加 `wsReceivedBytes`、`wsConnections`、
     `wsDisconnects`、`wsReconnects`，注册表销毁 Room 时汇总到 totals。
   - `WorldMapRoom.instrumentClient`：包装 `raw` / `enqueueRaw` 计出站字节，
     监听底层 WebSocket `message` 计入站 payload；初次加入和重连都应用。
   - `onLeave` 对非主动、非传送断线记 disconnect；`onReconnect` 记 reconnect。
   - Prometheus 增加四个计数器；JSON `/metrics` 同步字段。
   - 负载脚本输出 `wsIn`、重连率并断言入站字节大于 0。
4. **文档**：AGENTS 测试要求、README 测试命令与门禁、PROJECT_STATUS、
   ADR-024、阶段 9 报告与证据目录。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e
LOAD_PLAYERS=6 LOAD_ATTACKERS=2 LOAD_DURATION_MS=30000 pnpm load:scenario
```

- 格式 / lint / typecheck / build：通过。
- 单元/集成：61 个文件、329 个测试全部通过（约 13.3s）。
- 隔离：全量测试前后开发库账号/角色/物品/审计/Release/Outbox 计数一致；
  `wl_test_*` 库为 0。
- 浏览器 E2E：20/20 通过（约 1.8 分钟，2 workers）。
- 短时负载：6/6 加入、360 接受、tick p95 0.75ms、出站 1,353,745B、
  入站 58,638B、0 资产失败；重连率 0%。
- 实时 Prometheus 快照：4 个 WS 指标均有 Room 标签与数值。

### 遇到的问题及解决方法

1. **同库 schema 不可行**：首次用 `search_path` + `migrationsSchema`，迁移仍
   失败于 `CREATE TYPE "public"."admin_audit_result"`，因为 Drizzle 生成的 DDL
   显式限定 `public`。改为每次创建独立数据库，不再改写迁移。
2. **Vitest 未执行 teardown**：`databaseGlobalSetup.ts` 同时使用默认导出和命名
   `teardown` 时，Vitest 只取默认导出，残留了 5 个测试库。改为仅命名导出
   `setup`/`teardown`，并用 `TEST_DATABASE_STALE_MS=0` 清理后验证为 0。
3. **配置加载告警**：`vitest.config.ts` 直接导入 persistence 会拉起整张 schema
   依赖并产生 20+ 条 Vite native loader 告警；抽出仅依赖 `node:crypto` 的
   `testDatabaseNaming.ts` 后降到 1 条。
4. **ESLint `preserve-caught-error`**：建库失败重新抛出时补充 `cause`。
5. **负载证据路径**：`LOAD_OUTPUT` 相对路径以 `apps/game-server` 为 cwd，产物
   写到包目录；已移动回 `docs/phase-reports/phase-09/`。
6. **E2E 覆盖旧截图**：与阶段 8 相同，完整 E2E 重写阶段 3–7 证据；提交前
   `git checkout` 恢复历史文件。

### 尚未解决的问题

- E2E 仍使用开发栈数据库；完全隔离需要独立端口与一套测试栈，留待后续。
- 网络指标按 Room 聚合，无单会话标签；入站字节为应用层 WS payload，不含
  TCP/TLS/WS 帧头。
- 多 Realm 路由、独立 Outbox worker、审计/Release 归档、聊天持久化仍属后续阶段。

### 阶段提交

- 阶段 9 主提交：`8e3e534`
  主题：`feat(phase-9): isolate test databases and complete websocket metrics`。

### 下一步计划

1. 用户确认阶段 9 证据，并在目标数据库角色上验证 `CREATEDB` /
   `TEST_DATABASE_URL`。
2. 按原计划完成阶段 7 的 8584/8585 实测与阶段 8 的部署/恢复确认。
3. 后续评估 E2E 独立环境、Outbox worker、审计/Release 归档与多 Realm 路由。

---

## 2026-11-25 MVP 全面审计与 Alpha 路线规划

### 目标

MVP 阶段 0–9 交付后，对项目做一次独立于阶段报告的全面审计：以当前代码与
真实运行结果为准，验证 15 个技术与产品维度，评估游戏质量，制定 Alpha/Beta
路线；除非发现 P0，不修改业务代码。

### 实际改动

本轮以审计、验证与文档为主，未修改业务代码、迁移或已发布内容：

- 新增 `docs/MVP_ACCEPTANCE_REPORT.md`：15 维审计、门禁结果、DoD 对照、
  未验证项与 Alpha 准入结论。
- 新增 `docs/TECHNICAL_DEBT.md`：57 项债务（P1×8 / P2×25 / P3×24），含
  证据位置、影响、修复建议与工作量。
- 新增 `docs/GAMEPLAY_REVIEW.md`：操作、战斗、职业、怪物、地图、成长、
  掉落、HUD、多人、美术十维评审与数值测算。
- 新增 `docs/POST_MVP_ROADMAP.md`（2026-11-25 更名为 `docs/PROJECT_ROADMAP.md`）：
  Alpha 0.1/0.2/0.3、Beta 与长期演进；
  每版含目标、范围、技术任务、依赖、里程碑、验收、风险、工作量与优先级。
- 新增证据目录 `docs/phase-reports/audit-2026-11-25/`：手动浏览器截图、
  门禁日志、独立库 E2E 结果、数据库不变量、压测/恢复/备份结果。
- 更新 `docs/PROJECT_STATUS.md`：审计结论、阶段表、已知问题、测试结果与
  下一步。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# 共享开发库（开发栈同时运行）
GAME_WEB_PORT=5184 ADMIN_WEB_PORT=5185 CONTROL_API_PORT=3086 \
  GAME_SERVER_PORT=2587 pnpm test:e2e
# 独立数据库（隔离 outbox 与内容）
DATABASE_URL=…/web_legend_audit_e2e pnpm test:e2e
# 手动浏览器链路（临时 Playwright 脚本，截图存证据目录）
LOAD_PLAYERS=30 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 pnpm load:scenario
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 pnpm load:scenario
pnpm drill:recovery
pnpm db:backup && pnpm db:restore-drill <dump> <manifest>
```

- 格式/lint/类型/构建：全部通过。
- 单元/集成：61 文件、329 测试通过（13.88s）。
- E2E（共享开发库）：18/20 + 1 失败 + 1 跳过。失败为 kick 用例；根因是开发
  Control API 与 E2E Control API 共享 outbox 表，开发进程抢走命令并投递到
  没有该会话的 87 端口（outbox 标记 applied，applied=0）。
- E2E（独立数据库）：20/20 通过（2.0 分钟），证明不是产品缺陷。
- 手动浏览器：注册→创建→主城→传送→打怪→击杀→拾取→背包成功；软件渲染
  25 FPS；背包 4/24、铁剑/药水/凝胶/金币 2。
- 开发库不变量：钱包与账本差异 0、负余额 0、重复装备/背包槽 0、ground 无
  掉落行 0、已领取仍在 ground 0；**763 条过期未领取掉落仍占 ground**。
- 30 玩家（10 名攻击）10 分钟压测：30/30 加入、36,000 接受、11,041 拒绝（主要
  OUT_OF_RANGE/COOLDOWN）、tick p95 3.58ms / p99 4.4ms、资产事务 p95
  32.28ms、337 击杀、0 资产失败。
- 50 玩家（10 名攻击）10 分钟压测：50/50 加入、60,000 接受、11,088 拒绝、
  tick p95 8.79ms / p99 12.47ms、资产 p95 38.79ms、317 击杀、0 资产失败，
  满足 50 人 × 10 分钟目标。注意 `LOAD_ATTACKERS` 是 `LOAD_PLAYERS` 的子集。
- 恢复演练：SIGTERM 1ms 释放租约；SIGKILL 23.1s 租约过期、checkpoint 位置
  恢复、物品 2→2。
- 备份/恢复：19 表、6 迁移、2,967 账号；恢复 `problems: []`，演练库删除。
  证据见 `load-*.json`、`recovery-drill.json`、`backup.txt`、`restore.txt`。

### 遇到的问题及解决方法

1. **E2E kick 稳定失败**：最初怀疑产品回归；用直接向 Game Server 发内部命令
   验证 Room 能正常踢人（applied=1、客户端收到 `session.kicked`、关闭码
   4000）。进一步对照两个进程的 `activeCommands`，确认开发 Control API 抢走
   outbox 行。改用独立数据库后 20/20。结论：E2E 隔离不完整，不是产品 bug。
2. **“独立端口”不等于独立环境**：Outbox dispatcher 与内容激活都绑定数据库，
   共享库时仍互相干扰。已写入技术债务与 Alpha 0.1。
3. **开发库测试污染**：E2E 每次留下账号/角色/测试 Realm/Release；长期累积到
   2,900+ 账号、9 个 Realm。建议 E2E 独立库并整库销毁。
4. **过期掉落**：Room 只删内存 LootState，数据库无删除路径；实测 763 条
   未领取过期掉落仍占 ground。已在技术债务中给出维护任务方案。
5. **封禁重连缺口**：管理断开走 `leave(4000)` 进入 15 秒宽限，`onReconnect`
   不重查账号状态；正常网页客户端不会重连，但修改客户端可恢复会话。

### 尚未解决的问题

- CI E2E 仍不可用；容量场景未纳入 CI；E2E 仍写开发库。
- 自动攻击、常驻提示、三职业差异、金币消耗、美术资源均属 Alpha 0.2 范围。
- 多 Realm/动态实例、独立 Outbox worker、审计归档未开始。

### 下一步计划

1. 人工审阅四份审计/路线文档，确认“有条件通过”与 Alpha 0.1 范围。
2. 执行 Alpha 0.1 门禁（2 周），通过后进入 Alpha 0.2 体验完善。
3. 完成阶段 7/8 遗留的手工实测与生产演练确认。

---

## 2026-11-25 Alpha 0.1：可信度、战斗体验与架构质量加固

### 本次任务目标

按用户指令进入 Alpha 0.1，以实际代码与审计结果重新梳理 8 项 P1，完成五个
里程碑：CI/测试可靠性、服务端安全与数据正确性、服务端权威自动攻击、Room
第一阶段拆分、回归与最终验收；不进入 Alpha 0.2 的三职业/装备/美术/商店。

### 计划与依赖

- 新增 `docs/ALPHA_01_EXECUTION_PLAN.md`：重新列出 8 项 P1，补充审计发现但
  路线图遗漏的 AOI/事件归属与 TD-DATA-01/02；明确 A→B→C→D→E 依赖。
- 新增 ADR-025：自动攻击状态机、AOI/归属路由、E2E 独立库、Room 拆分边界与
  延期项（TD-SRV-01b）。

### 实际改动

1. **CI / E2E 隔离**
   - `ci.yml` e2e job 增加 PostgreSQL 18 service、`DATABASE_URL`、
     `E2E_DATABASE_URL`，超时 30 分钟。
   - `playwright.config.ts` 使用 `web_legend_e2e` 与 5184/5185/3086/2587；
     webServer 统一注入 DB/端口；默认不复用现有服务。
   - `infra/scripts/e2e-database.ts` 建库/迁移；`tests/e2e/globalTeardown.ts`
     删库；control-api webServer 启动前执行 prepare。
2. **服务端安全与数据**
   - 封禁/踢下线：`terminated` 标记、`onLeave` 直接移除、`onReconnect` 重新
     查询账号状态与禁言；宽限结束不复活已终止会话。
   - 内容发布/激活：阻断删除玩家仍持有模板的候选 bundle，列出受影响角色/实例；
     `loadOpenDrops` 逐条容错并告警。
   - 战斗事件：`broadcastCombatEvent` 按 source/target 的 AOI 可见性投递，
     heal/respawn 仅本人，公共公告仍全图。
   - 击杀奖励按装备后属性持久化 `max_hp/max_mp`。
   - 过期未领取掉落与地面实例清理（单次 500、30 秒周期、Room 创建与 Game
     Server 启动时各一次；已领取行保留 7 天）。
   - checkpoint 条件加入 `map_id`；资产幂等键加入 `characterId`。
   - 恢复演练校验 `.sha256`。
3. **自动攻击与 UI**
   - 协议：`combat.engage`、`combat.autoAttack.start`、
     `combat.autoAttack.stop`、`combat.target.changed`。
   - 服务端 `SessionRecord.autoAttack` 状态机：目标有效/可见/安全区校验、
     BFS 接近（350ms 重寻路）、权威冷却挥砍、死亡/离开 AOI/断线/传送/手动移动
     停止；复用 `CommandGuard` 幂等与限频。
   - 客户端一次点击锁定、攻击条、停止按钮/Esc、点击地面取消；Toast 4 秒消失、
     1.5 秒去重、最多 3 条，右上角布局，战斗面板/聊天/Toast 分层。
4. **Room 拆分**
   - 新增 `SessionRegistry`、`CommandGuard`、`StateViewPublisher`，四套命令管线
     复用统一门禁；删除 Room 内的会话双索引与视图 diff 实现。
5. **回归工具**
   - `pnpm load:regression`：50 人 × 10 分钟，攻击者先接近，输出接受率/拒绝码，
     断言接受率与 tick 上限；`LOAD_OUTPUT` 相对路径按仓库根解析。
   - `pnpm verify:invariants`：钱包/账本、负余额、重复槽位、ground 位置、
     过期掉落（>2 分钟）不变量。
6. **文档**
   - 新增阶段报告 `docs/phase-reports/alpha-01/ALPHA_01_REPORT.md` 与证据目录；
     更新 TECHNICAL_DEBT、PROJECT_STATUS、AGENTS、README、架构协议列表。

### 命令与结果

```bash
pnpm verify
pnpm test:e2e
pnpm load:regression
pnpm verify:invariants
pnpm drill:recovery
```

- format/lint/typecheck：通过；单元/集成：63 文件、345 测试通过（22.7s）；
  build：4 个应用成功。
- E2E：**21/21 通过**（2.3 分钟，独立数据库与端口；开发栈同时在 84–87 运行）。
- 50 人 10 分钟：50/50 加入、接受 69,387、拒绝 649（COOLDOWN 247、
  TARGET_DEAD 399、OUT_OF_RANGE 3），接受率 99.1%、0 资产失败、746 击杀；
  tick p50 1.98ms / p95 10.25ms / p99 16.08ms / max 17.57ms；资产 p95
  52.16ms；重连 0%；稳态内存无持续增长。
- 不变量：全部 0；当前 30 秒窗口内新过期掉落 147 条，>2 分钟 0 条。
- 恢复：SIGTERM/SIGKILL 通过，位置一致、物品 2→2、租约 1ms/23.1s。

### 遇到的问题及解决方法

1. **Combat E2E 技能断言失败**：自动攻击在技能点击前已击杀目标，技能被正确
   拒绝。测试改为先停止双方自动攻击并等待目标存活；产品行为未回退。
2. **Toast 永不消失**：去重标记写在 React updater 内，而 updater 异步执行，
   定时器未被安排。改为同步去重并直接安排 4 秒定时器。
3. **Toast 几何断言误判**：改为判断 Toast 与战斗面板矩形是否相交，而不是比较
   纵向位置。
4. **50 人 tick p95 10.25ms**：高于 10ms 目标 0.25ms；攻击者改为真实接近后
   击杀 746（审计基线 317），掉落密度约 2.3 倍。未调低断言掩盖；保留 25ms/40ms
   硬上限并在报告中列为 Alpha 0.2 首周性能项。
5. **不变量的“过期掉落 >0”**：清理周期 30 秒，任意时刻都有刚过期行；改为断言
   “过期超过 2 分钟”为 0，同时输出当前数量。
6. **E2E 重写历史截图**：本轮 E2E 再次刷新 phase-03…08 截图与
   phase-08 恢复证据；它们仍是真实执行产物，内容对应当前代码。alpha-01 目录
   保留了自动攻击截图、压测/恢复证据与日志；如需保留原始历史图，可从 Git 历史
   恢复（本轮未执行破坏性 Git 命令）。

### 尚未解决的问题

- 远端 CI 未实际执行（本环境不能推送）。
- Room 残余编排拆分（TD-SRV-01b）、装备槽数据库唯一约束（TD-DATA-05）、
  备份/manifest 同一快照（TD-OPS-08b）留待 Alpha 0.2/Beta。
- 三职业差异、内容量、金币消耗与正式美术仍属 Alpha 0.2。

### 下一步计划

1. 推送后确认 CI verify/e2e 21/21。
2. 用户在 8584/8585 验收自动攻击、Toast、封禁与内容发布。
3. 进入 Alpha 0.2 前复测容量 p95 并规划掉落/视图同步优化。

---

## 2026-11-25 Alpha 0.2 切片 1：主城杂货商与经济闭环

### 本次任务目标

Alpha 0.2 第一阶段：让金币第一次有稳定消耗端，让玩家能完成“买药 → 打怪 →
卖材料 → 买护甲”的 30 分钟闭环；同时建立长期产品愿景、工程经验与版本执行
计划文档。

### 计划与依赖

- 新增 `docs/PRODUCT_VISION.md`、`docs/ENGINEERING_LEARNINGS.md`、
  `docs/ALPHA_02_EXECUTION_PLAN.md` 与 ADR-026。
- 先定义内容价格、NPC 交互角色、协议与拒绝码，再实现应用事务、Room、客户端。
- 复用既有 `wallets`/`currency_ledger`/`asset_commands`/`item_instances`，不新增表。

### 实际改动

1. **内容与校验**
   - `ItemContent` 增加可选 `buyPrice`/`sellPrice`（不用默认值，避免历史 Release
     checksum 变化）；基线物品配置初始价格；初始职业武器设为绑定（无 sellPrice），
     防止新手卖掉唯一武器。
   - 内容校验新增“收购价必须低于出售价”，阻断买卖套利。
   - `starter_town` NPC 增加 `role`，重新编译地图；`starter_town` 杂货商标记
     `merchant`。
2. **经济启动资金**
   - 新角色创建事务写入 50 金币钱包与 `starter_gold` 账本记录。
3. **契约**
   - `shop.buy`、`shop.sell`、`shop.catalog`；`assetCommandKind` 增加
     `shop_buy`/`shop_sell`；新增 5 个商店拒绝码与目录 schema。
4. **应用层**
   - `AssetService.buy/sell`：角色行锁、幂等命令、条件扣款、账本、堆叠入包、
     部分/整栈出售。
   - 五个资产命令统一改为先锁角色行再写幂等命令，修复外键共享锁 + `FOR UPDATE`
     的并发死锁。
5. **服务端**
   - Room 新增买卖命令处理：存活校验、`merchant` NPC 距离 ≤ 3 格、目录下发
     （按职业过滤可购商品）。
6. **客户端**
   - 靠近商人出现“杂货商”入口；商店面板购买/出售页签、价格/等级/属性展示、
     金币不足禁用、卖 1/全部；离开范围自动关闭。
   - 移除玩家可见的“阶段 6”内部标签。
7. **测试**
   - 契约、领域、内容校验、真实 PostgreSQL 应用集成、真实 Colyseus 服务端
     集成与浏览器 E2E 均补商店用例。

### 命令与结果

```bash
pnpm verify
pnpm test:e2e
pnpm exec playwright test tests/e2e/shop.spec.ts --workers=1
```

- `pnpm verify`（Node 26.13.1）：格式、lint、类型、63 文件 362 测试、4 应用
  构建全部通过。
- 商店 E2E：1/1 通过（约 10 秒），金币 50 → 买药 35 → 卖药 40，离开重进后
  金币与药水数量保持。
- 全量 E2E：22/22 通过（2.4 分钟，独立数据库与端口）。

### 遇到的问题及解决方法

1. **并发购买死锁**：两个事务先插 `asset_commands`（外键对角色行取共享锁）
   再 `FOR UPDATE` 角色行，互相等待。改为所有资产命令先锁角色行，再写幂等
   命令；并发测试验证只有一笔成功且余额不为负。
2. **E2E 重进误判**：离开世界后客户端停在“已断开/返回角色”界面，不会回登录页；
   测试改为点击“返回角色”再进入世界。
3. **历史 Release 兼容**：价格字段使用 `.optional()`，并用“旧 payload 解析 →
   checksum 不变”测试锁定；若用 `.default(0)` 会让已发布 Release 校验失败。
4. **测试库共享偶发失败**：`purged expired` 用例单独运行稳定、全量偶发失败；
   根因是测试注入时钟早于真实时间，其他测试文件的 Room 实时清理先删掉了夹具。
   资产测试时钟改为从“当前时间 + 24 小时”起算，TD-QA-10 同轮关闭。

### 尚未解决的问题

- 50 人 × 10 分钟容量回归本切片未执行；需在新代码开发栈上补跑。
- 开发栈 84–87 仍运行 Alpha 0.1 服务端代码；重启并发布新内容 Release 后商店
  才会出现在 8584。
- 远端 CI 未执行；本环境不能推送。
- 价格为初始数值，未经经济模拟与试玩验证。

### 下一步计划

1. 重启开发栈，发布/激活包含价格的内容 Release，完成 8584 人工试玩。
2. 补跑容量回归与资产不变量。
3. 进入切片 2：三职业技能与定位；开始前处理 TD-DATA-05。

---

## 2026-11-25 治理体系落地、S1 独立审查与 S2 法力回复

### 本次任务目标

把长期产品使命、自主原则、反思机制、决策边界与会话交接规范固化到项目文档，
避免重复创建同类文件；以 Alpha 0.1 实际交付为依据继续 Alpha 0.2，选出 S2 的
第一个独立任务并实施。

### 实际改动

1. **文档治理**
   - `docs/POST_MVP_ROADMAP.md` 更名为 `docs/PROJECT_ROADMAP.md`，更新全部
     引用；WORKLOG 历史条目保留原名并注明更名。
   - 新增 `docs/EVOLUTION_LOG.md`：里程碑级决策、结果与反思，与 WORKLOG 分工。
   - `docs/PROJECT_STATUS.md` 顶部新增“会话入口”：当前版本、工作、阻塞、下一步、
     阅读顺序、结束更新清单与文档地图，作为唯一权威入口。
   - `AGENTS.md` 增加长期使命、三个产品判断问题、自主研发/反思机制、人工决策
     边界、体验质量要求；重写 §11 文档维护与 §14 会话启动/交接规范。
   - `TECHNICAL_DEBT.md` 更新处理顺序；新增/关闭债务状态整理。
2. **S1 独立审查**
   - 独立审查提交 `9e0ad74`，发现并修复：买卖账本幂等键未含操作类型；客户端
     批量数量未按 `maxStack`/`SHOP_MAX_QUANTITY` 钳制；商店目录在异常内容下
     可能抛错；`grantKillReward` 未采用新的锁顺序。
   - 补测试：买卖同 commandId、跨职业购买、类目按职业过滤、3 格边界、并发整栈
     出售、出售重复回放、超过堆叠上限、并发击杀奖励。
3. **S2 任务 1：服务端法力回复**
   - `ClassContent` 增加可选 `mpRegenPerSecond`；基线战士 1、法师 3、道士 2。
   - `CombatStats` 带入速率，`CombatWorld.step` 按整数秒结算，封顶、死亡停止、
     复活/药水写回重置余量。
   - 新增 ADR-027、`ALPHA_02_MANA_REPORT.md`、`tests/e2e/mana.spec.ts`；更新
     确定性回放快照与战斗 E2E 的精确 MP 断言。
   - 新增经验 EL-015（横切修复审计同类入口）、EL-016（幂等键作用域一致）；
     新增产品债务 TD-ECO-01（商店无买回/确认/数量输入）。

### 命令与结果

```bash
pnpm test
pnpm exec playwright test tests/e2e/mana.spec.ts tests/e2e/combat.spec.ts --workers=1
pnpm test:e2e
```

- 单元/集成：63 文件、373 测试通过（约 22.5s）。
- 受影响 E2E：战斗 + 法力 2/2 通过（1.2 分钟）。
- 全量 E2E：23/23 通过（2.4 分钟，独立数据库与端口）。

### 遇到的问题及解决方法

1. **审查发现的账本幂等键冲突**：同一 `commandId` 跨买/卖会撞账本唯一约束并
   回滚；键改为包含 `shop_buy`/`shop_sell`，并加回归测试。
2. **回放快照变化**：法力回复使回放结束 MP 从 60 变为 79；确认这是预期行为后
   更新内联快照，而不是放宽断言。
3. **既有 E2E 精确 MP 断言**：战斗用例断言“法力 24/30”会因回复抖动；改为断言
   下降且在合理区间，保留“技能确实消耗法力”的语义。
4. **第二次独立审查发现两处低风险问题**：战斗集成测试仍断言精确 MP 24；
   `setPlayerVitals` 对所有消耗品清空回复余量，HP 药水会丢弃不足 1 秒的进度。
   分别改为“MP 已下降”与“仅 MP 变化时清空”，并补两条余量测试。

### 尚未解决的问题

- 50 人容量回归仍未在最新代码上复跑；开发栈未重启，8584 人工试玩缺失。
- 远端 CI 未执行。
- S2 剩余技能、外观与等级解锁未开始。

### 下一步计划

1. 重启开发栈、发布新内容 Release，完成商店与法力回复的人工试玩。
2. 补跑容量回归与资产不变量。
3. 继续 S2：道士毒符、战士冲锋/减伤、法师技能与三套外观；开工前处理
   TD-DATA-05。

---

## 2026-11-26 修复：点击杂货商无反应与内容发布 500

### 本次任务目标

用户实测 8584 时点击杂货商打不开。定位真实原因并修复，而不是只解释环境问题。

### 根因

1. **开发栈运行旧后端**：84–87 的进程启动于 Alpha 0.1 代码，没有
   `shop.catalog`/买卖命令；前端 Vite 已热更新到新代码，但拿不到目录，靠 HUD
   入口也无法出现。
2. **场景 NPC 没有点击交互**：此前只有“靠近后 HUD 出现杂货商按钮”这一条
   路径，点击世界里的杂货商标记只会触发寻路。
3. **内容发布 500**：第一次发布包含可选字段（`buyPrice`/`mpRegenPerSecond`）
   的 Release 时，diff 把旧版本缺失的字段当作 `undefined` 传给
   `canonicalJson`，抛出 `content cannot contain undefined`，验证/发布失败。

### 实际改动

- `WorldScene` 增加 NPC 命中检测与 `npcScreenPoint`；`WorldBridge.onNpcInteract`
  把点击转给会话层。
- `WorldSession.interactNpc`：商人且距离 ≤ 3 格时发出 `shopRequest` 打开面板；
  太远时显示“走近杂货商后再交易”；HUD 按钮仍保留。
- `diff.ts` 增加 `jsonForDiff`，把 `undefined` 视为合法差异值；checksum 仍拒绝
  undefined 内容。补“旧版本缺字段 vs 新版本有字段”的回归测试。
- 重启开发栈，用运营 API 发布并激活内容 `2026.11.26.1`
  （checksum `e7cad61d…`），刷新后游戏服务器确认使用新版本。
- 更新 `tests/e2e/shop.spec.ts`：改为直接点击场景中的商人，并覆盖距离不足的
  提示。

### 命令与结果

```bash
pnpm typecheck
pnpm lint
pnpm exec playwright test tests/e2e/shop.spec.ts --workers=1
# 真实 8584 浏览器脚本：注册→创建→移动到商人→点击 NPC→打开面板
```

- 类型/lint：通过；商店 E2E：1/1 通过（NPC 点击 + 远距离提示）。
- 8584 实测：新角色 50 金币，点击杂货商成功打开购买面板。
- 全量门禁：63 文件 374 测试、23/23 浏览器 E2E、4 应用构建通过。

### 尚未解决

- 用户当前页面若仍停留在旧 Room，需要刷新/返回角色再进入才能拿到新内容。
- 50 人容量回归与远端 CI 仍未执行。

---

## 2026-11-26 S2 任务 2：三职业等级技能、DoT 与护盾

### 本次任务目标

在法力回复之后补齐 S2 的核心体验：让三个职业在 1/5/10 级获得不同操作方式，
并建立可复用的状态效果（持续伤害、护盾）能力，同时保持服务端权威与确定性回放。

### 实际改动

1. **契约（加法）**
   - `skillEffectSchema` 新增 `dot`、`shield`。
   - `hit` 事件新增可选 `skillId`、`absorbed`、`periodic`；新增 `shield` 事件。
   - `combat.profile` 新增可选 `shield`，重连/升级后恢复护盾数值。
2. **内容与校验**
   - 三职业各 3 个技能（1/5/10 级、快捷键 1/2/3）：战士重击/铁布衫/破军斩，
     法师火球/魔法盾/陨石术，道士治愈/施毒/灵魂火符。
   - 校验：`dot` 只能敌方、`shield` 只能自身；持续时长不短于一个跳伤间隔；
     冷却短于持续时间给 warning。
3. **领域**
   - `CombatWorld` 增加 DoT 与护盾运行时；DoT 每跳伤害在施法时确定、不消耗
     RNG，技能 ID 刷新、死亡/重生清除，击杀归属施法者；护盾先吸收伤害，
     死亡/到期/耗尽清除。
   - `skillsForClass` 按等级 + 快捷键排序，修复 `jsonb` 键序导致的技能栏错序。
4. **服务端/客户端**
   - Room 投递 `shield` 事件；DoT 击杀沿用击杀奖励事务。
   - 客户端显示护盾数值、区分持续伤害/护盾吸收日志与浮字；事件去重提前到
     冷却/护盾记账之前。
   - 负载脚本补 `shop.catalog` 空处理器，消除 50 人回归时的 SDK 警告刷屏。
5. **文档与证据**
   - ADR-028、`ALPHA_02_SKILLS_REPORT.md`、EL-018。
   - `docs/phase-reports/alpha-02/skills/` 两张 E2E 截图；
     `invariants-s2-skills.txt`。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
pnpm exec playwright test tests/e2e/skills.spec.ts --workers=1
```

- 格式/lint/类型：通过。
- 单元/集成：64 文件、389 测试通过。
- 构建：4 个应用成功。
- 全量 E2E：25/25 通过（2.9 分钟，独立数据库与端口）。
- 技能 E2E：道士毒伤跳伤并击杀；战士护盾吸收怪物伤害。
- 资产不变量：7 项全部 0 违例。
- 开发栈已重启到最新代码；发布并激活内容 `2026.11.26.2`（新增 6 个技能，
  09:07 激活，checksum `9fde5006…`）。

### 遇到的问题及解决方法

1. **技能栏顺序错乱**：E2E 断言 `skill-2` 时战士显示重击而非铁布衫。根因是
   Release payload 存为 PostgreSQL `jsonb`，键按长度/字节重排。修复为
   `skillsForClass` 显式排序，补“乱序输入仍按等级/快捷键输出”的单测，并记录
   EL-018。
2. **DoT 与 RNG**：若每跳都掷命中/暴击，会改变后续攻击的随机序列并破坏回放。
   改为施法时固定跳伤、不消耗 RNG，并用“有/无 DoT 的后续攻击结果一致”测试锁定。
3. **E2E 无法自然升到 5 级**：新增 `tests/e2e/characterFixture.ts`，在角色进入
   Room 前把等级写入一次性 E2E 数据库；不触碰开发库。
4. **负载脚本告警刷屏**：`shop.catalog` 未注册处理器导致每个客户端刷警告；
   已在 `worldLoad`/`worldScenario` 补空处理器。
5. **压测后过期掉落残留**：50 人回归结束时，大量掉落尚未到 2 分钟过期；Room
   销毁时它们还未过期，于是留在 `world_drops`/ground 中，`verify:invariants`
   报 171 条 stale。重启 Game Server 会触发启动清理（0 条）。这是运行时的
   生命周期现象，不是重复/丢失资产；压测后需重启或等下一次 Room 生命周期。

### 尚未解决

- 三套职业外观与动作（TD-CLI-06）未做。
- 远端 CI 未执行。
- 容量 tick p95 12.36ms 高于 10ms 目标（基线 10.25ms），作为已知风险。

### 容量回归（50 人 × 10 分钟）

```bash
pnpm load:regression
```

- 50/50 加入，接受率 99.1%（69,454 接受 / 654 拒绝；COOLDOWN 241、
  TARGET_DEAD 412、OUT_OF_RANGE 1），0 资产失败、689 击杀。
- tick p50 1.74ms / p95 12.36ms / p99 16ms / max 19.38ms；资产事务 p95
  44.84ms（Alpha 0.1 基线 10.25ms / 52.16ms）。
- 入站 8.79MB、出站 438.96MB、重连率 0；运行期 event-loop p99 30.2ms，
  RSS 峰值 289MB。
- 证据：`docs/phase-reports/alpha-02/load-50p10a-10min-s2-skills.json`
  （运行命令会写回 alpha-01 历史路径，已复制到 alpha-02 并恢复历史文件）。

### 人工试玩准备

- 为 8584 试玩创建了开发账号 `demo_taoist5` / `web-legend-demo`，角色
  `DemoTaoist`（道士 Lv.5）与 `DemoWarrior`（战士 Lv.5），均满 HP/MP；从主城
  走到静语荒野即可测试治愈/施毒与铁布衫。账号只存在于开发库。

### 下一步计划

1. 在 8584 用 5 级角色试玩毒/护盾/等级解锁。
2. 完成三套职业外观；随后进入 S3 怪物威胁与死亡代价。
3. 评估 tick p95 12.36ms：先复测确认是否为环境噪声，再决定是否按 TD-SRV-03/
   TD-CLI-05 优化。

---

## 2026-11-26 S2 任务 3：三职业外观与动作（TD-CLI-06）

### 本次任务目标

让三个职业在画面上可区分，并让待机/行走/攻击/施法/受击/死亡由服务端战斗事件
驱动；资源描述留在内容层，正式美术替换时不改客户端代码。

### 实际改动

1. **资源格式与生成**
   - `assetCharacterSchema` 增加可选 `animations`（片段 → 列索引数组、帧时长、
     是否循环），校验帧索引不越界、片段内不重复。
   - 新增 `content/assets/generateCharacters.ts` 与 `pnpm assets:generate`：
     零依赖生成 3 张 32×48、10 列 × 4 行职业贴图（战士/法师/道士），输出确定。
   - manifest 版本 `phase3.1 → alpha0.2.1`，新增三职业条目；重新编译地图。
2. **客户端**
   - `mapCatalog` 加载三职业贴图与回退占位图；`PlayerVisual` 按 `classId` 选图。
   - 新增纯函数 `playerAnimation.ts`：`resolveClip`（死亡 > 一次性片段 > 行走 >
     待机）、`frameIndexFor`（循环取模/一次性停末帧）、`oneShotMs`。
   - `attack` 事件带 `skillId` 播放施法片段，否则普攻片段；`hit` 播放受击；
     `death`/`respawn` 切换死亡片段并复位。
   - 帧命名统一为 `${direction}:${frame}`；旧占位图共用同一命名并保留色相区分。
   - 新增仅开发环境的 `selfAppearance()` / `selfId()` 诊断钩子。
3. **测试与证据**
   - 契约测试：三职业贴图表、越界帧、重复帧。
   - 动画纯函数测试 7 条；浏览器 E2E `classes.spec.ts` 5 条。
   - 截图：`docs/phase-reports/alpha-02/classes/`（三职业待机、战士普攻、道士施法）。
4. **文档**
   - ADR-029、`ALPHA_02_CLASS_APPEARANCE_REPORT.md`、EL-019、债务 TD-CLI-06 关闭、
     TD-CLI-13 新增。

### 命令与结果

```bash
pnpm assets:generate
pnpm maps:compile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
pnpm exec playwright test tests/e2e/classes.spec.ts --workers=1
```

- 格式/lint/类型：通过。
- 单元/集成：65 文件、399 测试通过（修复轮新增 1 条动画回归测试后为 400）。
- 构建：4 个应用成功。
- 全量 E2E：30/30 通过（3.4 分钟，2 worker）。
- 外观 E2E：5/5（三职业贴图与行走、战士普攻、道士施法）。
- 资产不变量：7 项全部 0 违例。开发库原有 1 条 09:12 过期的 `slime_gel`
  （上一轮试玩遗留），通过 `AssetService.purgeExpiredDrops` 清理后归零。

### 遇到的问题及解决方法

1. **E2E 共享刷点**：新用例最初与 `skills.spec.ts` 共用 `wilds_slime_10`，
   2 worker 并行时互相抢怪，技能用例失败。改用独占 `wilds_slime_12`，并记录
   EL-019。
2. **角色名 12 字符上限**：`Warrior` + 6 位 token 超限被截断，角色卡定位失败。
   改用 `Warr`/`Mage`/`Taoi` 前缀。
3. **战斗截图被 HUD 遮挡**：野外目标面板更高，挡住摄像机抬升后的玩家；E2E
   截图前隐藏 HUD，只保留画布层。
4. **编译地图格式漂移**：`maps:compile` 输出未格式化，diff 变成逐元素展开；
   运行 Prettier 后只保留 `assetManifestVersion` 与 checksum 变化。

### 尚未解决

- 正式美术（TD-CLI-13）留到 S4；逐技能区分攻击/施法动作未做。
- 8584 目视、远端 CI、S3 前容量复测。

### 下一步计划

1. 在 8584 目视三职业外观与动作，并用 5 级角色试玩毒/护盾。
2. 进入 S3：怪物威胁与死亡代价。

提交：`99b8fd0`（`feat(alpha-02): give each class its own sprite sheet and animations`）。

---

## 2026-11-26 修复：PvP 复活后旁观者仍显示倒地

### 问题

A、B 野外 PK。B 阵亡后，A 的视角一直显示 B 倒地与“3 秒后复活”；B 复活后
A 仍看到 B 的倒地姿态。

### 根因

三职业外观切片把“已死亡”做成客户端视觉对象的粘性标记（`dead`），靠
`respawn` 事件清除。但 `WorldMapRoom.broadcastCombatEvent` 按设计只把
`respawn` 发给复活者本人（复活后的 HP/MP 是私有信息），旁观者永远收不到清除
信号；同时快照里的 `alive` 早已恢复为 true。

### 修复

- `PlayerVisual` 删除 `dead` 标记；死亡片段改为完全由快照 `alive` 决定。
- `playDeath` 只做即时表现（停用一次性片段、透明度、隐藏血条）。
- 仅开发环境的诊断钩子增加 `playerAppearance(playerId)`，供 E2E 检查旁观者
  视角。
- `tests/e2e/pvp.spec.ts` 复活后新增三方断言：A 的玩家列表 `data-alive=true`；
  A 视角的 B、B 视角的 A、B 自己的片段均不为 `death`。临时恢复旧粘性标记验证
  过该断言会失败。

### 命令与结果

```bash
pnpm typecheck
pnpm exec playwright test tests/e2e/pvp.spec.ts --workers=1
```

- 类型：通过。
- PvP E2E：3/3 通过（含新增的旁观者视角断言；旧实现下同一断言失败）。

### 说明

A 日志里“B 被 A 击败，3 秒后复活”是系统公告历史，正常保留；B 站起来后不再
出现新的错误状态。文档同步 ADR-029、EL-020 与切片报告 §4.1。

---

## 2026-11-26 首次推送至 GitHub

- 仓库：`git@github.com:bitallin/web-mir.git`（origin）。
- 传输：HTTPS 凭据不可用（`git push` 无法读取用户名）；SSH 密钥已配置并认证为
  `bitallin`，改用 SSH 地址推送。
- 结果：`main` 首次推送成功并建立跟踪（`git status` 显示 `main...origin/main`）。
- 范围：包含本项目全部历史提交；本次会话新增 S2 技能、三职业外观与 PvP 复活
  修复。
- 待确认：远端 CI 的 verify 与 e2e job 结果（本环境无 `gh`，未查询）。

---

## 2026-11-26 S3 任务 1：怪物威胁与扑击预警

### 本次任务目标

S2 之后战斗威胁仍只是“数值更大”，玩家没有可反应的决策。本切片让野外出现远程、
重甲与精英三类怪物，并给精英扑击一个服务端权威的预警窗口：玩家看到红圈后走位
可以躲开，命中/闪避仍由服务端裁定。

### 实际改动

1. **契约（加法）**
   - `monsterContentSchema` 增加可选 `windupMs`（0–5s）与 `windupRadiusTiles`
     （0–6）；不设默认值，历史 Release checksum 不变（EL-004）。
   - `combat.event` 新增 `telegraph`：攻击者/目标、落点、闪避半径与落地剩余
     毫秒。`PROTOCOL_VERSION` 不变（同版本前后端加法发布）。
2. **内容与校验**
   - 新增毒牙蜘蛛（远程 3.2 格）、石甲守卫（生命 230/防御 10/移速 900）、
     白狼王（精英，320 生命、扑击前摇 900ms、半径 1.5 格）。
   - 新增材料蛛腿/石甲核心/狼王毛皮与三条掉落表；精英经验 80、金币 25–40。
   - 校验：有闪避半径但无前摇 → error；前摇 ≥ 攻击间隔 → warning。
   - `starter_wilds` 新增 6 个刷点（精英 1、蜘蛛 3、守卫 2），30 → 36；重新
     编译地图。
3. **领域**
   - `CombatWorld` 增加前摇运行时：攻击冷却到期时冻结怪物、记录落点并发出
     `telegraph`；落地 tick 才掷命中/暴击/伤害；离开半径产生 `miss`。
   - 目标死亡/断线 → 攻击作废；怪物死亡/重生清除前摇；前摇不消耗 RNG。
4. **服务端**
   - `telegraph` 与 `attack`/`hit`/`miss` 同组按 AOI/归属投递。
   - 新增 `monsterThreat.integration.test.ts`（真实 PostgreSQL + Colyseus）：
     预警先于伤害、落点/半径/延迟正确、停留目标被命中。
5. **客户端**
   - 预警圈（红色范围 + 展开填充）、目标日志提示与新增预警音效；怪物死亡立即
     清除预警，落地 120ms 后清除。
   - 新怪物占位造型；仅开发环境 `activeTelegraphs()` 供 E2E 断言。
6. **文档与证据**
   - ADR-030、`ALPHA_02_MONSTER_THREAT_REPORT.md`、EL-021、TD-OPS-18。
   - E2E `tests/e2e/monsterThreat.spec.ts`；证据
     `docs/phase-reports/alpha-02/monsters/alpha-pounce.png`。
   - 发布并激活内容 `2026.11.26.3`（checksum `bd54ce8c…`）。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm maps:compile
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-02/load-50p10a-10min-s3-threat.json pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：66 文件、410 测试通过（新增领域前摇/远程用例与 1 条服务端集成）。
- 构建：4 个应用成功。
- 全量 E2E：31/31 通过（3.5 分钟，2 worker，独立数据库与端口）。
- 预警 E2E：1/1（预警出现/半径/剩余时间正确、落地后清除）；开发栈 84 复验
  1/1。
- 资产不变量：7 项全部 0 违例。
- 容量回归：50/50 加入、接受率 99.0%、766 击杀、0 资产失败、0 死亡；tick
  p50 2.39ms / p95 12.17ms / p99 18.10ms（目标 10ms，与上一轮 12.36ms 持平）；
  资产事务 p95 48.45ms；RSS 峰值 324MB；房间内容版本 `2026.11.26.3`。证据
  `docs/phase-reports/alpha-02/load-50p10a-10min-s3-threat.json`。

### 遇到的问题及解决方法

1. **旧内容 Release 校验失败**：重启开发栈后 `ContentStore` 每 5 秒报
   “active content release failed validation”。原因是编译地图新增刷点引用了
   旧 Release 没有的怪物模板；服务器保留基线快照并持续报错。发布并激活
   `2026.11.26.3` 后恢复。沉淀 EL-021 与 TD-OPS-18。
2. **预警截图被 HUD 遮挡**：第一次 E2E 截图只拍到“当前目标/技能”面板，红圈被
   盖住。改为等待预警出现前隐藏 HUD、出现后立即截取画布层；`waitForFunction`
   在预警存在时立即返回，避免 900ms 前摇结束才开始截图。
3. **地图编译产物格式漂移**：编译器输出未格式化，diff 变成整文件重排；运行
   Prettier 后只保留新刷点与 checksum。
4. **旧内容测试断言过窄**：`content.test.ts`/`loot.test.ts` 断言“恰好两种怪物”，
   编译测试断言“30 个刷点”；已改为覆盖全部 5 种怪物与 36 个刷点。

### 尚未解决

- 死亡代价、10 级前保护与复活点内容化仍是 S3 后续切片。
- 前摇可被控制技能打断、命中瞬间冲击特效未做。
- 8584 人工试玩与远端 CI 仍待确认。

### 下一步计划

1. 在 8584 试玩白狼王扑击预警与远程蜘蛛/石甲守卫。
2. 做 S3 死亡代价：经验损失进入资产事务、内容化保护阈值与复活点。

提交：`3410881`（`feat(alpha-02): add monster variety and a telegraphed elite pounce`）。

---

## 2026-11-26 体验修复：战斗 HUD 不再遮挡游戏画面

### 问题

用户试玩反馈：中央「当前目标 / 技能 / 战斗记录」面板宽 500px、高度随附近怪物
数量增长，直接盖住角色与战斗视野；面板没有收起方式，技能与日志也混在同一块
区域里。

### 实际改动

- 右侧新增 `hud-right` 纵向栏：小地图 + 附近玩家在上、战斗信息（目标/掉落/
  战斗记录）在下；战斗信息标题栏提供收起/展开（`combat-info-toggle`）。
- 技能拆出为底部居中的 `skill-dock`，高度固定，始终可达；原有 `data-testid`
  全部保留。
- 玩家面板裁剪溢出并让列表内部滚动；修复回归中发现的点击拦截——列表溢出的
  「攻击」按钮会被下方战斗信息面板盖住（pvp 安全区用例先失败后通过）。
- 响应式：≤1180px 收窄右栏/技能坞并把聊天上移；≤860px 维持既有简化布局
  （移动端不在 MVP 范围）。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- 格式/lint/类型：通过。
- 单元/集成：66 文件、410 测试通过。
- 构建：4 个应用成功。
- 浏览器 E2E：31/31 通过（3.6 分钟）；首次全量运行时 pvp 安全区用例因列表
  溢出拦截按钮失败，修复后全量通过。
- 真实浏览器布局：1280×720、1600×1000、收起态三张截图。

### 证据

`docs/phase-reports/alpha-02/hud/`（`world-1280x720.png`、
`world-1600x1000.png`、`combat-info-collapsed.png`）；
报告 `docs/phase-reports/alpha-02/ALPHA_02_HUD_LAYOUT_FIX.md`。

### 尚未解决

- ≤860px 移动端布局未做（不在 MVP 范围）。
- 完整 HUD 重排（对比度、字号、分组）仍属 S4。

---

## 2026-11-26 S3 任务 2：死亡代价与复活点内容化

### 本次任务目标

S3 第一切片让野外“可反应”，但死亡仍然免费。本切片让被怪物击败付出可感知、
不摧毁进度的代价（当前等级经验的 10%，不降级，10 级前保护），规则进入内容
Release 可由运营调整，复活点由 Tiled 地图显式标记。PvP 死亡维持无惩罚
（ADR-021）。

### 实际改动

1. **契约（加法）**
   - 内容 bundle 新增可选 `rules` section 与 `deathPenaltyRuleSchema`
     （`xpLossPermille` 0–1000、`protectBelowLevel` 1–100）。
   - `combat.profile` 增加可选 `deathPenalty`，客户端据此展示规则。
   - 编译地图 manifest 增加可选 `respawnPoint` 与 `playerRespawnPointOf()`。
2. **内容与校验**
   - 基线规则 10% / 10 级保护；校验 warning 覆盖无保护、关闭代价与过严配置。
   - 迁移 `0006` 为 `content_section` 枚举增加 `rules`（expand-only）。
   - 运营草稿更新联合类型增加 `rules` 分支；内容 diff 把 section 统一视作
     键值映射，兼容设置类 section。
3. **领域**
   - `applyDeathPenalty(level, exp, rule)` 纯函数：按当前等级内进度扣千分比，
     最低 0、等级不变；保护等级/关闭规则/0 经验不扣。
4. **应用事务**
   - `AssetService.applyDeathPenalty`：先锁角色行、再写
     `asset_commands(kind='death_penalty', death:<eventId>)`；只更新 `exp` 与
     `version`；重复死亡 ID 返回 `null`；无规则直接返回且不写行。
5. **服务端**
   - 战斗结果记录改用带 `eventId` 的线缆事件，命令死亡与 tick 死亡统一。
   - PvE 死亡入队扣减（与击杀奖励同一串行队列，3 次重试）；PvP 不扣。
   - 提交后更新会话快照、发送 `character.progress`，并向本人发送实际损失
     （warning Toast）或新手保护提示（info）；断线时以数据库为准。
   - 复活点改用 `playerRespawnPointOf(manifest)`。
6. **客户端**
   - 角色面板“经验”下方新增“死亡代价”：`-10% 经验 · 10 级前保护`；
     无规则/关闭时显示“无”。行位置保证 1280×720 无需滚动可见。
7. **地图与复活点**
   - `starter_town`（17,10）与 `starter_wilds`（2,16）出生点标记
     `respawn: true`；编译器至多接受一个标记，未标记回退第一个出生点；
     两图重新编译。
8. **文档与证据**
   - ADR-031、切片报告、EL-022、TD-DATA-11、执行计划/路线图/状态更新。
   - 证据目录 `docs/phase-reports/alpha-02/death/`。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm db:migrate
pnpm verify:invariants
pnpm exec vitest run apps/game-server/test/combat.integration.test.ts -t "experience" --reporter=verbose
```

- 格式/lint/类型：通过。
- 单元/集成：66 文件、**424 测试**通过（新增 14 条）。
- 构建：4 个应用成功。
- 全量 E2E：**31/31 通过**（3.6 分钟，2 worker，独立数据库与端口）。
- 死亡扣减集成：2/2 通过（扣 200 → 180 且等级不变；5 级保护不扣），日志见
  `docs/phase-reports/alpha-02/death/death-penalty-test.log`。
- 资产不变量：全部 0 违例（`death/invariants.txt`）。
- 迁移：`0006_busy_ravenous.sql` 已应用到开发库。
- 内容：发布并激活 `2026.11.26.4`（checksum `7f6c6914…`）；Game Server
  12:53 刷新。
- 开发栈：12:52 重启到最终代码；真实 Chromium 在 1280×720 打开角色面板，
  显示 `-10% 经验 · 10 级前保护`（`death/dev-death-rule.png`）。
- 容量回归：50/50 加入、接受率 99.0%、787 击杀、0 玩家死亡、0 资产失败；
  tick p50 1.34ms / p95 11.58ms / p99 14.89ms（仍高于 10ms 目标，比上轮
  12.17ms 略低）；资产事务 p95 46.37ms、RSS 峰值 317MB；房间内容版本
  `2026.11.26.4`。证据
  `docs/phase-reports/alpha-02/load-50p10a-10min-s3-death.json`。

### 遇到的问题及解决方法

1. **新增内容 section 的横切成本**：`content_section` 是 PostgreSQL 枚举，
   运营草稿契约是判别联合，diff 默认 section 是 `Record<id, entity>`。
   逐项补齐并写迁移 `0006`；`rules` 在 bundle 根部可缺省以保持历史 checksum。
   沉淀 EL-022。
2. **规则行首次被角色面板裁剪**：第一版把“死亡代价”放在“复活”前，1280×720
   截图只能看到到“武器/护甲”。移到“经验”下方并缩短文案，重新截图确认可见。
3. **可选 section 的泛型访问器类型失败**：`contentSectionOf`/`sectionData`
   以泛型 K 索引 bundle 时无法与 `ContentSectionData[K]` 对齐；改为按
   `ContentSection` 联合返回，调用方本就只有内部工具。
4. **PvP 免扣测试需要可观察差异**：被击杀者改为 10 级、200 经验、1 生命，
   一击致死；在复活完成后断言经验仍为 200 且没有 `death_penalty` 行
   （该房间资产队列空闲，若误扣会在 1.5 秒复活窗口内完成）。
5. **全量 E2E 一次偶发失败**：最终全量首次运行时 `classes.spec.ts` 的战士普攻
   用例等待怪物进入 `attack` 超时（怪物 chase → return → patrol）；单跑 5/5、
   全量复跑 31/31 通过。属共享世界实体的测试前置条件问题（EL-019 同类），
   记为 TD-QA-11；本切片没有改动怪物 AI 或攻击路径。

### 尚未解决

- 8584 未实际制造一次死亡（面板规则已实测；扣减由真实 PostgreSQL 集成测试
  覆盖）。
- 远端 CI 仍待确认。
- 经验无连续流水（TD-DATA-11）。

### 下一步计划

1. 8584 试玩死亡代价与新手保护。
2. 进入 S4：装备/掉落/背包与正式美术。

## 2026-11-26 Alpha 0.2 S4 切片 A：装备成长线、稀有品质与背包对比

### 目标

让 1–7 级有分层装备可追：更多可掉落装备、稀有品质、背包属性对比与整理，
补齐“打怪 → 掉落 → 装备 → 再成长”的装备内容。

### 实际改动

1. **契约**
   - `ItemContent.quality?: 'common' | 'rare'`（可选、无默认值，历史 checksum
     不变）；`ItemView.quality` 可选；导出 `ITEM_QUALITIES` /
     `itemQualitySchema` / `ItemQuality`。
2. **内容**
   - 新增 12 件装备：三职业 3/5/7 级武器（7 级稀有）与 4/6/7 级护甲
     （狼王皮甲稀有）；装备总数 17。
   - 掉落：森林狼 3 级武器（各 2%）；毒牙蜘蛛锁子甲 5%；石甲守卫锁子甲 8%、
     铁板甲 4%、5 级武器各 3%；白狼王铁板甲 8%、狼王皮甲 12%、稀有武器各 4%。
   - 3 级武器与锁子甲上架商店（120 / 180 金币）。
3. **校验**
   - error：非装备设置 `quality`。
   - warning：装备无法获得（无掉落、无售价、非初始装备）；不设为 error，
     避免历史 Release 在 `ContentStore` 加载时失效。
4. **客户端**
   - `apps/game-web/src/lib/inventoryView.ts`：品质缺省、属性对比、整理顺序，
     全部纯函数并单测。
   - 背包显示稀有描边/标签与 `data-quality`；装备显示“装备后 / 较当前 ±属性”；
     新增“整理”按钮（只改显示顺序）。
   - 背包与商店面板互斥打开，避免居中商店覆盖背包控制。
5. **测试**
   - `tests/e2e/equipment.spec.ts`：买布衣 → 品质与“装备后 防御 +2” → 整理 →
     装备后服务端防御 8 → 10。
   - `skills.spec.ts`：两个用例分配独立史莱姆刷点（TD-QA-11 类假失败）。
6. **内容发布**
   - 通过 Control API 保存 items/lootTables 草稿（校验 0 问题）、发布并激活
     `2026.11.26.5`（checksum `a0805598…`，新增 12、变更 4）。
   - 开发栈 14:00 重启到新代码；真实 Chromium 实测商店出现锁子甲/百炼战斧，
     背包显示品质与对比。
7. **文档**
   - ADR-032、切片报告、路线图/执行计划/状态/债务/经验更新。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- 格式/lint/类型：通过。
- 单元/集成：67 文件、**433 测试**通过（新增 9 条）。
- 构建：4 个应用成功。
- 全量 E2E：**32/32 通过**（3.8 分钟，2 worker，独立数据库与端口）。
- 内容发布：draft 200、validate 200（valid=true, 0 issues）、publish 201、
  activate 200。
- 开发栈实测：`docs/phase-reports/alpha-02/equipment/dev-bag.png`、
  `dev-shop.png`。

### 遇到的问题及解决方法

1. **新校验规则拒绝历史 Release**：error 级“装备必须可获得”使 EL-004 的
   legacy payload 测试失败；`ContentStore` 加载活动 Release 时也会校验，旧
   baseline 会被拒。改为 warning；沉淀 EL-023。
2. **掉落表固定 RNG 序列耗尽**：`forest_wolf` 条目变多；测试按条目数生成序列。
3. **商店居中面板拦截背包按钮**：打开背包时关闭商店、打开商店时关闭背包；
   商店仍覆盖顶部开关，记录 TD-CLI-14。
4. **skills E2E 共用史莱姆假失败**：两个用例分别使用 `wilds_slime_10` 与
   `wilds_slime_8`，全量 32/32 稳定。

### 尚未解决

- 稀有品质只有单测与 CSS 覆盖（E2E 无法稳定获得稀有掉落）。
- 正式图标/美术（TD-CLI-13）、丢弃物品、装备槽扩展未做。
- 远端 CI 仍待确认。

### 下一步计划

1. 8584 试玩：击杀森林狼/石甲守卫/白狼王观察掉落，回城购买 3 级武器。
2. S4 后续：图标与 HUD 重排、正式美术、丢弃物品、装备槽评估。
3. 确认远端 CI。

### 追加修复（2026-11-26）：装备属性行显示不完整

- 反馈：带生命的护甲在背包只显示“防御 +X”，而对比行出现“生命 +Y”，两处
  信息不一致，玩家无法确认装备实际提供哪些属性。
- 改动：新增 `itemStatLine`（`apps/game-web/src/lib/inventoryView.ts`），
  统一输出攻击/防御/生命/法力与消耗品回复；背包物品、装备槽与商店共用该函数。
- 测试：`inventoryView.test.ts` 新增 3 条属性行断言；`equipment.spec.ts` 增加
  商店皮甲“防御 +5 · 生命 +15”与背包/装备槽属性断言。
- 结果：67 文件、**436 测试**通过；全量 E2E **32/32** 通过；构建与静态门禁通过。
- 开发栈：Vite 热更新已生效，`dev-shop.png` / `dev-bag.png` 更新为统一属性行。

## 2026-11-26 Alpha 0.2 S4 切片 B：废墟区域与 8–10 级成长线

### 本次任务目标

补齐路线图中的第三片野外区域，把有效成长线从 7 级延伸到 10 级：新地图、
8–10 级三种怪物、9–10 级装备与高等级药水，让 10 级技能与商店金币有对应内容。

### 实际改动

1. **地图**
   - 新增 `content/maps/ruined_fields.tmj`（48×36，残垣庭院/石地/水池），
     `kind: wilds`，出生/复活点 `(4,18)`，29 个刷点。
   - 主城西北角 `(3,2)` 新增“前往废墟”传送门；废墟 `(3,18)` 返回主城 `(4,2)`。
   - `content/assets/manifest.json` 注册地图；`pnpm maps:compile` 生成
     `content/maps/compiled/ruined_fields.json`。
   - 起初把入口放在荒野 `(13,10)`，全量 E2E 暴露它与 PvP 决斗点
     `(12,10)/(13,10)` 及多条寻路重合，玩家被意外传送；改为主城入口。
2. **契约与地图注册**
   - `RUINED_FIELDS_MAP_ID`、`RUINED_FIELDS_MAP` 与 `MAP_MANIFESTS` 增加第三图。
   - 契约测试覆盖三图解析、双向传送门与目标存在；编译测试锁定刷点、怪物集合、
     复活点与 PvP 模式；`starter_wilds.tmj` 恢复原样。
3. **内容**（`packages/content-schema/src/baseContent.ts`）
   - 新怪物：骷髅武士 Lv8 / 腐化术士 Lv9（远程）/ 废墟石像鬼 Lv10（精英，
     1s 前摇）。
   - 新装备：三职业 9 级武器、8 级石壳胸甲（商店 600 金币）、三职业 10 级稀有
     武器与石像鬼护心甲（稀有）。
   - 新消耗品：疗伤药（+120 HP）、凝神药（+90 MP），5 级可用，商店出售。
   - 新材料：碎骨、腐化水晶、石像鬼之核；三张掉落表经验 140/180/360。
4. **客户端**
   - `MonsterVisual` 增加三种怪物的配色与占位造型（骨架、兜帽术士、展翼石像鬼）。
   - 地图名、小地图、PvP 标记沿用契约 manifest，无需额外分支。
5. **测试**
   - `tests/e2e/ruins.spec.ts`：主城→废墟传送、残垣废墟名称、野外标记、
     入口可见骷髅、返回主城；证据截图 `alpha-02/ruins/ruins-entry.png`。
   - `world.integration.test.ts`：加入废墟 1.2s 内看到 3 只未移动的怪物
     （验证 join 时填充视野；怪物首次思考在 1.8s，窗口内不会移动）。
   - 修复 economy 与 autoAttack 共用 `wilds_slime_1` 的并行冲突：economy 改用
     `wilds_slime_11`。
   - 修复 classes 攻击动画用例依赖怪物 `attack` 状态：改为等待角色自身到达
     目标格后触发攻击。
6. **内容发布**
   - 用 Control API 重写 classes/skills/monsters/items/lootTables/rules 草稿为
     基线内容（清除旧草稿对新增内容的覆盖），校验 0 error，发布并激活
     `2026.11.26.6`（checksum `c337c92c…`，新增 19 个实体）。
   - 发布时的 3 条“无刷点使用该怪物”warning 来自运行中的旧 Control API 进程
     （未加载新编译地图），重启后不再出现，不影响 Release payload。

### 命令与结果

```bash
pnpm maps:compile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants docs/phase-reports/alpha-02/ruins/invariants.txt
```

- 格式/lint/类型：通过。
- 单元/集成：67 文件、**439 测试**通过（新增 3 条）。
- 构建：4 个应用成功。
- 全量 E2E：**33/33 通过**（3.8 分钟，2 worker，独立数据库与端口）。
- 内容：`2026.11.26.6` 已激活（checksum `c337c92c…`）。
- 资产不变量：6/7 为 0；`stale_expired_open_ground=1` 为 14:17 荒野遗留
  `slime_gel`（早于本切片），重启或重新进入荒野后清理。

### 遇到的问题及解决方法

1. **传送门放在荒野与既有用例冲突**：`(13,10)` 是 PvP 决斗点相邻格，也是
   autoAttack/economy 等用例寻路经过的格子；全量 E2E 出现 5 个失败。把入口
   改到主城西北角，荒野地图恢复原样，失败全部消失。沉淀 EL-024。
2. **误判了一个“AOI 入图缺陷”**：废墟入口最初只看到移动过的怪，怀疑 join
   未刷新新玩家视野。加日志验证 `affected` 已包含新玩家本人，客户端在
   ~100ms 内收到 3 只怪；回退无实质作用的改动，保留一条“join 视野”回归测试。
3. **共享刷点与 AI 状态导致门禁偶发**：economy/autoAttack 共用史莱姆；
   classes 等待怪物 `attack`。分别改为独占刷点与“等待自身到达”后稳定。
4. **开发栈无法重启**：自动模式拦截了 kill，终端标签已满；开发栈仍运行
   14:00 代码，8584 暂不能进入废墟，需按 §下一步 手工重启。

### 尚未解决

- 8584 人工试玩（需重启开发栈）；50 人容量回归未复跑；远端 CI 未确认。
- 稀有品质浏览器表现、正式美术与物品图标仍未做。

### 下一步计划

1. 重启开发栈后试玩废墟与 8–10 级掉落。
2. 复跑 50×10min 容量回归（三张地图）。
3. S4 剩余：图标、HUD 重排、正式美术；确认远端 CI。

### 追加（2026-11-26 17:24–17:36）：开发栈重启、废墟实测与 50 人容量回归

- 用户授权助手负责开发栈重启（"以后也由你重启"）。旧的 14:00 进程组 61918
  已停止，17:24 以 `nohup pnpm dev` 重启到 S4-B 代码（进程组 1087，日志
  `/tmp/wl-dev-stack.log`），四个服务 `/health/ready` 与页面均 200。
- 重启后 Control API `POST /admin/content/validate`：`valid=true`、`issues=[]`
  （旧进程的 3 条“无刷点使用该怪物”警告消失）。
- 8584 真实 Chromium：注册→主城→西北角传送→残垣废墟（地图名、野外 PK、
  附近怪物 3、Lv.8 骷髅武士）→返回主城；截图
  `docs/phase-reports/alpha-02/ruins/dev-ruins.png`。
- 14:17 遗留的过期 `slime_gel` 已由重启后的 Room 启动清理归零；复查 stale=0。
- 50 人 × 10 分钟容量回归（17:25–17:35，内容 `2026.11.26.6`）：
  50/50 加入、接受率 99.1%、780 击杀、0 玩家死亡、0 资产失败；
  tick p50 1.1ms / p95 14.75ms / p99 21.01ms / max 23ms；资产事务 p95
  47.37ms；wsOut 485MB / wsIn 8.8MB；RSS 峰值 329MB（中段后 250–330MB）。
  证据 `docs/phase-reports/alpha-02/ruins/load-50p10a-10min-s4b.json`。
  脚本门禁（p95<25、p99<40、接受率≥70%、0 资产失败）通过，但路线图 10ms
  p95 目标仍超标；tick 路径本切片未改，下一步单独剖析。
- 压测后资产不变量（`invariants-after-restart.txt`）全部通过；压测遗留的
  未领取掉落将在下次进入该地图或重启 Game Server 时清理（既有机制）。
- 观察到重启后的废墟 Room 有玩家实战（14 击杀、15/19 件拾取、2 次死亡、
  0 资产失败），说明新区域在真实客户端可玩；未在对方游玩时重启服务。

## 2026-11-26 Alpha 0.2 S4-C：物品图标与品质呈现

### 目标

让背包、装备槽、商店与附近掉落显示物品图标，统一品质视觉；图标走可复现的
占位资源管线，正式美术到位时可替换 PNG 而不改代码。

### 实际改动

1. **契约**
   - `AssetManifest.itemIcons`：图集文件、32px 格子、8×6 行列、模板 → 帧、
     四种物品类型回退帧与通用回退帧；帧越界或缺少 kind 回退会校验失败；
     `style: 'procedural-placeholder'` 标记占位。
   - `ShopOffer.quality?` 可选字段，服务端从内容快照下发。
2. **资源生成**
   - 抽出 `content/assets/raster.ts`（像素画布 + PNG 编码），角色生成器改用
     共享实现；三张角色贴图重新生成后逐字节不变。
   - 新增 `content/assets/generateItemIcons.ts`：37 件物品的独立造型与配色，
     生成 256×192 图集；从 `BASE_CONTENT_BUNDLE` 校验覆盖率，缺图标或
     manifest 映射过期时失败并打印期望 JSON。
   - `pnpm assets:generate` 同时生成角色与图标；manifest 升到 `alpha0.2.2`，
     三张编译地图重算。
3. **客户端**
   - `lib/itemIcons.ts`：模板 → 类型 → 通用帧解析与 CSS 图集定位。
   - `GameScreen` 的 `ItemIcon` 组件用于背包、装备槽、商店购买/出售与掉落列表；
     装备槽和商店行补 `data-quality` 与“稀有”标签，复用背包的金色样式。
   - 背包卡头部改为图标 + 名称 + 数量；商店行改为图标 + 文本块，价格/按钮列
     不变；新增样式见 `styles.css`。
4. **服务端**
   - `worldMapRoom` 组装商店目录时附带可选 `quality`；价格与结算不变。
5. **测试**
   - 契约测试：图集帧越界、缺 kind、商店品质合法/非法。
   - 客户端纯函数测试：模板优先、kind 回退、通用回退、定位。
   - E2E `tests/e2e/itemIcons.spec.ts`：背包 3 项、装备槽、商店 9 项与出售行
     图标帧号与 manifest 一致；economy 用例补掉落行图标断言。
   - 真实浏览器（8584，未重启开发栈）：背包 3/3、商店 9/9 图标，截图
     `docs/phase-reports/alpha-02/icons/dev-*.png`。

### 命令与结果

```bash
pnpm assets:generate
pnpm maps:compile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- 格式/lint/类型：通过。
- 单元/集成：68 文件、**448 测试**通过（新增 9 条）。
- 构建：4 个应用成功。
- 全量 E2E：首次 33/34（combat 点击目标偶发失败，单跑复测通过），第二次
  **34/34 通过**（4.0 分钟，2 worker，独立数据库与端口）。
- 开发栈：17:45 前后有玩家在废墟游玩，未重启；客户端资源经 Vite 热更新，
  真实 Chromium 实测图标渲染正常。服务端仅新增可选商店品质字段，当前商店
  无稀有商品，旧服务端下按 `common` 展示。

### 遇到的问题及解决方法

1. **Playwright 直接 import JSON 失败**：`itemIcons.spec.ts` 顶层 JSON 导入在
   加载测试阶段报 `needs an import attribute of "type: json"`。改为
   `readFileSync` + `JSON.parse`，并显式收窄类型；沉淀 EL-025。
2. **全量 E2E 的 combat 偶发失败**：点击怪物后目标面板未出现，单独重跑通过；
   与 TD-QA-11 的共享世界实体/移动时机一致，本轮不扩大处理。
3. **历史截图被全量 E2E 重写**：按既有做法用 `git stash` 收起产物变更，只保留
   `docs/phase-reports/alpha-02/icons/` 新证据。
4. **开发栈未重启**：验证时有玩家在线，按既有约定不打断；18:10 确认无人在线后
   尝试 `kill -TERM -1087`，被环境权限拦截，未重启。服务端品质字段待用户授权
   后加载。

### 尚未解决

- 稀有物品在真实浏览器中的描边/标签仍未截到（无稳定获取路径）。
- Phaser 场景内地面掉落标记仍是几何图形，只有 HUD 掉落列表显示图标。
- （已在下方追加的重启中解决）开发栈后端一度仍是 17:24 的进程。

### 下一步计划

1. 用户授权后重启开发栈（或无人在线且环境允许停止进程组时）；8584 试玩背包/
   商店图标。
2. S4 剩余：HUD 完整重排与商店面板停靠（TD-CLI-14）、正式 tileset/角色/怪物
   与图标美术（TD-CLI-13）、地面掉落物图标。
3. 为 50 人回归 tick p95 14.75ms 做剖析；确认远端 CI。

### 追加（2026-11-26 18:10）：用户确认后重启开发栈

- 重启前 `/metrics`：0 个 Room、0 名玩家。
- 旧进程组 1087 已停止；18:10 以 `nohup pnpm dev` 启动新进程组 48363，日志
  `/tmp/wl-dev-stack.log`。
- 84/85/86/87 `/health/ready` 均为 200；Game Server 日志显示内容刷新无错误；
  Control API `POST /api/v1/admin/content/validate` 返回 `issues=0`。
- 8584 真实 Chromium 复验：背包 3/3、商店 9/9 行有图标（帧 35/19/20）；商店
  行 `data-quality=common`（当前商店无稀有商品）。证据写入 `/tmp/wl-icon-evidence`，
  未覆盖已提交的历史截图。

## 2026-11-26 Alpha 0.2 S4-D：HUD 信息层级重排

### 目标

完成路线图 S4 的「HUD 完整重排」：世界画面以战斗视野为先，常驻信息可读且
可收起，商店不再挡住顶部开关。只改客户端布局与展示，不做正式美术。

### 实际改动

1. **左上状态板**
   - 删除世界内品牌块（「浏览器原生 · 实时多人 / Web Legend」）；`brand`、
     `phase` 相关 CSS 一并移除（进入页仍使用 `.eyebrow` / `.entry-brand`）。
   - 新增 364px 不透明 `player-card`：角色名 / 职业等级 / PvP 标记、分色
     HP 与法力、经验条与金币、操作按钮行；保留全部既有 test id 与
     `vitals` 文本格式。
   - 「返回角色」从连接卡片移入按钮行。
2. **连接卡片**
   - 更紧凑（300px、padding 10/14）；连接成功时隐藏 detail 行，断线/失败时
     仍显示原因与「重新加入」。
3. **聊天**
   - 新增 `chatOpen` 状态与「收起 / 展开」按钮（`chat-toggle`，同步
     `aria-expanded`）；收起后隐藏消息列表与输入框。
   - ≤860px 不再 `display: none`，停靠在技能坞上方（左 12、bottom 176、
     宽 300、高 180）。
4. **商店**
   - `.shop-panel` 从居中改为右侧停靠（top 132 / right 40 / bottom 84 /
     width 360），列表内部滚动、底部说明固定。
   - 打开背包直接替换商店（既有互斥逻辑不变，删除“必须先关闭”的注释与
     E2E 绕行）。
5. **右栏**
   - 起点 208 → 132px（≤1180px 144px）；状态板/连接卡片按断线最坏高度预留。
   - 「附近玩家」上限 72% → 76%，最后一行不再被裁。
   - `--ink-raised` 0.82 → 0.9。
6. **测试**
   - 新增 `tests/e2e/hud.spec.ts` 3 条：状态板尺寸/位置与信息可见、聊天收起
     与展开、商店右停靠且与背包按钮不重叠并能直接切背包。
   - `equipment.spec.ts`：商店打开时直接点背包，断言商店消失、背包可见。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- 格式/lint/类型：通过。
- 单元/集成：68 文件、**448 测试**通过。
- 构建：4 个应用成功。
- 全量 E2E：首次 **36/37**（`shop.spec.ts` 超时），修复后 **37/37 通过**
  （3.9 分钟，2 worker，独立库/端口）。
- 真实浏览器：8584（Vite 热更新到本切片客户端）1280×720 / 1600×1000、聊天
  收起、商店停靠、野外击杀掉落均截图；证据
  `docs/phase-reports/alpha-02/hud-relayout/`。

### 遇到的问题及解决方法

1. **全量 E2E 中 `shop.spec.ts` 稳定超时 180s**：离开世界后点「返回角色」无效。
   `elementFromPoint` 实测：断线状态连接卡片从约 90px 增到 124px，越过右栏
   起点 112px，返回按钮中心命中的是 `minimap-heading`，Playwright 判定不可点。
   修复：返回按钮移入状态板、连接卡片加宽避免 meta 换行、右栏起点改为 132px
   （按连接卡片最坏状态 102px/底部 122px 计算）。修复后按钮中心命中自身，
   全量 37/37。沉淀 EL-026。
2. **1600×1000 下状态板按钮换行**：五个按钮（含“杂货商”）在 340px 内放不下；
   加宽到 364px 后单行显示。
3. **720p 右栏战斗信息过矮**：右栏起点提前 76px 后，战斗信息从约 90px 增至
   约 180px；同时修正「附近玩家」上限，避免最后一行被裁切。

### 尚未解决

- 世界内名字标签在角色/怪物/ NPC 相邻时仍重叠（新增 TD-CLI-16）。
- ≤860px 只有 800×720 截图抽查，没有 E2E 覆盖（移动端不在 MVP 验收范围）。
- 正式美术（TD-CLI-13）与场景地面掉落图标（TD-CLI-15）仍开放。
- 未做真实玩家手感访谈；未复跑 50 人容量回归（本切片无服务端/协议/内容/
  数据库路径变化）。

### 提交

- `c8ea7b7` `feat(alpha-02): rework the in-world HUD around the play area`
  （21 个文件：客户端布局、2 个 E2E 文件、阶段报告与 9 张证据图、状态/
  路线/债务/经验/演进日志）。

### 下一步计划

1. 8584 试玩新 HUD：状态板、聊天收起、商店停靠与背包切换。
2. S4 收尾：正式美术（TD-CLI-13）、地面掉落图标（TD-CLI-15）、世界标签
   规则（TD-CLI-16）。
3. 为 tick p95 14.75ms 做剖析；确认远端 CI。

## 2026-11-26 Alpha 0.2 S4-E：世界场景信息可读性

### 目标

关闭 S4 最后两个非美术项：场景内地面掉落物没有物品图标（TD-CLI-15），以及
玩家/怪物/NPC 名字标签互相重叠（TD-CLI-16）。只改客户端 Phaser 展示与测试
钩子，不改服务端、协议、内容或数据库。

### 实际改动

1. **地面掉落图标**
   - `WorldScene.preload` 把 `content/assets/generated/item_icons.png` 注册为
     32px spritesheet；`mapCatalog` 导出共享纹理键 `ITEM_ICON_TEXTURE_KEY`。
   - `LootVisual` 从发光袋状几何体改为暗色圆盘 + 模板描边 + 图集图标，名称与
     数量保留在圆盘上方；帧号由 `itemIconFrame` 按“模板 → 类型 → 通用”解析。
   - 新增 `lootIconFrame(dropId)` 只读钩子，类型写入应用与 E2E 的
     `global.d.ts`。
2. **名字标签避让**
   - 新增纯函数 `apps/game-web/src/game/labelLayout.ts`：
     自己 1000 > 当前目标 900 > NPC 700 > 其他玩家 500 > 怪物 400；
     同优先级按距自己更近者优先，再按 id 稳定排序；只隐藏与更高优先级矩形
     相交（含 3px 间距）的标签，不移动位置。
   - `WorldScene` 每 100ms 刷新一次，选择/取消目标立即刷新；玩家与怪物死亡
     时隐藏名字，复活后恢复；NPC 标签存入 `npcLabels` 供布局使用。
   - 新增 `labels()` 只读钩子，返回 id/类型/文本/可见性/矩形。
3. **测试**
   - `labelLayout.test.ts` 6 条：不重叠、优先级、距离、稳定并列、间距边界、
     空输入。
   - `hud.spec.ts` 新增“玩家站到杂货商脚下”的用例：自己可见、NPC 隐藏、
     两个矩形确实相交、所有可见标签两两不重叠；截图
     `scene-readable/name-plates.png`。
   - `economy.spec.ts` 在既有击杀链路中读取 manifest 的 `slime_gel` 帧号，
     断言场景标记使用同一帧；截图 `scene-readable/loot-ground-icon.png`。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
```

- 格式/lint/类型：通过（lint 全仓 0 error / 0 warning）。
- 单元/集成：69 文件、**454 测试**通过（新增 6 条）。
- 构建：4 个应用成功。
- 全量 E2E：首轮 37/38（`multiplayer.spec.ts` 250ms 可见性得到 337ms），
  该用例 `--repeat-each=3` 3/3、单跑 262ms 仍失败一次，随后全量重跑
  **38/38 通过**（4.1 分钟，2 worker，独立库/端口）。
- 资产不变量：`pnpm verify:invariants` 7 项全部 0（重启后）。
- 真实浏览器：8584 真实 Chromium 验证标签避让与掉落帧 18；截图
  `scene-readable/dev-name-plates.png`、`dev-loot-icon.png`。

### 遇到的问题及解决方法

1. **Playwright 不能直接 import JSON**：最初在 `economy.spec.ts` 顶层
   `import rawAssetManifest from '../../content/assets/manifest.json'`，tsc 与
   vitest 通过，但 `pnpm test:e2e` 加载测试文件即失败（ESM 要求 import
   attribute）。按 EL-025 改为 `readFileSync` + `JSON.parse` 并显式收窄类型。
2. **250ms 可见性断言偶发超时**：首轮全量 337ms、单跑 262ms；重复 3/3 与全量
   重跑均通过，符合已知的软件渲染时序抖动（§6 风险）。未降低断言阈值。
3. **手工验证留下过期掉落**：8584 击杀后未拾取，`verify:invariants` 报
   `stale_expired_open_ground=1`。开发栈无在线 Room，按授权于 19:17 重启
   （进程组 64926），启动清理后 7/7 归零，4 个服务健康检查 200。

### 尚未解决

- 传送门与地面掉落文字未纳入同一标签避让布局；当前地图边缘未观察到冲突。
- 正式美术（TD-CLI-13）仍开放；未做真实玩家手感访谈。
- 本切片只改客户端展示，未复跑 50 人容量回归。

### 提交

- `7937f3c` `feat(alpha-02): make world drops and name plates readable`
  （18 个文件：场景显示、标签纯函数与测试、2 个 E2E 文件、阶段报告与 5 个证据
  文件）。

### 下一步计划

1. 8584 试玩掉落图标与标签避让。
2. S4 收尾：正式美术（TD-CLI-13）；丢弃物品；评估扩展装备槽（TD-DATA-05）。
3. 为 tick p95 14.75ms 做剖析；确认远端 CI。

## 2026-11-26 Alpha 0.2 S4-F：50 人 tick p95 剖析与 AOI 批处理

### 目标

S4-B 的 50 人 × 10 分钟回归 tick p95 14.75ms、p99 21.01ms，高于 10ms 目标；
p50 只有 1.1ms。先证明长尾来自哪里，只优化被剖面指向的路径。

### 实际改动

1. **剖面方法**
   - 生产构建 `apps/game-server/dist/index.js` + `NODE_ENV=test`，配合 Vite 84
     与 Control API 86，排除 tsx 转译与开发日志。
   - 先跑 50 人 × 2 分钟无剖析基线；再用 `node --cpu-prof
--cpu-prof-interval=500` 重跑同一负载，按 `simulateTick` 子树聚合自耗时。
2. **AOI 每 tick 去重刷新**
   - `WorldMapRoom` 新增 `pendingViewRefresh`；玩家与怪物移动把受影响观察者
     入队，tick 末 `flushViewRefresh()` 去重后统一刷新。
   - 刷新仍在 tick 内完成，`session.visible` 对下一 tick 生效的边界不变。
3. **减少每次刷新的分配**
   - `InterestManager.collectVisibleIds(id, target)` 直接填充调用方 Set；
     `collectNeighbourhood` 供 `move` 复用；`visibleIdsFor` API 保留。
   - `StateViewPublisher` 复用 `requested` 与 `desired` Set。
   - `simulateTick` 只调用一次 `listPlayers()`，同时供位置快照、传送门检测、
     AOI 移动与 `syncPlayers` 使用。

### 命令与结果

```bash
NODE_ENV=test node --cpu-prof --cpu-prof-dir=/tmp/wl-cpu apps/game-server/dist/index.js
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 pnpm load:scenario
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 pnpm load:scenario
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
```

- 剖面：`simulateTick` 子树 9.7s/333s（占墙钟 2.9%、非空闲 CPU 约 39%）；
  `visibleIdsFor` 22.7% + `refresh` 15.8% + `neighbourhoodIds` 6.7%，
  事件序列化/写入约 28%，寻路 0.4%。
- 2 分钟改前/改后：p50 1.71 → 1.11ms，p95 12.59 → **5.15ms**，
  p99 17.30 → 7.87ms，max 20.28 → 9.29ms。
- 50 人 × 10 分钟：50/50、接受率 99.0%、784 击杀、0 资产失败；
  p50 0.69ms、p95 **5.34ms**、p99 6.67ms、max 6.92ms；资产 p95 48.4ms，
  RSS 峰值 289MB。
- 单元/集成：69 文件、**455 测试**通过（新增 1 条 AOI collect 测试）。
- 构建：4 个应用成功；lint/typecheck/format 通过。
- 全量 E2E：首轮 37/38（250ms 可见性 307ms），单跑 3/3、全量重跑
  **38/38 通过**（4.3 分钟，2 worker）。
- 资产不变量：重启开发栈后 7/7 为 0。

### 遇到的问题及解决方法

1. **tsx 包装进程吞掉 CPU profile**：最初用 `NODE_OPTIONS=--cpu-prof` 启动
   `pnpm dev`，只得到 tsx CLI 包装进程的空剖面。改为直接运行生产构建
   `node --cpu-prof dist/index.js`，并关闭 dev 日志 transport（`NODE_ENV=test`）。
2. **压测脚本偶尔在收尾 `room.leave()` 挂起**：10 分钟场景本次正常退出；
   2 分钟场景有一次在写完 summary 后挂起，用 `timeout` 收口。证据文件在挂起前
   已写入，不影响 tick 指标；未在本切片修改压测脚本。
3. **全量 E2E 的 250ms 时序断言再次抖动**：与 S4-E 相同，未降低阈值；单独
   重复与全量重跑均通过。
4. **压测 summary 带出本地 `DATABASE_URL`**：证据 JSON 的 `options` 原样写入
   连接串。虽然它与 `.env.example` 的开发默认值相同，仍违反“连接串不进 Git”
   的卫生要求；已把三份证据中的值改为 `[redacted]`，并让
   `worldScenario.ts` 以后固定输出占位符。

### 尚未解决

- tick 内战斗事件逐客户端 msgpackr 打包与 `writev` 仍占约 28%（新增 TD-SRV-10，
  P3）；团战事件增长前再设计批量协议。
- 资产队列 p95 48.4ms 未变化，未阻塞 tick；按 TD-SRV-03 另行评估。
- 未做跨机器/多进程容量趋势；本轮为共享开发机上的单进程 50 人。

### 提交

- `dcad681` `fix(alpha-02): batch AOI refreshes to cut the 50-player tick tail`
  （10 个文件：AOI/房间/兴趣管理、1 条单测、阶段报告与 5 个性能证据文件）。
- `a03a5ee` `fix(alpha-02): redact the database URL from load evidence`
  （4 个文件：压测脚本与三份证据 JSON）。

### 下一步计划

1. 8584 试玩并观察 tick 长尾与手感。
2. S4 收尾：正式美术（TD-CLI-13）；丢弃物品；评估扩展装备槽（TD-DATA-05）。
3. 确认远端 CI；后续版本继续用 `pnpm load:regression` 观察趋势。

## 2026-11-26 Alpha 0.2 S4-G：主城守卫任务链

### 目标

关闭 Alpha 0.2 最后一个非美术体验缺口：新角色进入主城后没有目标、守卫不可
交互。交付一条内容驱动、服务端权威、可交付的三步击杀任务链。

### 实际改动

1. **契约**
   - 新增可选内容 section `quests`：任务 id/标题/描述/发布 NPC/等级/前置/
     击杀目标/奖励；目标类型为封闭白名单（v1 仅 kill）。
   - 新增 `quests.ts` 线缆契约：`QuestView`、`quest.snapshot`、
     `quest.update`、`quest.accept` / `quest.claim`；NPC 交互距离 3 格。
   - 拒绝码增加 `QUEST_UNAVAILABLE` / `QUEST_NOT_ACTIVE` /
     `QUEST_NOT_COMPLETE` / `QUEST_ALREADY_CLAIMED`；资产命令增加
     `quest_accept` / `quest_claim`。
   - `adminContentDraftUpdateSchema` 增加 quests 分支。
2. **内容与校验**
   - 基线三条任务：清理史莱姆（3 只）、狼群的踪迹（3 只，3 级+前置）、
     白狼王的威胁（1 只，5 级+前置）。
   - 校验发布 NPC/前置循环/目标怪物/奖励物品/堆叠上限；空奖励与等级差距告警。
3. **持久化**
   - 迁移 `0007` 建 `character_quests`（唯一角色+任务、状态、进度、三个时间戳、
     CHECK）；迁移 `0008` 为 `content_section` 增加 `quests`。
4. **应用与领域**
   - `grantKillReward` 在同一事务推进活动任务，重复击杀引用不推进。
   - `acceptQuest` / `claimQuest`：角色行锁、幂等命令、等级/前置/状态校验；
     交付单事务发经验（可升级）、金币+账本、物品（背包满整体回滚）。
   - `game-domain/quests.ts` 纯函数：状态推导、前置必须 claimed、视图解析、
     击杀推进与封顶。
5. **服务端与客户端**
   - 加入后发送私有 `quest.snapshot`；击杀提交后发 `quest.update`；接取/交付
     校验 NPC 在本地图且 ≤3 格。
   - 状态板「任务 J」按钮、任务追踪、可接提示；右侧任务面板显示描述/进度/
     奖励/锁定原因；NPC 点击按商人优先、任务发布者次之；切图关闭面板。
6. **内容发布**
   - 开发库应用 `0007`/`0008`；保存 quests 草稿、校验 0 issue、发布并激活
     `2026.11.26.7`（checksum `e1c97389…`，新增 3）。
   - 开发栈重启到本切片代码；Game Server 日志确认内容刷新。
7. **文档**
   - ADR-034、切片报告、PROJECT_STATUS/WORKLOG/EVOLUTION_LOG/债务/经验更新。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 pnpm load:scenario
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：70 文件、**472 测试**通过（新增 17 条）。
- 构建：4 个应用成功。
- 全量 E2E：**39/39 通过**（4.3 分钟，2 worker，独立库/端口）。
- 任务 E2E：接取 → 3 次击杀 → 回城交付 → 金币 +20、药水 +1、追踪清空。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 10 分钟正式门禁：50/50、接受率 99.0%、772 击杀、0 资产失败；
  tick p50 1.85ms / p95 **6.53ms** / p99 9.82ms / max 10.9ms；资产事务
  p95 59.34ms；RSS 峰值约 306MB。2 分钟 sanity p95 4.37ms。
- 真实 Chromium（8584）：可接提示 → 守卫面板 → 接取成功；服务端返回
  `quest_slime_cleanup=active`、后续任务 locked。

### 遇到的问题及解决方法

1. **保存 quests 草稿 422**：`adminContentDraftUpdateSchema` 是手写的 section
   判别联合，未随 `CONTENT_SECTIONS` 扩展；补分支并重启 Control API 后通过。
   沉淀 EL-029。
2. **任务 E2E 抢走 combat.spec 的刷点**：第一版选“视野内第一只活史莱姆”，
   与 `wilds_slime_2` 重叠，导致技能冷却断言偶发失败；改为独占
   `wilds_slime_9` 并在注释登记。全量 39/39。
3. **1 级角色横穿野区被击杀**：最初让角色去远处三只史莱姆，途中被狼/蜘蛛
   击杀，攻击被拒；改为入口附近的独占刷点等待刷新，三次击杀都在安全区域。
4. **压测脚本未注册新消息**：50 人压测每机器人打印未注册 `quest.snapshot`；
   已在 `worldScenario.ts` 加空处理器。

### 尚未解决

- 8584 完整人工试玩仍待用户完成；远端 CI 待确认。
- 任务仅 kill 目标、单 NPC 接取/交付、无放弃/日志/每日/组队共享；经验交付
  仍无连续流水（TD-DATA-11）。

### 提交

- `0cad7ee` `feat(alpha-02): add the town guard quest chain`
  （53 个文件：契约/内容/领域/应用/持久化/服务端/客户端、迁移 `0007`/`0008`、
  17 条测试、任务 E2E、ADR/报告/证据与状态文档）。
- `ca5abd1` `fix(alpha-02): refresh the quest chain after a claim or level-up`
  （交付/升级后重发整条任务快照，下一任务无需重登即可解锁；E2E 增加解锁断言）。

### 下一步计划

1. 8584 试玩完整任务链（接取 → 出城 → 回城交付）。
2. 50 人 × 10 分钟容量回归，观察任务查询对资产 p95 的影响。
3. S4 剩余正式美术（TD-CLI-13）；Alpha 0.3 任务系统扩展在确认 0.2 验收后评估。

## 2026-11-27 Alpha 0.3 S1：组队与共享击杀经验

### 目标

关闭“多人交互没有合作目标”的核心缺口：两名玩家可以在真实浏览器中组队、
看到彼此等级与 HP，并在同一张地图内分享击杀经验；不做队伍聊天、跨图队伍与
掉落分配。

### 实际改动

1. **契约**
   - 新增 `packages/contracts/src/party.ts`：`PartyView`、`PartyMemberView`、
     `party.snapshot`、`party.invite` 与 `party.invite/accept/decline/leave`
     四条客户端命令；线缆上限 8 人、邀请距离 15 格、邀请有效期 30 秒。
   - 拒绝码 `PARTY_SELF`、`PARTY_TARGET_UNAVAILABLE`、`PARTY_TARGET_BUSY`、
     `PARTY_ALREADY_IN_PARTY`、`PARTY_FULL`、`PARTY_INVITE_EXPIRED`、
     `PARTY_NOT_IN_PARTY`；`assetCommandKind` 增加 `party_kill_reward`。
   - 内容 `rules.party = { maxMembers, assistSharePermille, assistRangeTiles }`。
2. **内容与校验**
   - 基线规则：4 人、12 格、50% 基础经验；分享为 0 或范围过小时给出警告。
3. **服务端**
   - 新增 `PartyRegistry`（内存）：接受时创建队伍、队长按加入顺序提升、最后
     一人离开时解散、同一目标只保留一条邀请并按时清理、离队者邀请失效。
   - `WorldMapRoom`：四条命令复用 `CommandGuard`（协议/重复 id/序号/限频），
     同步执行；名单只发私有 `party.snapshot`；加入世界补发；传送/最终离开/
     宽限结束时移除队员并通知。
   - 击杀共享：击杀者完整奖励之后，为同队、存活、在线、范围内队友各排入一次
     `grantPartyKillExperience`。
4. **应用**
   - `AssetService.grantPartyKillExperience`：角色行锁 + 幂等键
     `party_kill:<reference>:<characterId>`；经验按基础经验千分比取整，不消耗
     RNG；可升级回满；不改金币/掉落/任务进度；无新表与迁移。
5. **客户端**
   - 附近玩家行「邀请」、邀请提示（30 秒后消失）、左上队伍面板与「离队」；
     面板在状态板下方，不遮挡游戏区；调试钩子用于 Playwright。
6. **压测脚本**
   - `worldScenario.ts` 注册 `party.snapshot` / `party.invite` 空处理器。
7. **内容发布**
   - 保存 `rules` 草稿（deathPenalty + party）、校验 0 issue、发布并激活
     `2026.11.27.1`（checksum `01bcd16d…`）。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
PLAYWRIGHT_SKIP_WEBSERVER=true E2E_GAME_WEB_PORT=84 E2E_GAME_SERVER_PORT=87 \
  npx playwright test tests/e2e/party.spec.ts --workers=1
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=600000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：73 文件、**490 测试**通过（新增 18 条）。
- 构建：4 个应用成功。
- 全量 E2E：**40/40 通过**（4.3 分钟，2 worker，独立库/端口）。
- 组队 E2E：组队 → 名单 2/4 → 离队 → 再组队 → 出生点传送后队伍结束；
  开发栈 84 真实 Chromium 同一用例通过。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 2 分钟 sanity：50/50、97.3%、tick p95 5.09ms / p99 6.78ms、
  0 资产失败；Room 内容版本 `2026.11.27.1`。
- 50 人 × 10 分钟正式回归：50/50、接受率 98.9%、741 击杀、0 资产失败；
  tick p50 1.28ms / p95 **6.19ms** / p99 7.38ms / max 12.35ms；资产事务
  p95 54.69ms；RSS 峰值约 330MB（`party/load-50p10a.json`）。压测机器人
  不组队，共享经验路径由服务端集成测试覆盖。

### 遇到的问题及解决方法

1. **双人 E2E 各建了一个房间**：两名玩家都用 `?fresh=1`，会在同一地图上创建
   两个隔离 Room，永远看不到彼此。改为第一名玩家 `?fresh=1`、读取 HUD 的
   `room-id`，第二名玩家 `?join=<roomId>` 加入后通过。沉淀 EL-030。
2. **伪造接受会取消别人的邀请**：`acceptInvite` 最初在接受者不是被邀请者时
   也删除邀请。改为只比较、不删除，仅在过期时清理；补单元测试。
3. **正式回归启动失败**：2 分钟 sanity 的机器人尚未完全断开时启动 10 分钟
   回归，报“room already has 49 players”。等待 Room 清空后重跑通过，记录为
   压测前置条件。
4. **共享经验不能是第二次抽奖**：改为按内容基础经验固定千分比分享，不消耗
   RNG、不发金币/掉落、不推进任务，重试不改变数值。

### 尚未解决

- 8584 双人完整试玩仍待用户完成；远端 CI 待确认。
- 队伍仅内存且以 Room 为边界（TD-SRV-11）；无队伍聊天、队长移交、踢人、
  按名字邀请与跨图队伍（TD-CLI-17）。
- 经验仍无连续流水（TD-DATA-11）；4 人满队最多额外 150% 经验，需要试玩数据
  决定是否调整 `assistSharePermille`。

### 提交

- `6c1c1c0` `feat(alpha-03): add parties and shared kill experience`
  （39 个文件：契约/内容/应用/服务端/客户端、18 条测试、组队 E2E、
  ADR/报告/证据与状态文档）。

### 下一步计划

1. 8584 双人试玩组队与共享经验，观察名单、离队与传送提示。
2. 根据反馈决定下一切片：队伍聊天/移交或任务系统深化。
3. S4 剩余正式美术（TD-CLI-13）；确认远端 CI。

## 2026-11-27 Alpha 0.3 S1 补充：队伍共享掉落归属

### 目标

首版组队只共享经验，击杀掉落 30 秒内仍只归击杀者；队友看得到却捡不起来，而
窗口过后路人反而能捡。补上“归属窗口内同队成员可以拾取”，不新增物品行、不
复制掉落。

### 实际改动

1. **应用**
   - `PickupInput` 增加可选 `partyMemberIds`（拾取者当前队伍成员，含本人）。
   - `AssetService.pickup` 的归属校验改为“归属者在集合内”；窗口过后规则不变；
     拾取距离、幂等命令与并发处理不变。
2. **服务端**
   - `WorldMapRoom.handleLootPickup` 从 `PartyRegistry` 读取拾取者的队伍成员并
     传入；`game-application` 仍不依赖任何社交状态。
3. **测试**
   - 应用集成：陌生人拾取被拒（`NOT_OWNER`）；队友拾取成功并入包；窗口过期后
     任何人可拾取。
   - 服务端集成：三人组队击杀后，附近队友通过真实 Room 与拾取事务拿到
     `slime_gel`；按归属者挑选掉落，避免共享测试库恢复的其他掉落干扰。
4. **客户端**
   - 无改动：掉落列表本来就不按归属禁用，服务端拒绝时才提示。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：73 文件、**492 测试**通过（新增 2 条应用集成；服务端集成用例
  扩展掉落断言）。
- 构建：4 个应用成功。
- 全量 E2E：**40/40 通过**（4.4 分钟）。首轮 `skills.spec.ts` 偶发超时，单跑
  2/2 与全量复跑 40/40，属已知 TD-QA-11 时序抖动，未降低阈值。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 2 分钟负载 sanity：50/50、99%、159 击杀、0 资产失败、tick p95
  5.54ms / p99 6.12ms、资产事务 p95 58.72ms（`party/load-50p2a-loot.json`）。

### 遇到的问题及解决方法

1. **服务端集成在共享测试库下偶发 `NOT_OWNER`**：Room 启动会恢复该地图上其他
   测试文件遗留的未领取掉落，测试取“第一个掉落”时可能拿到别人的掉落。改为
   按 `ownerId` 等于本次击杀者挑选，并登记为测试隔离注意事项。
2. **队友站在怪物旁边仍可能超出拾取距离**：怪物在追击中死亡，掉落位置随怪物
   移动；测试先移动到掉落坐标再拾取，避免 1.5 格边界。真实玩家也需要走近，
   已在状态文档说明。
3. **负载后资产不变量出现 68 条过期掉落**：压测机器人不拾取，Room 销毁后
   过期掉落留在库里；重启 Game Server 的启动清理后归零（日志
   “purged expired world drops at startup”），属既有已知行为。

### 尚未解决

- 8584 双人真实浏览器拾取仍待用户试玩；服务端链路已由真实 PostgreSQL +
  Colyseus 覆盖。
- 没有掉落分配规则（先到先得）、金币共享或跨图共享掉落；队伍过图仍结束
  （TD-SRV-11、TD-CLI-17）。

### 提交

- `ee2bac0` `feat(alpha-03): share kill loot with party members`
  （13 个文件：拾取事务、房间传递、应用/服务端测试、ADR 补充、报告与证据）。

### 下一步计划

1. 8584 双人试玩组队与共享掉落。
2. 根据反馈决定队伍聊天、掉落分配规则或跨图队伍。

## 2026-11-27 Alpha 0.3 S1 补充：过图保留队伍

### 目标

组队后一起出城时队伍不再散掉：成员跨地图后仍在同一队伍名单中，直到真正
离开世界。

### 实际改动

1. **架构（ADR-036）**
   - 新增进程级 `PartyService`（`world/partyService.ts`），持有队伍表、邀请、
     在线状态（presence）与各 Room 的投递端口；队伍规则仍由 `PartyRegistry`
     承担（文件移到 `world/`，逻辑不变）。
   - `createGameServer` 创建一个实例并注入所有地图 Room；内容 Store 启动后
     读取 `rules.party.maxMembers` 作为进程内统一上限。
   - Room 进入世界立即上报 presence，之后每秒刷新等级/HP/存活/在线；名单
     快照由 presence 构建，按成员当前所在 Room 路由。
   - 传送时 `markOffline` 保留队伍席位，目标 Room 加入后恢复；主动退出、
     宽限结束、踢下线才 `removePlayer` 移出队伍。
   - 组队邀请由服务路由到被邀请者所在 Room；传送空窗期邀请保留，进入新 Room
     后补发。
2. **测试**
   - 新增 `PartyService` 单元测试 4 条（邀请路由、接受刷新、传送离线保留、
     离队与离开世界的区别）。
   - 服务端集成新增 1 条：主城两人组队 → 一人走到传送门过图 → 旧图队友仍见
     2 人名单（过图者短暂离线）→ 新地图恢复在线。
   - E2E 更新：过图后双方名单仍为 2 人，过图者恢复在线。
3. **文档**
   - ADR-036；ADR-035 标注修订；报告 §8；状态、债务、经验、演进日志更新。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：74 文件、**497 测试**通过（新增 5 条）。
- 构建：4 个应用成功。
- 全量 E2E：**40/40 通过**（4.5 分钟）。
- 资产不变量：7 项全部 0 违例（重启清理负载遗留的过期掉落）。
- 50 人 × 2 分钟负载 sanity：50/50、98.8%、158 击杀、0 资产失败、tick p95
  4.52ms / p99 7.06ms、资产事务 p95 63.46ms（`party/load-50p2a-crossmap.json`）。

### 遇到的问题及解决方法

1. **集成测试模拟传送必须显式离开旧 Room**：真实浏览器收到 `session.transfer`
   后会离开；裸 SDK 不会，旧 Room 因而不释放会话、新地图无法加入。测试在
   收到传送消息后调用 `leave()`。
2. **“离开队伍”和“离开世界”必须是两个语义**：主动离队不能删除 presence，
   否则 1 秒内到达的邀请无法路由；最终离开世界才删除。实现上拆成 `leave`
   与 `removePlayer`。
3. **跨图名单的刷新频率**：名单由 presence 构建，宿主 Room 每秒刷新并重发；
   成员变化时立即刷新，避免每秒广播给所有 Room。
4. **负载后资产不变量出现 221 条过期掉落**：压测机器人不拾取，Room 销毁后
   过期掉落留在库里；重启 Game Server 的启动清理后归零，属既有已知行为。
5. **首轮 verify 的测试步骤偶发失败**：未保留失败用例输出，随后两次全量
   测试（497/497）与 verify 复跑均通过；属已知并行时序抖动，未降低断言。

### 尚未解决

- 8584 双人跨图试玩仍待用户完成。
- 进程重启/崩溃仍会丢队伍；多进程部署前需要持久化或共享存储（TD-SRV-11）。
- 名单不显示成员所在地图；无队伍聊天、队长移交、踢人与分配规则（TD-CLI-17）。

### 提交

- `76768f4` `feat(alpha-03): keep parties across map transfers`
  （20 个文件：进程级服务、Room 接线、5 条测试、E2E、ADR-036/报告/证据）。

### 下一步计划

1. 8584 双人试玩：组队、打怪、一起过图，确认名单、在线状态与共享经验。
2. 根据反馈决定队伍聊天/移交或任务系统深化。

## 2026-11-27 Alpha 0.3 S2：世界首领灰烬魔像与二阶段狂暴

### 目标

给 10 级以上玩家一个值得组队挑战的共同目标：废墟世界首领「灰烬魔像」，
具备可读的攻击前摇、半血狂暴、地图公告与独占掉落，并验证组队共享经验/拾取
在首领场景下真实有效。

### 实际改动

1. **契约**
   - 怪物可选 `boss` 与 `enrage`；`enrage` 为封闭对象（阈值 + 攻击/间隔/移速
     倍率 + 前摇半径绝对值），未知字段被拒绝。
   - 新增 `enrage` 战斗事件（实体、HP、最大 HP）；`MonsterState` 增加
     `boss` / `enraged`，默认 false。
2. **内容**
   - `ashen_colossus`：Lv.12、5,200 HP、3 分钟刷新、1100ms 前摇 1.9 格；
     50% HP 触发狂暴（攻击 ×1.25、间隔 ×0.75、移速 ×1.2、前摇半径 2.6 格）。
   - 5 件物品：必掉材料 `colossus_heart`、Lv.12 稀有胸甲与三职业武器。
   - 掉落表：900 经验、160–260 金、必掉材料、25% 胸甲、各 8% 职业武器。
   - 废墟源图新增 `ruins_colossus_1` @ (30,33)，编译产物重新生成并格式化。
3. **领域**
   - 新增 `monsterStatsAtPhase` 纯函数；阶段每次生命最多一次、致死一击不触发、
     重生重置；攻击、间隔、移速、前摇半径全部由服务端使用阶段属性。
4. **服务端**
   - Room 写入 `boss` / `enraged`；`enrage` 事件只投递 AOI 内玩家；
     首领狂暴、死亡、重生广播地图公告；掉落与经验复用既有资产事务、归属窗口
     与队伍共享。
5. **客户端**
   - 顶部边缘首领血条（名字/等级/HP/狂暴）、Boss 放大与金色/狂暴红名字、
     狂暴光环、小地图金色/橙色大点、怪物列表与目标面板「首领」标记、
     战斗日志阶段提示。
6. **测试**
   - 契约 2 条、内容 2 条、领域 4 条、服务端集成 1 条、E2E 1 条；全量
     **506 测试**、**41 E2E** 通过。
   - 服务端集成：三名 Lv.40 角色在真实 Room + PostgreSQL 中击败首领，断言
     狂暴事件/状态、地图公告、死亡、必掉材料与 900 经验提交。
7. **内容发布**
   - 保存 monsters/items/lootTables 草稿，校验 0 issue，发布并激活
     `2026.11.27.2`（checksum `d35cc25d…`，新增 7 项）；开发栈重启到本切片
     代码，Game Server 日志确认内容刷新。
8. **文档**
   - ADR-037、`docs/ALPHA_03_EXECUTION_PLAN.md`、切片报告、状态、债务、经验与
     演进日志更新；ADR 索引补齐 035–037。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：75 文件、**506 测试**通过（新增 9 条）。
- 构建：4 个应用成功。
- 全量 E2E：**41/41 通过**（4.5 分钟，含新增 `boss.spec.ts`）。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 2 分钟负载：50/50、99.1%、192 击杀、0 资产失败、tick p95 5.34ms
  / p99 6.7ms、资产事务 p95 65.81ms（`alpha-03/boss/load-50p2a-boss.json`）。
- 真实浏览器（宿主机 8584）：内容 `2026.11.27.2`；Lv.40 角色在废墟看到
  「世界首领 灰烬魔像 Lv.12 5200/5200」与首领标记，截图
  `alpha-03/boss/boss-live-8584.png`。

### 遇到的问题及解决方法

1. **编译地图格式化放大差异**：`maps:compile` 输出单行数组，与已提交的
   Prettier 格式不一致，三张地图产生 1.7 万行假差异；对编译产物执行 Prettier
   后只剩废墟刷点变更。沉淀 EL-034。
2. **内容校验阻塞新刷点**：重启后 Game Server 读取旧 Release，发现地图刷点
   引用了不存在的怪物，按设计保留旧快照并持续报错；发布并激活
   `2026.11.27.2` 后恢复。属既有 Expand→Publish 流程。
3. **8584 脚本过图后移动无效**：地图名已变为废墟就立即发移动，新 Room 尚未
   加入完成，意图被丢弃；改为等待 `connection-status=connected` 后通过。
   沉淀 EL-033。
4. **集成测试读状态早了一 tick**：死亡事件已到达，但客户端状态仍是 attack；
   改为等待 `MonsterState.state=dead` 后再断言状态，而不是只看事件。
5. **新增怪物触发的清单断言**：`content.test.ts`、`loot.test.ts` 与
   `compile.test.ts` 的怪物/刷点列表需要同步；已在同一提交内更新，后续新增
   内容应把这三处列入检查表。

### 尚未解决

- 8584 三人真实击杀与手感（前摇可读性、狂暴压力、掉落分配）仍待用户试玩。
- 远端 CI 待确认。
- Boss 刷新为 Room 进程内计时（TD-SRV-12）；无多阶段/阶段技能/世界频道提示/
  首杀记录。
- 10 分钟 × 50 人正式回归仍以 S1 为最近一轮；S3 前需复跑。

### 提交

- `cb1d3ae` `feat(alpha-03): add the ruins world boss with an enrage phase`
  （34 个文件：契约/内容/领域/服务端/客户端、9 条测试、E2E、ADR-037、执行计划、
  切片报告、截图与负载证据）。
- `b4c45ed` `fix(alpha-03): scale the boss nameplate and keep its label visible`
  （3 个文件：首领名字标签碰撞盒按 1.45 倍容器缩放，首领标签优先于普通怪物；
  修复首轮截图里骷髅名字压住首领名字的问题）。

### 下一步计划

1. 8584 三人组队击杀首领，观察前摇/狂暴/掉落分配。
2. 按 `docs/ALPHA_03_EXECUTION_PLAN.md` 决定 S3：任务链扩展（10 步主线/日常）
   优先；副本实例先写 ADR。
3. 复跑 50 人 × 10 分钟正式回归；确认远端 CI。

## 2026-11-27 Alpha 0.3 S2 后修：移动手感（重寻路回退与自动攻击预测）

### 目标

修复试玩反馈的三类移动问题：点怪物后追击每走几步卡顿、连续点击地面不流畅、
“寻路不是最短”。先定位是路径执行还是寻路算法，再做最小修复并补真实链路测试。

### 根因

1. `WorldSimulation.setPath` 与客户端的路径构建在玩家处于格内偏移时，都会先
   插入“当前格中心”。自动攻击每 350ms 重算接近路径，于是每 1.4 格把玩家拉回
   格中心，最多后退 500 单位；连续点击时每次重寻路也回退一次。
2. 自动攻击由服务端驱动移动，但没有把接近路径下发给客户端；客户端没有路径
   可预测，只能按 10Hz 快照插值，表现为阶梯式移动。
3. BFS 本身是四方向最短；玩家感知的“不是最短”来自上述回退与阶梯移动，以及
   四方向对斜向目标需要 L 形路线（模型选择，非算法错误）。

### 实际改动

1. **服务端模拟**
   - 新路径与当前偏移同向：继续直行，不插入格中心。
   - 垂直转向：先沿当前轴进入下一格，再在下一格内对齐中心；不回到旧格中心，
     所有线段仍轴对齐、仍不穿越阻挡格。
   - 停止（空路径）时才回到当前格中心。
2. **自动攻击**
   - `SessionRecord.autoAttack` 增加 `pathTargetTile`；只在目标离开当前格或
     当前路径耗尽时重算，取消固定 350ms 重算。
   - `combat.target.changed` 增加可选 `path`/`startX`/`startY`/
     `speedUnitsPerSecond`；进入接近阶段或目标换格时下发。
3. **客户端**
   - 新增 `movementPrediction.ts` 纯函数：裁剪服务器起步格与已走过的节点，按
     同向/下一格转向规则构建预测路径；手动 ack 与自动接近路径共用。
   - `WorldScene` 在 `engaged` 不立即清空路径（下一 tick 会被接近路径替换，
     避免一帧快照回拉），`attacking`/停止时清空；新增 `selfUnitPosition` 调试钩子。
4. **测试**
   - 模拟：同向继续、下一格转向、反复重寻路不后退、原有绕行仍不进阻挡格。
   - 客户端：裁剪服务器起步格、同向继续、下一格转向、清空路径收尾。
   - 契约：目标变更事件的可选路径字段与非法值拒绝。
   - 服务端集成：自动攻击接近位置不倒退且有路径下发；中途改点位置不倒退。
   - 浏览器：`tests/e2e/movement.spec.ts` 连续移动不冻结、重定向不后退。
5. **文档**
   - ADR-016 补充、EL-035/036、技术债 TD-CLI-18、状态与日志。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

- 格式/lint/类型：通过。
- 单元/集成：77 文件、**519 测试**通过（新增 13 条）。
- 全量 E2E：**43/43 通过**（4.9 分钟，新增 movement.spec 2 条）。
- 移动 E2E 以 2 worker 连续复跑 3 次（6 条）全部通过。
- 开发栈 84–87 已重启到修复代码（06:17），4 个服务健康 200。

### 遇到的问题及解决方法

1. **客户端 ack 路径包含服务器起步格**：第一版客户端构建保留了该节点，导致
   “同向继续”判断失败并仍回退；改为先裁掉起步格及已走过节点，再从下一个节点
   判断方向。单测补充“ack 含当前格”的用例。
2. **E2E 用 x 单调判断自动攻击**：接近路径包含转向，转向时 x 必然在下一格内
   对齐，x 单调会误报。改为断言“移动样本数、最长静止帧数、总位移”，直接对应
   “是否冻结/阶梯”的体验问题。
3. **`?fresh=1` 只影响初始房间**：过图后仍加入共享的野区房间；自动攻击 E2E
   选择其他 spec 未使用的 `wilds_slime_14`（TD-QA-11 的既有做法）。
4. **8584 独立脚本采样受页面定时器影响**：20ms 采样在 `page.evaluate` 中会出现
   时间抖动，不能作为平滑度证据；该临时脚本与证据已删除，以 E2E 与集成测试为准。

### 尚未解决

- 四方向移动对斜向目标仍是 L 形路线；八方向移动需要单独 ADR 与阻挡/预测改造
  （TD-CLI-18）。
- 目标移动时的路径更新仍有网络延迟窗口；已用下一格转向与路径预测压低感知，
  但快速横移的目标仍可能出现小幅校正。
- 移动修复后的 50 人 × 2 分钟 / 10 分钟容量回归未重跑；改动不增加 tick 循环
  开销，S2 的 2 分钟 sanity 仍有效。

### 提交

- `b4dde05` `fix(alpha-03): keep movement continuous across repaths`
  （15 个文件：模拟、房间自动攻击、契约、客户端预测、13 条测试、移动 E2E）。

### 下一步计划

1. 8584 真实试玩：点怪追击、连续点击地面、斜向目标，确认卡顿消失。
2. 根据试玩决定是否评估八方向移动（需 ADR），或继续 S3 任务链扩展。
3. 若继续移动主题，补 50 人容量回归（自动攻击重算次数下降，预期不退化）。

## 2026-11-27 Alpha 0.3 S3-A：每日任务与留存循环

### 目标

回答“玩家为什么每天回来”：在一次性任务链之外交付可重复的每日任务。
机制先行——内容化重置时间、周期键持久化、在线跨日刷新；日常任务与一次性
任务共用同一套接取/交付事务与客户端面板。

### 实际改动

1. **契约**
   - `QuestContent.repeat?: 'daily'`（`QUEST_REPEAT_KINDS` 封闭白名单）；
     `QuestView.repeat` / `nextResetAt`（epoch 毫秒）。
   - `rules.dailyReset?: { hour, utcOffsetMinutes }`；旧 Release 不含字段时
     行为不变。
2. **内容**
   - 基线 `rules.dailyReset = { hour: 5, utcOffsetMinutes: 480 }`。
   - `quest_daily_slime_cleanup`（Lv.1，5 史莱姆）、
     `quest_daily_wolf_hunt`（Lv.3，6 森林狼）。
   - 校验：日常必须有重置规则、不能带前置、不能作为一次性任务的前置。
3. **领域**
   - `dailyPeriodKey` / `nextDailyResetAt` 纯函数（固定偏移 + 重置小时）。
   - 视图把非当前周期的日常记录视为不存在；击杀推进拒绝旧周期记录。
4. **持久化（迁移 0009）**
   - `character_quests.period_key` 默认 `''`；唯一索引改为
     `(character_id, quest_id, period_key)`；旧数据自动为空周期。
   - 仓储新增 `listCharacterQuestsForPeriod`，所有按任务查询/更新带周期键。
5. **应用事务**
   - 接取/交付按注入时钟计算周期键；同日重复接取 `QUEST_UNAVAILABLE`、
     重复交付 `QUEST_ALREADY_CLAIMED`；交付奖励仍与任务状态同事务。
   - 击杀奖励只推进一次性与当前周期日常。
6. **服务端与客户端**
   - Room 每 30 秒检查周期键；跨重置点重发任务快照并广播提醒；创建 Room
     时初始化周期键，避免首个扫描周期漏发。
   - 任务面板/追踪器显示「日常」、重置时刻与「今日已完成」。
7. **测试**
   - 契约 3、内容 3、领域 3、应用集成 1（同日重复、跨日重接、旧周期隔离、
     奖励唯一）、服务端快照断言；`quests.spec.ts` 扩展为接取日常→5 次击杀→
     交付→「今日已完成」。全量 **530 测试**、**43 E2E**。
8. **内容发布**
   - 保存 rules/quests 草稿，校验 0 issue，发布并激活 `2026.11.27.3`
     （checksum `1cd1199a…`，新增 3 项）；开发栈重启到本切片代码。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 LOAD_OUTPUT=... pnpm load:scenario
```

- 格式/lint/类型：通过。
- 单元/集成：78 文件、**530 测试**通过（新增 11 条）。
- 构建：4 个应用成功。
- 全量 E2E：**43/43 通过**（5.0 分钟）。
- 资产不变量：7 项全部 0 违例。
- 50 人 × 2 分钟：50/50、接受率 98.9%、164 击杀、0 资产失败、tick p95
  5.11ms / p99 6.14ms、资产事务 p95 52.74ms
  （`alpha-03/dailies/load-50p2a-dailies.json`）。
- 真实浏览器（宿主机 8584）：日常标签、`每日 21:00 重置`（浏览器 UTC）、
  接取后追踪器 `野地史莱姆 0/5`；截图 `alpha-03/dailies/dev-daily-*.png`。
- 压测后开发库留下 208 条过期未领取掉落（既有地面掉落生命周期）；重启开发
  栈触发启动清理后归零，最终资产不变量 7/7 为 0。

### 遇到的问题及解决方法

1. **旧 Release 测试被新跨 section 约束打断**：两个无 rules 的夹具仍带日常
   任务；改为同时移除日常（旧 Release 本来没有日常），保留一次性任务无
   rules 仍有效的语义。
2. **死亡代价测试重写 rules 丢字段**：改为展开旧 rules 再覆盖
   `deathPenalty`。
3. **Control API 旧契约**：首次保存草稿 422（未识别 `dailyReset`/`repeat`）；
   重启开发栈后通过。
4. **旧 Room 固定旧内容**：激活后当前 Room 仍无日常；重启 Game Server 让新
   Room 使用 `2026.11.27.3`（既有内容版本模型）。
5. **全量 E2E 重写历史截图**：验证后把历史截图恢复为提交版本，只提交源码、
   迁移、测试与新增日常证据。
6. **复跑全量 E2E 的时序抖动**：提交后复跑首轮 `movement.spec.ts` 的平滑度
   断言失败（`longestStill=5`，阈值 ≤3）；同文件单跑 2/2、随后全量 43/43
   通过，未降低阈值，按软件渲染 2 worker 的时序抖动记录（EL-027）。

### 尚未解决

- 日常只有击杀目标；主线仍为 3 步。
- 在线重置最多延迟 30 秒；没有倒计时；每日历史行无清理（TD-DATA-12）。
- 8584 跨日重接与完整人工试玩、远端 CI 仍待确认。

### 提交

- `8cfc209` `feat(alpha-03): add daily quests with content-driven resets`
  （24 个文件：契约/内容/领域/应用/迁移/服务端/客户端、11 条测试、E2E）。

### 下一步计划

1. 8584 试玩两个日常与重置后的重新接取，观察追踪器与奖励。
2. S3-B：10 步主线任务链优先；副本实例先写 ADR。
3. 确认远端 CI；正式美术（TD-CLI-13）。

## 2026-11-27 Alpha 0.3 S3-B：一键任务导航与自动流程

### 目标

把一次任务从“自己找路、逐只点怪、走回主城”压缩为：接取并前往 → 自动寻路与
自动战斗 → 完成后一键返回 → 到达守卫自动交付。移动、目标选择与战斗仍由
服务端裁定；不实现瞬移。

### 实际改动

1. **协议**
   - 客户端 `quest.navigate`（hunt/return/stop）与服务器 `quest.navigation`
     （moving/waiting/arrived/stopped/completed，stopped 才带 reason）；
     复用命令守卫的幂等、序号与限频。
2. **路由**
   - 新增 `apps/game-server/src/world/questRouting.ts`：地图最短下一跳、
     最近刷点、NPC 周围 3 格可达落脚点；6 条纯函数单测。
3. **服务端**
   - `SessionRecord` 增加导航状态与命令幂等表；Room 每 tick 在自动攻击前
     运行导航。
   - `hunt` 选择可见的最近目标并复用既有自动攻击；无目标走向刷点等待；
     目标死亡后暂停 400ms 让奖励事务提交；`return` 到达守卫范围发送
     `arrived`。
   - 跨图走传送门；过图静默清状态，客户端重放意图；手动移动/攻击/停止/
     死亡/断线取消。
   - 任务视图 NPC 名字改为从全部地图解析；面板保留跨图进行中/已完成任务。
4. **客户端**
   - 面板与追踪器：「接取并前往」「前往击杀」「回去交付」「停止自动」；
     左栏状态横幅与进度/完成/交付 Toast。
   - 到达后自动发送既有 `quest.claim`；失败停止并提示手动交付。
   - 过图/重连重放意图；手动操作立即清除本地意图。
   - 仅开发环境 `?freshTransfer=1`：过图创建独立实例，隔离自动战斗 E2E。
5. **测试**
   - 契约 3 条、路由 6 条、Room 集成 1 条；`questGuidance.spec.ts` 真实
     浏览器全流程（约 47 秒）；全量 540 测试、44 E2E。
6. **文档**
   - ADR-039、切片报告、路线执行计划、状态、债务与经验更新。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
pnpm verify:invariants
```

- 格式/lint/类型：通过。
- 单元/集成：**540 测试**通过（新增 10 条）。
- 构建：4 个应用成功。
- 单场景 E2E：一键流程 **47 秒**通过。
- 全量 E2E：2 worker 默认模式本次出现 movement/pvp/quests 各一次时序/共享
  实体抖动；单跑均通过；串行 `PLAYWRIGHT_WORKERS=1` **44/44 通过**（10.1 分钟），
  未降低任何断言。
- 资产不变量：7 项全部 0 违例。

### 遇到的问题及解决方法

1. **野外任务视图显示 `town_guard`**：NPC 名字表只来自当前地图；改为从全部
   编译地图解析，E2E 断言「回到守卫」。
2. **过图后任务面板为空**：面板只显示当前地图 NPC 的任务；改为同时保留
   进行中/已完成任务。
3. **自动交付误判**：调试脚本用面板行判断，过图会关闭面板；改用任务状态
   调试钩子，确认金币 +15、追踪器清空。
4. **自动战斗抢占共享野区**：新增开发专用 `?freshTransfer=1`，让新 E2E 使用
   独立地图实例，其他场景不变。
5. **2 worker 全量抖动**：本环境软件渲染 + 自动战斗场景增加并行负载；单跑与
   串行全量均通过，记录为 TD-QA-11，未降低阈值。

### 尚未解决

- 自动战斗只用普通攻击，不会自动放技能或喝药（TD-CLI-19）。
- 目标选择是最近的可见怪，可能与其他玩家争夺；无抢怪保护。
- 导航意图是连接级状态，过图/断线依赖客户端重放；关闭页面即丢失。
- 未实现瞬移；跨图仍走传送门。
- Room 编排继续增长（TD-SRV-01b），纯路由已抽出。

### 提交

- `a5843b8` `feat(alpha-03): guide quests with server-owned navigation`
  （17 个文件：契约、路由、Room、客户端、样式、10 条测试、E2E）。

### 下一步计划

1. 8584 试玩一键流程、途中停止与手动打断。
2. S3-C：10 步主线任务链优先；副本实例先写 ADR。
3. 视反馈评估自动技能/喝药、抢怪保护或瞬移（需 ADR）。

## 2026-11-27 Alpha 0.3 S3-B 补充：全局任务面板与远程接取

### 目标

让任务清单与状态在任意地图都可见；远处任务不需要玩家自己找路回发布者，
点击「前往接取」后由服务端自动走到发布者身边并接取，接取后继续自动狩猎。

### 实际改动

1. **全局面板**
   - 默认「任务 · 全部地图」面板不再按当前地图过滤，展示服务器下发的全部
     任务（锁定/可接/进行中/已完成/已领取）与发布者地点；从 NPC 点开仍只
     显示该发布者的任务。
   - 新增 `locateNpc`：从全部编译地图解析 NPC 的地图与名字；面板、提示与
     追踪器显示「晨曦主城·守卫」。
2. **远程接取**
   - 协议新增 `accept` 导航目的；服务端在开始前用任务视图校验必须是
     `available`，然后按传送门图把角色送到发布者身边。
   - 到达后客户端发送既有 `quest.accept`，成功后自动开始 `hunt`；接取命令
     仍校验距离、等级、前置与状态。
   - 未实现瞬移；远程接取是服务端自动寻路。
3. **UI**
   - 面板按钮区分「接取」「接取并前往」「前往接取」「停止自动」；可接任务
     提示显示发布者地图。
4. **测试**
   - 新增 1 条 Room 集成（野外对主城任务 accept，下一跳主城）。
   - `questGuidance.spec.ts` 新增浏览器场景：野外全局面板→前往接取→自动
     回城→自动接取→自动狩猎→停止。
   - 全量 541 单元/集成、45 E2E（串行全量）。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
```

- 格式/lint/类型/构建：通过。
- 单元/集成：**541 测试**通过。
- 全量 E2E：**45/45 通过**（串行全量）。
- 新场景截图：`docs/phase-reports/alpha-03/quest-guidance/e2e-global-panel.png`、
  `e2e-global-accepted.png`。

### 尚未解决

- 远程接取仍需角色自动走到发布者，未实现瞬移。
- 任务面板没有分组/筛选，任务数量增加后需要滚动；按试玩反馈评估。
- 自动战斗只用普攻（TD-CLI-19）等既有边界不变。

### 提交

- `5dc6e96` `feat(alpha-03): open quests from every map`
  （12 个文件：契约、导航 accept、全局面板、地点解析、1 条集成、1 个 E2E）。

## 2026-11-27 Alpha 0.3 S3-C：十步主线任务链与废墟斥候

### 目标

主线在 5 级结束后没有后续目标，5–12 级只能刷怪；10 级后的废墟与首领缺少
叙事入口。本切片把主线从 3 步扩展到 10 步，覆盖三张地图与全部怪物层级，
在废墟入口新增发布者，并让任务面板在任务量增加后仍然可读。

### 实际改动

1. **内容**
   - 新增 7 步主线：蛛巢清理（毒牙蜘蛛 4）、石甲守卫（石甲守卫 2）、枯骨之路
     （骷髅武士 5）、腐化之源（腐化术士 4）、石像鬼的守望（废墟石像鬼 1）、
     肃清亡者（骷髅武士 8）、灰烬魔像（首领 1）。
   - `quest_alpha_wolf` 的前置改为 `quest_stone_guard`，使新步骤进入主线；
     奖励经验 60 → 1500、金币 20 → 400，包含大药水、材料与灰烬之心。
2. **地图与契约**
   - `MAP_NPC_ROLES` 增加 `scout`；`map-runtime` 编译器改为使用契约枚举校验
     NPC 角色（新增非法角色测试）。
   - `ruined_fields` 的 `npc_points` 新增 `ruins_scout`「废墟斥候」@ (7,20)，
     远离入口刷点与既有 E2E 路径；`pnpm maps:compile` 重新生成编译产物。
3. **客户端**
   - 新增 `lib/questPanel.ts`：`groupQuestsByStatus`（可交付 → 进行中 →
     可接取 → 尚未解锁 → 已领取，隐藏空组、组内保留服务器顺序）与
     `nextAvailableQuest`（一次性主线优先，再按等级）。
   - 任务面板按分组渲染，标题显示数量并吸顶；引导提示改用 `nextAvailableQuest`。
4. **测试**
   - 领域：`questChain.test.ts` 验证 10 步线性链、发布者前五步守卫/后五步
     斥候、等级不递减，并模拟“只靠本链击杀与奖励”从 1 级完成。
   - 应用：真实 PostgreSQL 全链测试，依次接取/击杀/交付 10 步，断言奖励与
     10 条金币账本恰一次。
   - 服务端：主城快照包含 10 条一次性任务，斥候名字解析正确且状态 locked。
   - 浏览器：`tests/e2e/questChain.spec.ts` 验证「可接取 2 / 尚未解锁 10」、
     废墟斥候地点与主线优先提示。
5. **发布与验证**
   - 重启开发栈加载新编译地图；draft 200、validate 200（0 issue）、publish
     201、activate 200；内容 `2026.11.27.4`（checksum `5e22537c…`）。
   - 50 人 × 2 分钟 sanity 50/50、接受率 99.1%、174 击杀、0 资产失败、
     tick p95 4.79ms / p99 5.65ms；重启后资产不变量 7/7 为 0；无数据库迁移。
   - 开发栈 8584 实测（重启后、内容 `2026.11.27.4`）：新角色面板 12 条任务、
     「可接取 2 / 尚未解锁 10」，提示指向「清理史莱姆」；截图
     `quest-chain/dev-panel-8584.png`。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
pnpm verify:invariants
```

- 格式/lint/类型/构建：通过。
- 单元/集成：**551 测试**通过（新增 10 条）。
- 全量 E2E：**46/46 通过**（串行全量，10.8 分钟）。
- 容量 sanity：50/50、99.1%、174 击杀、0 资产失败、tick p95 4.79ms。
- 资产不变量：7 项全部 0 违例。
- 内容发布：draft 200、validate 200（valid=true, 0 issue）、publish 201、
  activate 200；Game Server 日志确认内容刷新。

### 遇到的问题及解决方法

1. **校验报“发布 NPC 不在任何地图中”**：地图 NPC 属于编译代码，运行中的
   Control API 仍持有旧地图；重启开发栈后同一草稿 0 issue。沉淀 EL-040。
2. **任务面板在 12 条任务时可读性下降**：按状态分组，可操作任务排在锁定
   任务之前；分组标题吸顶并显示数量。
3. **引导提示先指向每日任务**：`nextAvailableQuest` 优先一次性主线；E2E
   断言提示为「可接任务：清理史莱姆」。
4. **地图编译产物格式**：`pnpm maps:compile` 后需要再跑 Prettier 才能通过
   `format:check`，编译内容本身不变。
5. **压测脚本 teardown 挂起**：一名 mover 走进传送门被传到主城后，SDK 对已
   结束的 Room 调用 `leave()` 永不返回；报告已写出但进程不退出。改为有界等待
   5 秒并关闭仍打开的连接；10 人 smoke 与 50 人复跑均 `EXIT:0`（EL-041）。

### 尚未解决

- 任务仍只有击杀目标；没有放弃、任务日志、收集/到达、组队共享与 NPC 头顶
  感叹号。
- 第 10 步依赖世界首领，单人或低峰时段可能需要等待/争夺。
- 任务面板没有搜索/筛选（TD-CLI-20）；任务继续增长时需要。
- 经验曲线让后期玩家高于任务等级要求，升级节奏待试玩反馈。
- 自动战斗只用普攻（TD-CLI-19）；远程接取仍是真实旅程。

### 提交

- `9f68bcc` `feat(alpha-03): extend the main quest chain into the ruins`
- `697edec` `fix(alpha-03): bound the load scenario teardown`
- `docs(alpha-03): record the ten-step quest chain`

### 下一步计划

1. 8584 试玩十步主线：前五步在野外，8 级以上到废墟找斥候接取后五步。
2. S3-D 优先任务目标类型扩展（收集/到达）；副本实例先写 ADR。
3. 确认远端 CI；正式美术仍为 TD-CLI-13。

## 2026-11-27 Alpha 0.3 S3-D1：收集类任务目标与交物交付

### 目标

十步主线与两个日常全部是“击杀 N 只”，材料除了卖店没有消耗端。本轮把任务
目标扩展为“击杀 + 收集”，让任务面板出现新动词，并让材料成为真实的交付
支出；复用现有面板、一键导航与资产事务。

### 实际改动

1. **契约与内容**
   - `questObjectiveSchema` / `questObjectiveViewSchema` 增加闭集
     `collect { templateId, count }`；新增拒绝码 `QUEST_ITEMS_MISSING`。
   - 基线内容新增 `quest_supply_delivery`（Lv1 一次性，金创药 ×1 → 20 经验 /
     15 金）与 `quest_daily_ruins_stock`（Lv8 每日，蛛腿 ×3 → 220 经验 /
     40 金）。
2. **领域**
   - `QuestViewContext` 增加背包汇总；收集任务在 `active` 时进度等于持有量，
     达到要求即把视图状态显示为 `completed`；领取记录仍保持 `active`。
   - `advanceQuestOnKill` 对收集目标不生效。
3. **资产事务**
   - `claimQuest` 收集分支：先锁角色行，再 `FOR UPDATE` 锁该模板背包堆叠，
     按槽位扣除；数量不足抛 `QUEST_ITEMS_MISSING` 并整体回滚；足够时
     `active → completed → claimed` 后发奖，全部同一事务。
   - 新增持久化辅助 `lockInventoryItemsByTemplate`。
4. **服务端**
   - 每次资产命令提交后，若会话有进行中的收集任务，用已更新的背包快照重发
     任务快照；不轮询数据库。
   - 收集任务的 `hunt` 目标集合来自战利品表（掉落该物品的怪物）；背包凑够即
     以 `completed` 停止导航；`return` 的完成判定接受“已够数的活动记录”。
5. **客户端**
   - 目标文案统一为“收集 物品”，收集任务也可一键前往；快照差分补上进度与
     完成提示；接取后若已可直接交付则不再自动狩猎。
6. **内容校验**
   - 目标物品必须存在且为材料/消耗品；每日任务不能要求商店可购买物品；
     目标物品不能同时是奖励；无掉落/商店来源时告警。
7. **文档**
   - ADR-040、切片报告、状态、债务（TD-CLI-21）与 EL-042。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
pnpm verify:invariants
```

- 格式/lint/类型/构建：通过。
- 单元/集成：**566 测试**通过（新增 15）。
- 全量 E2E：**47/47 通过**（10.9 分钟，串行全量）。
- 最终代码任务 E2E：collectQuests / quests / questChain / questGuidance
  共 **5/5 通过**（2.9 分钟）。
- 资产不变量：6/7 为 0；`stale_expired_open_ground=159` 为开发库既有过期
  地面掉落（无 Room 的地图不执行清理），启动时全局清理会归零。

### 遇到的问题及解决方法

1. **开发栈重启被环境权限拦截**：尝试停止 84–87 的旧 `pnpm dev` 进程组时，
   环境策略拒绝了该操作。没有绕道用其他方式强杀；本轮以隔离 E2E 栈验证代码，
   开发栈重启与内容发布留待用户确认。
2. **收集进度不能落库**：拾取时记进度会导致“卖掉材料后仍显示完成”，每日
   任务还能重复交付；改为背包即进度，唯一写入点是领取事务。沉淀 EL-042。
3. **每日可购买物品会套利**：内容校验显式禁止每日收集要求商店可购买物品；
   一次性教学任务允许消耗品，奖励按药价补偿。
4. **全量 E2E 与最终代码的时间差**：首轮全量启动后仍调整了内容数值与客户端
   提示；结束后在最终代码上重跑任务相关 4 个 spec，全部通过。

### 尚未解决

- 开发栈重启、发布并激活新 Release、8584 人工试玩。
- 50 人 × 2 分钟容量 sanity 与重启后的资产不变量。
- 到达类目标（S3-D2）、组队共享收集进度、物品来源提示（TD-CLI-21）。
- 远端 CI 仍待确认。

### 下一步计划

1. 重启开发栈，发布并激活含两条收集任务的新 Release，刷新 8584。
2. 跑容量 sanity 与资产不变量，回填结果。
3. 下一片 S3-D2：到达类任务目标；副本实例先写 ADR。

### 提交

- `c9613fd` `feat(alpha-03): add collect quest objectives with bag-derived progress`
  （36 个文件：契约、内容、领域、应用、服务端、客户端、测试、ADR、报告、状态与
  日志）。

### 补记：开发栈重启、内容发布与容量

- **开发栈重启**：用户确认后重试成功，84–87 于 10:12 重启到本切片代码；四个
  服务健康 200，Game Server 启动清理把 159 条过期地面掉落归零。
- **内容发布**：draft 200、validate 200（valid=true，0 issue，新增 2）、
  publish 201、activate 200；版本 `2026.11.27.5`（checksum `365b46e2…`），
  Game Server 日志在 10:13:07 确认内容刷新。
- **8584 实测**：真实 Chromium 新角色面板显示「巡路补给」可接取、
  「收集 金创药 0/1」、奖励 20 经验/15 金；「每日：收集蛛腿」未解锁、
  「收集 蛛腿 0/3」；分组为可接取 3 / 尚未解锁 11。截图
  `docs/phase-reports/alpha-03/collect-quests/dev-panel-8584.png`。
- **容量 sanity**：50 人 × 2 分钟 50/50、接受率 99.0%、165 击杀、0 资产
  失败；tick p50 2.81ms / p95 **5.25ms** / p99 6.52ms / max 9ms，资产事务
  p95 57.99ms；证据 `collect-quests/load-50p2a.json`，脚本 `EXIT:0`。
- **资产不变量**：重启后与压测后均 7/7 为 0。
- 新增证据文件：`collect-quests/dev-panel-8584.png`、`collect-quests/load-50p2a.json`。

## 2026-11-27 Alpha 0.3 S3-E：怪物归属、自动拾取与争夺掉落

### 目标

试玩反馈拾取仍需逐件点击；归属按最后一击，组队补刀与路人抢刀不公；点击远处
掉落只提示距离过远。本轮把拾取简化为“归属者自动飞入背包”，引入怪物归属判定，
并给首领与未来活动提供无归属、锁定 60 秒、只能手动拾取的争夺掉落。

### 实际改动

1. **怪物归属（领域）**
   - `CombatWorld` 记录首次伤害者与最近受击时间；10 秒无伤害后下一次伤害重新
     归属；离开地图、重生清空归属。
   - 怪物死亡事件增加 `ownerId`；最后一击不再决定奖励。
2. **奖励按归属者**
   - Room 的击杀奖励、金币、掉落、任务进度与队伍助攻全部按 `ownerId`；
     首领公告使用归属者名字。
3. **自动拾取（服务端）**
   - 每 4 tick 检查归属窗口内的掉落；归属者存活/在线/未过图且距离 ≤ 内容
     `rules.loot.autoPickupRangeTiles`（默认 3）时，复用 `AssetService.pickup`
     提交事务；背包已满退避 5 秒并提示一次。
   - 自动拾取后向归属者发送背包快照并广播 `loot.claimed`。
4. **争夺掉落（内容 + 持久化）**
   - `lootEntry.contested`；创建为无归属、`pickup_locked_until = now + 60s`，
     过期时间为锁定 + 120 秒；锁定期间 Room 与事务都拒绝并返回剩余毫秒。
   - 迁移 `0010` 增加 `world_drops.pickup_locked_until`；首领的灰烬之心、
     胸甲与三职业 12 级武器标记争夺。
5. **客户端**
   - 自动拾取：物品图标从地面飞向拾取者，本地玩家背包按钮脉冲。
   - 争夺掉落：地面标签与“附近掉落”列表显示锁定倒计时并禁用拾取。
   - 远处点击：发送既有 `move.to` 走到掉落格，到达后发送既有 `loot.pickup`；
     手动移动/攻击/施法/死亡/过图取消。
6. **测试**
   - 领域归属、契约与内容校验、应用争夺掉落/锁定、房间自动拾取、首领归属
     与锁定拒绝、纯函数拾取决策、浏览器自动拾取。
   - 旧手动拾取用例改为自动拾取断言；队伍共享兜底用例显式关闭自动拾取。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
pnpm verify:invariants
```

- 格式/lint/类型/构建：通过。
- 单元/集成：82 文件、**576 测试**通过。
- 全量 E2E：**47/47 通过**（10.6 分钟，串行全量）。
- 容量 sanity：50/50、接受率 98.9%、175 击杀、0 资产失败；tick p50 1.39ms /
  p95 **3.4ms** / p99 4.54ms / max 5.32ms，资产事务 p95 50.65ms。
- 资产不变量：7/7 为 0。
- 内容发布：`2026.11.27.6`（checksum `8acd4f45…`，新增 `rules.loot`、变更
  首领掉落表）已激活；Game Server 确认刷新。
- 8584 实测：击杀史莱姆后凝胶自动入包、背包按钮脉冲被捕获、地面掉落行 0、
  金币 50 → 52；截图 `loot-pickup/dev-auto-pickup-8584.png`。

### 遇到的问题及解决方法

1. **自动拾取与旧手动拾取用例抢时序**：自动化后手动命令有时赢、有时掉落已被
   吸走；经济集成/E2E 改为断言“无需点击即入包”，队伍共享用例使用显式
   `world.autoPickup=false` 测试开关。沉淀 EL-043。
2. **首领集成测试被共享测试库旧掉落误导**：`state.loot.size > 0` 提前满足，
   在归属者奖励事务提交前取快照。改为等待“本次新增的、锁定中的灰烬之心”。
3. **归属者不等于最后一击者**：首领测试原本读取最后一击者的经验，改为读取
   死亡事件的 `ownerId` 对应角色。
4. **奖励归属与自动拾取的范围**：自动拾取只针对归属窗口内的普通掉落；争夺
   掉落无归属、永不自动，锁定期间 Room 与事务双重拒绝。
5. **自动拾取绕过资产命令导致收集任务进度不刷新**：复核 S3-D1 交互时发现
   自动入包只发送背包快照，收集任务派生进度不会更新；在自动拾取成功后补发
   任务快照，并新增“击杀→自动拾取→收集任务完成”的服务端集成测试。

### 尚未解决

- 组队试玩首领争夺掉落（60 秒倒计时 → 手动拾取）与远处点击自动走近的人工
  确认；自动走近暂无浏览器 E2E。
- 怪物归属仅进程内、无可见归属标识、自动走近受地图/超时限制
  （TD-SRV-13/TD-CLI-22/TD-CLI-23）。
- 远端 CI 仍待确认；正式美术（TD-CLI-13）。

### 下一步计划

1. 组队试玩首领争夺掉落与远处走近，回填人工试玩记录。
2. 下一片：S3-D2 到达类任务目标或社交深化；副本实例先写 ADR。
3. 正式美术与远端 CI 确认。

### 提交

- `2439efb` `feat(alpha-03): claim monsters and auto-pick owned loot`
  （44 个文件：契约、领域、应用、持久化迁移、服务端、客户端、测试、ADR-041、
  切片报告、截图与负载证据、状态与日志）。

## 2026-11-27 Alpha 0.3 S3-D2：到达类任务目标与位置裁定

### 目标

任务此前只有击杀与收集，地图只是战斗背景。本轮增加“到达地点”目标：角色必须
走到指定地图的指定区域。完成由服务端权威位置裁定并持久化，接入一键导航、任务
面板与交付流程，并让每日任务按重置周期隔离。

### 实际改动

1. **契约**
   - 内容目标新增 `{ kind: 'reach', mapId, tile, radiusTiles }`，半径上限 5；
   - 视图新增解析后的 `mapName` 与目标格；任务进度为 0/1；
   - `QUEST_OBJECTIVE_KINDS` 增加 `reach`。
2. **内容**
   - `quest_town_east_gate`（1 级一次性，主城东门 (35,15)，半径 2）与
     `quest_daily_ruins_patrol`（8 级每日，废墟东侧 (43,20)，半径 2）。
3. **领域**
   - `reachObjectiveMet(objective, mapId, position)` 纯函数；
   - `questViewFor` 解析地图名；到达进度只读任务行，离开区域不回退。
4. **应用**
   - `AssetService.completeReachQuest`：锁角色行，按周期键只把 `active` 行推进到
     `completed`；重复/并发观测幂等；不写资产命令、金币账本或物品事务。
5. **服务端**
   - 每个地图 Room 每 4 tick 扫描在线会话的权威位置；命中后走既有资产队列，
     在飞行中按 `角色:任务` 去重，失败退避 2 秒；会话离开时清理退避记录；
   - 完成后更新会话任务记录、发送 `quest.update` 与提示，并停止对应自动导航。
6. **导航**
   - `hunt` 目的对到达任务选择目标地图与最短可达落脚点；跨图走传送门；
   - 到达任务不进入自动攻击；进入半径后清空路径，等待完成事务。
7. **客户端**
   - 面板/追踪器显示「到达 地图（x,y）」与“已到达/未到达”；
   - 行动按钮显示「前往探索」，导航横幅显示「自动探索」，底部提示同步。
8. **内容校验**
   - 目标地图存在、坐标在地图内、目标格可行走、半径 1–5。
9. **测试**
   - 新增 11 条单元/集成（契约 2、内容 3、领域 2、应用 2、服务端 1、客户端 1）
     与 `tests/e2e/reachQuests.spec.ts`；`questChain.spec.ts` 的分组数量随新增
     任务从 3/11 更新为 4/12。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_WORKERS=1 pnpm test:e2e
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/reach-quests/load-50p2a.json pnpm load:scenario
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：82 文件、**587 测试**通过。
- 全量 E2E：**48/48 通过**（串行全量）。
- 容量 sanity：50/50、接受率 99.1%、168 击杀、0 资产失败；tick p50 1.26ms /
  p95 **3.35ms** / p99 3.93ms / max 4.63ms，资产事务 p95 48.79ms；证据
  `alpha-03/reach-quests/load-50p2a.json`。
- 资产不变量：7/7 为 0。
- 内容发布：草稿 200、校验 200（valid=true，0 issue）、发布 201、激活 200；
  `2026.11.27.7`（checksum `2a33b8ef…`，新增 2、变更 0）；Game Server 日志
  确认 `content release refreshed`。
- 8584 实测：新角色面板显示「东门巡视」可接取、
  「到达 晨曦主城（35,15） 未到达」；每日「东境巡逻」未解锁、
  「到达 残垣废墟（43,20） 未到达」；一键接取并前往后追踪器变为可交付，
  回去交付后金币 50 → 55，提示“任务完成：东门巡视（经验 +15，金币 +5）”。
  截图 `reach-quests/dev-reach-offer-8584.png`、
  `dev-reach-completed-8584.png`、`dev-reach-claimed-8584.png`。

### 遇到的问题及解决方法

1. **面板是全图任务列表**：8584 首次验证时角色还没走到守卫身边，面板正确显示
   “前往接取”而不是“接取并前往”；先移动到守卫 3 格内后流程通过。这是距离
   校验生效，不是缺陷。
2. **交付后追踪器行消失**：手工脚本等待 DOM 中的追踪器变为 `claimed`，但已领取
   任务不再进入追踪列表；改为读取调试钩子的 `questState()` 后确认状态为
   `claimed`、金币 55。后续截图直接保留面板而非再次切换。
3. **新增任务改变面板数量**：全量 E2E 的 `questChain.spec.ts` 断言 3/11 失败，
   实际为 4/12；更新断言，未降低语义。
4. **每日隔离需要独立覆盖**：补充应用集成测试，用注入时钟验证旧周期行不可完成、
   新周期可重新接取与完成。
5. **全量 E2E 技能冷却时序失败**：`combat.spec.ts` 的 5 秒冷却断言排在两次法力
   轮询之后，轮询耗时可能让冷却先结束；停止自动攻击后的在途普攻还可能在存活
   检查与施法之间击杀目标，使施法被正确拒绝。改为先查冷却再轮询法力，施法前
   等 1 秒让残留攻击落地，目标已死则等待重生；断言不变。连续 12 条相关 E2E
   单跑通过后，再跑全量。
6. **移动预测用例被共享荒野实例干扰**：`movement.spec.ts` 的自动攻击接近断言
   采到静止角色，快照显示附近怪物正在“追击”。该 spec 改用
   `?freshTransfer=1` 隔离荒野实例，单跑 2/2 通过；断言未改。

### 尚未解决

- 每日「东境巡逻」的完整人工试玩（路程较长且穿越开放 PvP）。
- 世界内没有到达目标光柱/小地图标记（TD-CLI-24）。
- 远端 CI 仍待确认；正式美术（TD-CLI-13）。

### 下一步计划

1. 8584 试玩每日东境巡逻与跨图自动导航，按手感调整距离/等级/奖励。
2. 下一片优先队伍社交（聊天/移交/踢人，TD-CLI-17）；副本实例先写 ADR。
3. 补世界内到达目标标记（TD-CLI-24）；确认远端 CI 与正式美术。

### 提交

- `e8cedfb` `feat(alpha-03): add arrival quest objectives`
  （契约、内容、领域、应用、服务端、客户端、测试、ADR-042、切片报告、
  截图与负载证据）。
- `cef5d08` `test(alpha-03): stabilize combat and movement E2E timing`
  （技能冷却/残留攻击与移动预测用例的共享实例隔离）。

## 2026-11-27 Alpha 0.3 S3-M：八方向移动与键盘操作

### 目标

关闭 TD-CLI-18（四方向移动、斜向目标走 L 线）与 TD-CLI-07（无键盘移动、无
停止指令）：斜向点击直接斜走，WASD/方向键八方向短步，空格明确停止；移动仍由
服务端寻路与位置裁定。

### 实际改动

1. **契约**
   - `FACING` 保留 0–3，追加 `northEast=4`、`southEast=5`、`southWest=6`、
     `northWest=7`；新增 `facingFromDelta`。
   - `characterViewSchema` 与 Game Server 视图校验上限改为 7；无数据库迁移。
   - 新增 `move.stop` 命令 schema 与 `CLIENT_MESSAGES.moveStop`。
2. **寻路与模拟**
   - `findPath` 改为八方向 BFS；斜向步要求两个正交邻格可走，禁止切角；展开
     顺序优先离目标更近的方向。
   - 新增 `isStepAllowed`；`WorldSimulation.setPath` 校验相邻与斜向阻挡，取消
     轴对齐路点与“格内回中心”回退。
   - `step` 使用欧氏距离与整数比例推进；朝向按位移设置八方向。
   - `CombatWorld.advanceMonster` 与 `buildWaypoints` 同步；测试替身 BFS 同步。
3. **服务端**
   - `move.stop` 复用 `CommandGuard`（协议/重复 id/序号/限频），清空权威路径、
     停止自动攻击与任务导航，返回空路径 ack。
4. **客户端**
   - `buildPredictionWaypoints` 与服务端同步，直接走向下一格中心；
     `advancePrediction` 使用欧氏距离。
   - `WorldScene` 监听 WASD/方向键，按格提交 `move.to`；新按键立即打断点击
     路径；空格发送 `move.stop`；输入框/文本域聚焦时忽略，聚焦按钮/链接时
     保留空格原生行为。
   - 新增只读调试钩子 `selfServerPosition` 供 E2E 区分“逐帧预测”与“快照跟随”。
5. **测试**
   - 单元：八方向 BFS 直线/对角/绕墙/拒绝切角/确定性、`isStepAllowed`、欧氏
     步进与斜向朝向、客户端预测、键盘方向合成、`FACING`/`facingFromDelta`、
     `move.stop` 契约。
   - 集成：对角 `move.to` 两轴到达；`move.stop` 后位置稳定。
   - E2E：D+S 斜向移动、空格停止、聊天输入不移动；自动攻击平滑度用例先走到
     目标附近再锁定，并用“服务端位置未变但预测前进”的采样数判断。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
NO_PROXY=127.0.0.1,localhost npx playwright test --workers=1
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/eight-way/load-50p2a.json pnpm load:scenario
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：83 文件、**600 测试**通过（新增 13 条）。
- 全量 E2E（串行）：**49/49 通过**（10.8 分钟）。
- 容量 sanity：50/50、接受率 98.9%、194 击杀、0 资产失败；tick p50 1.48ms /
  p95 **3.72ms** / p99 5.06ms / max 6.57ms，资产事务 p95 62.03ms。
- 8584 实测：D+S 后预测 (12641,11641)、权威 (12500,11500)；空格停止后权威
  (12923,12923) 不变，预测误差 1.79 单位。

### 遇到的问题及解决方法

1. **平滑度 E2E 连续失败**：原用例从荒野入口锁定 `wilds_slime_14`，巡游怪物
   越过 AOI 格边界后不可见，出现 `INVALID_TARGET`，角色原地不动；同时服务器
   patch 已从 10Hz 提升到 20Hz，旧“最长静止采样数”判据在软件渲染 16–25 FPS
   下无法区分快照跟随与逐帧预测。改为先走到目标附近再锁定，并统计“服务端
   位置未变、客户端预测位置已前进”的采样数；新增只读 `selfServerPosition`
   调试钩子。单跑 3/3、全量 49/49 通过。
2. **空格与按钮冲突**：最初空格在所有焦点下都拦截；改为输入框/文本域忽略移动
   键，按钮/链接聚焦时保留空格原生激活，只有场景焦点下空格才停止。
3. **键盘打断点击路径**：按住方向键时若已有远距离点击路径，角色会先走完旧
   路线；新按键改为立即清空本地预测并提交相邻格意图，由服务端替换路径。
4. **E2E 覆盖历史截图**：全量 E2E 会把 `docs/phase-reports/` 下历史截图重新
   生成；验证后已 `git restore` 恢复，不把二进制抖动带入提交。

### 尚未解决

- 2-worker 全量 E2E 在软件渲染下仍可能因帧率低于 20Hz 触发平滑度抖动；本轮
  以串行全量作为权威证据。
- 正式美术仍为四方向帧；斜向表现使用最近基本方向映射（TD-CLI-13）。
- 键盘按键不可配置、无手柄；远端 CI 仍待确认。

### 下一步计划

1. 下一片优先队伍社交（聊天/移交/踢人，TD-CLI-17）；副本实例先写 ADR。
2. 补世界内到达目标标记（TD-CLI-24）。
3. 正式美术与八方向角色帧；确认远端 CI。

### 提交

- `cc7d0f2` `feat(alpha-03): add eight-way movement and keyboard controls`
  （契约、寻路/模拟/战斗、服务端 `move.stop`、客户端键盘与预测、单元/集成/
  E2E、ADR-043、切片报告、状态、日志、债务与经验、容量与 8584 证据）。

## 2026-11-27 Alpha 0.3 S4-A：队伍社交（聊天、移交、踢人）

### 目标

补齐 TD-CLI-17 的主要缺口：队伍面板只有名单与「离队」，队伍无法协调。本切片
交付队伍频道聊天、队长移交与踢人，权限由服务端判定，队伍聊天跨图但仍只发给
成员。

### 实际改动

1. **契约**
   - `party.transfer` / `party.kick` 命令与 `PartyKickCommand`、
     `PartyTransferLeaderCommand` 类型。
   - `CHAT_CHANNELS = ['map', 'party']`；`chat.send.channel` 可选、默认 `map`；
     `chat.message.channel` 改为同一枚举。
   - 拒绝码 `PARTY_NOT_LEADER`、`PARTY_TARGET_NOT_MEMBER`、`PARTY_TARGET_SELF`。
2. **服务端**
   - `PartyRegistry.transferLeader` / `kick`：仅队长、目标同队、不能对自己；
     踢人移除成员并丢弃其邀请，队长不能被踢。
   - `PartyService`：移交/踢人后按 presence 刷新（被踢者的 Room 也会收到
     空名单）；`deliverChat` 逐个成员按所在 Room 端口投递；端口新增 `sendChat`。
   - `WorldMapRoom`：注册新命令；共用 `runPartyCommand` 门禁与
     `validatePartyManagement`；聊天频道为 `party` 时要求成员身份并走服务投递，
     仍复用过滤、限频、禁言与去重。
3. **客户端**
   - `WorldClient`/`useWorldSession`/调试钩子支持频道与移交/踢人。
   - 聊天面板「附近 / 队伍」切换、队伍消息标签、非成员禁用队伍频道；离开或
     被踢后自动回到附近频道。
   - 队长在成员行看到「移交」「踢出」；非队长不渲染。
4. **测试**
   - 契约：移交/踢人命令校验、聊天频道默认与非法频道。
   - 注册表：权限、目标校验、移交后权限转移、踢人清理邀请、非成员拒绝。
   - 服务：移交/踢人刷新、被踢者 Room 刷新、聊天按 Room 投递、过图间隙丢消息。
   - Room 集成：队伍消息隐私（同图陌生人只收到地图消息）、跨图队伍聊天、
     权限拒绝、踢人后名单清空与队伍频道拒绝。
   - E2E：双人组队 → 队伍聊天标签 → 移交 → 踢人 → 频道回退。

### 命令与结果

```bash
pnpm exec prettier --write <changed files>
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/party.spec.ts
pnpm exec playwright test
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：83 文件、**613 测试**通过（新增 13 条）。
- 队伍 E2E：2/2 通过（新用例 8.8 秒）。
- 全量 E2E：**50/50 通过**（5.8 分钟）。
- 开发栈：84–87 于 17:11 重启到本切片代码，4 个服务健康 200，内容
  `2026.11.27.7` 刷新无错误。

### 遇到的问题及解决方法

1. **客户端类型收窄**：队伍面板的 JSX 条件里直接访问 `state.party.leaderId`
   在回调作用域内被 TypeScript 视为可能为 null；改为在组件体先计算
   `partyLeaderId`，渲染只比较该值。
2. **8584 浏览器复验不可用**：沙箱内 Chromium 无法跨命令访问开发栈监听端口
   （同一命令内启动的临时 HTTP 服务可访问，curl 健康检查正常）；双人浏览器
   证据改用全量 E2E（服务与浏览器由同一测试命令启动），开发栈保留给人工试玩。
3. **历史截图抖动**：全量 E2E 会重新生成历史阶段截图；验证后按惯例恢复旧的
   已提交文件，只保留本切片新增的 `party-social/` 证据。

### 尚未解决

- 队伍仍是进程内状态（TD-SRV-11）；队伍聊天无离线消息/历史。
- 被踢者没有定向提示；按名字邀请与世界内队伍标记仍开放（TD-CLI-17 剩余）。
- 未复跑 50 人容量回归（本切片不改变 tick 热路径）。
- 远端 CI 仍待确认；8584 人工试玩待进行。

### 下一步计划

1. 世界内到达目标标记（TD-CLI-24）。
2. 按名字邀请与队伍标记（TD-CLI-17 剩余）。
3. 3 人副本实例先写 ADR；正式美术与八方向角色帧。

### 提交

- `800f389` `feat(alpha-03): add party chat, leader transfer, and kick`
  （契约、注册表/服务/Room、客户端、单元/集成/E2E、ADR-044、切片报告、
  计划与债务、证据截图）。

## 2026-11-28 Alpha 0.3 S4-B：好友系统与聊天频道筛选

### 目标

按用户确认的社交顺序（频道筛选 + 好友 → 私聊 → 行会），交付好友申请/列
表/在线状态与好友跨图组队邀请，并让聊天日志可以按频道筛选。

### 实际改动

1. **持久化**
   - 新表 `friendships`（迁移 `0011`）：无序对 `(low_character_id,
high_character_id)` 唯一、`requested_by_id`、`pending | accepted`、
     时间戳；检查约束保证 low < high、发起方属于该对、pending 与
     `responded_at` 一致；角色删除级联。
   - 仓储：查找/插入申请、条件接受（仅非发起方可接受）、拒绝删除、删除好友、
     好友/申请列表、角色资料批量查询、好友 id。
2. **契约**
   - `friend.request/accept/decline/remove/list`、`friend.snapshot`、
     `friend.presence`、`friend.refresh`；好友视图、申请方向、列表上限；
     6 个好友拒绝码。
3. **应用层**
   - `FriendsService`：申请/接受/拒绝/删除/列表；重复申请返回同一行、重复接受
     幂等、双方互相申请自动成为好友；自己/不存在目标返回明确错误。
4. **服务端**
   - 进程级 `FriendNotifier` 按 presence 找到玩家所在 Room，投递刷新与上下线
     事件；Room 注册端口。
   - 好友命令走统一门禁（协议、commandId、序号、限频），数据库操作在 tick
     之外，提交后回复；`friend.list` 合并 presence 生成快照。
   - 加入/真正离开世界时向在线好友推送 presence；过图只标记离线。最终离开
     无条件清理 presence（修复幽灵在线）。
   - `party.invite`：同图近距离规则不变；跨图/超范围异步检查好友关系，仅好友
     可邀请；创建后仍由 PartyService 跨图投递。
5. **客户端**
   - 好友面板：好友申请（接受/拒绝）、已发送、在线好友（邀请/删除）；
     附近玩家「加好友」与未处理申请角标；好友可跨图邀请组队。
   - 聊天日志「全部 / 附近 / 队伍」筛选（纯展示）。
   - 好友按钮加入角色状态板；压缩操作按钮间距与内边距，保持状态板 ≤200px。
6. **测试**
   - 契约 5 条；应用集成 4 条（真实 PostgreSQL）；Room 集成 1 条（申请→接受→
     跨图组队→陌生人拒绝）；浏览器 E2E 1 条（加好友→接受→好友邀请组队→
     聊天筛选 + 面板不遮挡中线）。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
pnpm exec playwright test tests/e2e/friends.spec.ts
pnpm exec playwright test
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/friends/load-50p2a.json pnpm load:scenario
```

- 格式 / lint / 类型 / 构建：通过。
- 单元/集成：85 文件、**623 测试**通过（新增 10 条）。
- 好友 E2E：1/1 通过；HUD 与好友组合 5/5。
- 全量 E2E：首轮 47 通过、1 失败（状态板高度 205 > 200）、3 未运行；修复后
  **51/51 通过**（6.0 分钟）。
- 容量 sanity：50/50、接受率 98.7%、202 击杀、0 资产失败；tick p50 1.38ms /
  p95 **3.6ms** / p99 4.36ms / max 4.89ms，资产事务 p95 54.8ms。
- 迁移 `0011` 已应用到开发库；开发栈 84–87 于 07:22 重启，内容
  `2026.11.27.7` 刷新无错误。

### 遇到的问题及解决方法

1. **幽灵在线**：未加入队伍的玩家离开世界后 presence 从未清理，好友列表会显示
   在线、跨图邀请可能路由到已离开的 Room。改为最终离开无条件
   `PartyService.removePlayer`，过图仅 `markOffline`；沉淀 EL-046 与 TD-SRV-14。
2. **状态板高度回归**：新增「好友」按钮后操作行换成两行，HUD 用例断言状态板
   ≤200px 失败（205px）。没有放宽断言，而是压缩玩家操作区按钮内边距与间距，
   六个按钮回到一行；HUD 用例恢复通过。
3. **E2E 集成可见性**：好友测试最初等待 Carol 出现在 Alice 的 `state.players`，
   但 AOI 不会包含 18 格外的玩家；改为等待 Carol 在自己的 Room 视图中出现。
4. **好友列表定位**：好友面板最初缺少绝对定位，会落在静态位置；补右停靠
   （right 40 / top 132 / bottom 84）与窄屏规则，并在 E2E 断言它位于屏幕
   中线右侧，不遮挡玩家。

### 尚未解决

- 在线状态仍由 `PartyService` 持有（TD-SRV-14）；多进程前需要独立在线目录。
- 无黑名单/举报、好友分组、离线消息、按名字搜索；好友申请只有命令限频。
- 只跑了 50 人 × 2 分钟 sanity，未跑 10 分钟正式回归；远端 CI 仍待确认。
- 私聊与行会未开始。

### 下一步计划

1. 私聊：好友/最近同玩入口、跨图投递、隐私与限频。
2. 行会 ADR 与最小行会（含行会频道）。
3. 世界内到达目标标记（TD-CLI-24）与按名字邀请（TD-CLI-17 剩余）。

### 提交

- `7cb24c7` `feat(alpha-03): add persistent friends and cross-map party invites`
  （好友持久化与迁移、契约、应用服务、服务端通知与跨图邀请、客户端好友面板
  与聊天筛选、测试、ADR-045、切片报告、计划/债务/经验/演进记录与证据）。

### 2026-11-28 体验修复：聊天频道合并为一套选择器

- 背景：用户试玩发现左下角同时存在两套频道控件（标题栏的发送频道与日志上方的
  「全部/附近/队伍」筛选行）；在两套控件之间切换时会出现“看着队伍频道、发言
  却仍发到附近”的错位。
- 修复：移除独立的筛选行；聊天面板只保留「附近 / 队伍」一套选择器，切到哪个
  频道就只显示该频道消息，并发送到该频道；系统消息仍在独立的系统日志中展示；
  离开或失去队伍时自动回到附近频道。输入框提示随频道变为“发送到队伍…”。
- 测试：更新 `party.spec.ts` 与 `friends.spec.ts`，验证切换频道会同时切换日志
  与输入提示、另一频道消息不再混排；全量 **51/51** 浏览器 E2E 通过。
- 文档：切片报告、执行计划、状态与演进记录同步为“单一频道选择器”。
- 提交：`1d7be49` `fix(alpha-03): use one chat channel selector for view and send`。

### 2026-11-28 体验修复：聊天回到标准布局（默认全部 + 独立发言频道）

- 背景：上一版把“看哪个频道”和“发到哪个频道”合成一套控件后，用户指出标准
  做法是：默认显示所有频道的消息，频道标签只做筛选，发言频道单独选择。
- 修复：聊天日志默认显示「全部」（附近 + 队伍）；标题栏「全部 / 附近 / 队伍」
  只筛选日志；输入行左侧新增发言频道选择器（附近 / 队伍），与筛选互不影响；
  队伍消息默认可见并带「队伍」标签；离开或失去队伍时筛选回到全部、发言回到附近。
- 测试：更新 party/friends E2E，覆盖“默认双频道可见、筛选不改变发言目标、
  选择器决定发送频道、被踢后回退”；全量 **51/51** 浏览器 E2E 通过。
- 文档：切片报告、执行计划、状态与演进记录同步为“聊天标准布局”。
- 提交：`58f5050` `fix(alpha-03): show all chat channels by default with a send selector`。

### 2026-11-28 Alpha 0.3 S4-C：好友私聊与进程级在线目录

**目标**：在好友与频道筛选之后交付一对一私聊（好友入口、跨图投递、隐私与
限频），并按 TD-SRV-14 把在线状态与跨 Room 路由从 `PartyService` 提取为独立的
在线目录，供队伍、好友与后续行会共用。

### 实际改动

1. **进程级 PlayerDirectory**
   - 新增 `apps/game-server/src/world/playerDirectory.ts`：presence 表、Room
     投递端口、`deliver`/`deliverMany`；投递类型为闭集联合（聊天、组队邀请、
     队伍名单刷新、好友事件）。
   - `PartyService` 只保留队伍注册表，构造时注入目录；presence、端口与
     `registerRoom` 全部移除。`FriendNotifier` 删除，好友刷新与上下线事件改由
     目录投递。
   - Room 只注册一个投递端口；`deliverToPlayer` 按类型解码，不把跨 Room 状态
     写入公开 Room State。
2. **契约**
   - `CHAT_CHANNELS` 增加 `whisper`；`chat.send` 增加可选 `targetPlayerId`，
     `chat.message` 增加可选 `targetPlayerId` / `targetDisplayName`。
   - schema 强制私聊必须带目标、其他频道不得带目标；新增拒绝码
     `CHAT_TARGET_UNAVAILABLE`。
3. **服务端**
   - `handleChat` 的私聊分支复用过滤、限频、禁言与 `clientMessageId` 去重；
     `deliverWhisper` 异步校验好友关系，再按目录投递并回显发送者。
   - 离线、非好友、自己与目录投递失败统一返回 `CHAT_TARGET_UNAVAILABLE`；
     关系查询失败返回 `SERVICE_UNAVAILABLE`。
   - 私聊消息不落库、不进入公开 Room State；双方收到同一 `messageId`。
4. **客户端**
   - 好友行「私聊」选中目标、切换发言频道与日志筛选；发言选择器显示
     「私聊·名字」，输入提示显示发送对象。
   - 私聊行显示「→ 名字」或「私聊」标签；“全部”日志同时显示附近、队伍与私聊。
   - 目标离线/失去好友时自动清空目标并回到附近频道。
5. **测试**
   - 契约 2 条（目标必填、目标字段保留）；`PartyService` 测试改为通过目录写入
     presence；新增真实 Room + PostgreSQL 跨图私聊用例（收件、回复、陌生人、
     自己、离线）。
   - `tests/e2e/friends.spec.ts` 扩展私聊收发、标签与地图频道隔离断言。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/friends.spec.ts
pnpm exec playwright test tests/e2e/party.spec.ts tests/e2e/hud.spec.ts
pnpm exec playwright test
pnpm build
pnpm verify:invariants
LOAD_PLAYERS=50 LOAD_ATTACKERS=10 LOAD_DURATION_MS=120000 \
  LOAD_OUTPUT=docs/phase-reports/alpha-03/whisper/load-50p2a.json pnpm load:scenario
```

- 格式 / lint / 类型检查：通过。
- 单元/集成：85 文件、**626 测试**通过。
- 好友 E2E：1/1 通过；队伍 + HUD E2E：6/6 通过。
- 全量 E2E：**51/51 通过（6.1 分钟，退出码 0）**。
- 构建：通过（全部 workspace 包）。
- 容量 sanity：50/50、接受率 98.9%、206 击杀、0 资产失败；tick p50 1.4ms /
  p95 **4.04ms** / p99 5.82ms / max 6.88ms，资产事务 p95 59.14ms。
- 资产不变量：压测后 7/7 为 0。
- 开发栈：84–87 于 10:04 重启到本切片代码（Node 26），4 个服务健康 200。

### 遇到的问题及解决方法

1. **在线目录职责漂移**：好友切片把 presence 留在 `PartyService`，私聊成为
   第三个消费者。先完成 TD-SRV-14 的提取再写功能，避免复制第二份在线状态或
   在“队伍服务”里长出私聊路由；沉淀 EL-047。
2. **隐私探测**：离线、非好友与自己使用同一个拒绝码，客户端无法用私聊探测
   某人是否在线；入口只放在好友列表。
3. **投递失败**：目录 `deliver` 返回 false 时不再回显，避免发送者以为消息已
   送达；统一按 `CHAT_TARGET_UNAVAILABLE` 提示。
4. **测试竞态**：离线好友用例最初依赖 `friend.list` 快照，可能与最终离开的
   presence 清理竞速；改为等待 `friend.presence` 的 `online=false` 事件再发
   私聊。

### 尚未解决

- 私聊没有离线消息、历史记录、黑名单或“最近同玩”入口；过图/重连丢失客户端
  聊天记录（TD-CLI-04）。
- 在线目录仍为进程内状态（与 TD-SRV-11 同类），多进程前需要共享协调。
- 完整人工试玩、50 人 × 10 分钟正式回归与远端 CI 待完成。

### 下一步计划

1. 世界内到达目标标记（TD-CLI-24）。
2. 按名字邀请/最近同玩与队伍标记（TD-CLI-17 剩余）。
3. 行会先写 ADR；3 人副本先写动态实例 ADR。

### 提交

- `e4bcdef` `feat(alpha-03): add friend whispers through a process player
directory`（私聊、PlayerDirectory、契约、服务端与客户端、测试、ADR-046、
  切片报告、计划/债务/经验/演进记录、负载与 E2E 证据），已推送 `origin/main`。

### 2026-11-28 体验修复：聊天连续性与点击名字回复

**背景**：试玩反馈三点——换地图后所有聊天记录消失；收到私聊后应能直接点对方
名字回复；希望按同类 MMORPG 的常见习惯完善聊天体验。

### 根本原因

`useWorldSession.handleTransfer` 把 `messages`、`systemMessages`、`friends` 与
`party` 当作地图状态一起清空。聊天只存在客户端内存，所以过图即丢失；好友
快照清空还会让正在进行的私聊目标被自动取消。Phaser 场景重建是 TD-CLI-04 的
另一半，与本轮反馈无关。

### 实际改动（仅客户端）

1. **跨图保留对话状态**：过图不再清空聊天、系统日志、好友与队伍；地图实体、
   战斗、任务与商店仍重置。聊天上限 120、系统日志 60 不变。
2. **点击名字回复**：日志中在线好友的作者名渲染为按钮，点击后切换私聊目标、
   发言频道与日志筛选并聚焦输入框；非好友/离线保持普通文本。
3. **未读提示**：私聊被当前筛选或收起面板隐藏时，「私聊」标签显示紫色圆点；
   切到「全部 / 私聊」或展开后清除。
4. **常见习惯**：新消息自动跟随到底部，向上翻看后暂停；`↑`/`↓` 召回最近
   20 条输入；输入框旁 `×` 结束私聊并回到附近。

### 命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/friends.spec.ts
pnpm exec playwright test
pnpm build
```

- 格式 / lint / 类型 / 单元与集成（626 测试）：通过。
- 好友 E2E：1/1 通过（26.5 秒），覆盖过图保留记录、点击名字回复、跨图回报、
  未读点、输入历史与结束私聊。
- 全量 E2E：**51/51 通过（6.0 分钟，退出码 0）**；构建：通过。

### 未改动

- 过图仍销毁并重建 Phaser 场景（TD-CLI-04 场景部分）；聊天记录不落库，刷新
  页面仍会丢失。
- 非好友不能从聊天名字发起私聊；放开前需要黑名单/举报与更严格的限频。

### 提交

- `19383cf` `fix(alpha-03): keep chat history across maps and reply by name`
  （客户端聊天连续性、点击名字回复、未读提示、输入历史、E2E 与截图）。
