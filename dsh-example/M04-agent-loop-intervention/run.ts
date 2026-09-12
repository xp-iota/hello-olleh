const phases = [
  ['观察 turn/step/session 事件', './phases/01-agent-events-telemetry.ts'],
  ['在生命周期边界请求 steering', './phases/02-lifecycle-steering.ts'],
  ['比较 inbox 四种输入通道', './phases/03-agent-inbox.ts'],
  ['捕获会话遥测账本', './phases/04-session-telemetry.ts'],
  ['注册包归属运行时不变量', './phases/05-invariants.ts'],
] as const

console.log('\n████ M04 · Agent 循环与干预面：先观察，再引导 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M04.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：插件通过稳定事件边界观察循环，通过 inbox/steer 请求下一步行为，而不是侵入或复制 AgentLoop。')
