# ADR-003: 一个地图实例一个 Colyseus Room

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 6

## 决策

MapTemplate → MapInstance → Colyseus Room。一个地图实例由一个权威 Room 承载；
跨地图由服务端 transfer。

## 理由

Room 是实时运行容器，不是整个世界。按实例划分便于生命周期、容量、线路和内容
版本管理。

## 影响

- 客户端不能自行改变 mapId。
- Room 启动时固定 contentReleaseId 和 assetManifestVersion。
- 多进程扩容时必须记录 RoomOwner 并正确路由连接。
