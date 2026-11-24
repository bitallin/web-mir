# ADR-017: 账号会话与一次性游戏票据

- 状态：Accepted
- 日期：2026-11-24
- 关联：MVP 计划阶段 2；架构文档 8.7、11.1–11.2、14.1；取代 ADR-015
- 实施：阶段 2

## 背景

阶段 1 只有仅在开发环境可用的临时身份：客户端自报 `playerKey` 与显示名，服务端
在 `NODE_ENV=production` 时无条件拒绝。阶段 2 必须让真实玩家身份进入多人世界，
并满足以下验收条件：

- 未登录用户不能进入正式 Room；
- 玩家不能读取或控制其他账号的角色；
- 过期、撤销或重复消费的票据不能建立连接；
- 同区服角色名唯一；
- 同一个角色不能被两个客户端同时控制；
- API 与数据库重启后角色仍可读取。

架构文档 11.2 已规定 game ticket 绑定 account/character/realm、短时、一次性，
且不接受客户端自报 ID；14.1 规定 Argon2id、短时 access token、refresh token
轮换且只存 hash、ticket 一次性。本 ADR 固定这些约束的具体实现。

## 决策

### 1. 密码：Node 内置 Argon2id

- 使用 Node.js 26 `crypto.argon2`/`argon2Sync`（OpenSSL 3.2 Argon2id），不引入
  原生扩展依赖。
- 参数固定为 OWASP 最低建议：`m=19456 KiB, t=2, p=1, tag=32`；参数写入 PHC
  字符串，升级参数后旧密码仍可校验。
- 存储格式：`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`。
- 校验使用 `timingSafeEqual`；未知账号也执行一次占位密码校验，避免登录接口
  通过响应时间泄露账号是否存在。

### 2. 会话：数据库不透明令牌 + HttpOnly Cookie

- 登录成功后生成两个独立随机令牌（各 256 bit，base64url）：
  - access token：15 分钟，Path=/；
  - refresh token：30 天，Path=/api/v1/auth。
- 数据库 `account_sessions` 只保存两者的 SHA-256；令牌本身不落库、不写日志。
- 浏览器通过 HttpOnly、SameSite=Lax Cookie 携带令牌；生产环境（`NODE_ENV=
production`）追加 Secure。开发环境局域网 HTTP 仍可用。
- 刷新时在同一行内同时替换 access/refresh 摘要；旧 refresh token 立即失效。
  重放旧 refresh token 返回 401。
- 登出撤销当前会话行；即使 access token 刚过期，也按 access 摘要撤销。
- 不使用 JWT：MVP 单进程、单数据库，数据库校验可直接支持撤销与轮换；后续若
  需要降低数据库读压力，可在不改变协议的前提下增加缓存或签名 access token。

### 3. CSRF 与认证端点保护

- 状态变更请求若携带 `Origin`，必须与请求 Host 同源（同 hostname，允许反向
  代理换端口）或位于 `CORS_ORIGINS` 白名单；否则 403。
- 认证 payload 限制 16KB；日志由 observability 脱敏 password/token/cookie。
- 注册、登录、刷新使用进程内令牌桶限频（默认 30 次突发、1 次/秒补充）。
  多进程部署前必须替换为共享限流或网关限流。

### 4. 角色与命名

- `characters` 保存 account、realm、class、等级/经验、HP/MP、地图、权威坐标
  （整数子格单位）、朝向与版本号。
- 角色名限制 2–12 位字母、数字、汉字或下划线；唯一键为
  `(realm_id, name_normalized)`，归一化为 NFKC + 小写，因此全角/大小写变体不能
  重复注册。
- 创建角色由服务端决定职业基础属性、初始地图与出生点；客户端只提交名字、
  职业与可选区服。
- 每账号最多 8 个角色（服务端检查；并发创建极端情况下可能多出，不影响资产安全）。

### 5. 游戏票据：数据库一次性票据

- `POST /api/v1/game/ticket` 校验角色归属后生成 256 bit 随机票据，只存 SHA-256，
  60 秒过期，绑定 account/character/realm。
- WebSocket join options 只允许 `{protocolVersion, ticket}`（`.strict()`）。
- Game Server 在 `onAuth` 中执行原子消费：

  ```sql
  UPDATE game_tickets
     SET consumed_at = now(), consumed_by = $server:$session
   WHERE token_hash = $hash AND consumed_at IS NULL AND expires_at > now()
  RETURNING account_id, character_id, realm_id;
  ```

  条件 UPDATE 本身是并发边界：第二个事务匹配不到行。消费成功后读取角色与区服，
  再获取角色租约。

- 票据消费与租约获取不在同一事务：租约失败会浪费一张票据，但客户端可重新申请，
  不产生越权。

### 6. 单角色租约

- `character_sessions` 以 `character_id` 为主键，保存持有者 session、Game Server
  ID 与过期时间。
- 获取租约先 `INSERT ... ON CONFLICT DO NOTHING`，失败后仅当旧租约已过期或
  同一 session 时条件更新；两个并发登录只有一个成功。
- 租约 TTL 30 秒，Room 每 10 秒在独立定时器中异步续租；该定时器不属于 20Hz
  模拟 tick，不违反 tick 与 IO 分离。
- 正常离开（主动离开或重连宽限期结束）时释放租约。进程崩溃时租约最多 30 秒后
  自动失效。
- 重复登录当前策略为**拒绝**（525），不做掉线替换；替换策略需要额外的通知与
  数据保护设计，留待后续评审。

### 7. 角色加载与 checkpoint

- Room `onJoin` 使用数据库中的角色名、坐标、朝向与 HP/MP；坐标必须落在当前地图
  可走格子上，否则回退到出生点并记录警告。
- 主动离开、宽限期结束、Room dispose 时把当前位置与朝向写回 `characters`。
  这发生在 `onLeave`/`onDispose` 的异步路径，不在 tick 内。
- 不使用周期 checkpoint；阶段 3/5 再按架构 10.4 实现节流快照与地图切换保存。

### 8. 客户端

- 页面分为账号入口、角色选择、游戏世界三段；账号状态完全由服务端 `/me` 决定。
- 每次新 join 都向 Control API 申请一张新票据；重连优先使用 Colyseus
  reconnection token，不重复消费票据。
- 重连 token 以 `{characterId, token}` 存入 sessionStorage，切换角色或登出后
  不会误连回上一个角色。
- access token 过期时 API 客户端自动调用 refresh 并重试一次。

## 替代方案

1. **客户端持有 JWT 并自报 accountId/characterId**：无法服务端撤销，且与
   “WebSocket 只接受服务器签发身份”冲突，拒绝。
2. **票据只在内存中签发**：Control API 与 Game Server 是两个进程，无法共享；
   数据库是唯一可靠的一次性消费点。
3. **由 Control API 提供内部校验 HTTP 接口**：增加一次网络往返与新的内部认证
   面；Game Server 已按架构直接访问 PostgreSQL，直接消费票据更简单可靠。
4. **允许重复登录并踢掉旧连接**：需要可靠通知、旧连接资产保护与客户端提示，
   超出阶段 2 范围；先拒绝，避免双端同时控制。
5. **引入 `argon2` 原生包**：Node 26 已内置 Argon2id，避免新增原生依赖与构建
   风险。

## 影响

- 正式 Room 在 `NODE_ENV=production` 也不再存在开发身份分支；无票据一律 525。
- 每次 REST 认证请求需要一次数据库查询；MVP 规模可接受。
- 票据、会话和角色数据进入 PostgreSQL；`pnpm db:seed` 写入默认区服
  `classic-01`。
- `auth` 包出现真实实现与消费者，符合 ADR-013。
- 游戏服需要 `DATABASE_URL`；就绪探针增加数据库检查。
- 角色位置只在正常离开时持久化；进程崩溃会丢失最后一次未 checkpoint 的移动。
- 数据库中的过期/已消费票据当前不自动清理，后续阶段增加清理任务。
- 崩溃后租约最长 30 秒内仍显示“正在另一台设备游戏”，属于已知限制。

## 退出条件（阶段 3 及以后）

- 角色位置节流 checkpoint 与地图切换保存（阶段 3）。
- 管理员踢下线、封禁与多进程会话协调（阶段 7）。
- 票据/会话清理任务与 Prometheus 指标（阶段 7/8）。
