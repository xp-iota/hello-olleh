/**
 * 校验 shim 是否满足上游的位置契约。
 *
 * 这是本工程唯一"必须逐字节对齐"的地方：上游一次性 PTC 拿
 * `stripped.slice(35, stripped.length - 2)` 取函数体，所以 shim 的返回值必须
 * 仍然以那 35 字符前缀开头、以 `\n}` 结尾。任何"顺手美化"都会让它切错。
 *
 * 用法：node runtime/check-bun-shim.mjs   （或 bun）
 */
import { stripTypeScriptTypes } from './lib/bun-shim.mjs'

if (typeof Bun === 'undefined') {
  console.error('这个校验只在 Bun 下有意义：Node 有原生 node:module.stripTypeScriptTypes，不需要 shim。')
  console.error('请用 `bun runtime/check-bun-shim.mjs` 运行。')
  process.exit(2)
}

const PREFIX = 'async function __dsh_program__() {\n'
const SUFFIX = '\n}'

/** 上游会喂进来的两种形态。 */
const CASES = [
  { name: '一次性 PTC（已包壳）', input: `${PREFIX}const a: number = 1\nreturn a${SUFFIX}` },
  { name: '裸语句列表', input: 'const a: number = 1\nreturn a' },
  { name: '带 interface 与泛型', input: `${PREFIX}interface P { x: number }\nconst p: P = { x: 2 }\nreturn p.x as number${SUFFIX}` },
]

let failed = 0

for (const testCase of CASES) {
  const output = stripTypeScriptTypes(testCase.input)

  // 1) 前缀/后缀契约：只有"已包壳"的输入需要满足。
  if (testCase.input.startsWith(PREFIX)) {
    if (!output.startsWith(PREFIX)) {
      console.error(`✗ ${testCase.name}：输出不再以 35 字符前缀开头，上游 slice(35) 会切错`)
      failed += 1
      continue
    }
    if (!output.endsWith(SUFFIX)) {
      console.error(`✗ ${testCase.name}：输出不再以 ${JSON.stringify(SUFFIX)} 结尾，上游 slice(…, -2) 会切错`)
      failed += 1
      continue
    }
  }

  // 2) 类型标注必须真的被剥离（否则等于没修）。
  if (/\binterface\s+P\b/.test(output) || /:\s*number\b/.test(output) || /\bas\s+number\b/.test(output)) {
    console.error(`✗ ${testCase.name}：类型标注没有被剥干净\n${output}`)
    failed += 1
    continue
  }

  // 3) 产物必须可解析（用 new Function 当语法检查器）。
  const body = output.startsWith(PREFIX) ? output.slice(PREFIX.length, output.length - SUFFIX.length) : output
  try {
    // eslint-disable-next-line no-new-func -- 只做语法校验，不执行
    new Function(`return (async () => {${body}})`)
  } catch (error) {
    console.error(`✗ ${testCase.name}：剥离后的代码无法解析：${error.message}\n${body}`)
    failed += 1
    continue
  }

  console.log(`✓ ${testCase.name}`)
}

if (failed > 0) {
  console.error(`\nBUN_SHIM_CHECK_FAILED cases=${CASES.length} failed=${failed}`)
  process.exitCode = 1
} else {
  console.log(`\nBUN_SHIM_CHECK_OK cases=${CASES.length} failed=0`)
}
