"""Build local workshop images from captured command evidence."""
from __future__ import annotations

import html
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSHOP = ROOT / "dsh-workshop"
EVIDENCE = WORKSHOP / "05-evidence" / "terminal"
FFMPEG = Path("/opt/homebrew/bin/ffmpeg")


def text(value: str) -> str:
    return html.escape(value, quote=True)


def terminal_svg(title: str, subtitle: str, lines: list[str], *, height: int = 720, font_size: int = 24) -> str:
    start = 152
    gap = int(font_size * 1.55)
    rendered = []
    for index, line in enumerate(lines):
        color = "#2dd4bf" if ("OK" in line or "exit 0" in line) else "#dbeafe"
        if line.startswith("$"):
            color = "#fbbf24"
        rendered.append(
            f'<text x="54" y="{start + index * gap}" fill="{color}" '
            f'font-family="Menlo, PingFang SC, monospace" font-size="{font_size}">{text(line)}</text>'
        )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="{height}" viewBox="0 0 1280 {height}">
<rect width="1280" height="{height}" fill="#08111f"/>
<rect x="28" y="28" width="1224" height="{height-56}" rx="18" fill="#0d1b2d" stroke="#26415f" stroke-width="2"/>
<circle cx="58" cy="58" r="7" fill="#fb7185"/><circle cx="82" cy="58" r="7" fill="#fbbf24"/><circle cx="106" cy="58" r="7" fill="#2dd4bf"/>
<text x="54" y="104" fill="#f8fafc" font-family="PingFang SC, sans-serif" font-size="31" font-weight="700">{text(title)}</text>
<text x="1226" y="103" fill="#8da2b8" text-anchor="end" font-family="PingFang SC, sans-serif" font-size="18">{text(subtitle)}</text>
{''.join(rendered)}
</svg>'''


def write_svg(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def png(svg: Path, output: Path, width: int = 1280, height: int = 720) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dsh-workshop-svg-") as directory:
        raster = Path(directory) / "raster.png"
        subprocess.run(
            ["/usr/bin/sips", "-s", "format", "png", str(svg), "--out", str(raster)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-i", str(raster),
             "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x08111f",
             "-frames:v", "1", str(output)], check=True
        )


def build_dsh() -> None:
    image_dir = WORKSHOP / "03-public" / "01-dsh-capabilities" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    topology_source = ROOT / "docs" / "hello-dsh" / "diagrams" / "12-example-topology.svg"
    topology_copy = image_dir / "dsh-topology-source.svg"
    shutil.copyfile(topology_source, topology_copy)
    topology_png = image_dir / "dsh-topology-only.png"
    png(topology_copy, topology_png, 1280, 468)

    lines = EVIDENCE.joinpath("01-dsh-run-all.txt").read_text(encoding="utf-8").splitlines()
    lines = [line.replace("▶ 运行模块 ", "RUN ") for line in lines]
    panel_svg = image_dir / "dsh-terminal-panel.svg"
    write_svg(panel_svg, terminal_svg("DSH 离线全入口", "真实命令输出", lines, height=252, font_size=14))
    panel_png = image_dir / "dsh-terminal-panel.png"
    png(panel_svg, panel_png, 1280, 252)
    subprocess.run(
        [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(topology_png), "-i", str(panel_png),
         "-filter_complex", "[0:v][1:v]vstack=inputs=2[v]", "-map", "[v]",
         "-frames:v", "1", str(image_dir / "dsh-topology.png")], check=True
    )


def build_iota() -> None:
    image_dir = WORKSHOP / "03-public" / "02-iota-alignment" / "images"
    lines = EVIDENCE.joinpath("02-iota-run-all.txt").read_text(encoding="utf-8").splitlines()
    svg = image_dir / "iota-terminal.svg"
    write_svg(svg, terminal_svg("iota-example 离线门禁", "12 modules · network blocked", lines, font_size=24))
    png(svg, image_dir / "iota-terminal.png")


def build_choice() -> None:
    image_dir = WORKSHOP / "03-public" / "03-boundaries-selection" / "images"
    raw = EVIDENCE.joinpath("03-choice-modules.txt").read_text(encoding="utf-8").splitlines()
    records = [json.loads(line) for line in raw if line.startswith("{")]
    by_module = {record["module"]: record for record in records}
    lines = [
        "$ python -m runtime.runner M03",
        f"M03  replaceable_unit = {by_module['M03']['replaceable_unit']}",
        "M03  ACP + llm_execution = compile-time refusal",
        "IOTA_MODULE_OK M03-inference-service-access",
        "",
        "$ python -m runtime.runner M07",
        f"M07  route = {by_module['M07']['route']}",
        f"M07  orchestrator_shell_registry = {by_module['M07']['orchestrator_shell_registry']}",
        "IOTA_MODULE_OK M07-execution-backends",
        "",
        "$ python -m runtime.runner M12",
        f"M12  lifo = {by_module['M12']['lifo']}",
        f"M12  architecture_not_imported = {by_module['M12']['architecture_not_imported']}",
        "IOTA_MODULE_OK M12-framework-mechanisms",
        "[exit 0]",
    ]
    svg = image_dir / "choice-terminal.svg"
    write_svg(svg, terminal_svg("三堂结构差异课", "M03 · M07 · M12", lines, font_size=23))
    png(svg, image_dir / "choice-terminal.png")

    matrix = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<rect width="1280" height="720" fill="#08111f"/>
<text x="640" y="66" text-anchor="middle" fill="#f8fafc" font-family="PingFang SC" font-size="34" font-weight="700">需求动词决定主框架</text>
<text x="640" y="102" text-anchor="middle" fill="#8da2b8" font-family="PingFang SC" font-size="20">先确认所有权，再选择 seam</text>
<line x1="160" y1="584" x2="1135" y2="584" stroke="#8da2b8" stroke-width="2"/><polygon points="1135,584 1118,575 1118,593" fill="#8da2b8"/>
<line x1="160" y1="584" x2="160" y2="142" stroke="#8da2b8" stroke-width="2"/><polygon points="160,142 151,159 169,159" fill="#8da2b8"/>
<text x="1140" y="620" text-anchor="end" fill="#8da2b8" font-family="PingFang SC" font-size="19">多节点编排 / checkpoint / 恢复 →</text>
<text x="34" y="175" fill="#8da2b8" font-family="PingFang SC" font-size="19" transform="rotate(-90 34 175)">模型 / 工具 / 执行深度控制 →</text>
<rect x="190" y="346" width="420" height="205" rx="22" fill="#12304a" stroke="#60a5fa" stroke-width="3"/>
<text x="400" y="394" text-anchor="middle" fill="#60a5fa" font-family="PingFang SC" font-size="29" font-weight="700">ORCHESTRATOR</text>
<text x="400" y="438" text-anchor="middle" fill="#dbeafe" font-family="PingFang SC" font-size="21">编排节点 · 分配 worker</text>
<text x="400" y="473" text-anchor="middle" fill="#dbeafe" font-family="PingFang SC" font-size="21">保存 checkpoint · 恢复 run</text>
<text x="400" y="516" text-anchor="middle" fill="#8da2b8" font-family="PingFang SC" font-size="18">iota Graph / Queue / Store</text>
<rect x="640" y="158" width="420" height="205" rx="22" fill="#153a3c" stroke="#2dd4bf" stroke-width="3"/>
<text x="850" y="206" text-anchor="middle" fill="#2dd4bf" font-family="PingFang SC" font-size="29" font-weight="700">HARNESS</text>
<text x="850" y="250" text-anchor="middle" fill="#d5fbf5" font-family="PingFang SC" font-size="21">替换模型 · 改写工具流</text>
<text x="850" y="285" text-anchor="middle" fill="#d5fbf5" font-family="PingFang SC" font-size="21">控制 prompt · shell · sandbox</text>
<text x="850" y="328" text-anchor="middle" fill="#8da2b8" font-family="PingFang SC" font-size="18">DSH Context / Service / Fiber</text>
<rect x="700" y="410" width="390" height="132" rx="22" fill="#3a2d14" stroke="#fbbf24" stroke-width="3"/>
<text x="895" y="458" text-anchor="middle" fill="#fbbf24" font-family="PingFang SC" font-size="28" font-weight="700">COMPOSE</text>
<text x="895" y="496" text-anchor="middle" fill="#fef3c7" font-family="PingFang SC" font-size="20">外层编排，内层 harness</text>
<text x="895" y="526" text-anchor="middle" fill="#d6b965" font-family="PingFang SC" font-size="17">协议交换输入、事件与结果</text>
</svg>'''
    matrix_svg = image_dir / "selection-matrix.svg"
    write_svg(matrix_svg, matrix)
    png(matrix_svg, image_dir / "selection-matrix.png")


def main() -> None:
    build_dsh()
    build_iota()
    build_choice()
    print("IMAGES_OK topology=1 terminals=3 matrix=1")


if __name__ == "__main__":
    main()
