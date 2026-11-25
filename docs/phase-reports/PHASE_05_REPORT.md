# 阶段 5 报告：掉落、背包、装备和资产持久化

- 日期：2026-11-25
- 状态：实现完成，自动化验收通过；等待用户在 `http://<LAN-IP>:8584/` 实测验收
- 基线：`docs/WEB_LEGEND_TECHNICAL_ARCHITECTURE_v2.md`、`docs/WEB_LEGEND_MVP_PLAN_v2.md`
- 决策：[ADR-020](../ADR/ADR-020-phase5-asset-economy.md)
- 开工 HEAD：`de71d05`（工作区干净）
- 阶段提交：`feat(phase-5): deliver loot, inventory, equipment and persistent economy`
  （提交哈希见 PROJECT_STATUS §10）

## 1. 目标与范围

阶段 5 的目标是交付传奇类游戏最重要的“击杀—掉落—拾取—穿戴—成长”闭环：

- 物品模板/实例/堆叠/装备槽与 24 格背包；
- 两种怪物的掉落表、地面掉落、拾取范围、击杀者优先归属与过期；
- 钱包与金币流水；
- 击杀经验、升级与属性成长；
- 拾取、装备、卸下、使用消耗品的数据库事务与幂等；
- 崩溃/重登后已提交资产恢复；
- 双浏览器真实链路验证。

明确不进入：PK、安全区、聊天过滤、运营后台、内容发布、压测与部署。

## 2. 交付内容

### 2.1 新包与边界

- `packages/game-application`：事务用例层，依赖 `contracts`、`game-domain`、
  `persistence`；不得依赖 Colyseus/Fastify/Pino/Phaser/simulation/map-runtime/app。
- `control-api` 新增对 `game-domain` 的依赖，用于创建角色时的职业初始装备。
- `game-server` 新增对 `game-application` 的依赖。
- ESLint 与 AGENTS 同步更新；浏览器仍只能导入 `contracts`。

### 2.2 契约

新增：

| 方向 | 消息                 | 说明                              |
| ---- | -------------------- | --------------------------------- |
| C→S  | `loot.pickup`        | 提交意图：dropId + 幂等 commandId |
| C→S  | `inventory.equip`    | itemId                            |
| C→S  | `inventory.unequip`  | slot                              |
| C→S  | `inventory.use`      | itemId                            |
| S→C  | `inventory.snapshot` | 加入/重连后的私有背包快照         |
| S→C  | `asset.result`       | 事务提交后的资产结果              |
| S→C  | `character.progress` | 经验/金币/等级/有效属性           |
| S→C  | `character.levelUp`  | 升级提示                          |
| S→C  | `loot.claimed`       | 公开拾取广播                      |

- `WorldState.loot` 为公开集合，使用 `.view()` 做 AOI 过滤；背包、装备、金币、
  经验永不进入公开状态。
- 新增 11 个拒绝码：物品不存在、背包满、不可用、不可装备、职业限制、等级不足、
  槽位为空、非归属者、掉落过期、已被拾取、服务不可用。
- 内容版本 `phase5.1`；`PROTOCOL_VERSION` 保持 1（新增消息为增量）。

### 2.3 领域

`packages/game-domain`：

- 物品目录：3 职业武器、布衣/皮甲、金创药/魔法药、史莱姆凝胶/狼皮。
- 职业初始装备：武器 + 药水。
- 掉落表：史莱姆 12 exp / 2–4 金 / 必掉凝胶 / 25% 金创药；森林狼 22 exp /
  5–8 金 / 必掉狼皮 / 20% 魔法药 / 6% 皮甲。
- 经验曲线：`30 × level`，最高 100 级；可跨多级。
- 背包放置、堆叠、装备限制、装备加成与有效属性。
- 掉落 RNG 固定抽取次数，可用 seed 复现。

`CombatWorld` 新增：

- 注入装备后 `CombatStats`；
- 提交后的等级/属性更新（升级可回满）；
- 药水提交后的 HP/MP 写回。

### 2.4 数据库

迁移 `0002`、`0003`：

| 表                | 关键约束                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| `item_instances`  | container 三态 CHECK；背包槽部分唯一；装备槽普通索引（行锁保证唯一）；数量 > 0 |
| `world_drops`     | 每物品实例唯一掉落；地图/领取/过期索引                                         |
| `wallets`         | 角色主键；余额 ≥ 0                                                             |
| `currency_ledger` | 幂等键唯一；余额 ≥ 0；角色/时间索引                                            |
| `asset_commands`  | 幂等键唯一；角色/时间索引                                                      |

物品唯一归属由 `container` 单字段表达：一个实例只能处于背包、装备或地面之一，
因此不可能同时出现在地面和背包。

### 2.5 事务用例

`AssetService`：

| 用例     | 事务内容                                                                          |
| -------- | --------------------------------------------------------------------------------- |
| 击杀奖励 | 幂等行、角色行锁、经验/等级/HP/MP、钱包 + 账本、地面实例 + 掉落                   |
| 拾取     | 幂等行、掉落行锁、归属/过期/地图校验、角色行锁、背包放置、实例迁移/合并、掉落领取 |
| 装备     | 幂等行、角色行锁、物品行锁、职业/等级校验、槽位交换、有效属性快照                 |
| 卸下     | 幂等行、装备行锁、背包空位校验、实例迁移                                          |
| 使用     | 幂等行、角色行锁、物品行锁、有效上限计算、HP/MP 写回、数量扣减/删除               |

- 击杀奖励引用：`<serverId>:<roomId>:<monsterId>:<sequence>`；重复引用返回
  `null`，不重复发奖。
- 命令幂等键：`cmd:<kind>:<commandId>`；失败事务回滚幂等行，允许重试。
- 金币流水幂等键：`kill:<reference>:gold`。

### 2.6 服务端

- 加入时加载资产快照与装备后属性；私有快照在握手后发送。
- 死亡事件只入异步资产队列；固定 tick 不等待 SQL。
- 奖励提交后：发送进度/升级、生成地面掉落并加入 AOI。
- 资产命令统一管线：会话、协议、命令幂等、序号、限频、存活/范围校验、
  提交后 ACK；失败映射资产错误码。
- Room 创建恢复未过期掉落；每秒清理过期掉落。
- 指标：资产命令、资产失败、掉落生成/拾取、金币、经验。

### 2.7 客户端

- 顶部经验条、金币、等级；`B` 或按钮打开背包。
- 附近掉落列表；场景掉落标记；点击拾取。
- 背包 24 格；装备槽武器/护甲；装备/卸下/使用按钮；有效攻击/防御显示。
- 升级横幅、拾取日志、错误提示。
- 存活怪物优先于脚下掉落点击；掉落列表始终可拾取。
- 退出世界后重新拉取角色列表，避免用旧地图重新入图。

## 3. 验收标准对照

| MVP 阶段 5 验收项                       | 证据                                                         | 结果 |
| --------------------------------------- | ------------------------------------------------------------ | ---- |
| 两人同时拾取同一 drop，最多一个成功     | `assetService.integration.test.ts` 并发 `Promise.allSettled` | 通过 |
| 一个 Item Instance 不能同时在地面和背包 | 单一 `container` + CHECK + 事务用例                          | 通过 |
| 装备槽唯一且职业限制有效                | 装备交换、职业限制、等级限制测试                             | 通过 |
| 金币余额与流水一致                      | 钱包 + 账本同事务；44 条流水余额=合计                        | 通过 |
| 重试发奖/拾取/装备不会重复执行          | 重复 kill reference、重复 commandId 测试                     | 通过 |
| Game Server 重启后资产一致              | Room 重新加入加载装备；掉落恢复测试/实现                     | 通过 |
| 持久化失败不显示成功奖励                | 提交后才发送 ACK/进度；失败映射错误码                        | 通过 |
| 客户端不能伪造奖励                      | `.strict()` 契约、服务端计算、集成测试                       | 通过 |

## 4. 测试与证据

### 4.1 自动化结果

| 检查        | 命令                                           | 结果                                     |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| 格式        | `pnpm format:check`                            | 通过                                     |
| Lint / 边界 | `pnpm lint`                                    | 0 error / 0 warning                      |
| 类型        | `pnpm typecheck`                               | 14 个 workspace 通过                     |
| 单元/集成   | `pnpm test`                                    | 46 文件 / 253 测试通过（12.1s）          |
| 浏览器      | `PLAYWRIGHT_SKIP_WEBSERVER=true pnpm test:e2e` | 14/14 通过（1.2 分钟）                   |
| 构建        | `pnpm build`                                   | 4 个应用成功                             |
| 负载        | `pnpm load:world`                              | 30/30、750 接受、0 拒绝、tick p95 1.61ms |

### 4.2 关键测试

- `packages/game-domain/src/items.test.ts`：目录、初始装备、装备限制、背包放置、
  堆叠、满包、属性加成。
- `packages/game-domain/src/loot.test.ts`：固定抽取、必掉项、同 seed 回放。
- `packages/game-domain/src/progression.test.ts`：阈值、跨级、满级。
- `packages/game-domain/src/combatWorld.test.ts`：装备后属性、升级回满、药水写回。
- `packages/contracts/src/economy.test.ts`：意图命令、伪造字段、快照上限、掉落状态。
- `packages/game-application/test/assetService.integration.test.ts`：真实
  PostgreSQL 的 10 个事务/并发/幂等用例。
- `apps/game-server/test/economy.integration.test.ts`：真实 PostgreSQL +
  Colyseus 的击杀→进度→掉落→拾取→重复命令→账本/背包，以及装备→属性→重登。
- `tests/e2e/economy.spec.ts`：双浏览器击杀、公开掉落、拾取、装备、重登恢复。

### 4.3 证据文件

- `docs/phase-reports/phase-05/loot-visible.png`：两名玩家看到同一地面掉落。
- `docs/phase-reports/phase-05/inventory-equipped.png`：背包、材料与已装备武器。
- `docs/phase-reports/phase-05/relogin-assets.png`：退出重进后的资产恢复。
- `docs/phase-reports/phase-05/loot-replay.json`：固定 seed 掉落回放。
- 指标：62 房间、844 接受、12 拒绝、7 击杀、8 资产命令、0 资产失败、7 掉落、
  4 拾取、19 金币、84 经验。
- 数据库：4 迁移、11 表、1246 角色、652 背包实例、19 装备实例、63 地面实例、
  44 钱包、44 流水（余额 95 = 流水 95）、97 资产命令、0 活跃租约。

### 4.4 回归

- 阶段 4 双浏览器战斗：HP 同步、技能 MP 30→24、冷却、死亡与重生。
- 阶段 3 传送、AOI、聊天、租约、checkpoint。
- 阶段 1 双人移动与重连。
- E2E 并行时经济场景使用 `wilds_slime_1`、战斗场景使用 `wilds_slime_2`，
  验证共享固定地图 Room 下的并发行为。

## 5. 已知限制与风险

- 独立测试数据库尚未建立；集成/E2E 使用共享开发库，残留掉落按归属过滤。
- 过期未领取掉落与 `asset_commands` 没有定期清理。
- 击杀奖励数据库长时间不可用时只重试 3 次；未提交奖励不会向玩家确认。
- 掉落恢复按地图加载所有未过期记录；MVP 每图单 Room，阶段 8 引入实例后需按
  实例归属。
- 生产掉落 RNG 为 `Math.random`；测试注入固定 RNG。
- 装备不改变角色外观；没有物品图标、背包整理/丢弃/出售。
- 背包 24 格，没有扩容/仓库。
- 点击优先攻击存活怪物，怪物脚下掉落需从 HUD 列表拾取。

## 6. 门禁结论

- 阶段 5 的实现、迁移、自动化测试和浏览器验证已完成。
- **阶段 5 尚未标记“完成”**：等待用户在 `http://<LAN-IP>:8584/` 按 §3 实测。
- 阶段 4 的手工验收未单独记录；本次未将其标记为完成。
- 验收通过前不进入阶段 6。
