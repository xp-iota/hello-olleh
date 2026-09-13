"""Load the project-local .env exactly once.

The file holds the real MiniMax credentials (``ANTHROPIC_AUTH_TOKEN`` and friends) and is
ignored by git. Values already present in the process environment win, so a one-off
``ANTHROPIC_AUTH_TOKEN=... python -m runtime.run_all --real`` still overrides the file.
A missing file is not an error: the offline path never needs it.
"""

from __future__ import annotations

import os
from pathlib import Path

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
_loaded = False


def load_project_env(path: Path | None = None) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines into ``os.environ`` without overwriting existing keys."""
    global _loaded
    target = path or _ENV_FILE
    if _loaded and path is None:
        return {}
    if path is None:
        _loaded = True
    applied: dict[str, str] = {}
    if not target.is_file():
        return applied
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        applied[key] = value
    return applied
