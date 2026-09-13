/**
 * M03 的专项真实演示：同一个 StreamChunk 消费循环接上真实 MiniMax。
 * `DSH_REAL=1 node M03-inference-service-access/run-real-demo.ts`（或 `npm run M03:real-demo`）。
 */
console.log('\n████ M03 · 专项真实演示：同一消费循环接真实推理服务 ████')
await import('./real/llm-adapter-minimax.ts')
