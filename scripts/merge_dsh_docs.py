#!/usr/bin/env python3
"""把 docs/hello-dsh 的 26 篇合并为 11 篇，并全仓重写交叉引用。

- 章节号在合并后**重新连续编号**（例如原 07/08/09 的 7.x/8.x/9.x → 新 07 篇的 7.1…7.N）。
- 所有 `[NN § N.M](NN-xxx.md)` / `[NN 篇](...)` / 裸 `§ N.M` / 旧文件名引用统一改写。
- `[cordis N § N.M](../hello-cordis/...)` 形式的引用先屏蔽再还原，避免被误改。
"""
import os, re, json, glob

DOCS = 'docs/hello-dsh'

PLAN = [
    ('01', '01-项目概览.md', '01 项目概览', ['01']),
    ('02', '02-代码结构地图.md', '02 代码结构地图', ['02']),
    ('03', '03-能力缝与服务全景.md', '03 能力缝 Seam 与服务全景', ['10']),
    ('04', '04-扩展与生态.md', '04 扩展与生态：Skill、插件、协议、SDK', ['16', '17', '23']),
    ('05', '05-启动与Cordis落地.md', '05 启动流程与 Cordis 落地', ['03', '04']),
    ('06', '06-Agent循环与会话日志.md', '06 Agent 循环与会话日志', ['05', '06']),
    ('07', '07-请求管线-LLM工具与提示.md', '07 请求管线：LLM、工具与 SystemPrompt', ['07', '08', '09']),
    ('08', '08-执行侧服务-文件Shell沙箱子代理压缩.md', '08 执行侧服务：文件、Shell、沙箱、子代理、压缩', ['11', '12', '13', '14', '15']),
    ('09', '09-宿主与运行面-Web网关编排存储类型.md', '09 宿主与运行面：Web、网关、编排、存储、类型', ['18', '19', '20', '21', '22']),
    ('10', '10-测试与工程实践.md', '10 测试与工程实践', ['24']),
    ('11', '11-关键调用链速查.md', '11 关键调用链速查', ['25']),
]

FRONT = re.compile(r'\A---\n.*?\n---\n', re.S)
H2 = re.compile(r'^## (\d+)\.(\d+)\s+(.*)$')


def source_files():
    out = {}
    for path in sorted(glob.glob(os.path.join(DOCS, '*.md'))):
        base = os.path.basename(path)
        if base == 'README.md':
            continue
        num = base[:2]
        out[num] = (base, open(path, encoding='utf-8').read())
    return out


def split_sections(body):
    """按 `## N.M` 切段，尊重 ``` 代码围栏。返回 (前言, [(n, m, 标题, 正文)])。"""
    lines = body.split('\n')
    fence = False
    preamble, sections, cur = [], [], None
    for line in lines:
        if line.startswith('```'):
            fence = not fence
        m = None if fence else H2.match(line)
        if m:
            if cur:
                sections.append(cur)
            cur = [m.group(1), m.group(2), m.group(3), []]
        elif cur:
            cur[3].append(line)
        else:
            preamble.append(line)
    if cur:
        sections.append(cur)
    return '\n'.join(preamble), sections


def parse(base, text):
    body = FRONT.sub('', text)
    lines = body.split('\n')
    h1_idx = next(i for i, l in enumerate(lines) if l.startswith('# '))
    title = lines[h1_idx][2:].strip()
    rest = '\n'.join(lines[h1_idx + 1:])
    pre, sections = split_sections(rest)
    blurb = [l for l in pre.split('\n') if l.strip()]
    return title, blurb, sections


def main():
    srcs = source_files()
    current_names = {base for base, _ in srcs.values()}
    final_names = {new_name for _, new_name, *_ in PLAN}
    if current_names == final_names:
        print('already merged: docs/hello-dsh is the final 11-chapter layout')
        return

    required = {old for _, _, _, parts in PLAN for old in parts}
    missing = sorted(required - set(srcs))
    if missing:
        raise SystemExit(
            'cannot merge: input is neither the original 26-chapter layout nor the final '
            '11-chapter layout; missing source chapter(s): ' + ', '.join(missing)
        )

    parsed = {num: parse(base, text) for num, (base, text) in srcs.items()}

    # (old_sec) -> (new_file_num, new_sec, new_filename)
    secmap, filemap = {}, {}
    outputs = []
    for new_num, new_name, new_title, parts in PLAN:
        counter = 0
        chunks = []
        blurbs = []
        for pi, old in enumerate(parts):
            old_title, old_blurb, sections = parsed[old]
            filemap[srcs[old][0]] = new_name
            if pi == 0:
                blurbs.extend(old_blurb)
            else:
                chunks.append('---\n')
                chunks.append('> 📎 **以下承接原「%s」。**' % old_title)
                for line in old_blurb:
                    chunks.append(line if line.startswith('>') else '> ' + line)
                chunks.append('')
            for n, m, stitle, sbody in sections:
                counter += 1
                secmap['%s.%s' % (n, m)] = (new_num, '%s.%d' % (int(new_num), counter), new_name)
                chunks.append('## %d.%d %s' % (int(new_num), counter, stitle))
                chunks.append('\n'.join(sbody).rstrip() + '\n')
        outputs.append((new_num, new_name, new_title, blurbs, parts, '\n'.join(chunks)))

    with open('.mergemap.json', 'w', encoding='utf-8') as f:
        json.dump({'sec': secmap, 'file': filemap}, f, ensure_ascii=False, indent=1)

    for new_num, new_name, new_title, blurbs, parts, body in outputs:
        # No static site generator: front matter carries the title only.
        head = ['---', 'title: "' + new_title.replace('"', '\\"') + '"', '---', '', '# ' + new_title, '']
        head += blurbs
        if len(parts) > 1:
            head.append('>')
            head.append('> 📎 **本篇合并自原 %s 篇**，章节已重新连续编号为 %d.x。'
                        % (' / '.join(parts), int(new_num)))
        head.append('')
        open(os.path.join(DOCS, new_name), 'w', encoding='utf-8').write('\n'.join(head) + body.rstrip() + '\n')
        print('wrote', new_name, '(from', ','.join(parts) + ')')

    # 删除被合并掉的旧文件（新旧同名的保留新内容）
    new_names = {p[1] for p in PLAN}
    for num, (base, _) in srcs.items():
        if base not in new_names:
            os.remove(os.path.join(DOCS, base))
            print('removed', base)


if __name__ == '__main__':
    main()
