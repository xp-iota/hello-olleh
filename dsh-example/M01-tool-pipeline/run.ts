const phases = [
  ['注册工具与 Fiber 回收', './phases/01-register.ts'],
  ['pre-execute 权限门', './phases/02-permission-gate.ts'],
  ['post-execute 结果变换', './phases/03-result-transform.ts'],
  ['按 Agent 收紧可见工具', './phases/04-tool-restrict.ts'],
  ['不可翻案的单调守卫', './phases/05-tool-guard.ts'],
] as const

console.log('\n████ M01 · 工具管线：从注册、可见性到执行前后策略 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M01.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：工具是可回收注册项；restrict 决定“看见什么”，gate/guard 决定“能否执行”，post hook 决定“怎样回给模型”。')
