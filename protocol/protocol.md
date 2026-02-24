# Agent 聚会协议 V0.1

## 1. 目标
- 支持多 Agent 围绕用户发起话题进行自然讨论。
- 非固定轮次，允许“谁想说就说”，但用举手和令牌控制秩序。
- 用户可随时参与、打断、点名、收束。

## 2. 核心原则
- 话题必须由用户发起（`topic_open`）。
- 默认自由发言，不强制轮次。
- 发言前先举手，调度器放行后才能占用发言令牌。
- 用户消息拥有最高优先级，可抢占当前流程。

## 3. 角色
- `user`：发起话题、追加约束、打断、结束讨论。
- `host_agent`：主持与总结，可提出子议题与收敛结论。
- `role_agent`：各专业角色（专家/质疑者/落地官等）。
- `orchestrator`：系统调度器，负责举手队列、令牌分配、节流与公平。

## 4. 会话状态机
- `idle`：未开题，不接受 Agent 自由讨论。
- `active`：用户已开题，允许举手与发言。
- `cooldown`：高频发言后短暂冷却，防止刷屏。
- `closing`：用户或主持发起收束，进入总结阶段。
- `closed`：会话结束。

状态迁移（简化）：
- `idle -> active`：收到 `topic_open`。
- `active -> closing`：收到 `close_request` 或达成结束条件。
- `closing -> closed`：发布最终总结 `final_summary`。
- `active <-> cooldown`：根据速率限制自动切换。

## 5. 事件类型（协议消息）
统一字段：
- `event_id`：唯一 ID
- `session_id`：会话 ID
- `timestamp`：毫秒时间戳
- `sender_id`：发送者 ID
- `sender_role`：`user | host_agent | role_agent | orchestrator`
- `event_type`：事件类型
- `payload`：业务内容

关键事件：
- `topic_open`：用户开题，必须包含 `topic`。
- `raise_hand`：Agent 请求发言，包含 `intent`、`priority`、`eta_sec`。
- `hand_accepted`：调度器放行，分配 `token_id` 与 `ttl_sec`。
- `hand_rejected`：拒绝举手，包含原因（重复/离题/限流）。
- `speak`：正式发言，必须带有效 `token_id`。
- `yield_token`：主动结束发言，释放令牌。
- `interrupt_request`：请求打断（通常用于纠错/风险）。
- `interrupt_granted`：打断获准并抢占令牌。
- `user_message`：用户插话（自动高优先级），payload 可附 `interrupt_mode: soft | hard`，默认 `soft`。
- `retarget`：用户点名某 Agent 回应。
- `close_request`：发起收束。
- `final_summary`：主持输出结论、分歧、行动项。

## 6. 举手与令牌机制
### 6.1 举手
- Agent 发言前发送 `raise_hand`，附：
  - `intent`：一句话说明要说什么。
  - `priority`：`high | medium | low`。
  - `reason_code`：`answer | challenge | risk | evidence | new_branch`。
  - `reply_to`：可选，指向被回应消息。

#### 去重规则
- 同一 Agent 在短时间内重复举手时：
  - **相同 `reason_code`**：合并为一条，更新 `intent` 为最新值，`priority` 取两者较高值。
  - **不同 `reason_code`**：视为独立意图，允许同时在队列中排队，不合并、不拒绝。
- 目的：防止相同意图刷屏，同时保留不同维度意图的完整表达。

### 6.2 放行
- 调度器维护优先队列，按分数排序放行：
  - `score = priority_weight + wait_bonus + mention_bonus - dominance_penalty`
- 建议权重：
  - `priority_weight`：高 100 / 中 60 / 低 30
  - `wait_bonus`：每等待 1 秒 +1（上限 30）
  - `mention_bonus`：被用户点名 +40，被 Agent @ +15
  - `dominance_penalty`：最近 60 秒发言过多 -20~-60

### 6.3 令牌
- 单令牌模式（MVP）：同一时刻只允许 1 个 Agent 发言。
- `ttl_sec` 建议 20~40 秒；超时自动回收。
- 每个 `speak` 必须验证：
  - `token_id` 有效
  - `sender_id` 与令牌持有者一致
  - 未过期

## 7. 用户特权
- 用户消息可随时进入，不受举手限制。
- 用户可执行：
  - `retarget(agent_id)`：指定下一位发言。
  - `freeze_free_chat(sec)`：短时禁自由麦，仅响应用户问题。
  - `open_free_chat(sec)`：开启短时自由麦窗口。
  - `close_request`：要求主持收束总结。

#### user_message 抢占语义
- `user_message` 触发时，需附带 `interrupt_mode` 字段（默认 `soft`）：
  - **`soft`**：等待当前 Agent 的 `speak` 自然结束或 `yield_token` 后，再将用户消息插入队首处理。
  - **`hard`**：立即回收当前令牌，当前 Agent 发言被强制中断，用户消息即时处理。
- 调度器收到 `user_message` 后：
  - `soft` 模式：标记"用户插话待处理"，令牌持有者的 TTL 不延长。
  - `hard` 模式：发出 `interrupt_granted`，回收令牌，被中断 Agent 可在后续重新举手。
- 建议：`hard` 模式仅在用户显式触发（如点击"打断"按钮）时使用，默认走 `soft`。

## 8. 约束与治理
- 去重：相同 Agent 在短时间重复举手可合并。
- 离题：偏离主题过阈值可拒绝并提示“请关联主问题”。
- 安全：命中敏感策略可降级为“仅主持总结，不展开执行细节”。
- 节流：单 Agent 每分钟最多 N 次发言（建议 3）。

## 9. MVP 最小落地建议
- 数据结构：
  - `Session`：状态、主题、参与者、当前令牌。
  - `HandQueue`：优先队列（可用最小堆取负分或最大堆）。
  - `EventLog`：事件流（便于回放与调试）。
- 流程：
  1. 用户发 `topic_open`。
  2. Agent 自主触发 `raise_hand`。
  3. 调度器放行 `hand_accepted`。
  4. Agent 发 `speak`，超时或 `yield_token` 后释放。
  5. 用户随时插话/点名/收束。
  6. 主持输出 `final_summary` 并关闭会话。

## 10. 示例事件流（简化）
```json
{"event_type":"topic_open","sender_role":"user","payload":{"topic":"如何设计 AI Agent 聚会机制"}}
{"event_type":"raise_hand","sender_id":"agent_risk","payload":{"intent":"补充失控场景","priority":"high","reason_code":"risk"}}
{"event_type":"hand_accepted","sender_role":"orchestrator","payload":{"token_id":"t1","holder":"agent_risk","ttl_sec":25}}
{"event_type":"speak","sender_id":"agent_risk","payload":{"token_id":"t1","text":"建议加发言冷却和重复检测"}}
{"event_type":"user_message","sender_role":"user","payload":{"text":"先别展开，给我最小可实现版本"}}
{"event_type":"retarget","sender_role":"user","payload":{"agent_id":"agent_impl"}}
{"event_type":"close_request","sender_role":"user","payload":{"need":"结论+行动清单"}}
{"event_type":"final_summary","sender_role":"host_agent","payload":{"conclusion":"采用事件驱动+举手令牌","actions":["先做单令牌MVP","保留并发发言开关"]}}
```

## 11. 可配置参数（后续优化）
- `max_speakers`：并发令牌数（MVP=1，进阶可 2）。
- `token_ttl_sec`：发言时长。
- `per_agent_rate_limit`：每分钟发言上限。
- `topic_drift_threshold`：离题阈值。
- `summary_interval`：主持阶段性总结频率。
