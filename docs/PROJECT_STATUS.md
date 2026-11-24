# Web Legend 项目状态

> 更新日期：2026-11-24
> 维护规则：每个重要任务或阶段结束后更新；阶段门禁未通过不得标记完成。

## 1. 当前阶段

**阶段 2：账号、角色和连接票据 —— 已完成并通过用户实测验收（2026-11-24，8584 端口）。**

阶段 0、阶段 1、阶段 2 均已通过审阅。阶段 3（正式地图、服务端移动和世界状态）
尚未开始，将在下一次会话启动。

## 2. 阶段进度

| 阶段                           | 状态   | 说明                                                                |
| ------------------------------ | ------ | ------------------------------------------------------------------- |
| 阶段 0：工程底座               | 已完成 | 工程、依赖、质量门禁、数据库、健康检查、文档                        |
| 阶段 1：双浏览器联机切片       | 已完成 | 测试地图、world_map Room、服务端移动、双浏览器可见、重连、HUD、E2E  |
| 阶段 2：账号与票据             | 已完成 | 账号/会话、Argon2id、角色、一次性 ticket、角色租约、位置持久化、E2E |
| 阶段 3：地图与世界状态         | 未开始 | 等待阶段 2 审阅通过                                                 |
| 阶段 4：怪物与战斗             | 未开始 | —                                                                   |
| 阶段 5：掉落与资产持久化       | 未开始 | —                                                                   |
| 阶段 6：聊天、PK 与体验        | 未开始 | —                                                                   |
| 阶段 7：运营后台与内容发布     | 未开始 | —                                                                   |
| 阶段 8：质量、压测、部署与恢复 | 未开始 | —                                                                   |

## 3. 当前正在进行的任务

无。阶段 2 已验收，阶段 3 将在下一次会话启动。

## 4. 已完成内容

### 阶段 0 保留内容

- pnpm workspace Monorepo；Node.js 26.13.1、pnpm 11.7.0、TypeScript 5.9.3。
- ESLint 依赖边界、Prettier、Vitest、Playwright、Vite/tsup 构建。
- PostgreSQL 18 + Drizzle 迁移；Fastify Control API；Colyseus 健康检查与
  diagnostics Room；Pino 日志与脱敏。
- 工程文档、ADR-001…014、阶段 0 报告。

### 阶段 1 保留内容

- `contracts` 的实时协议、严格 join 校验、地图 manifest 与 world-state schema。
- `game-simulation`：固定 tick、四方向 BFS、整数子格移动推进。
- `world_map` Room：20Hz 模拟、10Hz patch、服务端权威移动、幂等、限频、重连。
- 伪等距 Phaser 世界、React HUD、本地预测与远端插值。
- 双人可见、刷新重连、断线恢复、Scene 重启、局域网 HTTP 的 E2E。

### 阶段 2：账号、角色和连接票据

`packages/contracts`：

- 账号/密码/登录/注册、账号视图、认证响应 schema。
- 职业目录（战士/法师/道士及基础属性）、角色名规则、角色视图、创建/列表请求。
- game ticket 请求/响应与 60 秒 TTL；`worldJoinOptionsSchema` 只接受
  `{protocolVersion, ticket}`。
- 错误码扩展：账号已存在、凭据错误、角色重名、角色上限、区服不存在。
- `@web-legend/contracts/phase1-map`：客户端、Control API 与 Game Server
  共享的测试地图。

`packages/auth`（新包）：

- Node 26 内置 Argon2id（OWASP 参数）、PHC 编码与常量时间校验。
- 256 bit 不透明令牌、SHA-256 摘要、access/refresh 有效期策略。

`packages/persistence`：

- 迁移 `0001_peaceful_rachel_grey.sql`：`accounts`、`account_sessions`、
  `characters`、`character_sessions`、`game_tickets`。
- 区服内角色名唯一索引 `(realm_id, name_normalized)`。
- 账号/会话/角色/票据/租约仓储；唯一冲突识别沿 `cause` 链。
- `pnpm db:seed` 幂等写入默认区服 `classic-01`。

`apps/control-api`：

- 注册、登录、刷新（轮换）、登出（撤销）、`/me`、`/realms`。
- 角色列表、创建、读取（所有权校验）。
- 一次性 game ticket 签发（60 秒，绑定角色与区服）。
- HttpOnly + SameSite=Lax Cookie；生产 Secure；access 15 分钟、refresh 30 天。
- CSRF Origin 校验、16KB body 限制、认证令牌桶限频。
- 未知账号占位 Argon2 校验，降低账号枚举时序差。

`apps/game-server`：

- `DATABASE_URL` + `GAME_SERVER_ID`；就绪探针包含数据库。
- `onAuth` 原子消费票据、校验角色/区服、获取单角色租约。
- 删除全部开发身份分支；生产与开发都只接受真实票据。
- 入图恢复持久化位置/朝向；非法坐标回退出生点。
- 离开、宽限期结束、Room dispose 时 checkpoint 并释放租约；30 秒租约、10 秒续租。

`apps/game-web`：

- 登录/注册页、角色选择与创建页、世界页三段式流程。
- API 客户端自动 refresh 重试；错误 envelope 展示服务端消息。
- 每次入图获取新 ticket；重连 token 按角色隔离。
- 移除 `?name/?key` 开发身份参数；保留 DEV-only `?fresh/?join` 测试隔离。

`tests` 与文档：

- 31 个测试文件、146 个测试；9 个真实浏览器 E2E。
- ADR-017（账号会话、ticket、租约），ADR-015 标记 Superseded。
- 阶段 2 报告、认证/角色/双人截图、WebSocket 日志、数据库证据。

## 5. 尚未完成内容

- 阶段 3 起全部玩法与业务：Tiled 地图、map-runtime、AOI、地图切换、怪物、
  战斗、技能、掉落、背包、装备、金币、聊天、PK、复活、运营后台和内容发布。
- 周期位置/HP/MP checkpoint（当前仅离开时保存）。
- 票据与会话清理任务；多进程租约协调与崩溃恢复优化。
- 多地图、多线路、多 Game Server、Redis Presence/Driver。
- 生产部署、HTTPS/WSS、分布式限频、监控接入、压测、备份恢复。
- 独立测试数据库或临时 schema（阶段 5 前）。
- 密码找回、邮箱验证、MFA。
- 正式美术资源与 Tiled 管线；当前地图与角色仍是明确标识的技术占位资产。

## 6. 当前技术风险

| 风险                                | 影响                          | 缓解                                                      |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------- |
| 进程崩溃后角色租约最长 30 秒仍有效  | 重启后短时间提示“另一台设备”  | 正常离开立即释放；阶段 3/8 增加进程注册与恢复策略         |
| 位置仅在离开/dispose 时 checkpoint  | 崩溃丢失最近移动              | 阶段 3 实现节流 checkpoint；已提交的角色与资产不受影响    |
| 票据/会话行不自动清理               | 表增长                        | MVP 数据量小；阶段 7/8 增加清理任务与指标                 |
| 认证限频为单进程内存                | 多实例下限频不一致            | 阶段 8 使用网关或 Redis；MVP 单实例                       |
| access token 每次请求查库           | 认证请求增加数据库读          | MVP 规模可接受；后续可加缓存或签名 token                  |
| 共享开发数据库                      | 测试数据残留、并行污染        | 唯一账号/角色名；阶段 5 前建立独立测试库                  |
| 技术测试地图与占位角色视觉          | 不代表最终画面与手感          | 阶段 3 接 Tiled/资源管线                                  |
| 250ms 可见性目标接近本机上限        | 容器/软件渲染下偶发接近 200ms | 实测 141–204ms；后续超标先查 patch 与渲染，不降低断言     |
| Colyseus 0.18 API 较新              | 升级可能改变 Room/重连行为    | 真实 WebSocket 集成测试锁定 join/移动/拒绝/重连/租约/指标 |
| 单房间 30/50 人容量尚未实测         | 阶段 8 目标未知               | 阶段 8 真实压测；当前 50 人上限只是保护值                 |
| 角色数量上限“先查后插”              | 极端并发可超过 8 个           | 不影响资产安全；后续加数据库约束或事务                    |
| 开发 PostgreSQL 端口发布在所有接口  | 共享主机暴露风险              | 仅本地开发；生产使用私有网络                              |
| 容器 inotify 限额 8192              | watcher ENOSPC                | 默认后端无 watch、Vite 轮询                               |
| Playwright 浏览器无法在当前系统下载 | E2E 依赖预装 Chromium         | `.env` 指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`              |
| Redis 8.2 本地镜像不可用            | scale profile 暂不可启动      | MVP 不依赖 Redis                                          |

## 7. 已知问题

- 当前主机 84–87 被用户已有的开发栈占用；本阶段 E2E 在 8844–8847 运行同一套
  新代码（仅端口不同，未停止用户进程）。正常环境使用默认端口。
- `pnpm dev` 默认不热重载后端；修改后端需重启开发栈。前端 Vite 轮询热更新。
- 开发端口为 84/85/86/87，而非架构示例中的 5173/5174/3000/2567。
- 浏览器通过同源 `/ws` 访问实时服务器；生产反向代理必须转发该路径的 HTTP 与
  WebSocket，或设置 `VITE_GAME_SERVER_URL`。
- `/api` 与 `/ws` 开发代理必须保留原始 Host（`changeOrigin: false`），否则
  CSRF Origin 校验会拒绝局域网来源。
- `?fresh/?join` 仅在开发构建生效；生产构建忽略。`?name/?key` 已移除。
- 管理后台仍只有阶段 0 健康状态与交付说明，没有业务页面（阶段 7）。
- 角色被另一客户端控制时统一返回 525；客户端展示服务端消息，但不区分“租约被占”
  与“票据失效”的错误码。
- `pnpm test:e2e` 会执行迁移与区服 seed，并启动 game-web、admin-web、
  control-api、game-server 四个服务；开发栈已运行时加
  `PLAYWRIGHT_SKIP_WEBSERVER=true`。
- 集成与 E2E 使用共享开发库，会留下测试账号/角色/票据记录。

## 8. 阻塞事项

无阻塞。阶段 2 已由用户在 8584 实测通过；阶段 3 待下一次会话启动。

## 9. 最近一次测试结果

日期：2026-11-24

| 检查        | 命令                                                        | 结果                                     |
| ----------- | ----------------------------------------------------------- | ---------------------------------------- |
| 格式        | `pnpm format:check`                                         | 通过                                     |
| Lint / 边界 | `pnpm lint`                                                 | 通过（0 error / 0 warning）              |
| 类型        | `pnpm typecheck`                                            | 通过（根配置 + 12 个 workspace）         |
| 单元/集成   | `pnpm test`                                                 | 31 个文件，146 个测试全部通过（约 4.5s） |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e`（8844–8847） | 9 个测试全部通过（约 44s）               |
| 构建        | `pnpm build`                                                | 4 个应用全部成功                         |
| 迁移        | `pnpm db:migrate`                                           | 2 条迁移在真实 PostgreSQL 18.3 执行      |
| 区服        | `pnpm db:seed`                                              | 幂等写入 `classic-01`                    |

用户验收（2026-11-24）：

- 用户在 `http://<LAN-IP>:8584/` 完成注册、创建角色并进入世界，确认测试通过。
- 遗留的 8588 演示栈（旧 game-server 89）已停止；阶段 2 统一使用 84–87。
- 用户决定保留 PostgreSQL 容器，下一次会话继续使用现有数据。

阶段 2 关键证据：

- 双人可见延迟：完整套件 141ms；单独运行 184ms；均 < 250ms。
- 票据一次性：110 张票据中 101 已消费、9 已过期、0 张未消费未过期。
- 租约：集成测试与 E2E 均证明第二客户端被拒；测试结束 0 个活跃租约。
- 位置恢复与 checkpoint：集成测试逐字段断言；90 个角色记录 version > 0。
- 认证安全：未知账号 401、错误密码 401、跨账号读取/票据 404、旧 refresh 401、
  登出后 access/refresh 均 401、跨源写 403、限频 429。
- 生产门禁：伪造 ticket 与自报身份字段均 525；diagnostics Room 不存在（520）。
- 局域网 HTTP：注册、建角、入图、移动全部通过；`isSecureContext === false`。
- 证据目录：`docs/phase-reports/phase-02/`。

## 10. 最近一次 Git 提交

- 阶段 0 主提交：`69df6c387eff5ae143f84f79e6c7a4cf96e57721`
- 阶段 1 主提交：`e6574057308dd6bfe5c9f99d4b06d24a5ee00236`
- 阶段 1 修复提交：`954155f`、`5f2dbbf`、`f4b74ff`
- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
  主题：`feat(phase-2): deliver accounts, characters and one-time game tickets`

## 11. 当前环境事实

- Node.js 26.13.1（nvm），pnpm 11.7.0。
- Docker 24.0.5，Docker Compose v5.7.0；PostgreSQL 18.3。
- SSH 容器端口映射：宿主机 `8580-8589` → 容器 `80-89`；项目默认使用 84–87。
- PostgreSQL 从 SSH 容器通过网关 `192.51.0.1:5432` 访问。
- Playwright 使用预装 Chromium 131。
- 本地开发库当前有 132 个测试账号、108 个测试角色、110 张票据（均来自真实
  集成/E2E 流程）。

## 12. 下一步

下一次会话开始阶段 3，按 `docs/phase-reports/PHASE_02_REPORT.md` 第 10 节执行：
Tiled 地图、map-runtime、地图实例与传送、AOI、节流 checkpoint 与同图聊天。
会话开始时先启动 84–87 开发栈并交给用户测试。阶段 3 验收通过前不得进入阶段 4。
