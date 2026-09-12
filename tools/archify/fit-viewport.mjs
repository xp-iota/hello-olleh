// 按目标 viewBox 等比重标定 sequence 的 y 坐标，使消息落在 [175, H-95] 可读区间内。
// 用法: node tools/archify/fit-viewport.mjs <spec.json> <W> <H>
import { readFileSync, writeFileSync } from 'node:fs';

const [file, W, H] = process.argv.slice(2);
const w = Number(W), h = Number(H);
const d = JSON.parse(readFileSync(file, 'utf8'));
d.meta.viewBox = [w, h];

if (d.diagram_type === 'sequence') {
  const ys = d.messages.map((m) => m.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const top = 175, bottom = h - 95;
  const map = (y) => Math.round(top + ((y - lo) / (hi - lo || 1)) * (bottom - top));
  for (const m of d.messages) m.y = map(m.y);
  for (const a of d.activations ?? []) { a.from = map(a.from); a.to = map(a.to); }
  for (const s of d.segments ?? []) { s.from = map(s.from); s.to = map(s.to); }
  // 分带边界不得落在任何消息 y 上（±12px）
  const msgY = d.messages.map((m) => m.y);
  for (const s of d.segments ?? []) {
    for (const k of ['from', 'to']) {
      while (msgY.some((y) => Math.abs(s[k] - y) < 12)) s[k] += k === 'from' ? -12 : 12;
    }
  }
}
writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
console.log(`${file.split('/').pop()} -> viewBox [${w}, ${h}]`);
