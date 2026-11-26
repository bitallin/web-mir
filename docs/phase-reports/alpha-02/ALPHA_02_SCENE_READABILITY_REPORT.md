# Alpha 0.2 S4-E：世界场景信息可读性

- 日期：2026-11-26
- 触发：S4 剩余非美术工作「场景内地面掉落物图标」（TD-CLI-15）与「世界内名字
  标签重叠」（TD-CLI-16）
- 关联：`docs/ALPHA_02_EXECUTION_PLAN.md` S4 剩余工作、ADR-033（物品图标图集）

## 1. 问题与证据

1. 地面掉落仍是发光袋状几何标记 + 名称小字（`apps/game-web/src/game/LootVisual.ts`）。
   背包、装备槽、商店与右侧掉落列表已经使用 `item_icons.png`，但玩家在场景里
   看到战利品时只能读小字；同一件物品在两处呈现不同语言。
2. 世界内名字标签各自跟随实体，没有避让规则。S4-D 证据
   `docs/phase-reports/alpha-02/hud-relayout/dev-world-1280.png` 中，玩家站在
   杂货商旁时「Lv.1 <角色>」与「杂货商」重叠；多只怪物相邻时同样互相遮挡。

## 2. 改动

### 2.1 地面掉落使用物品图标

- `WorldScene.preload` 把 `content/assets/generated/item_icons.png` 注册为
  Phaser spritesheet（32px 帧，尺寸与列数来自 `assetManifest.itemIcons`）。
- `LootVisual` 不再画袋状几何体：暗色圆盘 + 当前模板的描边色 + 图集图标，
  名称与数量仍在圆盘上方。图标帧由 `itemIconFrame` 解析，和背包/商店共用
  同一回退规则（模板 → 类型 → 通用）。当前箱子只下发 `templateId`，没有新增
  协议字段。
- 新增测试钩子 `lootIconFrame(dropId)`，E2E 可以断言场景标记与 manifest 帧号
  一致，而不是只看“有东西发光”。

### 2.2 名字标签按优先级避让

- 新增纯函数模块 `apps/game-web/src/game/labelLayout.ts`：按屏幕空间矩形做
  贪心避让。优先级为 自己 1000 > 当前目标 900 > NPC 700 > 其他玩家 500 >
  怪物 400；同优先级按距自己更近者优先，再按 id 稳定排序。
- 只隐藏会与更高优先级标签相交（含 3px 间距）的标签，不移动标签位置，避免
  实体走动时标签在两个偏移之间跳动。
- 玩家与怪物死亡后名字隐藏；存活后由同一刷新周期恢复。NPC 标签保留原有位置
  与颜色，只在被更高优先级标签覆盖时让位。
- 场景每 100ms 刷新一次；选择/取消目标会立即触发一次刷新。纯函数有 6 个单元
  测试覆盖不重叠、优先级、距离、并列、间距与空输入。
- 新增测试钩子 `labels()`，返回所有世界标签的文本、可见性与矩形；E2E 用它
  断言“可见标签两两不重叠”，并验证玩家站到杂货商脚下时自己保留、NPC 让位。
- 沉淀 EL-027：世界层避让用纯布局函数 + 只读回读，只隐藏不移动。

## 3. 测试与证据

| 检查       | 命令/方式                   | 结果                                         |
| ---------- | --------------------------- | -------------------------------------------- |
| 格式       | `pnpm format:check`         | 通过                                         |
| Lint       | `pnpm lint`（改动文件）     | 通过（0 error / 0 warning）                  |
| 类型       | `pnpm typecheck`            | 通过（根 + 15 个 workspace）                 |
| 单元/集成  | `pnpm test`                 | 69 文件、**454 测试**通过（新增 6 条）       |
| 构建       | `pnpm build`                | 4 个应用成功                                 |
| 浏览器 E2E | `pnpm test:e2e`             | **38/38 通过**（4.1 分钟，2 worker，独立库） |
| 资产不变量 | `pnpm verify:invariants`    | 7 项全部 0 违例                              |
| 真实浏览器 | 开发栈 8584 + 真实 Chromium | 标签避让通过；击杀史莱姆后场景图标帧为 18    |

新增/修改的 E2E：

- `tests/e2e/hud.spec.ts`：角色站到杂货商所在格下方，断言自己标签可见、
  杂货商标签隐藏、两者矩形确实相交、所有可见标签互不重叠；截图
  `scene-readable/name-plates.png`。
- `tests/e2e/economy.spec.ts`：击杀史莱姆后从 manifest 读取 `slime_gel` 的帧号，
  断言场景掉落标记使用同一帧；截图 `scene-readable/loot-ground-icon.png`。

开发栈证据：

- `docs/phase-reports/alpha-02/scene-readable/dev-name-plates.png`
- `docs/phase-reports/alpha-02/scene-readable/dev-loot-icon.png`
- `docs/phase-reports/alpha-02/scene-readable/invariants.txt`

## 4. 遇到的问题

1. **多玩家可见性时序断言偶发超时**：首次全量 E2E 中
   `multiplayer.spec.ts` 的“两账号 250ms 内互相可见”得到 337ms，单跑得到
   262ms；同一用例 `--repeat-each=3` 3/3 通过，随后全量重跑 38/38。该断言与
   软件渲染帧率（约 22–27 FPS）相关，属于已知的 250ms 时序抖动，不是本切片
   引入的回归；本轮未降低断言阈值。
2. **手工验证留下一条过期掉落**：8584 验证击杀后未拾取，`verify:invariants`
   报 `stale_expired_open_ground=1`。按此前约定重启开发栈（无在线 Room），
   启动清理后 7 项全部为 0。

## 5. 未验证 / 后续

- 未做真实玩家手感访谈；8584 只做了自动化浏览器交互与截图验证。
- 名字避让只处理玩家/怪物/NPC，未把传送门与地面掉落文字纳入同一布局；当前
  传送门位于地图边缘，未观察到与实体标签冲突。
- 正式美术（TD-CLI-13）仍开放：图标与角色/怪物/地形仍是程序生成占位资源。
- 本切片只改客户端展示，不涉及服务端、协议、内容、数据库或资产写路径，未复跑
  50 人容量回归。
