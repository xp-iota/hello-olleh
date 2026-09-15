"""统计示例真正用到的 iota-core 能力面（对位 `dsh-example` 的 `npm run coverage:surfaces`）。

口径很直白：把 `impl/`、`scenes/` 与 `runtime/` 里对 `iota_core` / `iota_memory_protocol` 的
每一个具名导入算作一个"面"。这样这份数字不会靠人手维护 —— 加一个阶段用到新协议，数字自己变；
删掉阶段，数字也跟着掉，低于门槛就失败。
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: 覆盖面门槛。低于它说明示例覆盖缩水了，应当当作回归看待。
REQUIRED = 45

IMPORT = re.compile(
    r"^from (?P<module>(?:iota_core|iota_memory_protocol)[\w.]*) import (?P<names>[^\n]+)$",
    re.MULTILINE,
)


def sources() -> list[Path]:
    files = sorted(ROOT.glob("M[0-9][0-9]-*/impl/*.py"))
    files += sorted(ROOT.glob("M[0-9][0-9]-*/scenes/*.py"))
    files += sorted(ROOT.glob("runtime/*.py"))
    return [path for path in files if path.name != "__init__.py"]


def collect() -> dict[str, set[str]]:
    surfaces: dict[str, set[str]] = defaultdict(set)
    for path in sources():
        text = path.read_text(encoding="utf-8")
        for match in IMPORT.finditer(text):
            names = match["names"].replace("(", "").replace(")", "")
            for raw in names.split(","):
                name = raw.strip().split(" as ")[0].strip()
                if name and name != "\\":
                    surfaces[match["module"]].add(name)
    return surfaces


def main() -> int:
    surfaces = collect()
    covered = sum(len(names) for names in surfaces.values())
    report = {
        "modules": len(surfaces),
        "covered": covered,
        "required": REQUIRED,
    }
    print(json.dumps(report, sort_keys=True))
    if covered < REQUIRED:
        print(f"✗ 覆盖面 {covered} 低于门槛 {REQUIRED}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
