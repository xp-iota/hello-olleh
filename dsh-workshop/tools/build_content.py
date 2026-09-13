"""Generate the twelve episode decks and scripts from one authoring source.

Deck JSON, script markdown, audio manifest and rendered frames all descend from
``tools/course_content.py``, so the slide a student sees, the sentence the voice track says and
the command in the script can never drift apart.

Run order:
    capture_evidence.py  -> real command logs used by the terminal slides
    build_content.py     -> 02-decks/E01..E12 + 01-scripts/E01..E12.md
    build_audio.py       -> 03-public/E01..E12/audio + audio-manifest.json
    build_course.py      -> 04-out/E01..E12.mp4 + .pptx
    validate_workshop.py -> gates
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from course_content import (  # noqa: E402
    COURSE_SUBTITLE,
    COURSE_TITLE,
    EPISODES,
    FPS,
    HEIGHT,
    TAIL_FRAMES,
    THEME,
    WIDTH,
)

WORKSHOP = Path(__file__).resolve().parents[1]
DECKS = WORKSHOP / "02-decks"
SCRIPTS = WORKSHOP / "01-scripts"
EVIDENCE = WORKSHOP / "05-evidence" / "commands"

STYLE = {
    "mood": "engineering-evidence",
    "density": "balanced",
    "motion": "restrained",
    "headingFont": "PingFang SC",
    "bodyFont": "PingFang SC",
    "cornerRadius": 14,
    "backgroundPattern": "grid",
}


def evidence_lines(name: str, limit: int) -> list[str]:
    """Read a captured command log and keep the most informative window of it."""
    path = EVIDENCE / name
    if not path.is_file():
        raise SystemExit(f"缺少真实运行证据 {path.name}；先跑 tools/capture_evidence.py")
    raw = [line.rstrip() for line in path.read_text(encoding="utf-8").splitlines()]
    body = [line for line in raw if line.strip()]
    if len(body) <= limit:
        return body
    # Keep the command line plus the tail: the tail is where the verdict lives.
    head = body[:1]
    return head + body[-(limit - 1):]


def slide_payload(episode: dict[str, Any], slide: dict[str, Any], index: int) -> dict[str, Any]:
    payload = dict(slide)
    payload["audio"] = f"audio/{slide['id']}.mp3"
    payload["frame"] = f"frames/slide-{index:02d}.png"
    payload["slideIndex"] = index
    if slide["type"] == "terminal":
        payload["evidenceText"] = evidence_lines(slide["evidence"], int(slide["evidenceLines"]))
    return payload


def write_episode(episode: dict[str, Any]) -> dict[str, Any]:
    deck_dir = DECKS / episode["id"]
    deck_dir.mkdir(parents=True, exist_ok=True)
    slides = [slide_payload(episode, slide, index) for index, slide in enumerate(episode["slides"], 1)]
    deck = {
        "schemaVersion": 2,
        "kind": "episode",
        "id": episode["id"],
        "module": episode["module"],
        "number": episode["number"],
        "title": f"第 {episode['number']} 集 · {episode['title']}",
        "subtitle": episode["task"],
        "course": COURSE_TITLE,
        "courseSubtitle": COURSE_SUBTITLE,
        "task": episode["task"],
        "command": episode["command"],
        "expect": episode["expect"],
        "fps": FPS,
        "width": WIDTH,
        "height": HEIGHT,
        "tailFrames": TAIL_FRAMES,
        "theme": THEME,
        "style": STYLE,
        "slides": slides,
    }
    (deck_dir / "presentation.json").write_text(
        json.dumps(deck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    lines = [
        f"# 第 {episode['number']} 集 · {episode['title']}（{episode['module']}）",
        "",
        f"> 本集任务：{episode['task']}",
        f"> 运行命令：`{episode['command']}`",
        f"> 你将看到：{episode['expect']}",
        "",
    ]
    for slide in slides:
        lines += [f"## {slide['slideIndex']:02d}. {slide['title']}", "", "**旁白**", "", slide["narration"], ""]
        if slide["type"] == "task":
            lines += [
                "**本集任务**", "", slide["task"], "",
                "**运行命令**", "", "```bash", slide["command"], "```", "",
                "**你将看到**", "", slide["expect"], "",
            ]
        elif slide["type"] == "terminal":
            lines += [
                "**运行命令**", "", "```bash", slide["command"], "```", "",
                "**真实输出（节选）**", "", "```text", *slide["evidenceText"], "```", "",
            ]
        elif slide["type"] == "debug":
            lines += [
                "**症状**", "", slide["symptom"], "",
                "**定位**", "", slide["locate"], "",
                "**修改**", "", slide["fix"], "",
            ]
        elif slide["type"] == "exercise":
            lines += [
                "**练习**", "", slide["change"], "",
                "**验证命令**", "", "```bash", slide["verify"], "```", "",
                "**可验证答案**", "", slide["answer"], "",
            ]
        else:
            command = slide.get("callout")
            if command:
                lines += ["**对照命令**", "", "```bash", command, "```", ""]
    (SCRIPTS / f"{episode['id']}.md").write_text("\n".join(lines), encoding="utf-8")
    return deck


def clean_superseded() -> list[str]:
    """Remove the previous single-lecture bundle so only the twelve episodes remain."""
    removed: list[str] = []
    keep_decks = {episode["id"] for episode in EPISODES}
    for path in sorted(DECKS.iterdir()):
        if path.is_dir() and path.name not in keep_decks:
            shutil.rmtree(path)
            removed.append(f"02-decks/{path.name}")
    keep_scripts = {f"{episode['id']}.md" for episode in EPISODES}
    for path in sorted(SCRIPTS.glob("*.md")):
        if path.name not in keep_scripts:
            path.unlink()
            removed.append(f"01-scripts/{path.name}")
    return removed


def main() -> None:
    SCRIPTS.mkdir(parents=True, exist_ok=True)
    DECKS.mkdir(parents=True, exist_ok=True)
    if len(EPISODES) != 12:
        raise SystemExit(f"课程必须是 12 集，当前 {len(EPISODES)}")
    for removed in clean_superseded():
        print(f"REMOVED {removed}")
    total = 0
    for episode in EPISODES:
        deck = write_episode(episode)
        total += len(deck["slides"])
        print(f"EPISODE_OK {deck['id']} module={deck['module']} slides={len(deck['slides'])}")
    print(f"CONTENT_OK episodes={len(EPISODES)} slides={total}")


if __name__ == "__main__":
    main()
