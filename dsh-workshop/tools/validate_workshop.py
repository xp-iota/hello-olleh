"""Executable G5-G8 checks for the DSH/iota workshop media bundle."""
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
# Page counts are fixed by the confirmed brief; runtime is bounded, not exact,
# because narration length drives each page and must stay within 12-18 minutes.
EXPECTED = {
    "01-dsh-capabilities": 16,
    "02-iota-alignment": 14,
    "03-boundaries-selection": 10,
}
MIN_RUNTIME_SEC = 720.0
MAX_RUNTIME_SEC = 1080.0
# Minimum share of each lecture that must actually be narrated: long silent
# stretches read as filler, so they fail the gate instead of shipping.
MIN_SPEECH_RATIO = 0.90
# Working vocabulary that must never reach the audience: internal alignment
# labels, decision ids, and the sentence shapes that make a script sound
# machine-written instead of spoken.
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
    command.extend(
        [
            "-show_entries",
            "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ]
    )
    return json.loads(subprocess.check_output(command, text=True))


def markdown_parts(path: Path) -> tuple[list[str], list[str]]:
    value = path.read_text(encoding="utf-8")
    narrations = re.findall(
        r"\*\*旁白\*\*\n\n(.*?)\n\n\*\*复现命令\*\*", value, re.S
    )
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
    print("G5_OK brief=confirmed required=12")


def pptx_text(xml_bytes: bytes) -> str:
    root = ET.fromstring(xml_bytes)
    return "".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))


def check_decks() -> list[str]:
    all_commands: list[str] = []
    total_slides = 0
    total_audio = 0
    for deck_name, expected_slides in EXPECTED.items():
        deck_dir = WORKSHOP / "02-decks" / deck_name
        public_dir = WORKSHOP / "03-public" / deck_name
        deck = json.loads((deck_dir / "presentation.json").read_text(encoding="utf-8"))
        manifest = json.loads((deck_dir / "audio-manifest.json").read_text(encoding="utf-8"))
        slides = deck["slides"]
        assert len(slides) == expected_slides
        assert len(manifest) == expected_slides
        assert deck["id"] == deck_name
        assert all(re.fullmatch(r"[a-z0-9-]+", slide["id"]) for slide in slides)
        assert all(len(slide.get("stats", [])) <= 4 for slide in slides)
        assert all(len(slide.get("nodes", [])) <= 5 for slide in slides)
        assert all("/" not in slide.get("eyebrow", "") for slide in slides)

        script = WORKSHOP / "01-scripts" / f"{deck_name}.md"
        narrations, commands = markdown_parts(script)
        assert narrations == [slide["narration"] for slide in slides]
        assert len(commands) == len(slides)
        all_commands.extend(commands)

        frames = 0
        for slide in slides:
            for asset_key in ("audio",):
                asset = slide.get(asset_key)
                if asset:
                    assert not Path(asset).is_absolute() and ".." not in Path(asset).parts
            image = slide.get("image")
            if image:
                source = image["src"]
                assert image["alt"].strip()
                assert not Path(source).is_absolute() and ".." not in Path(source).parts
                image_path = public_dir / source
                image_info = probe(image_path)
                stream = next(item for item in image_info["streams"] if item["codec_type"] == "video")
                assert int(stream["width"]) >= 1280 and int(stream["height"]) >= 720
            audio_key = slide["audio"]
            entry = manifest[audio_key]
            assert entry["path"] == audio_key
            audio_path = public_dir / audio_key
            info = probe(audio_path, audio_only=True)
            stream = info["streams"][0]
            duration = float(info["format"]["duration"])
            assert stream["codec_name"] == "mp3"
            assert abs(duration - float(entry["durationSec"])) < 0.05
            level = subprocess.run(
                [FFMPEG, "-hide_banner", "-nostats", "-i", str(audio_path), "-af", "volumedetect", "-f", "null", "-"],
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=True,
            ).stderr
            match = re.search(r"max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB", level)
            assert match and match.group(1) != "-inf" and float(match.group(1)) > -50, audio_path
            minimum = float(slide["minDurationSec"]) * int(deck["fps"])
            narrated = duration * int(deck["fps"]) + int(deck["tailFrames"])
            frames += max(1, math.ceil(max(minimum, narrated)))

        pptx = WORKSHOP / "04-out" / f"{deck_name}.pptx"
        assert pptx.stat().st_size > 100_000
        with zipfile.ZipFile(pptx) as archive:
            slide_xml = sorted(
                (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
                key=lambda name: int(re.search(r"\d+", Path(name).name).group()),
            )
            assert len(slide_xml) == expected_slides
            for xml_name, slide in zip(slide_xml, slides, strict=True):
                assert slide["title"] in pptx_text(archive.read(xml_name))

        mp4 = WORKSHOP / "04-out" / f"{deck_name}.mp4"
        movie = probe(mp4)
        duration = float(movie["format"]["duration"])
        video = next(item for item in movie["streams"] if item["codec_type"] == "video")
        audio = next(item for item in movie["streams"] if item["codec_type"] == "audio")
        assert abs(duration - frames / int(deck["fps"])) < 0.1
        assert MIN_RUNTIME_SEC <= duration <= MAX_RUNTIME_SEC, (deck_name, duration)
        speech = sum(entry["durationSec"] for entry in manifest.values())
        ratio = speech / duration
        assert ratio >= MIN_SPEECH_RATIO, (deck_name, round(ratio, 3))
        assert video["codec_name"] == "h264" and (int(video["width"]), int(video["height"])) == (1280, 720)
        assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48000
        subprocess.run(
            [FFMPEG, "-v", "error", "-sseof", "-1", "-i", str(mp4), "-frames:v", "1", "-f", "null", "-"],
            check=True,
        )
        total_slides += expected_slides
        total_audio += len(manifest)
        print(
            f"DECK_OK {deck_name} slides={expected_slides} audio={len(manifest)} "
            f"runtime={duration:.1f}s speech={ratio * 100:.1f}% pptx=ok mp4=ok"
        )

    assert total_slides == 40 and total_audio == 40 and len(all_commands) == 40
    narration = "\n".join(
        slide["narration"]
        for deck_path in sorted((WORKSHOP / "02-decks").glob("*/presentation.json"))
        for slide in json.loads(deck_path.read_text(encoding="utf-8"))["slides"]
    )
    hits = [label for label, pattern in SENSITIVE.items() if re.search(pattern, narration, re.I)]
    assert not hits, hits
    # Only what the audience can actually read: structural field names are
    # allowed to look like machinery, on-screen copy is not.
    on_screen: list[str] = []
    for deck_path in sorted((WORKSHOP / "02-decks").glob("*/presentation.json")):
        deck = json.loads(deck_path.read_text(encoding="utf-8"))
        on_screen.extend(str(deck.get(key, "")) for key in ("title", "subtitle"))
        for slide in deck["slides"]:
            on_screen.extend(
                str(slide.get(key, ""))
                for key in ("eyebrow", "title", "subtitle", "body", "quote", "callout")
            )
            on_screen.extend(slide.get("bullets", []))
            for card in slide.get("stats", []) + slide.get("nodes", []):
                on_screen.extend(str(value) for value in card.values())
            picture = slide.get("image")
            if picture:
                on_screen.extend(str(picture.get(key, "")) for key in ("alt", "caption"))
    visible = "\n".join(on_screen)
    leaked = [term for term in INTERNAL_TERMS if term in visible]
    assert not leaked, leaked
    tone = [phrase for phrase in AI_TONE if phrase in narration]
    assert not tone, tone
    assert "IOTA_ALL_OK modules=12 network=blocked" in (
        WORKSHOP / "05-evidence" / "terminal" / "02-iota-run-all.txt"
    ).read_text(encoding="utf-8")
    choice = (WORKSHOP / "05-evidence" / "terminal" / "03-choice-modules.txt").read_text(encoding="utf-8")
    assert all(f"IOTA_MODULE_OK M{number}" in choice for number in ("03", "07", "12"))
    print(
        "G6_G7_MEDIA_OK decks=3 slides=40 audio=40 commands=40 "
        f"redaction=clean internal_terms=0 ai_tone=0"
    )
    return all_commands


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
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=180,
        )
        log = log_dir / f"command-{index + 1:02d}.txt"
        safe_output = completed.stdout.replace(str(ROOT), "<repo>")
        safe_output = re.sub(r"/private/var/folders/[^\s\"']+", "<temp>", safe_output)
        safe_output = "\n".join(line.rstrip() for line in safe_output.splitlines())
        log.write_text(
            f"$ {command}\n\n{safe_output}\n[exit {completed.returncode}]\n", encoding="utf-8"
        )
        if completed.returncode != 0:
            print(completed.stdout[-2000:], file=sys.stderr)
            raise SystemExit(f"command {index + 1} failed: {command}")
        print(f"COMMAND_OK {index + 1:02d}/40 {command[:88]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commands", action="store_true")
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=40)
    args = parser.parse_args()
    check_brief()
    commands = check_decks()
    if args.commands:
        run_commands(commands, args.start, args.end)
        print(f"COMMAND_BATCH_OK start={args.start + 1} end={args.end}")


if __name__ == "__main__":
    main()
