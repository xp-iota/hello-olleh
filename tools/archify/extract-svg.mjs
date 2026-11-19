#!/usr/bin/env node
// 从 archify 交付的 HTML 中提取一张自包含 SVG。
//
// archify 的内联 SVG 只带 class，全部颜色来自 HTML 里 18 万字节的 <style>。
// 直接抽出来会没有样式，所以这里用 Chromium 真实渲染页面，把 getComputedStyle
// 的结果写成 presentation 属性，产出零 CSS 依赖的 SVG —— 可直接在 Markdown 里
// 用 ![](x.svg) 展示。
//
// 用法: node tools/archify/extract-svg.mjs <artifact.html> [out.svg] [--detail full]
// 可选 --detail full（或环境变量 ARCHIFY_SVG_DETAIL=full）：冻结前揭示 fine 层
// （sequence 的 note、节点的 tag；read 态默认隐藏它们）；不设则保持交付页默认的 read 态。
// 实现上除置 container 的 data-detail-level 外，还给 fine/context 元素写 inline opacity：
// 交付页的 renderControls() 会在相机初始化时把 level 重置回 read，单改属性会被覆盖。

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from './bin/visual-check.mjs';

// 与 visual-check 共用同一套探测链（ARCHIFY_CHROME → 平台固定路径 → PATH），
// 免得这里单独硬编码 /usr/bin/chromium 而在 macOS 上直接 ENOENT。
const CHROME = findChrome();
if (!CHROME) {
  console.error('找不到 Chrome/Chromium。请设置 ARCHIFY_CHROME 指向可执行文件。');
  process.exit(1);
}

// --detail <level> 优先于环境变量；两者都不设则冻结 read 态
const cliArgs = process.argv.slice(2);
const detailIdx = cliArgs.indexOf('--detail');
const detailFlag = detailIdx >= 0 ? (cliArgs[detailIdx + 1] || '') : '';
if (detailIdx >= 0) cliArgs.splice(detailIdx, 2);
const DETAIL_LEVEL = detailFlag || process.env.ARCHIFY_SVG_DETAIL || '';

// 需要固化到属性上的 SVG 表现属性
const PROPS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'opacity', 'color', 'vector-effect', 'paint-order', 'mix-blend-mode',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'text-anchor', 'dominant-baseline', 'text-decoration',
];

const INJECT = `
<script>
window.addEventListener('load', () => {
  setTimeout(() => {
    const PROPS = ${JSON.stringify(PROPS)};
    const TEXT_PROPS = ['font-family','font-size','font-weight','font-style','letter-spacing','text-anchor','dominant-baseline','text-decoration'];
    const svg = document.querySelector('.diagram-container svg') || document.querySelector('svg');
    if (!svg) { document.title = 'ARCHIFY_NO_SVG'; return; }

    // 可选：冻结前揭示 fine 层（read 态隐藏 note/tag，静态图会丢注解）
    const DETAIL = ${JSON.stringify(DETAIL_LEVEL)};
    if (DETAIL) {
      const container = document.querySelector('.diagram-container');
      if (container) container.setAttribute('data-detail-level', DETAIL);
      svg.querySelectorAll('[data-detail="fine"], [data-detail="context"]').forEach((el) => {
        el.style.transition = 'none';
        el.style.opacity = '1';
      });
    }

    // 只移除透明命中区；[data-detail] / [data-detail-anchor] 承载的是节点标签，必须保留
    svg.querySelectorAll('[data-legend-hit]').forEach((n) => n.remove());

    const all = [svg, ...svg.querySelectorAll('*')];

    // 第一遍：把计算样式固化成 presentation 属性。
    // 必须先整体做完再清理属性，否则父元素的 data-* 一被删，
    // 后代选择器（如 svg [data-legend-count-badge] rect）就对后续元素失配。
    for (const el of all) {
      const cs = getComputedStyle(el);
      const isTextish = ['text', 'tspan', 'textPath'].includes(el.tagName);
      for (const p of PROPS) {
        if (TEXT_PROPS.includes(p) && !isTextish) continue;
        const v = cs.getPropertyValue(p).trim();
        if (!v || v === 'normal' || v === 'auto') continue;
        if (p === 'text-decoration' && v.startsWith('none')) continue;
        el.setAttribute(p, v);
      }
    }

    // 第二遍：清掉只服务于交互与动画的属性
    for (const el of all) {
      el.removeAttribute('class');
      el.removeAttribute('style');
      for (const a of [...el.attributes]) {
        if (/^(data-|aria-)/.test(a.name) || ['role', 'tabindex'].includes(a.name)) {
          el.removeAttribute(a.name);
        }
      }
    }

    const vb = (svg.getAttribute('viewBox') || '0 0 1200 600').split(/\\s+/).map(Number);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(vb[2]));
    svg.setAttribute('height', String(vb[3]));
    // 白底，避免深色阅读器下透明背景导致文字看不见
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(vb[0])); bg.setAttribute('y', String(vb[1]));
    bg.setAttribute('width', String(vb[2])); bg.setAttribute('height', String(vb[3]));
    bg.setAttribute('fill', '#ffffff');
    svg.insertBefore(bg, svg.firstChild);

    document.documentElement.innerHTML =
      '<head></head><body><!--ARCHIFY_SVG_BEGIN-->' + svg.outerHTML + '<!--ARCHIFY_SVG_END--></body>';
  }, 600);
});
</script>
`;

function run(htmlPath) {
  const src = readFileSync(htmlPath, 'utf8');
  // 强制浅色主题，保证抽出的静态图在任何阅读器下都可读
  const patched = src
    .replace(/<html([^>]*)>/i, '<html$1 data-theme="light">')
    .replace('</body>', `${INJECT}</body>`);

  const dir = mkdtempSync(path.join(tmpdir(), 'archify-svg-'));
  const tmp = path.join(dir, 'page.html');
  writeFileSync(tmp, patched);

  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=2400,1600',
      '--virtual-time-budget=8000',
      '--dump-dom', `file://${tmp}`,
    ];
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', () => {
      rmSync(dir, { recursive: true, force: true });
      const i = out.indexOf('<!--ARCHIFY_SVG_BEGIN-->');
      const j = out.indexOf('<!--ARCHIFY_SVG_END-->');
      if (i < 0 || j < 0) {
        reject(new Error(`未能从 ${path.basename(htmlPath)} 提取 SVG。stderr: ${err.slice(0, 300)}`));
        return;
      }
      resolve(out.slice(i + '<!--ARCHIFY_SVG_BEGIN-->'.length, j).trim());
    });
  });
}

const [htmlPath, outPath] = cliArgs;
if (!htmlPath) {
  console.error('用法: node tools/archify/extract-svg.mjs <artifact.html> [out.svg]');
  process.exit(2);
}
const target = outPath || htmlPath.replace(/\.html$/, '.svg');
const svg = await run(htmlPath);
writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
console.log(`${path.basename(target)}  ${Buffer.byteLength(svg)} bytes`);
