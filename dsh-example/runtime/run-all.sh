#!/usr/bin/env bash
# 依次运行全部模块（真实推理服务）。
# 模块清单与阶段总数都从各模块 run.ts 推导，不在这里另抄一份；临时日志退出时自动清理。
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${DSH_NODE:-node}"
"$NODE_BIN" -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22 || (maj===22 && min<18)) { console.error(`需要 Node >= 22.18，当前 ${process.version}`); process.exit(1) }'

# 模块目录就是清单；阶段总数来自各 run.ts 的阶段编号。
modules=(M[0-9][0-9]-*)
expected_stages=$(grep -h "id: 'M" "${modules[@]/%//run.ts}" | wc -l | tr -d ' ')

log_dir=$(mktemp -d runtime/.real-logs.XXXXXX)
trap 'rm -rf -- "$log_dir"' EXIT

for module in "${modules[@]}"; do
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  ▶ 运行模块 ${module}"
  echo "══════════════════════════════════════════════════════════════"
  "$NODE_BIN" "$module/run.ts" 2>&1 | tee "$log_dir/$module.txt"
done

stages=$(grep -h '^REAL_STAGE_OK ' "$log_dir"/*.txt | wc -l)
modules_ok=$(grep -h '^REAL_MODULE_OK ' "$log_dir"/*.txt | wc -l)
if [[ "$stages" -ne "$expected_stages" ]]; then
  echo "✗ REAL_STAGE_OK 只有 $stages 条，阶段清单共 $expected_stages 条" >&2
  exit 1
fi
if [[ "$modules_ok" -ne "${#modules[@]}" ]]; then
  echo "✗ REAL_MODULE_OK 只有 $modules_ok 条，应为 ${#modules[@]} 条" >&2
  exit 1
fi
echo ""
echo "REAL_ALL_OK modules=${#modules[@]} stages=$stages provider=anthropic-compat"
