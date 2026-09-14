---
title: "OpenCode v2 Tools and Extensions"
---
# OpenCode v2 Tools and Extensions

> **Source baseline:** OpenCode `v2.0.2` (`ea5ae232`).

## One structural tool contract

`Tool.make` combines input schema, optional output schema, description, and execution. A response can contain:

- `output`: schema-validated ephemeral machine value for Code Mode;
- `content`: durable model-facing content;
- `metadata`: bounded tool-specific JSON for UI use.

Every invocation receives durable Session, agent, assistant-message, and call identities plus a progress callback. Effect interruption remains cancellation and must not be translated into a model-visible `ToolFailure`.

## Scoped registration and request snapshots

Tools receive names when registered. Registrations are Scope-owned overlays: the latest active registration wins, and closing it reveals the previous registration. Each model request snapshots effective tool definitions and executable values, so later registration changes affect later requests, not calls already advertised.

Core decodes input, executes the captured tool, validates output, normalizes and bounds model content, runs `execute.after` hooks, and returns one canonical outcome. Invalid input never executes; invalid output cannot become successful execution.

## Extensions and authority

Built-ins, static plugin tools, dynamic MCP tools, and manifest tools share the structural contract. They do not share authority. Trusted built-ins and Location plugins may capture filesystem and permission services unavailable to application tools. Trusted tools formulate permission assertions; the registry does not inject an ambient permission helper.

## Source anchors

- [V2 Tools Contract](../../sources/opencode/specs/v2/tools.md)
- [`packages/plugin/src`](../../sources/opencode/packages/plugin/src)
- [`packages/core/src/tool`](../../sources/opencode/packages/core/src/tool)
- [`packages/core/src/mcp`](../../sources/opencode/packages/core/src/mcp)
- [`packages/core/src/plugin`](../../sources/opencode/packages/core/src/plugin)
