# ADR-015: 阶段 1 临时开发身份与重连凭据

- 状态：Accepted
- 日期：2026-11-24
- 关联：MVP 计划阶段 1 任务 4、阶段 2 票据；架构文档 8.7、11.2

## 背景

阶段 1 要验证两个独立浏览器进入同一 Colyseus Room、互相可见并由服务端裁定移动。
正式账号、角色和一次性 game ticket 属于阶段 2。本阶段需要一个真实可用的临时身份，
但绝不能让它进入生产验收。

## 决策

### 加入参数

`world_map` 的 join options 由 `contracts` 中的 `worldJoinOptionsSchema` 定义并
`.strict()` 校验：

- `protocolVersion`：必须等于当前 `PROTOCOL_VERSION`；
- `displayName`：1–16 字符，仅允许字母、数字、下划线、连字符和空格；
- `playerKey`：8–64 位 `[A-Za-z0-9-]`，浏览器每个标签页生成并保存在
  `sessionStorage`。

任何额外字段（例如自报 `accountId`/`characterId`）都会被拒绝。

### 服务端门禁

- `NODE_ENV=production` 时 `WorldMapRoom.onAuth` 无条件抛出
  `AUTH_FAILED`（525），不存在“跳过认证”的开关。
- `development` / `test` 才接受开发身份。
- 同一 `playerKey` 同时只允许一个活跃连接；`onAuth` 与 `onJoin` 双重检查。
- 客户端只提交意图，不能指定角色 ID、位置或权限。

### 断线与重连

- 非主动断线进入 `allowReconnection` 宽限期（默认 15 秒），期间玩家保留在
  Room 中并标记 `connected=false`，路径清空。
- 宽限期结束后移除玩家和状态。
- 客户端把 Colyseus reconnection token 只保存到 `sessionStorage`；刷新页面时优先
  用 token 恢复原座位，失败后才重新 join。
- `room.reconnection.minUptime = 0`，避免入房最初几秒的网络抖动被当成永久离开。

### 开发/测试专用参数

以下 query 参数只在 `import.meta.env.DEV` 生效，生产构建忽略：

- `?name=`、`?key=`：固定两个浏览器上下文的身份，便于 E2E；
- `?fresh=1`：新建一个 Room，避免测试相互污染；
- `?join=<roomId>`：加入指定 Room。

## 替代方案

1. **阶段 1 就实现完整账号和票据**：扩大范围，违反“本次只执行一个阶段”。
2. **客户端直接传角色 ID**：无法验证归属，等于把身份控制权交给客户端，拒绝。
3. **生产保留开发身份开关**：容易被误开，直接移除该可能性。

## 影响

- 阶段 1 的联机验收不依赖数据库或登录系统。
- 公开 Room State 只包含 `playerId`（随机开发键）、显示名、位置、朝向和颜色，
  不包含账号、令牌或 GM 标记。
- 生产环境未接入票据前无法进入世界，这是预期行为。

## 退出条件（阶段 2）

- Control API 签发短时、一次性、绑定 account/character/realm 的 game ticket；
- WebSocket 握手校验并消费 ticket，删除开发身份分支；
- 删除或迁移 `?name/?key/?fresh/?join` 调试参数；
- 本 ADR 标记为 Superseded，并由阶段 2 报告引用。
