/** 用内存 sink 演示完整 session ledger 捕获；生产环境可替换成 OTel backend。 */
import type { Context } from '@deepseek-ai/cordis'
import {
  SessionTelemetryBackend,
  SessionTelemetryCoordinator,
  type SessionTelemetryRecord,
} from '@deepseek-ai/dsh-session-telemetry'

export class MemorySessionTelemetry extends SessionTelemetryBackend {
  static inject = ['sessions']
  readonly sharing = 'full' as const
  readonly records: SessionTelemetryRecord[] = []
  readonly coordinator: SessionTelemetryCoordinator

  constructor(ctx: Context) {
    super(ctx)
    this.coordinator = new SessionTelemetryCoordinator(ctx, this, { capture: 'live', includeHistory: true })
  }

  emit(record: SessionTelemetryRecord): void {
    this.records.push(structuredClone(record))
  }

  async shutdown(): Promise<void> {}
}

export default MemorySessionTelemetry
