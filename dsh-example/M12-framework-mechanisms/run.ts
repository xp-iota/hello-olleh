const phases = [
  ['对照五种事件派发模式', './phases/01-dispatch-modes.ts'],
  ['验证绑定 Fiber 的可处置定时器', './phases/02-cordis-timer.ts'],
  ['观察 Fiber 依赖状态机', './phases/03-fiber-state-machine.ts'],
  ['隔离同名服务 realm', './phases/04-isolate-realm.ts'],
  ['叠加调用域 intercept 配置', './phases/05-intercept-config.ts'],
] as const

console.log('\n████ M12 · 框架机制本体：事件语义与生命周期资源 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M12.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：派发模式定义监听者如何组合，Fiber 定义监听器与定时资源何时回收；两者构成插件可组合、可卸载的底层纪律。')
