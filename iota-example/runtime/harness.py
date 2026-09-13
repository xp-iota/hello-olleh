"""The one assembly hub shared by iota-example M01-M12.

Two providers, one assembly path:

* ``echo``    — the deterministic offline kernel. Explicit, network-free, no credentials.
* ``minimax`` — the real kernel: ``ClaudeAdapter`` driven against MiniMax's
  Anthropic-compatible endpoint. iota's replacement unit is a whole kernel, so this is what
  "run iota on MiniMax" means; the orchestration layer above is untouched.

Selection is explicit (``IOTA_PROVIDER`` or the ``provider=`` argument) and there is no
fallback: asking for ``minimax`` without credentials, without ``claude-agent-sdk`` or without
the CLI raises before a single module starts. A silent downgrade to ``echo`` would make the
real acceptance run meaningless.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from iota_core.adapters.base import KernelAdapter
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

from runtime.env import load_project_env
from runtime.kernel_echo import EchoKernelAdapter
from runtime.kernel_minimax import (
    KernelUnavailable,
    build_adapter,
    create_workspace,
    preflight,
)

OFFLINE_PROVIDER = "echo"
REAL_PROVIDER = "minimax"
PROVIDERS = (OFFLINE_PROVIDER, REAL_PROVIDER)


def selected_provider(provider: str | None = None) -> str:
    """Resolve the provider from the argument, then ``IOTA_PROVIDER``, then offline."""
    load_project_env()
    value = (provider or os.environ.get("IOTA_PROVIDER") or OFFLINE_PROVIDER).strip().lower()
    if value not in PROVIDERS:
        raise KernelUnavailable(
            f"未知 IOTA_PROVIDER={value!r}；可选：{', '.join(PROVIDERS)}。"
            " 真实模式用 minimax，离线确定性演示用 echo。"
        )
    return value


@dataclass(slots=True)
class WorkshopHarness:
    """Own all process registrations and runtime resources for one example."""

    effects: EffectStack
    registry: Registry
    adapter: KernelAdapter
    conversation_store: InMemoryConversationStore
    run_store: InMemoryRunStore
    runtime: IotaRuntime
    provider: str = OFFLINE_PROVIDER
    kernel: str = OFFLINE_PROVIDER
    model: str | None = None
    capabilities: KernelCapabilities | None = None
    preflight_report: dict[str, str] = field(default_factory=dict)
    #: 真实内核进程的工作目录（离线模式为 None）。示例只能通过它给内核准备输入。
    workspace: Path | None = None

    @property
    def real(self) -> bool:
        """True only for the MiniMax-backed kernel; used to pick real vs deterministic probes."""
        return self.provider == REAL_PROVIDER

    async def start(self) -> WorkshopHarness:
        missing = missing_host_capabilities(self.adapter.requires)
        if missing:
            hints = "; ".join(host_capability_hint(item) for item in missing)
            raise RuntimeError(
                f"{self.kernel} kernel has unmet host capabilities {missing}: {hints}"
            )
        await self.adapter.start()
        self.capabilities = KernelCapabilities.from_adapter_payload(
            await self.adapter.capabilities()
        )
        return self

    def agent(self, *, name: str, **config: Any) -> Agent:
        if self.model is not None:
            config.setdefault("model", self.model)
        return self.runtime.create_agent(AgentConfig(name=name, kernel=self.kernel, **config))

    async def run(self, prompt: str, *, name: str = "workshop-agent") -> AgentResult:
        return await self.runtime.run(self.agent(name=name), prompt)

    async def stream(self, prompt: str, *, name: str = "workshop-agent") -> list[AgentEvent]:
        return [event async for event in self.runtime.stream(self.agent(name=name), prompt)]

    async def close(self) -> None:
        await self.runtime.close()
        await self.effects.adispose()


async def create_harness(
    provider: str | None = None,
    *,
    allow_shell: bool = False,
) -> WorkshopHarness:
    """Assemble the registry, effects, provider, stores and adapter in one place."""
    resolved = selected_provider(provider)
    effects = EffectStack("iota-example")
    registry = Registry()
    conversation_store = InMemoryConversationStore()
    run_store = InMemoryRunStore()

    adapter: KernelAdapter
    report: dict[str, str] = {}
    model: str | None = None
    workspace: Path | None = None
    if resolved == REAL_PROVIDER:
        # Fail before any module runs: credentials, SDK and CLI are all checked here.
        report = preflight()
        workspace = create_workspace()
        adapter = build_adapter(allow_shell=allow_shell, workspace=workspace)
        kernel = adapter.name
        model = report["model"]
        effects.push(
            register_adapter(
                kernel,
                lambda _build: build_adapter(allow_shell=allow_shell, workspace=workspace),
            ),
            f"provider:{kernel}",
        )
    else:
        adapter = EchoKernelAdapter()
        kernel = adapter.name
        effects.push(
            register_adapter(kernel, lambda _build: EchoKernelAdapter()),
            f"provider:{kernel}",
        )

    runtime = IotaRuntime(
        adapters={kernel: adapter},
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
        provider=resolved,
        kernel=kernel,
        model=model,
        preflight_report=report,
        workspace=workspace,
    )
    return await harness.start()
