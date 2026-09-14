---
title: "OpenCode v2 Session Runtime"
---
# OpenCode v2 Session Runtime

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`).

## Admission before execution

`Session.prompt` first publishes a durable `session.inbox.enqueued` fact. Its projection inserts a `session_inbox` row before an advisory wake begins. Input becomes model-visible only when delivery consumes the inbox row and atomically inserts a user or synthetic message.

`resume` controls scheduling rather than durability: `false` records input without waking execution; omitted or `true` records it and schedules `SessionExecution.wake(sessionID)`. Steers deliver at the next safe step boundary. Queued input remains pending while execution can continue and is considered at idle boundaries after steers.

## Process-local ownership

`SessionExecution` is process-global and keyed by Session ID. Repeated wakes coalesce, explicit resumes join an active execution, and different Sessions may run concurrently. Interruption stops locally owned work but does not delete pending input.

A write-ahead execution claim supports bounded startup recovery. It cannot guarantee exactly-once provider requests or external tool effects; orphaned running tool projections are failed before continuation.

## Steps and attempts

A logical Step may use more than one physical provider attempt. Before an attempt, the runner reloads history, resolves agent/model, prepares instructions, and snapshots tools. Generic retry covers selected rate-limit, provider, transport, and incomplete-stream failures. The initial request plus at most four retries use jittered exponential backoff.

Local tool calls may execute concurrently, but every call reaches a durable terminal outcome before the Step emits its terminal event. Continuation reloads projected history and begins another Step; orchestration is not delegated to an in-memory tool loop.

## Source anchors

- [V2 Session Contract](../../sources/opencode/specs/v2/session.md)
- [`packages/core/src/session/session.ts`](../../sources/opencode/packages/core/src/session/session.ts)
- [`packages/core/src/session/inbox.ts`](../../sources/opencode/packages/core/src/session/inbox.ts)
- [`packages/core/src/session/execution.ts`](../../sources/opencode/packages/core/src/session/execution.ts)
- [`packages/core/src/session/runner`](../../sources/opencode/packages/core/src/session/runner)
