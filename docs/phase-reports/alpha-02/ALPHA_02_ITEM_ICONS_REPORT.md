# Alpha 0.2 S4 切片：物品图标与品质呈现

- 日期：2026-11-26
- 范围：`docs/ALPHA_02_EXECUTION_PLAN.md` §4（S4 图标与美术）
- ADR：`docs/ADR/ADR-033-item-icon-atlas-and-quality-presentation.md`
- 证据：`docs/phase-reports/alpha-02/icons/`
- 内容 Release：无变化（仍为 `2026.11.26.6`）
- 资源 manifest：`alpha0.2.2`（新增 `itemIcons`，三张地图已重编译）

## 1. 目标

让玩家在背包、装备槽、商店与“附近掉落”里一眼认出手里的东西，并让品质差异
在所有物品界面一致可见。正式美术尚未到位，本轮交付可复现的程序化占位图集与
可替换的资源管线，而不是临时拼凑的图标。

## 2. 交付内容

### 2.1 契约

- `AssetManifest` 新增必填 `itemIcons`：图集文件、格子尺寸、行列、模板 → 帧、
  四种物品类型的回退帧与通用回退帧；帧号必须落在格子范围内。
- `itemIcons.style = 'procedural-placeholder'` 明确标记占位资源。
- `ShopOffer.quality?: 'common' | 'rare'`（可选，缺省 `common`），服务端从内容
  快照读取。历史内容与旧客户端行为不变。

### 2.2 资源与生成

- `content/assets/raster.ts`：从角色生成器抽出的像素画布与 PNG 编码，角色三张
  贴图重新生成后逐字节不变。
- `content/assets/generateItemIcons.ts`：37 件基线物品的独立造型与配色，覆盖
  剑/斧/法杖/护甲/药水/凝胶/毛皮/蛛腿/核心/晶体/骨片，另含四种类型回退与通用
  回退；生成 `generated/item_icons.png`（256×192，8×6 格）。
- 生成器从 `BASE_CONTENT_BUNDLE` 校验覆盖率：新增内容若没有图标条目直接失败；
  manifest 映射与生成结果不一致时打印期望 JSON 并退出非零。
- `pnpm assets:generate` 现在同时生成角色与物品图标。

### 2.3 客户端

- 新增 `apps/game-web/src/lib/itemIcons.ts`：纯函数解析模板/类型/通用帧并计算
  CSS 图集定位；`apps/game-web/src/screens/GameScreen.tsx` 的 `ItemIcon`
  组件统一渲染。
- 背包物品卡、装备槽、商店购买与出售列表、附近掉落列表均显示图标；装备槽与
  商店行补上品质数据属性与“稀有”标签，与背包共用金色描边。
- 背包头部改为“图标 + 名称 + 数量”一行；商店行改为“图标 + 文本块”，价格与
  按钮列不变。

### 2.4 服务端

- 商店目录按内容下发可选 `quality`；价格、可售性与最终结算仍完全由服务端
  `AssetService` 决定（ADR-026）。

## 3. 测试与证据

| 检查       | 命令/方式                     | 结果                                       |
| ---------- | ----------------------------- | ------------------------------------------ |
| 格式/lint  | `pnpm format:check`、`lint`   | 通过（0 error / 0 warning）                |
| 类型       | `pnpm typecheck`              | 通过（根 + 15 个 workspace）               |
| 单元/集成  | `pnpm test`                   | 68 文件、**448 测试**通过（新增 9 条）     |
| 构建       | `pnpm build`                  | 4 个应用成功                               |
| 浏览器 E2E | `pnpm test:e2e`               | **34/34 通过**（4.0 分钟，2 worker）       |
| 图标 E2E   | `tests/e2e/itemIcons.spec.ts` | 背包 3 项、装备槽、商店 9 项、出售行图标   |
| 掉落图标   | `tests/e2e/economy.spec.ts`   | 掉落行渲染同一图标组件                     |
| 开发栈实测 | 84 端口 + 真实 Chromium       | 背包 3/3、商店 9/9 均有图标（帧 35/19/20） |

证据：

- `docs/phase-reports/alpha-02/icons/bag-icons.png`（E2E 背包）
- `docs/phase-reports/alpha-02/icons/equipped-icons.png`（装备槽）
- `docs/phase-reports/alpha-02/icons/shop-icons.png`、`sell-icons.png`
- `docs/phase-reports/alpha-02/icons/dev-bag.png`、`dev-shop.png`（8584 实测）

## 4. 问题与处理

1. **Playwright 无法直接 `import` JSON。** 新 E2E 直接导入 manifest 时，全量
   E2E 在加载测试阶段报 `needs an import attribute of "type: json"`。改为用
   `readFileSync` + `JSON.parse` 读取，测试仍按数据使用。已沉淀 EL-025。
2. **全量 E2E 一次偶发失败。** `combat.spec.ts` 点击怪物后未出现目标面板；
   单独重跑通过，第二次全量 34/34 通过。与 TD-QA-11（共享世界实体与移动时机）
   一致，本轮未扩大处理范围。
3. **全量 E2E 重写历史截图。** 按既有做法用 `git stash` 收起产物变更，仅保留
   本切片新增的 `icons/` 证据。

## 5. 未验证项

- 稀有物品在真实浏览器中的金色描边与“稀有”标签：E2E 无法稳定获得稀有掉落，
  商店也无稀有商品；与 S4-A 的已知缺口相同，仅有单元测试与 CSS 覆盖。
- Phaser 场景中的地面掉落标记仍是几何图形；本轮只让 HUD 掉落列表显示图标。
- 开发栈未重启：验证时有玩家在线；18:10 确认无人在线后尝试停止进程组，被环境
  权限拦截。服务端唯一改动是商店目录新增可选品质字段，现有商店无稀有商品，
  旧服务端下客户端按 `common` 展示；资源与客户端改动由 Vite 热更新生效。需用户
  授权后重启到最新后端。

## 6. 下一步

1. 用户授权后重启开发栈，加载服务端品质字段；8584 试玩新图标与商店。
2. S4 剩余：HUD 完整重排与商店面板停靠（TD-CLI-14）、正式 tileset/角色/怪物
   与图标美术（TD-CLI-13）；地面掉落物图标。
3. 性能：为 50 人回归的 tick p95 14.75ms 做一次剖析。
4. 确认远端 CI。
