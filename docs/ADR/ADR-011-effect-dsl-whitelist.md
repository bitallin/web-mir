# ADR-011: 后台 Effect DSL 白名单，不执行任意脚本

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 9.2、12、13.5

## 决策

技能效果使用受控 Effect DSL（directDamage、projectile、areaDamage、heal、
applyStatus、temporaryBuff 等），每种效果由已发布代码中的 handler 执行。后台
只能配置参数，不能输入 JavaScript、`eval`、动态 import 或任意 SQL。

## 理由

后台内容编辑必须安全、可校验、可回滚，不能成为远程代码执行入口。

## 影响

- 新效果行为需要代码发布、测试和服务端部署。
- 内容发布前校验 handler 是否已实现。
- 管理命令同样走服务端 RBAC 和审计。
