# 阶段 7 报告：运营后台与内容发布

- 日期：2026-11-25
- 状态：实现完成；单元/集成/浏览器自动化验收通过；等待用户在 8584/8585 实测确认
- 关联：`docs/WEB_LEGEND_MVP_PLAN_v2.md` 阶段 7、
  `docs/ADR/ADR-022-phase7-admin-console-outbox-content-releases.md`

## 1. 目标与范围

把项目从“开发者能玩”推进到“运营人员可以管理和更新”：

- 独立管理员身份、服务端 RBAC 与审计；
- Overview / Players / Rooms / Audit / Operations 查询；
- Kick / Ban / Mute 通过 PostgreSQL Outbox 可靠投递，Game Server 按 commandId
  幂等执行；
- 内容 Draft → Schema/引用校验 → 不可变 Release → 按区服激活/回滚；
- 新 Room 使用新版本，旧 Room 保持创建时版本；
- 后台只通过 Control API 访问数据，不能执行任意 SQL/JavaScript。

不在本阶段：阶段 8 的压测/部署/恢复、正式美术与音效、聊天持久化/人工审核、
多区服内容路由、审批流与 MFA。

## 2. 完成内容

### 2.1 契约与内容 schema

- `contracts/admin.ts`：
  - 7 个管理员角色与 11 项权限的共享矩阵；
  - 登录/会话/总览/玩家/Room/审计/指令 DTO；
  - 内容草稿/校验/Release/激活 DTO；
  - 内部命令 envelope（kick/ban/mute）与执行回执。
- `contracts/content.ts`：
  - 职业（基础属性、成长、初始装备）、技能、怪物、物品、掉落表 bundle；
  - `directDamage` / `heal` 两个 effect handler 的白名单；
  - 稳定 ID、数量/概率/等级范围。
- `WorldState` 增加 `contentVersion` / `contentChecksum`；新增 `session.kicked`。

### 2.2 `content-schema`（新包）

- 基线 `BASE_CONTENT_BUNDLE`：原阶段 4/5 的职业、技能、怪物、物品与掉落数值，
  导入时 Zod 解析。
- `validateContentBundle`：schema + 引用/范围/刷点/装备槽/初始装备/掉落表/地图
  刷点校验，错误与警告分级。
- `contentChecksum`：对象键排序后的 canonical JSON + SHA-256。
- `diffContentBundles` / `summarizeChanges`：按 section/id 输出新增/删除/修改及
  变更字段。
- `composeContentBundle`：把 draft section 覆盖到激活 bundle。
- 12 个测试覆盖未知 effect、缺失物品、缺少掉落表、初始装备超堆叠、槽位错误、
  治疗目标、checksum 顺序无关、草稿合并与版本号。

### 2.3 领域与资产用例

- `game-domain`：
  - 删除写死的技能/怪物/物品/掉落目录，改为消费 `ContentBundle`；
  - `combatStatsFor`、`skillsForClass`、`requireItem`、`requireLootTable`、
    `findInventoryPlacement` 支持内容注入；
  - `CombatWorld` 新增 `content` 选项，技能档案使用 Room 固定内容。
- `game-application`：
  - `AssetService` 接受内容 bundle，击杀奖励、掉落、背包、装备与药水使用同一
    版本；
  - 内容注入测试证明怪物 HP/名称、职业属性、物品属性、掉落经验与显示名生效。

### 2.4 持久化

- 新表：
  - `admin_users`、`admin_sessions`、`admin_audit_logs`；
  - `outbox_events`；
  - `content_drafts`、`content_releases`、`realm_active_content`、
    `content_activations`。
- `accounts.muted_until`：禁言持久化。
- 迁移 `0004` 建表/索引；迁移 `0005` 为审计、Release、激活历史增加
  append-only 触发器；Release 的 UPDATE/DELETE 会被数据库拒绝。
- 仓储：管理员登录、审计分页、Outbox 领取/状态统计、玩家服务端分页、内容
  Draft/Release/激活。

### 2.5 Control API

- 管理员登录：Argon2id、8 小时会话、独立 `wl_admin_access` Cookie（Path
  `/api/v1/admin`），登录限频。
- RBAC：服务端逐路由校验；查询权限与写权限分离。
- 查询：
  - 总览：在线人数、Room、账号/角色数、待投递/失败指令、最老排队、激活版本、
    异常优先级告警；
  - 玩家：按角色名/账号搜索、账号状态/在线筛选、服务端分页与排序；
  - 玩家详情：账号、角色、金币、背包、装备、最近审计与指令；
  - Room：代理 Game Server 内部状态；
  - 审计：按 actor/action/target/result 筛选与分页；
  - 运营指令：按状态/类型/目标筛选与分页。
- 写操作：
  - Kick/Ban/Mute：原因必填；审计 + Outbox 同事务；
  - Ban 更新 `accounts.status`，Mute 更新 `muted_until`；
  - 权限拒绝、参数非法、目标不存在也写 failed 审计；
  - 每次响应返回 command 与 audit id。
- Outbox dispatcher：
  - `FOR UPDATE SKIP LOCKED` 领取；stale dispatched 60 秒重投；
  - 网络/5xx 指数退避，4xx 直接 failed；
  - 状态 `pending → dispatched → applied/failed`。
- 内容：
  - 草稿保存（section schema 校验）；
  - 全量校验 + 差异；
  - 发布生成不可变 Release（版本号日期+序号，checksum）；
  - 按区服激活/回滚，追加激活历史并写审计；
  - 创建角色使用激活内容的职业属性与初始装备。

### 2.6 Game Server

- `ContentStore` 周期读取默认活跃区服的激活 Release；Room 在 `onCreate` 固定
  快照，公开状态暴露版本/checksum。
- 内部端点：
  - `GET /internal/admin/status`：serverId、uptime、Room 列表（map/instance/
    players/tick p50-p99/contentVersion/checksum）；
  - `POST /internal/admin/commands`：共享令牌、严格 envelope、commandId 幂等。
- 命令执行：
  - Kick：向目标发送 `session.kicked`，断开连接；
  - Ban：断开账号所有会话，`session.kicked` kind=banned；
  - Mute：设置账号所有在线会话的禁言到期时间，聊天返回系统警告；
  - 登录时校验账号封禁与 `muted_until`，旧票据不能绕过封禁。
- 指标新增 `chatMuted`。

### 2.7 运营后台

- 自定义深色工作台（非默认 AntD 模板），克制金色强调、密集表格、异常优先。
- 页面：登录、运行总览、玩家与账号、世界与 Room、内容工作台、发布中心、审计
  日志、运营指令。
- 服务端分页/筛选；危险操作显示目标、影响范围、原因输入与二次确认。
- 内容工作台：内容类型导航、JSON 编辑器、原因/说明、保存/校验/发布、问题列表
  与差异表；发布中心展示 Release、checksum、激活与回滚。
- 被踢客户端显示原因覆盖层，不自动重连；Ban 显示账号封禁。

### 2.8 测试与证据

- 53 个测试文件、307 个测试；20 个真实浏览器 E2E。
- 新增证据目录 `docs/phase-reports/phase-07/`：
  - `admin-overview.png`、`admin-rooms.png`、`admin-player-detail.png`、
    `admin-kick-confirm.png`、`player-kicked.png`、`admin-commands.png`、
    `admin-audit.png`、`admin-content.png`、`admin-content-validate.png`、
    `admin-releases.png`、`admin-rollback.png`；
  - `load.txt`、`database.txt`、`metrics.json`。

## 3. 验收证据

### 3.1 未授权与 RBAC

- 未登录 `GET /api/v1/admin/dashboard` 返回 401。
- 错误密码 401。
- `analyst` 调用 Kick 返回 403，并写入 `player.kick` failed 审计
  （errorCode=FORBIDDEN）。
- `content_designer` 调用发布返回 403；`release_approver` 才能发布/激活。

### 3.2 Kick/Ban/Mute 可靠投递

- Control API 集成测试：
  - Kick 响应 `command.status=pending`、type=kick；Outbox 行存在且带 audit id；
  - 短原因 422 也写 failed 审计；
  - Mute 持久化 `durationSeconds`，账号 `muted_until` 更新；
  - Ban 后玩家登录返回 403。
- Game Server 集成测试：
  - 无令牌/错误令牌 401；
  - 状态端点返回 Room 内容版本与 64 位 checksum；
  - Kick 发出 `session.kicked` 并断开；重复 commandId 返回 duplicate/applied 0；
  - Mute 拦截聊天并产生“剩余 N 秒”系统警告，解除后聊天恢复；
  - Ban 断开账号会话；
  - 封禁后旧票据无法加入。
- 双浏览器 E2E：在线玩家被 Kick 后显示原因；Outbox 变 `applied`；审计成功。

### 3.3 内容发布

- 草稿保存、校验、差异预览；非法内容（缺失物品引用）校验失败、发布 422。
- 发布生成不可变 Release；`content_releases` 的 UPDATE 被数据库触发器拒绝。
- 激活写入 `realm_active_content` + `content_activations` + 审计；回滚为新的
  激活记录，不修改历史。
- Game Server 集成测试：Room A 创建时固定内容 A；快照切换后 Room B 使用内容 B；
  Room A 的版本、怪物名称与 checksum 不变。
- E2E：修改物品名称 → 保存 → 校验 → 发布 → 激活 → 回滚；审计出现
  `content.publish` / `content.activate` 成功记录。

### 3.4 质量门禁与负载

| 检查             | 结果                                          |
| ---------------- | --------------------------------------------- |
| `pnpm lint`      | 通过（0 error / 0 warning）                   |
| `pnpm typecheck` | 通过（根配置 + 15 个 workspace）              |
| `pnpm test`      | 53 文件 / 307 测试通过                        |
| `pnpm build`     | 4 个应用成功                                  |
| E2E              | 20/20 通过（2 workers，约 1.9 分钟）          |
| 负载             | 30/30 玩家、750 接受、0 拒绝、tick p95 1.13ms |

数据库：6 条迁移、19 张表、24 条 Outbox（全部 applied）、114 条审计
（98 成功/16 失败）、17 个 Release、31 条激活、激活内容 baseline；钱包与流水
不一致 0。

## 4. 关键技术决策

- 管理员身份与玩家账号完全分离（ADR-022）。
- 运营动作审计 + Outbox 同事务；HTTP 只是传输；Game Server 按 commandId 幂等。
- Ban/Mute 持久状态由 Control API 写 PostgreSQL；Kick 只是在线会话动作。
- 内容 Release 不可变；回滚是新的激活记录；数据库触发器兜底。
- 内容数据在 `content-schema`，行为 handler 在代码；后台不执行任意脚本。
- Game Server Room 创建时固定内容快照，激活只影响新 Room。
- 单活跃区服下 Room 未绑定 Realm；阶段 8 必须显式绑定。
- 软件渲染环境 Playwright 默认 2 worker，避免时序抖动。

## 5. 已知限制与未完成项

- 多区服独立内容、Room/Realm 绑定未实现；当前使用默认活跃区服。
- 内容工作台为 JSON section 编辑器，未提供逐字段表单、审批流、按人草稿。
- 独立测试库、审计/Outbox/Release 归档、过期数据清理未建立。
- 后台无 refresh token/MFA；禁言历史/申诉未实现。
- Outbox dispatcher 与 Control API 同进程；吞吐不足时需要独立 worker。
- 共享开发库留下测试 Release/审计/管理员记录；当前激活内容已恢复 baseline。
- admin-web 的 Vite 代理必须保留 Host（`changeOrigin: false`），否则局域网后台
  登录会被 CSRF Origin 校验拒绝；修复后 LAN Origin 登录 200。
- 被 Kick 后的覆盖层在点击“重新加入”时必须清除；E2E 已覆盖“被踢 → 重新加入 →
  connected”。
- 正式美术、音效、压测、部署与恢复演练属于阶段 8。

## 6. 用户实测清单（8584 / 8585）

1. 打开 <http://localhost:8584/>，确认阶段 1–6 的登录、移动、战斗、掉落、聊天、
   安全区/PvP、复活、小地图与角色面板无回归。
2. 打开 <http://localhost:8585/>，用 `admin` / `web-legend-admin` 登录；确认
   未登录时无法读取任何后台数据。
3. 运行总览：在线人数、Room、tick p95、待投递/失败指令、激活内容版本。
4. 世界与 Room：Room 地图、人数、tick、内容版本与 checksum。
5. 玩家与账号：搜索在线角色，打开详情查看装备/背包/金币/审计/指令。
6. Kick 一个在线角色并填写原因：客户端显示断开原因；运营指令从 pending 变为
   applied；审计出现 `player.kick` 成功记录。
7. Mute 一个账号：聊天只收到“已被禁言/剩余时间”系统警告；到期或再次设为过去
   时间后恢复。
8. Ban 一个账号：在线角色被断开；该账号无法再登录。
9. 内容工作台：修改物品名称或掉落数值，保存、校验、查看差异并发布；发布中心
   激活新版本，再用“回滚”激活旧版本。
10. 确认发布历史不可编辑，回滚是新的激活记录；重启 Game Server 后新 Room 使用
    当前激活版本。
11. 确认非法内容（缺失物品引用、错误槽位等）无法发布，审计记录失败。

## 7. 阶段提交

- 主提交：`23ee461c0d196217cf2b192e3893fb59db8a6bea`
  - 主题：`feat(phase-7): deliver admin console, outbox operations and content releases`
- 阶段提交哈希由主提交后的 `docs(phase-7): record the phase commit hash` 文档提交
  写入 `PROJECT_STATUS.md` 与 `WORKLOG.md`。

## 8. 阶段结论

阶段 7 的代码、单元/集成测试、真实浏览器 E2E、构建与负载证据均已具备；未发现
阻断性缺陷。阶段标记为“实现完成、自动化验收通过、待用户实测”，不在用户确认前
宣称阶段完成，也不进入阶段 8。
