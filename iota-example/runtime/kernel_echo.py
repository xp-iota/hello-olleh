"""Deterministic, fully offline KernelAdapter used by every teaching module."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from iota_core.adapters.base import KernelAdapter
from iota_core.types import (
    AgentConfig,
    AgentEvent,
    FinalEvent,
    McpServerConfig,
    Message,
    SessionHandle,
    SystemInitEvent,
    TextDeltaEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
    ToolDef,
)


class EchoKernelAdapter(KernelAdapter):
    """A real adapter implementation with deterministic events and no I/O."""

    name = "echo"
    provides = frozenset()
    requires = frozenset()

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.started = False
        self.closed = False
        self.sessions: dict[str, AgentConfig] = {}
        self.observed_prompts: list[str] = []
        self.observed_memory: list[list[Message]] = []

    async def start(self) -> None:
        self.started = True

    async def capabilities(self) -> dict[str, Any]:
        return {
            "streaming": True,
            "concurrent_sessions": True,
            "max_concurrency": 8,
            "per_session_model": True,
            "per_session_system_prompt": True,
            "per_session_skills": True,
            "per_session_middleware": False,
            "mcps": False,
            "incremental_tool_events": True,
            "enforces_max_iterations": True,
            "enforces_max_tool_calls": True,
            "enforces_token_budget": False,
        }

    async def create_session(
        self,
        cfg: AgentConfig,
        tools: list[ToolDef],
        mcps: list[McpServerConfig],
    ) -> SessionHandle:
        del tools, mcps
        session_id = f"echo-session-{len(self.sessions) + 1}"
        self.sessions[session_id] = cfg.model_copy(deep=True)
        return SessionHandle(
            session_id=session_id,
            kernel=self.name,
            extra={"model": cfg.model or "echo-v1"},
        )

    def has_session(self, session: SessionHandle) -> bool:
        return session.session_id in self.sessions

    async def stream(
        self,
        session: SessionHandle,
        prompt: str,
        memory: list[Message],
    ) -> AsyncIterator[AgentEvent]:
        self.observed_prompts.append(prompt)
        self.observed_memory.append(list(memory))
        yield SystemInitEvent(model=session.extra.get("model"), raw={"offline": True})
        if prompt.startswith("shell:"):
            command = prompt.removeprefix("shell:").strip()
            yield ToolCallStartEvent(
                id="kernel-shell-1", name="kernel.shell", args={"command": command}
            )
            output = f"echo-kernel handled shell request: {command}"
            yield ToolCallResultEvent(id="kernel-shell-1", ok=True, output=output)
            yield TextDeltaEvent(text=output)
            yield FinalEvent(text=output, session_id=session.session_id)
            return
        text = f"echo:{prompt}"
        yield TextDeltaEvent(text=text)
        yield FinalEvent(text=text, session_id=session.session_id)

    async def close(self, session: SessionHandle | None = None) -> None:
        if session is None:
            self.sessions.clear()
            self.closed = True
        else:
            self.sessions.pop(session.session_id, None)
