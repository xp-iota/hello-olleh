"""Extract one auditable frame from each lecture and cross-check its narration."""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSHOP = ROOT / "dsh-workshop"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
# One page per lecture, chosen to check the narrative arc rather than a
# convenient frame: the opening premise, the page that explains why the two
# systems differ, and the closing takeaway.
SAMPLES = {
    "01-dsh-capabilities": "dsh-opening",
    "02-iota-alignment": "iota-boundary",
    "03-boundaries-selection": "choice-closing",
}


def script_narrations(path: Path) -> list[str]:
    return re.findall(
        r"\*\*旁白\*\*\n\n(.*?)\n\n\*\*复现命令\*\*",
        path.read_text(encoding="utf-8"),
        re.S,
    )


def main() -> None:
    frame_dir = WORKSHOP / "05-evidence" / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for deck_name, sample_id in SAMPLES.items():
        base = WORKSHOP / "02-decks" / deck_name
        deck = json.loads((base / "presentation.json").read_text(encoding="utf-8"))
        manifest = json.loads((base / "audio-manifest.json").read_text(encoding="utf-8"))
        narrations = script_narrations(WORKSHOP / "01-scripts" / f"{deck_name}.md")
        start_frame = 0
        sample = None
        for index, slide in enumerate(deck["slides"]):
            audio_duration = float(manifest[slide["audio"]]["durationSec"])
            duration_frames = max(
                1,
                math.ceil(
                    max(
                        float(slide["minDurationSec"]) * int(deck["fps"]),
                        audio_duration * int(deck["fps"]) + int(deck["tailFrames"]),
                    )
                ),
            )
            if slide["id"] == sample_id:
                sample = (index, slide, start_frame, duration_frames)
                break
            start_frame += duration_frames
        assert sample is not None
        index, slide, start_frame, duration_frames = sample
        assert narrations[index] == slide["narration"]
        audio_key = slide["audio"]
        assert manifest[audio_key]["path"] == audio_key
        audio = WORKSHOP / "03-public" / deck_name / audio_key
        assert audio.is_file()
        sample_sec = start_frame / int(deck["fps"]) + 5.0
        frame = frame_dir / f"{deck_name}-{sample_id}.png"
        subprocess.run(
            [FFMPEG, "-v", "error", "-ss", f"{sample_sec:.3f}", "-i", str(WORKSHOP / "04-out" / f"{deck_name}.mp4"), "-frames:v", "1", "-y", str(frame)],
            check=True,
        )
        info = json.loads(
            subprocess.check_output(
                [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(frame)],
                text=True,
            )
        )["streams"][0]
        assert (int(info["width"]), int(info["height"])) == (1280, 720)
        assert frame.stat().st_size > 50_000
        records.append(
            {
                "deck": deck_name,
                "slideIndex": index + 1,
                "slideId": sample_id,
                "title": slide["title"],
                "sampleSec": sample_sec,
                "durationSec": duration_frames / int(deck["fps"]),
                "audio": audio_key,
                "audioDurationSec": manifest[audio_key]["durationSec"],
                "narrationSha256": hashlib.sha256(slide["narration"].encode()).hexdigest(),
                "scriptNarrationMatch": True,
                "manifestAudioMatch": True,
                "frame": str(frame.relative_to(WORKSHOP)),
                "frameBytes": frame.stat().st_size,
                "frameDimensions": "1280x720",
            }
        )
        print(
            f"SAMPLE_OK {deck_name} slide={index + 1}:{sample_id} at={sample_sec:.2f}s "
            f"audio={audio_key} frame={frame.stat().st_size}B"
        )
    output = WORKSHOP / "05-evidence" / "frame-samples.json"
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("SAMPLE_TOTAL_OK frames=3 script=match manifest=match")


if __name__ == "__main__":
    main()
