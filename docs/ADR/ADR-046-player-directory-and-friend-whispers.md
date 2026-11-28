# ADR-046：进程级在线目录与好友私聊

- 状态：Accepted
- 日期：2026-11-28
- 阶段：Alpha 0.3 S4-C 私聊与在线目录切片
- 关联：ADR-035/036（组队与进程级 PartyService）、ADR-044（队伍聊天）、
  ADR-045（好友与在线状态）、路线图 4.3“聊天频道（世界/队伍/公会/私聊）”、
  TD-SRV-11、TD-SRV-14、TD-CLI-17

## 1. 背景

用户确认的社交顺序是“频道筛选 + 好友 → 私聊 → 行会”。好友与跨图邀请已经
交付，聊天日志默认显示全部频道；下一步是一对一私聊。

好友切片把在线状态与跨 Room 投递继续放在 `PartyService` 里：`presence` 表、
`registerRoom` 端口与 `presenceOf` 都以“队伍”命名，但好友通知已经依赖它。
TD-SRV-14 要求在私聊/行会之前把它提取成独立的在线目录。私聊会成为第三个
消费者，继续复用 `PartyService` 会让命名与职责进一步失真。

## 2. 问题

1. **共享状态归属**：在线状态、所在 Room 与跨 Room 投递同时被队伍、好友与
   即将到来的私聊使用，却没有一个以“玩家目录”命名的所有者。
2. **跨图投递**：私聊双方通常不在同一张地图；发送方 Room 不能把自己的广播
   当成私聊，必须找到对方当前所在的 Room。
3. **隐私与骚扰**：如果允许按任意 id 私聊，客户端可以枚举在线玩家并骚扰；
   私聊也需要限频与内容过滤。拒绝原因不能泄露“对方是否在线”。
4. **协议演进**：聊天已经有 `chat.send` 与 `chat.message`、频道枚举、过滤、
   限频、禁言、消息去重；私聊不应再建一套平行链路。
5. **客户端展示**：同一个 `chat.message` 要能区分“我发给谁”和“谁发给我”，
   并且不能把私聊混进地图频道。
6. **兼容**：旧客户端的 `chat.send` 不带 `targetPlayerId`，必须继续是地图聊天；
   旧 Release、数据库与协议版本不应被破坏。

## 3. 备选方案

1. **继续把 presence 放在 PartyService**：私聊可用，但服务名与职责继续误导，
   且每个新社交功能都要依赖“队伍服务”；TD-SRV-14 已明确要求提取。拒绝。
2. **为私聊单独建 `WhisperNotifier`**：会复制 presence、端口注册与跨图路由，
   出现第二份“谁在哪个 Room”的事实；拒绝。
3. **新增 `whisper.send` / `whisper.message` 协议**：与聊天治理链（过滤、限频、
   禁言、去重）重复，还得再定义一套错误码；拒绝。
4. **允许向任意在线玩家私聊**：扩大骚扰面，需要好友之外的黑名单/举报体系，
   当前切片不具备；拒绝。
5. **提取 `PlayerDirectory` + 复用 `chat.send` 的 `whisper` 频道 + 仅好友**
   （采纳）。

## 4. 决策

### 4.1 进程级 PlayerDirectory

新增 `apps/game-server/src/world/playerDirectory.ts`：

- 持有进程级 `PlayerPresence` 表（角色、名字、职业、等级、HP、存活、在线、
  当前 `roomId`）与每个地图 Room 的投递端口。
- `setPresence` / `markOffline` / `removePlayer` 定义完整的写入与清理路径；
  过图只 `markOffline`，最终离开才 `removePlayer`（延续 EL-046）。
- `deliver(playerId, delivery)` 按 presence 找到当前 Room 并投递；投递类型是
  一个闭集联合：聊天、组队邀请、队伍名单刷新、好友事件。Room 只解码自己
  托管的会话，不把跨 Room 状态写进公开 Room State。
- `PartyService` 不再持有 presence 与端口，只保留队伍注册表，构造时注入
  `PlayerDirectory`；`FriendNotifier` 被删除，好友事件改由目录投递。

### 4.2 私聊复用聊天协议

- `CHAT_CHANNELS` 追加 `whisper`；`chat.send` 增加可选 `targetPlayerId`，
  `chat.message` 增加可选 `targetPlayerId` / `targetDisplayName`。旧的
  `channel: 'map'` 行为与协议版本不变。
- 私聊必须带目标；其他频道带目标会被 schema 拒绝。服务端只信任会话身份，
  不信任客户端上报的发送者。
- 过滤、限频、禁言、`clientMessageId` 去重全部沿用 `handleChat` 的既有链路。
- 发送者收到本地回显，收件人由目录路由到其所在 Room；两边收到同一条
  `ChatMessage`，消息不进入公开 Room State，也不落库。

### 4.3 仅好友可私聊

- 服务端用 `FriendsService.areFriends` 校验关系；好友列表已经提供入口，
  客户端不能通过 UI 绕过。
- 离线、非好友、自己三种情况统一返回 `CHAT_TARGET_UNAVAILABLE`，避免把
  “是否在线”当作可探测信息。好友列表本身已经展示在线状态。
- 关系检查是 tick 之外的异步数据库读取；失败返回 `SERVICE_UNAVAILABLE`。

### 4.4 客户端

- 好友行新增「私聊」：选中目标、发言频道切到私聊、日志筛选切到私聊。
- 发言频道选择器增加「私聊·名字」；输入提示显示发送对象。
- 私聊行带「→ 名字」（自己发出）或「私聊」（收到）标签；日志默认“全部”
  仍然同时显示附近、队伍与私聊。
- 目标离线、被删除好友或断线重连导致好友快照变化时，自动清空目标并回到
  附近频道，避免把消息发给不可达对象。

## 5. 后果

- TD-SRV-14 关闭：在线状态与跨 Room 路由有了独立所有者，队伍、好友与私聊
  共用；进程重启仍会丢失在线状态（与 TD-SRV-11 同类，多进程前需要共享协调）。
- 私聊只在双方同时在线时交付，没有离线消息、历史记录、黑名单或“最近同玩”
  入口；按名字搜索仍属 TD-CLI-17 的剩余部分。
- 没有数据库迁移、没有内容发布、没有协议版本升级；新字段是加法扩展。
- 目录的投递联合是服务端内部接口，不进入 contracts；新增跨 Room 能力时应扩展
  该联合，而不是再建一个 Notifier。
