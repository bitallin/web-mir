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
