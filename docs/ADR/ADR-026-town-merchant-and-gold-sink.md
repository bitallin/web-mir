# ADR-026：主城杂货商、物品价格内容化与金币消耗端

- 状态：Accepted
- 日期：2026-11-25
- 阶段：Alpha 0.2 切片 1
- 关联：ADR-008（内容发布）、ADR-020（资产事务）、ADR-022（内容工作台与
  Release）、ADR-025（命令管线）；`docs/TECHNICAL_DEBT.md`（TD-DATA-05、
  TD-SRV-03、TD-OPS-03/07）

## 1. 背景

Alpha 0.1 后，游戏缺少稳定的金币消耗端：金币只能通过击杀获得，没有购买、
修理、交易或回收途径。结果是：

- 玩家没有“回城补给/升级装备”的决策；
- 材料与多余装备没有价值；
- 30 分钟体验闭环在“拾取→装备”后中断。

同时，主城 NPC 只是客户端标记，服务端没有 NPC 交互概念，无法支撑后续任务/
商店/修理。需要一个可复用的最小交互模型。

## 2. 决策

### 2.1 物品价格属于内容

在 `ItemContent` 增加可选字段：

- `buyPrice`：商人出售单价；0 或缺省表示商人不出售该物品；
- `sellPrice`：商人收购单价；0 或缺省表示商人不收购。

不使用 Zod `.default(0)`。原因：历史 Content Release 的 payload 不含该字段，
解析时补默认值会改变 canonical JSON 与 checksum，导致 `ContentStore` 拒绝
已发布 Release（见 `docs/ENGINEERING_LEARNINGS.md` EL-004）。代码用
`item.buyPrice ?? 0` 解读缺省值。

新增价格的 Release 需要运营显式发布并激活；未更新的 Release 仍可运行，只是
商店没有商品。这是可接受的向后兼容行为。

价格由服务端读取 Room 固定的 Content Release；客户端永远不提交价格。

初始职业武器不设 `sellPrice`（视为绑定）：否则新玩家卖掉唯一武器后没有任何
获取途径，形成不可恢复的新手陷阱。未来加入武器掉落或交易时，再引入真正的
绑定/装备后绑定规则。

### 2.2 商店复用资产事务，不新增表

购买与出售使用现有 `wallets`、`currency_ledger`、`asset_commands`、
`item_instances`：

- `shop_buy` / `shop_sell` 作为新的 `AssetCommandKind`；
- 幂等键沿用 `cmd:<characterId>:<kind>:<commandId>`；
- 金币变化与物品变化在同一事务；
- 购买使用条件更新（`balance >= cost`）扣款，失败即 `INSUFFICIENT_GOLD`；
- 出售锁定物品行与角色行，校验归属后再删除/扣减；
- 账本写入 `shop_purchase` / `shop_sale`，并带 `referenceId`（商人/模板或
  物品实例）以便审计。

不新建 `shop_purchases` 表：当前没有订单、退货或限购需求，`asset_commands`
与账本已满足幂等与审计。出现真实订单需求时再写 ADR。

### 2.3 NPC 交互由编译地图声明，服务端校验距离

`MapNpcPoint` 增加可选 `role: 'merchant' | 'guard'`。Tiled 对象属性 `role`
由 `pnpm maps:compile` 写入编译产物；`starter_town` 的杂货商标记为
`merchant`。

服务端在收到 `shop.buy` / `shop.sell` 时：

1. 读取本图编译产物中的 `role === 'merchant'` NPC；
2. 计算玩家与最近商人的格子距离；
3. 超过 3 格返回 `SHOP_UNAVAILABLE`。

客户端可以用同一份编译产物做入口提示，但服务端不信任客户端的位置或 NPC。

### 2.4 商店目录通过私有实时消息下发

新增 Server → Client `shop.catalog`，在加入世界后（与私有资产快照同一批）
下发：

- 本图商人 id/名称/位置；
- 可购商品：模板、名称、类型、价格、等级需求、属性/回复；
- 收购价表：所有 `sellPrice > 0` 的模板。

商品列表按玩家职业过滤：无职业限制或 `classId` 与玩家一致。等级不足仍可
购买（与多数 MMORPG 一致），但装备时由既有 `canEquip` 拒绝。

目录只包含展示所需的最小字段，不包含完整内容 bundle，避免把运营配置整体
暴露给客户端。

### 2.5 新角色启动资金

新角色创建时在同一事务写入 50 金币钱包与一条 `starter_gold` 账本记录。
目的：让玩家在第一次回城时就能参与经济，而不是必须先刷怪 10 分钟。

启动资金是产品数值，不是客户端可请求的奖励；数量由服务端常量决定。

### 2.6 协议与错误码

新增 Client → Server：

- `shop.buy { protocolVersion, commandId, clientSequence, merchantId, templateId, quantity }`
- `shop.sell { protocolVersion, commandId, clientSequence, merchantId, itemId, quantity }`

新增拒绝码：

| 码                  | 含义                         |
| ------------------- | ---------------------------- |
| `SHOP_UNAVAILABLE`  | 附近没有可交互的商人         |
| `INSUFFICIENT_GOLD` | 金币不足                     |
| `CANNOT_SELL`       | 该物品商人不收购             |
| `NOT_SOLD_HERE`     | 商人不出售该物品或职业不兼容 |

数量 1–99；非堆叠物品必须为 1；堆叠物品不得超过模板 `maxStack`。

## 3. 备选方案

| 方案                            | 未采用原因                                         |
| ------------------------------- | -------------------------------------------------- |
| 新建 shop / orders / stock 表   | 当前无库存、订单、退货需求；增加迁移与并发面       |
| 价格写死在代码或客户端          | 违反内容与代码分离，运营无法调价                   |
| 客户端提交价格并由服务端校验    | 无必要暴露可伪造字段；服务端直接按内容计价更简单   |
| 按 NPC 定义独立商店 section     | 需要新增内容 section、校验、工作台与 checksum 结构 |
| 用 `.default(0)` 兼容旧 Release | 改变历史 Release checksum，导致已发布内容被拒绝    |

## 4. 影响

- 正面：金币有了消耗端；材料与多余装备有了价值；NPC 交互模型可复用于任务/
  修理；价格可由运营发布。
- 负面/限制：价格是全局物品属性，暂不支持按商人差异定价；商店没有库存与
  限购；旧 Release 需要重新发布才能启用商店。
- 风险：金币与物品必须同事务；钱包条件更新与 CHECK 约束防止负数；背包满时
  整体回滚。所有路径必须有真实 PostgreSQL 集成测试。
- 后续：交易/拍卖复用账本与幂等模式；按商人定价或限购时再评估 `shops`
  section 与订单表。

## 5. 验收

- 购买/出售在真实浏览器完成，金币、背包、账本三者一致。
- 重复 `commandId` 不重复扣款/发货。
- 并发购买不出现负余额或超发。
- 远离商人、金币不足、背包满、不可售物品均被服务端拒绝且不产生副作用。
- 历史 Release 的 checksum 校验不受新字段影响。
