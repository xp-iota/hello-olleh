"""Turn course.json into a valid deck skeleton for one episode.

The page sequence, canvas and palette all come from the descriptor, so changing
topic never requires editing this module.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

TODO = "TODO：填写本页正文"


def _page(course: dict[str, Any], episode: dict[str, Any], page: dict[str, Any]) -> dict[str, Any]:
    slide: dict[str, Any] = {
        "id": f"{episode['id']}-{page['key']}",
        "type": page["type"],
        "eyebrow": page.get("eyebrow", page["key"].upper()),
        "title": page.get("title", page["key"]),
        "minDurationSec": course["deck"]["minDurationSec"],
    }
    if page["key"] == "task":
        slide["subtitle"] = episode["title"]
        slide["body"] = episode.get("task", TODO)
        slide["bullets"] = [
            f"命令：{episode.get('command', 'TODO')}",
            f"预期：{episode.get('expect', 'TODO')}",
        ]
    elif page["type"] == "diagram":
        slide["body"] = TODO
        slide["nodes"] = [
            {"label": "TODO 入口"},
            {"label": "TODO 机制"},
            {"label": "TODO 边界"},
        ]
    elif page["type"] in {"overview", "metrics"}:
        slide["stats"] = [{"value": "TODO", "label": "TODO"}]
    elif page["type"] in {"quote", "closing"}:
        slide["quote"] = TODO
    else:
        slide["body"] = TODO
        if page["key"] == "terminal":
            slide["callout"] = f"证据：evidence/{episode.get('evidence', 'TODO')}"
        if page["key"] == "exercise":
            slide["bullets"] = ["TODO 改哪里", "TODO 验证命令", "TODO 可验证答案"]
    return slide


def build_deck(course: dict[str, Any], episode: dict[str, Any]) -> dict[str, Any]:
    preset = json.loads(
        (Path(course["__root__"]) / course["themePreset"]).read_text(encoding="utf-8")
    )
    deck = course["deck"]
    return {
        "schemaVersion": 1,
        "id": episode["id"],
        "title": f"{episode['module']} · {episode['title']}",
        "subtitle": course["subtitle"],
        "author": course["brand"],
        "brand": course["brand"],
        "locale": course["locale"],
        "fps": deck["fps"],
        "width": deck["width"],
        "height": deck["height"],
        "tailFrames": deck["tailFrames"],
        "showCaptions": deck["showCaptions"],
        "theme": preset["theme"],
        "style": preset["style"],
        "slides": [_page(course, episode, page) for page in course["pagePlan"]],
    }


def write_deck(path: Path, deck: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(deck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
