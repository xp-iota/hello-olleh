"""Resolve the renderer toolchain and run it identically on every platform.

This is the only module allowed to know about the host: executable lookup,
version gates and font availability. Nothing here reads course content, and
nothing in the content layer needs to know which operating system is running.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable

from .course import CourseError


class RuntimeError_(RuntimeError):
    """Raised when the local toolchain cannot satisfy the documented contract."""


def lusine_root() -> Path:
    """Locate the renderer checkout without hard-coding a platform path."""

    override = os.environ.get("LUSINE_ROOT")
    candidate = (
        Path(override).expanduser()
        if override
        else Path.home() / "coding" / "lusine-a-reves"
    )
    root = candidate.resolve()
    if not (root / "package.json").is_file() or not (root / "core" / "scripts").is_dir():
        raise RuntimeError_(
            f"lusine-a-reves checkout not found at {root}. "
            "Clone git@github.com:feuyeux/lusine-a-reves.git there or set LUSINE_ROOT."
        )
    return root


def which(command: str) -> str | None:
    """shutil.which resolves .cmd/.exe on Windows, so callers stay platform-free."""

    return shutil.which(command)


def require(command: str) -> str:
    found = which(command)
    if not found:
        raise RuntimeError_(f"required command not found on PATH: {command}")
    return found


def _parse_version(text: str) -> tuple[int, ...]:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
    if not match:
        raise RuntimeError_(f"cannot parse a version from {text!r}")
    return tuple(int(part) for part in match.groups())


def required_node_version(root: Path) -> tuple[int, ...]:
    """Read the renderer's own engine floor instead of duplicating the number."""

    engines = json.loads((root / "package.json").read_text(encoding="utf-8")).get("engines", {})
    declared = str(engines.get("node", "")).strip()
    if not declared:
        raise RuntimeError_("lusine package.json does not declare engines.node")
    return _parse_version(declared)


def node_version() -> tuple[int, ...]:
    node = require("node")
    result = subprocess.run([node, "--version"], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError_(f"node --version failed: {result.stderr.strip()}")
    return _parse_version(result.stdout)


def font_families(*stacks: str) -> list[str]:
    """Split CSS-style font stacks into concrete family names."""

    families: list[str] = []
    for stack in stacks:
        for part in stack.split(","):
            family = part.strip().strip("'\"")
            if family and family != "sans-serif" and family not in families:
                families.append(family)
    return families


def available_fonts(families: Iterable[str]) -> tuple[list[str], bool]:
    """Report which families this host can actually render.

    Returns (available, checked). `checked` is False when no font query tool
    exists, so callers can say "unverified" rather than claim success.
    """

    fc_list = which("fc-list")
    if not fc_list:
        return [], False
    result = subprocess.run([fc_list, ":", "family"], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return [], False
    installed = result.stdout.lower()
    return [family for family in families if family.lower() in installed], True


def npm_run(root: Path, script: str, args: list[str]) -> None:
    """Invoke an npm script with shell=False so quoting is identical everywhere."""

    npm = require("npm")
    command = [npm, "run", script]
    if args:
        command += ["--", *args]
    result = subprocess.run(command, cwd=root, check=False)
    if result.returncode != 0:
        raise RuntimeError_(f"npm run {script} failed with exit code {result.returncode}")


def uv_run(root: Path, args: list[str]) -> None:
    uv = require("uv")
    result = subprocess.run([uv, "run", *args], cwd=root, check=False)
    if result.returncode != 0:
        raise RuntimeError_(f"uv run {' '.join(args)} failed with exit code {result.returncode}")


def deck_has_narration(presentation: Path) -> bool:
    try:
        deck = json.loads(presentation.read_text(encoding="utf-8"))
    except OSError as error:
        raise CourseError(f"cannot read deck: {presentation} ({error})") from None
    return any(str(slide.get("narration", "")).strip() for slide in deck.get("slides", []))


def edge_runtime_python(root: Path) -> Path | None:
    """Locate the renderer's isolated Edge TTS runtime on either layout."""

    override = os.environ.get("EDGE_TTS_PYTHON")
    if override:
        candidate = Path(override).expanduser()
        return candidate if candidate.is_file() else None
    for relative in (
        Path(".tts-runtime/edge-tts/.venv/bin/python"),
        Path(".tts-runtime/edge-tts/.venv/Scripts/python.exe"),
    ):
        candidate = root / relative
        if candidate.is_file():
            return candidate
    return None


def describe(value: Any) -> str:
    return "ok" if value else "missing"
