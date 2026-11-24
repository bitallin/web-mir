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

### 尚未解决的问题

- 位置只在 Room 内存；Room 崩溃后角色回到出生点（阶段 3/5）。
- 单图 30/50 人容量尚未实测（阶段 8）。
- 正式账号/票据、角色名唯一、单角色租约（阶段 2）。
- Tiled、导航网格、AOI、地图切换（阶段 3）。
- 独立测试数据库仍未建立（阶段 5 前）。
- 生产反向代理的 `/ws` 路由尚未配置（阶段 8 部署）。
- 当前主机有一个旧开发栈占用 84–87，需要用户自行重启才能看到阶段 1 页面。

### 阶段提交

- 提交信息：`feat(phase-1): deliver browser two-player realtime slice`
- 提交哈希：提交后由 `git log --oneline` 查看。

### 下一步计划

1. 等待 Tech Lead 审阅阶段 1 报告与证据。
2. 批准后执行阶段 2：账号、角色、Argon2id、刷新令牌、一次性 game ticket、
   单角色会话租约、角色持久化与角色列表 API。
