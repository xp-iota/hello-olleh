const phases = [
  ['验证会话日志和模型可见面的不变量', './phases/01-session-log.ts'],
  ['装载 JSONL persistence Provider', './phases/02-session-persistence.ts'],
  ['查询 live-preferred 会话语料', './phases/03-session-query.ts'],
  ['耐久化 projection checkpoint', './phases/04-session-projection-cache.ts'],
  ['把标题写成 latest-wins 日志事件', './phases/05-session-title.ts'],
] as const

console.log('\n████ M05 · 会话面：日志、持久化、查询、投影与标题 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M05.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：事件日志是事实源；persistence 保存事实，query 读取语料，projection cache 加速重放，title 仍以日志投影表达。')
