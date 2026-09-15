# M05 · 会话面

DSH 同时维护两种视图：**追加式事件日志是事实来源，surface 是模型可见投影**。

## 学习目标

理解事实保存、语料读取、投影加速与标题派生为何必须分层。

## 运行

```bash
npm run M05   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 日志与 surface | 教学主线 | `impl/01-session-log.ts` | `scenes/01-check-log-invariants.ts` | seq 连续、深冻结、replace、fork 与 flush 不变量 |
| 2 持久化 | 扩展面 | `impl/02-session-persistence.ts` | `scenes/02-load-jsonl-provider.ts` | 临时根目录上的追加式 JSONL Provider |
| 3 查询 | 扩展面 | `impl/03-session-query.ts` | `scenes/03-list-live-preferred.ts` | live-preferred 精确读取；未实现搜索明确拒绝 |
| 4 投影缓存 | 扩展面 | `impl/04-session-projection-cache.ts` | `scenes/04-resume-from-checkpoint.ts` | storage domain 上的可恢复 checkpoint |
| 5 标题 | 扩展面 | `impl/05-session-title.ts` | `scenes/05-project-title.ts` | `session/title` 事件的 latest-wins 投影 |

## 完整链路

事件先追加到日志；persistence 保存事实；query 读取语料；projection cache 缩短重放路径；title 由最新日志事件折叠得到。surface replace 只遮蔽模型可见区间，不删除原始事件。

## 边界

快照可读但不可变；fork 只能基于已闭合 turn 的稳定前缀；缓存丢失时仍可从事实日志恢复。
