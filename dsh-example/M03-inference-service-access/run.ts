const phases = [
  ['注册并消费离线 LLM Adapter', './phases/01-llm-adapter.ts'],
  ['用 llm/stream waterfall 包装 chunk 流', './phases/02-llm-stream.ts'],
] as const

console.log('\n████ M03 · 推理服务接入：Provider 路由与流协议 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M03.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：Adapter 决定流从哪里来，llm/stream 决定流途中怎样被观测或改写，Consumer 只依赖统一 StreamChunk 契约。')
