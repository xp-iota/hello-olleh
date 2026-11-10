---
type: Reference
title: "graphify 对 dsh-lab 的建图结果"
description: 2026-10-23 用 graphify 0.9.53 对 dsh-lab 建有向图的原始测量值与复现命令；末尾保留 2026-09-12 对已删除的旧工程 dsh-example 的历史测量。
tags: [okf, dsh-lab, graphify, measurement]
status: stable
sources:
  - id: dsh-lab-src
    resource: "dsh-lab/"
    title: 配套工程源码（dsh-lab/src、runtime、scripts、M01–M12 与两份装配清单）
  - id: graphify-skill
    resource: "tools/graphify/SKILL-kiro.md"
    title: 本仓库 vendored 的 graphify skill 说明
  - id: graphify-spec
    resource: "AGENTS.md"
    title: 本仓库 graphify 构图与证据等级规约
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
verified:
  - { by: "process:graphify-0.9.53", at: 2026-09-12T12:25:04Z }
  - { by: "process:graphify-0.9.53", at: 2026-10-23T10:05:00Z }
stale_after: 2027-04-30T00:00:00Z
---
# graphify 对 dsh-lab 的建图结果

本页记录扫描范围、图谱指标、关系类型、枢纽节点和重建命令。上半部分的数字是
**2026-10-23 对 `dsh-lab/` 的实测**；下半部分保留 **2026-09-12 对已删除的旧工程
`dsh-example/` 的历史测量**——那组数字属于旧工程，不能当作 `dsh-lab/` 的结构事实。

## 本次建图：2026-10-23，dsh-lab

工具版本：graphify 0.9.53（`graphifyy==0.9.53`，装在 `.tools/graphify`）。
产物：`graphify-out/dsh-lab/graph.json`，该目录已加入 git 忽略规则。

### 扫描范围

扫描根是**显式列出**的 17 个，不是扫描整棵目录——`dsh-lab/node_modules/` 里是上游
发布包，扫进去会污染节点与度数。

| 扫描根 | 说明 |
|:-------|:-----|
| `dsh-lab/src` | `boot.ts`、`cli/`、`lab/`、`llm/anthropic-compat/` |
| `dsh-lab/runtime` | 双运行时支撑层（`run.mjs`、`verify.mjs`、`status.mjs`、`lib/`） |
| `dsh-lab/scripts` | 三个探针脚本 |
| `dsh-lab/M01`–`M12` | 12 个模块目录（每个只有 `index.ts` + `README.md`） |
| `dsh-lab/cordis.yml` | 根表（空） |
| `dsh-lab/cordis.patch.yml` | 装配清单（全部行） |

### 指标

| 指标 | 值 |
|:-----|:---|
| 参与建图的文件数 | 51 |
| 节点数 | 396 |
| 边数 | 600 |
| 社区数 | 32 |
| 有向 | 是（`directed=True`） |
| 图类型 | `DiGraph`（非 multigraph） |

边按关系类型分布：

| relation | 条数 |
|:---------|:-----|
| `contains` | 248 |
| `calls` | 106 |
| `imports` | 74 |
| `indirect_call` | 63 |
| `imports_from` | 52 |
| `method` | 33 |
| `dynamic_import` | 22 |
| `references` | 2 |

边按可信度分布：

| confidence | 条数 | 处理方式 |
|:-----------|:-----|:---------|
| `EXTRACTED` | 537 | 可作为结构事实引用 |
| `INFERRED` | 63 | **不得**冒充提取事实；仅作待复核线索 |

`graphify diagnose multigraph --directed` 对最终 JSON 的结果为：396 节点、600 条原始边
与 600 条有效候选边，0 missing endpoint、0 dangling endpoint、0 self-loop、
0 exact duplicate、0 directed same-endpoint collapse；post-build 仍是 `DiGraph` 600 边。
同一份数据若按**无向**重建，会有 12 条边因端点重复被折叠——这就是 `directed=True`
不能省的原因。

### 枢纽节点

`god_nodes()` 的默认口径排除文件级节点与 AST 方法桩，但**不排除** Markdown 标题节点，
所以 dsh-lab 的榜单里代码符号与各模块 `README.md` 的标题节点混在一起。下面先给
`god_nodes()` 的原始前十，再给只保留代码符号的排名。

`god_nodes()` 前十：

| 节点 | 度数 | 位置 |
|:-----|:-----|:-----|
| `Repl` | 17 | `dsh-lab/src/cli/repl.ts` L49 |
| `loadAllModules()` | 14 | `dsh-lab/src/lab/runner.ts` L218 |
| `StageContext` | 13 | `dsh-lab/src/lab/runner.ts` L23 |
| `defineModule` | 13 | `dsh-lab/src/lab/runner.ts` L62 |
| `M12 · Cordis 运行时与装配树`（README 标题） | 11 | `dsh-lab/M12-cordis-runtime/README.md` |
| `renderTrajectory` | 10 | `dsh-lab/src/cli/traj.ts` L227 |
| `resolveRuntime` | 10 | `dsh-lab/runtime/lib/runtimes.mjs` L110 |
| `M07 · 执行后端与边界`（README 标题） | 10 | `dsh-lab/M07-execution-backends/README.md` |
| `M08 · 委派与预设`（README 标题） | 10 | `dsh-lab/M08-delegation-presets/README.md` |
| `M09 · 长期运行的工作`（README 标题） | 10 | `dsh-lab/M09-long-running-work/README.md` |

只保留代码符号（再去掉文件级节点与 README 标题节点）时，前十是：

| 节点 | 度数 | 位置 |
|:-----|:-----|:-----|
| `Repl` | 17 | `dsh-lab/src/cli/repl.ts` L49 |
| `loadAllModules()` | 14 | `dsh-lab/src/lab/runner.ts` L218 |
| `StageContext` | 13 | `dsh-lab/src/lab/runner.ts` L23 |
| `defineModule` | 13 | `dsh-lab/src/lab/runner.ts` L62 |
| `renderTrajectory` | 10 | `dsh-lab/src/cli/traj.ts` L227 |
| `resolveRuntime` | 10 | `dsh-lab/runtime/lib/runtimes.mjs` L110 |
| `bootLab` | 9 | `dsh-lab/src/boot.ts` L180 |
| `line` | 9 | `dsh-lab/src/cli/term.ts` L75 |
| `Prompter` | 8 | `dsh-lab/src/cli/term.ts` L94 |
| `describeEvent()` | 8 | `dsh-lab/src/cli/traj.ts` L310 |

### 结构要点：没有单一装配枢纽

旧工程的星形拓扑是 `createHarness()` 一个函数被所有模块 import。**dsh-lab 没有这个形状**，
图上能直接看出来：

- 12 个模块的 `index.ts` 全部 `imports_from` → `dsh-lab/src/lab/runner.ts`，
  再由 `src/cli/bin.ts` 以 `dynamic_import` 载入；**没有一个模块 import `boot.ts`**。
- `bootLab`（`src/boot.ts` L180，度数 9）的 9 条边是：2 条出向 `calls`
  （`ensureWritableTemp`、`ensureLabHome`）+ 1 条 `contains`（来自文件节点）
  + 6 条入向 `imports`——来自 `src/cli/bin.ts`、`src/boot.test.ts`、
  `runtime/boot-probe.ts` 与 `scripts/` 下的三个探针。
- 也就是说：**服务树是在 CLI / 探针启动时建好的，模块阶段只是共用它**，
  不是每个模块自己装一套。
- `src/lab/services.ts` 只有 4 条入向 `imports_from`（M01 的 `index.ts`、
  `src/cli/repl.ts`、`src/cli/traj.ts`、`src/lab/runner.ts`）——它是类型增强的集中点，
  运行时一行都不产生。

### 一个负面发现：装配清单进不了 AST 图

`dsh-lab/cordis.yml` 与 `dsh-lab/cordis.patch.yml` 都在扫描根里，但它们**贡献了 0 个节点**：
graphify 的结构化提取走 tree-sitter 的**代码**语法，YAML 不在其中。

后果是：**装配清单里那 89 条 `- id:` 行在图上完全不可见**，本包关于「装配来源是声明式清单」
的结论只能靠读文件与数行，不能靠图复算。这也说明，旧工程「装配枢纽在图上是最大度节点」
的结论在 dsh-lab 上**不可移植**——枢纽搬到了图覆盖不到的地方。

### 63 条 INFERRED 边

全部是 `indirect_call`，来源集中在 12 个模块的 `index.ts`（每个 3–6 条，M02 与 M06 各 6 条，
M03 最少 3 条），另有 3 条落在适配器文件里：

| 来源 | 目标 | 关系 | 位置 |
|:-----|:-----|:-----|:-----|
| `.stream()` | `toAnthropicTool` | `indirect_call` | `dsh-lab/src/llm/anthropic-compat/index.ts` L376 |
| `toAnthropicMessage()` | `toAnthropicNestedBlock()` | `indirect_call` | `dsh-lab/src/llm/anthropic-compat/index.ts` L217 |
| `toAnthropicMessages` | `toAnthropicNestedBlock()` | `indirect_call` | `dsh-lab/src/llm/anthropic-compat/index.ts` L296 |

本包不使用这些边支撑任何结构性结论；需要引用时必须回到源码另行验证。

## 历史小节：2026-09-12 对 dsh-example 的建图

以下数字是对**已删除的旧工程** `dsh-example/` 的测量，仅作历史记录与口径参照，
**不是 `dsh-lab/` 的结构事实**。

| 指标 | 值 |
|:-----|:---|
| 扫描根 | `runtime` + `M01`–`M12`（13 个根） |
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

### 旧工程的枢纽节点（god nodes）

| 节点 | 度数 | 位置 |
|:-----|:-----|:-----|
| `createHarness()` | 66 | `dsh-example/runtime/harness.ts` L136 |
| `userText()` | 10 | `dsh-example/runtime/harness.ts` L250 |
| `Harness`（接口） | 8 | `dsh-example/runtime/harness.ts` L105 |
| `DemoCompactionEngine` | 7 | `dsh-example/M02-context-assembly-economics/impl/03-compaction-provider.ts` L41 |

`createHarness` 只匹配到一个节点。它的 66 度由 **62 条入边 + 4 条出边**组成：

- 62 条入边：59 条 `imports`、2 条 `calls`、1 条定义归属的 `contains`；全部是 `EXTRACTED`。
- 4 条出边：调用真实 provider 适配器、`entryOf` 与 `Harness.loadPlugin` 等内部符号；全部是 `EXTRACTED`。

因此，「唯一装配枢纽」在旧工程里是可由图复算的结构事实；但不能把 62 条入边简化成
「12 个模块各一条」，因为每个 phase、真实 provider 路径和测试文件都会独立形成依赖边。

### 旧工程的 5 条 INFERRED 边

| 来源 | 目标 | 关系 | 位置 |
|:-----|:-----|:-----|:-----|
| `collect()` | `MinimaxAnthropicAdapter.stream()` | `calls` | `runtime/llm-minimax.test.ts` L14 |
| `M05 scenes/01-session-log.ts` | `describe()` | `indirect_call` | `M05-session-surface/scenes/01-check-log-invariants.ts` L32 |
| `MinimaxAnthropicAdapter.stream()` | `toAnthropicTool()` | `indirect_call` | `runtime/llm-minimax.ts` L221 |
| `MinimaxAnthropicAdapter.stream()` | `toAnthropicMessage()` | `indirect_call` | `runtime/llm-minimax.ts` L224 |
| `toAnthropicMessage()` | `toAnthropicNestedBlock()` | `indirect_call` | `runtime/llm-minimax.ts` L163 |

这些位置全部属于已删除的旧工程，本包不使用它们支撑任何结构性结论。

### 旧工程与 dsh-lab 的结构差异（不要把旧数字套到新工程上）

| 旧工程（dsh-example） | dsh-lab |
|:----------------------|:--------|
| `runtime/harness.ts` 里的 `createHarness()` 手写装配，度数 66，是唯一枢纽 | 没有手写装配函数；装配来自 `cordis.patch.yml`，而 YAML **不进 AST 图**，图上最接近的代码入口是 `bootLab`（度数 9） |
| 每个模块 import `runtime/harness.ts` | 每个模块 import `src/lab/runner.ts`；`boot.ts` 由 CLI 与探针 import |
| 每模块 `impl/` + `scenes/` 多文件 | 每模块只有 `index.ts` + `README.md` |
| `runtime/llm.ts` 一个适配器文件 | `src/llm/anthropic-compat/index.ts`（目录形态） |
| 57 个独立阶段 + 3 个内联演示 | 60 个阶段，无内联演示 |
| 模块自己实现 compaction / sandbox provider | 由官方包在装配清单里提供 |
| 旧命令 `npm run learn -- --tour` / `--module M0X` | `npm run M0X`（单模块）/ `npm run all`（60 阶段），每条都有 `:bun` 变体 |
| 169 文件 / 584 节点 / 744 边 / 45 社区 | 51 文件 / 396 节点 / 600 边 / 32 社区 |

## 重建

固定流程是 `collect_files → extract → build_from_json(directed=True) → cluster → god_nodes → to_json`。
graphify 本体必须精确为 `graphifyy==0.9.53`。

### 1）安装

```bash
python3 -m pip install --target .tools/graphify graphifyy==0.9.53
```

### 2）构图

把下面这段存成 `graphify-out/build_dsh_lab.py`（`graphify-out/` 已被 gitignore）：

```python
from pathlib import Path

from graphify.analyze import god_nodes
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.export import to_json
from graphify.extract import collect_files, extract

roots = [Path("dsh-lab/src"), Path("dsh-lab/runtime"), Path("dsh-lab/scripts")]
roots += sorted(Path("dsh-lab").glob("M[0-9][0-9]-*"))
roots += [Path("dsh-lab/cordis.yml"), Path("dsh-lab/cordis.patch.yml")]

files = []
for root in roots:
    files.extend(collect_files(root))
print("files:", len(files))

extraction = extract(files, parallel=False)
graph = build_from_json(extraction, directed=True, root="dsh-lab")
communities = cluster(graph)
gods = god_nodes(graph, 10)
wrote = to_json(graph, communities, "graphify-out/dsh-lab/graph.json", force=True)
print("wrote:", wrote)
print("nodes:", graph.number_of_nodes(), "edges:", graph.number_of_edges(),
      "communities:", len(communities))
for node in gods:
    print(" ", node)
```

然后运行（bash）：

```bash
env -u PYTHONHOME -u PYTHONPATH PYTHONPATH="$PWD/.tools/graphify" python3 graphify-out/build_dsh_lab.py
```

或者（PowerShell）：

```powershell
$env:PYTHONPATH = "$PWD/.tools/graphify"
python3 graphify-out/build_dsh_lab.py
```

`to_json` 有「shrink guard」：新图的节点数比已存在的产物少时，它会拒绝写盘并返回
`False`，需要 `force=True` 才会覆盖旧产物。跑完请把 `files` 计数、节点/边/社区数、
`god_nodes()` 的前几名，以及 `graphify diagnose multigraph --directed` 的结果
填回本页上半部分。

### 三个必须注意的点

- **`directed=True` 不能省**。方向是 import/call 断言的一部分；本工程同一份数据
  按无向重建会折叠掉 12 条边。构图后再运行
  `graphify diagnose multigraph --directed` 检查折叠与悬空端点。
- **不要扫描 `dsh-lab/` 整棵目录**。显式列出 17 个扫描根，天然排除 `node_modules`；
  否则上游包会污染本工程的节点与度数。
- **不要把旧工程的数字改个名字就搬到 dsh-lab**。旧工程的枢纽是手写函数
  `createHarness()`；dsh-lab 没有这个符号，装配入口是 `boot()` 与 `cordis.patch.yml`，
  而后者在 AST 图里不可见。重跑后请把新图的枢纽节点名与位置**原样**写下来。

### 从 graph JSON 复算

构图后可用这段脚本独立复算节点/边/社区数与可信度分布（口径与本页上半部分一致）。
最后一段按度数排前 10，**包含文件级节点**——文件级节点靠 `contains` 边机械地累积度数，
要复现上半部分的「只保留代码符号」排名需再滤掉 `source_location == "L1"` 的节点：

```bash
env -u PYTHONHOME -u PYTHONPATH PYTHONPATH="$PWD/.tools/graphify" python3 - <<'PY'
import json
from collections import Counter
from pathlib import Path

g = json.loads(Path("graphify-out/dsh-lab/graph.json").read_text())
nodes, links = g["nodes"], g["links"]
print(len(nodes), len(links), len({n["community"] for n in nodes}))
print(Counter(e["relation"] for e in links))
print(Counter(e["confidence"] for e in links))
degree = Counter()
for edge in links:
    degree[edge["source"]] += 1
    degree[edge["target"]] += 1
for node in sorted(nodes, key=lambda n: -degree[n["id"]])[:10]:
    print(degree[node["id"]], node["id"], node.get("source_file"), node.get("source_location"))
PY
```

导出的节点带 `source_file` 与 `source_location`（例如 `L180`），它们是 archify 图 `tag`
和本包 `sources` 的直接素材。

上一层：[References](index.md)。
