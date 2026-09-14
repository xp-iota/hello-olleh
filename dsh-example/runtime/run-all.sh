#!/usr/bin/env bash
# 依次运行全部 12 个方向模块。从 dsh-example 根目录调用：
#   npm run all          真实推理服务（需 LLM_API_KEY，会发起网络请求）
#   npm run all:mock     离线确定性机制（不联网、不需要密钥）
#
# 两种模式共用各模块的 run.ts，只差一个 --mock。默认（不带参数）即真实模式。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE_ARGS=("$@")
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

for module in "${modules[@]}"; do
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  ▶ 运行模块 ${module}"
  echo "══════════════════════════════════════════════════════════════"
  "$NODE_BIN" "$module/run.ts" "${MODE_ARGS[@]}"
done

echo ""
echo "✅ 全部 12 个方向模块运行完毕。"
