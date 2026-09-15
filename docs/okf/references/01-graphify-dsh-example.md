---
type: Reference
title: "graphify 对 dsh-example 的建图结果"
description: 2026-09-12 用 graphify 0.9.53 对 runtime 与 M01–M12 建有向图的原始测量值与复现命令。
tags: [okf, dsh-example, graphify, measurement]
status: stable
sources:
  - id: dsh-example-src
    resource: "dsh-example/"
    title: 示例工程源码（仅 runtime 与 M01–M12，排除 node_modules）
  - id: graphify-skill
    resource: "tools/graphify/SKILL-kiro.md"
    title: 本仓库 vendored 的 graphify skill 说明
  - id: graphify-spec
    resource: "AGENTS.md"
    title: 本仓库 graphify 构图与证据等级规约
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
verified: { by: "process:graphify-0.9.53", at: 2026-09-12T12:25:04Z }
stale_after: 2026-12-31T00:00:00Z
---
# graphify 对 dsh-example 的建图结果

本页记录扫描范围、图谱指标、关系类型和重建命令。生成图位于
`graphify-out/dsh-example/graph.json`，该目录已加入 git 忽略规则。

## 测量值

| 指标 | 值 |
|:-----|:---|
| 扫描根 | `runtime` + `M01`–`M12` |
| 参与建图的文件数 | 169 |
| 节点数 | 584 |
| 边数 | 744 |
| 社区数 | 45 |
| 有向 | 是（`directed=True`） |
| 图类型 | `DiGraph`（非 multigraph） |

边按关系类型分布：

| relation | 条数 |
|:---------|:-----|
| `contains` | 374 |
| `imports_from` | 129 |
| `imports` | 96 |
| `re_exports` | 60 |
| `method` | 40 |
| `calls` | 38 |
| `indirect_call` | 4 |
| `dynamic_import` | 3 |

边按可信度分布：

| confidence | 条数 | 处理方式 |
|:-----------|:-----|:---------|
| `EXTRACTED` | 739 | 可作为结构事实引用 |
| `INFERRED` | 5 | **不得**冒充提取事实；仅作待复核线索 |

`graphify diagnose multigraph` 对最终 JSON 的结果为：584 节点、744 条有效候选边，
0 dangling endpoint、0 exact duplicate、0 same-endpoint collapse；重建后仍是 `DiGraph` 584/744。

## 枢纽节点（god nodes）

`god_nodes()` 会排除文件级节点；在这个口径下，前四名是：

| 节点 | 度数 | 位置 |
|:-----|:-----|:-----|
| `createHarness()` | 66 | `dsh-example/runtime/harness.ts` L136 |
| `userText()` | 10 | `dsh-example/runtime/harness.ts` L250 |
| `Harness`（接口） | 8 | `dsh-example/runtime/harness.ts` L105 |
| `DemoCompactionEngine` | 7 | `dsh-example/M02-context-assembly-economics/impl/03-compaction-provider.ts` L41 |

`createHarness` 只匹配到一个节点。它的 66 度由 **62 条入边 + 4 条出边**组成：

- 62 条入边：59 条 `imports`、2 条 `calls`、1 条定义归属的 `contains`；全部是 `EXTRACTED`。
- 4 条出边：调用真实 provider 适配器、`entryOf` 与 `Harness.loadPlugin` 等内部符号；全部是 `EXTRACTED`。

因此，“唯一装配枢纽”是可由图复算的结构事实；但不能把 62 条入边简化成“12 个模块各一条”，
因为每个 phase、真实 provider 路径和测试文件都会独立形成依赖边。

## 5 条 INFERRED 边

按仓库规约，推断边必须显式标注，不能与提取边混同：

| 来源 | 目标 | 关系 | 位置 |
|:-----|:-----|:-----|:-----|
| `collect()` | `MinimaxAnthropicAdapter.stream()` | `calls` | `runtime/llm-minimax.test.ts` L14 |
| `M05 scenes/01-session-log.ts` | `describe()` | `indirect_call` | `M05-session-surface/scenes/01-check-log-invariants.ts` L32 |
| `MinimaxAnthropicAdapter.stream()` | `toAnthropicTool()` | `indirect_call` | `runtime/llm-minimax.ts` L221 |
| `MinimaxAnthropicAdapter.stream()` | `toAnthropicMessage()` | `indirect_call` | `runtime/llm-minimax.ts` L224 |
| `toAnthropicMessage()` | `toAnthropicNestedBlock()` | `indirect_call` | `runtime/llm-minimax.ts` L163 |

本包不使用这 5 条边支撑任何结构性结论；需要引用时必须回到源码另行验证。

## 从 graph JSON 复算

```bash
env -u PYTHONHOME -u PYTHONPATH PYTHONPATH="$PWD/.tools/graphify" python3 - <<'PY'
import json
from collections import Counter
from pathlib import Path

g = json.loads(Path("graphify-out/dsh-example/graph.json").read_text())
nodes, links = g["nodes"], g["links"]
hub = next(n for n in nodes if n["id"] == "runtime_harness_createharness")
incoming = [e for e in links if e["target"] == hub["id"]]
outgoing = [e for e in links if e["source"] == hub["id"]]
print(len(nodes), len(links), len({n["community"] for n in nodes}))
print(Counter(e["relation"] for e in links))
print(Counter(e["confidence"] for e in links))
print(len(incoming) + len(outgoing), len(incoming), len(outgoing))
PY
```

## 重建

固定流程是 `collect_files → extract → build_from_json(directed=True) → cluster → god_nodes → to_json`。
扫描根只能是 `dsh-example/runtime` 与名称匹配 `M??-*` 的 12 个目录；`extract(..., parallel=False)`
可避免 macOS 从 stdin 启动 worker 时的回退噪声。graphify 本体必须精确为 `graphifyy==0.9.53`。

两个必须注意的点：

- **`directed=True` 不能省**。方向是 import/call 断言的一部分；构图后再运行
  `graphify diagnose multigraph --directed` 检查折叠与悬空端点。
- **不要扫描 `dsh-example/` 整棵目录**。显式列出 13 个扫描根，天然排除 `node_modules`；
  否则上游包会污染本工程的节点与度数。

导出的节点带 `source_file` 与 `source_location`（例如 `L136`），它们是 archify 图 `tag`
和本包 `sources` 的直接素材。

上一层：[References](index.md)。
