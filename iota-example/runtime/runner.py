"""模块编排入口：读阶段清单、跑场景、按阶段核验真实调用证据。

与 `dsh-example/runtime/harness.ts` 的 `runModule()` 严格对位，日志骨架逐行一致：

    ████ MXX · 标题 ████
    provider=anthropic-compat model=… timeout=…ms

    ──── MXX.n · 阶段标题 ────
    <场景观察到的事实>
    REAL_STAGE_OK MXX.n calls=… ms=… in=… out=… finish=…

    REAL_MODULE_OK MXX stages=… calls=… failed=…

只有一种运行模式，而且是真实的：每个阶段都必须留下真实内核调用证据，否则 fail loud。
`mechanism` 阶段先做一次入口 probe（完整装配链 + 真实内核），再跑本地机制断言；
`model` 阶段直接跑场景，场景内部自己调用内核。缺凭证、缺 SDK 或缺 CLI 在模块开始前就失败。
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import io
import os
import subprocess
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Literal, cast

from runtime.harness import (
    MODULE_TITLES,
    REAL_PROVIDER,
    REAL_TIMEOUT_MS,
    CallEvidence,
    WorkshopHarness,
    all_evidence,
    create_harness,
    kernel_settings,
    preflight,
    provider_label,
    require,
    sample,
    selected_provider,
)

#: 一个场景：拿到装配好的 harness，返回这次观察到的事实。
Scene = Callable[[WorkshopHarness], Awaitable[dict[str, Any]]]

# 管道/subprocess 调用（例如 `uv run python run.py | tee`）会让 stdout 变成非 tty，
# CPython 默认切到全缓冲：print() 的内容会积在内存里，直到缓冲区满或进程退出才落地，
# 中间夹杂的子进程输出（如内核 CLI 的 stderr）就会先冒出来，看起来像是"卡住不动"。
# 显式切到行缓冲，保证每条 REAL_STAGE_OK / 阶段标题都实时可见，不依赖调用方设置
# PYTHONUNBUFFERED。stdout 被替换成非 TextIOWrapper（如 pytest 的捕获对象）时跳过。
if isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout.reconfigure(line_buffering=True)

ROOT = Path(__file__).resolve().parents[1]

#: 阶段类型：`model` 由内核驱动，`mechanism` 断言本地机制 + 入口 probe。
StageKind = Literal["model", "mechanism"]


@dataclass(frozen=True, slots=True)
class Stage:
    """阶段：`run.py` 里的编排单位，编号与 `dsh-example` 同一编号空间。

    `scene` 是 `scenes/` 下的文件名（不带 `.py`）；`shell` 表示这一阶段需要内核自带的
    Bash 工具（执行侧演示），其余阶段的内核工具全部关闭。
    """

    id: str
    title: str
    kind: StageKind
    scene: str
    shell: bool = False


# ── 模块与场景加载 ─────────────────────────────────────────────────────────
def resolve_module(selector: str) -> Path:
    """把 `M02` 或完整目录名解析成模块目录。"""
    exact = ROOT / selector
    if exact.name in MODULE_TITLES and exact.is_dir():
        return exact
    matches = sorted(ROOT.glob(f"{selector.upper()}-*"))
    if len(matches) != 1 or matches[0].name not in MODULE_TITLES:
        choices = ", ".join(name[:3] for name in MODULE_TITLES)
        raise RuntimeError(f"unknown module {selector!r}; choose one of: {choices}")
    return matches[0]


#: 当前作为顶层导入根的模块目录；切换模块时先把上一个撤掉。
_import_root: str | None = None

#: 模块内部使用的顶层包名。切换模块时必须连同已导入的同名包一起丢弃。
MODULE_PACKAGES = frozenset({"impl", "run", "scenes"})


def _use_module_dir(module_dir: Path) -> None:
    """把模块目录设为顶层导入根。

    模块目录名带连字符，不能出现在 import 语句里，所以模块内部统一用顶层 `impl.*` /
    `scenes.*` 导入：runner 加载与直接 `python <模块>/run.py` 得到同一种写法。
    一次只运行一个模块，换模块时撤掉上一个导入根并丢弃它的同名包。
    """
    global _import_root
    root = str(module_dir)
    if _import_root == root:
        return
    if _import_root is not None:
        if _import_root in sys.path:
            sys.path.remove(_import_root)
        for name in [item for item in sys.modules if item.split(".")[0] in MODULE_PACKAGES]:
            del sys.modules[name]
    sys.path.insert(0, root)
    _import_root = root


def load_stages(module_dir: Path) -> tuple[Stage, ...]:
    """读取模块 `run.py` 声明的阶段清单。"""
    _use_module_dir(module_dir)
    stages = cast("tuple[Stage, ...]", importlib.import_module("run").STAGES)
    require(bool(stages), f"{module_dir.name}/run.py 声明了阶段清单", stages)
    return stages


def load_scene(module_dir: Path, name: str) -> ModuleType:
    """加载一个 `scenes/` 场景脚本。"""
    _use_module_dir(module_dir)
    return importlib.import_module(f"scenes.{name}")


# ── 入口 probe ─────────────────────────────────────────────────────────────
#: 联网内核可能返回空轮次。有限次数、出声重试后仍然失败 —— 重试**同一个真实内核**不是回退，
#: 而静默接受空回答（或换一个模型顶上）才是。
PROBE_ATTEMPTS = 3


async def probe_assembly(stage_id: str, *, allow_shell: bool) -> None:
    """入口 probe：用完整装配链（全部存储 + 真实内核适配器）打一次真实请求。

    它证明的不是"HTTP 通了"，而是"这条装配链能把真实内核回答送回运行记录"——纯机制阶段
    因此也有真实证据，而不是只拼配置。不打印回复：结果落在证据账本里，由本阶段的
    REAL_STAGE_OK 行汇总，避免与阶段正文抢版面。
    """
    harness = await create_harness(REAL_PROVIDER, allow_shell=allow_shell)
    try:
        for attempt in range(1, PROBE_ATTEMPTS + 1):
            result = await harness.run(
                # 复述型指令：内核没有拒答的理由，probe 因此只在链路真的断了时才失败。
                f"请把下面这句话原样复述一遍，不要加任何别的内容：装配链已连通 {stage_id}",
                name=f"probe-{stage_id}-{attempt}",
            )
            if (result.final_text or "").strip():
                return
            print(
                f"内核第 {attempt} 次返回空文本；重试 {attempt}/{PROBE_ATTEMPTS}，"
                "不会换用其他模型"
            )
        raise RuntimeError(
            f"REAL_STAGE_FAIL {stage_id} 入口 probe 在 {PROBE_ATTEMPTS} 次尝试内没拿到非空文本"
        )
    finally:
        await harness.close()


# ── 阶段与模块执行 ─────────────────────────────────────────────────────────
def print_facts(facts: dict[str, Any]) -> None:
    for key, value in facts.items():
        print(f"   {key} = {_render(value)}")


def _render(value: Any) -> str:
    if isinstance(value, str):
        return sample(value, 160)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_render(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{key}: {_render(item)}" for key, item in value.items()) + "}"
    return str(value)


def report_stage(stage: Stage, slice_: list[CallEvidence]) -> None:
    """按 dsh 的规则核验并汇总一个阶段的真实证据。"""
    failures = [item for item in slice_ if item.failure]
    if failures:
        raise RuntimeError(
            f"REAL_STAGE_FAIL {stage.id} 真实调用失败："
            + " / ".join(str(item.failure) for item in failures)
        )
    # 内核把失败当"错误最终事件"送回（而不是抛异常）时——认证失败、限流、内部错误——
    # 错误文案本身是非空文本，若只查空文本就会把 403 放行成 REAL_STAGE_OK。dsh 侧的
    # 对应口径是"调用失败"：适配器抛错记 failure；这里等价地按 finish=error 判失败。
    errored = [item for item in slice_ if item.finish == "error"]
    if errored:
        raise RuntimeError(
            f"REAL_STAGE_FAIL {stage.id} 内核返回错误终态："
            + " / ".join(item.text_sample or item.finish for item in errored)
        )
    if not slice_:
        raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 本阶段没有产生任何内核调用证据")
    answered = [item for item in slice_ if item.text_chars > 0 or item.tool_calls]
    if not answered:
        raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 真实调用返回空文本且无工具调用")
    best = answered[-1]
    tools = [name for item in slice_ for name in item.tool_calls]
    line = (
        f"REAL_STAGE_OK {stage.id}"
        f" calls={len(slice_)} ms={sum(item.ms for item in slice_)}"
        f" in={sum(item.input_tokens for item in slice_)}"
        f" out={sum(item.output_tokens for item in slice_)}"
        f" finish={best.finish}"
    )
    if tools:
        line += f" tools={','.join(tools)}"
    if stage.kind == "model" and best.text_sample:
        line += f' "{sample(best.text_sample, 40)}"'
    print(line)


async def _execute(module_dir: Path, stages: tuple[Stage, ...]) -> None:
    allow_shell = any(stage.shell for stage in stages)
    harness = await create_harness(REAL_PROVIDER, allow_shell=allow_shell)
    try:
        for stage in stages:
            before = len(all_evidence())
            print(f"\n──── {stage.id} · {stage.title} ────")
            if stage.kind == "mechanism":
                await probe_assembly(stage.id, allow_shell=stage.shell)
            scene = cast("Scene", load_scene(module_dir, stage.scene).run)
            facts = await scene(harness)
            require(bool(facts), f"阶段 {stage.id} 至少观察到一条事实", facts)
            print_facts(facts)
            report_stage(stage, list(all_evidence()[before:]))
    finally:
        await harness.close()


def run_module(module_dir: Path, *, scene: str | None = None) -> None:
    """跑一个模块：banner → 逐阶段（probe + 场景 + 证据）→ 模块汇总行。"""
    stages = load_stages(module_dir)
    if scene is not None:
        stages = tuple(item for item in stages if scene in {item.scene, item.id})
        if not stages:
            raise RuntimeError(f"unknown scene: {scene!r}")
    module = module_dir.name[:3]
    settings = kernel_settings()
    print(f"\n████ {module} · {MODULE_TITLES[module_dir.name]} ████")
    print(
        f"provider={provider_label()} kernel={settings.kernel}"
        f" model={settings.model} timeout={REAL_TIMEOUT_MS}ms"
    )
    asyncio.run(_execute(module_dir, stages))
    evidence = all_evidence()
    failed = len([item for item in evidence if item.failure])
    print(
        f"\nREAL_MODULE_OK {module} stages={len(stages)}"
        f" calls={len(evidence)} failed={failed}"
    )


def module_main(entry: str) -> None:
    """模块 `run.py` 的 `__main__` 入口：`python <模块>/run.py [--scene ...]`。"""
    module_dir = Path(entry).resolve().parent
    stages = load_stages(module_dir)
    parser = argparse.ArgumentParser(description=f"运行 {MODULE_TITLES[module_dir.name]}")
    parser.add_argument(
        "--scene",
        choices=[item.scene for item in stages],
        help="只跑清单里的一个场景",
    )
    selected_provider()
    run_module(module_dir, scene=parser.parse_args().scene)


def run_all_modules() -> int:
    """在隔离子进程里依次运行 12 个模块，并核验阶段总数。"""
    modules = sorted(ROOT.glob("M[0-9][0-9]-*"))
    if len(modules) != 12:
        raise RuntimeError(f"expected 12 modules, found {len(modules)}")
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["IOTA_PROVIDER"] = REAL_PROVIDER
    report = preflight()
    print(
        "REAL_PREFLIGHT_OK "
        f"kernel={report['kernel']} vendor={report['vendor']} model={report['model']}"
        f" sdk={report['sdk']} cli={report['cli']}"
    )

    expected = sum(len(load_stages(module)) for module in modules)
    for module in modules:
        print("\n══════════════════════════════════════════════════════════════")
        print(f"  ▶ 运行模块 {module.name}")
        print("══════════════════════════════════════════════════════════════")
        command = [sys.executable, "-m", "runtime.runner", module.name]
        completed = subprocess.run(command, cwd=ROOT, env=env, check=False, text=True)
        if completed.returncode != 0:
            return completed.returncode

    print(f"\nREAL_ALL_OK modules=12 stages={expected} provider={provider_label()}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="运行一个或全部 iota 对照模块")
    parser.add_argument("module", nargs="?", help="模块选择器，例如 M01")
    parser.add_argument("--scene", help="只跑该模块清单里的一个场景")
    parser.add_argument("--all", action="store_true", help="在隔离子进程中运行全部 12 个模块")
    args = parser.parse_args()
    if args.all and args.module:
        parser.error("module 与 --all 不能同时使用")
    if not args.all and not args.module:
        parser.error("请提供模块选择器，或使用 --all")
    # 显式核验 provider，避免 IOTA_PROVIDER 拼错时被静默忽略。
    selected_provider()
    if args.all:
        return run_all_modules()
    run_module(resolve_module(args.module), scene=args.scene)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
