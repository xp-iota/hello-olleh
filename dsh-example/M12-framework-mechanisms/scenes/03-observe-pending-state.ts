import { Context } from '@deepseek-ai/cordis'
import * as pendingPlugin from '../impl/03-fiber-state-machine.ts'

// FiberState 是 const enum（仅类型期存在）；Node 原生 TS 运行时直接读取公开数值状态。
const stateNames = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const ctx = new Context()
const fiber = ctx.plugin(pendingPlugin)
await Promise.resolve()
const before = stateNames[fiber.state]
const remove = ctx.provide('lateService', { ready: true })
await fiber
const after = stateNames[fiber.state]
await fiber.dispose()
remove()
console.log('FiberState:', { beforeDependency: before, afterDependency: after, afterDispose: stateNames[fiber.state] })
await ctx.fiber.dispose()
