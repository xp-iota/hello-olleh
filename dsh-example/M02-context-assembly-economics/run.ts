const phases = [
  ['按顺序贡献 Prompt section', './phases/01-prompt-section.ts'],
  ['变量解析与 assembly waterfall', './phases/02-prompt-variable-assemble.ts'],
  ['压缩历史并替换模型可见 surface', './phases/03-compaction-provider.ts'],
  ['回放日志估算 token 压力', './phases/04-token-meter.ts'],
  ['确定性裁剪超长工具结果', './phases/05-tool-result-pruner.ts'],
  ['把超长结果 spill 到本地文件', './phases/06-spill-policy.ts'],
] as const

console.log('\n████ M02 · 上下文装配与经济学：构造、改写、压缩 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M02.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：上下文是结构化装配结果；section/variable 控制进入什么，compaction 控制历史以什么成本继续可见；meter、pruner 与 spill 把预算变成可观测且可执行的策略。')
