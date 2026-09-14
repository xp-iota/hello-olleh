/**
 * 模块 M03 的对应阶段（mock 版）：加载本插件的 mock 适配器（route='mock'）→ 用**共享消费循环**
 * （consume.ts）直接消费它的 StreamChunk 流，验证协议顺序：
 * block-start → text-delta → block-end → usage → finish。`npm run M03`。
 *
 * 用 `mock: false` 让 harness 别注册它自带的 mock 适配器 —— 一条 provider 路由
 * 只能有一个适配器，重复注册真实实现会抛错。
 *
 * mock 路由的消费演示集中在本脚本（离线套件也只跑它）；想看**同一个循环**对
 * 真实推理服务的表现：`npm run M03`（默认真实模式）。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as llmAdapterPlugin from '../steps/01-llm-adapter.ts'
import { consumeStream, printProtocolChecks } from '../support/consume-stream.ts'

// mock: false：让 harness 别注册它内置的 mock 适配器，把 'mock' 路由让给本插件 ——
// 一条 provider 路由只能有一个适配器，重复注册会抛错。
// 插件配置不传，沿用 steps/01-llm-adapter.ts 里 Config 声明的默认值（routeName: 'mock' + 固定回复）。
const harness = await createHarness({ mock: false })
await harness.loadPlugin(llmAdapterPlugin)

console.log('已注册的 provider 路由:', harness.ctx.llm.listProviders().map((info) => info.id))

// llm.stream(options)：options.provider 选适配器；调用经 'llm/stream' waterfall 派发。
const mock = await consumeStream(
  harness.ctx.llm.stream({ provider: 'mock', model: 'mock-1', messages: [] }),
  { verbose: true },
)

console.log('\n聚合 assistant 文本:', mock.text)
printProtocolChecks(mock)

console.log('\nchunk 类型统计:', JSON.stringify(mock.counts))
console.log('block-start 的 blockType 序列:', JSON.stringify(mock.blockTypes))
console.log('finish.reason:', JSON.stringify(mock.finish))
console.log('usage:', JSON.stringify(mock.usage))

await harness.dispose()
