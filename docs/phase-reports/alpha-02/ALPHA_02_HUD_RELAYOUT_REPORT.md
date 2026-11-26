# Alpha 0.2 S4-D：HUD 信息层级重排

- 日期：2026-11-26
- 触发：S4 剩余工作「HUD 完整重排」；玩家每次进入世界都会被左下聊天面板、
  左上品牌块与居中的商店面板占用战斗视野
- 关联：`docs/PROJECT_ROADMAP.md` S4、TD-CLI-09、TD-CLI-14、
  `docs/phase-reports/alpha-02/ALPHA_02_HUD_LAYOUT_FIX.md`

## 1. 问题与证据

改版前的 1280×720 世界画面（`docs/phase-reports/alpha-02/hud/world-1280x720.png`）：

1. 左上角常驻「浏览器原生 · 实时多人 / Web Legend」品牌块，占约 340×150px，
   游戏过程中没有任何信息价值；HP/经验/金币直接压在半透明背景上，野外怪物
   名字会从数字下面穿过，最低可读性不达标。
2. 左下 340×260 的聊天面板无法收起；即使只有一条系统消息也占住整块区域。
3. 商店面板居中（560px、`z-index: 4`），打开后盖住顶部「背包 / 角色 / 音效」
   开关，交易后查看装备必须先关商店（TD-CLI-14，S4-A 的 E2E 已被迫绕行）。
4. 右侧栏从 208px 才开始，720p 下「战斗信息」只剩约 90px，目标、掉落与战斗
   记录都被压到滚动区里。
5. ≤860px 时聊天面板被 `display: none` 直接隐藏，唯一的社交入口消失
   （TD-CLI-09）。

## 2. 改动

### 2.1 左上角：品牌块改为角色状态板

- 移除世界内的品牌标题与眉标；改为 364px 宽的不透明 `player-card`，包含：
  角色名 / 职业与等级 / PvP 状态、HP 与法力（分色）、经验条与金币、操作按钮。
- 所有既有 `data-testid`（`vitals`、`exp-bar`、`gold`、`inventory-toggle`、
  `character-toggle`、`shop-toggle`、`sfx-toggle`、`pvp-mode`）保留；`vitals`
  文本仍是 `HP x/y` 与 `法力 x/y`，mana/combat 用例的正则不需要修改。
- 「返回角色」从连接卡片移入状态板按钮行：它是玩家操作，不是连接信息；同时
  避免连接卡片在断线时变高后被右栏遮住（见 §4）。
- 连接卡片改为紧凑布局：连接成功时不再显示重复的 detail 行；断线/失败时
  仍显示原因与「重新加入」。

### 2.2 聊天：可收起，窄屏保留入口

- 标题栏新增「收起 / 展开」按钮（`chat-toggle`，`aria-expanded` 同步）；
  收起后只保留标题行，输入框与消息列表隐藏。
- ≤860px 不再 `display: none`，改为停靠在技能坞上方（左上 12px、
  `bottom: 176px`、最大高 180px），仍可继续收起（TD-CLI-09）。

### 2.3 商店：右侧停靠

- `shop-panel` 从居中改为右栏停靠（`top: 132px; right: 40px; bottom: 84px;
width: 360px`），顶部开关、左下聊天与底部技能坞全部保持可点。
- 背包仍与商店互斥；现在打开背包会直接替换商店，不需要先关闭（TD-CLI-14）。
- 列表区域 `min-height: 0` + 内部滚动，底部交易说明固定。

### 2.4 右栏与整体可读性

- 右栏起点从 208px 提到 132px（≤1180px 为 144px），720p 下战斗信息从约
  90px 增加到约 180px；「附近玩家」上限从 72% 提到 76%，列表最后一行不再被
  裁切。
- 面板底色 `--ink-raised` 从 0.82 提到 0.9，配合状态板的不透明背景，保证
  世界文字不会穿过常驻数字。

## 3. 测试与证据

| 检查       | 命令/方式                          | 结果                                    |
| ---------- | ---------------------------------- | --------------------------------------- |
| 格式       | `pnpm format:check`                | 通过                                    |
| Lint       | `pnpm lint`                        | 通过（0 error / 0 warning）             |
| 类型       | `pnpm typecheck`                   | 通过（根 + 15 个 workspace）            |
| 单元/集成  | `pnpm test`                        | 68 文件、**448 测试**通过               |
| 构建       | `pnpm build`                       | 4 个应用成功                            |
| 浏览器 E2E | `pnpm test:e2e`                    | **37/37 通过**（3.9 分钟，独立库/端口） |
| 真实浏览器 | 开发栈 8584 + 真实 Chromium        | 1280×720、1600×1000、收起态与商店态正常 |
| 窄屏抽查   | 8584、800×720（不在 MVP 验收范围） | 状态板、聊天、技能坞不互相覆盖          |

新增 `tests/e2e/hud.spec.ts`：

1. 状态板尺寸与位置：宽 ≤380、高 ≤200，且不越过画面中线；HP / 法力 / 经验
   与背包按钮可见。
2. 聊天收起后消息列表与输入框隐藏，再次展开恢复。
3. 商店面板位于画面右半区、不与「背包」按钮重叠；打开背包后商店隐藏、
   背包可见。

`tests/e2e/equipment.spec.ts` 改为在商店打开时直接点「背包」并断言商店消失，
把 TD-CLI-14 的修复变成回归门禁。

证据：

- `docs/phase-reports/alpha-02/hud-relayout/dev-world-1280.png`
- `docs/phase-reports/alpha-02/hud-relayout/dev-world-1600.png`
- `docs/phase-reports/alpha-02/hud-relayout/dev-shop-docked.png`
- `docs/phase-reports/alpha-02/hud-relayout/dev-chat-collapsed.png`
- `docs/phase-reports/alpha-02/hud-relayout/dev-wilds-loot.png`
- `docs/phase-reports/alpha-02/hud-relayout/status-plate.png`（E2E）
- `docs/phase-reports/alpha-02/hud-relayout/chat-collapsed.png`（E2E）
- `docs/phase-reports/alpha-02/hud-relayout/shop-docked.png`（E2E）
- `docs/phase-reports/alpha-02/hud-relayout/shop-to-bag.png`（E2E）

## 4. 回归中发现的问题

首次全量 E2E 中 `shop.spec.ts` 超时 180 秒：测试在离开世界后点击「返回角色」，
但按钮始终没有生效。用 `elementFromPoint` 实测确认，断线状态下连接卡片会从
约 90px 增高到 124px（detail 行 + 第二行 meta），底部越过了右栏起点 112px，
「返回角色」按钮中心命中的是 `minimap-heading`——右栏面板在 DOM 中靠后，
盖住了按钮，Playwright 一直判定元素不可点。

修复不是简单加 `z-index`：把「返回角色」移到角色状态板（语义更合理），连接
卡片宽度从 272 改为 300 让 meta 不换行，右栏起点重新按连接卡片最大高度
（102px，底部 122px）设为 132px。修复后用同样的 `elementFromPoint` 检查，
按钮中心命中自身；`shop.spec.ts` 恢复通过，全量 37/37。沉淀 EL-026。

## 5. 未验证 / 后续

- 未做真实玩家手感访谈；8584 只做了自动化浏览器截图与交互验证。
- ≤860px 只做了一次 800×720 截图抽查，没有 E2E 覆盖；移动端仍不在 MVP 验收
  范围。
- 正式美术（TD-CLI-13）、场景内地面掉落物图标（TD-CLI-15）仍开放；世界内
  角色/怪物名字重叠属于 Phaser 标签层，未在本切片处理。
- 本切片只改客户端展示与布局，没有改服务端、协议、内容、数据库或资产路径，
  因此未复跑 50 人容量回归。
