"""Assembly tests for the single real kernel.

The harness has exactly one kernel, and it is the Anthropic-compatible one. These tests pin
that shape without touching the network: assembling a harness without credentials fails loud,
and the module-scenario wiring stays a single definition.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from runtime.harness import (
    CONFIG_VARIABLES,
    KernelUnavailable,
    WorkshopHarness,
    create_harness,
    load_project_env,
)


def _clear_configuration() -> dict[str, str | None]:
    load_project_env()  # make sure the loader will not re-populate what we remove
    return {name: _pop(name) for name in CONFIG_VARIABLES}


def _pop(name: str) -> str | None:
    import os

    value = os.environ.pop(name, None)
    return value


def _restore(saved: dict[str, str | None]) -> None:
    import os

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value


async def test_harness_requires_a_configured_kernel() -> None:
    """没有配置就没有内核：装配阶段就失败，而不是换一个本地实现顶上。"""
    saved = _clear_configuration()
    try:
        with pytest.raises(KernelUnavailable):
            await create_harness()
    finally:
        _restore(saved)


def test_harness_has_no_substitute_kernel() -> None:
    root = Path(__file__).resolve().parents[1]
    sources = "\n".join(
        path.read_text(encoding="utf-8") for path in (root / "runtime").rglob("*.py")
    )
    assert "EchoKernelAdapter" not in sources
    assert "install_network_guard" not in sources
    assert "OfflineViolation" not in sources


def test_workshop_harness_exposes_one_provider() -> None:
    assert WorkshopHarness.__dataclass_fields__["provider"].default == "anthropic-compat"
    assert WorkshopHarness.__dataclass_fields__["kernel"].default == ""


def test_create_harness_has_one_definition() -> None:
    root = Path(__file__).resolve().parents[1]
    definitions: list[tuple[Path, int]] = []
    for path in root.rglob("*.py"):
        definitions.extend(
            (path, number)
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
            if line.startswith("async def create_harness(")
        )
    assert len(definitions) == 1
    assert definitions[0][0] == root / "runtime/harness.py"
