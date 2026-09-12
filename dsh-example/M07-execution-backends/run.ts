const phases = [
  ['通过 fs/subprocess seam 执行副作用', './phases/01-fs-shell-side-effects.ts'],
  ['消费 shell 的 run/start 双形态', './phases/02-shell-service.ts'],
  ['用 sandbox provider 强制策略', './phases/03-sandbox-seam.ts'],
  ['观察 terminal backend 注册边界', './phases/04-terminal-sessions.ts'],
  ['解析共享 sandbox policy', './phases/05-sandbox-policy.ts'],
] as const

console.log('\n████ M07 · 执行侧后端：I/O、进程与沙箱边界 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M07.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：工具只表达意图；fs/shell/subprocess 提供可替换执行后端，sandbox 在派发前把策略变成可强制执行的 argv。')
