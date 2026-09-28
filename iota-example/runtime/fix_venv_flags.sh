#!/usr/bin/env bash
# macOS：清掉 .venv 里的 UF_HIDDEN 标志，修回 editable 安装的 iota-core。
#
# 症状：`ModuleNotFoundError: No module named 'iota_core'`，但 `uv pip list` 明明有
#       iota-core，且 `.venv/.../__editable__.iota_core-*.pth` 存在、内容也对。
#
# 原因：CPython 3.12 的 site.addpackage() 会**跳过带隐藏标志的 .pth 文件**
#       （见 site.py：`st_flags & stat.UF_HIDDEN` → Skipping hidden .pth file）。
#       ustar/解压/某些同步工具在 macOS 上会给文件打上隐藏位；一旦 .pth 被跳过，
#       只有 editable 安装（靠 .pth 生效）的包会静默消失，普通包不受影响。
#
# 修复：对 .venv 递归清除隐藏标志。幂等，可重复执行。
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "非 macOS，跳过（UF_HIDDEN 是 macOS 特有标志）"
  exit 0
fi

if [[ ! -d .venv ]]; then
  echo "没有 .venv，请先运行：uv sync --extra dev --extra real"
  exit 1
fi

chflags -R nohidden .venv

# 自检：导入不通过就说明问题不在隐藏标志上，别让调用方以为已经修好了。
if uv run python -c "import iota_core" 2>/dev/null; then
  echo "IOTA_VENV_OK editable=iota_core hidden_flags=cleared"
else
  echo "✗ 清除隐藏标志后 iota_core 仍不可导入；请检查 uv sync 与 [tool.uv.sources] 路径" >&2
  exit 1
fi
