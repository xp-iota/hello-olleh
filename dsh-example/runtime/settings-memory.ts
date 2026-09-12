/**
 * settings-memory.ts —— `@deepseek-ai/dsh-settings` 的 `SettingsProvider` 是**抽象类**：
 * 它只负责 schema 注册、分层解析（schema 默认值 → 组合 base → user 层）与 CAS 修订号，
 * 把"原始文档存哪里"留给 provider 子类。真实产品里的子类读写磁盘 JSON
 * （`@deepseek-ai/dsh-storage-json` 一路），示例工程只需要一个进程内的内存实现。
 *
 * 直接 `ctx.plugin(SettingsProvider)` 会抛 `this.load is not a function` ——
 * 抽象 seam 必须由 provider 落地，这一点与 fs / shell / sandbox / compaction 一致。
 */
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

export class MemorySettingsProvider extends SettingsProvider {
  /** 整份"用户层"原始文档，按 namespace 分节。 */
  private readonly doc: Record<string, unknown> = {}

  /** 内存 provider 可写（真实里只读部署会返回 false，写入请求直接被拒）。 */
  readonly writable = true

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns as unknown as string] = section
  }
}

export default MemorySettingsProvider
