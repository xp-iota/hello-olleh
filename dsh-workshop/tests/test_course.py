"""The course descriptor is the single topic entry point, so its rules are tested."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from workshop.course import (
    SLIDE_TYPES,
    CourseError,
    episode_paths,
    find_episode,
    load_course,
    workshop_root,
)

ROOT = Path(__file__).resolve().parents[1]


def test_shipped_course_descriptor_is_valid():
    course = load_course(ROOT)
    assert course["kind"] == "course"
    assert len(course["episodes"]) == 12
    assert {page["type"] for page in course["pagePlan"]} <= SLIDE_TYPES


def test_brief_scale_matches_the_descriptor():
    """A confirmed brief must not contradict episodes x pagePlan."""
    course = load_course(ROOT)
    brief = json.loads((ROOT / course["brief"]).read_text(encoding="utf-8"))
    assert brief["status"] == "confirmed"
    assert brief["slideCount"] == len(course["episodes"]) * len(course["pagePlan"])


def test_every_episode_id_is_a_legal_deck_id():
    course = load_course(ROOT)
    for episode in course["episodes"]:
        assert episode["id"] == episode["id"].lower()
        assert episode["id"].isalnum()


def _write_course(tmp_path: Path, mutate) -> Path:
    course = json.loads((ROOT / "course.json").read_text(encoding="utf-8"))
    mutate(course)
    (tmp_path / "course.json").write_text(json.dumps(course, ensure_ascii=False), encoding="utf-8")
    for relative in ("profiles/theme.course.json", "profiles/tts-profile.edge-tts.json"):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / relative).read_text(encoding="utf-8"), encoding="utf-8")
    return tmp_path


def test_uppercase_episode_id_is_rejected(tmp_path: Path):
    root = _write_course(tmp_path, lambda c: c["episodes"][0].update(id="E01"))
    with pytest.raises(CourseError, match="episode id must match"):
        load_course(root)


def test_duplicate_episode_id_is_rejected(tmp_path: Path):
    def mutate(course):
        course["episodes"][1]["id"] = course["episodes"][0]["id"]

    root = _write_course(tmp_path, mutate)
    with pytest.raises(CourseError, match="duplicate episode id"):
        load_course(root)


def test_page_type_outside_the_renderer_schema_is_rejected(tmp_path: Path):
    """Guards the exact failure the legacy schemaVersion 2 decks had."""
    root = _write_course(tmp_path, lambda c: c["pagePlan"][0].update(type="terminal"))
    with pytest.raises(CourseError, match="not a renderer page type"):
        load_course(root)


def test_missing_profile_is_reported_before_a_build_starts(tmp_path: Path):
    root = _write_course(tmp_path, lambda c: c.update(themePreset="profiles/absent.json"))
    with pytest.raises(CourseError, match="themePreset does not exist"):
        load_course(root)


def test_episode_paths_are_absolute_and_inside_the_workspace():
    course = load_course(ROOT)
    paths = episode_paths(ROOT, course, "e01")
    assert all(path.is_absolute() for path in paths.values())
    assert paths["output"] == ROOT / course["outputDir"] / "e01"
    assert paths["audio"] == ROOT / course["topicsDir"] / "e01" / "public" / "audio"


def test_unknown_episode_names_the_known_ids():
    course = load_course(ROOT)
    with pytest.raises(CourseError, match="unknown episode"):
        find_episode(course, "e99")


def test_workshop_root_honours_an_explicit_override(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("WORKSHOP_ROOT", str(ROOT))
    assert workshop_root() == ROOT
    monkeypatch.setenv("WORKSHOP_ROOT", str(tmp_path))
    with pytest.raises(CourseError, match="no course.json"):
        workshop_root()
