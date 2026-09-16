"""Runtime is the only OS-aware layer; scaffolding must stay descriptor-driven."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from workshop import runtime
from workshop.course import load_course
from workshop.scaffold import build_deck

ROOT = Path(__file__).resolve().parents[1]


def _course() -> dict:
    course = load_course(ROOT)
    course["__root__"] = str(ROOT)
    return course


def test_font_stack_is_split_into_concrete_families():
    families = runtime.font_families("Noto Sans CJK SC, 'PingFang SC', sans-serif")
    assert families == ["Noto Sans CJK SC", "PingFang SC"]


def test_theme_font_stack_lists_one_family_per_major_os():
    preset = json.loads((ROOT / "profiles/theme.course.json").read_text(encoding="utf-8"))
    families = runtime.font_families(preset["style"]["headingFont"])
    assert "Noto Sans CJK SC" in families      # Linux
    assert "PingFang SC" in families            # macOS
    assert "Microsoft YaHei" in families        # Windows


def test_missing_lusine_checkout_reports_the_override(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("LUSINE_ROOT", str(tmp_path))
    with pytest.raises(runtime.RuntimeError_, match="LUSINE_ROOT"):
        runtime.lusine_root()


def test_node_floor_comes_from_the_renderer_not_this_repo():
    lusine = runtime.lusine_root()
    assert runtime.required_node_version(lusine) >= (22, 18, 0)


def test_deck_without_narration_is_detected():
    deck = ROOT / "topics" / "e01" / "presentation.json"
    assert deck.is_file()
    assert runtime.deck_has_narration(deck) is False


def test_scaffold_follows_the_page_plan_and_theme():
    course = _course()
    preset = json.loads((ROOT / course["themePreset"]).read_text(encoding="utf-8"))
    deck = build_deck(course, course["episodes"][0])
    assert deck["id"] == "e01"
    assert deck["brand"] == course["brand"]
    assert deck["locale"] == course["locale"]
    assert deck["theme"] == preset["theme"]
    assert [slide["type"] for slide in deck["slides"]] == [
        page["type"] for page in course["pagePlan"]
    ]
    assert deck["width"] == course["deck"]["width"]


def test_scaffold_reacts_to_a_changed_descriptor_without_code_edits():
    """Switching topic must only require course.json edits."""
    course = _course()
    course["brand"] = "另一个主题"
    course["locale"] = "en-US"
    episode = {**course["episodes"][0], "id": "x01", "module": "N01", "title": "演示"}
    deck = build_deck(course, episode)
    assert deck["id"] == "x01"
    assert deck["brand"] == "另一个主题"
    assert deck["locale"] == "en-US"
    assert len(deck["slides"]) == len(course["pagePlan"])
