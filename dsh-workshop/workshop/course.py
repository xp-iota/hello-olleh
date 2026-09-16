"""Load and validate the machine-readable course descriptor."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

# Page types accepted by the renderer schema (core/src/domain.ts SLIDE_TYPES).
SLIDE_TYPES = frozenset(
    {"title", "text", "overview", "metrics", "diagram", "quote", "closing", "image"}
)
ID_PATTERN = re.compile(r"^[a-z0-9-]+$")


class CourseError(ValueError):
    """Raised when the course descriptor cannot be trusted."""


def workshop_root(start: Path | None = None) -> Path:
    """Locate the workspace root without depending on the caller's directory."""

    override = os.environ.get("WORKSHOP_ROOT")
    if override:
        root = Path(override).expanduser().resolve()
        if not (root / "course.json").is_file():
            raise CourseError(f"WORKSHOP_ROOT has no course.json: {root}")
        return root
    for candidate in ((start or Path.cwd()).resolve(), *(start or Path.cwd()).resolve().parents):
        if (candidate / "course.json").is_file():
            return candidate
    packaged = Path(__file__).resolve().parents[1]
    if (packaged / "course.json").is_file():
        return packaged
    raise CourseError("course.json not found; run inside the workspace or set WORKSHOP_ROOT")


def load_course(root: Path | None = None) -> dict[str, Any]:
    """Read course.json and reject anything a later step would trip over."""

    root = root or workshop_root()
    course = json.loads((root / "course.json").read_text(encoding="utf-8"))
    if course.get("schemaVersion") != 1 or course.get("kind") != "course":
        raise CourseError("course.json must declare schemaVersion 1 and kind course")
    for key in ("brand", "locale", "themePreset", "ttsProfile", "topicsDir", "outputDir"):
        if not str(course.get(key, "")).strip():
            raise CourseError(f"course.json is missing {key}")

    episodes = course.get("episodes")
    if not isinstance(episodes, list) or not episodes:
        raise CourseError("course.json needs a non-empty episodes array")
    seen: set[str] = set()
    for episode in episodes:
        episode_id = episode.get("id", "")
        # Deck ids become output file names, so enforce the renderer's id rule here
        # instead of discovering it during the last step of a long build.
        if not ID_PATTERN.match(episode_id):
            raise CourseError(f"episode id must match {ID_PATTERN.pattern}: {episode_id!r}")
        if episode_id in seen:
            raise CourseError(f"duplicate episode id: {episode_id}")
        seen.add(episode_id)
        for key in ("module", "title"):
            if not str(episode.get(key, "")).strip():
                raise CourseError(f"episode {episode_id} is missing {key}")

    plan = course.get("pagePlan")
    if not isinstance(plan, list) or not plan:
        raise CourseError("course.json needs a non-empty pagePlan array")
    for page in plan:
        if page.get("type") not in SLIDE_TYPES:
            raise CourseError(
                f"pagePlan type {page.get('type')!r} is not a renderer page type: "
                f"{', '.join(sorted(SLIDE_TYPES))}"
            )
        if not str(page.get("key", "")).strip():
            raise CourseError("every pagePlan entry needs a key")

    for key in ("themePreset", "ttsProfile"):
        if not (root / course[key]).is_file():
            raise CourseError(f"course.json {key} does not exist: {course[key]}")
    return course


def find_episode(course: dict[str, Any], episode_id: str) -> dict[str, Any]:
    for episode in course["episodes"]:
        if episode["id"] == episode_id:
            return episode
    known = ", ".join(episode["id"] for episode in course["episodes"])
    raise CourseError(f"unknown episode {episode_id!r}; course.json declares: {known}")


def episode_paths(root: Path, course: dict[str, Any], episode_id: str) -> dict[str, Path]:
    """Resolve every path a build step needs, as absolute paths."""

    topic = root / course["topicsDir"] / episode_id
    return {
        "topic": topic,
        "presentation": topic / "presentation.json",
        "manifest": topic / "audio-manifest.json",
        "public": topic / "public",
        "evidence": topic / "evidence",
        "images": topic / "public" / "images",
        "audio": topic / "public" / "audio",
        "output": root / course["outputDir"] / episode_id,
    }
