# ADR-029：角色外观与动画片段由资源 manifest 描述

- 状态：Accepted
- 日期：2026-11-26
- 阶段：Alpha 0.2 S2（切片 3，收尾）
- 关联：ADR-001（Phaser 表现层）、ADR-018（编译地图与资源版本）、ADR-019
  （战斗事件）、TD-CLI-06；`docs/ALPHA_02_EXECUTION_PLAN.md` §4

## 1. 背景

S2 已让三个职业拥有 9 个技能、等级解锁、DoT 与护盾，但客户端仍让所有玩家共用
`player_placeholder.png`，只用 `characterId` 哈希色区分；行走只有 2 帧，攻击/
施法/受击/死亡只靠缩放与透明度补间。结果是职业差异在画面上不可见，战斗反馈也
停留在浮字层面，TD-CLI-06 因此一直是 S2 的核心未完成项。

服务端已经通过 `combat.event` 提供 `attack`（含可选 `skillId`）、`hit`、`death`、
`respawn`，客户端不需要新协议即可驱动表现；缺的是资源描述与客户端状态机。

## 2. 问题

1. 一个角色需要多套动画（待机/行走/攻击/施法/受击/死亡），而现有资源 schema
   只有一个 `frames` 数量，无法表达“不同片段用不同列、不同帧时长”。
2. 三职业需要不同贴图，但客户端资源目录把角色固定为单个 `player_placeholder`。
3. 动画必须可回放/可测试：同一事件序列应产生同一帧序列，不能依赖渲染帧率。
4. 正式美术以后会替换占位图；替换时不应再改客户端代码。

## 3. 备选方案

1. **在客户端硬编码职业动画表。** 实现最快，但内容与代码耦合；换美术或调整帧
   时长都要发版，且无法通过内容校验发现错误。
2. **独立 `animations.json` 资源文件。** 表达清晰，但资源版本、校验与加载多一份
   文件；角色表本身就属于资源 manifest，拆开没有消费者收益。
3. **使用 Phaser Animation Manager 的全局动画注册。** 功能完整，但动画状态与
   场景全局注册表绑定，纯函数单测困难；本项目只需“状态 → 帧”的确定性映射。
4. **扩展角色 manifest（采纳）。** 每个角色可选 `animations`：片段名 → 列索引
   数组 + 帧时长 + 是否循环；方向仍是行。客户端用纯函数解析片段与帧。

## 4. 决策

### 4.1 资源格式

```json
"characters": {
  "warrior": {
    "id": "warrior",
    "image": "class_warrior.png",
    "frameWidth": 32,
    "frameHeight": 48,
    "directions": ["n", "e", "s", "w"],
    "frames": 10,
    "kind": "procedural-placeholder",
    "animations": {
      "idle":   { "frames": [0],    "frameMs": 400, "loop": true  },
      "walk":   { "frames": [1, 2], "frameMs": 150, "loop": true  },
      "attack": { "frames": [3, 4], "frameMs": 120, "loop": false },
      "cast":   { "frames": [5, 6], "frameMs": 150, "loop": false },
      "hurt":   { "frames": [7],    "frameMs": 200, "loop": false },
      "death":  { "frames": [8, 9], "frameMs": 240, "loop": false }
    }
  }
}
```

- 行 = 方向（`n`,`e`,`s`,`w`），列 = `frames` 指定的帧索引；schema 校验帧索引
  不得超出行宽、同一片段内不得重复帧。
- `animations` 可选：缺失时客户端退回两帧行走 + 单帧待机，旧资源仍可用。
- 帧名统一为 `${directionIndex}:${frameIndex}`，不再使用旧的 `pd2f0` 形式；
  占位图与职业图共用同一套帧命名。

### 4.2 客户端状态机

- 纯函数 `resolveClip`：死亡 > 一次性片段（攻击/施法/受击）> 行走 > 待机。
- 纯函数 `frameIndexFor`：循环片段取模，一次性片段停在最后一帧。
- `attack` 事件带 `skillId` 时播放 `cast`，否则播放 `attack`；`hit` 播放
  `hurt`；`death`/`respawn` 切换死亡片段与复位。
- 一次性片段时长由 manifest 的 `frames.length × frameMs` 决定，事件只负责触发，
  不在客户端推断命中/伤害结果。

### 4.3 资源与版本

- 新增 `content/assets/generateCharacters.ts`（`pnpm assets:generate`），零依赖
  生成 3 张 32×48、10 列 × 4 行的职业占位图；输出确定，可逐字节复现。
- manifest 版本升级为 `alpha0.2.1`；编译地图内嵌 `assetManifestVersion`，因此
  重新运行 `pnpm maps:compile` 并提交换算后的 checksum。
- 新增的仍是明确标注的 `procedural-placeholder`；正式美术替换时只改 `image`
  与 `animations`，客户端代码不变。

## 5. 理由

- 把“有哪些动作、每段多长”留在资源层，符合 AGENTS §2.5 内容与代码分离；代码
  只负责状态选择，便于以后按职业/技能扩展。
- 纯函数状态机让动画时序可单测、可回放，避免 E2E 用截图猜帧。
- 一次性的列索引格式比独立动画文件少一个资源版本面，且与现有行=方向的贴图
  布局一致。

## 6. 影响范围

- `contracts`：`assetCharacterSchema` 增加可选 `animations` 与校验；新增
  `characterClipSchema` 等导出（加法，旧 manifest 合法）。
- `game-web`：资源目录改为多角色；`PlayerVisual` 使用职业贴图与动画状态机；
  新增仅开发环境的 `selfAppearance`/`selfId` 诊断钩子。
- `content`：新增 3 张职业占位图与生成脚本；manifest 版本与编译地图更新。
- 测试：资源 schema 单测、动画纯函数单测、浏览器 E2E（三职业贴图/行走、战士
  普攻、道士施法）。
- 运维：无数据库、协议或服务端行为变化。

## 7. 未来调整条件

- 正式美术接入时，若需要逐技能区分动作（例如“重击”用攻击片段而不是施法
  片段），扩展 `combat.profile` 或内容技能字段，而不是在客户端按技能 ID 硬编码。
- 若同屏玩家数量导致帧解析成为热点，可缓存当前片段/帧；当前每帧仅少量整数
  运算。
- 若资源改为运行时下载，manifest 需增加资源 URL/哈希，届时再评估是否拆分。
