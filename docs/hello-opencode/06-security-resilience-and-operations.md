---
title: "OpenCode v2 Security, Resilience, and Operations"
---
# OpenCode v2 Security, Resilience, and Operations

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`).

## Permissions and provider policy

Tool implementations request permission with durable invocation identity and concrete resources. Policy evaluation remains separate from tool registration.

Provider policy controls `provider.use` independently from provider configuration. Matching uses wildcard action/resource patterns; statements apply in order and the last match wins. Evaluation starts from the caller's fallback, which is `allow` for provider use. Authored policy documents are reversed so user-global policy can override repository policy; future organization-managed policy has final authority.

## Event-stream isolation

Server encodes each public event once and offers the shared immutable frame to an independent dropping queue for each connection. Capacity remains 4,096 accepted public frames. Overflow removes and fails only the slow connection; publication and healthy queues continue in order. Encoding failure terminates current subscribers to avoid silent gaps but leaves the feed available to later connections.

## Recovery limits

Scheduled retry is narrow and observable. Process recovery uses durable claims and bounded attempt accounting, but does not promise exactly-once external effects. Producer capture limits, registry model-output bounding, HTTP buffering, and queue capacity are separate limits and must report loss at their own boundary.

## Operational checks

- Validate Core event, event-logger, Session, tool, and permission suites after semantic changes.
- Validate Protocol/OpenAPI when endpoint definitions change; Server-only queue implementation changes should not alter generated clients.
- Monitor event rate, queue high-water marks, overflow/reconnect frequency, frame sizes, heap/RSS, and downstream drain time before tuning capacity.

## Source anchors

- [Provider policy](../../sources/opencode/specs/v2/provider-policy.md)
- [Event stream architecture](../../sources/opencode/specs/v2/event-stream-architecture.md)
- [`packages/core/src/permission.ts`](../../sources/opencode/packages/core/src/permission.ts)
- [`packages/core/src/session/runner/retry.ts`](../../sources/opencode/packages/core/src/session/runner/retry.ts)
