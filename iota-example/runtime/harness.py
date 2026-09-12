"""The one assembly hub shared by iota-example M01-M12."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from iota_core.agent import Agent
from iota_core.capabilities import host_capability_hint, missing_host_capabilities
from iota_core.effects import EffectStack
from iota_core.graph import KernelCapabilities
from iota_core.providers import register_adapter
from iota_core.registry import Registry
from iota_core.runtime import IotaRuntime
from iota_core.storage.in_memory import InMemoryConversationStore
from iota_core.storage.run_store import InMemoryRunStore
from iota_core.types import AgentConfig, AgentEvent, AgentResult

from runtime.kernel_echo import EchoKernelAdapter


@dataclass(slots=True)
class WorkshopHarness:
    """Own all process registrations and runtime resources for one example."""

    effects: EffectStack
    registry: Registry
    adapter: EchoKernelAdapter
    conversation_store: InMemoryConversationStore
    run_store: InMemoryRunStore
    runtime: IotaRuntime
    capabilities: KernelCapabilities | None = None

    async def start(self) -> WorkshopHarness:
        missing = missing_host_capabilities(self.adapter.requires)
        if missing:
            hints = "; ".join(host_capability_hint(item) for item in missing)
            raise RuntimeError(f"echo kernel has unmet host capabilities {missing}: {hints}")
        await self.adapter.start()
        self.capabilities = KernelCapabilities.from_adapter_payload(
            await self.adapter.capabilities()
        )
        return self

    def agent(self, *, name: str, **config: Any) -> Agent:
        return self.runtime.create_agent(AgentConfig(name=name, kernel="echo", **config))

    async def run(self, prompt: str, *, name: str = "workshop-agent") -> AgentResult:
        return await self.runtime.run(self.agent(name=name), prompt)

    async def stream(self, prompt: str, *, name: str = "workshop-agent") -> list[AgentEvent]:
        return [event async for event in self.runtime.stream(self.agent(name=name), prompt)]

    async def close(self) -> None:
        await self.runtime.close()
        await self.effects.adispose()


async def create_harness() -> WorkshopHarness:
    """Assemble the registry, effects, provider, stores and adapter in one place."""
    effects = EffectStack("iota-example")
    registry = Registry()
    adapter = EchoKernelAdapter()
    conversation_store = InMemoryConversationStore()
    run_store = InMemoryRunStore()
    effects.push(register_adapter("echo", lambda _build: EchoKernelAdapter()), "provider:echo")
    runtime = IotaRuntime(
        adapters={"echo": adapter},
        registry=registry,
        conversation_store=conversation_store,
        run_store=run_store,
    )
    harness = WorkshopHarness(
        effects=effects,
        registry=registry,
        adapter=adapter,
        conversation_store=conversation_store,
        run_store=run_store,
        runtime=runtime,
    )
    return await harness.start()
