"""Extract one auditable frame per chapter from the lecture and OCR it.

OCR matters here: it is the only check that proves the rendered slide text is
actually readable on screen, not merely present in the source data.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSHOP = ROOT / "dsh-workshop"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
COURSE = "harness-course"
# One page per chapter, chosen to audit the narrative arc rather than a
# convenient frame: the opening premise, the page that explains why the two
# systems differ, and the closing takeaway.
SAMPLES = ("dsh-opening", "iota-boundary", "choice-closing")

OCR_SCRIPT = """ObjC.import('Vision'); ObjC.import('Foundation');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0;
  req.usesLanguageCorrection = false;
  req.recognitionLanguages = ['zh-Hans', 'en-US'];
  handler.performRequestsError($.NSArray.arrayWithObject(req), $());
  const results = req.results;
  const out = [];
  for (let i = 0; i < results.count; i++) {
    out.push(ObjC.unwrap(results.objectAtIndex(i).topCandidates(1).objectAtIndex(0).string));
  }
  return out.join('\\n');
}
"""


def ocr(image: Path) -> str:
    script = WORKSHOP / ".ocr.js"
    script.write_text(OCR_SCRIPT, encoding="utf-8")
    try:
        return subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", str(script), str(image)],
                              text=True, capture_output=True, check=True).stdout.strip()
    finally:
        script.unlink(missing_ok=True)


def main() -> None:
    deck_dir = WORKSHOP / "02-decks" / COURSE
    deck = json.loads((deck_dir / "presentation.json").read_text(encoding="utf-8"))
    manifest = json.loads((deck_dir / "audio-manifest.json").read_text(encoding="utf-8"))
    frame_dir = WORKSHOP / "05-evidence" / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    for stale in frame_dir.glob("*.png"):
        stale.unlink()
    fps, tail = int(deck["fps"]), int(deck["tailFrames"])

    start_frame = 0
    starts: dict[str, int] = {}
    for slide in deck["slides"]:
        starts[slide["id"]] = start_frame
        audio_duration = float(manifest[slide["audio"]]["durationSec"])
        start_frame += max(1, math.ceil(max(
            float(slide["minDurationSec"]) * fps, audio_duration * fps + tail)))

    records = []
    ocr_blocks = []
    for sample_id in SAMPLES:
        slide = next(item for item in deck["slides"] if item["id"] == sample_id)
        sample_sec = starts[sample_id] / fps + 5.0
        frame = frame_dir / f"{COURSE}-{sample_id}.png"
        subprocess.run([FFMPEG, "-v", "error", "-ss", f"{sample_sec:.3f}",
                        "-i", str(WORKSHOP / "04-out" / f"{COURSE}.mp4"),
                        "-frames:v", "1", "-y", str(frame)], check=True)
        info = json.loads(subprocess.check_output(
            [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height", "-of", "json", str(frame)], text=True))["streams"][0]
        assert (int(info["width"]), int(info["height"])) == (deck["width"], deck["height"])
        assert frame.stat().st_size > 50_000
        text = ocr(frame)
        # The title and the page counter must survive rasterisation to be teachable.
        assert slide["title"][:6] in text.replace(" ", ""), (sample_id, text[:200])
        assert f"{slide['courseIndex']:02d}" in text.replace(" ", ""), (sample_id, text[:200])
        records.append({
            "course": COURSE,
            "slideIndex": slide["courseIndex"],
            "slideId": sample_id,
            "chapter": slide["chapterTitle"],
            "title": slide["title"],
            "sampleSec": sample_sec,
            "audio": slide["audio"],
            "audioDurationSec": manifest[slide["audio"]]["durationSec"],
            "narrationSha256": hashlib.sha256(slide["narration"].encode()).hexdigest(),
            "frame": str(frame.relative_to(WORKSHOP)),
            "frameBytes": frame.stat().st_size,
            "frameDimensions": f"{deck['width']}x{deck['height']}",
            "ocrLines": len([line for line in text.splitlines() if line.strip()]),
        })
        ocr_blocks.append(f"FRAME {frame.name}\n{text}")
        print(f"SAMPLE_OK {sample_id} slide={slide['courseIndex']} at={sample_sec:.2f}s "
              f"frame={frame.stat().st_size}B ocr_lines={records[-1]['ocrLines']}")

    (WORKSHOP / "05-evidence" / "frame-samples.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (WORKSHOP / "05-evidence" / "frame-ocr.txt").write_text(
        "\n".join(ocr_blocks) + "\n", encoding="utf-8")
    print(f"SAMPLE_TOTAL_OK frames={len(records)} ocr=verified")


if __name__ == "__main__":
    main()
