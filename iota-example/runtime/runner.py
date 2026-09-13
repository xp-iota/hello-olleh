"""Load a teaching module and explain what was observed.

Two entry modes, chosen explicitly:

* offline (default) — deterministic echo kernel, outbound network blocked in-process,
  ends with ``IOTA_MODULE_OK``.
* ``--real`` — MiniMax-backed kernel. The module first proves the real kernel answered, then
  runs the same orchestration-layer assertions, and ends with ``IOTA_REAL_MODULE_OK``.
  There is no fallback: a missing credential, SDK or CLI aborts before the module starts.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import ModuleType
from typing import Any, cast

from runtime.harness import REAL_PROVIDER, WorkshopHarness, create_harness, selected_provider
from runtime.kernel_minimax import resolve_cli
from runtime.network_guard import install_network_guard
from runtime.teaching import LESSONS, Lesson, print_after, print_before, print_real, require

Scenario = Callable[[WorkshopHarness], Awaitable[dict[str, Any]]]
ROOT = Path(__file__).resolve().parents[1]

#: Modules whose whole point is that the *kernel* owns shell execution.
SHELL_MODULES = frozenset({"M07-execution-backends"})


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


def _redact(value: str, limit: int = 96) -> str:
    """Evidence must carry no credential, endpoint or local path."""
    import os
    import re

    out = value
    token = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
    if len(token) > 6:
        out = out.replace(token, "<redacted-key>")
    out = re.sub(r"https?://[^\s\"')]+", "<anthropic-compatible>", out)
    out = re.sub(r"/(?:Users|home|private|var|tmp)/[^\s\"')]+", "<path>", out)
    out = " ".join(out.split())
    return out if len(out) <= limit else f"{out[:limit]}…"


#: A network-backed kernel can return an empty turn. Retry a bounded number of times, out loud,
#: and still fail if it stays empty — retrying the *same real kernel* is not a fallback, whereas
#: quietly accepting an empty answer (or switching to echo) would be.
PROBE_ATTEMPTS = 3


async def _kernel_evidence(harness: WorkshopHarness, lesson: Lesson) -> dict[str, Any]:
    """Run one real MiniMax-backed turn and turn it into printable, redacted evidence."""
    require(harness.real, "真实模式使用 MiniMax-backed kernel", harness.provider)
    require(harness.kernel != "echo", "真实模式不得回退到 echo 内核", harness.kernel)
    text = ""
    events: list[str] = []
    init_models: list[Any] = []
    for attempt in range(1, PROBE_ATTEMPTS + 1):
        result = await harness.run(lesson.real_prompt(), name=f"real-probe-{attempt}")
        events = [event.type for event in result.events]
        init_models = [
            getattr(event, "model", None) for event in result.events if event.type == "system_init"
        ]
        text = (result.final_text or "").strip()
        if text:
            break
        print(
            f"真实内核第 {attempt} 次返回空文本（事件：{', '.join(events) or '无'}）；"
            f"重试 {attempt}/{PROBE_ATTEMPTS}，不会退回 echo 内核"
        )
    require(bool(text), f"真实内核在 {PROBE_ATTEMPTS} 次尝试内返回非空文本", text)
    require("final" in events, "真实运行产生终止事件", events)
    model = next((str(item) for item in init_models if item), harness.model or "unknown")
    return {
        "kernel": harness.kernel,
        "model": model,
        "sdk": harness.preflight_report.get("sdk", "claude-agent-sdk"),
        "cli": harness.preflight_report.get("cli", Path(resolve_cli() or "claude").name),
        "response": _redact(text),
        "events": events,
        "chars": len(text),
    }


async def _execute_offline(path: Path) -> dict[str, Any]:
    restore_network = install_network_guard()
    harness = await create_harness("echo")
    try:
        scenario = cast(Scenario, _load(path).run)
        result = await scenario(harness)
        if result.get("status") != "ok":
            raise RuntimeError(f"module returned non-ok status: {result}")
        return result
    finally:
        await harness.close()
        restore_network()


async def _execute_real(path: Path, lesson: Lesson) -> tuple[dict[str, Any], dict[str, Any]]:
    harness = await create_harness("minimax", allow_shell=path.parent.name in SHELL_MODULES)
    try:
        evidence = await _kernel_evidence(harness, lesson)
        scenario = cast(Scenario, _load(path).run)
        result = await scenario(harness)
        if result.get("status") != "ok":
            raise RuntimeError(f"module returned non-ok status: {result}")
        return result, evidence
    finally:
        await harness.close()


def run_module(module_dir: Path, *, real: bool = False) -> None:
    lesson = print_before(module_dir)
    lesson_file = next(module_dir.glob("lesson_m*.py"))
    if not real:
        result = asyncio.run(_execute_offline(lesson_file))
        print_after(lesson, result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        print(f"IOTA_MODULE_OK {module_dir.name}")
        return
    result, evidence = asyncio.run(_execute_real(lesson_file, lesson))
    print_real(lesson, evidence)
    print_after(lesson, result)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    print(
        f"IOTA_REAL_MODULE_OK {module_dir.name} kernel={evidence['kernel']}"
        f" model={evidence['model']} chars={evidence['chars']} events={len(evidence['events'])}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="运行一个 iota 教学模块")
    parser.add_argument("module", help="模块选择器，例如 M01")
    parser.add_argument(
        "--real",
        action="store_true",
        help="用 MiniMax-backed kernel 真实运行（等价于 IOTA_PROVIDER=minimax）",
    )
    args = parser.parse_args()
    # 两条等价的开关：显式 --real，或 IOTA_PROVIDER=minimax。
    # selected_provider 对拼错的值直接抛错，所以打错开关不会静默跑成离线。
    real = args.real or selected_provider() == REAL_PROVIDER
    run_module(resolve_module(args.module), real=real)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
