#!/usr/bin/env python3
"""Jekyll 构建前的静态校验（本 pod 装不了 Ruby/Jekyll 时的替代闸门）。

检查项：
  1. 每个带 frontmatter 的 md 都由标准 YAML 解析器完整解析，且 layout 存在。
  2. Liquid：`{% raw %}` / `{% endraw %}` 配对；没有裸 `{{ ... }}`。
  3. ``` 代码围栏成对。
  4. 无 UTF-8 BOM（BOM 会让 Jekyll 的 frontmatter 解析静默失败 → 404）。

YAML 解析器来自 pages 精确钉版的 npm `yaml` 包。先在 pages/ 执行 `npm install`；
缺少解析器会让本检查 fail loud，而不是退回不完整的行级猜测。
"""
import glob
import json
import os
import re
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
YAML_MODULE = os.path.normpath(os.path.join(SCRIPT_DIR, '../pages/node_modules/yaml'))
LAYOUTS = {os.path.splitext(os.path.basename(p))[0]
           for p in glob.glob(os.path.join(ROOT, 'pages/_layouts/*.html'))}

TARGETS = sorted(set(
    glob.glob(os.path.join(ROOT, 'docs/**/*.md'), recursive=True) +
    glob.glob(os.path.join(ROOT, 'pages/*.md')) +
    [os.path.join(ROOT, 'README.md')]))

YAML_DRIVER = r"""
const fs = require('node:fs')
const YAML = require(process.argv[1])
const entries = JSON.parse(fs.readFileSync(0, 'utf8'))
const results = entries.map(({ path, source }) => {
  try {
    const document = YAML.parseDocument(source, {
      schema: 'core',
      prettyErrors: false,
      uniqueKeys: true,
      maxAliasCount: 100,
    })
    const errors = document.errors.map((error) => error.message)
    if (errors.length) return { path, errors }
    const value = document.toJS({ maxAliasCount: 100 })
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { path, errors: ['frontmatter 顶层必须是 YAML mapping'] }
    }
    return { path, errors: [], value }
  } catch (error) {
    return { path, errors: [String(error && error.message || error)] }
  }
})
process.stdout.write(JSON.stringify(results))
"""


def parse_frontmatters(entries):
    if not entries:
        return []
    try:
        result = subprocess.run(
            ['node', '-e', YAML_DRIVER, YAML_MODULE],
            input=json.dumps(entries, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        return [{'path': '(YAML parser)', 'errors': ['找不到 node；无法运行 pages 的 YAML 解析器']}]
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        return [{
            'path': '(YAML parser)',
            'errors': [
                '无法加载 pages/node_modules/yaml；请先执行 `cd pages && npm install`'
                + (': ' + detail if detail else '')
            ],
        }]
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        return [{'path': '(YAML parser)', 'errors': ['解析器返回了非法 JSON: %s' % error]}]


problems = []
frontmatters = []
for path in TARGETS:
    try:
        raw = open(path, 'rb').read()
    except FileNotFoundError:
        problems.append((path, '文件不存在'))
        continue
    if raw.startswith(b'\xef\xbb\xbf'):
        problems.append((path, 'UTF-8 BOM'))
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as error:
        problems.append((path, '不是合法 UTF-8: %s' % error))
        continue

    if text.startswith('---\n'):
        end = text.find('\n---\n', 3)
        if end < 0:
            problems.append((path, 'frontmatter 未闭合'))
        else:
            frontmatters.append({'path': path, 'source': text[4:end]})

    if text.count('{% raw %}') != text.count('{% endraw %}'):
        problems.append((path, '{%% raw %%}/{%% endraw %%} 不配对 (%d vs %d)'
                         % (text.count('{% raw %}'), text.count('{% endraw %}'))))

    guarded = re.sub(r'\{% raw %\}.*?\{% endraw %\}', '', text, flags=re.S)
    for m in re.finditer(r'\{\{\s*[^}]*\}\}', guarded):
        token = m.group(0)
        if "relative_url" in token or "site." in token or "page." in token or "'" in token:
            continue  # pages/ 里真正要用的 Liquid
        problems.append((path, '裸 Liquid 变量 %s（应包 {%% raw %%}）' % token))

    if text.count('\n```') % 2:
        problems.append((path, '``` 代码围栏可能不成对（%d 处）' % text.count('\n```')))

for parsed in parse_frontmatters(frontmatters):
    path = parsed['path']
    for error in parsed.get('errors', []):
        problems.append((path, 'frontmatter YAML 无效: %s' % error))
    value = parsed.get('value')
    if not isinstance(value, dict):
        continue
    layout = value.get('layout')
    if layout is not None and not isinstance(layout, str):
        problems.append((path, 'layout 必须是字符串'))
    elif layout and layout not in LAYOUTS:
        problems.append((path, 'layout "%s" 不存在' % layout))

for path, why in problems:
    print('PROBLEM  %s: %s' % (path, why))
print('checked %d markdown files, %d problems' % (len(TARGETS), len(problems)))
sys.exit(1 if problems else 0)
