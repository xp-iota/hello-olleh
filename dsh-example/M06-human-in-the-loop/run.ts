const phases = [
  ['人类斜杠命令直接进入宿主', './phases/01-command-hello.ts'],
  ['工具 ask 请求进入审批 seam', './phases/02-approval-answerer.ts'],
  ['结构化问题进入宿主 answerer', './phases/03-user-questions.ts'],
  ['用日志投影切换计划模式', './phases/04-plan-mode.ts'],
  ['整体替换 todo 列表', './phases/05-todo.ts'],
  ['读取耐久消息反馈', './phases/06-message-feedback.ts'],
] as const

console.log('\n████ M06 · 人在环路：显式命令与执行审批 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M06.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：命令是人绕过模型的控制入口，审批是模型执行副作用前回到人的裁决入口；两条路都不应伪装成普通提示词。')
