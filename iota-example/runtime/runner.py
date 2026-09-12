"""Load one hyphenated teaching module and enforce its offline contract."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import ModuleType
from typing import Any, cast

from runtime.harness import WorkshopHarness, create_harness
from runtime.network_guard import install_network_guard

Scenario = Callable[[WorkshopHarness], Awaitable[dict[str, Any]]]


def _load(path: Path) -> ModuleType:
    name = f"iota_example_{path.parent.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


async def _execute(path: Path) -> dict[str, Any]:
    restore_network = install_network_guard()
    harness = await create_harness()
    try:
        scenario = cast(Scenario, _load(path).run)
        result = await scenario(harness)
        if result.get("status") != "ok":
            raise RuntimeError(f"module returned non-ok status: {result}")
        return result
    finally:
        await harness.close()
        restore_network()


def run_module_file(path: Path) -> None:
    result = asyncio.run(_execute(path.resolve()))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    print(f"IOTA_MODULE_OK {path.parent.name}")
