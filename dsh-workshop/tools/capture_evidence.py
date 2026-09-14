"""Run each episode's real commands and store redacted logs as course evidence.

The terminal slides render these files verbatim, so this is the only place where the course
touches the two example projects. Two rules make the output safe to publish:

* every command runs for real — no transcript is written by hand;
* the log is redacted before it is written, not before it is shown: credentials, endpoints,
  request headers and absolute paths never reach the file at all.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from course_content import EPISODES  # noqa: E402

WORKSHOP = Path(__file__).resolve().parents[1]
ROOT = WORKSHOP.parent
OUT = WORKSHOP / "05-evidence" / "commands"
VENV = ROOT / "iota-example" / ".venv" / "bin" / "python"

SECRETS = (
    ("ANTHROPIC_AUTH_TOKEN", "<redacted-key>"),
    ("LLM_API_KEY", "<redacted-key>"),
)


def redact(text: str) -> str:
    out = text.replace(str(ROOT), "<repo>")
    for name, mask in SECRETS:
        value = os.environ.get(name, "")
        if len(value) > 6:
            out = out.replace(value, mask)
    out = re.sub(r"sk-[A-Za-z0-9._-]{8,}", "<redacted-key>", out)
    out = re.sub(r"eyJ[A-Za-z0-9._-]{16,}", "<redacted-key>", out)
    out = re.sub(r"https?://[^\s\"'()]+", "<endpoint>", out)
    out = re.sub(r"x-api-key[^\n]*", "x-api-key: <redacted-header>", out, flags=re.I)
    out = re.sub(r"/(?:Users|home)/[^\s\"'()]+", "<path>", out)
    out = re.sub(r"/private/var/folders/[^\s\"'()]+", "<temp>", out)
    return "\n".join(line.rstrip() for line in out.splitlines())


def run(command: str, target: Path, *, timeout: int = 900) -> int:
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["PATH"] = f"/opt/homebrew/bin:{env.get('PATH', '')}"
    completed = subprocess.run(
        ["/bin/bash", "-c", f"set -uo pipefail\n{command}"],
        cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=timeout, check=False,
    )
    target.write_text(
        f"$ {command}\n\n{redact(completed.stdout)}\n[exit {completed.returncode}]\n",
        encoding="utf-8",
    )
    return completed.returncode


def iota_command(module: str) -> str:
    return (
        "cd iota-example && env -u PYTHONHOME -u PYTHONPATH "
        f".venv/bin/python -m runtime.runner {module} --real"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="只跑一集，例如 E01")
    parser.add_argument("--skip-iota", action="store_true", help="只采集 DSH 侧证据")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    if not VENV.is_file():
        raise SystemExit(f"缺少 iota-example 虚拟环境：{VENV.name}")

    failures: list[str] = []
    for spec in EPISODES:
        if args.only and spec["id"] != args.only:
            continue
        dsh_log = OUT / spec["evidence"]
        code = run(spec["command"], dsh_log)
        print(f"EVIDENCE_{'OK' if code == 0 else 'FAIL'} {spec['id']} dsh exit={code} -> {dsh_log.name}")
        if code != 0:
            failures.append(f"{spec['id']} dsh")
        if args.skip_iota:
            continue
        iota_log = OUT / f"{spec['id']}-iota-real.txt"
        code = run(iota_command(spec["module"]), iota_log)
        print(f"EVIDENCE_{'OK' if code == 0 else 'FAIL'} {spec['id']} iota exit={code} -> {iota_log.name}")
        if code != 0:
            failures.append(f"{spec['id']} iota")

    if failures:
        print("EVIDENCE_INCOMPLETE " + ", ".join(failures), file=sys.stderr)
        return 1
    print(f"EVIDENCE_ALL_OK episodes={len(EPISODES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
