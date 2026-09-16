"""`workshop` CLI: one OS-neutral entry point for the whole course build."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from . import runtime
from .course import CourseError, episode_paths, find_episode, load_course, workshop_root
from .scaffold import build_deck, write_deck


def _course() -> tuple[Path, dict[str, Any]]:
    root = workshop_root()
    course = load_course(root)
    course["__root__"] = str(root)
    return root, course


def _selected(course: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.all:
        return list(course["episodes"])
    if not args.episode:
        raise CourseError("pass --episode <id> or --all")
    return [find_episode(course, episode_id) for episode_id in args.episode]


def _doctor(args: argparse.Namespace) -> int:
    root, course = _course()
    lines: list[str] = []
    failures: list[str] = []

    lines.append(f"workspace        {root}")
    lines.append(f"course           {course['brand']} / {len(course['episodes'])} 集 / {course['locale']}")

    try:
        lusine = runtime.lusine_root()
        lines.append(f"lusine           ok      {lusine}")
    except runtime.RuntimeError_ as error:
        failures.append(str(error))
        print("\n".join(lines))
        for failure in failures:
            print(f"FAIL             {failure}", file=sys.stderr)
        return 1

    required = runtime.required_node_version(lusine)
    try:
        found = runtime.node_version()
        ok = found >= required
        lines.append(
            f"node             {'ok' if ok else 'too old'}      "
            f"{'.'.join(map(str, found))} (需要 >= {'.'.join(map(str, required))})"
        )
        if not ok:
            failures.append("node 版本低于渲染器要求")
    except runtime.RuntimeError_ as error:
        failures.append(str(error))

    for command in ("npm", "uv", "ffmpeg", "ffprobe"):
        found = runtime.which(command)
        lines.append(f"{command:<16} {'ok' if found else 'missing':<7} {found or ''}")
        if not found:
            failures.append(f"缺少 {command}")

    edge = runtime.edge_runtime_python(lusine)
    lines.append(f"edge-tts runtime {'ok' if edge else 'missing':<7} {edge or '需在 lusine 执行 npm run install:edge-tts'}")

    import json as _json

    preset = _json.loads((root / course["themePreset"]).read_text(encoding="utf-8"))
    families = runtime.font_families(preset["style"]["headingFont"], preset["style"]["bodyFont"])
    available, checked = runtime.available_fonts(families)
    if not checked:
        lines.append(f"fonts            unknown 无字体查询工具，无法核验：{', '.join(families)}")
    elif available:
        lines.append(f"fonts            ok      本机可用：{', '.join(available)}")
    else:
        lines.append(f"fonts            missing 字体栈无一可用：{', '.join(families)}")
        failures.append("字体栈在本机无一可用，PPTX/MP4 会回退到系统默认字体")

    print("\n".join(lines))
    if failures:
        print("", file=sys.stderr)
        for failure in failures:
            print(f"FAIL             {failure}", file=sys.stderr)
        return 1
    return 0


def _scaffold(args: argparse.Namespace) -> int:
    root, course = _course()
    for episode in _selected(course, args):
        paths = episode_paths(root, course, episode["id"])
        if paths["presentation"].exists() and not args.force:
            print(f"exists   {paths['presentation'].relative_to(root)}（加 --force 覆盖）")
        else:
            write_deck(paths["presentation"], build_deck(course, episode))
            print(f"written  {paths['presentation'].relative_to(root)}")
        for directory in (paths["evidence"], paths["images"]):
            directory.mkdir(parents=True, exist_ok=True)
            keep = directory / ".gitkeep"
            if not keep.exists():
                keep.write_text("", encoding="utf-8")
    return 0


def _build(args: argparse.Namespace) -> int:
    root, course = _course()
    lusine = runtime.lusine_root()
    brief = root / course["brief"]
    profile = root / course["ttsProfile"]

    for episode in _selected(course, args):
        paths = episode_paths(root, course, episode["id"])
        if not paths["presentation"].is_file():
            raise CourseError(
                f"deck 不存在：{paths['presentation']}；先运行 workshop scaffold --episode {episode['id']}"
            )
        common = [
            "--presentation", str(paths["presentation"]),
            "--manifest", str(paths["manifest"]),
            "--public-dir", str(paths["public"]),
        ]
        print(f"\n=== {episode['id']} · {episode['module']} {episode['title']} ===")

        if runtime.deck_has_narration(paths["presentation"]):
            runtime.npm_run(lusine, "voiceover:edge", [
                "--presentation", str(paths["presentation"]),
                "--profile", str(profile),
                "--public-dir", str(paths["public"]),
                *(["--force"] if args.force_audio else []),
            ])
        else:
            print("skip voiceover：本集 deck 尚无 narration，生成无声视频")

        runtime.npm_run(lusine, "manifest", common)
        runtime.npm_run(lusine, "check", [*common, "--brief", str(brief)])
        if not args.skip_pptx:
            runtime.npm_run(lusine, "export:pptx", [*common, "--output-dir", str(paths["output"])])
        if not args.skip_mp4:
            runtime.npm_run(lusine, "render", [*common, "--output-dir", str(paths["output"])])
        print(f"done     {paths['output']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="workshop", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="检查本机工具链、渲染器与字体是否满足契约")
    doctor.set_defaults(func=_doctor)

    def add_selection(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--episode", action="append", help="集 id，可重复")
        sub.add_argument("--all", action="store_true", help="全部集")

    scaffold = subparsers.add_parser("scaffold", help="按 course.json 生成每集 deck 骨架")
    add_selection(scaffold)
    scaffold.add_argument("--force", action="store_true", help="覆盖已存在的 deck")
    scaffold.set_defaults(func=_scaffold)

    build = subparsers.add_parser("build", help="旁白 → manifest → 校验 → PPTX → MP4")
    add_selection(build)
    build.add_argument("--skip-pptx", action="store_true")
    build.add_argument("--skip-mp4", action="store_true")
    build.add_argument("--force-audio", action="store_true", help="重新生成已存在的旁白")
    build.set_defaults(func=_build)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except (CourseError, runtime.RuntimeError_, OSError) as error:
        print(f"workshop: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
