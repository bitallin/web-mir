# ADR-013: 按真实消费者创建包，不预建空壳

- 状态：Accepted
- 日期：2026-11-24
- 关联：MVP 计划阶段 0 任务 4、用户对空壳模块的约束

## 背景

架构文档列出了 `contracts`、`content-schema`、`game-domain`、`game-simulation`、
`game-application`、`persistence`、`auth`、`map-runtime`、`observability`、
`config`、`testkit` 共 11 个包。阶段 0 同时要求“不创建只有空壳、没有实际价值的
大量模块”。两者存在张力。

## 决策

阶段 0 只创建已经有真实实现、测试和消费者的包：

- `contracts`：协议版本、健康检查、错误 envelope
- `config`：环境变量校验与 `.env` 发现
- `observability`：Pino 日志与脱敏
- `persistence`：Drizzle 客户端、realms 基线表、迁移
- `testkit`：可控 RNG、手动时钟

以下包在首次出现真实实现时创建：

| 包                 | 创建阶段 | 第一个真实职责                |
| ------------------ | -------- | ----------------------------- |
| `game-simulation`  | 阶段 1   | 固定 tick 调度与实体状态推进  |
| `auth`             | 阶段 2   | 密码哈希、会话、游戏票据      |
| `game-domain`      | 阶段 3/4 | 移动、碰撞、战斗纯函数        |
| `map-runtime`      | 阶段 3   | MapRuntimeManifest 读取与导航 |
| `game-application` | 阶段 5   | 资产事务用例编排              |
| `content-schema`   | 阶段 7   | 内容 Draft / Release schema   |

## 理由

空包会制造虚假的完成感和额外的边界维护成本。边界应由真实依赖和测试证明。

## 影响

- AGENTS.md 明确记录未创建包及创建时机。
- 在包存在前，ESLint 边界规则禁止导入这些未来包。
- 创建新包时必须同时提供：package.json、tsconfig、真实实现、测试、依赖边界
  规则和文档更新。

## 未来调整条件

如果阶段 0 之后出现跨应用共享的稳定契约需求，可以提前创建对应包，但必须有
真实代码和测试，不能只有目录。

## 实施记录

- 阶段 1 已创建 `game-simulation`：固定 tick、BFS 路径与移动推进。
- 阶段 2 已创建 `auth`：Argon2id 密码、会话令牌与票据令牌，含单元测试；
  消费者为 control-api 与 game-server（见 ADR-017）。
