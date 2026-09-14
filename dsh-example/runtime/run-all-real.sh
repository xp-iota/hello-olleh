#!/usr/bin/env bash
# 真实推理服务全量验收：12 个模块、61 个阶段（58 个逐阶段 + 3 个专项演示），
# 每个阶段都必须留下真实调用证据。从 dsh-example 根目录调用：npm run real:all
#
# 与 `npm run all:mock`（离线）的区别只是没有 --mock：本脚本不设任何开关，
# 走 run.ts 的默认（真实）模式。任何 provider 缺失、模型未被调用或意外回退
# 都会让某个模块非零退出，整条命令随之失败。
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${DSH_NODE:-node}"
"$NODE_BIN" -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22 || (maj===22 && min<18)) { console.error(`需要 Node >= 22.18，当前 ${process.version}`); process.exit(1) }'

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

EXPECTED_STAGES=61
log_dir="runtime/.real-logs"
rm -rf "$log_dir"
mkdir -p "$log_dir"

for module in "${modules[@]}"; do
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  ▶ 真实模式运行模块 ${module}"
  echo "══════════════════════════════════════════════════════════════"
  "$NODE_BIN" "$module/run.ts" 2>&1 | tee "$log_dir/$module.txt"
done

stages=$(grep -h -c '^REAL_STAGE_OK ' "$log_dir"/*.txt | paste -sd+ - | bc)
modules_ok=$(grep -h -c '^REAL_MODULE_OK ' "$log_dir"/*.txt | paste -sd+ - | bc)
if [ "$stages" -ne "$EXPECTED_STAGES" ]; then
  echo "✗ REAL_STAGE_OK 只有 $stages 条，应为 $EXPECTED_STAGES 条" >&2
  exit 1
fi
if [ "$modules_ok" -ne "${#modules[@]}" ]; then
  echo "✗ REAL_MODULE_OK 只有 $modules_ok 条，应为 ${#modules[@]} 条" >&2
  exit 1
fi

echo ""
echo "REAL_ALL_OK modules=${#modules[@]} stages=$stages provider=anthropic-compat model=${LLM_MODEL:-MiniMax-M3}"
