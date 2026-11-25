# ADR-020: 阶段 5 资产模型与事务化经济

- 状态：Accepted
- 日期：2026-11-25
- 关联：MVP 计划阶段 5、架构文档 7.3 / 10.1–10.5、ADR-004、ADR-005、ADR-009、ADR-010、ADR-013、ADR-019

## 背景

阶段 4 已经产生服务端权威的怪物死亡事件，但没有经验、金币、掉落、背包或装备。
阶段 5 必须交付“击杀 → 掉落 → 拾取 → 穿戴 → 成长 → 重登恢复”的真实闭环，并
满足以下既有约束：

- 客户端只提交意图，奖励、概率、余额和属性由服务端计算；
- 一次资产操作必须在同一个 PostgreSQL 事务中完成；
- 固定 tick 不得等待 SQL；
- 事务提交成功后才能向玩家确认结果；
- 背包等私有数据不得进入公开 Room State；
- 物品实例必须有唯一归属，不能同时存在于地面和背包；
- 金币余额与流水必须同事务更新。

同时，ADR-013 约定 `game-application` 在出现真实事务用例时创建。阶段 5 是它的
第一个消费者。

## 决策

1. **创建 `@web-legend/game-application`。** 它依赖 `contracts`、`game-domain`
   与 `persistence`（以及 `drizzle-orm` 的查询构造器），承载事务用例：
   击杀奖励、拾取、装备、卸下、使用消耗品。它不导入 Colyseus、Fastify、Pino、
   Phaser、simulation、map-runtime 或任何 app。ESLint 新增该边界。
2. **单一位置物品模型。** `item_instances` 一行就是一个物品实例，
   `container` 是唯一位置事实：
   - `inventory`：`character_id` + `slot_index` 必填；
   - `equipment`：`character_id` + `equip_slot` 必填；
   - `ground`：三个定位字段全部为空。
     PostgreSQL CHECK 约束保证三种形态互斥，因此同一实例不可能同时在地面和背包。
     背包格子使用部分唯一索引；装备槽唯一性由角色行锁保证——交换两件装备必然经过
     “两件都在同一槽”的瞬时状态，立即唯一索引会拒绝合法的 swap（见第 7 条）。
3. **地面掉落持久化。** `world_drops` 记录地图、坐标、物品实例、归属者和过期时间。
   `item_instance_id` 唯一，确保一个实例只对应一个掉落。掉落生成时：
   - 击杀者获得 30 秒优先拾取权；
   - 120 秒后从 Room 状态移除；
   - Room 创建时从数据库恢复未领取且未过期的本图掉落。
     未领取且已过期的数据库行/地面实例不会被玩家再次看到，其清理属于阶段 8 的
     维护任务，不在 tick 内执行。
4. **钱包与账本。** `wallets` 保存金币余额，`currency_ledger` 追加记录
   `delta`、`balance_after`、原因、奖励引用与唯一幂等键。所有金币变化在同一事务
   内更新钱包并插入流水；账本幂等键唯一约束防止重复发奖。
5. **命令幂等。** 所有资产命令（击杀奖励、拾取、装备、卸下、使用）携带服务端可
   验证的幂等键：
   - 客户端命令使用 `cmd:<kind>:<commandId>`；
   - 击杀奖励使用 `kill:<serverId>:<roomId>:<monsterId>:<sequence>`；
   - 金币流水额外使用 `kill:<reference>:gold`。
     `asset_commands.idempotency_key` 唯一索引是最终仲裁者：事务提交过的命令不会
     二次执行；事务回滚会同时回滚幂等行，允许重试。
6. **击杀奖励与 tick 隔离。** Room 在领域死亡事件中只把奖励任务加入进程内异步
   队列；`step()` 不等待数据库。队列串行执行同一 Room 的资产事务，失败按退避
   重试 3 次，仍失败则记录错误并计入指标。只有事务提交后才：
   - 增加经验、金币并写入地面物品实例/掉落；
   - 计算升级（可跨多级），升级时按新等级基础属性回满 HP/MP；
   - 向击杀者发送私有 `character.progress` / `character.levelUp`；
   - 把掉落加入公开 AOI 状态。
     重复的击杀引用返回 `null`，不重复发奖。
7. **装备与属性。** 装备槽为 `weapon` 与 `armor`；职业/等级限制在
   `game-domain.canEquip` 中判定。交换装备时先锁定角色行，再在同一事务中完成
   新旧位置迁移。最终属性 = 职业/等级基础属性 + 装备加成，由 application 层
   计算并返回；Room 将其注入 `CombatWorld`，客户端从不计算权威属性。升级时
   `CombatWorld` 以新属性回满；装备变化的 HP/MP 只做上限裁剪，不回血。
8. **使用消耗品。** 药水使用以 Room 当前权威 HP/MP 为输入（不是可能落后的
   checkpoint），application 层裁剪到有效上限、写回 `characters.hp/mp`、扣减
   数量，Room 再把结果写回 `CombatWorld`。满血/满蓝或无治疗效果时拒绝且不消耗。
9. **私有与公开数据分离。** `WorldState` 只增加公开的 `loot` 集合（AOI 过滤）。
   背包、装备、金币、经验通过 `inventory.snapshot`、`asset.result`、
   `character.progress` 等定向消息发送给本人。客户端按 `eventId`/`commandId`
   去重，并在收到提交后的结果前不显示成功。
10. **新角色初始装备。** 创建角色时在同一事务内写入职业初始武器与药水。
    Control API 因此读取 `game-domain` 的 `STARTER_KIT` 目录；依赖方向为
    `control-api → game-domain`，仍不接触 game-server、map-runtime 或数据库细节
    之外的实时逻辑。
11. **协议增量。** 新增 `loot.pickup`、`inventory.equip`、`inventory.unequip`、
    `inventory.use` 与 `inventory.snapshot`、`asset.result`、
    `character.progress`、`character.levelUp`、`loot.claimed`。新增 11 个拒绝码
    （物品、背包、归属、过期、服务不可用）。保持 `PROTOCOL_VERSION = 1`，因为
    新消息与可选字段对旧客户端是增量；服务器部署后旧客户端只是看不到新 UI。
12. **内容版本。** 物品、掉落表与经验曲线使用固定 ID 和 `phase5.1` 内容版本，
    暂驻 `game-domain`；阶段 7 引入 `content-schema`/Content Release 后迁移参数，
    但物品行为 handler 仍只能由代码发布增加（ADR-011）。

## 理由

- 将事务用例放进独立包，避免 Room 直接拼 SQL，也避免控制 API 与实时服务器共享
  可变业务逻辑。
- 单一 `container` 字段比“地面表 + 背包表”更容易证明物品唯一归属，CHECK 约束
  能直接拒绝非法写入。
- `asset_commands` 幂等表让所有资产命令共享一套可审计的“只执行一次”语义，
  比按命令类型各写一套更不容易漏。
- 击杀奖励在数据库提交后再生效，符合“提交后才能确认奖励”的硬约束；失败重试
  与固定 tick 解耦。
- 装备槽唯一性交给角色行锁：交换装备是合法业务动作，数据库立即唯一约束无法表达
  其瞬时中间态；事务内锁定角色后，唯一性由串行化保证。
- 初始装备让新角色立即具备可验证的“装备 → 属性变化 → 重登恢复”链路，同时
  避免在测试里直接写数据库伪造物品。

## 影响

- 新增 `packages/game-application` 与 ESLint 边界。
- `persistence` 新增 5 张表和迁移 `0002`、`0003`，其中 `0003` 把装备槽唯一索引
  改为普通索引（原因见上）。
- `control-api` 新增对 `game-domain` 的依赖；`game-server` 新增对
  `game-application` 的依赖。
- `game-domain` 新增物品/掉落/经验目录与纯函数，`CombatWorld` 支持注入装备后
  属性、提交后的等级/属性更新与消耗品生命值写回。
- `WorldState` 增加公开 `loot` 集合；客户端新增经验条、金币、附近掉落、背包/
  装备面板与升级提示。
- 指标新增资产命令、失败、掉落生成/拾取、金币、经验计数。
- 已知限制：过期未领取的掉落行不会自动清理；`asset_commands` 持续增长；
  客户端点击优先攻击怪物，落在怪物脚下的掉落在 HUD 掉落列表中拾取。
