const phases = [
  ['注册子代理 Provider，并显式包装成工具', './phases/01-subagent-delegation.ts'],
  ['装配不扫描用户目录的空 preset roster', './phases/02-agent-presets.ts'],
  ['拒绝未隔离 shell 的权限预设', './phases/03-permission-presets.ts'],
  ['配置子代理精确模型路由', './phases/04-subagent-model-selection.ts'],
] as const

console.log('\n████ M08 · 委派与预设：Provider、组合、权限与模型选择 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M08.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：Provider 决定怎么跑，preset 决定装什么，permission 决定能做什么，model selection 决定允许走哪条子模型路由。')
