"""Load a teaching module, enforce offline execution, and explain observations."""

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
from runtime.teaching import LESSONS, print_after, print_before

Scenario = Callable[[WorkshopHarness], Awaitable[dict[str, Any]]]
ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path) -> ModuleType:
    name = f"iota_example_{path.parent.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def resolve_module(selector: str) -> Path:
    exact = ROOT / selector
    if exact.name in LESSONS and exact.is_dir():
        return exact
    matches = sorted(ROOT.glob(f"{selector.upper()}-*"))
    if len(matches) != 1 or matches[0].name not in LESSONS:
        choices = ", ".join(path[:3] for path in LESSONS)
        raise RuntimeError(f"unknown module {selector!r}; choose one of: {choices}")
    return matches[0]


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


def run_module(module_dir: Path) -> None:
    lesson = print_before(module_dir)
    lesson_file = next(module_dir.glob("lesson_m*.py"))
    result = asyncio.run(_execute(lesson_file))
    print_after(lesson, result)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    print(f"IOTA_MODULE_OK {module_dir.name}")


def main() -> int:
    if len(sys.argv) != 2:
        print("用法：python -m runtime.runner M01", file=sys.stderr)
        return 2
    run_module(resolve_module(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
