"""Build one continuous Harness lecture: frames, a single MP4, and a single PPTX.

The three chapter decks stay the authoring source. This tool merges them into one
course so a teacher plays a single video instead of stitching fragments, and it
renders every visual from the same data so slides, video, and images agree.
"""

from __future__ import annotations

import html
import json
import math
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
WORKSHOP = ROOT / "dsh-workshop"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
SIPS = "/usr/bin/sips"

COURSE_ID = "harness-course"
FOOTER_BASELINE = 696
CONTENT_BOTTOM = 668
COURSE_TITLE = "一堂 Harness 教学课"
COURSE_SUBTITLE = "从一个删文件的工具，到该在哪一层扩展"
WIDTH, HEIGHT, FPS, TAIL_FRAMES = 1280, 720, 15, 8

THEME = {
    "paper": "#08111f", "panel": "#122238", "panel2": "#0d1b2d",
    "ink": "#e6edf3", "muted": "#8da2b8", "line": "#26415f",
    "accent": "#2dd4bf", "accent2": "#60a5fa", "accent3": "#fbbf24",
}

CHAPTERS = [
    ("01-dsh-capabilities", "第一章", "一个工具要走完的十二道关"),
    ("02-iota-alignment", "第二章", "同样十二个方向，换一层来做"),
    ("03-boundaries-selection", "第三章", "缝开在哪一层，就选哪一个"),
]


@dataclass
class Slide:
    data: dict[str, Any]
    chapter_index: int
    chapter_label: str
    chapter_title: str
    number: int
    audio: Path
    duration: float
    image_source: Path | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def frames(self) -> int:
        floor = float(self.data["minDurationSec"]) * FPS
        narrated = self.duration * FPS + TAIL_FRAMES
        return max(1, math.ceil(max(floor, narrated)))


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def char_width(char: str, size: float) -> float:
    if unicodedata.east_asian_width(char) in ("W", "F"):
        return size
    return size * 0.56


def wrap(value: str, size: float, limit: float) -> list[str]:
    lines: list[str] = []
    current = ""
    width = 0.0
    for char in value:
        step = char_width(char, size)
        if width + step > limit and current:
            lines.append(current)
            current, width = "", 0.0
        current += char
        width += step
    if current:
        lines.append(current)
    return lines


def text_el(x: float, y: float, value: str, *, size: float, fill: str, weight: str = "400",
            anchor: str = "start", family: str = "PingFang SC, Helvetica, sans-serif",
            opacity: float = 1.0) -> str:
    return (
        f'<text x="{x:.0f}" y="{y:.0f}" fill="{fill}" fill-opacity="{opacity}" text-anchor="{anchor}" '
        f'font-family="{family}" font-size="{size:.0f}" font-weight="{weight}">{esc(value)}</text>'
    )


def paragraph(x: float, y: float, value: str, *, size: float, fill: str, limit: float,
              leading: float = 1.5, weight: str = "400", max_lines: int = 4) -> str:
    out = []
    for index, line in enumerate(wrap(value, size, limit)[:max_lines]):
        out.append(text_el(x, y + index * size * leading, line, size=size, fill=fill, weight=weight))
    return "".join(out)


def probe_duration(path: Path) -> float:
    payload = json.loads(subprocess.check_output(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)], text=True))
    return float(payload["format"]["duration"])


def rasterize(svg: Path, png: Path, overlay: Path | None = None,
              box: tuple[int, int, int, int] | None = None) -> None:
    png.parent.mkdir(parents=True, exist_ok=True)
    raster = svg.with_suffix(".raster.png")
    subprocess.run([SIPS, "-s", "format", "png", str(svg), "--out", str(raster)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    scale = (f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
             f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x08111f")
    if overlay is None:
        command = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raster),
                   "-vf", scale, "-frames:v", "1", str(png)]
    else:
        x, y, w, h = box or (0, 0, WIDTH, HEIGHT)
        command = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raster),
                   "-i", str(overlay), "-filter_complex",
                   f"[0:v]{scale}[bg];[1:v]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
                   f"[bg][fg]overlay=x={x}+({w}-overlay_w)/2:y={y}+({h}-overlay_h)/2",
                   "-frames:v", "1", str(png)]
    subprocess.run(command, check=True)
    raster.unlink(missing_ok=True)


def chrome(slide: Slide, total: int) -> str:
    progress = slide.number / total
    parts = [
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{THEME["paper"]}"/>',
        "".join(
            f'<line x1="{x}" y1="64" x2="{x}" y2="{HEIGHT - 6}" stroke="{THEME["line"]}" '
            f'stroke-opacity="0.20" stroke-width="1"/>' for x in range(80, WIDTH, 80)),
        f'<rect x="0" y="0" width="{WIDTH}" height="64" fill="{THEME["panel2"]}"/>',
        f'<rect x="0" y="63" width="{WIDTH}" height="1" fill="{THEME["line"]}"/>',
        f'<rect x="40" y="22" width="6" height="22" rx="3" fill="{THEME["accent"]}"/>',
        text_el(58, 40, f'{slide.chapter_label} · {slide.chapter_title}', size=20, fill=THEME["ink"], weight="600"),
        text_el(WIDTH - 40, 40, f'{slide.number:02d} / {total}', size=19, fill=THEME["muted"], anchor="end"),
        text_el(40, FOOTER_BASELINE, f'{COURSE_TITLE} · {COURSE_SUBTITLE}', size=17, fill=THEME["muted"]),
        f'<rect x="0" y="{HEIGHT - 6}" width="{WIDTH}" height="6" fill="{THEME["panel"]}"/>',
        f'<rect x="0" y="{HEIGHT - 6}" width="{WIDTH * progress:.0f}" height="6" fill="{THEME["accent"]}"/>',
    ]
    for index, (_slug, label, _title) in enumerate(CHAPTERS, start=1):
        active = index == slide.chapter_index
        parts.append(
            f'<circle cx="{WIDTH - 150 + index * 26}" cy="{HEIGHT - 31}" r="6" '
            f'fill="{THEME["accent"] if active else THEME["panel"]}" '
            f'stroke="{THEME["line"]}" stroke-width="1"/>')
    return "".join(parts)


def heading(slide: Slide, *, top: int = 118) -> tuple[str, int]:
    data = slide.data
    out = [text_el(72, top, data["eyebrow"], size=21, fill=THEME["accent3"], weight="600")]
    lines = wrap(data["title"], 43, WIDTH - 200)[:2]
    for index, line in enumerate(lines):
        out.append(text_el(72, top + 60 + index * 56, line, size=43, fill=THEME["ink"], weight="700"))
    out.append(f'<rect x="72" y="{top + 78 + (len(lines) - 1) * 56}" width="86" height="4" rx="2" fill="{THEME["accent2"]}"/>')
    return "".join(out), top + 96 + (len(lines) - 1) * 56


def chips(items: list[str], y: float) -> str:
    out = []
    width, gap = 268, 20
    for index, item in enumerate(items[:4]):
        column, row = index % 2, index // 2
        x = 72 + column * (width + gap)
        top = y + row * 74
        out.append(f'<rect x="{x}" y="{top}" width="{width}" height="56" rx="12" fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        out.append(f'<circle cx="{x + 24}" cy="{top + 28}" r="5" fill="{THEME["accent"]}"/>')
        out.append(text_el(x + 42, top + 35, item, size=21, fill=THEME["ink"]))
    return "".join(out)


def render_title(slide: Slide, total: int) -> str:
    data = slide.data
    body = [chrome(slide, total)]
    body.append(f'<rect x="72" y="150" width="6" height="150" rx="3" fill="{THEME["accent"]}"/>')
    body.append(text_el(104, 190, f'{slide.chapter_label} · {data["eyebrow"]}', size=22, fill=THEME["accent3"], weight="600"))
    for index, line in enumerate(wrap(data["title"], 52, 900)[:2]):
        body.append(text_el(104, 250 + index * 64, line, size=52, fill=THEME["ink"], weight="700"))
    if data.get("subtitle"):
        body.append(paragraph(104, 356, data["subtitle"], size=24, fill=THEME["muted"], limit=940, max_lines=2))
    if data.get("body"):
        body.append(paragraph(104, 424, data["body"], size=23, fill=THEME["accent2"], limit=940, max_lines=2))
    if data.get("bullets"):
        body.append(chips(data["bullets"], 470))
    return svg_document("".join(body))


def render_text(slide: Slide, total: int) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide, total), head]
    if slide.data.get("body"):
        body.append(paragraph(72, cursor + 46, slide.data["body"], size=25, fill=THEME["accent2"], limit=WIDTH - 200, max_lines=2))
        cursor += 60
    if slide.data.get("bullets"):
        body.append(chips(slide.data["bullets"], cursor + 62))
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def render_overview(slide: Slide, total: int) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide, total), head]
    cards = slide.data.get("stats", [])[:4]
    width, gap = 272, 18
    for index, card in enumerate(cards):
        x = 72 + index * (width + gap)
        body.append(f'<rect x="{x}" y="{cursor + 44}" width="{width}" height="196" rx="16" fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        body.append(f'<rect x="{x}" y="{cursor + 44}" width="{width}" height="5" rx="2" fill="{THEME["accent"]}"/>')
        for line_index, line in enumerate(wrap(str(card.get("value", "")), 38, width - 44)[:1]):
            body.append(text_el(x + 22, cursor + 116, line, size=38, fill=THEME["accent"], weight="700"))
        body.append(paragraph(x + 22, cursor + 156, str(card.get("label", "")), size=21, fill=THEME["ink"], limit=width - 44, max_lines=2))
        body.append(paragraph(x + 22, cursor + 206, str(card.get("detail", "")), size=17, fill=THEME["muted"], limit=width - 44, max_lines=2))
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def render_diagram(slide: Slide, total: int) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide, total), head]
    nodes = slide.data.get("nodes", [])[:5]
    count = max(1, len(nodes))
    gap = 16
    width = min(232, int((WIDTH - 144 - gap * (count - 1)) / count))
    top = cursor + 74
    for index, node in enumerate(nodes):
        x = 72 + index * (width + gap)
        body.append(f'<rect x="{x}" y="{top}" width="{width}" height="152" rx="16" fill="{THEME["panel"]}" stroke="{THEME["accent2"]}" stroke-width="2"/>')
        body.append(paragraph(x + 18, top + 54, str(node.get("label", "")), size=25, fill=THEME["ink"], limit=width - 36, weight="700", max_lines=2))
        body.append(paragraph(x + 18, top + 104, str(node.get("sub", "")), size=17, fill=THEME["muted"], limit=width - 36, max_lines=3))
        if index < len(nodes) - 1:
            arrow_x = x + width + gap / 2
            body.append(f'<path d="M{arrow_x - 7} {top + 76} L{arrow_x + 7} {top + 76}" stroke="{THEME["accent"]}" stroke-width="3"/>')
            body.append(f'<polygon points="{arrow_x + 9},{top + 76} {arrow_x + 1},{top + 71} {arrow_x + 1},{top + 81}" fill="{THEME["accent"]}"/>')
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def render_closing(slide: Slide, total: int) -> str:
    body = [chrome(slide, total)]
    body.append(text_el(WIDTH / 2, 200, f'{slide.chapter_label} · {slide.data["eyebrow"]}', size=22, fill=THEME["accent3"], weight="600", anchor="middle"))
    for index, line in enumerate(wrap(slide.data["title"], 46, 1000)[:2]):
        body.append(text_el(WIDTH / 2, 272 + index * 58, line, size=46, fill=THEME["ink"], weight="700", anchor="middle"))
    quote = slide.data.get("quote", "")
    if quote:
        body.append(f'<rect x="180" y="392" width="920" height="150" rx="18" fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        body.append(text_el(214, 452, "“", size=54, fill=THEME["accent"], weight="700"))
        for index, line in enumerate(wrap(quote, 26, 760)[:3]):
            body.append(text_el(258, 442 + index * 40, line, size=26, fill=THEME["ink"]))
    return svg_document("".join(body))


def render_image_chrome(slide: Slide, total: int) -> tuple[str, tuple[int, int, int, int]]:
    """Image pages use a compact header so the asset itself gets the vertical space."""
    data = slide.data
    body = [chrome(slide, total)]
    body.append(text_el(72, 100, data["eyebrow"], size=19, fill=THEME["accent3"], weight="600"))
    title = wrap(data["title"], 34, WIDTH - 220)[:1]
    if title:
        body.append(text_el(72, 138, title[0], size=34, fill=THEME["ink"], weight="700"))
    caption = data.get("image", {}).get("caption", "")
    if caption:
        body.append(text_el(72, 172, caption, size=18, fill=THEME["muted"]))
    box_h = 470
    box_w = int(box_h * 16 / 9)
    box = ((WIDTH - box_w) // 2, 190, box_w, box_h)
    body.append(
        f'<rect x="{box[0] - 8}" y="{box[1] - 8}" width="{box[2] + 16}" height="{box[3] + 16}" '
        f'rx="14" fill="{THEME["panel2"]}" stroke="{THEME["line"]}"/>')
    return svg_document("".join(body)), box


def callout(value: str) -> str:
    return "".join([
        f'<rect x="72" y="{HEIGHT - 118}" width="{WIDTH - 144}" height="58" rx="12" fill="{THEME["panel2"]}" stroke="{THEME["accent3"]}"/>',
        f'<rect x="72" y="{HEIGHT - 118}" width="5" height="58" rx="2" fill="{THEME["accent3"]}"/>',
        text_el(100, HEIGHT - 82, value, size=21, fill=THEME["accent3"]),
    ])


def svg_document(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
            f'viewBox="0 0 {WIDTH} {HEIGHT}">{body}</svg>')


def check_layout(document: str, label: str) -> None:
    """Fail loudly when a rendered slide would clip text or leave the canvas."""
    import re
    for x, y in re.findall(r'<text x="(-?[\d.]+)" y="(-?[\d.]+)"', document):
        assert 0 <= float(x) <= WIDTH, f"{label}: text x={x} outside canvas"
        baseline = float(y)
        assert 24 <= baseline <= HEIGHT - 12, f"{label}: text baseline y={y} outside safe area"
        assert baseline <= CONTENT_BOTTOM or baseline == FOOTER_BASELINE, (
            f"{label}: text baseline y={y} collides with the footer band")
    for x, y, w, h in re.findall(
            r'<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"', document):
        assert float(x) >= 0 and float(x) + float(w) <= WIDTH + 1, f"{label}: rect overflows width"
        assert float(y) >= 0 and float(y) + float(h) <= HEIGHT + 1, f"{label}: rect overflows height"


def check_ink(png: Path, label: str) -> None:
    """A frame that matches a blank background means the renderer produced nothing."""
    blank = png.parent / ".blank.png"
    if not blank.exists():
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", f"color=c=0x08111f:s={WIDTH}x{HEIGHT}", "-frames:v", "1", str(blank)],
                       check=True)
    output = subprocess.run(
        [FFMPEG, "-hide_banner", "-v", "error", "-i", str(png), "-i", str(blank),
         "-lavfi", "psnr=stats_file=-", "-f", "null", "-"],
        text=True, capture_output=True, check=True).stdout + ""
    import re
    match = re.search(r"psnr_avg:([\d.]+|inf)", output)
    assert match, f"{label}: psnr probe produced no result"
    value = match.group(1)
    assert value != "inf" and float(value) < 40, f"{label}: frame looks blank (psnr={value})"


def load_slides() -> list[Slide]:
    slides: list[Slide] = []
    number = 0
    for chapter_index, (slug, label, chapter_title) in enumerate(CHAPTERS, start=1):
        deck = json.loads((WORKSHOP / "02-decks" / slug / "presentation.json").read_text(encoding="utf-8"))
        public = WORKSHOP / "03-public" / slug
        for data in deck["slides"]:
            number += 1
            audio = public / data["audio"]
            picture = data.get("image")
            slides.append(Slide(
                data=data, chapter_index=chapter_index, chapter_label=label,
                chapter_title=chapter_title, number=number, audio=audio,
                duration=probe_duration(audio),
                image_source=(public / picture["src"]) if picture else None,
                extras={"source_deck": slug, "source_id": data["id"]},
            ))
    return slides


RENDERERS = {
    "title": render_title, "text": render_text, "overview": render_overview,
    "diagram": render_diagram, "closing": render_closing,
}


def render_frames(slides: list[Slide]) -> list[Path]:
    frame_dir = WORKSHOP / "03-public" / COURSE_ID / "frames"
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True)
    work = WORKSHOP / ".build-tmp"
    work.mkdir(exist_ok=True)
    outputs = []
    for slide in slides:
        svg = work / f"slide-{slide.number:02d}.svg"
        png = frame_dir / f"slide-{slide.number:02d}.png"
        if slide.data["type"] == "image":
            document, box = render_image_chrome(slide, len(slides))
            check_layout(document, slide.data["id"])
            svg.write_text(document, encoding="utf-8")
            rasterize(svg, png, overlay=slide.image_source, box=box)
        else:
            renderer = RENDERERS[slide.data["type"]]
            document = renderer(slide, len(slides))
            check_layout(document, slide.data["id"])
            svg.write_text(document, encoding="utf-8")
            rasterize(svg, png)
        check_ink(png, slide.data["id"])
        outputs.append(png)
        print(f"FRAME_OK {slide.number:02d}/{len(slides)} {slide.data['id']}")
    shutil.rmtree(work, ignore_errors=True)
    (frame_dir / ".blank.png").unlink(missing_ok=True)
    return outputs


def write_course_deck(slides: list[Slide]) -> None:
    public = WORKSHOP / COURSE_ID
    audio_dir = WORKSHOP / "03-public" / COURSE_ID / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, Any]] = {}
    payload_slides = []
    for slide in slides:
        target_name = f"audio/{slide.audio.name}"
        shutil.copy2(slide.audio, audio_dir / slide.audio.name)
        manifest[target_name] = {"path": target_name, "durationSec": round(slide.duration, 3)}
        entry = dict(slide.data)
        entry["audio"] = target_name
        entry["chapter"] = slide.chapter_index
        entry["chapterTitle"] = f"{slide.chapter_label} · {slide.chapter_title}"
        entry["courseIndex"] = slide.number
        entry["frame"] = f"frames/slide-{slide.number:02d}.png"
        if slide.image_source is not None:
            picture = dict(entry["image"])
            picture["src"] = f"images/{slide.image_source.name}"
            entry["image"] = picture
            images = WORKSHOP / "03-public" / COURSE_ID / "images"
            images.mkdir(parents=True, exist_ok=True)
            shutil.copy2(slide.image_source, images / slide.image_source.name)
        payload_slides.append(entry)
    deck = {
        "schemaVersion": 1, "id": COURSE_ID, "title": COURSE_TITLE, "subtitle": COURSE_SUBTITLE,
        "author": "DSH Workshop", "fps": FPS, "width": WIDTH, "height": HEIGHT,
        "tailFrames": TAIL_FRAMES, "showCaptions": False, "theme": THEME,
        "chapters": [{"index": index, "label": label, "title": title,
                      "slides": sum(1 for s in slides if s.chapter_index == index)}
                     for index, (_slug, label, title) in enumerate(CHAPTERS, start=1)],
        "slides": payload_slides,
    }
    deck_dir = WORKSHOP / "02-decks" / COURSE_ID
    deck_dir.mkdir(parents=True, exist_ok=True)
    (deck_dir / "presentation.json").write_text(
        json.dumps(deck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (deck_dir / "audio-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    del public


def write_course_script(slides: list[Slide]) -> None:
    commands: dict[str, list[str]] = {}
    for slug, _label, _title in CHAPTERS:
        source = (WORKSHOP / "01-scripts" / f"{slug}.md").read_text(encoding="utf-8")
        import re
        commands[slug] = re.findall(r"\*\*复现命令\*\*\n\n```bash\n(.*?)\n```", source, re.S)
    counters = {slug: 0 for slug, _l, _t in CHAPTERS}
    lines = [f"# {COURSE_TITLE}", "", f"> {COURSE_SUBTITLE}", "",
             f"一堂连续课：{len(slides)} 页、三章、单一视频。每页给出旁白与可复现命令。", ""]
    current_chapter = 0
    for slide in slides:
        if slide.chapter_index != current_chapter:
            current_chapter = slide.chapter_index
            lines += [f"## {slide.chapter_label} · {slide.chapter_title}", ""]
        slug = slide.extras["source_deck"]
        command = commands[slug][counters[slug]]
        counters[slug] += 1
        lines += [f"### {slide.number:02d} · {slide.data['title']}", "",
                  "**旁白**", "", slide.data["narration"], "",
                  "**复现命令**", "", "```bash", command, "```", ""]
    (WORKSHOP / "01-scripts" / f"{COURSE_ID}.md").write_text("\n".join(lines), encoding="utf-8")


def build_video(slides: list[Slide], frames: list[Path]) -> Path:
    work = WORKSHOP / ".build-tmp" / "video"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    segments = []
    for slide, frame in zip(slides, frames, strict=True):
        seconds = slide.frames / FPS
        segment = work / f"seg-{slide.number:02d}.mp4"
        subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
             "-loop", "1", "-framerate", str(FPS), "-i", str(frame),
             "-i", str(slide.audio), "-af", "apad", "-t", f"{seconds:.4f}",
             "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
             "-r", str(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
             "-movflags", "+faststart", str(segment)], check=True)
        segments.append(segment)
        print(f"SEGMENT_OK {slide.number:02d}/{len(slides)} {seconds:.2f}s")
    listing = work / "segments.txt"
    listing.write_text("".join(f"file '{segment.name}'\n" for segment in segments), encoding="utf-8")
    output = WORKSHOP / "04-out" / f"{COURSE_ID}.mp4"
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
                    "-safe", "0", "-i", str(listing), "-c", "copy",
                    "-movflags", "+faststart", str(output)], check=True, cwd=work)
    shutil.rmtree(WORKSHOP / ".build-tmp", ignore_errors=True)
    return output


PPT_NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
EMU_W, EMU_H = 12192000, 6858000


def slide_xml(slide: Slide) -> str:
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<p:sld {PPT_NS}><p:cSld name="{esc(slide.data["id"])}">'
            f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="08111F"/></a:solidFill>'
            f'<a:effectLst/></p:bgPr></p:bg><p:spTree>'
            f'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            f'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            f'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            f'<p:pic><p:nvPicPr><p:cNvPr id="2" name="{esc(slide.data["title"])}" '
            f'descr="{esc(slide.data["title"])}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/>'
            f'</p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/>'
            f'<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm>'
            f'<a:off x="0" y="0"/><a:ext cx="{EMU_W}" cy="{EMU_H}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
            f'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')


def notes_xml(slide: Slide, command: str) -> str:
    blocks = [f'{slide.chapter_label} · {slide.chapter_title}',
              f'第 {slide.number} 页 · {slide.data["title"]}',
              slide.data["narration"], f'复现命令：{command}']
    paragraphs = "".join(
        f'<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/>'
        f'<a:t>{esc(block)}</a:t></a:r></a:p>' for block in blocks)
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<p:notes {PPT_NS}><p:cSld><p:spTree>'
            f'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            f'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            f'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            f'<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>'
            f'<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
            f'<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
            f'<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>'
            f'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            f'<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
            f'<p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>'
            f'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>')


def build_pptx(slides: list[Slide], frames: list[Path], commands: list[str]) -> Path:
    skeleton = Path(__file__).resolve().parent / "pptx-skeleton"
    import zipfile
    reuse = ["_rels/.rels", "ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml",
             "ppt/theme/theme1.xml", "ppt/slideMasters/slideMaster1.xml",
             "ppt/slideMasters/_rels/slideMaster1.xml.rels",
             "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
             "ppt/notesMasters/notesMaster1.xml", "ppt/notesMasters/_rels/notesMaster1.xml.rels"]
    output = WORKSHOP / "04-out" / f"{COURSE_ID}.pptx"
    titles = "".join(f'<vt:lpstr>{esc(slide.data["title"])}</vt:lpstr>' for slide in slides)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in reuse:
            source = skeleton / name
            assert source.is_file(), source
            archive.writestr(name, source.read_bytes())
        count = len(slides)
        overrides = [
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
            '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>',
            '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
            '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
            '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
        ]
        presentation_rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
        slide_ids = []
        for index, (slide, frame, command) in enumerate(zip(slides, frames, commands, strict=True), start=1):
            rel_id = f"rId{index + 1}"
            archive.writestr(f"ppt/slides/slide{index}.xml", slide_xml(slide))
            archive.writestr(f"ppt/notesSlides/notesSlide{index}.xml", notes_xml(slide, command))
            archive.writestr(f"ppt/media/slide-{index:02d}.png", frame.read_bytes())
            archive.writestr(
                f"ppt/slides/_rels/slide{index}.xml.rels",
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships {REL_NS}>'
                f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
                f'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/slide-{index:02d}.png"/>'
                f'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide{index}.xml"/>'
                f'</Relationships>')
            archive.writestr(
                f"ppt/notesSlides/_rels/notesSlide{index}.xml.rels",
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships {REL_NS}>'
                f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>'
                f'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide{index}.xml"/>'
                f'</Relationships>')
            overrides.append(f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
            overrides.append(f'<Override PartName="/ppt/notesSlides/notesSlide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>')
            presentation_rels.append(f'<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{index}.xml"/>')
            slide_ids.append(f'<p:sldId id="{255 + index}" r:id="{rel_id}"/>')
        tail_base = count + 2
        presentation_rels += [
            f'<Relationship Id="rId{tail_base}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>',
            f'<Relationship Id="rId{tail_base + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>',
            f'<Relationship Id="rId{tail_base + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>',
            f'<Relationship Id="rId{tail_base + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
            f'<Relationship Id="rId{tail_base + 4}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>',
        ]
        archive.writestr("ppt/_rels/presentation.xml.rels",
                         f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         f'<Relationships {REL_NS}>{"".join(presentation_rels)}</Relationships>')
        archive.writestr("ppt/presentation.xml",
                         f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         f'<p:presentation {PPT_NS} saveSubsetFonts="1" autoCompressPictures="0">'
                         f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
                         f'<p:sldIdLst>{"".join(slide_ids)}</p:sldIdLst>'
                         f'<p:notesMasterIdLst><p:notesMasterId r:id="rId{tail_base}"/></p:notesMasterIdLst>'
                         f'<p:sldSz cx="{EMU_W}" cy="{EMU_H}"/><p:notesSz cx="6858000" cy="12192000"/>'
                         f'</p:presentation>')
        archive.writestr("[Content_Types].xml",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                         '<Default Extension="xml" ContentType="application/xml"/>'
                         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                         '<Default Extension="png" ContentType="image/png"/>'
                         f'{"".join(overrides)}</Types>')
        archive.writestr("docProps/core.xml",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                         'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                         'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                         f'<dc:title>{esc(COURSE_TITLE)}</dc:title><dc:subject>{esc(COURSE_SUBTITLE)}</dc:subject>'
                         '<dc:creator>DSH Workshop</dc:creator><cp:revision>1</cp:revision></cp:coreProperties>')
        archive.writestr("docProps/app.xml",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                         'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
                         f'<Application>DSH Workshop course builder</Application><Slides>{count}</Slides>'
                         f'<TitlesOfParts><vt:vector size="{count}" baseType="lpstr">'
                         f'{titles}'
                         '</vt:vector></TitlesOfParts></Properties>')
    return output


def main() -> None:
    slides = load_slides()
    assert len(slides) == 40, len(slides)
    frames = render_frames(slides)
    write_course_deck(slides)
    write_course_script(slides)
    import re
    commands = re.findall(r"\*\*复现命令\*\*\n\n```bash\n(.*?)\n```",
                          (WORKSHOP / "01-scripts" / f"{COURSE_ID}.md").read_text(encoding="utf-8"), re.S)
    assert len(commands) == len(slides), (len(commands), len(slides))
    video = build_video(slides, frames)
    deck = build_pptx(slides, frames, commands)
    total = sum(slide.frames for slide in slides) / FPS
    print(f"COURSE_OK slides={len(slides)} runtime={total:.1f}s video={video.name} pptx={deck.name}")


if __name__ == "__main__":
    main()
