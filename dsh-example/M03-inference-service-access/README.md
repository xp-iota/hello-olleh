# M03 · 推理服务接入

推理接入包含两个正交问题：**由哪个 Provider 产生流**，以及**流在途中如何被观察或改写**。

## 学习目标

掌握 Adapter、统一 `StreamChunk` Consumer 与 `llm/stream` waterfall 的责任边界。

## 运行

```bash
npm run M03   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 2 流中间件 | 教学主线 | `impl/02-llm-stream.ts` | `scenes/02-wrap-chunk-stream.ts` | waterfall 如何统计和改写 chunk 而不替换后端 |
| M03.d 专项演示 | 模型交互 | `run.ts`（`runLlmAdapterMinimax`） | — | 同一消费循环接真实 SSE（需 `LLM_API_KEY`） |

## 完整链路

Consumer 按 provider/model 选择 Adapter，获得统一的 `AsyncIterable<StreamChunk>`；waterfall 在 Context 中包裹该流。`support/consume-stream.ts` 聚合文本、finish 与 usage，并验证 block-start 必须先于 delta。

## 边界

两个场景都调用推理服务。`AnthropicCompatAdapter`（`runtime/llm.ts`）是本工程唯一的 Provider，它把 Anthropic Messages + SSE 映射成统一 `StreamChunk`；`M03.d` 的专项演示直接内联在 `run.ts`。
