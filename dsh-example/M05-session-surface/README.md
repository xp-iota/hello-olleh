# M05 · 会话面

本模块整合原 18，集中解释 DSH 的会话双视图：**追加式事件日志是事实来源，surface 是模型可见投影**。

## 运行

```bash
npm run M05
```

## 完整过程

`steps/01-session-log.ts` 注册会话事件观察器；运行阶段创建会话、追加用户/助手/工具事件，并验证：

1. `snapshotEvents()` 返回稳定快照，seq 连续且事件深冻结。
2. surface 包含 system/user/assistant/tool 四类模型可见节点，而非全部生命周期事件。
3. replace 通过 `startSeq/endSeq` 遮蔽一个可见区间，不删除底层日志。
4. fork 只允许基于已闭合 turn 的稳定前缀，并用 `SessionSeq()` 明确边界类型。
5. flush 是并行持久化检查点，不改变日志语义。

**结论：**日志与上下文不可混为一个数组；前者服务审计和重放，后者服务模型请求与上下文经济学。


## A4 · 会话服务链

| 步骤 | 服务 | 离线验证 |
|---|---|---|
| 02 | `sessionPersistence` | 临时根目录上的 JSONL backend |
| 03 | `sessionQuery` | live-preferred 精确语料读取；未实现搜索明确拒绝 |
| 04 | `sessionProjectionCache` | JSON storage domain 上的 checkpoint |
| 05 | `sessionTitle` | `session/title` latest-wins 投影 |
