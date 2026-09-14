# M03 · 推理服务接入

推理接入包含两个正交问题：**由哪个 Provider 产生流**，以及**流在途中如何被观察或改写**。

## 学习目标

掌握 Adapter、统一 `StreamChunk` Consumer 与 `llm/stream` waterfall 的责任边界。

## 运行

```bash
npm run M03            # 真实 MiniMax（默认）；需要 LLM_API_KEY，会发起网络请求
npm run M03 -- --mock  # 离线确定性机制；不联网、不需要密钥
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察场景 | 观察什么 |
|---|---|---|---|---|
| 1 Adapter 路由 | 教学主线 | `steps/01-llm-adapter.ts` | `phases/01-consume-chunk-protocol.ts` | 实现 `LlmAdapter.stream()` 并注册具名路由 |
| 2 流中间件 | 教学主线 | `steps/02-llm-stream.ts` | `phases/02-wrap-chunk-stream.ts` | waterfall 如何统计和改写 chunk 而不替换后端 |
| M03.d 专项演示 | 真实专属 | `run.ts`（`runLlmAdapterMinimax`） | — | 同一消费循环接真实 SSE（需 `LLM_API_KEY`） |

## 完整链路

Consumer 按 provider/model 选择 Adapter，获得统一的 `AsyncIterable<StreamChunk>`；waterfall 在 Context 中包裹该流。`support/consume-stream.ts` 聚合文本、finish 与 usage，并验证 block-start 必须先于 delta。

## 边界

`--mock` 下的阶段完全离线；真实专项直接内联在 `run.ts`，且 `M03.d` 在 mock 模式打印 skip 后**不执行**。

**结论：**替换后端属于 Provider seam，观测和改写属于流中间件；上层 Consumer 不应知道具体供应商。
