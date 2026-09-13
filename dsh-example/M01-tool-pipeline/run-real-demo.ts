/**
 * M01 的专项真实演示：由模型**自主决定**调用 word_count。
 * `DSH_REAL=1 node M01-tool-pipeline/run-real-demo.ts`（或 `npm run M01:real-demo`）。
 * 逐阶段的真实验收在 `run-real.ts`。
 */
console.log('\n████ M01 · 专项真实演示：由模型自主决定调用 word_count ████')
await import('./real/word-count-minimax.ts')
