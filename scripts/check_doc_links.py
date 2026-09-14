#!/usr/bin/env python3
"""校验仓库内 Markdown 的本地链接与 DSH 文档的 `§ N.M` 引用是否都能解析。

- 跳过 ``` 代码围栏内的内容（里面的 `x](y)` 是代码，不是链接）。
- 同时校验 HTML `<a href="...">`；仓库不使用任何静态站点生成器，因此链接必须直接指向
  真实存在的文件，不再接受依赖生成器 URL 语义的无扩展名写法。
- 跳过 `sources/` 下的上游快照目录（由 sync_repos.sh 拉取，可能不在工作副本里）。

用法：python3 scripts/check_doc_links.py [根目录]
"""
import os, re, sys, glob

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
LINK = re.compile(r'\[[^\]\[]*\]\(([^)\s]+?)(?:\s+"[^"]*")?\)')
HEAD = re.compile(r'^#{2,3} (\d+\.\d+)\b')
SEC_REF = re.compile(r'§\s*(\d+\.\d+)')
HTML_LINK = re.compile(r'<a\s[^>]*href="([^"]+)"')


def strip_fences(text):
    out, fence = [], False
    for line in text.split('\n'):
        if line.lstrip().startswith('```'):
            fence = not fence
            continue
        out.append('' if fence else line)
    return '\n'.join(out)


TARGETS = []
for pattern in ('README.md', 'docs/**/*.md', 'dsh-example/**/*.md', 'iota-example/**/*.md'):
    TARGETS += glob.glob(os.path.join(ROOT, pattern), recursive=True)
TARGETS = sorted({os.path.normpath(t) for t in TARGETS if 'node_modules' not in t})

prose, sections = {}, {}
for path in TARGETS:
    raw = open(path, encoding='utf-8').read()
    prose[path] = strip_fences(raw)
    sections[path] = {m.group(1) for m in (HEAD.match(l) for l in raw.split('\n')) if m}

bad_links, bad_secs = [], []
for path in TARGETS:
    text = prose[path]
    base = os.path.dirname(path)
    linked = set()
    for target in LINK.findall(text) + HTML_LINK.findall(text):
        if target.startswith(('http://', 'https://', 'mailto:', '#', '{{', '{%')):
            continue
        clean = target.split('#')[0].split('?')[0]
        if not clean:
            continue
        resolved = os.path.normpath(os.path.join(base, clean))
        if resolved in sections:
            linked |= sections[resolved]
        if resolved.replace(os.sep, '/').startswith('sources/'):
            continue  # 上游快照目录，可能未 clone
        if not os.path.exists(resolved):
            bad_links.append((path, target))
    if '/hello-dsh/' in path.replace(os.sep, '/'):
        own = sections[path]
        for sec in SEC_REF.findall(text):
            if sec not in own and sec not in linked:
                bad_secs.append((path, sec))

for path, target in bad_links:
    print('BROKEN LINK  %s -> %s' % (path, target))
for path, sec in sorted(set(bad_secs)):
    print('UNKNOWN SEC  %s -> § %s' % (path, sec))
print('checked %d files: %d broken links, %d unresolved section refs'
      % (len(TARGETS), len(bad_links), len(set(bad_secs))))
sys.exit(1 if bad_links or bad_secs else 0)
