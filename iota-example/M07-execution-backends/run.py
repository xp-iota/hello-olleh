"""Run this teaching module independently."""

import importlib
import logging
import sys
from pathlib import Path

logging.disable(logging.CRITICAL)
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
runner = importlib.import_module("runtime.runner")


if __name__ == "__main__":
    runner.run_module_file(Path(__file__).with_name("index.py"))
