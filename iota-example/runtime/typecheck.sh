#!/usr/bin/env bash
# 全工程类型检查：共享层一次，12 个模块各一次。
#
# 模块目录名带连字符（与 dsh-example 同名），不是合法 Python 包名，所以模块内部统一用顶层
# `impl.*` / `scenes.*` 导入。这里把每个模块目录设为 MYPYPATH 的第一项，让 mypy 看到的
# 导入形状与 runtime/runner.py 运行时的完全一致。
set -euo pipefail
cd "$(dirname "$0")/.."

# 统一走 uv：解释器与依赖都由 uv 按 uv.lock 解析，不直接引用 .venv 里的可执行文件。
UV=${UV:-uv}
"$UV" run mypy

for module in M[0-9][0-9]-*; do
  echo "== $module"
  MYPYPATH="$module:." "$UV" run mypy "$module"
done

echo "IOTA_TYPECHECK_OK modules=12"
