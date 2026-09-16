#!/usr/bin/env python3
"""Build narrated PPTX/MP4 lesson media through lusine-a-reves.

Content extraction is deterministic: every lesson becomes seven pages with the
same semantic slots. The source Markdown remains the authority; generated deck,
audio and media live under each project's gitignored dist/ directory.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = {
    "dsh-example": {
        "brand": "DeepSeek Harness 自学课程",
        "paper": "#071521", "ink": "#edf7f6", "muted": "#9fb8b8",
        "accent": "#2dd4bf", "accent2": "#60a5fa", "accent3": "#fbbf24", "panel": "#102737",
        "voices": [
            ("zh-CN-XiaoxiaoNeural", "主旁白"),
            ("zh-CN-XiaoyiNeural", "第二女声"),
            ("zh-CN-YunxiNeural", "男声 1"),
            ("zh-CN-YunjianNeural", "男声 2"),
            ("zh-CN-YunxiaNeural", "另一女声"),
            ("zh-CN-YunyangNeural", "新闻／播报备选"),
        ],
    },
    "iota-example": {
        "brand": "iota 对照自学课程",
        "paper": "#101329", "ink": "#f2f0ff", "muted": "#b7b5d3",
        "accent": "#8b9cff", "accent2": "#43d9bd", "accent3": "#ffb86c", "panel": "#1a2040",
        "voices": [
            ("zh-CN-YunxiNeural", "男声 1"),
            ("zh-CN-XiaoxiaoNeural", "主旁白"),
            ("zh-CN-YunjianNeural", "男声 2"),
            ("zh-CN-XiaoyiNeural", "第二女声"),
            ("zh-CN-YunyangNeural", "新闻／播报备选"),
            ("zh-CN-YunxiaNeural", "另一女声"),
        ],
    },
}
FONT_STACK = (
    "Noto Sans CJK SC, Source Han Sans SC, PingFang SC, "
    "Microsoft YaHei, WenQuanYi Micro Hei, sans-serif"
)
# A visible slide may carry code syntax that is useful on screen but unsuitable
# for an online voice. Overrides change narration only; visible lesson content
# and exact voice assignment remain untouched and reproducible.
NARRATION_OVERRIDES = {
    ("dsh-example", "08-delegation-presets", "troubleshoot"):
        "排障时，先确认子代理提供方已经注册，再确认模型可见的委派工具也已经注册。只注册提供方，并不会让模型自动学会委派。修复之后，请重新运行本课验收命令。",
    ("dsh-example", "08-delegation-presets", "code"):
        "阅读代码时，先看场景文件如何演示委派，再看实现文件如何注册提供方和模型工具。最后回到事件输出，确认委派开始与结束都留下了证据。",
    ("dsh-example", "08-delegation-presets", "exercise"):
        "练习要求你证明，只注册子代理提供方并不会自动让模型看见委派能力。完成最小改动后，运行本课命令，并用模型可见工具列表与委派事件验证答案。",
}


@dataclass
class Section:
    heading: str
    body: str


def clean_inline(text: str) -> str:
    text = re.sub(r"!\[([^]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<https?://[^>]+>", "链接", text)
    text = re.sub(r"[`*_~]", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" |#>-\t\n")


def shorten(text: str, limit: int) -> str:
    value = clean_inline(text)
    if len(value) <= limit:
        return value
    cut = value[:limit].rstrip("，、；：,. ")
    sentence = max(cut.rfind(mark) for mark in "。！？；")
    if sentence >= limit // 2:
        cut = cut[: sentence + 1]
    return cut + ("" if cut.endswith(tuple("。！？；")) else "…")


def prose_lines(body: str) -> list[str]:
    # Remove fenced blocks and tables; visible slide prose should be short and stable.
    body = re.sub(r"```.*?```", "\n", body, flags=re.S)
    lines: list[str] = []
    paragraph: list[str] = []
    for raw in body.splitlines():
        stripped = raw.strip()
        if not stripped:
            if paragraph:
                value = clean_inline(" ".join(paragraph))
                if value:
                    lines.append(value)
                paragraph = []
            continue
        if stripped.startswith("|") or re.match(r"^[-:| ]+$", stripped):
            continue
        if stripped.startswith(("#", ">")):
            stripped = stripped.lstrip("#> ")
        if re.match(r"^[-*+]\s+", stripped) or re.match(r"^\d+[.)]\s+", stripped):
            if paragraph:
                value = clean_inline(" ".join(paragraph))
                if value:
                    lines.append(value)
                paragraph = []
            value = clean_inline(re.sub(r"^(?:[-*+]|\d+[.)])\s+", "", stripped))
            if value:
                lines.append(value)
        else:
            paragraph.append(stripped)
    if paragraph:
        value = clean_inline(" ".join(paragraph))
        if value:
            lines.append(value)
    return lines


def code_blocks(body: str) -> list[str]:
    return [match.group(1).strip() for match in re.finditer(r"```(?:[^\n]*)\n(.*?)```", body, flags=re.S)]


def parse_lesson(path: Path) -> tuple[str, dict[str, str], list[Section]]:
    text = path.read_text(encoding="utf-8")
    title_match = re.search(r"^#\s+(.+)$", text, flags=re.M)
    if not title_match:
        raise ValueError(f"lesson has no H1: {path}")
    title = clean_inline(title_match.group(1))
    intro = text[title_match.end() :]
    first_h2 = re.search(r"^##\s+", intro, flags=re.M)
    preface = intro[: first_h2.start()] if first_h2 else intro
    metadata: dict[str, str] = {}
    for label, value in re.findall(r">\s*\*\*([^*]+)\*\*：?\s*(.+?)(?=\n>|\n\n|\Z)", preface, flags=re.S):
        metadata[clean_inline(label)] = clean_inline(value.replace("\n>", " "))
    parts = re.split(r"^##\s+", text, flags=re.M)[1:]
    sections: list[Section] = []
    for part in parts:
        heading, _, body = part.partition("\n")
        sections.append(Section(clean_inline(heading), body.strip()))
    return title, metadata, sections


def section_by(sections: list[Section], keyword: str) -> Section | None:
    return next((section for section in sections if keyword in section.heading), None)


def bullet_candidates(section: Section | None, limit: int = 4) -> list[str]:
    if not section:
        return []
    candidates = prose_lines(section.body)
    return [shorten(value, 66) for value in candidates[:limit] if value][:limit]


def output_lines(section: Section | None) -> list[str]:
    if not section:
        return []
    blocks = code_blocks(section.body)
    if not blocks:
        return bullet_candidates(section, 5)
    lines: list[str] = []
    for raw in blocks[0].splitlines():
        value = clean_inline(raw)
        if not value or len(value) > 100:
            continue
        if value.startswith(("████", "────", "provider=")):
            continue
        lines.append(shorten(value, 82))
        if len(lines) == 5:
            break
    return lines or ["真实输出已在原 lesson 的第 2 节完整记录。"]


def narration(title: str, body: str, bullets: list[str], closing: str = "") -> str:
    parts = [title.rstrip("。") + "。"]
    if body:
        parts.append(shorten(body, 82))
    if bullets:
        parts.append("重点包括：" + "；".join(shorten(item, 34) for item in bullets[:3]) + "。")
    if closing:
        parts.append(closing)
    return shorten("".join(parts), 170)


def build_slides(title: str, metadata: dict[str, str], sections: list[Section], lesson_id: str) -> list[dict[str, Any]]:
    task = metadata.get("本课任务") or metadata.get("任务") or "完成本课目标并核对真实输出。"
    command = metadata.get("运行命令", "按原 lesson 的命令执行。")
    expected = metadata.get("你将看到", "按验收契约确认结果。")
    real = section_by(sections, "真实输出") or (sections[1] if len(sections) > 1 else None)
    trouble = section_by(sections, "排障")
    code = section_by(sections, "代码在哪")
    exercise = section_by(sections, "动手练习")
    reserved = {id(value) for value in (real, trouble, code, exercise) if value}
    mechanisms = [section for section in sections if id(section) not in reserved and not re.match(r"^1\.", section.heading)]
    midpoint = max(1, (len(mechanisms) + 1) // 2)
    mechanism_groups = [mechanisms[:midpoint], mechanisms[midpoint:]]

    slides: list[dict[str, Any]] = []

    def add(key: str, slide_type: str, slide_title: str, *, body: str = "", bullets: list[str] | None = None,
            nodes: list[dict[str, str]] | None = None, subtitle: str = "", callout: str = "",
            narration_text: str = "") -> None:
        slide: dict[str, Any] = {
            "id": f"{lesson_id}-{key}", "type": slide_type, "eyebrow": key.upper(),
            "title": shorten(slide_title, 72), "minDurationSec": 7,
            "narration": narration_text,
            "audio": f"audio/{lesson_id}-{key}.wav", "captions": [],
        }
        if body:
            slide["body"] = shorten(body, 260)
        if bullets:
            slide["bullets"] = [shorten(item, 82) for item in bullets[:5]]
        if nodes:
            slide["nodes"] = nodes[:5]
        if subtitle:
            slide["subtitle"] = shorten(subtitle, 100)
        if callout:
            slide["callout"] = shorten(callout, 130)
        slides.append(slide)

    intro_bullets = [f"运行命令：{command}", f"验收结果：{expected}"]
    add("task", "text", title, body=task, bullets=intro_bullets,
        subtitle="从任务开始，以可运行证据结束。",
        narration_text=narration("本课任务", task, intro_bullets, "先记住命令和预期，再进入机制。"))

    real_lines = output_lines(real)
    add("output", "text", "真实输出：先看证据，再解释机制", body=f"执行：{command}", bullets=real_lines,
        callout="完整日志与上下文保留在原 lesson 的“真实输出”章节。",
        narration_text=narration("真实输出", expected, real_lines, "这些行是后续结论的证据锚点。"))

    for index, group in enumerate(mechanism_groups, 1):
        if not group:
            group = sections[max(0, len(sections) - 2) : max(0, len(sections) - 1)]
        nodes: list[dict[str, str]] = []
        for section in group[:5]:
            summary = prose_lines(section.body)
            nodes.append({"label": shorten(re.sub(r"^\d+\.\s*", "", section.heading), 28),
                          "sub": shorten(summary[0] if summary else "见原 lesson", 40)})
        body = " → ".join(node["label"] for node in nodes)
        add(f"mechanism-{index}", "diagram", f"核心机制 {index}：{nodes[0]['label'] if nodes else '结构与边界'}",
            nodes=nodes, callout="每个节点都对应原 lesson 的一个章节，顺序保持一致。",
            narration_text=narration(f"核心机制第{index}部分", body, [node["sub"] for node in nodes], "关注责任边界，不要只记 API 名。"))

    trouble_bullets = bullet_candidates(trouble, 4) or ["先定位症状发生在哪一层。", "再按原 lesson 的验证命令复现。"]
    trouble_body = prose_lines(trouble.body)[0] if trouble and prose_lines(trouble.body) else "从症状、定位办法和修复动作三步排查。"
    add("troubleshoot", "text", trouble.heading if trouble else "排障：先定位边界，再修改", body=trouble_body,
        bullets=trouble_bullets, narration_text=narration("排障", trouble_body, trouble_bullets, "修复之后必须重新运行验收命令。"))

    code_bullets = bullet_candidates(code, 5) or ["从原 lesson 的相对链接打开入口文件。", "沿调用链确认机制与边界。"]
    code_body = prose_lines(code.body)[0] if code and prose_lines(code.body) else "代码位置以原 lesson 的链接为准。"
    add("code", "text", "代码在哪：从入口沿调用链阅读", body=code_body, bullets=code_bullets,
        narration_text=narration("代码位置", code_body, code_bullets, "先看入口，再看实现，最后回到验收输出。"))

    exercise_bullets = bullet_candidates(exercise, 5) or ["完成一个最小改动。", "运行原 lesson 的验证命令。", "记录可验证答案。"]
    exercise_body = prose_lines(exercise.body)[0] if exercise and prose_lines(exercise.body) else "练习必须同时给出改动点、验证命令和可观察答案。"
    add("exercise", "text", "动手练习：改动、验证、答案", body=exercise_body, bullets=exercise_bullets,
        callout="不要只看懂；以可重复运行的输出完成本课。",
        narration_text=narration("动手练习", exercise_body, exercise_bullets, "做到结果可复现，本课才算完成。"))
    return slides


def build_deck(project: str, lesson_path: Path, index: int) -> tuple[dict[str, Any], dict[str, Any]]:
    config = PROJECTS[project]
    title, metadata, sections = parse_lesson(lesson_path)
    slug = lesson_path.stem
    deck_id = f"{'dsh' if project == 'dsh-example' else 'iota'}-{slug}"
    voice, role = config["voices"][index % len(config["voices"])]
    theme = {key: config[key] for key in ("paper", "ink", "muted", "accent", "accent2", "accent3", "panel")}
    slides = build_slides(title, metadata, sections, deck_id)
    for slide in slides:
        key = slide["id"].removeprefix(f"{deck_id}-")
        override = NARRATION_OVERRIDES.get((project, slug, key))
        if override:
            slide["narration"] = override
    deck = {
        "schemaVersion": 1, "id": deck_id, "title": title,
        "subtitle": "原 lesson 的七页高密度可播放摘要",
        "author": config["brand"], "brand": config["brand"], "locale": "zh-CN",
        # 1080p is the delivery contract. PPTX stays editable vector content.
        "fps": 30, "width": 1920, "height": 1080, "tailFrames": 12, "showCaptions": True,
        "theme": theme,
        "style": {
            "mood": "technical-course", "density": "information", "motion": "restrained",
            "headingFont": FONT_STACK, "bodyFont": FONT_STACK,
            "cornerRadius": 14, "backgroundPattern": "grid",
        },
        "slides": slides,
    }
    profile = {
        "schemaVersion": 1, "profileId": f"{deck_id}-{voice.lower()}-v1", "provider": "edge-tts",
        "runtime": "edge-tts-cli", "model": "Microsoft Edge Neural TTS", "voice": voice,
        "language": "Chinese", "languageCode": "zh-CN", "emotion": "neutral",
        "style": "technical-explainer", "instruct": "语速适中，发音清晰，语气专业自然。",
        "rate": "-5%", "pitchAdjustment": "+0Hz", "volumeAdjustment": "+0%",
        "sampleRate": 24000, "channels": 1, "format": "wav", "normalize": False, "randomize": False,
    }
    trace = {"lesson": str(lesson_path.relative_to(ROOT)), "id": deck_id, "voice": voice, "voiceRole": role,
             "slideCount": len(deck["slides"]), "video": {"width": 1920, "height": 1080, "fps": 30,
             "intermediateFrames": "png", "h264Crf": 12}}
    return {"deck": deck, "profile": profile}, trace


def prepare(project: str) -> None:
    project_dir = ROOT / project
    lessons = sorted((project_dir / "lessons").glob("*.md"))
    if not lessons:
        raise SystemExit(f"no lessons found: {project_dir / 'lessons'}")
    output_root = project_dir / "dist" / "lessons"
    traces: list[dict[str, Any]] = []
    for index, lesson in enumerate(lessons):
        payload, trace = build_deck(project, lesson, index)
        lesson_dir = output_root / lesson.stem
        (lesson_dir / "public" / "audio").mkdir(parents=True, exist_ok=True)
        (lesson_dir / "out").mkdir(parents=True, exist_ok=True)
        (lesson_dir / "presentation.json").write_text(json.dumps(payload["deck"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (lesson_dir / "tts-profile.json").write_text(json.dumps(payload["profile"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        trace["paths"] = {
            "deck": str((lesson_dir / "presentation.json").relative_to(project_dir)),
            "profile": str((lesson_dir / "tts-profile.json").relative_to(project_dir)),
            "pptx": str((lesson_dir / "out" / f"{trace['id']}.pptx").relative_to(project_dir)),
            "mp4": str((lesson_dir / "out" / f"{trace['id']}.mp4").relative_to(project_dir)),
        }
        traces.append(trace)
        print(f"prepared {project}/{lesson.stem}: {trace['slideCount']} slides, {trace['voice']}")
    manifest = {"schemaVersion": 1, "project": project, "source": "lessons/*.md", "artifactsRoot": "dist/lessons",
                "qualityContract": {"pptx": "editable vector", "mp4": "1920x1080@30fps", "intermediateFrames": "PNG", "h264Crf": 12},
                "lessons": traces}
    (project_dir / "lesson-media.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest {project}/lesson-media.json ({len(traces)} lessons)")


def run(command: list[str], cwd: Path, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, check=False, text=True,
                            capture_output=capture)
    if result.returncode != 0:
        if capture:
            print(result.stdout, file=sys.stderr)
            print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    return result


def deck_to_video(pptx: Path, presentation_path: Path, manifest_path: Path,
                  deck: dict[str, Any], audio_manifest: dict[str, Any], public_dir: Path, output: Path) -> None:
    """Encode a narrated MP4 from lossless stills of the same deck as the PPTX.

    The PPTX remains editable vector content. The video renderer bundles once,
    captures one lossless 1920x1080 PNG per semantic slide after its entry
    transition, then encodes those PNGs at H.264 CRF 16. No JPEG intermediate
    and no lowered render scale are permitted.
    """
    if not pptx.is_file():
        raise SystemExit(f"missing final PPTX: {pptx}")
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    node = shutil.which("node")
    missing = [name for name, value in (("ffmpeg", ffmpeg), ("ffprobe", ffprobe), ("node", node)) if not value]
    if missing:
        raise SystemExit(f"missing video tools: {', '.join(missing)}")
    lusine = Path.home() / "coding" / "lusine-a-reves"
    still_script = lusine / "core" / "scripts" / "render-slide-stills.mjs"
    if not still_script.is_file():
        raise SystemExit(f"missing still renderer: {still_script}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lesson-deck-video-") as temporary:
        work = Path(temporary)
        run([node, str(still_script),
             "--presentation", str(presentation_path),
             "--manifest", str(manifest_path),
             "--public-dir", str(public_dir),
             "--output-dir", str(work)], lusine, capture=True)
        images = sorted((work / "stills").glob("slide-*.png"),
                        key=lambda item: int(item.stem.split("-")[-1]))
        if len(images) != len(deck["slides"]):
            raise SystemExit(f"still page mismatch: {len(images)} images for {len(deck['slides'])} slides")
        segments: list[Path] = []
        for index, (slide, image) in enumerate(zip(deck["slides"], images, strict=True), 1):
            probe = json.loads(run([ffprobe, "-v", "error", "-show_entries", "stream=width,height",
                                    "-of", "json", str(image)], ROOT, capture=True).stdout)
            stream = probe["streams"][0]
            if (int(stream["width"]), int(stream["height"])) != (1920, 1080):
                raise SystemExit(f"slide still {index} is not 1920x1080: {stream}")
            audio_key = slide.get("audio")
            entry = audio_manifest.get(audio_key) if audio_key else None
            audio = public_dir / audio_key if audio_key else None
            audio_duration = float(entry["durationSec"]) if entry else 0.0
            duration = max(float(slide.get("minDurationSec", 7)),
                           audio_duration + float(deck["tailFrames"]) / float(deck["fps"]))
            segment = work / f"segment-{index:02d}.mp4"
            command = [ffmpeg, "-y", "-loop", "1", "-framerate", str(deck["fps"]), "-i", str(image)]
            if audio and audio.is_file():
                command += ["-i", str(audio), "-filter_complex", "[1:a]apad[a]", "-map", "0:v:0", "-map", "[a]"]
            else:
                command += ["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-map", "0:v:0", "-map", "1:a:0"]
            command += ["-t", f"{duration:.3f}", "-r", str(deck["fps"]),
                        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage",
                        "-crf", "12", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                        "-shortest", str(segment)]
            run(command, ROOT, capture=True)
            segments.append(segment)
        concat = work / "segments.txt"
        concat.write_text("".join(f"file '{segment.as_posix()}'\n" for segment in segments), encoding="utf-8")
        temporary_output = output.with_suffix(".tmp.mp4")
        temporary_output.unlink(missing_ok=True)
        run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
             "-c", "copy", "-movflags", "+faststart", str(temporary_output)], ROOT, capture=True)
        output.unlink(missing_ok=True)
        temporary_output.replace(output)

def build(project: str, lesson: str, force_audio: bool) -> None:
    project_dir = ROOT / project
    manifest = json.loads((project_dir / "lesson-media.json").read_text(encoding="utf-8"))
    trace = next((item for item in manifest["lessons"] if Path(item["lesson"]).stem == lesson), None)
    if not trace:
        raise SystemExit(f"unknown lesson {project}/{lesson}")
    lesson_dir = project_dir / "dist" / "lessons" / lesson
    lusine = Path.home() / "coding" / "lusine-a-reves"
    common = [
        "--presentation", str(lesson_dir / "presentation.json"),
        "--manifest", str(lesson_dir / "audio-manifest.json"),
        "--public-dir", str(lesson_dir / "public"),
    ]
    audio_args = ["--presentation", str(lesson_dir / "presentation.json"), "--profile", str(lesson_dir / "tts-profile.json"),
                  "--public-dir", str(lesson_dir / "public")]
    if force_audio:
        audio_args.append("--force")
    run(["npm", "run", "voiceover:edge", "--", *audio_args], lusine)
    run(["npm", "run", "manifest", "--", *common], lusine)
    run(["npm", "run", "check", "--", *common], lusine)
    run(["npm", "run", "export:pptx", "--", *common, "--output-dir", str(lesson_dir / "out")], lusine)
    deck = json.loads((lesson_dir / "presentation.json").read_text(encoding="utf-8"))
    audio_manifest = json.loads((lesson_dir / "audio-manifest.json").read_text(encoding="utf-8"))
    deck_to_video(lesson_dir / "out" / f"{trace['id']}.pptx",
                  lesson_dir / "presentation.json", lesson_dir / "audio-manifest.json",
                  deck, audio_manifest, lesson_dir / "public",
                  lesson_dir / "out" / f"{trace['id']}.mp4")
    print(f"built {project}/{lesson}: {trace['paths']['pptx']} + {trace['paths']['mp4']} voice={trace['voice']}")


def validate(project: str) -> int:
    project_dir = ROOT / project
    manifest = json.loads((project_dir / "lesson-media.json").read_text(encoding="utf-8"))
    failures: list[str] = []
    for trace in manifest["lessons"]:
        lesson = Path(trace["lesson"]).stem
        lesson_dir = project_dir / "dist" / "lessons" / lesson
        deck = json.loads((lesson_dir / "presentation.json").read_text(encoding="utf-8"))
        profile = json.loads((lesson_dir / "tts-profile.json").read_text(encoding="utf-8"))
        if profile["voice"] != trace["voice"]:
            failures.append(f"{lesson}: voice trace mismatch")
        if (deck["width"], deck["height"], deck["fps"]) != (1920, 1080, 30):
            failures.append(f"{lesson}: deck quality contract mismatch")
        for kind in ("pptx", "mp4"):
            path = project_dir / trace["paths"][kind]
            if not path.is_file() or path.stat().st_size == 0:
                failures.append(f"{lesson}: missing {kind} {path}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"validated {project}: {len(manifest['lessons'])} lessons")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--project", choices=PROJECTS, required=True)
    b = sub.add_parser("build"); b.add_argument("--project", choices=PROJECTS, required=True); b.add_argument("--lesson", required=True); b.add_argument("--force-audio", action="store_true")
    v = sub.add_parser("validate"); v.add_argument("--project", choices=PROJECTS, required=True)
    args = parser.parse_args()
    if args.command == "prepare": prepare(args.project); return 0
    if args.command == "build": build(args.project, args.lesson, args.force_audio); return 0
    return validate(args.project)


if __name__ == "__main__":
    raise SystemExit(main())
