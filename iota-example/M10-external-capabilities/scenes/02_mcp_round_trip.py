"""MCP 往返：同一套 tools/list 与 tools/call 消息，在进程内也完整成立。"""

from __future__ import annotations

from typing import Any

from impl.mcp_server import TOOL, greeter_server, request

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    server = greeter_server()
    listed = require_not_none(
        await server.handle_message(request("tools/list", {})), "MCP tools/list 返回响应"
    )
    called = require_not_none(
        await server.handle_message(
            request("tools/call", {"name": TOOL, "arguments": {"name": "iota"}}, request_id=2)
        ),
        "MCP tools/call 返回响应",
    )
    names = [tool["name"] for tool in listed["result"]["tools"]]
    text = called["result"]["content"][0]["text"]
    require(names == [TOOL], f"MCP 列出 {TOOL} 工具", listed)
    require(text == "hello iota", "MCP 调用返回问候", called)
    return {"tools": names, "call_result": text, "transport": "in-process"}
