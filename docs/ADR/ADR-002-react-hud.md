# ADR-002: React DOM UI + Phaser Canvas

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 0.2、4.2

## 决策

Phaser 只负责游戏世界表现；React 负责 HUD、背包、弹窗、聊天和运营后台之外的
游戏界面层。

## 理由

DOM 更适合信息密集、可访问、可样式化的界面；Canvas 更适合地图与实体渲染。
两者职责分离，避免把 UI 状态塞进 Phaser Scene。

## 影响

- React 覆盖层与 Phaser 共享同一视口，但不得互相直接操作内部状态。
- 通信通过明确的客户端状态层和 contracts，不使用全局可变对象。
- Scene 销毁时必须清理监听器，避免 React StrictMode 下重复挂载泄漏。
