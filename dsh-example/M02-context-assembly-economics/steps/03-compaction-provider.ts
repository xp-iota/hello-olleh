/**
 * M02.3 · 上下文压缩 seam（提供 ctx.compaction 的实现）。
 *
 * `CompactionEngine` 是一个**抽象 cordis Service**（构造里 `super(ctx)` 把服务名钉死成
 * `compaction`）。所以"提供一个 seam 实现"的形状不是调什么注册函数，而是：
 *
 *   1. 继承那个抽象服务；
 *   2. 用 `static inject` 声明依赖、`static Config` 声明配置（schemastery）；
 *   3. `constructor(ctx, config)` 里先 `super(ctx)` —— 这一步就把自己挂到了 `ctx.compaction`，
 *      并且是 effect-based（fiber 卸载时还原上一实现）；
 *   4. `export default` 这个类，cordis 加载插件时 `new Provider(ctx, config)`。
 *
 * 一个 context 只装一个实现（官方那个是 `@deepseek-ai/dsh-compaction-basic`）。
 *
 * 谁来触发：
 *   - 自动压力检查跑在 `agent/pre-step`（waterfall；trigger='pressure'）
 *   - 溢出恢复跑在 `agent/request-error`（waterfall；trigger='context-overflow'）
 *   - 手动 `/compact` 调同一个服务的 compactNow()
 *
 * 关键点：
 *   - `compactIfNeeded` 在没到安全线时返回 `null`（不硬压）；实现要**尊重 signal**。
 *   - 真正的"折叠"发生在会话日志上：追加一条带
 *     `surfaceOp: { op:'replace', start, end }` 的事件来遮蔽被折叠区间的 surface 节点
 *     （见 M05）。真实实现的摘要文本由模型生成，这里用固定文本演示形状。
 *   - `session.surface.nodes` 是模型可见面的 seq 列表（真实只读投影）。
 *   - 判定点带 `[demo-compaction]` trace：压力信号、折叠区间、摘要追加、各 null 分支
 *     在运行时逐步可见（仅为教学演示，真实实现不打这种日志）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { CompactionEngine, CompactionId, ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionAgentContext, CompactionResult, CompactionTrigger, ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 触发自动压缩的 surface 节点数阈值。 */
  threshold: number
}

export class DemoCompactionEngine extends CompactionEngine {
  // 类式插件也用静态 inject：Cordis 创建实例前会等待 sessions 服务可用。
  static inject = ['sessions']

  // 静态 Config 与函数式插件导出的 Config 作用相同，负责外部配置校验和默认值。
  static Config: z<Config> = z.object({
    threshold: z.number().default(8),
  })

  private readonly threshold: number

  constructor(ctx: Context, config: Config) {
    // super(ctx) → CompactionEngine 内部把服务名钉成 'compaction'：本实例即刻成为 ctx.compaction。
    super(ctx)
    this.threshold = config.threshold
    this.registerAutomaticCompaction()
  }

  /**
   * 自动压力检查挂在 `agent/pre-step`（waterfall）：观察完必须交回 next()，
   * 否则等于否决本步（对照 compaction-basic 里的同款监听器）。
   */
  private registerAutomaticCompaction(): void {
    this.ctx.on('agent/pre-step', async (payload, next) => {
      if (!payload.signal.aborted) {
        const result = await this.compactIfNeeded(payload.agent, 'pressure', payload.signal)
        if (result) console.log(`[compaction] pre-step 压力触发：折叠 ${result.shadowedSeqs.length} 条（省约 ${result.shadowedTokenCount} tokens）`)
      }
      return next()
    })
  }

  async compactIfNeeded(agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    if (signal.aborted) {
      console.log('   [demo-compaction] signal 已 abort → 直接返回 null')
      return null
    }
    // 用 surface 节点数作为最小压力信号（真实实现用 tokenMeter 估算上下文占用）。
    const visibleSeqs = agent.session.surface.nodes
    if (trigger === 'pressure') {
      // 压力模式下，未到安全线就"不压"，返回 null。
      if (visibleSeqs.length < this.threshold) {
        console.log(`   [demo-compaction] 压力信号：surface ${visibleSeqs.length} 条 < 阈值 ${this.threshold} → 不压，返回 null`)
        return null
      }
      console.log(`   [demo-compaction] 压力信号：surface ${visibleSeqs.length} 条 ≥ 阈值 ${this.threshold} → 触发折叠`)
    } else {
      console.log(`   [demo-compaction] trigger='${trigger}'：溢出恢复无条件折叠`)
    }
    return this.fold(agent)
  }

  async compactNow(agent: ManualCompactAgentContext): Promise<CompactionResult | null> {
    return this.fold(agent)
  }

  async compactRegion(start: number, end: number, agent: CompactionAgentContext): Promise<CompactionResult> {
    const result = this.fold(agent, start, end)
    // compactRegion 的返回类型不允许 null：显式区间压不动就是调用方给错了区间。
    if (!result) throw new ManualCompactionError('changed', `区间 [${start}, ${end}] 上没有可折叠的 surface 节点`)
    return result
  }

  /**
   * 真正折叠：往会话日志追加一条带 `surfaceOp: { op:'replace', start, end }` 的摘要事件，
   * 遮蔽被折叠区间的 surface 节点。保留最近 3 条。
   *
   * 返回值 `CompactionResult` 是一份**可核对的账**：它要报出摘要事件自己的 seq
   * （`summarySeq`）、被遮蔽的区间与全部 seq（`shadowedRange` / `shadowedSeqs`）、
   * 以及省下多少 token（`shadowedTokenCount`）——调用方靠它做审计与遥测。
   */
  private fold(agent: CompactionAgentContext, start?: number, end?: number): CompactionResult | null {
    const { session } = agent
    const visibleSeqs = [...session.surface.nodes]
    const keepRecent = 3
    const foldedSeqs = start !== undefined && end !== undefined
      ? visibleSeqs.filter((seq) => seq >= start && seq <= end)
      : visibleSeqs.slice(0, Math.max(0, visibleSeqs.length - keepRecent))
    if (foldedSeqs.length === 0) {
      const reason = start !== undefined ? `区间 [${start}..${end}] 上没有 surface 节点` : `${visibleSeqs.length} 条全在"保留最近 ${keepRecent} 条"之内`
      console.log(`   [demo-compaction] ${reason} → 无可折叠节点，返回 null`)
      return null
    }
    if (start === undefined) {
      console.log(`   [demo-compaction] 折叠区间：${visibleSeqs.length} 条 - 保留最近 ${keepRecent} 条 → seq [${foldedSeqs[0]!}..${foldedSeqs[foldedSeqs.length - 1]!}]（${foldedSeqs.length} 条）`)
    } else {
      console.log(`   [demo-compaction] 折叠区间：显式指定 [${start}..${end}] → 命中 ${foldedSeqs.length} 条`)
    }

    const shadowedRange = { start: foldedSeqs[0]!, end: foldedSeqs[foldedSeqs.length - 1]! }
    const summary: ContentBlock[] = [{ type: 'text', text: `（已把 ${foldedSeqs.length} 条历史压成一段摘要）` }]
    // 0.1.5 的两条硬约束合起来决定了摘要必须是 **user/message**：
    //   1. surface replace 要求节点的 sourceEventSeqs 覆盖每一个被遮蔽的 surface 节点
    //      （否则运行期抛 'sourceEventSeqs must include every shadowed surface node'）；
    //   2. assistant/message 的 sourceEventSeqs 类型是 never —— assistant 消息内嵌自己的
    //      provider 流，不引用来源事件。
    // 于是 assistant/message 结构上无法做 surface 替换。上游 compaction-basic 的做法是
    // 追加一条 user/message 检查点来占据被遮蔽区间的原位（见 packages/compaction/
    // compaction-basic/src/region.ts 的 commitCompactionBody）。
    const summaryEvent = session.append(
      'user/message',
      createUserMessage({ content: summary, source: { kind: 'user' } }) as never,
      { surfaceOp: { op: 'replace', startSeq: shadowedRange.start, endSeq: shadowedRange.end }, sourceEventSeqs: foldedSeqs },
    )
    console.log(`   [demo-compaction] 追加摘要事件 seq ${summaryEvent.seq}：'user/message' 检查点 + surfaceOp { op:'replace', ${shadowedRange.start}..${shadowedRange.end} }（摘要占据被遮蔽区间的原位）`)
    return {
      compactionId: CompactionId(`demo-${summaryEvent.seq}`),
      startSeq: shadowedRange.start,
      summarySeq: summaryEvent.seq,
      endSeq: summaryEvent.seq,
      summary,
      shadowedRange,
      shadowedSeqs: foldedSeqs,
      // 真实实现用 ctx.tokenMeter 量；示例用一个常数估算，只为把这条账目走通。
      shadowedTokenCount: foldedSeqs.length * 120,
    }
  }
}

// 这是插件包的诊断名称；真正提供给 context 的服务名由 CompactionEngine 固定为 compaction。
export const name = 'compaction-provider'

// 导出类而不是手动 new：ctx.plugin 会读取上面的 static 元数据并负责生命周期/卸载。
export default DemoCompactionEngine
