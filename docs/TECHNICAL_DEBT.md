# Web Legend 技术债务清单

- 日期：2026-11-25
- 范围：MVP 阶段 0–9 全部代码、数据库、内容、测试与交付脚本
- 方法：逐文件阅读 + 本机真实运行 + 开发库不变量查询 + 双栈/独立库对照复现
- 关联：`docs/MVP_ACCEPTANCE_REPORT.md`、`docs/GAMEPLAY_REVIEW.md`、
  `docs/PROJECT_ROADMAP.md`

## 0. 等级定义与汇总

| 等级 | 定义                                                            |
| ---- | --------------------------------------------------------------- |
| P0   | 阻断正常游玩、造成资产丢失/重复、可被普通玩家直接利用的安全漏洞 |
| P1   | 明显影响 MVP 品质或验收可信度，Alpha 开始前应处理               |
| P2   | 已在真实运行中暴露风险，Alpha 0.2 内应处理                      |
| P3   | 可维护性、边界与长期演进问题，按触发条件安排                    |

本轮未发现 P0。P1 共 8 项，P2 共 25 项，P3 共 24 项，合计 57 项。所有 P1/P2 均有代码位置
或可复现操作，未列入“仅凭感觉”的重构建议。

## 0.1 Alpha 0.1 关闭与调整（2026-11-25）

证据与里程碑见 `docs/ALPHA_01_EXECUTION_PLAN.md`、
`docs/phase-reports/alpha-01/ALPHA_01_REPORT.md`、ADR-025。

### 已关闭 P1

| 编号       | 处置                                                                                           | 证据                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TD-OPS-01  | CI e2e job 增加 PostgreSQL service 与连接串                                                    | `.github/workflows/ci.yml`                                                              |
| TD-OPS-02  | E2E 专用数据库、专用端口、建库/删库；不再共享开发库与 outbox                                   | `playwright.config.ts`、`infra/scripts/e2e-database.ts`、`tests/e2e/globalTeardown.ts`  |
| TD-SRV-04  | 管理断开会话直接移除；重连重新校验账号状态；宽限结束不复活已终止会话                           | `apps/game-server/test/admin.integration.test.ts`                                       |
| TD-DATA-04 | 发布/激活前校验玩家持有模板；掉落恢复逐条容错                                                  | `apps/control-api/test/admin.integration.test.ts`、`assetService.loadOpenDrops`         |
| TD-SRV-02  | 战斗事件按 AOI/归属投递；治疗/复活只给本人                                                     | `worldMapRoom.broadcastCombatEvent`、`combat.integration.test.ts`                       |
| TD-CLI-01  | 服务端权威自动攻击状态机、接近与停止；客户端一次锁定                                           | `contracts/combat.ts`、`worldMapRoom.updateAutoAttacks`、`tests/e2e/autoAttack.spec.ts` |
| TD-CLI-02  | 提示改为 4 秒 Toast，移出战斗区并分层                                                          | `useWorldSession.pushNotice`、`styles.css`、`autoAttack.spec.ts`                        |
| TD-SRV-01  | 第一阶段拆分完成：`SessionRegistry`/`CommandGuard`/`StateViewPublisher`；残余职责转 TD-SRV-01b | ADR-025、`apps/game-server/src/rooms/*.ts`                                              |

### 已关闭 P2（本轮顺带处理）

| 编号       | 处置                                             | 证据                                                   |
| ---------- | ------------------------------------------------ | ------------------------------------------------------ |
| TD-DATA-01 | 击杀奖励按装备后属性裁剪并持久化                 | `assetService.grantKillReward`、资产集成测试           |
| TD-DATA-02 | 过期未领取掉落与地面实例清理；已领取行保留 7 天  | `purgeExpiredWorldDrops`、资产集成测试                 |
| TD-DATA-03 | checkpoint 条件加入 `map_id`，旧地图快照不再覆盖 | `characters.integration.test.ts`                       |
| TD-DATA-06 | 资产幂等键加入 `characterId`                     | 资产集成测试“scopes idempotency keys to the character” |
| TD-OPS-08  | 恢复演练先校验 `.sha256`；一致性快照仍延期       | `infra/scripts/db-restore-drill.sh`                    |
| TD-QA-01   | 50×10min 接入 `pnpm load:regression`             | `apps/game-server/package.json`                        |
| TD-QA-02   | 攻击者先接近；输出接受率与拒绝码分布并断言       | `scripts/worldScenario.ts`                             |

### 新增/调整

| 编号       | 内容                                                      | 说明                                      |
| ---------- | --------------------------------------------------------- | ----------------------------------------- |
| TD-SRV-01b | Room 残余编排拆分（传送、资产管线、管理命令、checkpoint） | P2，Alpha 0.2；ADR-025 记录理由           |
| TD-DATA-05 | 装备槽可延迟唯一约束                                      | 仍为 P3/P2 评估项，Alpha 0.2 迁移窗口处理 |
| TD-OPS-08b | 备份与 manifest 同一快照                                  | P2 保留，Beta 运营化处理                  |

## 0.2 Alpha 0.2 切片 1 关闭与调整（2026-11-25）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_SHOP_REPORT.md` 与 ADR-026。

### 已关闭

| 编号      | 处置                                               | 证据                                         |
| --------- | -------------------------------------------------- | -------------------------------------------- |
| TD-CLI-12 | 移除玩家可见的“阶段 6”内部标签                     | `GameScreen.tsx`；商店截图                   |
| （并发）  | 资产命令统一改为先锁角色行、再写幂等命令，消除死锁 | `assetService.ts` 五个命令；并发购买集成测试 |

### 新增并同轮关闭

| 编号     | 内容                                                           | 处置                                                                                                 |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TD-QA-10 | Vitest 多文件共享测试库，Room 实时清理会删除其他文件的掉落夹具 | 资产测试时钟改为从“当前时间 + 24 小时”起算，夹具不再被实时清理命中；共享库的长期隔离仍在 Beta 前评估 |

### 新增（未关闭）

| 编号      | 内容                                   | 等级 | 说明                                                           |
| --------- | -------------------------------------- | ---- | -------------------------------------------------------------- |
| TD-ECO-01 | 商店无买回、出售二次确认与手动数量输入 | P3   | 仅靠“初始武器绑定 + 已装备不可售”兜底；与 S4 背包/图标一起补齐 |

### 保留并影响本版

- TD-SRV-03（资产单队列）：商店买卖与拾取共用队列；切片 1 未拆分，压测需
  观察资产 p95。
- TD-DATA-05（装备槽唯一约束）：商店增加装备流转，最迟在 Alpha 0.2 装备扩展
  前处理。
- TD-OPS-03/04（草稿发布与冲突）：价格通过内容草稿发布，运营误改风险上升；
  当前有 schema 与“收购价必须低于售价”校验兜底。
- TD-OPS-07（经济合理性校验）：商店价格已限制在 0–1,000,000，但缺少按等级
  曲线的软上限；Beta 前补充。

## 0.3 Alpha 0.2 S2 任务 2 复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_SKILLS_REPORT.md` 与 ADR-028。

- 未新增 P0/P1/P2 债务。DoT 与护盾状态仅存于内存，进程崩溃会丢失，与既有
  “战斗/怪物状态仅内存”风险一致；资产与经验仍不在战斗中。
- 技能栏顺序问题（`jsonb` 键序）已修复并沉淀为 EL-018。
- **TD-CLI-06（P2）仍开放**：三职业已有 3 个技能与等级解锁，但外观、攻击/施法/
  受击/死亡动作仍共用占位贴图；这是 S2 剩余的核心交付。
- 护盾数值通过 `combat.profile.shield` 在重连后恢复；客户端没有独立倒计时，
  以服务端 `shield` 事件为准，不作为债务。

## 0.4 Alpha 0.2 S2 任务 3 复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_CLASS_APPEARANCE_REPORT.md` 与
ADR-029。

### 已关闭

| 编号      | 处置                                                        | 证据                                                     |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| TD-CLI-06 | 三职业独立贴图与待机/行走/攻击/施法/受击/死亡片段，事件驱动 | `ALPHA_02_CLASS_APPEARANCE_REPORT.md`、`classes.spec.ts` |

### 新增/调整

| 编号      | 内容                                     | 说明                                           |
| --------- | ---------------------------------------- | ---------------------------------------------- |
| TD-CLI-13 | 角色/怪物/地形仍为程序生成占位美术（P3） | 职业已可区分且有动作帧；正式美术与 S4 一起替换 |

- 新增资源生成脚本后，角色贴图可逐字节复现；不再直接手改 PNG。
- 动画状态机为客户端纯函数，未新增服务端、协议或数据库路径；无容量债务变化。

## 0.5 Alpha 0.2 S3 第一切片复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_MONSTER_THREAT_REPORT.md` 与
ADR-030。

- 未新增 P0/P1/P2 债务。前摇状态与怪物状态一样仅存于内存，进程崩溃后按规则
  重建，与既有“战斗/怪物状态仅内存”风险一致。
- 新增 TD-OPS-18（P3）：地图刷点与内容 Release 的耦合缺少部署预检。本轮重启
  开发栈时旧 Release 因新刷点引用未覆盖的怪物而校验失败，服务器保留基线快照
  并持续报错；发布 `2026.11.26.3` 后恢复。建议在部署/发布脚本中预检。
- 新怪物全部使用现有 AI 参数（远程射程、移速、防御），没有为单个怪物新增
  服务端分支；前摇只对配置了 `windupMs` 的怪物生效。

## 0.6 Alpha 0.2 S3 第二切片复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_DEATH_COST_REPORT.md` 与
ADR-031。

### 已关闭 / 调整

| 编号       | 内容                                                       | 说明                                                            |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| （复活点） | 战斗复活点从代码默认 `spawnPoints[0]` 改为编译地图显式字段 | Tiled `respawn` 标记；未标记地图回退旧行为，无兼容性破坏        |
| TD-OPS-03  | 未关闭；`rules` 现在与其他 section 一样依赖已保存草稿发布  | 死亡代价规则编辑同样受“发布/校验读已保存草稿”影响，未扩大风险面 |

### 新增

| 编号       | 内容                      | 等级 | 说明                                                                                                                           |
| ---------- | ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| TD-DATA-11 | 经验变更没有连续经验流水  | P3   | 击杀奖励与死亡扣减只写 `asset_commands` 幂等行，`characters.exp` 直接改值；运营无法按账本对账或恢复误扣，Beta 前评估经验流水表 |
| TD-QA-11   | 普攻 E2E 依赖怪物 AI 状态 | P3   | `classes.spec.ts` 等 `monster-row` 进入 attack 才继续；2 worker 下怪物可能被其他用例玩家拉走并 return，本轮全量曾偶发失败一次  |

### 说明

- 未新增 P0/P1/P2。死亡扣减复用资产事务、行锁与幂等键，未引入新的资产路径。
- 新增内容 section 的横切成本被真实暴露：PostgreSQL `content_section` 枚举需要
  expand 迁移、运营草稿契约需要新的联合类型分支、diff 需把 section 当作键值
  映射；已沉淀为 EL-022。
- PvP 死亡仍无惩罚（ADR-021），未因新规则改变；没有新增作弊面。

## 0.7 Alpha 0.2 S4 切片 A 复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_EQUIPMENT_REPORT.md` 与
ADR-032。

### 新增

| 编号      | 内容                      | 等级 | 说明                                                                                                                           |
| --------- | ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| TD-CLI-14 | 商店面板覆盖顶部 HUD 开关 | P3   | 居中商店面板（`z-index: 4`）盖住背包/角色/音效按钮；已做面板互斥，但打开商店时仍需先关闭才能点顶部开关；建议改为右侧停靠或下移 |

### 调整

| 编号      | 内容                                | 说明                                                                                                                          |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TD-QA-11  | 普攻 E2E 依赖怪物 AI 状态（仍开放） | `skills.spec.ts` 两个用例已改为独占 `wilds_slime_10` / `wilds_slime_8` 刷点，本轮全量 32/32；根因（跨用例共享世界实体）未解决 |
| TD-CLI-13 | 正式美术仍为占位（仍开放）          | 装备数量增加后图标缺失更明显：当前背包只有文字与品质色，没有物品图标                                                          |

### 说明

- 未新增 P0/P1/P2。装备仍走 ADR-020 的资产事务；对比/整理是客户端纯函数，
  不新增协议命令、数据库路径或资产写入。
- 内容校验新增一条 error（非装备设置品质）与一条 warning（装备无法获得）。
  新增 error 只在历史数据不可能出现时使用，避免已发布 Release 无法加载
  （EL-023）。

## 0.8 Alpha 0.2 S4 图标与品质复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_ITEM_ICONS_REPORT.md` 与 ADR-033。

### 已关闭 / 调整

| 编号      | 内容                                | 说明                                                                                               |
| --------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| TD-CLI-13 | 物品图标缺失（子项完成）            | 37 件基线物品已有程序化占位图标与统一回退；tileset、三套角色、怪物造型仍是占位美术，正式美术仍开放 |
| TD-CLI-14 | 商店面板覆盖顶部 HUD 开关（仍开放） | 本轮未改商店布局；图标行改变了商店内部高度，但遮挡关系与复现步骤不变                               |

### 新增

| 编号      | 内容                         | 等级 | 说明                                                                                                      |
| --------- | ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| TD-CLI-15 | 场景内地面掉落物没有物品图标 | P3   | HUD“附近掉落”已用同一图标组件；Phaser `LootVisual` 仍是几何袋状标记加文字，需要把图集注册为纹理并按帧绘制 |

### 说明

- 未新增 P0/P1/P2。图标是客户端资源与纯展示解析；服务端只新增商店目录可选
  `quality` 字段，不参与价格、掉落或结算。
- 图标图集与模板映射放在资源 manifest，不进入内容 Release，避免美术迭代触发
  内容 checksum/发布流程（ADR-033）。生成器从基线内容校验覆盖率，新增物品缺
  图标时 `pnpm assets:generate` 失败。
- 稀有品质的金色描边仍只有单元测试与 CSS 覆盖；没有稳定获取路径，浏览器证据
  与 S4-A 相同缺口。

## 0.9 Alpha 0.2 S4 HUD 重排复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_HUD_RELAYOUT_REPORT.md`。

### 已关闭

| 编号      | 处置                                                     | 证据                                                           |
| --------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| TD-CLI-14 | 商店改为右侧停靠；打开背包直接替换商店，顶部开关始终可点 | `styles.css` `.shop-panel`、`equipment.spec.ts`、`hud.spec.ts` |
| TD-CLI-09 | 窄屏不再隐藏聊天；停靠在技能坞上方并支持收起             | `styles.css` ≤860px 规则、`hud.spec.ts` 聊天用例               |

### 新增

| 编号      | 内容                            | 等级 | 说明                                                                                                                             |
| --------- | ------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| TD-CLI-16 | 世界内角色/怪物名字标签相互重叠 | P3   | 玩家与附近怪物的 Phaser 文本标签在同一屏幕位置叠加（如站在杂货商旁）；HUD 已改为不透明底色，但场景标签本身仍无避让或隐藏远处标签 |

### 说明

- 未新增 P0/P1/P2。本切片只改客户端 DOM/CSS，没有服务端、协议、内容或数据库
  路径变化；因此未复跑 50 人容量回归。
- 右栏固定偏移改为按连接卡片最坏状态高度计算，并把可点击性写进 E2E；原因
  与复现见 EL-026。
- HUD 仍在 `GameScreen.tsx` 内以条件渲染组织，未拆成独立组件；当前规模可读，
  下次新增面板（如任务/公会）前再评估抽取。

## 0.10 Alpha 0.2 S4 场景可读性复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_SCENE_READABILITY_REPORT.md`。

### 已关闭

| 编号      | 处置                                                                                | 证据                                                                           |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TD-CLI-15 | 地面掉落注册 `item_icons.png` spritesheet，按 `itemIconFrame` 显示同一图标          | `LootVisual.ts`、`WorldScene.preload`、`economy.spec.ts`                       |
| TD-CLI-16 | 新增纯函数 `labelLayout.ts`，自己 > 目标 > NPC > 其他玩家 > 怪物，每 100ms 贪心避让 | `labelLayout.ts`/`.test.ts`、`WorldScene.updateLabelVisibility`、`hud.spec.ts` |

### 说明

- 未新增 P0/P1/P2。本切片只改客户端 Phaser 展示与测试钩子，没有服务端、协议、
  内容、数据库或资源文件变化；因此未复跑 50 人容量回归。
- 标签规则选择“只隐藏相交标签、不移动位置”，避免实体走动时标签跳动；传送门
  与地面掉落文字暂不参与布局。
- 全量 E2E 首轮暴露 `multiplayer.spec.ts` 的 250ms 时序断言偶发超时（337ms，
  单跑 262ms，重复 3/3 与全量重跑均通过），属于 §6 已记录的软件渲染抖动，
  未新增债务。

## 0.11 Alpha 0.2 S4 tick 剖析复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_TICK_PROFILE_REPORT.md`。

### 已关闭

| 编号                        | 处置                                           | 证据                                                      |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| tick p95 超标（风险表条目） | AOI 每 tick 去重刷新、复用 Set、单次取玩家列表 | `worldMapRoom.ts`、`interest.ts`、`stateViewPublisher.ts` |

### 新增

| 编号      | 内容                                      | 等级 | 说明                                                                                                           |
| --------- | ----------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| TD-SRV-10 | tick 内战斗事件逐客户端序列化与写入约 28% | P3   | `--cpu-prof` 显示 `simulateTick` 子树内 msgpackr `pack`/`writev` 占比高；当前 p95 5.34ms，团战事件量增长前观察 |

### 说明

- 未新增 P0/P1/P2。TD-SRV-03（资产单队列）仍开放，资产事务 p95 48.4ms 未阻塞
  tick；本切片不改变其处理时机。
- 全量 E2E 首轮仍有 `multiplayer.spec.ts` 250ms 时序偶发超时，单跑 3/3 与全量
  重跑通过，未新增债务。

## 0.12 Alpha 0.2 S4 任务链复核（2026-11-26）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_QUEST_REPORT.md` 与 ADR-034。

### 已关闭 / 调整

| 编号                      | 处置                                                         | 说明                                                             |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| （NPC 无目标/守卫不可用） | 主城守卫可接取与交付三步任务链；任务状态、进度、奖励持久化   | `character_quests`、`quests` section、`tests/e2e/quests.spec.ts` |
| TD-QA-11                  | 仍开放；新任务 E2E 改用独占刷点 `wilds_slime_9` 并登记在注释 | 共享世界实体的根因未解决，新增用例继续按独占刷点规避             |
| TD-DATA-11                | 仍开放；任务交付经验与击杀经验走同一路径                     | 金币有 `currency_ledger`，经验仍无连续流水                       |

### 新增

| 编号      | 内容                                    | 等级 | 说明                                                                                                                               |
| --------- | --------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TD-OPS-19 | 新增内容 section 需手动扩展运营草稿联合 | P3   | `adminContentDraftUpdateSchema` 是手写 `z.literal` 联合，不随 `CONTENT_SECTIONS` 扩展；本轮保存 quests 草稿才以 422 暴露（EL-029） |

### 说明

- 未新增 P0/P1/P2。任务进度与击杀奖励同事务；接取/交付走既有资产命令管线，
  没有新的资产写入路径或公开状态。
- 任务定义不复制进数据库；内容回滚不会删除玩家记录，但会隐藏该任务。删除仍被
  引用的 `questId` 不会破坏加载（ADR-034）。
- 本切片只做 kill 目标；收集/到达、每日任务、放弃、组队共享与 NPC 头顶标记
  尚未实现，按 Alpha 0.3 任务系统评估，不单列为债务。
- 50 人 × 10 分钟正式回归已通过（tick p95 6.53ms、p99 9.82ms、0 资产失败，
  资产事务 p95 59.34ms）；TD-QA-01（容量未接入 CI）仍开放。

## 0.13 Alpha 0.3 S1 组队复核（2026-11-27）

证据见 `docs/phase-reports/alpha-02/ALPHA_02_PARTY_REPORT.md`、ADR-035 与
ADR-036。

### 已关闭 / 调整

| 编号                   | 处置                                                      | 说明                                                                |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| （多人交互无合作目标） | 邀请/接受/拒绝/离开、跨图队伍名单、同图共享经验与掉落归属 | `PartyService`、`party.*` 协议、拾取事务、`tests/e2e/party.spec.ts` |
| TD-QA-11               | 仍开放；组队 E2E 使用专用 Room（`?fresh=1` + `?join=`）   | 与世界实体共享无关，但双人用例仍需显式加入同一房间（EL-030）        |
| TD-DATA-11             | 仍开放；共享经验与击杀经验走同一路径                      | 金币无涉，经验仍无连续流水                                          |

### 新增

| 编号      | 内容                       | 等级 | 说明                                                                   |
| --------- | -------------------------- | ---- | ---------------------------------------------------------------------- |
| TD-SRV-11 | 队伍仅内存，进程重启后消失 | P3   | 过图已保留（ADR-036）；重启/崩溃丢队伍、多进程不可共享，持久化按需评估 |
| TD-CLI-17 | 队伍 UI 只有名单与离队     | P3   | 无队伍聊天、队长移交、踢人、按名字邀请；按试玩反馈安排                 |

### 说明

- 未新增 P0/P1/P2。队伍状态进入进程级 `PartyService`（ADR-036），过图不再
  散队；名单仍不进入公开 Room State，也不产生新的资产写入路径；共享经验是
  独立幂等事务，幂等键包含击杀引用与角色 id，重试不会重复发放。
- 共享经验按内容基础经验的固定千分比计算，不消耗 RNG；4 人满队最多额外 150%
  经验，由 `rules.party` 控制，需要试玩数据决定是否调整。
- 50 人 × 10 分钟正式回归与 2 分钟 sanity 已执行；压测机器人不组队，共享经验
  路径由服务端集成测试覆盖。

## 0.14 Alpha 0.3 S2 世界首领复核（2026-11-27）

证据见 `docs/phase-reports/alpha-03/ALPHA_03_BOSS_REPORT.md` 与 ADR-037。

### 已关闭 / 调整

| 编号                      | 处置                                         | 说明                                                          |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| （10 级以上缺少共同目标） | 废墟世界首领、二阶段狂暴、独占掉落与首领 HUD | ADR-037、`boss.integration.test.ts`、`tests/e2e/boss.spec.ts` |

### 新增

| 编号      | 内容                       | 等级 | 说明                                                              |
| --------- | -------------------------- | ---- | ----------------------------------------------------------------- |
| TD-SRV-12 | 首领刷新为 Room 进程内计时 | P3   | 重启重置、多进程各有自己的首领；与 TD-SRV-11 同类，规模化前需协调 |

### 说明

- 未新增 P0/P1/P2。Boss 掉落与经验复用既有资产事务和归属窗口；没有新迁移、
  新资产写入路径或公开隐私数据（怪物位置/HP 原本就在 AOI 公共状态中）。
- 狂暴阶段是封闭内容对象（阈值 + 倍率），不引入脚本/DSL；多阶段或阶段技能
  需要新的封闭行为与 ADR。
- Boss 只在视野内出现首领血条，没有世界频道提示、首杀记录或地图标记；按试玩
  反馈决定是否补充，不单列为债务。
- 50 人 × 2 分钟 sanity p95 5.34ms、0 资产失败；10 分钟正式回归仍以 S1 为
  最近一轮，S3 前需复跑。

## 0.15 移动手感修复复核（2026-11-27）

证据见 `docs/ADR/ADR-016-phase1-movement-model.md` 补充、`movement.integration.test.ts`
与 `tests/e2e/movement.spec.ts`。

### 已关闭 / 调整

| 编号               | 处置                                      | 说明                                                  |
| ------------------ | ----------------------------------------- | ----------------------------------------------------- |
| （重寻路回退）     | 格内偏移同向继续、垂直转向在下一格内完成  | 自动攻击不再每 350ms 回到格中心；连续点击地面不再后退 |
| （自动攻击无预测） | 通过 `combat.target.changed` 下发接近路径 | 客户端按路径预测，不再只跟随 10Hz 快照                |

### 新增

| 编号      | 内容                        | 等级 | 说明                                                          |
| --------- | --------------------------- | ---- | ------------------------------------------------------------- |
| TD-CLI-18 | 四方向移动，斜向目标走 L 线 | P3   | 格步数上仍是最短；八方向移动需要斜向阻挡规则、预测与 ADR 更新 |

### 说明

- 未新增 P0/P1/P2。BFS 仍是四方向最短路径；本轮修的是路径执行与客户端预测，
  没有改变服务端权威移动模型。
- 新增单元/集成测试断言“重寻路不后退”“自动攻击路径下发”，浏览器 E2E 断言
  “连续移动不冻结”；全量 519 测试、43 E2E 通过。
- 四方向到八方向是玩法决策，不在 bugfix 中顺手放宽；先按试玩反馈评估。

## 0.16 Alpha 0.3 S3-A 每日任务复核（2026-11-27）

证据见 `docs/ADR/ADR-038-daily-repeatable-quests.md`、
`docs/phase-reports/alpha-03/ALPHA_03_DAILY_QUESTS_REPORT.md`、
`packages/game-domain/src/quests.test.ts` 与
`packages/game-application/test/assetService.integration.test.ts`。

### 已关闭 / 调整

| 编号 | 处置                   | 说明                                           |
| ---- | ---------------------- | ---------------------------------------------- |
| —    | 一次性任务无法重复接取 | 周期键让日常按区服日重开，历史与唯一性同时保留 |
| —    | 旧 Release 无日常字段  | 新字段全部可选；旧内容行为不变                 |

### 新增

| 编号       | 内容                       | 等级 | 说明                                                          |
| ---------- | -------------------------- | ---- | ------------------------------------------------------------- |
| TD-DATA-12 | 每日任务历史行没有清理策略 | P3   | 每个日常每天一行；当前查询走唯一索引，Beta 运营化前加保留窗口 |

### 说明

- 未新增 P0/P1/P2。在线重置依赖宿主机时钟，多进程部署要求 NTP 同步；本轮
  单进程不构成额外风险。
- 日常 UI 只有静态重置时刻，没有倒计时或未接提醒；这是体验增强，不单列为
  债务，按试玩反馈安排。
- 全量 530 单元/集成、43 E2E；50 人 × 2 分钟 p95 5.11ms、0 资产失败。

## 0.17 Alpha 0.3 S3-B 一键任务导航复核（2026-11-27）

证据见 `docs/ADR/ADR-039-one-click-quest-guidance.md`、
`docs/phase-reports/alpha-03/ALPHA_03_QUEST_GUIDANCE_REPORT.md`、
`apps/game-server/test/questRouting.test.ts` 与
`tests/e2e/questGuidance.spec.ts`。

### 已关闭 / 调整

| 编号 | 处置                                  | 说明                                   |
| ---- | ------------------------------------- | -------------------------------------- |
| —    | 野外任务视图显示 NPC 机器名           | NPC 名字改为从全部地图解析             |
| —    | 过图后任务面板看不到进行中/已完成任务 | 面板保留跨图任务，野外也能「回去交付」 |

### 新增

| 编号      | 内容                   | 等级 | 说明                                                   |
| --------- | ---------------------- | ---- | ------------------------------------------------------ |
| TD-CLI-19 | 自动战斗只使用普通攻击 | P3   | 不自动释放技能或喝药；按试玩反馈评估技能轮换与药水策略 |

### 说明

- 未新增 P0/P1/P2。导航意图是连接级状态，过图/断线依赖客户端重放；关闭页面
  即丢失，属于当前单进程设计的已知边界，未单列为债务。
- 目标选择是“最近的可见怪”，可能与其他玩家争夺；抢怪保护需要玩法规则，按
  试玩反馈评估。
- Room 导航编排约增加 450 行，继续计入 TD-SRV-01b；纯路由已抽出到
  `world/questRouting.ts`。
- 全量 E2E 在 2 worker 下出现时序/共享实体抖动，单跑与串行全量均通过；
  更新 TD-QA-11 证据，未降低断言。

## 1. 服务端与实时网络

### TD-SRV-01（P1）Room 成为 2178 行的万能类

- 证据：`apps/game-server/src/rooms/worldMapRoom.ts` 2178 行，同时承担票据/租约、
  资产加载、移动、战斗命令、聊天、传送、掉落恢复、checkpoint、管理命令、
  指标与 AOI 视图。
- 影响：违反 AGENTS §5 “不要写超大 MapRoom”的精神；任何玩法扩展都要改同一
  文件，多 Agent 并行会冲突；命令管线重复代码（移动/战斗/资产三套幂等与限频）。
- 建议：先抽 `SessionRegistry`、`CommandGuard`（会话/协议/序号/限频/幂等）、
  `TransferService`、`AssetCommandPipeline`、`ViewSynchronizer`，Room 只保留
  Colyseus 生命周期与装配。必须先补集成测试再拆。
- 工作量：M（3–5 人日），风险中。

### TD-SRV-02（P1）CombatEvent 全 Room 广播

- 证据：`worldMapRoom.ts:979-982` 与 `:1371-1373` 对每条战斗事件
  `this.broadcast`，不经过 AOI。
- 影响：远处玩家收到无关攻击/受击/治疗事件；客户端战斗日志已因此把别人的
  治疗显示成自己的（见 TD-CLI-03）。50 人压测 10 分钟 5,649 条事件尚可，
  多人团战会线性放大。
- 建议：按事件涉及的 source/target 计算可见会话集合；或先按 AOI cell 过滤；
  治疗/复活事件只发给本人。保留击杀/升级等公共事件的全图广播。
- 工作量：M（2–4 人日），需要带宽指标复测。

### TD-SRV-03（P2）资产事务单队列 + 奖励重试阻塞

- 证据：`worldMapRoom.ts:1667-1679` 单个 `assetQueue`；`:1710-1729` 奖励失败
  在队列内 `setTimeout(200/400ms)` 重试。
- 影响：一次数据库抖动会让所有拾取/装备命令排队约 600ms；压测资产事务 p95
  33ms 已包含排队时间。
- 建议：奖励与玩家命令分队列；玩家命令使用有界并发（例如 4）；重试移到队列
  之外或使用数据库退避任务。
- 工作量：M（2–3 人日）。

### TD-SRV-04（P1）封禁可被 15 秒重连宽限期绕过

- 证据：`worldMapRoom.ts:1598` `client.leave(4000)`；`:684` 只有
  `CloseCode.CONSENTED` 才立即移除；`:696` 其余一律进入
  `allowReconnection(15s)`；`:641 onReconnect` 不重新校验账号状态。
- 影响：正常网页客户端在 4000 关闭时会清除重连令牌，但修改过的客户端可在
  15 秒内用 `reconnect(token)` 恢复已被封禁/踢下线的会话，且 outbox 命令已
  标记 applied，不会再次执行。封禁是运营的核心安全手段。
- 建议：为管理断开会话记录 `terminated` 原因；`onLeave` 对管理断开直接
  `removeSession`（或缩短到 0 宽限）；`onReconnect` 重新查询账号状态与
  `muted_until`。补一条集成测试：封禁后携带旧 token 重连必须失败。
- 工作量：S（0.5–1 人日）。

### TD-SRV-05（P2）传送后会话记录可能残留

- 证据：`worldMapRoom.ts:1084-1141` 传送提交后移除 simulation/combat/state，
  但保留 `sessions` 与 `sessionByPlayer`，等待客户端 `onLeave`。
- 影响：若客户端在收到 `session.transfer` 后网络中断且不再连接，旧 Room 内
  会留下无实体的 SessionRecord，直到 Room dispose；期间 `sessionByPlayer`
  会阻止同角色重新加入该 Room（正常情况下角色已不在该地图，影响小）。
- 建议：发送 transfer 后设置短定时器清理；或统一走 `removeSession` 的
  “已提交传送”分支。
- 工作量：S。

### TD-SRV-06（P2）管理命令幂等只在进程内存

- 证据：`apps/game-server/src/admin/commandHub.ts:11-16` 内存 Set，上限 1000；
  outbox 60 秒后重投 stale dispatched 行。
- 影响：进程重启或超过 1000 条命令后，重复投递会再次执行 kick；ban/mute 天然
  幂等，kick 不幂等（会踢掉同名角色重新登录后的新会话）。
- 建议：用 `outbox_events.status/command_id` 或 `admin_command_receipts` 表做
  持久幂等；或让 kick 也带“只踢指定 sessionId”的语义。
- 工作量：M。

### TD-SRV-07（P2）Outbox 不分区服/目标进程

- 证据：`outbox_events` 无 `realm_id`/`game_server_id`；dispatcher 轮询全表；
  本轮实测：开发 Control API（连 87）与隔离 Control API（连 2587）共享同一
  数据库时，E2E 的 kick 行被开发进程抢走并在错误进程执行 `applied=0`，导致
  E2E 失败；独立数据库后 20/20 通过。
- 影响：单区服单 API 时安全；多区服/多 Control API 会把命令投递到错误进程，
  且“applied=0”仍标记成功，运营看到成功但玩家未被处理。
- 建议：Outbox 增加 `realm_id`、`target_server_id`；dispatcher 只领取本进程
  负责的行；`applied=0` 不直接标记 applied（目标离线可单独定义）；多
  dispatcher 使用 PostgreSQL advisory lock 选主。
- 工作量：M。

### TD-SRV-08（P3）硬上限 50 人、无排队提示

- 证据：`worldMapRoom.ts:289` `maxClients = 50`；matchmaking 拒绝为 Colyseus
  默认错误。
- 影响：第 51 人看到通用失败，无排队/换线指引；扩容前体验断崖。
- 建议：Alpha 0.3 做实例路由时统一处理满员错误码与换线入口。
- 工作量：S（随路由一起做）。

### TD-SRV-09（P3）实体无碰撞

- 证据：移动只校验地形，玩家与怪物、玩家与玩家可重叠。
- 影响：点击判定重叠、视觉堆叠；不改变权威位置。
- 建议：软碰撞（同格减速/排开）或客户端选目标优先级；不要引入物理引擎。
- 工作量：S/M。

### TD-SRV-10（P3）tick 内战斗事件逐客户端序列化与写入

- 证据：S4-F 的 `--cpu-prof` 子树显示 `simulateTick` 内 msgpackr `pack` +
  `Packr.writePlainObject` + `writev` 约占 28%；50 人 × 10 分钟当前 tick
  p95 5.34ms，尚未超标。
- 影响：团战/精英密集时事件量与接收者增长，序列化会重新成为长尾来源；
  当前每事件对每个 AOI 接收者单独 `client.send`。
- 建议：先按 AOI 与事件类型确认可合并范围；如需要，新增“每 tick 事件批次”
  协议消息或降低非关键事件（攻击动画）的发送频率，必须走 contracts 版本化，
  不能直接在服务端拼接未定义消息。
- 工作量：M。

### TD-SRV-11（P3）队伍仅内存，进程重启后消失

- 证据：Alpha 0.3 S1 的 `PartyService` 由游戏服务器进程持有，跨地图共享；
  进程重启或崩溃后队伍消失，玩家需要重新邀请（ADR-036）。传送与 Room 销毁
  已不会散队。
- 影响：单进程部署下，只有重启/崩溃会丢队伍；多进程或需要重启保留时，
  现有实现无法共享队伍。
- 建议：出现多地图协作/副本、多进程路由或“重启保留队伍”需求时，再评估
  持久化队伍表或共享社交服务（含频道、好友、公会），并先写 ADR；不要把关
  系状态塞进公开 Room State。
- 工作量：M（持久化）/ L（跨进程）。

## 2. 数据、事务与经济

### TD-DATA-01（P2）击杀奖励按基础属性裁剪 HP/MP，忽略装备

- 证据：`packages/game-application/src/assetService.ts:237-251` 用
  `combatStatsFor(class, level)` 的 `base.maxHp/maxMp` 裁剪并写回；内存中的
  `outcome.stats` 却使用装备加成。
- 影响：穿 +最大生命装备的玩家击杀后，数据库 HP/最大 HP 回落到基础值，
  下一次 checkpoint 前崩溃/下线会持久化较低数值；后台玩家详情也读取基础值。
- 建议：事务内读取已装备物品并 `statsWithEquipment`；或不再持久化派生的
  `max_hp/max_mp`，只存当前 HP/MP 与装备。
- 工作量：S/M。

### TD-DATA-02（P2）过期/已领取掉落永不清理

- 证据：`worldMapRoom.ts:1654-1665` 只删内存 LootState；仓储层没有
  `world_drops` 删除路径。2026-11-25 开发库查询：781 条掉落全部过期，其中
  706 条未领取且对应 `item_instances.container='ground'` 永久滞留；审计结束
  时增至 763 条（`docs/phase-reports/audit-2026-11-25/database-invariants.txt`）。
- 影响：每次击杀永久增加 0–2 行；地面物品实例成为“看不见的资产”，表持续
  膨胀；运营无法解释物品总数。
- 建议：维护任务按 `expires_at < now()` 删除未领取掉落及其 item instance；
  已领取行按保留期归档；启动时也可清理。补一条集成测试。
- 工作量：S。

### TD-DATA-03（P2）Checkpoint 只按 id 更新，可能跨地图/跨世代覆盖

- 证据：`packages/persistence/src/repositories/characters.ts:128-145` 只按
  `characterId` 更新 x/y/hp/mp，不校验 `map_id` 或版本；Room 的
  `checkpointAll`（`worldMapRoom.ts:865-901`）与 `beginTransfer`
  （`:1084-1114`）并发时可能后提交旧坐标到新地图。
- 影响：传送后角色可能被旧的 20 秒 checkpoint 写回旧地图坐标；刚使用的
  药水 HP 也可能被旧 checkpoint 覆盖（20 秒内自愈，崩溃则持久化）。
- 建议：`WHERE map_id = expectedMapId` + 版本比较；或所有 checkpoint 走
  角色级串行队列。
- 工作量：S。

### TD-DATA-04（P1）内容发布删除物品模板会让持有者无法进入世界

- 证据：`assetService.ts:131-149, 752` 用 Room 固定 bundle 的 `requireItem`
  解析背包/装备模板；`loadOpenDrops`（`:180-200`）遇到一个未知模板会整体
  失败；`restoreLoot`（`worldMapRoom.ts:1601-1619`）只记录错误。
- 影响：运营在新 Release 删除或改名一个仍被玩家持有的物品，所有持有者加入
  时得到“角色资产加载失败”，且整个地图的未领取掉落都可能不再恢复。这是
  内容运营可以直接造成的登录事故。
- 建议：发布前校验候选 Release 是否覆盖 `item_instances` 中全部 distinct
  template_id；或服务端保留 retired-template 兼容表；`loadOpenDrops` 逐条
  容错并告警。必须补发布/回滚集成测试。
- 工作量：M。

### TD-DATA-05（P3）装备槽唯一性只靠应用层

- 证据：迁移 `0003` 将装备槽唯一索引改为普通索引；`assetService` 依赖角色行
  锁串行化交换。
- 影响：任何绕过 `equip` 的写入（脚本、未来接口、数据修复）都可能产生同槽
  两件装备，属性被重复累加。
- 建议：使用可延迟唯一约束（`DEFERRABLE INITIALLY DEFERRED`）或“先置 NULL
  再写目标槽”的两步交换，恢复数据库约束。
- 工作量：M。

### TD-DATA-06（P3）资产幂等键不含角色

- 证据：`assetService.ts:730` `cmd:${kind}:${commandId}`。
- 影响：两个角色使用同一 commandId 时，第二个命令被当成重复静默丢弃（不会
  刷资产，但会丢命令）。
- 建议：键加入 `characterId`。
- 工作量：S。

### TD-DATA-07（P3）角色数量上限存在并发竞态

- 证据：`apps/control-api/src/services/characters.ts:50-56` 先 count 再 insert。
- 影响：并发创建可超过每账号上限（当前 3）。
- 建议：账号级 advisory lock 或数据库约束。
- 工作量：S。

### TD-DATA-08（P3）删除角色会级联删除金币流水与资产命令

- 证据：迁移 `0002` 中 `currency_ledger`、`asset_commands` 对 characters 为
  `ON DELETE CASCADE`。
- 影响：未来上线角色删除/账号注销时，审计与经济历史丢失。
- 建议：改为 `SET NULL` 并保留匿名快照，或归档表。
- 工作量：S/M。

### TD-DATA-09（P3）内容校验允许“堆叠装备”和不可拾取掉落

- 证据：`content-schema/src/validation.ts:170-179` 未禁止可堆叠装备；
  `:206-208` 对非堆叠物品 `maxQuantity > 1` 只给 warning；`items.ts:128-130`
  拾取时放置失败。
- 影响：装备卸下只能合并堆叠 → `INVENTORY_FULL`；数量超过 maxStack 的掉落
  永远无法拾取，直到过期。
- 建议：把这两条提升为 error；或放置逻辑拆数量多次入包。
- 工作量：S。

### TD-DATA-10（P3）过期租约行不清理

- 证据：开发库 `character_sessions` 有 5 条已过期行；`acquireCharacterLease`
  会覆盖同角色行，但其他过期行保留。
- 影响：表增长缓慢；不影响正确性。
- 建议：维护任务删除过期行。
- 工作量：S。

### TD-DATA-11（P3）经验变更没有连续经验流水

- 证据：`packages/game-application/src/assetService.ts` 的 `grantKillReward`
  与 `applyDeathPenalty` 直接更新 `characters.exp/level`；`asset_commands`
  只记录幂等行（`kill:*`、`death:*`），没有“变更前后值”的账本。金币有
  `currency_ledger`，经验没有对应表。
- 影响：运营与客服无法对账或解释“经验为什么少了”；误扣/重复扣只能靠幂等键
  推断；Beta 后若加入经验找回、双倍经验或活动加成，缺少审计基础。
- 建议：新增 `experience_ledger`（角色、增量、变更后值、原因、引用 ID、幂等键），
  击杀奖励与死亡扣减在同一事务写入；先评估表增长与索引。
- 工作量：M。

### TD-DATA-12（P3）每日任务历史行没有清理策略

- 证据：迁移 0009 让每个日常任务在每个区服日生成一行
  `character_quests`（ADR-038）；已领取的旧周期行只用于历史，不参与视图或
  进度。
- 影响：每个活跃角色每个日常每天一行；以 1 万角色 × 2 个日常计算，一年约
  730 万行。短期无查询压力（当前周期查询走唯一索引），但长期占用与后台统计
  会受噪声影响。
- 建议：在 Beta 运营化前增加按 `period_key` 的保留窗口清理（例如保留 90 天），
  或在角色删除时级联；清理必须只删已领取/已完成的旧周期行，不能影响当前
  周期与一次性任务。
- 工作量：S。

## 3. 客户端与表现

### TD-CLI-01（P1）没有自动攻击，每次挥砍都要点一次

- 证据：`apps/game-web/src/game/WorldScene.ts:971-1002` 每次 pointerdown 只发
  一条 `basicAttack`；`GameScreen.tsx:160-166` 列表点击同理；服务端按
  `attackIntervalMs` 拒绝提前点击（`combatWorld.ts:484-485`）。
- 影响：玩家必须精确踩 900ms/1200ms 节奏，点快了只看到拒绝提示，点慢了输出
  中断；与传奇类“锁定目标持续攻击”的基本手感不符。本轮手动实测杀一只史莱姆
  点了 12 次，其中多次是冷却/超距拒绝。
- 建议：选中目标后自动按服务端冷却循环攻击；客户端维护“下一次可攻击时间”，
  在 HUD 显示攻击条；保留手动点击作为重新锁定。
- 工作量：S/M（1–2 人日），需服务端保持现有权威冷却。

### TD-CLI-02（P1）拒绝提示永久驻留并遮挡战斗面板

- 证据：`useWorldSession.ts:341-346` 写入 `state.notice`；只有重连等少数路径
  清空（`:584`）；`GameScreen.tsx:889-897` 渲染；`styles.css:299-311`
  `bottom:84px; z-index:2`，覆盖 `.combat-panel`（z-index 1）。
- 影响：在主城误点玩家触发 `SAFE_ZONE` 后，警告横幅会一直盖住技能栏/战斗
  面板直到刷新；目标死亡后的“目标已经死亡”同样常驻（截图
  `docs/phase-reports/audit-2026-11-25/07-inventory.png`）。
- 建议：改为可堆叠 toast，3–5 秒自动消失；同类提示去重；战斗面板与提示分层。
- 工作量：S。

### TD-CLI-03（P2）他人治疗/复活被记成自己的战斗日志

- 证据：`useWorldSession.ts:203-218` 对 `heal`/`respawn` 不校验
  `targetId/entityId === characterId`；服务端战斗事件全 Room 广播
  （TD-SRV-02）。
- 影响：玩家看到“你恢复了 N 点生命/你已复活”，实际是别人的事件。
- 建议：客户端按角色过滤；服务端同时收窄广播。
- 工作量：S。

### TD-CLI-04（P2）传送销毁并重建整个 Phaser.Game，且清空聊天历史

- 证据：`useWorldSession.ts:666-698` 重置 messages/systemMessages/combatLog，
  然后 `game.destroy(true)` + `createWorldGame`。
- 影响：每次过图重建 WebGL 上下文与纹理注册，低端机可能触发上下文回收；
  聊天/战斗记录在过图时全部丢失，不像 MMORPG 频道。
- 建议：只重启 Scene 并复用 Game/纹理；聊天历史按频道保留。
- 工作量：M。

### TD-CLI-05（P2）10Hz React 状态扇出 + 小地图重绘

- 证据：`useWorldSession.ts:291-318` 每个 patch 都 setState 新数组；
  `GameScreen` 全量列表渲染；`Minimap.tsx:20-63` 依赖这些数组重绘 canvas。
- 影响：软件渲染环境实测 25 FPS（`audit-manual` 记录），20Hz patch 下 React
  与 Phaser 争用主线程；50 人时列表更长。尚无 profiler 证据。
- 建议：把高频实体数据改为 ref + 增量订阅；小地图 4–5Hz 节流；列表虚拟化。
- 工作量：M。

### TD-CLI-06（已关闭，2026-11-26）三职业共用同一角色贴图与配色

- 原证据：`WorldScene.ts` 只用 `player_placeholder` 与 characterId 哈希色；
  无攻击动画帧。
- 处置：三套程序生成贴图 + manifest 动画片段 + 客户端状态机；攻击/施法/受击/
  死亡由 `combat.event` 驱动。见 ADR-029 与 S2 任务 3 报告。
- 剩余：正式美术替换属于 TD-CLI-13（S4）。

### TD-CLI-07（P3）无键盘移动、无停止指令

- 证据：`WorldScene.ts:295` 只注册 pointerdown；无 keydown/WASD；无
  “停止”命令。
- 影响：架构 3.1 要求键盘方向作为辅助；误点后只能再点一次纠正。
- 建议：键盘八方向短步进 + 停止键；仍由服务端寻路裁定。
- 工作量：M。

### TD-CLI-08（P3）死亡状态仍发送世界命令

- 证据：`WorldScene.handlePointerDown` 无存活判断。
- 影响：每次点击都收到 `PLAYER_DEAD` 拒绝，叠加 TD-CLI-02 的常驻提示。
- 建议：本地禁用移动/拾取，仅保留聊天。
- 工作量：S。

### TD-CLI-09（已关闭，2026-11-26）窄窗口隐藏聊天

- 原证据：`styles.css` `@media (max-width: 860px) .chat-panel { display:none }`。
- 处置：≤860px 改为停靠在技能坞上方（宽 300 / 高 180），并支持收起为标题行。
- 证据：`apps/game-web/src/styles.css`、`tests/e2e/hud.spec.ts`。

### TD-CLI-10（P3）两处坐标/常量写死

- 证据：`CharacterScreen.tsx:120` 用 `Math.floor(x / 1000)` 而非 `TILE_UNITS`；
  `WorldScene.ts:613-623` 的 `lootScreenPoint` 未加 canvas 偏移。
- 影响：当前布局下不显现；改布局或改 TILE_UNITS 时出错。
- 建议：统一投影/屏幕坐标工具。
- 工作量：S。

### TD-CLI-11（P3）重连遮罩冻结全部输入

- 证据：`GameScreen.tsx:840-866`、`styles.css` 重连层 `pointer-events:auto`。
- 影响：15 秒宽限期内整屏不可交互，场景仍在跑。
- 建议：半透明顶部条 + 保留场景输入（客户端命令会被服务端拒绝）。
- 工作量：S。

### TD-CLI-12（P3）玩家可见“阶段 6”内部标签

- 证据：`GameScreen.tsx:188`。
- 影响：泄露内部研发阶段，破坏产品感。
- 建议：移除或改为版本号。
- 工作量：S。

### TD-CLI-13（P3）角色/怪物/地形仍为程序生成占位美术

- 证据：`content/assets/generated/` 全部为 `procedural-placeholder`；职业已按
  剪影/配色区分并有动作帧（ADR-029），物品已有独立图标（ADR-033），但都不是
  可发布的正式美术。
- 影响：产品观感仍是技术演示；怪物为几何造型，地形只有 8 个 tile。
- 建议：S4 美术切片替换 tileset、三套角色、怪物造型与物品图标，保持 manifest
  结构与帧命名不变；届时删除或重做 `assets:generate` 的占位输出。
- 工作量：L（美术为主）。

### TD-CLI-14（已关闭，2026-11-26）商店面板覆盖顶部 HUD 开关

- 原证据：`.shop-panel` 居中（`z-index: 4`，宽 560px），1280×720 下覆盖
  `背包 B` / `角色 C` / `音效` 按钮，E2E 需先关闭商店才能点背包。
- 处置：商店改为右侧停靠（`top: 132px; right: 40px; bottom: 84px; width: 360px`），
  打开背包直接替换商店；`hud.spec.ts` 断言面板在右半区且不与背包按钮重叠。
- 证据：`apps/game-web/src/styles.css`、`tests/e2e/hud.spec.ts`、
  `tests/e2e/equipment.spec.ts`。

### TD-CLI-15（已关闭，2026-11-26）场景内地面掉落物没有物品图标

- 原证据：`apps/game-web/src/game/LootVisual.ts` 仍是发光袋状几何标记 + 名称
  文字；HUD 的“附近掉落”列表已使用 `item_icons.png`（ADR-033）。
- 处置：`WorldScene.preload` 把图集注册为 32px spritesheet；`LootVisual` 显示
  圆盘 + 描边 + 图标，帧号由 `itemIconFrame` 解析；世界状态仍只下发
  `templateId`。新增 `lootIconFrame(dropId)` 钩子与 E2E 帧号断言。
- 证据：`LootVisual.ts`、`WorldScene.ts`、`tests/e2e/economy.spec.ts`、
  `docs/phase-reports/alpha-02/scene-readable/`。

### TD-CLI-16（已关闭，2026-11-26）世界内角色/怪物名字标签相互重叠

- 原证据：S4-D 截图 `docs/phase-reports/alpha-02/hud-relayout/dev-world-1280.png`
  与 `dev-world-1600.png`：玩家站在杂货商旁时「Lv.1 <角色>」与「杂货商」两个
  Phaser 文本标签在同一屏幕位置叠加；多只怪物相邻时同样互相遮挡。
- 处置：新增纯函数 `labelLayout.ts`，按自己 > 目标 > NPC > 其他玩家 > 怪物
  贪心避让；同优先级按距离、再按 id 稳定排序；只隐藏相交标签（3px 间距），
  不移动位置。场景每 100ms 刷新，选择/取消目标即时刷新；死亡实体名字隐藏。
  新增 `labels()` 钩子与 E2E“可见标签两两不重叠”断言。
- 证据：`apps/game-web/src/game/labelLayout.ts`/`.test.ts`、
  `WorldScene.updateLabelVisibility`、`tests/e2e/hud.spec.ts`、
  `docs/phase-reports/alpha-02/scene-readable/`。

### TD-SRV-12（P3）首领刷新为 Room 进程内计时

- 证据：Alpha 0.3 S2 的 Boss 刷点是地图 Room 创建的怪物，死亡后按
  `respawnMs`（3 分钟）在同一个 Room 内重生；进程重启会重新计时，多进程部署
  时每个进程的地图 Room 各自维护首领。
- 影响：单进程单区服下行为正确；重启后玩家可能遇到“刚打过的首领又满了”，
  多进程时同一张地图的多个实例会有多个首领。
- 建议：与 TD-SRV-11 一起在引入多进程/动态实例前设计共享世界状态（Redis 或
  数据库 + 租约）；当前不做。
- 工作量：M（与实例路由一起评估）。

### TD-CLI-19（P3）自动战斗只使用普通攻击

- 证据：`WorldMapRoom.startQuestAutoAttack` 只复用 `combat.basicAttack`；自动
  导航不会释放职业技能、喝药或切换目标策略（ADR-039）。
- 影响：法师/道士的长处在一键流程中体现较弱；玩家想用技能仍需手动接管。
- 建议：按职业与情境配置技能优先级与药水阈值，仍由服务端执行；先做试玩反馈
  与内容化配置，不引入脚本。
- 工作量：M。

### TD-CLI-18（P3）四方向移动，斜向目标走 L 线

- 证据：ADR-016 固定四方向网格移动；目标在斜向时 BFS 给出 L 形最短路径，玩家
  需要先沿一个轴走完再转向，观感上比八方向移动慢。
- 影响：这是移动模型的设计选择，不是寻路 bug；但试玩可能把它感知为“不是最短
  路径”。自动攻击与点击移动已不再回退到格中心。
- 建议：先按试玩反馈判断；若需要八方向，单独写 ADR 覆盖斜向阻挡、动画方向与
  客户端预测，不要局部放宽寻路。
- 工作量：M。

### TD-CLI-17（P3）队伍 UI 只有名单与离队

- 证据：Alpha 0.3 S1 的队伍面板只显示成员等级/HP/在线状态与「离队」；邀请仅
  限于附近玩家列表，没有按名字邀请、队长移交、踢人、队伍聊天，也没有成员在
  世界内的队伍标记。
- 影响：组队可用但不够“像 MMO”；4 人以上或临时队伍难以管理。
- 建议：按试玩反馈决定先后；队伍聊天需要频道扩展与限频策略，移交/踢人需要
  服务端权限校验，不能只做 UI。
- 工作量：S（移交/踢人）/ M（队伍聊天）。

## 4. 内容与运营

### TD-OPS-01（P1）CI 的 E2E job 无法启动

- 证据：`.github/workflows/ci.yml:69-94` e2e job 没有 PostgreSQL service、
  没有 `DATABASE_URL`/`CORS_ORIGINS`；`playwright.config.ts:62` 的 webServer
  会执行 `pnpm db:migrate && pnpm db:seed`，缺少连接串必然失败。
- 影响：浏览器门禁在 CI 中从未真正执行；合并请求只跑单测/类型/构建，回归
  依赖人工。阶段报告中的“20/20 E2E”是本地结果，不是 CI 结果。
- 建议：给 e2e job 加 postgres service 与 env（与 verify job 相同），或使用
  `infra/docker/compose.yml` 起库；把 E2E 设为合并门禁。
- 工作量：S（0.5 人日）。

### TD-OPS-02（P1）E2E 与开发栈共享数据库，隔离不完整

- 证据：阶段 9 只隔离了 Vitest 数据库；E2E 仍写开发库。本轮实测：在开发栈
  运行时用“独立端口”启动 E2E，kick 测试稳定失败（18/20），因为开发 Control
  API 与 E2E Control API 共用一个 outbox 表，开发进程抢走命令并投递给没有该
  会话的 87 端口；改用独立数据库后 20/20 通过。
- 影响：只要开发栈在跑，E2E 的运营类用例就会随机失败；测试结果不可复现；
  内容激活也会影响并行用例。
- 建议：E2E 默认使用专用数据库（或整套独立 compose），在
  `playwright.config.ts` 的 webServer 中建库/迁移/清理；文档写明“不要与开发
  栈共享库”。
- 工作量：S/M。

### TD-OPS-03（P2）发布/校验使用已保存草稿，而非编辑器内容

- 证据：`apps/admin-web/src/screens/ContentScreen.tsx:166-191`（publish）与
  `:303-325`（按钮）不读取编辑器 buffer；服务端 `services/content.ts:424-431`
  组装已保存草稿；切换 section 不提示未保存修改。
- 影响：运营改了数值但没点“保存草稿”就发布，线上使用旧值，UI 却显示新值；
  这是最容易造成“发布事故”的交互缺陷。
- 建议：脏标记 + 发布前自动保存/确认；切换 section 提示丢弃；发布页展示
  将要发布的 checksum 与差异。
- 工作量：M。

### TD-OPS-04（P2）草稿全局最后写入获胜，无冲突与历史

- 证据：`packages/persistence/src/repositories/content.ts:36-63` 按 section
  upsert；`services/content.ts:213-236` 审计记录 `before: null`。
- 影响：两个运营同时编辑会互相覆盖且不可恢复；无法回答“谁把数值改坏了”。
- 建议：草稿加 `updated_at/updated_by` 与乐观锁版本；审计写入变更 diff；
  按 Realm/用户分草稿。
- 工作量：M。

### TD-OPS-05（P2）Release 列表上限 100、无分页

- 证据：`apps/control-api/src/services/content.ts:416`；
  `ReleasesScreen.tsx:204-211`。
- 影响：超过 100 个 Release 后无法在后台选择更早版本回滚，违背“可回滚到上一
  版本”的运营承诺（上一版本仍可达，但更早的不行）。
- 建议：服务端分页或“最近 N + 搜索”。
- 工作量：S。

### TD-OPS-06（P2）内容操作隐式绑定第一个活跃区服

- 证据：`services/content.ts:89-95`（`listActiveRealms` 按 code 排序）被
  `state/publish/activate` 使用（`:127,292,365,414`）。
- 影响：多区服时后台可能对 A 区发布/激活，B 区 Game Server 永远看不到，UI
  却显示成功。
- 建议：所有内容接口显式接收 `realmId`，UI 提供区服选择；与 TD-SRV-07 一起做。
- 工作量：M。

### TD-OPS-07（P2）内容数值缺少经济合理性校验

- 证据：`packages/contracts/src/content.ts:151-165` 允许金币/经验 1e9、怪物
  HP 1,000 万、攻击 10 万；`validation.ts` 只校验结构与引用，不校验经济。
- 影响：一次误改就能发布无限金币或不可击杀怪物；只有人工差异预览兜底。
- 建议：按字段增加软上限与告警（例如单怪经验 ≤ 当前曲线 5 倍、金币 ≤ 1000），
  发布页突出异常；不要用硬编码阻断合法活动配置。
- 工作量：M。

### TD-OPS-08（P2）备份 manifest 与 dump 非同一快照，恢复校验不含 SHA-256

- 证据：`infra/scripts/db-backup.sh:29-38` 先 dump 后生成 manifest，无停写/
  快照；`db-restore-drill.sh` 恢复后只比 manifest，不校验 `.sha256`。
- 影响：写入流量下 manifest 可能描述更晚的状态，恢复演练会误报或掩盖损坏；
  SHA-256 目前只是文件存在。
- 建议：使用 `pg_dump --snapshot`/事务一致性导出；manifest 取自同一快照；
  恢复前校验 SHA-256 并在脚本失败。
- 工作量：S。

### TD-OPS-09（P2）回滚 runbook 环境变量不完整

- 证据：`infra/scripts/rollback.sh:30-35` 需要 compose 插值
  `POSTGRES_PASSWORD`/`INTERNAL_ADMIN_TOKEN`/`PUBLIC_ORIGINS`
  （`compose.prod.yml:19,44`），runbook §3.1 只导出 `IMAGE_TAG`。
- 影响：按文档执行回滚会在 compose 解析阶段失败，事故时不可用。
- 建议：runbook 与脚本同时校验并列出必需变量；提供 `.env.prod` 模板。
- 工作量：S。

### TD-OPS-10（P2）静态站点镜像以 root 运行

- 证据：`infra/docker/Dockerfile.game-web:18`、`Dockerfile.admin-web:18` 无
  `USER`；阶段 8 报告称四个镜像均 non-root，与实际不符。
- 影响：nginx master 以 root 运行，违反最小权限；安全审计不通过。
- 建议：`USER nginx`（需调整缓存/pid 路径）并验证容器健康检查。
- 工作量：S。

### TD-OPS-11（P3）提交文件把镜像站写成默认值

- 证据：`infra/docker/compose.prod.yml:16`、`db-backup.sh:10`、
  `db-restore-drill.sh:9` 默认 `docker.m.daocloud.io/...`；AGENTS §12 要求
  官方镜像为默认、镜像站只作覆盖。
- 影响：换到可访问 Docker Hub 的环境仍拉镜像站；供应链来源不透明。
- 建议：默认改回官方镜像，本环境通过 `.env` 覆盖。
- 工作量：S。

### TD-OPS-12（P3）部署脚本不自动迁移/备份

- 证据：`infra/scripts/deploy.sh` 只做 compose up 与健康检查；runbook 将
  `db:migrate` 与备份列为人工步骤。
- 影响：忘记迁移会用新代码打旧 schema；忘记备份会降低回滚能力。
- 建议：部署脚本增加迁移前置与自动备份开关；不可逆迁移需显式确认。
- 工作量：S。

### TD-OPS-13（P3）Outbox 失败告警对 gauge 使用 increase

- 证据：`infra/observability/alerts.yml:71-72` `increase(web_legend_outbox_commands...)`，
  而该指标是 gauge（`apps/control-api/src/metrics.ts:152-161`）。
- 影响：告警可能永不触发或在上报重置时误触发。
- 建议：改为 `web_legend_outbox_commands{status="failed"} > 0` 或持续时长条件。
- 工作量：S。

### TD-OPS-14（P3）后台会话无登录审计、无会话管理、无 MFA

- 证据：`services/adminAuth.ts:36-61`；`persistence/admin.ts:56-101`；
  `admin_sessions` 无清理任务。
- 影响：无法回答“谁在何时登录后台”，无法远程撤销单个会话；8 小时过期后
  只能重新登录。
- 建议：登录/失败登录写审计；会话列表与撤销；后续 OIDC/MFA。
- 工作量：M。

### TD-OPS-15（P3）16KB body 上限限制内容编辑

- 证据：`apps/control-api/src/server.ts:88`。
- 影响：items/lootTables 继续增长后草稿无法保存；当前刚好够用。
- 建议：内容接口单独提高上限（如 256KB）并保持其他接口 16KB。
- 工作量：S。

### TD-OPS-16（P3）审计 requestId 由客户端提供，失败审计尽力而为

- 证据：`server.ts:69-79`；`services/admin.ts:474-492`、
  `services/content.ts:486-504` 忽略审计插入错误。
- 影响：审计 trace 键不可信；数据库故障时“失败操作也有审计”不绝对。
- 建议：服务端生成 requestId；审计失败至少写日志并告警。
- 工作量：S。

### TD-OPS-17（P3）内部管理端点使用单一共享令牌

- 证据：`INTERNAL_ADMIN_TOKEN` 由 Control API 与 Game Server 共享；开发默认值
  固定。
- 影响：生产若误用默认值会暴露内部端点（env schema 已拒绝）；无令牌轮换、
  无来源 IP 限制。
- 建议：生产强制随机值（已有）、限制内网、后续 mTLS 或短期签名。
- 工作量：S/M。

### TD-OPS-18（P3）地图刷点与内容 Release 的部署耦合缺少预检

- 证据：S3 切片在编译地图新增 `alpha_wolf` 等刷点后，开发区服仍激活旧
  Release，`ContentStore` 每 5 秒报 “active content release failed
  validation”；校验把地图刷点与 Release 怪物表对齐（EL-021）。
- 影响：代码侧新增刷点若先于内容发布上线，服务器会退回基线 bundle 并持续
  报错，运营看到的激活版本与运行时不一致；目前只能靠日志发现。
- 建议：部署/发布脚本增加预检——候选 Release 的怪物表必须覆盖当前编译地图
  全部 `monsterId`，并在发布页提示；或让地图刷点也进入内容 Release。
- 工作量：S。

### TD-OPS-19（P3）新增内容 section 需手动扩展运营草稿契约

- 证据：S4-G 新增 `quests` 后，`CONTENT_SECTIONS`、数据 schema、数据库枚举与
  基线内容都已更新，但 `packages/contracts/src/admin.ts` 的
  `adminContentDraftUpdateSchema` 是手写的 `z.literal` 判别联合，保存草稿仍
  返回 422 “Invalid discriminator value”；补分支后才通过（EL-029）。
- 影响：新增 section 的完整性依赖开发者记住跨包清单；遗漏时类型检查可能通过，
  只在真实保存草稿时暴露，运营工作台也无法编辑新 section。
- 建议：由 `CONTENT_SECTIONS` 生成草稿联合类型（或至少加一条契约测试，断言
  每个 section 都有对应的草稿请求分支）；把该清单加入内容切片模板。
- 工作量：S。

## 5. 测试与流程

### TD-QA-01（P2）容量场景未纳入 CI/定期回归门禁

- 现状：本轮审计已完成 30+10 与 50+10 各 10 分钟实测
  （`docs/phase-reports/audit-2026-11-25/load-30p10a-10min.json`、
  `load-50p10a-10min.json`），DoD 的一次性容量证据已补齐；但容量测试仍是
  人工运行，CI 与发布流程没有门禁。
- 影响：tick、内存、带宽或拒绝率的退化只能靠人工发现；下一次大改后没有自动
  回归。
- 建议：把 10 分钟容量场景接入夜间/发布前检查，保留趋势数据与阈值断言。
- 工作量：S（脚本已有，接入 CI/发布流程）。

### TD-QA-02（P2）压测指标是 Room 生命周期累计值，拒绝率未断言

- 证据：`worldScenario` 读取 `/metrics` 的 Room 快照；30 人运行（10 名攻击者
  是 `LOAD_PLAYERS` 的子集，不是额外的 10 人）`rejectedCommands=11,041`
  （23%），拒绝码为 OUT_OF_RANGE/COOLDOWN/TARGET_DEAD，脚本只断言
  `accepted > 0` 与 tick 目标；阶段 8 报告的“30+10”同样按 30 人理解。
- 影响：数值可解释，但“容量通过”没有对拒绝率/延迟窗口设门禁；指标包含
  压测前的样本（samples=240 滑动窗口）；场景命名容易让读者把 attackers 当成
  额外玩家，高估在线人数。
- 建议：攻击者先移动到目标攻击范围；按窗口记录接受率并断言阈值（例如
  有效命令接受率 ≥ 80%）；输出拒绝码分布。
- 工作量：S/M。

### TD-QA-03（P2）集成测试使用固定 sleep

- 证据：`apps/game-server/test/combat.integration.test.ts:490`、
  `pvp.integration.test.ts:286,374`、`economy.integration.test.ts:215`。
- 影响：违反 AGENTS §8；CI 负载高时抖动。
- 建议：改为轮询可观察条件（事件/状态/数据库行）。
- 工作量：S。

### TD-QA-04（P2）E2E 内容发布与并行用例共享全局状态

- 证据：`tests/e2e/admin.spec.ts:160-247` 激活全局 Release，其他 spec 并行
  创建 Room。
- 影响：其他用例可能使用不同内容；当前只改显示名所以不显现。
- 建议：独立数据库 + 内容用例串行，或按 Realm 隔离。
- 工作量：S（随 TD-OPS-02）。

### TD-QA-05（P2）LAN Origin 用例在 CI 静默跳过

- 证据：`tests/e2e/multiplayer.spec.ts:488-492` 找不到非内网 IPv4 就跳过。
- 影响：CI 环境必然跳过，生产局域网路径没有持续验证。
- 建议：用 `/etc/hosts` 或 `hostname -I` 固定一个非内网地址；或在 CI 明确
  标记 known-skip 并单独任务。
- 工作量：S。

### TD-QA-06（P2）缺少 Game Server 进程重启的 E2E 与“提交中断”测试

- 证据：MVP 计划 §14.3 第 10 条要求进程重启后重新取票恢复；现有
  `drill:recovery` 是脚本级演练，不在 E2E；没有“事务提交后、ACK 前杀进程”
  的用例。
- 影响：崩溃窗口的资产一致性只靠设计与单测推理。
- 建议：E2E 增加杀进程→重启→重连；集成测试注入提交后 ACK 前失败。
- 工作量：M。

### TD-QA-07（P3）内容发布 E2E 有“空通过”分支

- 证据：`tests/e2e/admin.spec.ts:171-174` `expect(gel).toBeDefined()` 后
  `if (gel === undefined) return;`。
- 影响：若模板消失，用例会静默通过而不验证发布。
- 建议：改为断言存在并失败。
- 工作量：S。

### TD-QA-08（P3）无视觉回归/性能预算门禁

- 证据：E2E 只截图，无像素对比；构建无 bundle size/首屏预算。
- 影响：HUD 遮挡、对比度、资源膨胀只能人工发现。
- 建议：关键 HUD 做截图基线；设置 JS/资源体积预算。
- 工作量：M。

### TD-QA-09（P3）E2E 数据清理缺失

- 证据：E2E 每次创建账号/角色/测试 Realm/Release，长期留在开发库。
- 影响：开发库 2,600+ 角色、35 个 Release、9 个测试 Realm；查询与后台列表
  噪声大。
- 建议：E2E 使用独立库并整库销毁；开发库做一次性清理脚本。
- 工作量：S。

### TD-QA-11（P3）E2E 共享世界实体与 AI 状态

- 证据：S4-A 时 `classes.spec.ts` 的“战士普攻”等待 `wilds_slime_12` 进入
  `attack`，怪物可能循环 chase → return → patrol；S4-B 全量回归又暴露
  `economy.spec.ts` 与 `autoAttack.spec.ts` 共用 `wilds_slime_1`，先击杀的
  一方拿走奖励，另一方等不到掉落。
- 本轮缓解：economy 改用独占刷点 `wilds_slime_11`；classes 改为等待自身
  角色到达目标格后触发攻击并断言动画，不再依赖怪物 AI 状态。33 个 E2E
  连续通过。
- 影响：根因仍在——所有 spec 共享同一张地图与刷点，任何用例都可能被路过
  玩家引走目标；新增地图/刷点/传送门时还会改变寻路（EL-024）。
- 建议：为每个用例分配独占刷点并在注释中登记（已部分执行）；进一步可让
  E2E 按 Map/Room 实例隔离，或在测试运行时为每个用例生成独立刷点。
- S3-B 补充：一键自动战斗会主动选择最近的可见怪，无法遵守“独占刷点”约定；
  新增开发专用 `?freshTransfer=1`，让 `questGuidance.spec.ts` 的野区实例完全
  隔离。2 worker 全量仍出现 movement 平滑度、pvp 复活 HP 与 quests 共享刷点
  各一次抖动；单跑均通过，串行 `PLAYWRIGHT_WORKERS=1` 全量 44/44 通过。
- 工作量：S（逐用例）/ M（实例隔离）。

## 6. 已验证良好、不建议“重构”的部分

以下不是债务，避免后续为了“更现代”而重写：

- 票据单次消费、角色租约、钱包+账本同事务、物品唯一位置 CHECK、并发拾取
  唯一结算、Outbox `SKIP LOCKED` 与重试、审计/Release append-only 触发器，
  均有真实 PostgreSQL 集成测试。
- 固定 tick 内无数据库/HTTP/文件 IO；资产事务异步队列；tick p95 在 30+10
  负载下 3.6ms。
- `contracts` 单一消息 schema、Zod 校验、限频、命令幂等、服务端权威战斗、
  AOI StateView 与传送后视图清理。
- 模块依赖边界由 ESLint 强制；无 `any`、无 `console.*`、无跨端导入违规。
- 内容 Release 不可变、Room 创建时固定快照、旧 Room 不受激活影响。

## 7. 建议处理顺序（2026-11-25 更新）

1. **已完成 Alpha 0.1**：TD-OPS-01/02、TD-SRV-04、TD-DATA-04、TD-CLI-01/02、
   TD-SRV-01（第一阶段）、TD-QA-01/02，以及 TD-SRV-02、TD-DATA-01/02/03/06、
   TD-OPS-08（部分）。
2. **已完成 Alpha 0.2 S1**：TD-CLI-12、TD-QA-10；资产命令锁顺序死锁已修复。
3. **已完成 Alpha 0.2 S2**：法力回复、9 个技能/等级解锁、DoT/护盾、三职业外观
   与动作已交付（TD-CLI-06 关闭）。TD-DATA-05（装备槽可延迟唯一约束）按计划
   在 S4 装备扩展前处理；TD-SRV-03（资产单队列）与 TD-CLI-05（高频 React 扇出）
   在 S3/S4 前评估。
4. **Alpha 0.2 S3/S4**：怪物/掉落/背包扩展前处理 TD-DATA-09（堆叠装备与
   不可拾取掉落）、TD-DATA-05；HUD 重排时处理 TD-CLI-04/07/08/11。
5. **Alpha 0.3 玩法扩展前**：TD-SRV-06/07、TD-OPS-05/06/07、TD-QA-06、
   TD-OPS-03/04。
6. **Beta 运营化前**：TD-OPS-08/09/10/12/14、TD-QA-08/09。
7. 其余 P3 按触发条件（多区服、角色删除、移动端、内容规模）安排。
