#!/usr/bin/env bash
# 依次运行全部 12 个模块：默认真实；传 --mock 则离线。
# 真实模式会核验 61 条阶段证据，临时日志在退出时自动清理。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE_ARGS=("$@")
NODE_BIN="${DSH_NODE:-node}"
"$NODE_BIN" -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22 || (maj===22 && min<18)) { console.error(`需要 Node >= 22.18，当前 ${process.version}`); process.exit(1) }'

real=true
for arg in "${MODE_ARGS[@]}"; do
  if [[ "$arg" == "--mock" ]]; then real=false; fi
done

modules=(
  M01-tool-pipeline
  M02-context-assembly-economics
  M03-inference-service-access
  M04-agent-loop-intervention
  M05-session-surface
  M06-human-in-the-loop
  M07-execution-backends
  M08-delegation-presets
  M09-long-running-orchestration
  M10-external-capabilities
  M11-config-data-infrastructure
  M12-framework-mechanisms
)

log_dir=""
if $real; then
  log_dir=$(mktemp -d runtime/.real-logs.XXXXXX)
  trap 'rm -rf -- "$log_dir"' EXIT
fi

for module in "${modules[@]}"; do
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  if $real; then
    echo "  ▶ 真实模式运行模块 ${module}"
    echo "══════════════════════════════════════════════════════════════"
    "$NODE_BIN" "$module/run.ts" "${MODE_ARGS[@]}" 2>&1 | tee "$log_dir/$module.txt"
  else
    echo "  ▶ 离线模式运行模块 ${module}"
    echo "══════════════════════════════════════════════════════════════"
    "$NODE_BIN" "$module/run.ts" "${MODE_ARGS[@]}"
  fi
done

if $real; then
  stages=$(grep -h '^REAL_STAGE_OK ' "$log_dir"/*.txt | wc -l)
  modules_ok=$(grep -h '^REAL_MODULE_OK ' "$log_dir"/*.txt | wc -l)
  if [[ "$stages" -ne 61 ]]; then
    echo "✗ REAL_STAGE_OK 只有 $stages 条，应为 61 条" >&2
    exit 1
  fi
  if [[ "$modules_ok" -ne "${#modules[@]}" ]]; then
    echo "✗ REAL_MODULE_OK 只有 $modules_ok 条，应为 ${#modules[@]} 条" >&2
    exit 1
  fi
  echo ""
  echo "REAL_ALL_OK modules=${#modules[@]} stages=$stages provider=anthropic-compat"
else
  echo ""
  echo "MOCK_ALL_OK modules=${#modules[@]}"
fi
