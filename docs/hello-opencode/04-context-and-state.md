---
title: "OpenCode v2 Context and State"
---
# OpenCode v2 Context and State

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`).

## Durable state and projections

The durable event log records Session-scoped facts; projections provide authoritative messages, pending input, context, retry state, and other read models. The live instance event stream is separate and does not provide replay guarantees.

Inbox identity makes prompt and synthetic admission idempotent when Session and input type match. Cross-Session or cross-type reuse fails. Manual compaction and movement are control items in the same inbox, forming explicit delivery boundaries.

## Instruction deltas

Instruction synchronization stores content-addressed values. `session.instructions.updated` maps changed source keys to SHA-256 hashes, with `removed` representing observed absence. Canonical bodies are stored once; later changes can add frozen chronological prose. There is no mutable instruction registry.

Instruction sources include built-ins, ambient discovery, selected-agent skills, references, MCP guidance, and API-managed entries. Movement preserves instruction state, while a committed revert resets it so the next boundary establishes a fresh baseline.

## Compaction

Compaction rebuilds active model history from a structured rolling summary and bounded recent context while retaining the full durable transcript. Provider-native continuation state does not cross a compaction boundary. One overflow-triggered compaction may rebuild the same logical Step only before durable assistant output or tool execution.

## Source anchors

- [`packages/core/src/session/history.ts`](../../sources/opencode/packages/core/src/session/history.ts)
- [`packages/core/src/session/instructions.ts`](../../sources/opencode/packages/core/src/session/instructions.ts)
- [`packages/core/src/session/instruction-state.ts`](../../sources/opencode/packages/core/src/session/instruction-state.ts)
- [`packages/core/src/session/compaction.ts`](../../sources/opencode/packages/core/src/session/compaction.ts)
- [`packages/core/src/session/projector.ts`](../../sources/opencode/packages/core/src/session/projector.ts)
