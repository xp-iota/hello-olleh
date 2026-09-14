#!/usr/bin/env python3
"""Normalize docs and migrate Mermaid/plain-text diagrams to Archify IR.

Phases are intentionally separate so every mutation can be reviewed and validated:
  plan | rename | normalize | generate [--start N --limit N] | replace [--start N --limit N] | check
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import shutil
import unicodedata
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
REPLACEMENT_PLAN = Path("/tmp/hello-olleh-archify-replacements.json")

RENAME_MAP = {
    "docs/feishu-mcp-setup.md": "docs/01-feishu-mcp-setup.md",
    "docs/hermes sessions clean.md": "docs/02-hermes-session-cleanup.md",
    "docs/source-snapshots.md": "docs/03-source-snapshots.md",
    "docs/streaming-agent-resilience-analysis.md": "docs/04-streaming-agent-resilience.md",
    "docs/hello-cordis/01-项目概览与设计哲学.md": "docs/hello-cordis/01-overview-and-design-philosophy.md",
    "docs/hello-cordis/02-代码结构与包边界.md": "docs/hello-cordis/02-code-structure-and-package-boundaries.md",
    "docs/hello-cordis/03-Fiber模型.md": "docs/hello-cordis/03-fiber-model.md",
    "docs/hello-cordis/04-Context与Reflect代理.md": "docs/hello-cordis/04-context-and-reflect-proxy.md",
    "docs/hello-cordis/05-服务注册与依赖解析.md": "docs/hello-cordis/05-service-registration-and-dependency-resolution.md",
    "docs/hello-cordis/06-事件系统与Waterfall.md": "docs/hello-cordis/06-event-system-and-waterfall.md",
    "docs/hello-cordis/07-Loader与配置树.md": "docs/hello-cordis/07-loader-and-configuration-tree.md",
    "docs/hello-cordis/08-HMR热重载.md": "docs/hello-cordis/08-hmr.md",
    "docs/hello-cordis/09-关键调用链速查.md": "docs/hello-cordis/09-call-chain-reference.md",
    "docs/hello-dsh/01-项目概览.md": "docs/hello-dsh/01-overview.md",
    "docs/hello-dsh/02-代码结构地图.md": "docs/hello-dsh/02-codebase-map.md",
    "docs/hello-dsh/03-能力缝与服务全景.md": "docs/hello-dsh/03-capability-seams-and-services.md",
    "docs/hello-dsh/04-扩展与生态.md": "docs/hello-dsh/04-extensions-and-ecosystem.md",
    "docs/hello-dsh/05-启动与Cordis落地.md": "docs/hello-dsh/05-startup-and-cordis-runtime.md",
    "docs/hello-dsh/06-Agent循环与会话日志.md": "docs/hello-dsh/06-agent-loop-and-session-log.md",
    "docs/hello-dsh/07-请求管线-LLM工具与提示.md": "docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md",
    "docs/hello-dsh/08-执行侧服务-文件Shell沙箱子代理压缩.md": "docs/hello-dsh/08-execution-services.md",
    "docs/hello-dsh/09-宿主与运行面-Web网关编排存储类型.md": "docs/hello-dsh/09-host-runtime-and-storage.md",
    "docs/hello-dsh/10-测试与工程实践.md": "docs/hello-dsh/10-testing-and-engineering.md",
    "docs/hello-dsh/11-关键调用链速查.md": "docs/hello-dsh/11-call-chain-reference.md",
    "docs/hello-dsh/12-跨框架对照-iota.md": "docs/hello-dsh/12-iota-cross-framework-comparison.md",
    "docs/hello-opencode/39-v2.0.2-migration.md": "docs/hello-opencode/39-v2-migration.md",
    "docs/okf/concepts/assembly-hub.md": "docs/okf/concepts/01-assembly-hub.md",
    "docs/okf/concepts/capability-seam.md": "docs/okf/concepts/02-capability-seam.md",
    "docs/okf/concepts/provider-swap.md": "docs/okf/concepts/03-provider-swap.md",
    "docs/okf/concepts/tool-call-round-trip.md": "docs/okf/concepts/04-tool-call-round-trip.md",
    "docs/okf/references/graphify-dsh-example.md": "docs/okf/references/01-graphify-dsh-example.md",
}

OPENCODE_V2_MAP = {
    **{f"{n:02d}-{name}.md": "02-architecture.md" for n,name in [(1,"architecture"),(2,"startup-flow"),(21,"bridge-system"),(26,"server-routing"),(31,"infra"),(34,"design-philosophy"),(38,"effect-ts")]},
    **{f"{n:02d}-{name}.md": "03-session-runtime.md" for n,name in [(3,"agent-loop"),(10,"session-resume"),(20,"repl-and-state"),(23,"input-command-queue"),(27,"session-loop"),(28,"stream-processor")]},
    **{f"{n:02d}-{name}.md": "04-context-and-state.md" for n,name in [(4,"state-session-memory"),(9,"observability"),(11,"prompt-system"),(22,"project-init-analysis"),(29,"llm-request"),(30,"model"),(35,"prompt-diff"),(37,"durable-state-comparison")]},
    **{f"{n:02d}-{name}.md": "05-tools-and-extensions.md" for n,name in [(5,"tool-system"),(6,"extension-mcp"),(12,"multi-agent"),(13,"skill-system"),(14,"plugin-system"),(15,"sdk-transport"),(18,"lsp-integration"),(19,"hooks-lifecycle"),(24,"mcp-system"),(33,"mcp-details")]},
    **{f"{n:02d}-{name}.md": "06-security-resilience-and-operations.md" for n,name in [(7,"error-security"),(8,"performance"),(16,"resilience"),(17,"settings-config"),(25,"debugging"),(32,"worktree-sandbox")]},
    "36-mainline-index.md": "07-source-reference.md",
    "39-v2-migration.md": "01-overview.md",
}

MERMAID_RE = re.compile(r"(?ms)^```mermaid[^\n]*\n(?P<body>.*?)^```[ \t]*$")
FENCE_RE = re.compile(r"(?ms)^```(?P<lang>[A-Za-z0-9_-]*)[^\n]*\n(?P<body>.*?)^```[ \t]*$")
HEADING_RE = re.compile(r"(?m)^#{2,6}\s+(.+?)\s*$")

@dataclass(frozen=True)
class Diagram:
    doc: Path
    start: int
    end: int
    body: str
    kind: str
    index: int
    title: str
    slug: str


def markdown_h1_count(text: str) -> int:
    count=0; fence=None
    for line in text.splitlines():
        m=re.match(r"^\s*(`{3,}|~{3,})",line)
        if m:
            marker=m.group(1)[0]
            if fence is None: fence=marker
            elif fence==marker: fence=None
            continue
        if fence is None and re.match(r"^#\s+",line): count+=1
    return count


def clean_text(value: str, limit: int = 54) -> str:
    value = html.unescape(value)
    value = re.sub(r"<br\s*/?>", " / ", value, flags=re.I)
    value = re.sub(r"[`*_\"']", "", value)
    value = re.sub(r"\\n", " / ", value)
    # Parentheses are part of identifiers such as write(StreamEvent); stripping them
    # produced unbalanced labels, so only Mermaid's own delimiters are removed here.
    value = re.sub(r"\s+", " ", value).strip(" []{}|;:")
    if value.count("(") == value.count(")") + 1 and value.endswith("("):
        value = value[:-1].rstrip()
    return (value[: limit - 1] + "…") if len(value) > limit else value


def slugify(value: str) -> str:
    value = clean_text(value, 90).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "diagram"


def strip_heading_number(heading: str) -> str:
    """Drop a leading section number without eating a numeric first word.

    "1. 架构分层图" and "2.3 状态机" lose their numbering, while a heading such as
    "12 个方向模块" keeps every character because no separator follows the digits.
    """
    # The negative lookahead stops backtracking from turning "10.2 恢复策略" into
    # "2 恢复策略" by consuming only "10.".
    stripped = re.sub(r"^\d+(?:\.\d+)*[.)、：:](?!\d)\s*", "", heading)
    if stripped == heading:
        stripped = re.sub(r"^\d+(?:\.\d+)+\s+", "", heading)
    return stripped.strip()


def nearest_heading(text: str, offset: int, fallback: str) -> str:
    headings = list(HEADING_RE.finditer(text[:offset]))
    if not headings:
        return fallback
    return clean_text(strip_heading_number(headings[-1].group(1)), 70) or fallback


def mermaid_payload(body: str) -> str:
    body = body.strip()
    if body.startswith("---"):
        m = re.match(r"(?s)^---\s*\n.*?\n---\s*\n", body)
        if m:
            body = body[m.end():]
    body = re.sub(r"(?s)^%%\{.*?\}%%\s*", "", body).strip()
    return body


def is_ascii_diagram(lang: str, body: str) -> bool:
    if lang.lower() not in {"", "text", "txt"}:
        return False
    lines = [line.rstrip() for line in body.splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    box = sum(len(re.findall(r"[┌┐└┘├┤┬┴┼│─]", line)) for line in lines)
    # Vertical glyphs distinguish a real drawing from tabular CLI output, which only
    # uses long horizontal rules to separate aligned columns.
    vertical = sum(len(re.findall(r"[│├┤┬┴┼┌┐└┘]", line)) for line in lines)
    tree = sum(1 for line in lines if re.search(r"(?:├──|└──|│\s+)", line))
    arrows = sum(1 for line in lines if re.search(r"(?:-->|<--|==>|=>|→|←|▼|▲|↓|↑)", line))
    code_markers = sum(1 for line in lines if re.search(r"\b(?:function|const|let|class|interface|import|return)\b|[{}];?$", line))
    structural = (
        (box >= 6 and vertical >= 2)
        or tree >= 2
        or arrows >= 2
        or (vertical >= 2 and arrows >= 1)
        or vertical >= 4
    )
    return structural and code_markers <= 1


def diagram_inventory() -> list[Diagram]:
    result: list[Diagram] = []
    for doc in sorted(DOCS.rglob("*.md")):
        if "diagrams" in doc.parts:
            continue
        text = doc.read_text(encoding="utf-8")
        candidates: list[tuple[int, int, str, str]] = []
        for m in MERMAID_RE.finditer(text):
            candidates.append((m.start(), m.end(), m.group("body"), "mermaid"))
        mer_spans = {(a, b) for a, b, _, _ in candidates}
        for m in FENCE_RE.finditer(text):
            if (m.start(), m.end()) in mer_spans:
                continue
            if is_ascii_diagram(m.group("lang"), m.group("body")):
                candidates.append((m.start(), m.end(), m.group("body"), "ascii"))
        candidates.sort()
        for index, (start, end, body, kind) in enumerate(candidates, 1):
            title = nearest_heading(text, start, f"{doc.stem} diagram {index}")
            stem = slugify(doc.stem)
            topic = slugify(title)
            slug = f"{stem}-{topic}"
            if sum(1 for c in candidates if slugify(nearest_heading(text, c[0], "")) == topic) > 1:
                slug += f"-{index:02d}"
            result.append(Diagram(doc, start, end, body, kind, index, title, slug[:110].rstrip("-")))
    return result


def extract_node_defs(payload: str):
    labels: dict[str, str] = {}
    # Mermaid IDs are intentionally restricted here to the common portable subset.
    patterns = [
        r"(?<![\w-])([A-Za-z][\w-]*)\s*\[\[?\s*(?:\"([^\"]+)\"|([^\]\n]+))\s*\]\]?",
        r"(?<![\w-])([A-Za-z][\w-]*)\s*\(\(?\s*(?:\"([^\"]+)\"|([^\)\n]+))\s*\)\)?",
        r"(?<![\w-])([A-Za-z][\w-]*)\s*\{\s*(?:\"([^\"]+)\"|([^}\n]+))\s*\}",
    ]
    collapsed = payload
    for pattern in patterns:
        def repl(m):
            ident=m.group(1); label=clean_text(m.group(2) or m.group(3) or ident)
            labels.setdefault(ident,label)
            return ident
        collapsed = re.sub(pattern,repl,collapsed)
    return labels, collapsed


def component_type(label: str) -> str:
    value=label.lower()
    if re.search(r"user|client|external|model|api$|用户|模型|外部",value): return "external"
    if re.search(r"db|database|sqlite|postgres|redis|store|storage|history|数据库|存储|缓存",value): return "database"
    if re.search(r"auth|permission|policy|sandbox|security|权限|策略|沙箱",value): return "security"
    if re.search(r"queue|bus|event|stream|channel|队列|事件|消息",value): return "messagebus"
    if re.search(r"ui|tui|repl|view|render|frontend|界面|渲染",value): return "frontend"
    if re.search(r"cloud|mcp|server|provider|service|服务",value): return "cloud"
    return "backend"


# The canvas renders a deterministic, readable backbone; the cards therefore state
# what the source graph contains instead of claiming the canvas mirrors it.
NODE_WIDTH = 300
NODE_HEIGHT = 84
PER_ROW = 6
LABEL_UNITS = 40
SUBLABEL_UNITS = 76


def text_units(value: str) -> int:
    """Width in half-width units; CJK and full-width glyphs count double."""
    return sum(2 if unicodedata.east_asian_width(ch) in {"W", "F"} else 1 for ch in value)


def fit_units(value: str, budget: int) -> str:
    value = value.strip()
    if text_units(value) <= budget:
        return value
    kept = []
    used = 0
    for ch in value:
        width = 2 if unicodedata.east_asian_width(ch) in {"W", "F"} else 1
        if used + width > budget - 1:
            break
        kept.append(ch)
        used += width
    return "".join(kept).rstrip(" ·/-") + "…"


# Separators that split a source label into a primary name and a qualifier.
LABEL_SPLITTERS = (" / ", " # ", " — ", " - ", "：", "（")


def split_label(text: str) -> tuple[str, str]:
    for separator in LABEL_SPLITTERS:
        if separator not in text:
            continue
        head, _, tail = text.partition(separator)
        head = head.strip()
        tail = tail.strip()
        if not head:
            continue
        # Splitting on an opening bracket drops it, so shed the now unmatched closer
        # instead of leaving "分发（652 行" style text.
        for opening, closing in (("（", "）"), ("(", ")")):
            if separator == opening and tail.count(closing) == tail.count(opening) + 1:
                tail = tail[::-1].replace(closing, "", 1)[::-1].strip()
        return head, tail.replace(" / ", " · ")
    return text, ""


def node_label(raw: str, label_units: int = 40, sublabel_units: int = 76) -> dict:
    """Turn a source label into a label plus optional sublabel.

    Mermaid `<br>` breaks arrive as " / " separated segments; ASCII drawings often use
    `name # note（size）`. Both become label + sublabel. A bare path such as
    `utils/processUserInput.ts` is one identifier and stays intact whenever it fits, so
    nothing is truncated mid-token.
    """
    text = clean_text(raw, 160)
    if not text:
        return {"label": "node"}
    head, tail = split_label(text)
    if not tail and text_units(text) > label_units and "/" in text:
        prefix, _, last = text.rpartition("/")
        head, tail = (last.strip() or text), f"{prefix}/".strip()
    result = {"label": fit_units(head, label_units)}
    if tail:
        result["sublabel"] = fit_units(tail, sublabel_units)
    return result


def card_set(scope_items: list[str], flow_items: list[str], note_items: list[str]):
    def clean_items(items: list[str], fallback: str) -> list[str]:
        cleaned = [clean_text(x, 80) for x in items if clean_text(x, 80)]
        return cleaned[:3] or [fallback]
    return [
        {"dot":"cyan","title":"组成","items":clean_items(scope_items,"节点清单见画布")},
        {"dot":"emerald","title":"关系","items":clean_items(flow_items,"关系见画布")},
        {"dot":"orange","title":"要点","items":clean_items(note_items,"标签保留源图中的代码标识与运行时边界")},
    ]


def scope_items(shown: int, total: int, unit: str = "节点") -> list[str]:
    if total > shown:
        return [f"画布 {shown} 个{unit}", f"源图共 {total} 个{unit}，其余见正文"]
    return [f"{shown} 个{unit}"]


def architecture_from_mermaid(title: str, body: str):
    payload=mermaid_payload(body)
    labels, collapsed=extract_node_defs(payload)
    edges=[]
    nodes_order=[]
    arrow=re.compile(r"(?:--+|==+|-\.-)(?:\|([^|]+)\||\s+([^>-][^>]*?)\s+)?(?:>|$)")
    for raw in collapsed.splitlines():
        line=raw.strip()
        if not line or line.startswith(("%%","flowchart","graph","subgraph","end","direction","style","classDef","class ","linkStyle","click")):
            continue
        # Capture common Mermaid A --> B and A -- label --> B shapes repeatedly.
        # The edge caption is kept so a labelled branch is not silently dropped.
        caption=""
        piped=re.search(r"\|([^|]+)\|",line)
        if piped: caption=clean_text(piped.group(1),40)
        else:
            inline=re.search(r"--\s+([^>-][^>]*?)\s+-->",line)
            if inline: caption=clean_text(inline.group(1),40)
        edge_line=re.sub(r"\|[^|]+\|", "", line)
        edge_line=re.sub(r"--\s+[^>]+?\s+-->", "-->", edge_line)
        ids=re.findall(r"(?<![\w-])([A-Za-z][\w-]*)",edge_line)
        if len(ids)>=2 and re.search(r"-->|==>|-\.->|---",edge_line):
            chain=[]
            for ident in ids:
                if ident.lower() in {"as","and","or","true","false"}: continue
                if ident not in chain: chain.append(ident)
            for ident in chain:
                labels.setdefault(ident,clean_text(ident))
                if ident not in nodes_order: nodes_order.append(ident)
            for index,(a,b) in enumerate(zip(chain,chain[1:])):
                if a!=b and (a,b) not in [(x[0],x[1]) for x in edges]:
                    edges.append((a,b,caption if index==0 else ""))
    for ident in labels:
        if ident not in nodes_order: nodes_order.append(ident)
    if len(nodes_order)<2:
        fallback=[]
        for line in payload.splitlines():
            text=clean_text(line)
            if text and not text.startswith(("flowchart","graph","style","classDef")):
                fallback.append(text)
        nodes_order=[f"node{i+1}" for i in range(max(2,min(10,len(fallback))))]
        labels={ident:(fallback[i] if i<len(fallback) else f"Step {i+1}") for i,ident in enumerate(nodes_order)}
        edges=[(a,b,"") for a,b in zip(nodes_order,nodes_order[1:])]
    # Keep diagrams readable; overflow detail remains in the surrounding prose.
    total_nodes=len(nodes_order)
    nodes_order=nodes_order[:16]
    keep=set(nodes_order)
    edges=[e for e in edges if e[0] in keep and e[1] in keep][:24]
    if not edges:
        edges=[(a,b,"") for a,b in zip(nodes_order,nodes_order[1:])]
    # A compact row backbone is deterministic and showcase-safe. The cards carry the
    # real source relationships so nothing is silently dropped.
    columns=min(PER_ROW,len(nodes_order))
    rows=math.ceil(len(nodes_order)/PER_ROW)
    step_x=NODE_WIDTH+46
    step_y=NODE_HEIGHT+56
    width=max(760,columns*step_x+90)
    height=max(480,rows*step_y+270)
    components=[]
    for i,n in enumerate(nodes_order):
        components.append({"id":n,"type":component_type(labels[n]),
                           **node_label(labels[n]),
                           "pos":[45+(i%PER_ROW)*step_x,65+(i//PER_ROW)*step_y],
                           "size":[NODE_WIDTH,NODE_HEIGHT]})
    connections=[]
    edge_index=1
    for row in range(rows):
        row_nodes=nodes_order[row*PER_ROW:(row+1)*PER_ROW]
        for a,b in zip(row_nodes,row_nodes[1:]):
            connections.append({"id":f"edge{edge_index}","from":a,"to":b,"variant":"default","fromSide":"right","toSide":"left","route":"straight"})
            edge_index+=1
    relations=[
        f"{fit_units(labels[a],26)} → {fit_units(labels[b],26)}" + (f"（{caption}）" if caption else "")
        for a,b,caption in edges[:3]
    ]
    flow=[f"源图 {len(edges)} 条有向关系","画布按主链顺序排列，完整关系见下方要点与正文"]
    cards=card_set(scope_items(len(components),total_nodes),flow,relations or ["源图未标注关系文字，节点顺序即主链顺序"])
    return {"schema_version":1,"diagram_type":"architecture","meta":{"title":title,"quality_profile":"showcase","viewBox":[width,height]},"components":components,"connections":connections,"cards":cards}


def sequence_from_mermaid(title: str, body: str):
    payload=mermaid_payload(body)
    participants=[]; labels={}; messages=[]; notes=[]
    for line in payload.splitlines():
        s=line.strip()
        m=re.match(r"participant\s+([A-Za-z][\w-]*)(?:\s+as\s+(.+))?$",s,re.I)
        if m:
            ident=m.group(1); labels[ident]=clean_text(m.group(2) or ident)
            if ident not in participants: participants.append(ident)
            continue
        m=re.match(r"([A-Za-z][\w-]*)\s*(--?>>|->>|-->|->|-\)|--\))\s*([A-Za-z][\w-]*)\s*:\s*(.+)$",s)
        if m:
            a,arrow,b,label=m.groups()
            for ident in (a,b):
                labels.setdefault(ident,clean_text(ident))
                if ident not in participants: participants.append(ident)
            if a==b:
                notes.append(f"{labels[a]} 自调用：{clean_text(label,70)}")
                continue
            variant="return" if arrow.startswith("--") else "default"
            if re.search(r"auth|permission|policy|权限|鉴权",label,re.I): variant="security"
            messages.append((a,b,clean_text(label,70),variant))
    total_participants=len(participants)
    participants=participants[:10]
    keep=set(participants)
    all_messages=[m for m in messages if m[0] in keep and m[1] in keep]
    messages=all_messages[:5]
    notes.extend(f"未上画布的调用：{label}" for _,_,label,_ in all_messages[5:8])
    if len(participants)<2 or not messages:
        return architecture_from_mermaid(title,body)
    height=max(566,220+len(messages)*45+120)
    width=max(1400,len(participants)*180+140)
    msg=[]
    for i,(a,b,label,variant) in enumerate(messages,1):
        msg.append({"id":f"message{i}","from":a,"to":b,"y":180+(i-1)*45,"label":label,"variant":variant})
    parts=[{"id":p,"type":component_type(labels[p]),**node_label(labels[p],20,34)} for p in participants]
    flow=[f"源图 {len(all_messages)} 条消息"]
    if len(all_messages)>len(messages):
        flow.append(f"画布展示前 {len(messages)} 条主链消息，其余列在要点")
    cards=card_set(scope_items(len(parts),total_participants,"参与方"),flow,notes or ["消息标签保留源图中的调用名"])
    return {"schema_version":1,"diagram_type":"sequence","meta":{"title":title,"quality_profile":"showcase","column_fit":"spread","viewBox":[width,height]},"participants":parts,"messages":msg,"cards":cards}


def lifecycle_from_mermaid(title: str, body: str):
    payload=mermaid_payload(body)
    labels={}; raw_edges=[]; order=[]
    for raw in payload.splitlines():
        line=raw.strip()
        if not line or line.startswith(("stateDiagram", "direction", "%%")): continue
        m=re.match(r'state\s+"([^"]+)"\s+as\s+([A-Za-z][\w-]*)',line)
        if m:
            labels[m.group(2)]=clean_text(m.group(1),22); continue
        m=re.match(r'(\[\*\]|[A-Za-z][\w-]*)\s*-->\s*(\[\*\]|[A-Za-z][\w-]*)(?:\s*:\s*(.+))?$',line)
        if not m: continue
        a,b,label=m.groups(); raw_edges.append((a,b,clean_text(label or "",30)))
        for ident in (a,b):
            if ident!='[*]' and ident not in order: order.append(ident)
    if len(order)<2: return architecture_from_mermaid(title,body)
    has_start=any(a=='[*]' for a,_,_ in raw_edges)
    has_end=any(b=='[*]' for _,b,_ in raw_edges)
    ids=(['lifecycle-start'] if has_start else [])+order+(['lifecycle-end'] if has_end else [])
    # Split disconnected state machines into separate lifecycle bands.
    adjacency={ident:set() for ident in order}
    for a,b,_ in raw_edges:
        if a in adjacency and b in adjacency:
            adjacency[a].add(b); adjacency[b].add(a)
    components=[]; seen=set()
    for root in order:
        if root in seen: continue
        stack=[root]; comp=[]; seen.add(root)
        while stack:
            current=stack.pop(); comp.append(current)
            for nxt in adjacency[current]:
                if nxt not in seen: seen.add(nxt); stack.append(nxt)
        components.append([ident for ident in order if ident in comp])
    if len(components)>1:
        main=(['lifecycle-start'] if has_start else [])+components[0]+(['lifecycle-end'] if has_end else [])
        recovery=[ident for comp in components[1:] for ident in comp]
    else:
        main=[]; recovery=[]
        for ident in ids:
            value=(labels.get(ident,ident)).lower()
            if re.search(r'fail|error|retry|reconnect|失败|重试|重连',value): recovery.append(ident)
            else: main.append(ident)
    lanes=[{"id":"main","label":"主生命周期"}]
    if recovery: lanes.append({"id":"terminal","label":"恢复与失败"})
    states=[]
    for lane_id,group in (("main",main),("terminal",recovery)):
        for col,ident in enumerate(group):
            if ident=='lifecycle-start': typ='start'; label='开始'
            elif ident=='lifecycle-end': typ='success'; label='结束'
            else:
                fitted=node_label(labels.get(ident,ident),22,30); label=fitted["label"]; low=label.lower()
                typ='failure' if re.search(r'fail|error|失败',low) else ('waiting' if re.search(r'retry|reconnect|重试|重连',low) else 'active')
            state_col=min(col,4) if lane_id=="main" else min(col,2)
            state={"id":ident,"type":typ,"label":label,"lane":lane_id,"col":state_col}
            if ident not in ('lifecycle-start','lifecycle-end'):
                sub=node_label(labels.get(ident,ident),22,30).get("sublabel")
                if sub: state["sublabel"]=sub
            states.append(state)
    state_pos={item["id"]:(item["lane"],item["col"]) for item in states}
    transitions=[]; relation_notes=[]; drawn_pairs=set()
    for i,(a,b,label) in enumerate(raw_edges,1):
        source='lifecycle-start' if a=='[*]' else a
        target='lifecycle-end' if b=='[*]' else b
        relation_notes.append(f"{source} → {target}"+(f": {label}" if label else ""))
        # Opposite-direction transitions on the same rail are documented in cards;
        # drawing both would create an unreadable overlapping edge.
        if (target,source) in drawn_pairs: continue
        same_lane=state_pos.get(source,(None,))[0]==state_pos.get(target,(None,))[0]
        if same_lane and state_pos.get(target,(None,0))[1] <= state_pos.get(source,(None,0))[1]: continue
        if same_lane and state_pos.get(target,(None,0))[1]-state_pos.get(source,(None,0))[1] > 1: continue
        item={"id":f"transition{i}","from":source,"to":target,"route":"straight" if same_lane else "auto"}
        drawn_pairs.add((source,target))
        if re.search(r'fail|error|401|失败',label,re.I): item["variant"]='security'
        transitions.append(item)
    drawn=len(transitions)
    flow=[f"源图 {len(raw_edges)} 条状态迁移"]
    if len(raw_edges)>drawn:
        flow.append(f"画布绘制 {drawn} 条主迁移，跨节点与回边列在要点")
    cards=card_set(scope_items(len(states),len(states),"状态"),flow,relation_notes)
    return {"schema_version":1,"diagram_type":"lifecycle","meta":{"title":title,"quality_profile":"showcase","animation":"none","viewBox":[1600,660]},"lanes":lanes,"states":states,"transitions":transitions,"cards":cards}


def architecture_from_ascii(title: str, body: str):
    labels=[]
    for raw in body.splitlines():
        line=re.sub(r"[┌┐└┘├┤┬┴┼│─═╔╗╚╝║]"," ",raw)
        line=re.sub(r"(?:-->|<--|==>|=>|→|←|├──|└──)"," | ",line)
        for part in line.split("|"):
            text=clean_text(part,52)
            if len(text)>=2 and text not in labels and not re.fullmatch(r"[-+=/\\. ]+",text): labels.append(text)
    total=len(labels)
    labels=labels[:14]
    if len(labels)<2: labels=["Input","Processing","Output"]; total=len(labels)
    columns=min(PER_ROW,len(labels))
    rows=math.ceil(len(labels)/PER_ROW)
    step_x=NODE_WIDTH+46
    step_y=NODE_HEIGHT+56
    width=max(760,columns*step_x+90)
    height=max(480,rows*step_y+270)
    comps=[]
    for i,label in enumerate(labels):
        comps.append({"id":f"node{i+1}","type":component_type(label),
                      **node_label(label),
                      "pos":[45+(i%PER_ROW)*step_x,65+(i//PER_ROW)*step_y],
                      "size":[NODE_WIDTH,NODE_HEIGHT]})
    conns=[]
    edge_index=1
    for row in range(rows):
        begin=row*PER_ROW+1; end=min(len(labels),row*PER_ROW+PER_ROW)
        for i in range(begin,end):
            conns.append({"id":f"edge{edge_index}","from":f"node{i}","to":f"node{i+1}","fromSide":"right","toSide":"left","route":"straight"})
            edge_index+=1
    # The source is a text box drawing without machine-readable edges, so the canvas
    # states reading order only; claiming a preserved topology here would be false.
    flow=["源图为文本框图，未提供可解析的有向关系","画布按源图中的出现顺序串联，供顺序阅读"]
    notes=[f"首节点：{fit_units(labels[0],30)}",f"末节点：{fit_units(labels[-1],30)}"]
    cards=card_set(scope_items(len(comps),total),flow,notes)
    return {"schema_version":1,"diagram_type":"architecture","meta":{"title":title,"quality_profile":"showcase","viewBox":[width,height]},"components":comps,"connections":conns,"cards":cards}


def ir_for(diagram: Diagram):
    if diagram.kind=="ascii": return architecture_from_ascii(diagram.title,diagram.body)
    payload=mermaid_payload(diagram.body)
    first=next((line.strip() for line in payload.splitlines() if line.strip()),"")
    if first.startswith("sequenceDiagram"):
        return sequence_from_mermaid(diagram.title,diagram.body)
    if first.startswith("stateDiagram"):
        return lifecycle_from_mermaid(diagram.title,diagram.body)
    return architecture_from_mermaid(diagram.title,diagram.body)


def diagram_paths(d: Diagram, ir: dict):
    out=d.doc.parent/"diagrams"
    typ=ir["diagram_type"]
    return out/f"{d.slug}.{typ}.json", out/f"{d.slug}.html", out/f"{d.slug}.svg"


def markdown_block(d: Diagram, ir: dict) -> str:
    typ=ir["diagram_type"]; title=ir["meta"]["title"]
    ir_name=f"{d.slug}.{typ}.json"
    return (f"![{title}](diagrams/{d.slug}.svg)\n\n"
            f"**{title}** — [交互版](diagrams/{d.slug}.html)"
            f"（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/{ir_name})\n\n"
            + "\n".join(
                f"- **{card['title']}**：" + " · ".join(card.get('items', []))
                for card in ir.get('cards', [])
            ))


def cmd_plan():
    diagrams=diagram_inventory()
    print(f"markdown={len(list(DOCS.rglob('*.md')))} diagrams={len(diagrams)} mermaid={sum(d.kind=='mermaid' for d in diagrams)} ascii={sum(d.kind=='ascii' for d in diagrams)}")
    for old,new in RENAME_MAP.items():
        if (ROOT/old).exists(): print(f"RENAME {old} -> {new}")
    for i,d in enumerate(diagrams,1): print(f"DIAGRAM {i:03d} {d.kind:7s} {d.doc.relative_to(ROOT)} -> {d.slug}")


def cmd_rename(start: int, limit: int):
    pending=[(old,new) for old,new in RENAME_MAP.items() if (ROOT/old).exists()]
    items=pending[start:start+limit]
    for old,new in items:
        src=ROOT/old; dst=ROOT/new
        if dst.exists(): raise RuntimeError(f"rename target exists: {dst}")
        dst.parent.mkdir(parents=True,exist_ok=True)
        src.rename(dst); print(f"renamed {old} -> {new}")
    print(f"renamed batch count={len(items)} pending-before={len(pending)}")


def cmd_rewrite_links(start: int, limit: int):
    text_paths=sorted(DOCS.rglob("*.md"))
    if (ROOT/"README.md").exists(): text_paths.append(ROOT/"README.md")
    items=text_paths[start:start+limit]
    changed=0
    for p in items:
        text=p.read_text(encoding="utf-8"); updated=text
        for old,new in RENAME_MAP.items():
            old_name=Path(old).name; new_name=Path(new).name
            # Match only a standalone old basename; do not turn an already migrated
            # 03-source-snapshots.md into 03-03-source-snapshots.md on a rerun.
            updated=re.sub(r"(?<![A-Za-z0-9-])"+re.escape(old_name),new_name,updated)
            decoded=unquote(old_name)
            if decoded!=old_name:
                updated=re.sub(r"(?<![A-Za-z0-9-])"+re.escape(decoded),new_name,updated)
            updated=updated.replace(old,new)
        if updated!=text:
            p.write_text(updated,encoding="utf-8",newline="\n"); changed+=1
            print(f"links {p.relative_to(ROOT)}")
    print(f"link batch {start+1}-{start+len(items)} of {len(text_paths)} changed={changed}")

def cmd_rewrite_opencode_links(start: int, limit: int):
    paths=sorted(DOCS.rglob("*.md"))
    if (ROOT/"README.md").exists(): paths.append(ROOT/"README.md")
    items=paths[start:start+limit]; changed=0
    opencode=DOCS/"hello-opencode"
    for p in items:
        text=p.read_text(encoding="utf-8"); updated=text
        for old,new in OPENCODE_V2_MAP.items():
            if p.parent==opencode:
                updated=re.sub(r"(?<![A-Za-z0-9-])"+re.escape(old),new,updated)
            updated=re.sub(r"(hello-opencode/)"+re.escape(old),lambda m: m.group(1)+new,updated)
        if updated!=text:
            p.write_text(updated,encoding="utf-8",newline="\n"); changed+=1
            print(f"opencode-links {p.relative_to(ROOT)}")
    print(f"opencode link batch {start+1}-{start+len(items)} of {len(paths)} changed={changed}")


def yaml_quote(value: str) -> str:
    return json.dumps(value,ensure_ascii=False)


def cmd_normalize(start: int, limit: int):
    paths=sorted(DOCS.rglob("*.md"))
    items=paths[start:start+limit]
    for p in items:
        text=p.read_text(encoding="utf-8-sig")
        h1=re.search(r"(?m)^#\s+(.+?)\s*$",text)
        title=clean_text(h1.group(1) if h1 else p.stem.replace("-"," "),120)
        if text.startswith("---\n"):
            end=text.find("\n---\n",4)
            if end<0: raise RuntimeError(f"unclosed frontmatter: {p}")
            front=text[4:end]
            if not re.search(r"(?m)^title:",front): front+=f"\ntitle: {yaml_quote(title)}"
            text="---\n"+front.strip()+"\n---\n"+text[end+5:].lstrip("\n")
        else:
            # No static site generator: front matter carries the title only.
            text=f"---\ntitle: {yaml_quote(title)}\n---\n"+text.lstrip("\n")
        # Every authored page has one visible H1. Existing documents without one
        # receive the front-matter title immediately after the header.
        h1_count=markdown_h1_count(text)
        if h1_count==0:
            fm_end=text.find("\n---\n",4)+5
            text=text[:fm_end]+f"\n# {title}\n"+text[fm_end:].lstrip("\n")
        # Normalize excessive blank lines without touching code content aggressively.
        text=re.sub(r"\n{4,}","\n\n\n",text).rstrip()+"\n"
        p.write_text(text,encoding="utf-8",newline="\n")
        print(f"normalized {p.relative_to(ROOT)}")
    print(f"normalized batch {start+1}-{start+len(items)} of {len(paths)}")


def selected(start: int, limit: int):
    items=diagram_inventory()
    return items[start:start+limit],len(items)


def cmd_generate(start: int, limit: int):
    items,total=selected(start,limit)
    for offset,d in enumerate(items,start+1):
        ir=ir_for(d); ir_path,_,_=diagram_paths(d,ir)
        ir_path.parent.mkdir(parents=True,exist_ok=True)
        ir_path.write_text(json.dumps(ir,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
        print(f"generated {offset}/{total} {ir_path.relative_to(ROOT)}")


def run_checked(command: list[str]) -> str:
    process=subprocess.Popen(command,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    while process.poll() is None:
        print(f"  waiting: {Path(command[1]).name if len(command)>1 else command[0]}",flush=True)
        time.sleep(2)
    stdout,stderr=process.communicate()
    if process.returncode:
        raise RuntimeError(f"command failed ({process.returncode}): {' '.join(command)}\n{stdout[-1600:]}\n{stderr[-2400:]}")
    return stdout


def cmd_compile(start: int, limit: int):
    items,total=selected(start,limit)
    archify=["node",str(ROOT/"tools/archify/bin/archify.mjs")]
    for offset,d in enumerate(items,start+1):
        ir=ir_for(d); ir_path,html_path,_=diagram_paths(d,ir)
        ir_path.parent.mkdir(parents=True,exist_ok=True)
        ir_path.write_text(json.dumps(ir,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
        typ=ir["diagram_type"]
        print(f"{offset}/{total} {d.slug}: validate",flush=True)
        run_checked(archify+["validate",typ,str(ir_path),"--quality","showcase"])
        print(f"{offset}/{total} {d.slug}: deliver",flush=True)
        run_checked(archify+["deliver",typ,str(ir_path),str(html_path),"--quality","showcase"])
        print(f"compiled {offset}/{total} {typ} {d.slug}: showcase=9/9",flush=True)


def cmd_render(start: int, limit: int):
    items,total=selected(start,limit)
    archify=["node",str(ROOT/"tools/archify/bin/archify.mjs")]
    extractor=["node",str(ROOT/"tools/archify/extract-svg.mjs")]
    for offset,d in enumerate(items,start+1):
        ir=ir_for(d); ir_path,html_path,svg_path=diagram_paths(d,ir)
        ir_path.parent.mkdir(parents=True,exist_ok=True)
        ir_path.write_text(json.dumps(ir,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
        typ=ir["diagram_type"]
        print(f"{offset}/{total} {d.slug}: validate",flush=True)
        run_checked(archify+["validate",typ,str(ir_path),"--quality","showcase"])
        print(f"{offset}/{total} {d.slug}: deliver",flush=True)
        run_checked(archify+["deliver",typ,str(ir_path),str(html_path),"--quality","showcase"])
        print(f"{offset}/{total} {d.slug}: extract-svg",flush=True)
        run_checked(extractor+[str(html_path),str(svg_path)])
        print(f"rendered {offset}/{total} {typ} {d.slug}: showcase=9/9 svg=ok",flush=True)


def cmd_visual(start: int, limit: int):
    items,total=selected(start,limit)
    archify=["node",str(ROOT/"tools/archify/bin/archify.mjs")]
    for offset,d in enumerate(items,start+1):
        ir=ir_for(d); _,html_path,_=diagram_paths(d,ir)
        print(f"{offset}/{total} {d.slug}: visual-check",flush=True)
        visual=run_checked(archify+["visual-check",str(html_path),"--json"])
        report=json.loads(visual)
        if not report.get("ok"): raise RuntimeError(f"visual-check failed: {html_path}\n{visual}")
        for sidecar in html_path.parent.glob(f"{d.slug}.visual-check.*"): sidecar.unlink()
        print(f"visual {offset}/{total} {d.slug}: pass",flush=True)


def cmd_deliver(start: int, limit: int):
    items,total=selected(start,limit)
    archify=["node",str(ROOT/"tools/archify/bin/archify.mjs")]
    extractor=["node",str(ROOT/"tools/archify/extract-svg.mjs")]
    for offset,d in enumerate(items,start+1):
        ir=ir_for(d); ir_path,html_path,svg_path=diagram_paths(d,ir)
        ir_path.parent.mkdir(parents=True,exist_ok=True)
        ir_path.write_text(json.dumps(ir,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
        typ=ir["diagram_type"]
        print(f"{offset}/{total} {d.slug}: validate",flush=True)
        run_checked(archify+["validate",typ,str(ir_path),"--quality","showcase"])
        print(f"{offset}/{total} {d.slug}: deliver",flush=True)
        run_checked(archify+["deliver",typ,str(ir_path),str(html_path),"--quality","showcase"])
        print(f"{offset}/{total} {d.slug}: visual-check",flush=True)
        visual=run_checked(archify+["visual-check",str(html_path),"--json"])
        report=json.loads(visual)
        if not report.get("ok"): raise RuntimeError(f"visual-check failed: {html_path}\n{visual}")
        print(f"{offset}/{total} {d.slug}: extract-svg",flush=True)
        run_checked(extractor+[str(html_path),str(svg_path)])
        for sidecar in ir_path.parent.glob(f"{d.slug}.visual-check.*"):
            sidecar.unlink()
        print(f"delivered {offset}/{total} {typ} {d.slug}: showcase=9/9 visual=pass svg=ok",flush=True)


def cmd_freeze_replacements():
    diagrams=diagram_inventory()
    if not diagrams:
        raise RuntimeError("no Mermaid or high-confidence ASCII diagrams to freeze")
    items=[]
    for d in diagrams:
        text=d.doc.read_text(encoding="utf-8")
        original=text[d.start:d.end]
        generated_ir=ir_for(d)
        ir_path,html_path,svg_path=diagram_paths(d,generated_ir)
        for artifact in (ir_path,html_path,svg_path):
            if not artifact.is_file() or artifact.stat().st_size==0:
                raise RuntimeError(f"missing Archify artifact: {artifact}")
        delivered_ir=json.loads(ir_path.read_text(encoding="utf-8"))
        items.append({
            "doc": str(d.doc.relative_to(ROOT)),
            "start": d.start,
            "end": d.end,
            "kind": d.kind,
            "slug": d.slug,
            "original": original,
            "original_sha256": hashlib.sha256(original.encode("utf-8")).hexdigest(),
            "replacement": markdown_block(d,delivered_ir),
            "artifacts": [str(path.relative_to(ROOT)) for path in (ir_path,html_path,svg_path)],
        })
    # Descending offsets are mandatory within each document: replacing a block at
    # a higher offset cannot invalidate any still-pending lower offset.
    items.sort(key=lambda item: (item["doc"], -item["start"]))
    payload={"schema_version": 1, "root": str(ROOT), "count": len(items), "items": items}
    temporary=REPLACEMENT_PLAN.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    temporary.replace(REPLACEMENT_PLAN)
    print(f"froze replacements={len(items)} plan={REPLACEMENT_PLAN}")


def load_replacement_plan():
    if not REPLACEMENT_PLAN.is_file():
        raise RuntimeError(f"missing frozen replacement plan; run freeze-replacements first: {REPLACEMENT_PLAN}")
    payload=json.loads(REPLACEMENT_PLAN.read_text(encoding="utf-8"))
    if payload.get("schema_version")!=1 or payload.get("root")!=str(ROOT):
        raise RuntimeError(f"invalid frozen replacement plan: {REPLACEMENT_PLAN}")
    items=payload.get("items")
    if not isinstance(items,list) or payload.get("count")!=len(items):
        raise RuntimeError(f"invalid replacement count in {REPLACEMENT_PLAN}")
    expected=sorted(items,key=lambda item:(item["doc"],-item["start"]))
    if items!=expected:
        raise RuntimeError("frozen replacements are not ordered by document and descending offset")
    return items


def cmd_replace(start: int, limit: int):
    plan=load_replacement_plan()
    items=plan[start:start+limit]
    by_doc={}
    for item in items:
        by_doc.setdefault(ROOT/item["doc"],[]).append(item)
    replaced=0; skipped=0
    for doc,replacements in by_doc.items():
        text=doc.read_text(encoding="utf-8")
        changed=False
        for item in replacements:
            original=item["original"]
            replacement=item["replacement"]
            if hashlib.sha256(original.encode("utf-8")).hexdigest()!=item["original_sha256"]:
                raise RuntimeError(f"corrupt frozen original: {item['doc']}:{item['start']}")
            for artifact in item["artifacts"]:
                path=ROOT/artifact
                if not path.is_file() or path.stat().st_size==0:
                    raise RuntimeError(f"missing Archify artifact: {path}")
            begin=item["start"]; end=item["end"]
            if text[begin:end]==original:
                text=text[:begin]+replacement+text[end:]
                changed=True; replaced+=1
                print(f"replaced {item['kind']} {item['slug']} in {item['doc']}")
            elif text.count(replacement)==1 and original not in text:
                # Lower-offset replacements can shift an already-applied higher
                # block on a full-batch retry, so identify the unique frozen
                # replacement rather than relying on its former absolute offset.
                skipped+=1
                print(f"already replaced {item['slug']} in {item['doc']}")
            else:
                raise RuntimeError(
                    f"frozen source mismatch: {item['doc']}:{begin}-{end}; "
                    "the document changed after the replacement plan was created"
                )
        if changed:
            doc.write_text(text,encoding="utf-8",newline="\n")
    print(f"replaced batch {start+1}-{start+len(items)} of {len(plan)} changed={replaced} already={skipped}")


def frozen_fence_body(original: str) -> str:
    m=re.search(r"(?s)\A```[^\n]*\n(.*?)\n```[ \t]*\Z",original)
    if not m: raise RuntimeError("frozen original is not a single fenced block")
    return m.group(1)


def find_block_span(text: str, slug: str) -> tuple[int, int]:
    """Locate an already inserted diagram block by slug.

    Structural lookup keeps the refresh idempotent: an interrupted run that wrote a
    document but not the plan is still recognised on the next attempt.
    """
    image=re.compile(r"(?m)^!\[[^\]]*\]\(diagrams/"+re.escape(slug)+r"\.svg\)$")
    matches=list(image.finditer(text))
    if len(matches)!=1:
        raise RuntimeError(f"expected exactly one embedded diagram for {slug}, found {len(matches)}")
    begin=matches[0].start()
    lines=text[begin:].splitlines(keepends=True)
    consumed=0
    seen_caption=False
    for index,line in enumerate(lines):
        stripped=line.strip()
        if index==0 or not stripped:
            consumed+=len(line); continue
        if not seen_caption and stripped.startswith("**") and f"diagrams/{slug}.html" in stripped:
            seen_caption=True; consumed+=len(line); continue
        if seen_caption and stripped.startswith("- "):
            consumed+=len(line); continue
        break
    end=begin+len(text[begin:begin+consumed].rstrip("\n"))
    return begin,end


def shard_of(doc: str, shards: int) -> int:
    return int(hashlib.sha256(doc.encode("utf-8")).hexdigest(),16)%shards


def cmd_refresh(start: int, limit: int, shard: int = 0, shards: int = 1):
    """Rebuild artifacts and Markdown blocks for already migrated diagrams.

    Slugs stay frozen so artifact paths never move, and each block is located by its
    stored replacement text rather than a stale offset. The plan is rewritten after
    every document so an interrupted run resumes without double editing.
    """
    plan=load_replacement_plan()
    if shards>1:
        plan=[item for item in plan if shard_of(item["doc"],shards)==shard]
    items=plan[start:start+limit]
    archify=["node",str(ROOT/"tools/archify/bin/archify.mjs")]
    extractor=["node",str(ROOT/"tools/archify/extract-svg.mjs")]
    by_doc={}
    for item in items: by_doc.setdefault(ROOT/item["doc"],[]).append(item)
    refreshed=0
    for doc,entries in by_doc.items():
        text=doc.read_text(encoding="utf-8")
        for item in entries:
            offset,block_end=find_block_span(text,item["slug"])
            title=nearest_heading(text,offset,f"{doc.stem} diagram")
            diagram=Diagram(doc,offset,block_end,frozen_fence_body(item["original"]),item["kind"],1,title,item["slug"])
            ir=ir_for(diagram)
            ir_path,html_path,svg_path=diagram_paths(diagram,ir)
            if str(ir_path.relative_to(ROOT))!=item["artifacts"][0]:
                raise RuntimeError(f"artifact path drift for {item['slug']}: {ir_path} != {item['artifacts'][0]}")
            typ=ir["diagram_type"]
            ir_path.parent.mkdir(parents=True,exist_ok=True)
            ir_path.write_text(json.dumps(ir,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
            print(f"{item['slug']}: validate",flush=True)
            run_checked(archify+["validate",typ,str(ir_path),"--quality","showcase"])
            print(f"{item['slug']}: deliver",flush=True)
            run_checked(archify+["deliver",typ,str(ir_path),str(html_path),"--quality","showcase"])
            print(f"{item['slug']}: visual-check",flush=True)
            visual=run_checked(archify+["visual-check",str(html_path),"--json"])
            if not json.loads(visual).get("ok"): raise RuntimeError(f"visual-check failed: {html_path}\n{visual}")
            run_checked(extractor+[str(html_path),str(svg_path)])
            for sidecar in html_path.parent.glob(f"{item['slug']}.visual-check.*"): sidecar.unlink()
            new_block=markdown_block(diagram,ir)
            text=text[:offset]+new_block+text[block_end:]
            item["replacement"]=new_block
            refreshed+=1
            print(f"refreshed {typ} {item['slug']} in {item['doc']}",flush=True)
        doc.write_text(text,encoding="utf-8",newline="\n")
    print(f"refreshed batch {start+1}-{start+len(items)} of {len(plan)} count={refreshed}")


def cmd_resync_plan():
    """Store the Markdown block currently present in each document.

    Refresh itself never writes the plan so shards can run in parallel; this single
    writer brings the frozen plan back in sync afterwards.
    """
    plan=load_replacement_plan()
    cache={}
    for item in plan:
        doc=ROOT/item["doc"]
        text=cache.setdefault(doc,doc.read_text(encoding="utf-8"))
        begin,end=find_block_span(text,item["slug"])
        item["replacement"]=text[begin:end]
    payload={"schema_version":1,"root":str(ROOT),"count":len(plan),"items":plan}
    temporary=REPLACEMENT_PLAN.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    temporary.replace(REPLACEMENT_PLAN)
    print(f"resynced plan entries={len(plan)}")


# Front-matter keys that encoded a former directory layout. Every domain now relies on
# its own index.md for the directory URL, so these stale keys are dropped.
LEGACY_FRONTMATTER_KEYS = ("parent_url", "permalink")


def visible_h1(text: str) -> tuple[int, int, str] | None:
    """Return (start, end, title) of the first H1 outside code fences."""
    fence = None
    offset = 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        marker = re.match(r"^(`{3,}|~{3,})", stripped)
        if marker:
            char = marker.group(1)[0]
            if fence is None:
                fence = char
            elif fence == char:
                fence = None
        elif fence is None:
            heading = re.match(r"^#\s+(.+?)\s*$", line)
            if heading:
                return offset, offset + len(line), heading.group(1)
        offset += len(line)
    return None


def strip_chapter_prefix(path: Path, title: str) -> str:
    """Drop a leading chapter number that merely repeats the file name.

    "01 项目概览与设计哲学" in 01-overview-and-design-philosophy.md loses the number,
    while a heading that genuinely starts with a count keeps it because the digits then
    do not match the file's own prefix.
    """
    prefix = re.match(r"^(\d{2})-", path.name)
    if not prefix:
        return title
    return re.sub(rf"^0*{int(prefix.group(1))}\s*[.、:：)-]?\s+", "", title).strip() or title


def yaml_title(value: str) -> str:
    return "title: " + yaml_quote(value)


def cmd_unify(start: int, limit: int, only: str = ""):
    """Normalize front matter and headings so every domain reads the same way.

    - drop parent_url/permalink, which pointed at a directory layout that no longer exists
    - strip a chapter number from the visible H1: the number already lives in the file name
    - keep front-matter `title` byte-identical to that H1
    """
    paths = sorted(DOCS.rglob("*.md"))
    if only:
        wanted = {line.strip() for line in Path(only).read_text(encoding="utf-8").splitlines() if line.strip()}
        paths = [p for p in paths if str(p.relative_to(ROOT)) in wanted or str(p) in wanted]
    items = paths[start:start + limit]
    changed = 0
    for path in items:
        text = path.read_text(encoding="utf-8")
        match = re.match(r"(?s)^---\n(.*?)\n---\n", text)
        if not match:
            print(f"skip (no front matter) {path.relative_to(ROOT)}")
            continue
        front, body = match.group(1), text[match.end():]
        original = text
        kept = [
            line for line in front.split("\n")
            if not any(re.match(rf"^{key}:", line) for key in LEGACY_FRONTMATTER_KEYS)
        ]
        heading = visible_h1(body)
        if heading:
            begin, end, title = heading
            cleaned = clean_text(strip_chapter_prefix(path, strip_heading_number(title)), 200)
            if cleaned and cleaned != title:
                body = body[:begin] + f"# {cleaned}\n" + body[end:]
                title = cleaned
            kept = [yaml_title(title) if re.match(r"^title:", line) else line for line in kept]
        front = "\n".join(line for line in kept if line.strip())
        text = "---\n" + front + "\n---\n" + body.lstrip("\n")
        if text != original:
            path.write_text(text, encoding="utf-8", newline="\n")
            changed += 1
            print(f"unified {path.relative_to(ROOT)}")
    print(f"unify batch {start+1}-{start+len(items)} of {len(paths)} changed={changed}")


def cmd_check():
    valid=re.compile(r"^(?:README|index|log|[0-9]{2}(?:[a-z])?-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
    problems=[]
    for p in DOCS.rglob("*.md"):
        if not valid.match(p.name): problems.append(f"bad filename: {p.relative_to(ROOT)}")
        raw=p.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"): problems.append(f"UTF-8 BOM: {p.relative_to(ROOT)}")
        text=raw.decode("utf-8")
        if not text.startswith("---\n"): problems.append(f"missing frontmatter: {p.relative_to(ROOT)}")
        if markdown_h1_count(text)!=1: problems.append(f"H1 count != 1: {p.relative_to(ROOT)}")
    inv=diagram_inventory()
    if inv: problems.append(f"unmigrated diagrams: {len(inv)}")
    for problem in problems: print(problem)
    print(f"checked markdown={len(list(DOCS.rglob('*.md')))} problems={len(problems)}")
    return 1 if problems else 0


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("phase",choices=["plan","rename","rewrite-links","rewrite-opencode-links","normalize","generate","compile","render","visual","deliver","freeze-replacements","replace","refresh","resync-plan","unify","check"])
    ap.add_argument("--start",type=int,default=0)
    ap.add_argument("--shard",type=int,default=0)
    ap.add_argument("--shards",type=int,default=1)
    ap.add_argument("--only",default="")
    ap.add_argument("--limit",type=int,default=20)
    args=ap.parse_args()
    if args.limit<1 or args.limit>20: ap.error("--limit must be 1..20")
    if args.phase=="plan": cmd_plan()
    elif args.phase=="rename": cmd_rename(args.start,args.limit)
    elif args.phase=="rewrite-links": cmd_rewrite_links(args.start,args.limit)
    elif args.phase=="rewrite-opencode-links": cmd_rewrite_opencode_links(args.start,args.limit)
    elif args.phase=="normalize": cmd_normalize(args.start,args.limit)
    elif args.phase=="generate": cmd_generate(args.start,args.limit)
    elif args.phase=="compile": cmd_compile(args.start,args.limit)
    elif args.phase=="render": cmd_render(args.start,args.limit)
    elif args.phase=="visual": cmd_visual(args.start,args.limit)
    elif args.phase=="deliver": cmd_deliver(args.start,args.limit)
    elif args.phase=="freeze-replacements": cmd_freeze_replacements()
    elif args.phase=="replace": cmd_replace(args.start,args.limit)
    elif args.phase=="refresh": cmd_refresh(args.start,args.limit,args.shard,args.shards)
    elif args.phase=="resync-plan": cmd_resync_plan()
    elif args.phase=="unify": cmd_unify(args.start,args.limit,args.only)
    else: return cmd_check()
    return 0

if __name__=="__main__": sys.exit(main())
