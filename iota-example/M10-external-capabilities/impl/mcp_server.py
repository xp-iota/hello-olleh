"""进程内 MCP server：注册一个 `greet` 工具，用 JSON-RPC 消息驱动。

外部能力接入的边界在协议上：同一套 `tools/list` / `tools/call` 消息，换成跨进程 server 也成立，
所以示例不需要网络就能观察完整往返。
"""

from __future__ import annotations

from typing import Any

from iota_core.mcp.server import IotaMcpServer
from iota_core.types import ToolDef

TOOL = "greet"


def greeter_server() -> IotaMcpServer:
    server = IotaMcpServer(name="m10-server", version="1.0.0")
    server.register_tool(
        ToolDef(
            name=TOOL,
            description="Return a greeting",
            input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
        ),
        lambda arguments: f"hello {arguments['name']}",
    )
    return server


def request(method: str, params: dict[str, Any], *, request_id: int = 1) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
