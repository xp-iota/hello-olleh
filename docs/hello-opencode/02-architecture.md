---
title: "OpenCode v2 Architecture"
---
# OpenCode v2 Architecture

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`).

## Ownership layers

OpenCode v2 separates semantic ownership from transport and presentation:

1. **Schema** defines stable public values and durable event payloads.
2. **Protocol** composes typed HTTP operations from those values.
3. **Core** implements runtime behavior, projections, persistence, Location-scoped services, and process-local execution coordination.
4. **Server** binds Protocol operations to handlers and owns public SSE encoding and per-connection delivery.
5. **Clients and UIs** consume the assembled API instead of importing Core internals.

This split allows Server delivery strategies to change without altering OpenAPI or generated clients, as demonstrated by the shared encoded event feed.

## Location and host scopes

A Session has durable identity independent of its current Location. Location-scoped services include the runner, model resolution, tools, permissions, plugins, and filesystem. Host-scoped services retain process-wide coordination and durable Session admission. Movement changes where later operations resolve services; it does not create a second Session identity.

`LocationServiceMap` is the boundary for selecting Location services. ID-bound Session values retain an ID, not a permanently cached runner or projection.

## Event architecture

Core owns event meaning, publication, persistence, replay, and projection. Server subscribes once, filters public events, encodes each accepted event once, and offers the immutable SSE frame to one bounded queue per connection. A slow connection can overflow independently without blocking healthy connections.

## Source anchors

- [`packages/core/src/location-service-map.ts`](../../sources/opencode/packages/core/src/location-service-map.ts)
- [`packages/core/src/session.ts`](../../sources/opencode/packages/core/src/session.ts)
- [`packages/server/src`](../../sources/opencode/packages/server/src)
- [Event stream decision](../../sources/opencode/specs/v2/event-stream-architecture.md)
