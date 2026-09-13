"""Render one narration MP3 per slide with edge-tts, then write the per-episode manifest.

Privacy boundary: only ``narration`` is ever sent to the speech service. Commands, paths,
source code, endpoints and credentials stay local — the narration text is already written to be
publishable, and this tool refuses to send anything that looks otherwise.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

WORKSHOP = Path(__file__).resolve().parents[1]
DECKS = WORKSHOP / "02-decks"
PUBLIC = WORKSHOP / "03-public"
PROFILE = DECKS / "tts-profile.edge-tts.json"
FFPROBE = "/opt/homebrew/bin/ffprobe"
EDGE_TTS = WORKSHOP / ".venv" / "bin" / "edge-tts"

FORBIDDEN = (
    (r"https?://", "URL"),
    (r"/(?:Users|home)/", "本机路径"),
    (r"sk-[A-Za-z0-9]{8,}", "疑似密钥"),
    (r"x-api-key", "请求头"),
    (r"nexus|gitlab", "内部服务名"),
)


def check_publishable(text: str, slide_id: str) -> None:
    for pattern, label in FORBIDDEN:
        if re.search(pattern, text, re.I):
            raise SystemExit(f"{slide_id}: 旁白包含{label}，不能发送给语音服务")


def probe_duration(path: Path) -> float:
    payload = json.loads(subprocess.check_output(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        text=True))
    return float(payload["format"]["duration"])


def synthesize(text: str, target: Path, profile: dict[str, str]) -> float:
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        # 负值必须写成 --rate=-5% 的形式，否则会被当成另一个选项。
        [str(EDGE_TTS), "--voice", profile["voice"], f"--rate={profile['rate']}",
         f"--pitch={profile['pitchAdjustment']}", f"--volume={profile['volumeAdjustment']}",
         "--text", text, "--write-media", str(target)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    return probe_duration(target)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="只渲染一集，例如 E01")
    parser.add_argument("--force", action="store_true", help="已存在的音频也重新渲染")
    args = parser.parse_args()

    if not EDGE_TTS.is_file():
        raise SystemExit("缺少 edge-tts（见 requirements-tts.txt）")
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))

    decks = sorted(DECKS.glob("E[0-9][0-9]/presentation.json"))
    if not decks:
        raise SystemExit("没有找到 episode deck；先跑 tools/build_content.py")
    total = 0
    for deck_path in decks:
        deck = json.loads(deck_path.read_text(encoding="utf-8"))
        if args.only and deck["id"] != args.only:
            continue
        audio_dir = PUBLIC / deck["id"]
        manifest: dict[str, dict[str, object]] = {}
        spoken = 0.0
        for slide in deck["slides"]:
            check_publishable(slide["narration"], slide["id"])
            target = audio_dir / slide["audio"]
            if args.force or not target.is_file():
                duration = synthesize(slide["narration"], target, profile)
            else:
                duration = probe_duration(target)
            manifest[slide["audio"]] = {
                "path": slide["audio"],
                "durationSec": round(duration, 3),
                "chars": len(slide["narration"]),
            }
            spoken += duration
            total += 1
        (deck_path.parent / "audio-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"AUDIO_OK {deck['id']} slides={len(manifest)} spoken={spoken:.1f}s")
    print(f"AUDIO_ALL_OK clips={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
