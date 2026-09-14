"""Executable acceptance checks for the twelve-episode course.

The gate answers one question per check, and every answer comes from a file or a probe rather
than from a claim in a document:

* structure  — twelve episodes, nothing left over from any earlier shape of this course;
* first ten seconds — the opening frame carries task, command and expected result, and the video
  really starts on that frame instead of a static title card;
* evidence   — each episode's terminal content comes from a captured real run that exited 0;
* narration  — no build-process talk, no internal jargon, no assistant self-reference;
* media      — per-episode runtime, resolution, codecs, speech ratio and terminal legibility;
* redaction  — no credential, endpoint, request header or local path in any evidence file;
* outputs    — 04-out holds exactly the twelve videos and twelve decks.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_course import terminal_rows  # noqa: E402

WORKSHOP = Path(__file__).resolve().parents[1]
ROOT = WORKSHOP.parent
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = os.environ.get("FFPROBE") or shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"

EPISODE_IDS = tuple(f"E{index:02d}" for index in range(1, 13))
SLIDES_PER_EPISODE = 7
MIN_EPISODE_SEC = 240.0
MAX_EPISODE_SEC = 420.0
MIN_SPEECH_RATIO = 0.90
MIN_TASK_FRAME_SEC = 10.0
# 与 build_course 的终端面板保持同一套度量：字号 16、面板宽度、可容纳行数。
TERMINAL_SIZE = 16
TERMINAL_LIMIT = 1280 - 144 - 40
MAX_TERMINAL_ROWS = 17

# Talking about how this course, its examples or its documents were produced is off-topic.
BUILD_PROCESS = (
    "本课程", "本教程", "这套教材", "我建设", "我搭建", "我整理", "我制作", "我编写了这份",
    "示例工程是怎么", "教学工程", "讲稿", "旁白", "配音", "分镜", "第一批", "第二批", "批次",
    "PPT", "幻灯片", "presentation.json", "schemaVersion", "deck", "验收器", "交付物",
    "作为 AI", "作为人工智能", "我是一个语言模型", "作为助手",
)
AI_TONE = (
    "关键结论是", "这个拆分很重要", "值得注意的是", "综上", "旨在", "需要强调的是",
    "总而言之", "首先，", "其次，", "最后，",
)
SENSITIVE = {
    "credential": r"sk-[A-Za-z0-9]{8,}",
    "jwt": r"eyJ[A-Za-z0-9._-]{16,}",
    "URL": r"https?://",
    "request header": r"x-api-key:\s*[^<\s]",
    "macOS user path": r"/Users/",
    "Linux user path": r"/home/",
    "package host": r"nexus",
    "git service": r"gitlab",
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


def psnr(first: Path, second: Path) -> float:
    output = subprocess.run(
        [FFMPEG, "-hide_banner", "-v", "error", "-i", str(first), "-i", str(second),
         "-lavfi", "psnr=stats_file=-", "-f", "null", "-"],
        text=True, capture_output=True, check=True).stdout
    match = re.search(r"psnr_avg:([\d.]+|inf)", output)
    assert match, f"psnr probe failed for {first.name}"
    return math.inf if match.group(1) == "inf" else float(match.group(1))


def check_brief() -> None:
    brief = json.loads((WORKSHOP / "00-brief" / "topic-brief.json").read_text(encoding="utf-8"))
    assert brief["schemaVersion"] == 1 and brief["status"] == "confirmed"
    required = ("topic", "objective", "audience", "scope", "entities", "angle", "tone",
                "language", "slideCount", "durationMinutes", "outputs", "visualDirection")
    assert all(brief.get(name) not in (None, "", []) for name in required)
    print(f"BRIEF_OK required={len(required)}")


def check_structure() -> None:
    decks = sorted(path.name for path in (WORKSHOP / "02-decks").iterdir() if path.is_dir())
    assert decks == list(EPISODE_IDS), f"02-decks 只应有 12 集：{decks}"
    scripts = sorted(path.stem for path in (WORKSHOP / "01-scripts").glob("*.md"))
    assert scripts == list(EPISODE_IDS), f"01-scripts 只应有 12 份讲稿：{scripts}"
    public = sorted(path.name for path in (WORKSHOP / "03-public").iterdir() if path.is_dir())
    assert public == list(EPISODE_IDS), f"03-public 只应有 12 集资源：{public}"
    videos = sorted(path.name for path in (WORKSHOP / "04-out").glob("*.mp4"))
    decks_out = sorted(path.name for path in (WORKSHOP / "04-out").glob("*.pptx"))
    assert videos == [f"{name}.mp4" for name in EPISODE_IDS], videos
    assert decks_out == [f"{name}.pptx" for name in EPISODE_IDS], decks_out
    extra = sorted(path.name for path in (WORKSHOP / "04-out").iterdir()
                   if path.suffix not in {".mp4", ".pptx"} or path.is_dir())
    assert not extra, f"04-out 只允许 12 个视频与 12 份 PPT：{extra}"
    print("STRUCTURE_OK episodes=12 videos=12 decks=12 scripts=12")


def markdown_narrations(path: Path) -> list[str]:
    value = path.read_text(encoding="utf-8")
    return re.findall(r"\*\*旁白\*\*\n\n(.*?)\n\n", value, re.S)


def check_evidence_redaction() -> None:
    directory = WORKSHOP / "05-evidence" / "commands"
    files = sorted(directory.glob("*.txt"))
    expected = {f"{name}-dsh-real.txt" for name in EPISODE_IDS}
    expected |= {f"{name}-iota-real.txt" for name in EPISODE_IDS}
    actual = {path.name for path in files}
    assert actual == expected, f"证据文件应为 24 份真实运行日志：{sorted(actual ^ expected)}"
    for path in files:
        text = path.read_text(encoding="utf-8")
        hits = [label for label, pattern in SENSITIVE.items() if re.search(pattern, text, re.I)]
        assert not hits, f"{path.name} 含敏感内容：{hits}"
        assert "[exit 0]" in text, f"{path.name} 不是一次成功的真实运行"
    print(f"EVIDENCE_OK logs={len(files)} redaction=clean exit=0")


def check_episode(episode_id: str) -> dict:
    deck_dir = WORKSHOP / "02-decks" / episode_id
    public = WORKSHOP / "03-public" / episode_id
    deck = json.loads((deck_dir / "presentation.json").read_text(encoding="utf-8"))
    manifest = json.loads((deck_dir / "audio-manifest.json").read_text(encoding="utf-8"))
    slides = deck["slides"]
    assert deck["id"] == episode_id and deck["kind"] == "episode"
    assert len(slides) == SLIDES_PER_EPISODE, (episode_id, len(slides))
    assert [slide["slideIndex"] for slide in slides] == list(range(1, SLIDES_PER_EPISODE + 1))
    assert all(re.fullmatch(r"[a-z0-9-]+", slide["id"]) for slide in slides)

    # --- 前 10 秒：任务、命令、结果 --------------------------------------------
    opening = slides[0]
    assert opening["type"] == "task", f"{episode_id} 首页必须是任务页，而不是静态标题页"
    for field in ("task", "command", "expect"):
        assert str(opening.get(field, "")).strip(), f"{episode_id} 首页缺少 {field}"
    assert float(opening["minDurationSec"]) >= MIN_TASK_FRAME_SEC
    token = re.split(r"[ &|]", opening["command"].strip())[-1]
    narration = opening["narration"]
    assert token in narration or opening["command"].split()[-1] in narration, (
        f"{episode_id} 首页旁白没有念出命令")
    assert any(part and part in narration for part in re.split(r"[，、；：]", opening["expect"])[:3]), (
        f"{episode_id} 首页旁白没有念出预期结果")

    # --- 真实命令、真实输出、练习 --------------------------------------------
    terminal = next(slide for slide in slides if slide["type"] == "terminal")
    assert terminal["evidenceText"], f"{episode_id} 终端页没有真实输出"
    log = (WORKSHOP / "05-evidence" / "commands" / terminal["evidence"]).read_text(encoding="utf-8")
    for line in terminal["evidenceText"]:
        assert line in log, f"{episode_id} 终端页有一行不来自真实日志：{line[:40]}"
    # 可读性用渲染器同一套度量校验：折行后不能超过两行，整屏不能溢出面板。
    rows = terminal_rows([f'$ {terminal["command"]}', *terminal["evidenceText"][1:]],
                         TERMINAL_SIZE, TERMINAL_LIMIT)
    assert len(rows) <= MAX_TERMINAL_ROWS, f"{episode_id} 终端页 {len(rows)} 行超出面板容量"
    exercise = next(slide for slide in slides if slide["type"] == "exercise")
    for field in ("change", "verify", "answer"):
        assert str(exercise.get(field, "")).strip(), f"{episode_id} 练习页缺少 {field}"

    # --- 讲稿与旁白逐字一致 --------------------------------------------------
    script = WORKSHOP / "01-scripts" / f"{episode_id}.md"
    assert markdown_narrations(script) == [slide["narration"] for slide in slides]

    # --- 旁白用词纪律 --------------------------------------------------------
    spoken = "\n".join(slide["narration"] for slide in slides)
    leaked = [term for term in BUILD_PROCESS if term in spoken]
    assert not leaked, f"{episode_id} 旁白出现建设过程/内部用语：{leaked}"
    tone = [term for term in AI_TONE if term in spoken]
    assert not tone, f"{episode_id} 旁白出现 AI 腔句式：{tone}"
    hits = [label for label, pattern in SENSITIVE.items() if re.search(pattern, spoken, re.I)]
    assert not hits, f"{episode_id} 旁白出现敏感信息：{hits}"

    # --- 音频与画面 ----------------------------------------------------------
    frames = 0
    speech = 0.0
    for slide in slides:
        for asset in (slide["audio"], slide["frame"]):
            assert not Path(asset).is_absolute() and ".." not in Path(asset).parts
        frame_info = probe(public / slide["frame"])
        stream = next(item for item in frame_info["streams"] if item["codec_type"] == "video")
        assert (int(stream["width"]), int(stream["height"])) == (deck["width"], deck["height"])
        entry = manifest[slide["audio"]]
        audio_path = public / slide["audio"]
        info = probe(audio_path, audio_only=True)
        duration = float(info["format"]["duration"])
        assert info["streams"][0]["codec_name"] == "mp3"
        assert abs(duration - float(entry["durationSec"])) < 0.05
        level = subprocess.run(
            [FFMPEG, "-hide_banner", "-nostats", "-i", str(audio_path), "-af", "volumedetect",
             "-f", "null", "-"],
            text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True).stderr
        match = re.search(r"max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB", level)
        assert match and match.group(1) != "-inf" and float(match.group(1)) > -50, audio_path
        speech += duration
        floor = float(slide["minDurationSec"]) * int(deck["fps"])
        narrated = duration * int(deck["fps"]) + int(deck["tailFrames"])
        frames += max(1, math.ceil(max(floor, narrated)))
    assert float(manifest[opening["audio"]]["durationSec"]) >= MIN_TASK_FRAME_SEC, (
        f"{episode_id} 首页停留不足 10 秒")

    # --- 视频 ----------------------------------------------------------------
    mp4 = WORKSHOP / "04-out" / f"{episode_id}.mp4"
    movie = probe(mp4)
    duration = float(movie["format"]["duration"])
    video = next(item for item in movie["streams"] if item["codec_type"] == "video")
    audio = next(item for item in movie["streams"] if item["codec_type"] == "audio")
    assert abs(duration - frames / int(deck["fps"])) < 1.0, (episode_id, duration)
    assert MIN_EPISODE_SEC <= duration <= MAX_EPISODE_SEC, f"{episode_id} 时长 {duration:.1f}s 超出 4~7 分钟"
    assert video["codec_name"] == "h264" and (int(video["width"]), int(video["height"])) == (1280, 720)
    assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48000
    ratio = speech / duration
    assert ratio >= MIN_SPEECH_RATIO, f"{episode_id} 有声占比 {ratio:.2%} 偏低"

    # 视频真的从任务页开始：第 2 秒的画面必须与首帧一致。
    grab = WORKSHOP / ".validate-tmp" / f"{episode_id}-t2.png"
    grab.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", "2",
                    "-i", str(mp4), "-frames:v", "1", str(grab)], check=True)
    assert psnr(grab, public / opening["frame"]) >= 30, f"{episode_id} 视频开头不是任务页"
    grab.unlink(missing_ok=True)

    # --- PPT ----------------------------------------------------------------
    pptx = WORKSHOP / "04-out" / f"{episode_id}.pptx"
    assert pptx.stat().st_size > 100_000
    with zipfile.ZipFile(pptx) as archive:
        names = archive.namelist()
        slide_xml = [name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
        assert len(slide_xml) == SLIDES_PER_EPISODE
        for index, slide in enumerate(slides, start=1):
            notes = archive.read(f"ppt/notesSlides/notesSlide{index}.xml")
            body = "".join(node.text or "" for node in ET.fromstring(notes).iter()
                           if node.tag.endswith("}t"))
            assert slide["title"] in body, (episode_id, index)
            assert slide["narration"] in body, (episode_id, index)
            assert f"ppt/media/slide-{index:02d}.png" in names
        ET.fromstring(archive.read("ppt/presentation.xml"))

    print(f"EPISODE_OK {episode_id} module={deck['module']} slides={len(slides)} "
          f"runtime={duration:.1f}s speech={ratio * 100:.1f}% first10s=task+command+result "
          f"evidence={terminal['evidence']} exercise=ok")
    return {"id": episode_id, "duration": duration, "speech": speech,
            "command": opening["command"], "verify": exercise["verify"]}


def run_commands(commands: list[str]) -> None:
    log_dir = WORKSHOP / "05-evidence" / "replay"
    log_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["PATH"] = f"/opt/homebrew/bin:{env.get('PATH', '')}"
    for index, command in enumerate(commands, start=1):
        completed = subprocess.run(["/bin/bash", "-c", f"set -uo pipefail\n{command}"],
                                   cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=900, check=False)
        safe = completed.stdout.replace(str(ROOT), "<repo>")
        (log_dir / f"replay-{index:02d}.txt").write_text(
            f"$ {command}\n\n{safe}\n[exit {completed.returncode}]\n", encoding="utf-8")
        if completed.returncode != 0:
            print(completed.stdout[-2000:], file=sys.stderr)
            raise SystemExit(f"命令 {index} 失败：{command}")
        print(f"COMMAND_OK {index:02d}/{len(commands)} {command[:80]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commands", action="store_true", help="重跑每集的运行命令")
    args = parser.parse_args()
    check_brief()
    check_structure()
    check_evidence_redaction()
    results = [check_episode(episode_id) for episode_id in EPISODE_IDS]
    total = sum(item["duration"] for item in results)
    shortest = min(results, key=lambda item: item["duration"])
    longest = max(results, key=lambda item: item["duration"])
    print(f"COURSE_OK episodes={len(results)} total={total / 60:.1f}min "
          f"shortest={shortest['id']}:{shortest['duration']:.0f}s "
          f"longest={longest['id']}:{longest['duration']:.0f}s "
          f"internal_terms=0 ai_tone=0 redaction=clean")
    if args.commands:
        run_commands([item["command"] for item in results])
        print(f"COMMAND_BATCH_OK commands={len(results)}")


if __name__ == "__main__":
    main()
