#!/bin/sh
# 自动同步多个上游仓库的源码快照到 sources/。
# - 仓库不存在则 clone，已存在则 fetch 后对齐到指定 tag 或默认分支（工作区强制重置）。
# - 各仓库前台逐个同步，避免后台任务丢失输出。
# - 源码快照统一放在 sources/ 下，与 README.md 中的目录结构一致。

# 仓库及对应版本（与 README 一致；Claude Code 为非开源反编译快照，故不从 GitHub 同步）
repo_specs='
# https://github.com/openai/codex/tree/rust-v0.154.0
openai/codex.git rust-v0.154.0
# https://github.com/anomalyco/opencode/tree/v2.0.2
anomalyco/opencode.git v2.0.2
google-gemini/gemini-cli.git v0.47.0
# https://github.com/NousResearch/hermes-agent/tree/v2026.9.11
nousresearch/hermes-agent.git v2026.9.11
# https://github.com/HKUDS/nanobot/tree/v0.3.0
HKUDS/nanobot.git v0.3.0
# git clone --branch v4.0.0-rc.10 https://github.com/cordiverse/cordis.git
cordiverse/cordis.git v4.0.0-rc.10
# git clone --branch dsh-v0.1.5-rc.2 https://github.com/deepseek-ai/deepseek-harness.git
deepseek-ai/deepseek-harness.git dsh-v0.1.5-rc.2
'

script_dir=$(cd "$(dirname "$0")" && pwd)
base_dir="$script_dir/sources"
mkdir -p "$base_dir"

fail_log=$(mktemp)
trap 'rm -f "$fail_log"' EXIT

# 同步单个仓库：$1 仓库路径（如 openai/codex.git），$2 目标版本（空=远端默认分支）
sync_one() {
    repo_url=$1
    ref=$2
    repo_name=$(basename "$repo_url" .git)
    repo_path="$base_dir/$repo_name"
    [ -n "$repo_name" ] || { echo "跳过无效条目: $repo_url"; return; }

    echo "[$repo_name] 开始同步 ${ref:-远端默认分支}"
    if [ -d "$repo_path/.git" ] && git -C "$repo_path" rev-parse --verify HEAD >/dev/null 2>&1; then
        if [ -n "$ref" ] && git -C "$repo_path" rev-parse --verify "$ref^{commit}" >/dev/null 2>&1; then
            action=reuse
        else
            action=fetch
            if ! git -C "$repo_path" fetch --quiet --tags origin; then
                failed_action=$action
                action=
            fi
        fi
    else
        action=clone
        rm -rf "$repo_path"
        if [ -n "$ref" ]; then
            git clone --quiet --depth 1 --branch "$ref" "https://github.com/$repo_url" "$repo_path" || {
                failed_action=$action
                action=
            }
        else
            git clone --quiet --depth 1 "https://github.com/$repo_url" "$repo_path" || {
                failed_action=$action
                action=
            }
        fi
    fi
    if [ -z "$action" ]; then
        echo "[$repo_name] ${failed_action:-同步} 失败: 检查网络、仓库地址或访问权限"
        echo "$repo_url" >>"$fail_log"
        return
    fi

    # 未指定版本时跟随远端默认分支
    target=$ref
    if [ -z "$target" ]; then
        git -C "$repo_path" remote set-head origin --auto >/dev/null 2>&1
        target=$(git -C "$repo_path" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
    fi

    if [ -n "$target" ] && git -C "$repo_path" checkout --quiet --force --detach "$target" 2>/dev/null; then
        git -C "$repo_path" clean -fdxq -e .gitkeep
        echo "[$repo_name] OK $target"
    else
        echo "[$repo_name] 找不到版本: ${target:-未知（远端无默认分支）}"
        echo "$repo_url ${target:-unknown}" >>"$fail_log"
    fi
}

# 读取仓库列表（跳过注释与空行），前台逐个同步
while read -r repo_url ref; do
    case "$repo_url" in ''|'#'*) continue ;; esac
    sync_one "$repo_url" "$ref" </dev/null
done <<EOF
$repo_specs
EOF

echo ""
if [ -s "$fail_log" ]; then
    echo "X 有 $(wc -l <"$fail_log") 个仓库同步失败:"
    sed 's/^/  - /' "$fail_log"
    exit 1
else
    echo "OK 所有仓库同步完成"
fi
