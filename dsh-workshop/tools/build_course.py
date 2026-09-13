"""Render twelve episodes: frames, one MP4 per episode, one PPTX per episode.

Slides, video and deck all come from the same episode JSON, so what a student sees on screen,
hears in the narration and reads in the speaker notes cannot drift apart.

Two rendering disciplines are enforced while building, not after shipping:

* layout — text may not leave the canvas or collide with the footer band;
* ink    — a frame that is indistinguishable from an empty background fails the build, so a
           broken renderer cannot ship a silently blank page.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import re
import shutil
import subprocess
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from course_content import COURSE_SUBTITLE, COURSE_TITLE, THEME  # noqa: E402

WORKSHOP = Path(__file__).resolve().parents[1]
DECKS = WORKSHOP / "02-decks"
PUBLIC = WORKSHOP / "03-public"
OUT = WORKSHOP / "04-out"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
SIPS = "/usr/bin/sips"

WIDTH, HEIGHT, FPS, TAIL_FRAMES = 1280, 720, 15, 8
FOOTER_BASELINE = 696
CONTENT_BOTTOM = 668
MONO = "Menlo, DejaVu Sans Mono, monospace"
SANS = "PingFang SC, Helvetica, sans-serif"


@dataclass
class Slide:
    data: dict[str, Any]
    episode: dict[str, Any]
    number: int
    total: int
    audio: Path
    duration: float

    @property
    def frames(self) -> int:
        floor = float(self.data["minDurationSec"]) * FPS
        narrated = self.duration * FPS + TAIL_FRAMES
        return max(1, math.ceil(max(floor, narrated)))


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def char_width(char: str, size: float) -> float:
    return size if unicodedata.east_asian_width(char) in ("W", "F") else size * 0.56


def wrap(value: str, size: float, limit: float) -> list[str]:
    lines: list[str] = []
    current, width = "", 0.0
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
            anchor: str = "start", family: str = SANS, opacity: float = 1.0) -> str:
    return (
        f'<text x="{x:.0f}" y="{y:.0f}" fill="{fill}" fill-opacity="{opacity}" text-anchor="{anchor}" '
        f'font-family="{family}" font-size="{size:.0f}" font-weight="{weight}">{esc(value)}</text>'
    )


def paragraph(x: float, y: float, value: str, *, size: float, fill: str, limit: float,
              leading: float = 1.5, weight: str = "400", max_lines: int = 4,
              family: str = SANS) -> str:
    out = []
    for index, line in enumerate(wrap(value, size, limit)[:max_lines]):
        out.append(text_el(x, y + index * size * leading, line, size=size, fill=fill,
                           weight=weight, family=family))
    return "".join(out)


def svg_document(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
            f'viewBox="0 0 {WIDTH} {HEIGHT}">{body}</svg>')


def chrome(slide: Slide) -> str:
    episode = slide.episode
    progress = slide.number / slide.total
    parts = [
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{THEME["paper"]}"/>',
        "".join(
            f'<line x1="{x}" y1="64" x2="{x}" y2="{HEIGHT - 6}" stroke="{THEME["line"]}" '
            f'stroke-opacity="0.20" stroke-width="1"/>' for x in range(80, WIDTH, 80)),
        f'<rect x="0" y="0" width="{WIDTH}" height="64" fill="{THEME["panel2"]}"/>',
        f'<rect x="0" y="63" width="{WIDTH}" height="1" fill="{THEME["line"]}"/>',
        f'<rect x="40" y="22" width="6" height="22" rx="3" fill="{THEME["accent"]}"/>',
        text_el(58, 40, f'第 {episode["number"]} 集 · {episode["module"]} · {episode["title"].split("·")[-1].strip()}',
                size=20, fill=THEME["ink"], weight="600"),
        text_el(WIDTH - 40, 40, f'{slide.number:02d} / {slide.total}', size=19,
                fill=THEME["muted"], anchor="end"),
        text_el(40, FOOTER_BASELINE, f'{COURSE_TITLE} · {COURSE_SUBTITLE}', size=17, fill=THEME["muted"]),
        f'<rect x="0" y="{HEIGHT - 6}" width="{WIDTH}" height="6" fill="{THEME["panel"]}"/>',
        f'<rect x="0" y="{HEIGHT - 6}" width="{WIDTH * progress:.0f}" height="6" fill="{THEME["accent"]}"/>',
    ]
    return "".join(parts)


def heading(slide: Slide, *, top: int = 116) -> tuple[str, int]:
    data = slide.data
    out = [text_el(72, top, data["eyebrow"], size=21, fill=THEME["accent3"], weight="600")]
    lines = wrap(data["title"], 40, WIDTH - 200)[:2]
    for index, line in enumerate(lines):
        out.append(text_el(72, top + 56 + index * 52, line, size=40, fill=THEME["ink"], weight="700"))
    out.append(f'<rect x="72" y="{top + 74 + (len(lines) - 1) * 52}" width="86" height="4" rx="2" '
               f'fill="{THEME["accent2"]}"/>')
    return "".join(out), top + 92 + (len(lines) - 1) * 52


TERMINAL_MAX_ROWS = 2


def terminal_rows(lines: list[str], size: float, limit: float,
                  max_rows: int = TERMINAL_MAX_ROWS) -> list[str]:
    """Wrap log lines for the panel. A line that still would not fit is a build failure.

    Silently clipping a log line is the worst option: the slide would look fine while the
    verdict at the end of the line disappeared.
    """
    rows: list[str] = []
    for line in lines:
        pieces = wrap(line, size, limit)
        if len(pieces) > max_rows:
            raise AssertionError(f"终端行折行后超过 {max_rows} 行，无法完整显示：{line[:48]}…")
        rows.append(pieces[0] if pieces else "")
        rows.extend(f"  {piece}" for piece in pieces[1:])
    return rows


def shell_panel(x: int, y: int, w: int, h: int, title: str, lines: list[str], *,
                size: float = 17, accent: str | None = None, wrap_lines: bool = False) -> str:
    """A terminal-looking panel. Monospaced, high contrast, deliberately few lines."""
    stroke = accent or THEME["line"]
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{THEME["shell"]}" '
        f'stroke="{stroke}" stroke-width="1.5"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="12" fill="{THEME["panel"]}"/>',
        f'<rect x="{x}" y="{y + 28}" width="{w}" height="2" fill="{stroke}"/>',
    ]
    for index, dot in enumerate((THEME["accent3"], THEME["accent"], THEME["accent2"])):
        out.append(f'<circle cx="{x + 18 + index * 16}" cy="{y + 15}" r="5" fill="{dot}"/>')
    out.append(text_el(x + 74, y + 21, title, size=15, fill=THEME["muted"], family=MONO))
    baseline = y + 56
    capacity = int((h - 44) // (size * 1.42))
    rows = terminal_rows(lines, size, w - 40) if wrap_lines else [
        (wrap(line, size, w - 40) or [""])[0] for line in lines
    ]
    if wrap_lines and len(rows) > capacity:
        raise AssertionError(f"终端面板放不下 {len(rows)} 行（容量 {capacity}）")
    for row in rows[:capacity]:
        out.append(text_el(x + 20, baseline, row, size=size, fill=THEME["ink"], family=MONO))
        baseline += size * 1.42
    return "".join(out)


def render_task(slide: Slide) -> str:
    """The very first frame: task, copyable command and expected result, all at once."""
    data = slide.data
    body = [chrome(slide)]
    body.append(text_el(72, 108, data["eyebrow"], size=21, fill=THEME["accent3"], weight="600"))
    for index, line in enumerate(wrap(f'任务：{data["task"]}', 27, WIDTH - 160)[:3]):
        body.append(text_el(72, 152 + index * 38, line, size=27, fill=THEME["ink"], weight="700"))
    body.append(shell_panel(72, 274, WIDTH - 144, 118, "运行命令（可直接复制）",
                            [f'$ {data["command"]}'], size=19, accent=THEME["accent"]))
    body.append(f'<rect x="72" y="410" width="{WIDTH - 144}" height="176" rx="12" '
                f'fill="{THEME["panel"]}" stroke="{THEME["accent2"]}" stroke-width="1.5"/>')
    body.append(text_el(96, 444, "你将看到", size=19, fill=THEME["accent2"], weight="700"))
    body.append(paragraph(96, 480, data["expect"], size=21, fill=THEME["ink"],
                          limit=WIDTH - 200, max_lines=3))
    body.append(text_el(72, 618, "本集只做这一件事，做完就能自己验证。", size=18, fill=THEME["muted"]))
    return svg_document("".join(body))


def render_terminal(slide: Slide) -> str:
    head, cursor = heading(slide, top=110)
    body = [chrome(slide), head]
    lines = [f'$ {slide.data["command"]}', *slide.data["evidenceText"][1:]]
    # 终端页把面板一路铺到页脚前，字号 16：既装得下折行，也仍然读得清。
    body.append(shell_panel(72, cursor + 26, WIDTH - 144, 650 - (cursor + 26),
                            "真实输出", lines, size=16, wrap_lines=True))
    return svg_document("".join(body))


def render_text(slide: Slide) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide), head]
    if slide.data.get("body"):
        body.append(paragraph(72, cursor + 44, slide.data["body"], size=24,
                              fill=THEME["accent2"], limit=WIDTH - 200, max_lines=2))
        cursor += 58
    if slide.data.get("bullets"):
        body.append(chips(slide.data["bullets"], cursor + 58))
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def chips(items: list[str], y: float) -> str:
    out = []
    width, gap = 268, 20
    for index, item in enumerate(items[:4]):
        column, row = index % 2, index // 2
        x = 72 + column * (width + gap)
        top = y + row * 74
        out.append(f'<rect x="{x}" y="{top}" width="{width}" height="56" rx="12" '
                   f'fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        out.append(f'<circle cx="{x + 24}" cy="{top + 28}" r="5" fill="{THEME["accent"]}"/>')
        out.append(text_el(x + 42, top + 35, item, size=21, fill=THEME["ink"]))
    return "".join(out)


def callout(value: str) -> str:
    return "".join([
        f'<rect x="72" y="{HEIGHT - 118}" width="{WIDTH - 144}" height="58" rx="12" '
        f'fill="{THEME["shell"]}" stroke="{THEME["accent3"]}"/>',
        f'<rect x="72" y="{HEIGHT - 118}" width="5" height="58" rx="2" fill="{THEME["accent3"]}"/>',
        text_el(100, HEIGHT - 82, f'$ {value}', size=18, fill=THEME["accent3"], family=MONO),
    ])


def render_overview(slide: Slide) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide), head]
    cards = slide.data.get("stats", [])[:4]
    width, gap = 272, 18
    for index, card in enumerate(cards):
        x = 72 + index * (width + gap)
        body.append(f'<rect x="{x}" y="{cursor + 40}" width="{width}" height="190" rx="16" '
                    f'fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        body.append(f'<rect x="{x}" y="{cursor + 40}" width="{width}" height="5" rx="2" '
                    f'fill="{THEME["accent"]}"/>')
        body.append(text_el(x + 22, cursor + 108, str(card.get("value", "")), size=34,
                            fill=THEME["accent"], weight="700"))
        body.append(paragraph(x + 22, cursor + 148, str(card.get("label", "")), size=20,
                              fill=THEME["ink"], limit=width - 44, max_lines=2))
        body.append(paragraph(x + 22, cursor + 196, str(card.get("detail", "")), size=17,
                              fill=THEME["muted"], limit=width - 44, max_lines=2))
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def render_diagram(slide: Slide) -> str:
    head, cursor = heading(slide)
    body = [chrome(slide), head]
    nodes = slide.data.get("nodes", [])[:5]
    count = max(1, len(nodes))
    gap = 16
    width = min(232, int((WIDTH - 144 - gap * (count - 1)) / count))
    top = cursor + 66
    for index, node in enumerate(nodes):
        x = 72 + index * (width + gap)
        body.append(f'<rect x="{x}" y="{top}" width="{width}" height="150" rx="16" '
                    f'fill="{THEME["panel"]}" stroke="{THEME["accent2"]}" stroke-width="2"/>')
        body.append(paragraph(x + 18, top + 52, str(node.get("label", "")), size=24,
                              fill=THEME["ink"], limit=width - 36, weight="700", max_lines=2))
        body.append(paragraph(x + 18, top + 100, str(node.get("sub", "")), size=17,
                              fill=THEME["muted"], limit=width - 36, max_lines=3))
        if index < len(nodes) - 1:
            arrow = x + width + gap / 2
            body.append(f'<path d="M{arrow - 7} {top + 74} L{arrow + 7} {top + 74}" '
                        f'stroke="{THEME["accent"]}" stroke-width="3"/>')
            body.append(f'<polygon points="{arrow + 9},{top + 74} {arrow + 1},{top + 69} '
                        f'{arrow + 1},{top + 79}" fill="{THEME["accent"]}"/>')
    if slide.data.get("callout"):
        body.append(callout(slide.data["callout"]))
    return svg_document("".join(body))


def render_debug(slide: Slide) -> str:
    head, cursor = heading(slide, top=110)
    body = [chrome(slide), head]
    rows = (("症状", slide.data["symptom"], THEME["accent3"]),
            ("定位", slide.data["locate"], THEME["accent2"]),
            ("修改", slide.data["fix"], THEME["accent"]))
    top = cursor + 30
    for label, value, color in rows:
        body.append(f'<rect x="72" y="{top}" width="{WIDTH - 144}" height="118" rx="12" '
                    f'fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
        body.append(f'<rect x="72" y="{top}" width="5" height="118" rx="2" fill="{color}"/>')
        body.append(text_el(96, top + 34, label, size=20, fill=color, weight="700"))
        body.append(paragraph(150, top + 34, value, size=19, fill=THEME["ink"],
                              limit=WIDTH - 260, max_lines=3))
        top += 132
    return svg_document("".join(body))


def render_code(slide: Slide) -> str:
    head, cursor = heading(slide, top=110)
    body = [chrome(slide), head]
    body.append(shell_panel(72, cursor + 26, WIDTH - 144, 116, "打开这段代码",
                            [f'$ {slide.data["locate"]}'], size=17, accent=THEME["accent2"]))
    body.append(f'<rect x="72" y="{cursor + 158}" width="{WIDTH - 144}" height="150" rx="12" '
                f'fill="{THEME["panel"]}" stroke="{THEME["line"]}"/>')
    body.append(text_el(96, cursor + 192, "看这几处", size=19, fill=THEME["accent"], weight="700"))
    body.append(paragraph(96, cursor + 228, slide.data["look"], size=20, fill=THEME["ink"],
                          limit=WIDTH - 200, max_lines=3))
    return svg_document("".join(body))


def render_exercise(slide: Slide) -> str:
    head, cursor = heading(slide, top=110)
    body = [chrome(slide), head]
    body.append(f'<rect x="72" y="{cursor + 26}" width="{WIDTH - 144}" height="96" rx="12" '
                f'fill="{THEME["panel"]}" stroke="{THEME["accent3"]}"/>')
    body.append(text_el(96, cursor + 58, "改这里", size=19, fill=THEME["accent3"], weight="700"))
    body.append(paragraph(96, cursor + 90, slide.data["change"], size=19, fill=THEME["ink"],
                          limit=WIDTH - 200, max_lines=2))
    body.append(shell_panel(72, cursor + 138, WIDTH - 144, 92, "验证命令",
                            [f'$ {slide.data["verify"]}'], size=17, accent=THEME["accent"]))
    body.append(f'<rect x="72" y="{cursor + 246}" width="{WIDTH - 144}" height="122" rx="12" '
                f'fill="{THEME["panel"]}" stroke="{THEME["accent2"]}"/>')
    body.append(text_el(96, cursor + 278, "答案对不对，看这个", size=19, fill=THEME["accent2"], weight="700"))
    body.append(paragraph(96, cursor + 310, slide.data["answer"], size=19, fill=THEME["ink"],
                          limit=WIDTH - 200, max_lines=3))
    return svg_document("".join(body))


RENDERERS = {
    "task": render_task, "terminal": render_terminal, "text": render_text,
    "overview": render_overview, "diagram": render_diagram, "debug": render_debug,
    "code": render_code, "exercise": render_exercise,
}


def check_layout(document: str, label: str) -> None:
    """Fail loudly when a rendered slide would clip text or leave the canvas."""
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
    match = re.search(r"psnr_avg:([\d.]+|inf)", output)
    assert match, f"{label}: psnr probe produced no result"
    value = match.group(1)
    assert value != "inf" and float(value) < 40, f"{label}: frame looks blank (psnr={value})"


def probe_duration(path: Path) -> float:
    payload = json.loads(subprocess.check_output(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        text=True))
    return float(payload["format"]["duration"])


def rasterize(svg: Path, png: Path) -> None:
    png.parent.mkdir(parents=True, exist_ok=True)
    raster = svg.with_suffix(".raster.png")
    subprocess.run([SIPS, "-s", "format", "png", str(svg), "--out", str(raster)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    scale = (f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
             f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x08111f")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raster),
                    "-vf", scale, "-frames:v", "1", str(png)], check=True)
    raster.unlink(missing_ok=True)


def load_episode(deck_path: Path) -> tuple[dict[str, Any], list[Slide]]:
    deck = json.loads(deck_path.read_text(encoding="utf-8"))
    public = PUBLIC / deck["id"]
    slides: list[Slide] = []
    total = len(deck["slides"])
    for data in deck["slides"]:
        audio = public / data["audio"]
        if not audio.is_file():
            raise SystemExit(f"缺少旁白音频 {audio.name}；先跑 tools/build_audio.py")
        slides.append(Slide(data=data, episode=deck, number=data["slideIndex"], total=total,
                            audio=audio, duration=probe_duration(audio)))
    return deck, slides


def render_frames(deck: dict[str, Any], slides: list[Slide]) -> list[Path]:
    frame_dir = PUBLIC / deck["id"] / "frames"
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True)
    work = WORKSHOP / ".build-tmp" / deck["id"]
    work.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for slide in slides:
        svg = work / f"slide-{slide.number:02d}.svg"
        png = frame_dir / f"slide-{slide.number:02d}.png"
        document = RENDERERS[slide.data["type"]](slide)
        check_layout(document, f'{deck["id"]}/{slide.data["id"]}')
        svg.write_text(document, encoding="utf-8")
        rasterize(svg, png)
        check_ink(png, f'{deck["id"]}/{slide.data["id"]}')
        outputs.append(png)
    shutil.rmtree(work, ignore_errors=True)
    (frame_dir / ".blank.png").unlink(missing_ok=True)
    return outputs


def build_video(deck: dict[str, Any], slides: list[Slide], frames: list[Path]) -> Path:
    work = WORKSHOP / ".build-tmp" / f'{deck["id"]}-video'
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
    listing = work / "segments.txt"
    listing.write_text("".join(f"file '{segment.name}'\n" for segment in segments), encoding="utf-8")
    output = OUT / f'{deck["id"]}.mp4'
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
                    "-safe", "0", "-i", str(listing), "-c", "copy",
                    "-movflags", "+faststart", str(output)], check=True, cwd=work)
    shutil.rmtree(work, ignore_errors=True)
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


def notes_blocks(slide: Slide) -> list[str]:
    data = slide.data
    blocks = [
        f'第 {slide.episode["number"]} 集 · {slide.episode["module"]} · 第 {slide.number} / {slide.total} 页',
        data["title"],
        data["narration"],
    ]
    if data["type"] == "task":
        blocks += [f'本集任务：{data["task"]}', f'运行命令：{data["command"]}', f'你将看到：{data["expect"]}']
    elif data["type"] == "terminal":
        blocks += [f'运行命令：{data["command"]}', "真实输出：" + " / ".join(data["evidenceText"][:4])]
    elif data["type"] == "debug":
        blocks += [f'症状：{data["symptom"]}', f'定位：{data["locate"]}', f'修改：{data["fix"]}']
    elif data["type"] == "code":
        blocks += [f'打开：{data["locate"]}', f'看这几处：{data["look"]}']
    elif data["type"] == "exercise":
        blocks += [f'练习：{data["change"]}', f'验证命令：{data["verify"]}', f'可验证答案：{data["answer"]}']
    elif data.get("callout"):
        blocks.append(f'对照命令：{data["callout"]}')
    return blocks


def notes_xml(slide: Slide) -> str:
    paragraphs = "".join(
        f'<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/>'
        f'<a:t>{esc(block)}</a:t></a:r></a:p>' for block in notes_blocks(slide))
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


def build_pptx(deck: dict[str, Any], slides: list[Slide], frames: list[Path]) -> Path:
    skeleton = Path(__file__).resolve().parent / "pptx-skeleton"
    reuse = ["_rels/.rels", "ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml",
             "ppt/theme/theme1.xml", "ppt/slideMasters/slideMaster1.xml",
             "ppt/slideMasters/_rels/slideMaster1.xml.rels",
             "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
             "ppt/notesMasters/notesMaster1.xml", "ppt/notesMasters/_rels/notesMaster1.xml.rels"]
    output = OUT / f'{deck["id"]}.pptx'
    output.parent.mkdir(parents=True, exist_ok=True)
    title = f'{deck["title"]}'
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
        for index, (slide, frame) in enumerate(zip(slides, frames, strict=True), start=1):
            rel_id = f"rId{index + 1}"
            archive.writestr(f"ppt/slides/slide{index}.xml", slide_xml(slide))
            archive.writestr(f"ppt/notesSlides/notesSlide{index}.xml", notes_xml(slide))
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
        tail = count + 2
        presentation_rels += [
            f'<Relationship Id="rId{tail}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>',
            f'<Relationship Id="rId{tail + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>',
            f'<Relationship Id="rId{tail + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>',
            f'<Relationship Id="rId{tail + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
            f'<Relationship Id="rId{tail + 4}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>',
        ]
        archive.writestr("ppt/_rels/presentation.xml.rels",
                         f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         f'<Relationships {REL_NS}>{"".join(presentation_rels)}</Relationships>')
        archive.writestr("ppt/presentation.xml",
                         f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         f'<p:presentation {PPT_NS} saveSubsetFonts="1" autoCompressPictures="0">'
                         f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
                         f'<p:sldIdLst>{"".join(slide_ids)}</p:sldIdLst>'
                         f'<p:notesMasterIdLst><p:notesMasterId r:id="rId{tail}"/></p:notesMasterIdLst>'
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
                         f'<dc:title>{esc(title)}</dc:title><dc:subject>{esc(deck["task"])}</dc:subject>'
                         '<dc:creator>DSH Workshop</dc:creator><cp:revision>1</cp:revision></cp:coreProperties>')
        archive.writestr("docProps/app.xml",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                         '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                         'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
                         f'<Application>DSH Workshop episode builder</Application><Slides>{count}</Slides>'
                         f'<TitlesOfParts><vt:vector size="{count}" baseType="lpstr">{titles}'
                         '</vt:vector></TitlesOfParts></Properties>')
    return output


def clean_superseded() -> list[str]:
    """The output directory may only hold the twelve episodes."""
    removed = []
    keep = {f"E{index:02d}" for index in range(1, 13)}
    if OUT.exists():
        for path in sorted(OUT.iterdir()):
            if path.is_dir():
                shutil.rmtree(path)
                removed.append(path.name)
            elif path.stem not in keep or path.suffix not in {".mp4", ".pptx"}:
                path.unlink()
                removed.append(path.name)
    for path in sorted(PUBLIC.iterdir()) if PUBLIC.exists() else []:
        if path.is_dir() and path.name not in keep:
            shutil.rmtree(path)
            removed.append(f"03-public/{path.name}")
    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="只构建一集，例如 E01")
    args = parser.parse_args()

    decks = sorted(DECKS.glob("E[0-9][0-9]/presentation.json"))
    if len(decks) != 12:
        raise SystemExit(f"需要 12 集 deck，找到 {len(decks)}")
    if not args.only:
        for removed in clean_superseded():
            print(f"REMOVED {removed}")
    OUT.mkdir(parents=True, exist_ok=True)
    total_runtime = 0.0
    built = 0
    for deck_path in decks:
        deck, slides = load_episode(deck_path)
        if args.only and deck["id"] != args.only:
            continue
        frames = render_frames(deck, slides)
        video = build_video(deck, slides, frames)
        pptx = build_pptx(deck, slides, frames)
        runtime = sum(slide.frames for slide in slides) / FPS
        total_runtime += runtime
        built += 1
        print(f"EPISODE_BUILT {deck['id']} slides={len(slides)} runtime={runtime:.1f}s "
              f"video={video.name} pptx={pptx.name}")
    shutil.rmtree(WORKSHOP / ".build-tmp", ignore_errors=True)
    print(f"COURSE_OK episodes={built} runtime={total_runtime / 60:.1f}min")


if __name__ == "__main__":
    main()
