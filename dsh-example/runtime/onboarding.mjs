import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const lessons = [
  {
    id: 'M01', title: '工具管线', goal: '看懂工具从注册、披露、裁决到结果变换的完整链路',
    entry: 'M01-tool-pipeline/run.ts', source: 'M01-tool-pipeline/steps/01-word-count.ts',
    observe: ['Fiber dispose 后注册怎样消失', 'restrict、gate、guard 各控制哪一层', 'canonical value 与模型可见 content 怎样分离'],
    takeaway: '工具扩展由多个正交控制面组合，不需要改 AgentLoop。', next: '继续 M02，理解模型上下文怎样装配和压缩。',
  },
  {
    id: 'M02', title: '上下文装配与经济学', goal: '理解 section、variable、assembly 与 compaction 的连续生命周期',
    entry: 'M02-context-assembly-economics/run.ts', source: 'M02-context-assembly-economics/steps/01-prompt-section.ts',
    observe: ['Prompt section 怎样排序', '变量和 waterfall 怎样改结构化 assembly', '压缩为什么追加检查点而不删除日志'],
    takeaway: '上下文是结构化投影，不是一个不断增长的大字符串。', next: '继续 M03，观察推理 Provider 和流中间件。',
  },
  {
    id: 'M03', title: '推理服务接入', goal: '区分 Provider seam、StreamChunk Consumer 与 llm/stream 中间件',
    entry: 'M03-inference-service-access/run.ts', source: 'M03-inference-service-access/steps/01-llm-adapter.ts',
    observe: ['具名 provider 路由怎样注册', '统一 chunk 协议包含哪些不变量', 'waterfall 怎样包装而不替换后端'],
    takeaway: '后端、流中间件和 Consumer 分离后，业务代码不依赖供应商。', next: '真实模式默认就是 npm run M03；或继续 M04 看 AgentLoop。',
  },
  {
    id: 'M04', title: 'Agent 循环与干预面', goal: '从事件边界理解循环，并通过 inbox/steer 做非侵入干预',
    entry: 'M04-agent-loop-intervention/run.ts', source: 'M04-agent-loop-intervention/steps/01-agent-events-telemetry.ts',
    observe: ['turn/step 事件顺序', 'steering 在哪个边界生效', '四种 inbox 输入怎样进入 next-turn/next-step'],
    takeaway: '观察和干预都走稳定边界，主循环仍是唯一事实来源。', next: '继续 M05 看会话日志与模型可见 surface。',
  },
  {
    id: 'M10', title: '外部能力接入', goal: '不写执行插件，用 SKILL.md 注入流程知识',
    entry: 'M10-external-capabilities/run.ts', source: 'M10-external-capabilities/assets/SKILL.md',
    observe: ['frontmatter 怎样支持发现', '正文怎样进入 inbox', 'step 边界怎样把 skill 认领进模型上下文'],
    takeaway: '流程知识优先数据化，需要执行逻辑时再升级成插件。', next: '真实模式默认就是 npm run M10（含 M10.d 的 A/B 对照）。',
  },
  {
    id: 'M12', title: '框架机制本体', goal: '直接观察 Cordis 派发模式与 Fiber 资源回收',
    entry: 'M12-framework-mechanisms/run.ts', source: 'M12-framework-mechanisms/steps/01-dispatch-modes.ts',
    observe: ['五种派发模式的顺序与返回值', 'bail 接异步监听者的陷阱', 'dispose 怎样清理 timer 与挂起 Promise'],
    takeaway: '控制流与生命周期纪律是所有 DSH 插件的底座。', next: '回到 README，按方向选择其余模块。',
  },
]

const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]))
const tour = ['M01', 'M02', 'M03']

function assertSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 18)) throw new Error(`需要 Node >= 22.18，当前 ${process.version}`)
}
function printUsage() {
  console.log(`用法：
  npm run learn                         交互选择（终端中使用）
  npm run learn -- --tour               运行 M01 → M02 → M03
  npm run learn -- --list               列出精选入口
  npm run learn -- --module M01         运行一个模块
`)
}
function printLessons() {
  console.log('精选学习入口：')
  for (const lesson of lessons) console.log(`  ${lesson.id}  ${lesson.title} —— ${lesson.goal}`)
  console.log('\n全部 12 个模块可直接使用 npm run M01 … npm run M12。')
}
function printBefore(lesson, current, total) {
  const progress = current && total ? `（${current}/${total}）` : ''
  console.log(`\n${'═'.repeat(64)}\n▶ ${lesson.id} · ${lesson.title}${progress}\n目标：${lesson.goal}\n运行时请观察：`)
  lesson.observe.forEach((item, index) => console.log(`  ${index + 1}. ${item}`))
  console.log(`${'─'.repeat(64)}\n`)
}
function printAfter(lesson) {
  console.log(`\n✅ 你刚验证了：${lesson.takeaway}\n   看实现：${lesson.source}\n   下一步：${lesson.next}`)
}
async function runLesson(lesson, current, total) {
  assertSupportedNode(); printBefore(lesson, current, total)
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [lesson.entry], { cwd: projectRoot, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${lesson.id} 运行失败（code=${code ?? '-'}, signal=${signal ?? '-'}）`)))
  })
  printAfter(lesson)
}
async function runTour() {
  console.log('DSH 方向学习路线：工具管线 → 上下文 → 推理服务')
  for (const [index, id] of tour.entries()) await runLesson(lessonById.get(id), index + 1, tour.length)
  console.log('\n🎉 路线完成。使用 --list 选择 AgentLoop、Skill 或框架机制继续。')
}
async function interactive() {
  console.log('DeepSeek Harness 方向选择器\n  1. 路线：工具管线 → 上下文 → 推理服务')
  lessons.forEach((lesson, index) => console.log(`  ${index + 2}. ${lesson.title}（${lesson.id}）`))
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await readline.question('\n输入序号：')).trim()
    const choice = Number(answer)
    if (choice === 1) return await runTour()
    const lesson = lessons[choice - 2]
    if (!lesson) throw new Error(`无效选项：${answer || '空输入'}`)
    await runLesson(lesson)
  } finally { readline.close() }
}
function optionValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) return printUsage()
  if (args.includes('--list')) return printLessons()
  if (args.includes('--tour')) return await runTour()
  const requested = optionValue(args, '--module') ?? args.find((arg) => /^M\d{2}$/i.test(arg))
  if (requested) {
    const id = requested.toUpperCase(); const lesson = lessonById.get(id)
    if (!lesson) throw new Error(`选择器未收录 ${id}；全部模块仍可直接 npm run ${id}`)
    return await runLesson(lesson)
  }
  if (args.length > 0) throw new Error(`未知参数：${args.join(' ')}`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) { printLessons(); console.log('\n当前不是交互终端；请使用 --tour 或 --module MXX。'); return }
  await interactive()
}
main().catch((error) => { console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
