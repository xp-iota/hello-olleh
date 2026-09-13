"""M10: filesystem Skills and an in-process MCP server."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from iota_core.mcp.server import IotaMcpServer
from iota_core.skill_sync import sync_skills
from iota_core.types import ToolDef

from runtime.harness import WorkshopHarness
from runtime.teaching import require, require_not_none


async def run(_harness: WorkshopHarness) -> dict[str, Any]:
    with TemporaryDirectory(prefix="iota-m10-") as temp:
        root = Path(temp)
        source = root / "source" / "greeter"
        source.mkdir(parents=True)
        (source / "SKILL.md").write_text(
            "---\nname: offline-greeter\n---\n# Offline greeter\n",
            encoding="utf-8",
        )
        sync = sync_skills(root / "source", hermes_home=root / "kernel-home", quiet=True)
        require(sync["copied"] == ["offline-greeter"], "同步一个离线 Skill", sync)

        server = IotaMcpServer(name="m10-offline", version="1.0.0")
        server.register_tool(
            ToolDef(
                name="greet",
                description="Return an offline greeting",
                input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
            ),
            lambda arguments: f"hello {arguments['name']}",
        )
        listed = await server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        )
        called = await server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "greet", "arguments": {"name": "iota"}},
            }
        )
        listed = require_not_none(listed, "MCP tools/list 返回响应")
        called = require_not_none(called, "MCP tools/call 返回响应")
        require(listed["result"]["tools"][0]["name"] == "greet", "MCP 列出 greet 工具", listed)
        require(
            called["result"]["content"][0]["text"] == "hello iota", "MCP 调用返回离线问候", called
        )
    return {
        "module": "M10",
        "status": "ok",
        "relationship": "语义等价",
        "skill": "offline-greeter",
        "mcp": "hello iota",
    }
