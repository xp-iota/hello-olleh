#!/usr/bin/env python3
"""把 markdown 里指定序号的 mermaid 块替换为 archify 产物链接。

用法:
    python3 tools/archify/replace-mermaid.py <md路径> <序号:slug:类型> [更多...]

序号是该文件中 mermaid 块的当前 1-based 位置。多个替换会按序号倒序执行，
因此传入的序号都以「替换前」的原始编号为准。标题从 IR 的 meta.title 读取。
"""
import json
import os
import re
import sys

FENCE = re.compile(r"```mermaid\n.*?\n```", re.S)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    md = sys.argv[1]
    items = []
    for arg in sys.argv[2:]:
        idx, slug, typ = arg.split(":")
        items.append((int(idx), slug, typ))

    docset = os.path.dirname(md)
    raw = open(md, encoding="utf-8", newline="").read()

    for idx, slug, typ in sorted(items, reverse=True):
        ir = os.path.join(docset, "diagrams", f"{slug}.{typ}.json")
        html = os.path.join(docset, "diagrams", f"{slug}.html")
        if not os.path.exists(ir):
            print(f"  ✗ 缺少 IR: {ir}")
            return 1
        if not os.path.exists(html):
            print(f"  ✗ 缺少产物: {html}")
            return 1

        title = json.load(open(ir, encoding="utf-8"))["meta"]["title"]
        block = (
            f"> 📐 **[{title}](diagrams/{slug}.html)** — archify {typ} 图"
            "（明暗主题 / 缩放 / 关系追踪 / 导出）\n"
            f"> IR 源：[`diagrams/{slug}.{typ}.json`](diagrams/{slug}.{typ}.json)"
        )

        blocks = list(FENCE.finditer(raw))
        if len(blocks) < idx:
            print(f"  ✗ 第 {idx} 个 mermaid 块不存在（共 {len(blocks)} 个）")
            return 1
        m = blocks[idx - 1]
        raw = raw[: m.start()] + block + raw[m.end() :]
        print(f"  #{idx} -> {slug}")

    open(md, "w", encoding="utf-8", newline="").write(raw)
    print(f"  {os.path.basename(md)} 剩余 mermaid: {len(FENCE.findall(raw))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
