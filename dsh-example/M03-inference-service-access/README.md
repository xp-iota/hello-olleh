# M03 · 推理服务接入

本模块合并原 05 与 20，回答两个不同问题：**怎样替换模型后端**，以及**怎样在不替换后端时包装流**。

## 运行

```bash
npm run M03          # 离线 mock provider
npm run M03:real     # 真实 MiniMax；需要 MINIMAX_API_KEY，会发起网络请求
```

## 组成

| 能力 | 文件 | 责任边界 |
|---|---|---|
| Provider | `steps/01-llm-adapter.ts` | 实现 `LlmAdapter.stream()` 并注册具名路由 |
| Consumer | `support/consume-stream.ts` | 聚合文本、finish、usage，检查 block index 与孤儿 delta |
| 中间件 | `steps/02-llm-stream.ts` | 通过 `llm/stream` waterfall 统计和改写 chunk |
| 真实路径 | `real/llm-adapter-minimax.ts` | 用相同 Consumer 验证真实 provider 契约 |

## 数据流

Consumer 按 provider/model 选择 Adapter，获得统一 `AsyncIterable<StreamChunk>`；waterfall 可以在流经 Context 时包裹它，但不改变上层消费协议。协议检查要求 block-start 先于对应 delta，并且流最终提供 finish、usage 与有效文本。

**结论：**替换后端属于 seam provider，观测/改写属于流中间件；把两者分开后，业务 Consumer 无需知道具体供应商。
