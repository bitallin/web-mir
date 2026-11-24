# 阶段 2 报告：账号、角色与连接票据

> 日期：2026-11-24
> 状态：已完成，等待 Tech Lead 审阅
> 前置：阶段 0、阶段 1 已通过审阅
> 相关决策：[ADR-017](../ADR/ADR-017-accounts-sessions-game-tickets.md)，
> 取代 [ADR-015](../ADR/ADR-015-developer-identity.md)

---

## 1. 阶段概述

阶段 2 把阶段 1 的“开发身份”替换为真实账号与角色身份，并建立服务端权威的
连接凭证链：

```text
注册/登录
  -> HttpOnly 会话 Cookie（access 15m / refresh 30d，轮换）
  -> 创建/选择角色（区服内唯一名称）
  -> Control API 签发 60 秒一次性 game ticket（只存 SHA-256）
  -> Game Server onAuth 原子消费票据
  -> 获取单角色租约
  -> 从 PostgreSQL 加载角色并进入 world_map
  -> 离开/宽限期结束时 checkpoint 位置并释放租约
```

阶段 2 不实现地图运行时、AOI、怪物、战斗、掉落或运营后台业务。

---

## 2. 开工前一致性检查

- 阅读 `AGENTS.md`、`PROJECT_STATUS.md`、`WORKLOG.md`、架构 v2、MVP 计划 v2、
  阶段 1 报告与 ADR-015/016。
- `git status` 干净，HEAD 为 `f4b74ff`（阶段 1 文档补记）。
- 数据库已有 `realms` 表和 1 条阶段 0 迁移。
- 阶段 1 的 `world_map` join 只接受开发身份；`contracts` 没有账号/角色 DTO；
  `control-api` 只有健康检查；`game-server` 不连接数据库。
- 结论：阶段 2 所需账号、会话、角色、票据、租约与 checkpoint 均未实现，与阶段
  计划一致；不存在需要“修改架构”的新需求，按 ADR-017 落地。

---

## 3. 目标与范围

### 3.1 本阶段完成

1. 注册、登录、刷新、登出和会话撤销。
2. Argon2id 密码；refresh token 轮换，只存 hash。
3. Account、AccountSession、Character、CharacterSession、GameTicket 表与迁移。
4. 创建角色：职业、名称、初始属性、初始地图与出生点。
5. 区服内角色名唯一，NFKC + 大小写归一。
6. 角色列表、角色读取、进入游戏 ticket。
7. 短时、一次性、绑定 account/character/realm 的票据。
8. Game Server 在 `onAuth` 校验并消费票据，不接受客户端自报角色 ID。
9. 单角色活跃会话租约，处理重复登录与异常掉线。
10. 角色位置/朝向在离开时 checkpoint，入图时恢复。
11. 客户端注册/登录/角色选择/进入世界完整流程。
12. 真实 PostgreSQL 集成测试与真实浏览器 E2E。

### 3.2 明确不做

- Tiled、MapRuntimeManifest、AOI、地图切换（阶段 3）。
- 怪物、战斗、技能（阶段 4）。
- 背包、装备、金币、ledger（阶段 5）。
- 聊天、PK、复活（阶段 6）。
- 运营后台业务、管理员 RBAC、Outbox（阶段 7）。

---

## 4. 交付内容

### 4.1 `packages/contracts`

- `auth.ts`：账号/密码/登录/注册 schema，`normalizeUsername`，`AccountView`，
  `authResponseSchema`。
- `character.ts`：职业目录（战士/法师/道士及基础属性）、角色名 schema 与
  `normalizeCharacterName`、角色视图、创建请求、角色列表、ticket 请求/响应、
  `GAME_TICKET_TTL_SECONDS = 60`。
- `realtime.ts`：`worldJoinOptionsSchema` 改为严格的
  `{ protocolVersion, ticket }`，拒绝任何自报身份字段。
- `phase1Map.ts`（子路径 `@web-legend/contracts/phase1-map`）：Control API 与
  Game Server 共享同一份测试地图，保证建角出生点与权威模拟一致。
- 错误码增加 `ACCOUNT_EXISTS`、`INVALID_CREDENTIALS`、`CHARACTER_NAME_TAKEN`、
  `CHARACTER_LIMIT_REACHED`、`REALM_NOT_FOUND`。

### 4.2 `packages/auth`（阶段 2 新建，符合 ADR-013）

- `password.ts`：Node 26 内置 `crypto.argon2`（OpenSSL Argon2id），PHC 编码，
  参数 `m=19456,t=2,p=1,tag=32`，`timingSafeEqual` 校验。
- `tokens.ts`：256 bit base64url 不透明令牌、SHA-256 摘要、常量时间比较。
- `sessionTokens.ts`：access/refresh 双令牌与有效期策略。
- 9 个单元测试覆盖 PHC 格式、错误密码、篡改哈希、唯一性、轮换有效期。

### 4.3 `packages/persistence`

新增表（迁移 `0001_peaceful_rachel_grey.sql`）：

| 表                   | 关键约束                                                 |
| -------------------- | -------------------------------------------------------- |
| `accounts`           | `username_normalized` 唯一；`status` active/banned       |
| `account_sessions`   | access/refresh 摘要唯一；过期与 `revoked_at`             |
| `characters`         | `(realm_id, name_normalized)` 唯一；坐标、HP/MP、version |
| `character_sessions` | `character_id` 主键；session、server、租约过期           |
| `game_tickets`       | `token_hash` 唯一；过期、消费时间与消费方                |

仓储函数覆盖账号查找、会话创建/轮换/撤销、角色创建/列表/归属查询、位置
checkpoint、票据插入与原子消费、租约获取/续租/释放。

新增 `pnpm db:seed`：幂等写入默认区服 `classic-01`。

### 4.4 `apps/control-api`

- `/api/v1/auth/register|login|refresh|logout`
- `/api/v1/me`
- `/api/v1/realms`
- `/api/v1/characters`（GET/POST）、`/api/v1/characters/:id`
- `/api/v1/game/ticket`
- HttpOnly + SameSite=Lax Cookie，生产加 Secure；access 15 分钟、refresh 30 天。
- refresh 轮换：旧 refresh token 立即失效。
- 登录对未知账号执行占位 Argon2 校验，降低账号枚举时序差。
- CSRF：状态变更请求的 `Origin` 必须同源（允许反向代理换端口）或在 CORS
  白名单；请求体上限 16KB。
- 注册/登录/刷新令牌桶限频。
- 错误统一使用 contracts envelope；500 不泄露内部细节。

### 4.5 `apps/game-server`

- 新增 `DATABASE_URL` 与 `GAME_SERVER_ID`；就绪检查包含数据库探测。
- `onAuth`：解析 ticket → 条件 UPDATE 原子消费 → 读取角色/区服 → 获取租约。
- 删除全部开发身份分支；生产与开发都只接受真实票据。
- `onJoin`：使用数据库中的角色名、坐标、朝向与 HP/MP；非法坐标回退出生点。
- 单角色租约：主键冲突 + 条件更新；TTL 30 秒，每 10 秒异步续租；离开时释放。
- 主动离开、宽限期结束、Room dispose 时 checkpoint 位置并释放租约。
- 20Hz 模拟 tick 内没有数据库或网络 IO。

### 4.6 `apps/game-web`

- 账号入口（登录/注册）、角色选择/创建、世界三段式页面。
- API 客户端：同源 Cookie、错误 envelope 解析、access 过期自动 refresh 重试。
- 每次新 join 向 Control API 获取新 ticket；重连优先使用 Colyseus token。
- 重连 token 绑定角色，切换角色/登出后不会误连旧角色。
- 世界 HUD 保留在线玩家、延迟、房间、指令与拒绝提示，新增“返回角色”。
- 移除了 `?name/?key` 开发身份参数；`?fresh/?join` 仅 DEV 用于测试隔离。

### 4.7 测试与证据

- `packages/contracts`：账号、角色名归一、职业目录、ticket join 严格校验。
- `packages/auth`：Argon2id、令牌、会话令牌策略。
- `apps/control-api`：cookies、CSRF origin、限频、认证/角色/票据集成测试。
- `apps/game-server`：票据消费、租约、位置恢复、checkpoint、重连、限频、指标。
- `tests/e2e`：真实注册 → 建角 → 双人可见 → 刷新重连 → 重复登录拒绝 → 断线恢复
  → Scene 重启 → 登出 → 局域网 HTTP。

---

## 5. 关键接口

### 5.1 认证

```text
POST /api/v1/auth/register   { username, password }        -> 201 AuthResponse + cookies
POST /api/v1/auth/login      { username, password }        -> 200 AuthResponse + cookies
POST /api/v1/auth/refresh    cookie                        -> 200 AuthResponse + rotated cookies
POST /api/v1/auth/logout     cookie                        -> 204
GET  /api/v1/me              access cookie                 -> 200 AuthResponse
```

### 5.2 角色与票据

```text
GET  /api/v1/realms                     -> { realms: [{ id, code, name }] }
GET  /api/v1/characters                 -> { characters: CharacterView[] }
POST /api/v1/characters { name, classId, realmId? } -> 201 { character }
GET  /api/v1/characters/:id             -> { character }（仅本人）
POST /api/v1/game/ticket { characterId } -> { ticket, expiresAt, character }
```

### 5.3 实时加入

```json
{ "protocolVersion": 1, "ticket": "43 字符 base64url" }
```

任何额外字段（`accountId`、`characterId`、`displayName`、`playerKey`）都被
`.strict()` 拒绝。

---

## 6. 验收标准对照

| 验收标准                                   | 结果 | 证据                                                                |
| ------------------------------------------ | ---- | ------------------------------------------------------------------- |
| 未登录用户不能进入正式 Room                | 通过 | 无/伪造/过期票据 join 均 525；未登录 ticket API 401（集成测试）     |
| 玩家不能读取或控制其他账号角色             | 通过 | 跨账号 GET 角色与申请 ticket 均 404（集成测试）                     |
| 过期、撤销或重复消费的 ticket 不能建立连接 | 通过 | 票据一次性 UPDATE；重复消费 525（集成测试）                         |
| 同 Realm 角色名不能重复                    | 通过 | `(realm_id, name_normalized)` 唯一；大小写/全角变体 409（集成测试） |
| 同一个角色不会被两个客户端同时控制         | 通过 | 租约集成测试 + E2E 第二客户端 `data-status=failed`                  |
| API 和数据库重启后角色仍可读取             | 通过 | 关闭并重建 Control API 后 `/me` 与角色记录仍在；DB 证据             |
| 不破坏阶段 1 的移动与重连                  | 通过 | 双人可见 141–184ms；刷新/断线/Scene 重启 E2E                        |
| 客户端不能自报身份或最终状态               | 通过 | join schema 严格；`move.to` 仍只接受目标 tile                       |

---

## 7. 测试结果

执行时间：2026-11-24，Node 26.13.1 / pnpm 11.7.0。

| 检查        | 命令                                           | 结果                                     |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| 格式        | `pnpm format:check`                            | 通过                                     |
| Lint / 边界 | `pnpm lint`                                    | 通过（0 error / 0 warning）              |
| 类型        | `pnpm typecheck`                               | 通过（根配置 + 12 个 workspace）         |
| 单元/集成   | `pnpm test`                                    | 31 个文件、146 个测试全部通过（约 4.5s） |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e` | 9 个测试全部通过（约 44s）               |
| 构建        | `pnpm build`                                   | 4 个应用全部成功                         |
| 迁移        | `pnpm db:migrate`                              | 2 条迁移在真实 PostgreSQL 18.3 上执行    |
| 区服        | `pnpm db:seed`                                 | 幂等写入 `classic-01`                    |

E2E 证据（`docs/phase-reports/phase-02/`）：

- `auth-screen.png`、`character-screen.png`、`two-players-{alice,bob}.png`、
  `after-reload.png`；
- `websocket.log`：双人移动在对方界面可见的最终测量值 **141ms**（完整套件），
  另有单独运行 184ms；均低于 250ms；
- `database-evidence.txt`：2 条迁移、6 张表；110 张票据中 101 已消费、9 已过期、
  0 张未消费未过期；测试结束时 0 个活跃租约。

> 本次 E2E 在 8844–8847 运行：当前主机 84–87 被用户已有的开发栈占用。代码与
> 配置相同，仅覆盖端口；E2E 结束后未停止用户进程。

生产门禁（集成测试）：

- `NODE_ENV=production` 下伪造 ticket join 返回 525；
- 同时提交 `accountId/characterId` 仍返回 525；
- `diagnostics` Room 未注册（520）。

---

## 8. 问题与修复

1. **Argon2id 依赖选择**：Node 26 内置 `crypto.argon2` 可用；实测生成/校验
   成功，避免新增原生包和构建风险。
2. **Drizzle 唯一冲突识别**：driver 错误被包装，`isUniqueViolation` 需要沿
   `cause` 链查找 SQLSTATE `23505`；修复后账号/角色重名返回 409 而非 500。
3. **Vite 代理改写 Host 导致局域网注册 403**：`/api` 代理默认改写 Host，
   Control API 的 Origin 校验看到 127.0.0.1 而浏览器 Origin 是局域网 IP。
   代理改为 `changeOrigin: false`，并保留同 hostname（允许端口变化）的校验。
   修复后局域网 E2E 通过。
4. **route 注册函数误用 async**：无 await 触发 lint；改为同步注册。
5. **`page.reload` 不再自动入图**：阶段 2 刷新后回到角色选择。E2E 改为刷新后
   再次点击“进入世界”，验证 reconnection token 仍在宽限期内恢复原座位。
6. **测试账号与角色跨运行唯一**：集成/E2E 使用随机账号与角色名，避免与共享
   开发库中的历史数据冲突。
7. **`exactOptionalPropertyTypes` 与 Fastify 泛型**：路由模块使用显式
   `AppServer` 类型（pino Logger 泛型）解决实例类型不兼容。

---

## 9. 未完成事项与已知限制

| 限制                                   | 影响                         | 后续                              |
| -------------------------------------- | ---------------------------- | --------------------------------- |
| 进程崩溃后租约最多 30 秒才失效         | 重启后短时间提示“另一台设备” | 阶段 3/8 结合多进程注册与恢复流程 |
| 位置只在正常离开/dispose 时 checkpoint | 崩溃丢失最近移动             | 阶段 3 节流 checkpoint            |
| 票据与会话行不自动清理                 | 表持续增长                   | 阶段 7/8 增加清理任务与指标       |
| 限频为进程内内存实现                   | 多进程/多实例不一致          | 阶段 8 网关或 Redis 限流          |
| 无邮箱验证、找回密码、MFA              | 账号恢复能力有限             | 后续账号功能                      |
| 角色数量上限为“先查后插”               | 极端并发可超过 8 个          | 后续加约束或事务                  |
| 开发库为共享数据库                     | 测试数据残留                 | 阶段 5 前建立独立测试库           |
| 后台仍无账号/角色管理页面              | 运营不可见                   | 阶段 7                            |
| 前端 bundle 较大（Phaser 2.1MB）       | 加载时间                     | 阶段 8 代码分割                   |

---

## 10. 阶段 3 建议任务清单

1. Tiled 制作 `starter_town` / `starter_wilds`，编译 `MapRuntimeManifest`。
2. 新建 `map-runtime` 包：碰撞、导航、出生点、传送点、checksum。
3. `MapTemplate` / `MapInstance` 与 Room 固定映射；主城 ↔ 野外传送。
4. AOI 网格与按 cell 同步；私有数据不进入公开 state。
5. 角色位置/HP/MP 节流 checkpoint 与地图切换保存。
6. 同图聊天（限频、长度、服务端校验）。
7. 至少 30 个虚拟用户入图移动的 tick 指标。
8. 保持阶段 2 的票据、租约和所有权测试为回归门禁。

---

## 11. 审阅门禁

阶段 2 已完成并在此停止。未收到 Tech Lead 明确批准前，不开始阶段 3，不扩大
阶段 2 范围，不跳过阶段门禁。

---

## 12. Git 提交

- 阶段 2 主提交：`df45db7feb83f973129626c51c013d9fecc98d69`
  主题：`feat(phase-2): deliver accounts, characters and one-time game tickets`。
- 本报告与状态文档随主提交归档；提交哈希由紧随其后的 `docs(phase-2)` 提交记录。
