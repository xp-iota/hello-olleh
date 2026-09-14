---
title: "OpenCode v2 Overview"
---
# OpenCode v2 Overview

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`). This chapter describes the v2 package layout, not the removed v1 `packages/opencode` tree.

OpenCode v2 is a set of packages with explicit ownership boundaries. Public shapes live in **Schema**, HTTP operations in **Protocol**, execution and persistence in **Core**, transport delivery in **Server**, and user-facing processes in **CLI/TUI**. The public tool type belongs to **Plugin**; Core owns registration and execution.

## Package responsibilities

| Package | Responsibility |
| --- | --- |
| `packages/schema` | Public domain shapes and durable event payloads |
| `packages/protocol` | HTTP endpoint definitions and transport errors |
| `packages/core` | Session execution, persistence, tools, permissions, catalog, plugins, and locations |
| `packages/server` | HTTP handlers, SSE delivery, encoding, and connection lifecycle |
| `packages/plugin` | Public plugin and `Tool.make` contracts |
| `packages/client`, `packages/sdk` | Generated and authored client surfaces |
| `packages/cli`, `packages/tui` | Command-line entry points and terminal UI |

The complete repository contains additional focused packages such as `ai`, `codemode`, `desktop`, `session-ui`, `ui`, and `web`. Treat package-local code and contributor guidance as authoritative for those surfaces.

## Reading order

1. [Architecture](02-architecture.md)
2. [Session runtime](03-session-runtime.md)
3. [Context and state](04-context-and-state.md)
4. [Tools and extensions](05-tools-and-extensions.md)
5. [Security, resilience, and operations](06-security-resilience-and-operations.md)
6. [Source reference](07-source-reference.md)

## Authority

- [V2 specifications](../../sources/opencode/specs/v2/README.md)
- [Schema source](../../sources/opencode/packages/schema/src)
- [Protocol source](../../sources/opencode/packages/protocol/src)
- [Core source](../../sources/opencode/packages/core/src)
