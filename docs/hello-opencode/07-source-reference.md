---
title: "OpenCode v2 Source Reference"
---
# OpenCode v2 Source Reference

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`). Paths below are current package roots rather than line-number snapshots.

| Concern | Source |
| --- | --- |
| V2 semantic contracts | [`specs/v2`](../../sources/opencode/specs/v2) |
| Public domain schema | [`packages/schema/src`](../../sources/opencode/packages/schema/src) |
| HTTP operations | [`packages/protocol/src`](../../sources/opencode/packages/protocol/src) |
| Runtime and persistence | [`packages/core/src`](../../sources/opencode/packages/core/src) |
| Session facade/runtime | [`packages/core/src/session.ts`](../../sources/opencode/packages/core/src/session.ts), [`packages/core/src/session`](../../sources/opencode/packages/core/src/session) |
| Tools and MCP | [`packages/core/src/tool`](../../sources/opencode/packages/core/src/tool), [`packages/core/src/mcp`](../../sources/opencode/packages/core/src/mcp) |
| Plugins and catalog | [`packages/core/src/plugin`](../../sources/opencode/packages/core/src/plugin), [`packages/core/src/catalog.ts`](../../sources/opencode/packages/core/src/catalog.ts) |
| Server transport | [`packages/server/src`](../../sources/opencode/packages/server/src) |
| Plugin public contract | [`packages/plugin/src`](../../sources/opencode/packages/plugin/src) |
| CLI and TUI | [`packages/cli`](../../sources/opencode/packages/cli), [`packages/tui`](../../sources/opencode/packages/tui) |
| SDK and client | [`packages/sdk`](../../sources/opencode/packages/sdk), [`packages/client`](../../sources/opencode/packages/client) |

## Maintenance rule

Use the owning package for exact types and the v2 specifications for cross-package semantic laws. Historical decision records explain selected designs but are not current API references. Active work belongs in issues, not in these stable chapters.
