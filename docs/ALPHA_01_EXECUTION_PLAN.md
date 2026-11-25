# Alpha 0.1 执行计划（可信度、战斗体验与架构质量加固）

- 版本：1.0
- 日期：2026-11-25
- 角色：Tech Lead / 首席架构师 / 研发负责人
- 依据：`docs/MVP_ACCEPTANCE_REPORT.md`、`docs/GAMEPLAY_REVIEW.md`、
  `docs/POST_MVP_ROADMAP.md`、`docs/TECHNICAL_DEBT.md`、
  `docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md`、`docs/WEB_LEGEND_MVP_PLAN_v2.md`、
  `AGENTS.md`、ADR-001…025

## 1. 目标与完成边界

Alpha 0.1 只做三件事：让验收可信、堵住安全与数据正确性缺口、把战斗手感从
“逐次点击”改成“锁定后自动攻击”。不进入 Alpha 0.2 的三职业扩展、装备扩张、
地图美术或商店系统。

完成边界：

- CI 真正执行全部浏览器 E2E；
- 8 项 P1 全部有代码、测试与执行证据；
- 50 人 × 10 分钟容量场景成为可重复执行的回归任务；
- `WorldMapRoom` 完成第一阶段拆分；残余结构优化以 ADR 明确降级；
- 文档、债务清单、状态与阶段报告与实际代码一致。

## 2. 重新梳理后的 P1 清单（8 项，不照搬路线图）

| 编号       | 问题                                         | 归属里程碑 | 关闭证据                                                                                              |
| ---------- | -------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| TD-OPS-01  | CI 的 E2E job 无 PostgreSQL/连接串，无法启动 | A          | `.github/workflows/ci.yml` 新增 service/env；E2E job 真实运行                                         |
| TD-OPS-02  | E2E 与开发栈共享数据库与 outbox，并发假失败  | A          | `playwright.config.ts` + `infra/scripts/e2e-database.ts` + globalTeardown；20/20 → 21/21 本地隔离通过 |
| TD-SRV-04  | 封禁可经 15 秒重连宽限绕过                   | B          | `terminated` 标记、`onReconnect` 重新校验账号；2 个集成测试                                           |
| TD-DATA-04 | 内容发布删除玩家持有物品模板导致登录事故     | B          | 发布/激活引用完整性校验；Control API 集成测试 422                                                     |
| TD-SRV-02  | 战斗事件全 Room 广播，无 AOI/归属            | B          | `broadcastCombatEvent`；AOI 泄漏与治疗归属集成测试                                                    |
| TD-CLI-01  | 没有自动攻击，每次挥砍都要点击               | C          | 服务端状态机 + 协议 + HUD 攻击条；自动攻击 E2E 一次点击击杀                                           |
| TD-CLI-02  | 拒绝提示常驻并遮挡战斗面板                   | C          | Toast 队列 + 4 秒自动消失 + 层级别离；E2E 断言提示不覆盖战斗面板                                      |
| TD-SRV-01  | `WorldMapRoom` 2,178 行万能类                | D          | 抽出 `SessionRegistry` / `CommandGuard` / `StateViewPublisher`；ADR-025 记录延期边界                  |

审计补充、且原路线图遗漏但必须纳入 Alpha 0.1 的问题（按用户要求）：

- TD-SRV-02 的 AOI 过滤与事件归属（见上）；
- TD-DATA-01 击杀奖励忽略装备属性（路线图列入范围，债务表原为 P2）；
- TD-DATA-02 过期地面掉落不清理（路线图列入范围，债务表原为 P2）；
- TD-DATA-03 checkpoint 跨地图覆盖（评估后在本轮修复，见 §6）。

## 3. 依赖与顺序

1. **A（CI/测试隔离）必须最先**：后续所有安全与战斗用例需要真实、可复现的
   E2E/集成环境；否则“测试通过”不可信。
2. **B（服务端安全与数据）在 C 之前**：自动攻击会放大战斗事件与目标选择路径，
   先修 AOI/归属与目标有效性，避免把广播问题带进新协议。
3. **C（自动攻击）依赖 B 的封禁/事件路由**：自动攻击在断线、封禁、传送、
   目标死亡时必须停止；这些状态机在 B 中已稳定。
4. **D（Room 拆分）在 A–C 之后**：先有回归测试与新增行为，再做行为等价抽取；
   拆分顺序为 `SessionRegistry` → `CommandGuard` → `StateViewPublisher`。
5. **E（回归/验收）最后**：全部门禁、压测、恢复、不变量与报告。

共享协议与核心文件负责人：本会话统一修改 `contracts`、`worldMapRoom`、
`assetService`、`playwright.config.ts`；不并行派发同一文件。

## 4. 里程碑任务与验收

### 里程碑 A：CI 与测试可靠性

- e2e job 增加 PostgreSQL 18 service、`DATABASE_URL`、`E2E_DATABASE_URL`。
- E2E 使用专用数据库 `web_legend_e2e` 与专用端口 5184/5185/3086/2587；
  webServer 建库/迁移/seed，globalTeardown 删库。
- 开发栈与 E2E 不共享 outbox、内容激活或账号数据。
- 验收：本地隔离 E2E 全绿；CI 配置可启动同一套流程。

### 里程碑 B：服务端安全和数据正确性

- 封禁/踢下线不进入宽限；重连重新校验账号状态。
- 内容发布/激活校验玩家持有模板覆盖。
- 战斗事件按 AOI 与归属投递。
- 过期地面掉落清理；`loadOpenDrops` 逐条容错。
- 击杀奖励按装备后属性持久化。
- checkpoint 绑定地图；资产幂等键加入角色。
- 验收：真实 PostgreSQL 集成测试覆盖上述每条路径。

### 里程碑 C：自动攻击与基础战斗体验

- 协议：`combat.engage`、`combat.autoAttack.start`、
  `combat.autoAttack.stop`、`combat.target.changed`。
- 服务端状态机：目标有效、距离、寻路接近、冷却、死亡/离开视野/断线/传送停止。
- 客户端只发意图；攻击条显示服务端 `nextAttackAt`。
- 拒绝/系统警告改为 4 秒自动消失的 Toast；战斗面板与技能栏层级调整。
- 验收：一次锁定点击可击杀史莱姆；E2E 验证攻击条、停止、Toast 消失与不遮挡。

### 里程碑 D：WorldMapRoom 结构整理

- 先跑现有集成测试建立行为基线。
- 抽 `SessionRegistry`（双索引）、`CommandGuard`（统一门禁）、
  `StateViewPublisher`（AOI diff）。
- 不改变协议、领域计算、数据库事务与错误码顺序。
- 验收：全量集成测试 + E2E 通过；行数与职责清单写入 ADR-025。

### 里程碑 E：回归和最终验收

- `format:check`、`lint`、`typecheck`、`test`、`build`、`test:e2e` 全绿。
- `pnpm load:regression`（50 人 / 10 分钟）通过，输出接受率与拒绝码分布。
- `pnpm drill:recovery` 通过。
- 资产不变量 SQL 为 0 违例。
- 封禁重连、内容模板保护、自动攻击多人、事件归属/AOI 均有用例。
- 输出 `docs/phase-reports/alpha-01/ALPHA_01_REPORT.md`。

## 5. 不在 Alpha 0.1 范围

- Alpha 0.2 的三职业技能/外观、4–6 种怪物、15–20 件装备、商店、金币回收；
- 正式 tileset/角色动画/音效；
- 动态实例、多区服 Outbox 路由、Redis Presence；
- 任务、组队、交易、公会。

## 6. P2 影响评估（用户点名项）

| 项                                         | 是否影响 Alpha 0.2 新功能           | 本轮决定                                              |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------- |
| TD-DATA-03 checkpoint 跨地图覆盖           | 会：Alpha 0.2 增加更多传送/副本     | 本轮修复：checkpoint 绑定 `map_id`                    |
| TD-DATA-06 资产幂等键不含角色              | 会：商店/交易命令增多               | 本轮修复：键加入 `characterId`                        |
| TD-DATA-05 装备槽唯一性只在应用层          | 低：商店/装备扩展不直接绕过 service | 延期 Alpha 0.2，需可延迟唯一约束迁移与并发测试        |
| TD-OPS-08 备份 manifest 与 dump 非同一快照 | 否：不影响玩法功能                  | 本轮先补 SHA-256 恢复校验；一致性快照延期 Beta 运营化 |

其余 P2（草稿发布、Outbox 分区服、容量门禁、nginx root 等）按路线图进入
Alpha 0.2/0.3；本轮只把容量场景接成回归命令。

## 7. 风险与应对

- **自动攻击与现有幂等/冷却交互**：所有意图仍过 `CommandGuard`；自动挥砍只调用
  `CombatWorld.basicAttack`，重复 commandId 只重发状态；集成测试断言无 COOLDOWN
  拒绝泄漏。
- **AOI 过滤误伤合法事件**：击杀/升级等公共事件继续全图公告；治疗/复活只给本人；
  E2E 与集成测试分别验证近处可见、远处不可见、旁听者收不到治疗。
- **E2E 独立库增加时长**：并行 2 workers、CI 缓存 pnpm、超时 30 分钟；本地约
  2.5 分钟。
- **Room 拆分回归**：只做行为等价抽取，先跑基线；严格保持门禁顺序与错误码。
- **压测接受率阈值**：攻击者先接近再攻击；阈值默认 70%，同时输出拒绝码分布，
  避免把 OUT_OF_RANGE/COOLDOWN 当作容量失败。
