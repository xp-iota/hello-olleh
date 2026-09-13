"""Executable checks for the single Harness lecture bundle (deck, video, evidence)."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
WORKSHOP = ROOT / "dsh-workshop"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
COURSE = "harness-course"
EXPECTED_SLIDES = 40
# One continuous lecture: bounded, not exact, because narration length drives each page.
MIN_RUNTIME_SEC = 1800.0
MAX_RUNTIME_SEC = 2700.0
# Long silent stretches read as filler, so they fail the gate instead of shipping.
MIN_SPEECH_RATIO = 0.90
# The chapter decks stay the authoring source for narration and audio.
CHAPTER_DECKS = ("01-dsh-capabilities", "02-iota-alignment", "03-boundaries-selection")
# Working vocabulary that must never reach the audience.
INTERNAL_TERMS = (
    "A+C", "B+C", "A-reverse", "三分类", "判据", "类 A", "类 B", "类 C",
    "D7", "徽标", "schemaVersion", "presentation.json",
)
AI_TONE = (
    "关键结论是", "这个拆分很重要", "值得注意的是", "综上", "本讲将", "本节",
    "旨在", "需要强调的是", "总而言之", "首先，", "其次，", "最后，",
)
SENSITIVE = {
    "git service": r"gitlab",
    "package host": r"nexus",
    "URL": r"https?://",
    "email": r"@[\w.-]+",
    "password": r"password",
    "token assignment": r"token\s*[:=]",
    "credential assignment": r"credential\s*[:=]",
    "macOS user path": r"/Users/",
    "Linux user path": r"/home/",
}


def probe(path: Path, *, audio_only: bool = False) -> dict:
    command = [FFPROBE, "-v", "error"]
    if audio_only:
        command.extend(["-select_streams", "a:0"])
    command.extend([
        "-show_entries",
        "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(path),
    ])
    return json.loads(subprocess.check_output(command, text=True))


def markdown_parts(path: Path) -> tuple[list[str], list[str]]:
    value = path.read_text(encoding="utf-8")
    narrations = re.findall(r"\*\*旁白\*\*\n\n(.*?)\n\n\*\*复现命令\*\*", value, re.S)
    commands = re.findall(r"\*\*复现命令\*\*\n\n```bash\n(.*?)\n```", value, re.S)
    return narrations, commands


def check_brief() -> None:
    brief = json.loads((WORKSHOP / "00-brief" / "topic-brief.json").read_text(encoding="utf-8"))
    assert brief["schemaVersion"] == 1
    assert brief["kind"] == "topic-intent"
    assert brief["status"] == "confirmed"
    required_names = (
        "topic", "objective", "audience", "scope", "entities", "angle", "tone", "language",
        "slideCount", "durationMinutes", "outputs", "visualDirection",
    )
    assert len(required_names) == 12
    assert all(brief.get(name) not in (None, "", []) for name in required_names)
    print("BRIEF_OK brief=confirmed required=12")


def xml_text(payload: bytes) -> str:
    root = ET.fromstring(payload)
    return "".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))


def check_chapter_sources(course_slides: list[dict]) -> None:
    """The merged course must carry exactly the chapter narration, in order."""
    chapter_narration: list[str] = []
    for name in CHAPTER_DECKS:
        deck = json.loads((WORKSHOP / "02-decks" / name / "presentation.json").read_text(encoding="utf-8"))
        chapter_narration.extend(slide["narration"] for slide in deck["slides"])
    assert [slide["narration"] for slide in course_slides] == chapter_narration
    chapters = {slide["chapter"] for slide in course_slides}
    assert chapters == {1, 2, 3}, chapters
    print(f"SOURCE_OK chapters=3 narration_pages={len(chapter_narration)}")


def check_course() -> list[str]:
    deck_dir = WORKSHOP / "02-decks" / COURSE
    public_dir = WORKSHOP / "03-public" / COURSE
    deck = json.loads((deck_dir / "presentation.json").read_text(encoding="utf-8"))
    manifest = json.loads((deck_dir / "audio-manifest.json").read_text(encoding="utf-8"))
    slides = deck["slides"]
    assert deck["id"] == COURSE
    assert len(slides) == EXPECTED_SLIDES and len(manifest) == EXPECTED_SLIDES
    assert all(re.fullmatch(r"[a-z0-9-]+", slide["id"]) for slide in slides)
    assert all(len(slide.get("stats", [])) <= 4 for slide in slides)
    assert all(len(slide.get("nodes", [])) <= 5 for slide in slides)
    assert [slide["courseIndex"] for slide in slides] == list(range(1, EXPECTED_SLIDES + 1))
    check_chapter_sources(slides)

    script = WORKSHOP / "01-scripts" / f"{COURSE}.md"
    narrations, commands = markdown_parts(script)
    assert narrations == [slide["narration"] for slide in slides]
    assert len(commands) == EXPECTED_SLIDES

    frames = 0
    for slide in slides:
        for asset in (slide["audio"], slide["frame"]):
            assert not Path(asset).is_absolute() and ".." not in Path(asset).parts
        frame_path = public_dir / slide["frame"]
        frame_info = probe(frame_path)
        stream = next(item for item in frame_info["streams"] if item["codec_type"] == "video")
        assert (int(stream["width"]), int(stream["height"])) == (deck["width"], deck["height"])
        picture = slide.get("image")
        if picture:
            assert picture["alt"].strip()
            image_path = public_dir / picture["src"]
            image_info = probe(image_path)
            image_stream = next(item for item in image_info["streams"] if item["codec_type"] == "video")
            assert int(image_stream["width"]) >= 1280 and int(image_stream["height"]) >= 468
        entry = manifest[slide["audio"]]
        assert entry["path"] == slide["audio"]
        audio_path = public_dir / slide["audio"]
        info = probe(audio_path, audio_only=True)
        audio_stream = info["streams"][0]
        duration = float(info["format"]["duration"])
        assert audio_stream["codec_name"] == "mp3"
        assert abs(duration - float(entry["durationSec"])) < 0.05
        level = subprocess.run(
            [FFMPEG, "-hide_banner", "-nostats", "-i", str(audio_path), "-af", "volumedetect",
             "-f", "null", "-"],
            text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True).stderr
        match = re.search(r"max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB", level)
        assert match and match.group(1) != "-inf" and float(match.group(1)) > -50, audio_path
        minimum = float(slide["minDurationSec"]) * int(deck["fps"])
        narrated = duration * int(deck["fps"]) + int(deck["tailFrames"])
        frames += max(1, math.ceil(max(minimum, narrated)))

    pptx = WORKSHOP / "04-out" / f"{COURSE}.pptx"
    assert pptx.stat().st_size > 100_000
    with zipfile.ZipFile(pptx) as archive:
        names = archive.namelist()
        slide_xml = sorted(
            (name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda name: int(re.search(r"\d+", Path(name).name).group()))
        assert len(slide_xml) == EXPECTED_SLIDES
        for index, slide in enumerate(slides, start=1):
            notes = archive.read(f"ppt/notesSlides/notesSlide{index}.xml")
            body = xml_text(notes)
            assert slide["title"] in body, (index, slide["title"])
            assert slide["narration"] in body, index
            assert f"ppt/media/slide-{index:02d}.png" in names, index
        ET.fromstring(archive.read("ppt/presentation.xml"))

    mp4 = WORKSHOP / "04-out" / f"{COURSE}.mp4"
    movie = probe(mp4)
    duration = float(movie["format"]["duration"])
    video = next(item for item in movie["streams"] if item["codec_type"] == "video")
    audio = next(item for item in movie["streams"] if item["codec_type"] == "audio")
    assert abs(duration - frames / int(deck["fps"])) < 1.0, (duration, frames / int(deck["fps"]))
    assert MIN_RUNTIME_SEC <= duration <= MAX_RUNTIME_SEC, duration
    speech = sum(entry["durationSec"] for entry in manifest.values())
    ratio = speech / duration
    assert ratio >= MIN_SPEECH_RATIO, round(ratio, 3)
    assert video["codec_name"] == "h264" and (int(video["width"]), int(video["height"])) == (1280, 720)
    assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48000
    subprocess.run([FFMPEG, "-v", "error", "-sseof", "-1", "-i", str(mp4), "-frames:v", "1",
                    "-f", "null", "-"], check=True)
    assert len(list((WORKSHOP / "04-out").glob("*.mp4"))) == 1, "one lecture means one video"

    narration = "\n".join(slide["narration"] for slide in slides)
    hits = [label for label, pattern in SENSITIVE.items() if re.search(pattern, narration, re.I)]
    assert not hits, hits
    on_screen: list[str] = [str(deck.get("title", "")), str(deck.get("subtitle", ""))]
    for slide in slides:
        on_screen.extend(str(slide.get(key, "")) for key in
                         ("eyebrow", "title", "subtitle", "body", "quote", "callout", "chapterTitle"))
        on_screen.extend(slide.get("bullets", []))
        for card in slide.get("stats", []) + slide.get("nodes", []):
            on_screen.extend(str(value) for value in card.values())
        picture = slide.get("image")
        if picture:
            on_screen.extend(str(picture.get(key, "")) for key in ("alt", "caption"))
    leaked = [term for term in INTERNAL_TERMS if term in "\n".join(on_screen)]
    assert not leaked, leaked
    tone = [phrase for phrase in AI_TONE if phrase in narration]
    assert not tone, tone
    assert "IOTA_ALL_OK modules=12 network=blocked" in (
        WORKSHOP / "05-evidence" / "terminal" / "02-iota-run-all.txt").read_text(encoding="utf-8")
    choice = (WORKSHOP / "05-evidence" / "terminal" / "03-choice-modules.txt").read_text(encoding="utf-8")
    assert all(f"IOTA_MODULE_OK M{number}" in choice for number in ("03", "07", "12"))
    print(f"COURSE_OK slides={EXPECTED_SLIDES} audio={EXPECTED_SLIDES} commands={len(commands)} "
          f"runtime={duration:.1f}s speech={ratio * 100:.1f}% pptx=ok mp4=ok "
          f"redaction=clean internal_terms=0 ai_tone=0")
    return commands


def run_commands(commands: list[str], start: int, end: int) -> None:
    assert 0 <= start < end <= len(commands)
    log_dir = WORKSHOP / "05-evidence" / "commands"
    log_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["PATH"] = f"/opt/homebrew/bin:{env.get('PATH', '')}"
    for index in range(start, end):
        command = commands[index]
        completed = subprocess.run(
            ["/bin/bash", "-c", f"set -euo pipefail\n{command}"],
            cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, timeout=180)
        log = log_dir / f"command-{index + 1:02d}.txt"
        safe_output = completed.stdout.replace(str(ROOT), "<repo>")
        safe_output = re.sub(r"/private/var/folders/[^\s\"']+", "<temp>", safe_output)
        safe_output = "\n".join(line.rstrip() for line in safe_output.splitlines())
        log.write_text(f"$ {command}\n\n{safe_output}\n[exit {completed.returncode}]\n", encoding="utf-8")
        if completed.returncode != 0:
            print(completed.stdout[-2000:], file=sys.stderr)
            raise SystemExit(f"command {index + 1} failed: {command}")
        print(f"COMMAND_OK {index + 1:02d}/{len(commands)} {command[:88]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commands", action="store_true")
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=EXPECTED_SLIDES)
    args = parser.parse_args()
    check_brief()
    commands = check_course()
    if args.commands:
        run_commands(commands, args.start, args.end)
        print(f"COMMAND_BATCH_OK start={args.start + 1} end={args.end}")


if __name__ == "__main__":
    main()
