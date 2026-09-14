#!/usr/bin/env bash
# 真实推理服务全量验收：12 个模块、58 个阶段，每个阶段都必须留下真实调用证据。
# 从 dsh-example 根目录调用：npm run real:all
#
# 与 `npm run all`（离线 mock）的区别：本脚本设置 DSH_REAL=1，
# 任何 provider 缺失、模型未被调用或意外回退都会让某个模块非零退出，整条命令随之失败。
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${DSH_NODE:-node}"
"$NODE_BIN" -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22 || (maj===22 && min<18)) { console.error(`需要 Node >= 22.18，当前 ${process.version}`); process.exit(1) }'

export DSH_REAL=1

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

EXPECTED_STAGES=58
log_dir="runtime/.real-logs"
rm -rf "$log_dir"
mkdir -p "$log_dir"

for module in "${modules[@]}"; do
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  ▶ 真实模式运行模块 ${module}"
  echo "══════════════════════════════════════════════════════════════"
  "$NODE_BIN" "$module/run-real.ts" 2>&1 | tee "$log_dir/$module.txt"
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
echo "══════════════════════════════════════════════════════════════"
echo "  ▶ 三个专项真实演示（模型自主调用工具 / 真实流消费 / 清单对照）"
echo "══════════════════════════════════════════════════════════════"
"$NODE_BIN" M01-tool-pipeline/run-real-demo.ts
"$NODE_BIN" M03-inference-service-access/run-real-demo.ts
"$NODE_BIN" M10-external-capabilities/run-real-demo.ts

echo ""
echo "REAL_ALL_OK modules=${#modules[@]} stages=$stages demos=3 provider=anthropic-compat model=${LLM_MODEL:-MiniMax-M3}"
