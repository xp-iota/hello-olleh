#!/usr/bin/env python3
"""合并后重写全仓对 docs/hello-dsh 的交叉引用。

用 .mergemap.json（由 merge_dsh_docs.py 产出）里的两张表：
  file: 旧文件名 -> 新文件名
  sec : 旧章节号 -> (新篇号, 新章节号, 新文件名)

脚本是状态感知的：迁移映射存在时只应用一次；映射已清理且文档已经是最终
11 篇布局时安全退出。既不是原始迁移态也不是最终态时 fail loud。

规则与两个必须防的坑：
  1. 先屏蔽 `](../hello-cordis/...)` 这类**指向 cordis 文档集**的链接 ——
     否则 cordis 自己的 `§ N.M` 会被 DSH 的映射表误改。
  2. 链接形式 `[NN( 篇)?( § N.M)?](旧文件名)` 改写完之后**立刻屏蔽**改写结果，
     再处理剩下的裸 `§ N.M` —— 否则新章节号（可能正好等于另一篇的旧章节号）
     会被二次映射。
"""
import glob
import json
import os
import re

MAP_PATH = '.mergemap.json'
DSH_DIR = 'docs/hello-dsh'
FINAL_NAMES = {
    '01-项目概览.md',
    '02-代码结构地图.md',
    '03-能力缝与服务全景.md',
    '04-扩展与生态.md',
    '05-启动与Cordis落地.md',
    '06-Agent循环与会话日志.md',
    '07-请求管线-LLM工具与提示.md',
    '08-执行侧服务-文件Shell沙箱子代理压缩.md',
    '09-宿主与运行面-Web网关编排存储类型.md',
    '10-测试与工程实践.md',
    '11-关键调用链速查.md',
}


def current_doc_names():
    return {
        os.path.basename(path)
        for path in glob.glob(os.path.join(DSH_DIR, '*.md'))
        if os.path.basename(path) != 'README.md'
    }


def load_pending_map():
    if not os.path.exists(MAP_PATH):
        if current_doc_names() == FINAL_NAMES:
            print('already rewritten: DSH docs are in the final 11-chapter layout')
            return None
        raise SystemExit(
            'cannot rewrite: .mergemap.json is missing and DSH docs are not in the final '
            '11-chapter layout; run scripts/merge_dsh_docs.py first'
        )

    with open(MAP_PATH, encoding='utf-8') as stream:
        mapping = json.load(stream)
    if mapping.get('rewritten') is True:
        print('already rewritten: .mergemap.json is marked complete')
        return None
    if not isinstance(mapping.get('sec'), dict) or not isinstance(mapping.get('file'), dict):
        raise SystemExit('cannot rewrite: .mergemap.json does not contain sec/file maps')
    return mapping


MAP = load_pending_map()
if MAP is None:
    raise SystemExit(0)

SEC, FILE = MAP['sec'], MAP['file']
OTHER = sorted(glob.glob('dsh-example/*/README.md')) + \
    ['dsh-example/README.md', 'README.md']

CORDIS_LINK = re.compile(r'\[[^\]\[]*\]\(\.\./hello-cordis/[^)]*\)')
OLD_FILES = '|'.join(re.escape(name) for name in sorted(FILE, key=len, reverse=True))
LINK = re.compile(r'\[(\d{2})(\s*篇)?(\s*§\s*(\d+\.\d+))?\]\(((?:\.\./)*(?:docs/hello-dsh/)?)(' + OLD_FILES + r')(#[^)]*)?\)')
DSH_LABEL = re.compile(r'\[DSH (\d{2})( 篇)?(\s*§\s*(\d+\.\d+))?\]\(((?:\.\./)*(?:docs/hello-dsh/)?)(' + OLD_FILES + r')(#[^)]*)?\)')
BARE_SEC = re.compile(r'§\s*(\d+\.\d+)')


class Vault:
    """把已经处理好的片段换成占位符，避免后续 pass 二次改写。"""

    def __init__(self, tag):
        self.tag = tag
        self.items = []

    def hold(self, raw):
        self.items.append(raw)
        return '\x00%s%d\x00' % (self.tag, len(self.items) - 1)

    def release(self, text):
        for i, raw in enumerate(self.items):
            text = text.replace('\x00%s%d\x00' % (self.tag, i), raw)
        return text


def rewrite_link(m, vault, dsh_prefix=''):
    label_num, pian, _, sec, prefix, fname, anchor = m.groups()
    new_file = FILE.get(fname, fname)
    if sec and sec in SEC:
        new_num, new_sec, new_file = SEC[sec]
        body = '[%s%s § %s]' % (dsh_prefix, new_num + (pian or ''), new_sec)
    else:
        new_num = new_file[:2]
        body = '[%s%s]' % (dsh_prefix, new_num + (pian or ''))
    return vault.hold('%s(%s%s%s)' % (body, prefix, new_file, anchor or ''))


def process(path, remap_bare):
    text = open(path, encoding='utf-8').read()
    original = text
    cordis = Vault('CORDIS')
    text = CORDIS_LINK.sub(lambda m: cordis.hold(m.group(0)), text)

    done = Vault('DONE')
    text = DSH_LABEL.sub(lambda m: rewrite_link(m, done, 'DSH '), text)
    text = LINK.sub(lambda m: rewrite_link(m, done), text)
    if remap_bare:
        text = BARE_SEC.sub(lambda m: '§ ' + (SEC[m.group(1)][1] if m.group(1) in SEC else m.group(1)), text)
    for old, new in FILE.items():
        text = text.replace(old, new)

    text = done.release(text)
    text = cordis.release(text)
    if text != original:
        open(path, 'w', encoding='utf-8').write(text)
        print('rewrote', path)


for path in sorted(glob.glob(os.path.join(DSH_DIR, '*.md'))):
    process(path, remap_bare=True)
for path in OTHER:
    if os.path.exists(path):
        process(path, remap_bare=False)

MAP['rewritten'] = True
with open(MAP_PATH, 'w', encoding='utf-8') as stream:
    json.dump(MAP, stream, ensure_ascii=False, indent=1)
    stream.write('\n')
print('done')
