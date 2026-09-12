#!/usr/bin/env python3
"""把 markdown 里的 archify 链接块改写为「内联 SVG 图片 + 卡片要点 + 交互版链接」。

archify 的交付物是整页 HTML，链接形式在 Markdown 里看不到图。这个脚本把它换成
由 extract-svg.mjs 抽出的自包含 SVG（可直接渲染），并把 IR 里 cards 承载的正文
要点平铺到图下，使信息在纯 Markdown 阅读环境中也完整。

用法: python3 tools/archify/inline-svg-into-md.py [md路径 ...]
不传路径则处理 docs/hello-cordis 与 docs/hello-deepseek-harness 下全部 md。
"""
import glob
import json
import os
import re
import sys

# 之前 replace-mermaid.py 写入的两行引用块
BLOCK = re.compile(
    r'> 📐 \*\*\[(?P<title>[^\]]+)\]\(diagrams/(?P<slug>[^)]+)\.html\)\*\* — archify (?P<type>\w+) 图[^\n]*\n'
    r'> IR 源：\[`diagrams/(?P=slug)\.(?P=type)\.json`\]\([^)]+\)'
)


def build(md_dir: str, title: str, slug: str, typ: str) -> str:
    ir_path = os.path.join(md_dir, 'diagrams', f'{slug}.{typ}.json')
    cards = json.load(open(ir_path, encoding='utf-8')).get('cards') or []

    lines = [
        f'![{title}](diagrams/{slug}.svg)',
        '',
        f'**{title}** — [交互版](diagrams/{slug}.html)（明暗主题 / 缩放 / 关系追踪 / 导出）'
        f' · [IR 源](diagrams/{slug}.{typ}.json)',
    ]
    if cards:
        lines.append('')
        for c in cards:
            items = ' · '.join(c.get('items') or [])
            lines.append(f'- **{c["title"]}**：{items}')
    return '\n'.join(lines)


def process(md: str) -> int:
    md_dir = os.path.dirname(md)
    raw = open(md, encoding='utf-8', newline='').read()
    n = 0

    def repl(m: 're.Match') -> str:
        nonlocal n
        svg = os.path.join(md_dir, 'diagrams', f'{m.group("slug")}.svg')
        if not os.path.exists(svg):
            print(f'  ✗ 缺少 {svg}')
            return m.group(0)
        n += 1
        return build(md_dir, m.group('title'), m.group('slug'), m.group('type'))

    out = BLOCK.sub(repl, raw)
    if n:
        open(md, 'w', encoding='utf-8', newline='').write(out)
    return n


def main() -> int:
    targets = sys.argv[1:] or sorted(
        glob.glob('docs/hello-cordis/*.md') + glob.glob('docs/hello-deepseek-harness/*.md')
    )
    total = 0
    for md in targets:
        n = process(md)
        total += n
        print(f'  {os.path.basename(md):<52} {n} 处')
    print(f'共改写 {total} 处')
    return 0


if __name__ == '__main__':
    sys.exit(main())
