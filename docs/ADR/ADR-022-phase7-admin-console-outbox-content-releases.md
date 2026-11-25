# ADR-022: 阶段 7 运营后台、Outbox 指令与不可变内容发布

- 状态：Accepted
- 日期：2026-11-25
- 关联：架构文档 10、11.1、12、13；MVP 计划阶段 7；ADR-005、ADR-009、
  ADR-011、ADR-013

## 背景

阶段 0–6 已交付可玩的实时世界、账号、资产、战斗与 PvP。项目目前只能由开发者
通过代码和数据库变更来管理：没有管理员身份，没有审计，运营动作无法可靠地
到达 Game Server，数值内容写死在 `game-domain` 中。阶段 7 要求把项目变成
“运营人员可以管理和更新”，同时不能破坏服务端权威、tick 与 IO 分离、
PostgreSQL 唯一事实来源以及“后台不能执行任意脚本”的约束。

## 决策

### 1. 管理员身份与玩家身份彻底分离

- 新增 `admin_users` 与 `admin_sessions`；管理员密码同样使用 Argon2id，
  会话令牌只保存摘要。
- 管理员 Cookie 为 `wl_admin_access`，Path 限定 `/api/v1/admin`，与玩家
  `wl_access` 互不覆盖。MVP 不提供 refresh token，会话过期后重新登录。
- 权限矩阵定义在 `contracts`，由 Control API 在每条路由上服务端校验；
  `admin-web` 只根据权限隐藏入口，不作为权限边界。
- MVP 角色：`super_admin`、`ops_admin`、`game_master`、`content_designer`、
  `release_approver`、`analyst`、`readonly_auditor`。

### 2. 运营动作走审计 + Outbox，Game Server 按 commandId 幂等执行

- Kick / Ban / Mute 在同一个 PostgreSQL 事务内写入：
  1. `admin_audit_logs`（actor、role、action、target、reason、before/after、
     requestId、result）；
  2. `outbox_events`（commandId、类型、payload、状态）。
- Ban 同时更新 `accounts.status = 'banned'`；Mute 写入
  `accounts.muted_until`。持久状态是唯一事实来源，Outbox 只负责让在线会话
  立即生效。
- Control API 内的 Outbox dispatcher 轮询 `pending` 记录，通过受信内部
  HTTP 端点投递到 Game Server；状态为
  `pending → dispatched → applied`，重试耗尽后为 `failed`。
- Game Server 的内部端点用共享令牌保护，命令按 commandId 去重；重复投递
  返回成功但不再执行。Room 只做适配：找到会话、发通知、断开连接或设置
  禁言时间。
- Outbox 是可靠记录；进程崩溃后 `dispatched` 超时可重新投递，Game Server
  的幂等保证不会重复执行。

### 3. 内容数据与行为分离，发布不可变

- 新增 `@web-legend/content-schema`：内容 bundle 的 Zod schema、基线 bundle、
  引用/范围校验、规范化 checksum 与差异计算。数据只有声明式数值，没有
  JavaScript、`eval`、动态 import 或任意 SQL（ADR-011）。
- 内容类型：职业（基础属性、成长、初始装备）、技能、怪物、物品、掉落表。
  技能效果仍是代码中的白名单 handler（`directDamage`、`heal`）。
- `content_drafts` 每个内容类型一行，保存该类型的完整 section；发布时把
  draft section 覆盖到当前激活 Release 上形成完整 bundle，校验通过后写入
  不可变的 `content_releases`。Release 一经创建不再修改。
- `realm_active_content` 保存每个区服当前激活的 Release；
  `content_activations` 追加记录每次激活/回滚（谁、何时、原因、目标
  Release）。回滚 = 追加一条指向旧 Release 的激活记录，不修改历史。
- Game Server 周期性读取激活 Release，但只在 Room 创建时取快照：新 Room
  使用新版本，已有 Room 保持创建时的版本。Room 把版本与 checksum 写入公开
  状态和内部状态端点，后台可核对。
- MVP 只有一个活跃区服；激活按区服记录，Game Server 使用默认活跃区服的
  Release。多区服独立内容与 Room/Realm 绑定留到阶段 8，届时必须让 Room
  显式归属 Realm，不能静默假设。

### 4. 后台只读查询与写操作分离

- 查询（Overview、Players、Rooms、Audit、Commands、Content）只读
  PostgreSQL 或调用 Game Server 内部状态端点；不直接访问 Room 内存。
- 写操作全部要求原因（reason），并在同一事务写审计；权限拒绝、目标不存在、
  参数非法等失败也写审计（result = failed）。
- 后台不能执行任意 SQL、任意 JavaScript、动态 import；内容编辑只提交结构化
  JSON，经 schema 校验后入库。

## 替代方案

- **管理员复用玩家账号**：拒绝。封禁玩家与后台权限会互相污染，审计主体也
  无法区分。
- **Control API 直接连 Game Server 内网 RPC 为主、Outbox 为辅**：拒绝。
  进程崩溃时内存指令会丢失，且无法展示可靠状态。
- **内容发布原地修改 Release**：拒绝。无法证明线上 Room 使用的版本，也无法
  做可靠回滚。
- **Game Server 热更新 Room 内容**：拒绝。战斗中数值突变会让同一场战斗不可
  复现，违反 ADR-008。
- **后台动态执行公式/脚本**：拒绝。直接成为 RCE 入口，违反 ADR-011 与
  AGENTS §2.5。

## 影响

- 新增包 `content-schema`；依赖方向变为
  `contracts ← content-schema ← game-domain ← game-application`。
  `game-domain`、`game-application`、`control-api`、`game-server` 增加对
  `content-schema` 的依赖；`admin-web` 仍只依赖 `contracts`。
- `game-domain` 的公开函数接受可选 `ContentBundle`；省略时使用基线 bundle，
  保持既有测试与调用方行为。
- 新增 8 张表与 1 个账号字段；迁移采用 Expand，不修改既有列语义。
- Game Server 增加 `/internal/admin/status` 与 `/internal/admin/commands`；
  生产反向代理必须只允许 Control API 访问这些路径（阶段 8 runbook）。
- 内容 Release 切换只影响新 Room；MVP 固定 Room 需要玩家重新进入或新建实例
  才能使用新数值。

## 未来调整条件

- 多区服独立内容：Room 必须绑定 Realm；内容激活按 Realm 路由。
- Outbox 吞吐不足：迁移到独立 worker 或队列，但 PostgreSQL 仍保留下发记录。
- 内容类型扩展到 NPC/商店/任务：新增 section schema 与校验，不引入脚本。
