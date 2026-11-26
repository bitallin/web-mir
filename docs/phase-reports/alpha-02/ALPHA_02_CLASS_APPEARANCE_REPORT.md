# Alpha 0.2 S2 任务 3：三职业外观与动作

- 日期：2026-11-26
- 范围：S2 收尾（TD-CLI-06）；三职业独立贴图与待机/行走/攻击/施法/受击/死亡
  片段
- 关联：`docs/ADR/ADR-029-character-animation-clips.md`、
  `docs/ALPHA_02_EXECUTION_PLAN.md` §4、`docs/PROJECT_STATUS.md`

## 1. 目标

让“三个职业玩起来不同”在画面上成立，而不只是技能数值不同：

- 战士、法师、道士各有可区分的剪影与配色；
- 行走有步频，攻击/施法/受击/死亡由服务端战斗事件驱动；
- 资源描述留在内容层，正式美术替换时不改客户端代码。

## 2. 实际改动

### 2.1 资源

- 新增 `content/assets/generateCharacters.ts`（`pnpm assets:generate`）：零依赖
  生成 3 张 32×48、10 列 × 4 行的职业占位图；同一输入逐字节复现。
  - 战士：钢盔、赤色甲、单手剑；法师：尖顶帽、靛蓝法袍、法杖；道士：发髻、
    玉色道袍、符纸。
  - 每方向 10 帧：待机 1、行走 2、攻击 2、施法 2、受击 1、死亡 2。
- `content/assets/manifest.json` 增加三职业条目与 `animations` 片段表；
  版本 `phase3.1 → alpha0.2.1`；重新编译地图（checksum 更新）。
- `player_placeholder` 保留为未知职业/旧资源的回退贴图。

### 2.2 契约

- `assetCharacterSchema` 增加可选 `animations`：片段名 → 列索引 + 帧时长 +
  是否循环；校验帧索引不越界、片段内不重复。
- 新增 `characterClipSchema`、`characterAnimationSchema`、
  `characterAnimationsSchema` 及类型导出；旧 manifest 仍合法。

### 2.3 客户端

- `mapCatalog` 加载三职业贴图，未知职业回退占位图。
- `PlayerVisual` 按 `PlayerView.classId` 选择贴图；新增动画状态机：
  - `resolveClip`：死亡 > 一次性片段 > 行走 > 待机；
  - `frameIndexFor`：循环取模、一次性片段停在末帧；
  - 攻击事件带 `skillId` 播放施法片段，否则播放攻击片段；受击播放受击片段；
    死亡/复活切换并复位。
- 帧命名统一为 `${direction}:${frame}`；占位图与职业图共用。
- 占位图仍按 `colorIndex` 着色以便区分同职业玩家；职业贴图不再叠加随机色。
- 仅开发环境新增 `selfAppearance()` / `selfId()` 诊断钩子，供 E2E 断言贴图与
  片段。

## 3. 测试与证据

命令均在 Node 26.13.1 下执行。

| 检查       | 命令/方式                   | 结果                                         |
| ---------- | --------------------------- | -------------------------------------------- |
| 格式       | `pnpm format:check`         | 通过                                         |
| Lint       | `pnpm lint`                 | 通过（0 error / 0 warning）                  |
| 类型       | `pnpm typecheck`            | 通过（根 + 15 个 workspace）                 |
| 单元/集成  | `pnpm test`                 | 65 文件、**399 测试**通过（约 29.9s）        |
| 构建       | `pnpm build`                | 4 个应用成功                                 |
| 浏览器 E2E | `pnpm test:e2e`             | **30/30 通过**（3.4 分钟，2 worker，独立库） |
| 外观 E2E   | `tests/e2e/classes.spec.ts` | 三职业贴图/行走、战士普攻、道士施法 5/5 通过 |
| 资产不变量 | `pnpm verify:invariants`    | 7 项全部 0 违例                              |

证据：

- `docs/phase-reports/alpha-02/classes/warrior.png`、`mage.png`、`taoist.png`
  （三职业待机，含 HUD）
- `docs/phase-reports/alpha-02/classes/warrior-attack.png`（战士普攻片段）
- `docs/phase-reports/alpha-02/classes/taoist-cast.png`（道士施法片段）
- `apps/game-web/src/game/playerAnimation.test.ts`（7 个纯函数测试）
- `packages/contracts/src/mapRuntime.test.ts`（3 个 manifest 测试）
- `tests/e2e/classes.spec.ts`（5 个浏览器用例）
- `docs/phase-reports/alpha-02/invariants-s2-classes.txt`（7 项资产不变量）

## 4. 开发中发现并修复的问题

1. **E2E 共享刷点导致并行假失败。** 新用例最初攻击 `wilds_slime_10`，与
   `skills.spec.ts` 相同；2 worker 并行时两边争抢同一只史莱姆，技能用例看到
   状态在 chase/return 之间摆动。改为独占 `wilds_slime_12` 后 30/30 通过。
   → 新增 EL-019（共享世界实体的测试隔离）。
2. **角色名 12 字符上限。** 用职业名生成前缀（`Warrior` + 6 位 token）超过上限，
   创建后名字被截断，定位角色卡失败。改用短前缀（`Warr`/`Mage`/`Taoi`）。
3. **战斗截图被 HUD 遮挡。** 战斗面板在野外更高，正好盖住摄像机抬升后的玩家
   位置；E2E 在截图前隐藏 HUD，只保留画布层，动作证据更清楚。

## 5. 未完成 / 未验证

- 三套外观仍是程序生成的占位美术（明确标注 `procedural-placeholder`）；正式
  tileset、角色/怪物美术、动画帧仍属 S4。
- 开发库原有 1 条 09:12 过期的 `slime_gel` 掉落（上一轮试玩遗留）。本轮通过
  `AssetService.purgeExpiredDrops`（与 Game Server 启动清理相同的应用路径）
  清理，随后 `stale_expired_open_ground=0`。
- 未做 8584 人工试玩（外观/动作需真实浏览器目视确认；E2E 已覆盖贴图与片段
  切换）。
- 远端 CI 未执行（本环境不能推送）。
- 未复跑 50 人容量回归：本切片无服务端、协议或数据库路径变化；动画状态机为
  客户端每帧少量整数运算，不由服务端负载脚本覆盖。

## 6. 复盘

- 判断正确：先把“片段表”放进资源 manifest，再写客户端状态机；用纯函数解析
  片段与帧，单测覆盖循环/一次性/死亡优先级，E2E 只断言可观察结果。
- 不够好：第一次让两个 E2E 用例共享同一只怪，暴露了测试隔离意识不足；共享
  世界实体应像共享数据库一样默认独占。截图证据也应从“整页”改为“画布层”，
  否则 HUD 会把真正的表现盖住。
- 下一步：8584 目视三职业与动作；随后进入 S3（怪物威胁与死亡代价）；正式
  美术与 S4 一起替换。
