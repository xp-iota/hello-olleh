const phases = [
  ['管理后台 Job 的启动、读取、终止与等待', './phases/01-jobs-background.ts'],
  ['以追加日志和 CAS 推进 Goal 生命周期', './phases/02-goal-lifecycle.ts'],
  ['在 worker thread 执行工作流脚本', './phases/03-workflow-engine.ts'],
  ['把计划调度注册到耐久会话', './phases/04-schedule.ts'],
] as const

console.log('\n████ M09 · 长任务与编排：运行句柄与目标状态 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M09.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：Job 管“正在运行的工作”，Goal 管“为何运行及进展到哪”；两者都通过属主、日志和 revision 避免隐式全局状态。')
