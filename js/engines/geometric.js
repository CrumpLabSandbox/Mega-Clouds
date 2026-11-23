// Designed clouds: graphic-design traditions rendered with flat vector shapes on a 2D canvas.
// Every scene is a pure function of time: shapes drift (wrapping), bob, breathe and draw themselves on.
import { clamp, lerp, smooth, fract, wrap, rng, fbm2, noise2, hash, buffer, windX } from '../util.js';

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const h1 = i => fract(Math.sin(i * 127.1 + 3.7) * 43758.5453);
const TAU = Math.PI * 2;

// Time-of-day wash for flat palettes: multiply toward dusk orange, then toward night blue.
function wash(ctx, w, h, light, strength = 1) {
  const night = clamp(1 - light / 0.18), dusk = clamp(1 - Math.abs(light - 0.27) / 0.14) * (1 - night);
  if (night < 0.01 && dusk < 0.01) return;
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  if (dusk > 0.01) { ctx.fillStyle = css([255, 175, 135], dusk * 0.8 * strength); ctx.fillRect(0, 0, w, h); }
  if (night > 0.01) { ctx.fillStyle = css([50, 60, 125], night * 0.8 * strength); ctx.fillRect(0, 0, w, h); }
  ctx.restore();
}
// circles → union path
function circlesPath(list) { const p = new Path2D(); for (const [x, y, r] of list) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); } return p; }
function outlinedUnion(ctx, path, fill, line, lw) {
  if (lw > 0) { ctx.lineWidth = lw * 2; ctx.strokeStyle = line; ctx.lineJoin = 'round'; ctx.stroke(path); }
  ctx.fillStyle = fill; ctx.fill(path);
}
// cloud-like cluster of circles with a flat-ish bottom; returns [[dx,dy,r]] in units of the cloud size
function blobCloud(R, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1), x = (u - 0.5) * 1.6;
    const r = 0.28 + 0.22 * Math.sin(u * Math.PI) + R() * 0.1;
    out.push([x, -r * 0.55 - Math.sin(u * Math.PI) * 0.1, r]);
  }
  return out;
}

// ---------- 1. low-poly ----------
const SKY = [
  [0.0, [8, 12, 34], [28, 34, 70], [80, 88, 130]],
  [0.15, [40, 36, 92], [230, 120, 100], [250, 170, 150]],
  [0.3, [70, 100, 180], [255, 190, 140], [255, 228, 200]],
  [0.6, [50, 120, 214], [170, 210, 245], [255, 255, 255]],
  [1.0, [36, 108, 220], [150, 202, 250], [255, 255, 255]],
];
function skyPal(light) {
  let i = 0; while (i < SKY.length - 2 && light > SKY[i + 1][0]) i++;
  const a = SKY[i], b = SKY[i + 1], t = clamp((light - a[0]) / (b[0] - a[0]));
  return { top: mix3(a[1], b[1], t), bot: mix3(a[2], b[2], t), cloud: mix3(a[3], b[3], t) };
}
function lowpoly(S, f) {
  const { ctx, w, h, t, p } = f, pal = skyPal(p.light);
  const cols = Math.round(lerp(12, 34, p.detail)), cs = w / cols, rows = Math.ceil(h / (cs * 0.866)) + 1, rs = h / (rows - 1);
  const sc = lerp(3.2, 1.2, p.scale), cov = lerp(0.68, 0.44, p.coverage), drift = t * 0.05 * windX(p.wind), jig = lerp(0.1, 0.4, p.x3);
  const P = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols + 1; i++) {
    const edge = i === 0 || i >= cols || j === 0 || j === rows - 1;
    const jx = edge ? 0 : (noise2(i * 0.7 + t * 0.07, j * 0.9) - 0.5) * cs * jig * 2, jy = edge ? 0 : (noise2(j * 0.7 + 9, i * 0.9 + t * 0.07) - 0.5) * rs * jig * 2;
    P.push([(i - (j & 1) * 0.5) * cs + jx, j * rs + jy]);
  }
  const at = (i, j) => P[j * (cols + 2) + i];
  const dens = (x, y) => {
    const u = x / h * sc * 0.8 + drift, v = y / h * sc * 1.5;
    const n = fbm2(u, v, 4) + 0.12 * (1 - y / h) - 0.06;
    return smooth(cov, cov + 0.14, n);
  };
  const sunX = w * lerp(0.2, 0.75, p.light), sunY = h * lerp(0.75, 0.2, smooth(0, 0.6, p.light));
  ctx.lineJoin = 'round'; ctx.lineWidth = 0.6;
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i <= cols; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    const tris = (j & 1) ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
    for (let k = 0; k < 2; k++) {
      const [A, B, C] = tris[k];
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
      const dn = dens(cx, cy), dn2 = dens(cx + h * 0.03, cy - h * 0.03);
      const sky = mix3(pal.top, pal.bot, clamp(cy / h * 1.1));
      const facet = (hash(i, j, k) - 0.5) * 0.08;
      const lit = clamp(0.78 + (dn - dn2) * 0.9 + facet + (1 - cy / h) * 0.12, 0.55, 1.06);
      const sd = Math.hypot(cx - sunX, cy - sunY) / h;
      let col = mix3(sky.map(v => v * (1 + facet * 0.6)), pal.cloud.map(v => v * lit), dn);
      col = mix3(col, [255, 240, 200], Math.exp(-sd * 6) * 0.6 * (1 - dn * 0.5));
      ctx.fillStyle = ctx.strokeStyle = css(col.map(v => Math.min(255, v)));
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // faceted sun: hexagon
  ctx.fillStyle = css(p.light < 0.12 ? [230, 236, 255] : [255, 246, 214], 0.95); ctx.beginPath();
  for (let i = 0; i < 6; i++) { const an = i / 6 * TAU + t * 0.05, r = h * 0.045; ctx[i ? 'lineTo' : 'moveTo'](sunX + Math.cos(an) * r, sunY + Math.sin(an) * r); }
  ctx.fill();
}

// ---------- 2. Bauhaus ----------
function bauhaus(S, f) {
  const { ctx, w, h, t, p } = f;
  const RED = [222, 52, 40], YEL = [246, 196, 34], BLU = [28, 76, 160], BLK = [24, 22, 22], CRM = [240, 230, 210];
  ctx.fillStyle = css(CRM); ctx.fillRect(0, 0, w, h);
  // grid lines
  const lw = h * lerp(0.004, 0.014, p.x1);
  ctx.fillStyle = css(BLK);
  ctx.fillRect(w * 0.08, 0, lw, h); ctx.fillRect(0, h * 0.8, w, lw); ctx.fillRect(w * 0.88, h * 0.1, lw, h * 0.7);
  // sun: half red, half black, slowly turning
  const sx = w * 0.72, sy = h * 0.3, sr = h * 0.17 * lerp(0.8, 1.2, p.scale), rot = t * 0.08;
  ctx.fillStyle = css(RED); ctx.beginPath(); ctx.arc(sx, sy, sr, rot, rot + Math.PI); ctx.fill();
  ctx.fillStyle = css(BLK); ctx.beginPath(); ctx.arc(sx, sy, sr, rot + Math.PI, rot + TAU); ctx.fill();
  ctx.fillStyle = css(YEL); ctx.beginPath(); ctx.arc(sx, sy, sr * 0.35, 0, TAU); ctx.fill();
  // yellow quarter circle in the corner
  ctx.fillStyle = css(YEL); ctx.beginPath(); ctx.moveTo(0, h); ctx.arc(0, h, h * 0.3, -Math.PI / 2, 0); ctx.fill();
  // clouds: rectangle base + semicircles
  const n = Math.round(lerp(2, 6, p.coverage)), span = w + h * 0.8, cols = [[RED, BLU, YEL], [BLU, YEL, RED], [YEL, RED, BLU], [BLK, YEL, RED], [BLU, RED, YEL], [RED, YEL, BLK]];
  const sc = h * lerp(0.07, 0.13, p.scale), mot = lerp(0, 1, p.x3);
  for (let i = 0; i < n; i++) {
    const [c1, c2, c3] = cols[i % cols.length];
    const x = wrap((i * 0.37 + 0.1 * h1(i)) * span + t * h * 0.025 * windX(p.wind) * (0.6 + 0.4 * h1(i + 5)), -h * 0.4, span - h * 0.4);
    const y = h * [0.3, 0.62, 0.45, 0.74, 0.22, 0.55][i % 6], s = sc * (0.8 + 0.5 * h1(i + 9));
    const bob = Math.sin(t * 0.6 + i) * s * 0.08 * mot;
    // base bar
    ctx.fillStyle = css(c1); ctx.fillRect(x - 2.2 * s, y, 4.4 * s, s * 0.6);
    // semicircles sitting on the bar
    const bumps = [[-1.2, 0.9, c2], [0.15, 1.35, c3], [1.4, 0.75, c1 === BLK ? RED : BLK]];
    bumps.forEach(([dx, r, c], k) => {
      const yy = y + (k === 1 ? bob : -bob * 0.5);
      ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x + dx * s, yy, r * s, Math.PI, TAU); ctx.closePath(); ctx.fill();
    });
    // a quarter-circle tail
    ctx.fillStyle = css(c2); ctx.beginPath(); ctx.moveTo(x + 2.2 * s, y + s * 0.6); ctx.arc(x + 2.2 * s, y + s * 0.6, s * 0.6, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
    // rain strokes from every other cloud
    if (i % 2 === 0 && p.x2 > 0.2) {
      ctx.fillStyle = css(BLK);
      for (let k = 0; k < 4; k++) { const ry = fract(t * 0.4 + k * 0.25) * s * 2.2; ctx.fillRect(x - 1.5 * s + k * s, y + s * 0.8 + ry, lw * 0.8, s * 0.5); }
    }
  }
  // dots row
  ctx.fillStyle = css(BLK);
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(w * 0.12 + i * h * 0.05, h * 0.9, h * 0.012 * (1 + 0.4 * Math.sin(t + i * 0.7) * p.x3), 0, TAU); ctx.fill(); }
  wash(ctx, w, h, p.light, 0.8);
}

// ---------- 3. Chinese xiangyun ----------
function spiral(ctx, x, y, r, turns, a0, dir = 1) {
  ctx.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const u = i / N, an = a0 + dir * u * turns * TAU, rr = r * (1 - u * 0.92);
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(an) * rr, y + Math.sin(an) * rr);
  }
  ctx.stroke();
}
function ruyi(ctx, x, y, s, t, fill, line, inner, lw, phase, flip) {
  // tail: tapering ribbon
  const L = 2.6 * s, dir = flip ? 1 : -1, pts = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, px = x + dir * (0.9 * s + u * L), py = y + s * 0.3 + Math.sin(u * 4 + t * 0.9 + phase) * s * 0.22 * u - u * s * 0.15;
    pts.push([px, py, (1 - u) * s * 0.32 + s * 0.02]);
  }
  ctx.beginPath();
  pts.forEach(([px, py, wd], i) => ctx[i ? 'lineTo' : 'moveTo'](px, py - wd));
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + pts[i][2]);
  ctx.closePath();
  ctx.lineWidth = lw * 2; ctx.strokeStyle = line; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = fill; ctx.fill();
  // tail curl at the end
  const e = pts[pts.length - 1];
  // head: three lobes plus a small top curl
  const lobes = [[x, y, s * 0.62], [x - s * 0.72, y + s * 0.2, s * 0.42], [x + s * 0.72, y + s * 0.2, s * 0.42], [x + dir * -0.1 * s, y - s * 0.62, s * 0.3]];
  const path = circlesPath(lobes);
  outlinedUnion(ctx, path, fill, line, lw);
  ctx.strokeStyle = inner; ctx.lineCap = 'round';
  lobes.forEach(([lx, ly, lr], k) => { ctx.lineWidth = lw * (k === 0 ? 1.4 : 1.1); spiral(ctx, lx, ly, lr * 0.78, 1.6, t * 0.25 + phase + k, k === 1 ? -1 : 1); });
  ctx.lineWidth = lw; spiral(ctx, e[0], e[1] - s * 0.05, s * 0.12, 1.2, t * 0.3 + phase, 1);
}
function xiangyun(S, f) {
  const { ctx, w, h, t, p } = f;
  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  bg.addColorStop(0, '#c4241c'); bg.addColorStop(1, '#7a0c0e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const lw = h * lerp(0.002, 0.006, p.x1), sc = h * lerp(0.06, 0.12, p.scale), wx = windX(p.wind);
  const gold = ctx.createLinearGradient(0, 0, 0, h); gold.addColorStop(0, '#ffe7a0'); gold.addColorStop(0.5, '#e8b24a'); gold.addColorStop(1, '#c98a2a');
  // tone-on-tone back layer
  for (let i = 0; i < 6; i++) {
    const x = wrap(h1(i + 40) * (w + h) + t * h * 0.008 * wx, -h * 0.5, w + h * 0.5), y = h * (0.1 + 0.8 * h1(i + 41));
    ruyi(ctx, x, y, sc * 1.4, t * 0.6, 'rgba(160,20,20,0.55)', 'rgba(100,8,10,0.5)', 'rgba(120,10,14,0.6)', lw, i, i & 1);
  }
  // lattice border
  if (p.x2 > 0.15) {
    ctx.strokeStyle = css([240, 190, 90], 0.7 * p.x2); ctx.lineWidth = lw * 1.2;
    const m = h * 0.035; ctx.strokeRect(m, m, w - 2 * m, h - 2 * m); ctx.strokeRect(m * 1.5, m * 1.5, w - 3 * m, h - 3 * m);
    const step = h * 0.06;
    ctx.beginPath();
    for (let x = m * 2; x < w - m * 2; x += step) { ctx.moveTo(x, m); ctx.lineTo(x, m * 1.5); ctx.moveTo(x, h - m); ctx.lineTo(x, h - m * 1.5); }
    ctx.stroke();
  }
  const n = Math.round(lerp(3, 9, p.coverage)), mot = lerp(0.3, 1.5, p.x3);
  for (let i = 0; i < n; i++) {
    const x = wrap(h1(i) * (w + h * 1.5) + t * h * 0.02 * wx * (0.7 + 0.5 * h1(i + 3)), -h * 0.6, w + h * 0.9);
    const y = h * (0.18 + 0.66 * ((i * 0.618 + 0.13) % 1)) + Math.sin(t * 0.5 * mot + i * 2) * h * 0.012 * mot;
    ruyi(ctx, x, y, sc * (0.8 + 0.5 * h1(i + 7)), t * mot, gold, '#5a0808', '#9c1a12', lw, i * 1.7, wx > 0);
  }
  wash(ctx, w, h, p.light, 0.6);
}

// ---------- 4. Seigaiha ----------
const patCache = new Map();
function seigaihaTile(r, bg, line, rings) {
  const key = [r | 0, bg, line, rings].join('|');
  if (patCache.has(key)) return patCache.get(key);
  if (patCache.size > 30) patCache.clear();
  const R = Math.max(4, r | 0), { canvas, ctx } = buffer(R * 2, R);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, R * 2, R);
  ctx.lineWidth = Math.max(1, R * 0.06); ctx.strokeStyle = line;
  for (let row = -2; row <= 3; row++) {
    const y = row * R / 2, off = (row & 1) ? R : 0;
    for (let k = -1; k <= 2; k++) {
      const x = k * 2 * R + off;
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, R, Math.PI, TAU); ctx.lineTo(x + R, y + R); ctx.lineTo(x - R, y + R); ctx.fill();
      for (let q = 0; q < rings; q++) { ctx.beginPath(); ctx.arc(x, y, R * (1 - q / rings) - ctx.lineWidth / 2, Math.PI, TAU); ctx.stroke(); }
    }
  }
  patCache.set(key, canvas);
  return canvas;
}
function pill(path, x, y, len, ht) { const r = ht / 2; path.moveTo(x + r, y); path.lineTo(x + len - r, y); path.arc(x + len - r, y + r, r, -Math.PI / 2, Math.PI / 2); path.lineTo(x + r, y + ht); path.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); path.closePath(); }
function seigaiha(S, f) {
  const { ctx, w, h, t, p } = f;
  const night = clamp(1 - p.light / 0.25);
  const bgc = css(mix3([28, 46, 96], [10, 16, 40], night)), lnc = css(mix3([70, 100, 160], [40, 56, 100], night));
  const R = h * lerp(0.035, 0.07, 1 - p.detail);
  const tile = seigaihaTile(R, bgc, lnc, 4);
  const pat = ctx.createPattern(tile, 'repeat');
  const wx = windX(p.wind);
  pat.setTransform(new DOMMatrix().translate(-t * h * 0.01 * wx, -t * h * 0.006));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
  // sun or moon
  const sx = w * 0.68, sy = h * 0.36, sr = h * 0.17;
  ctx.fillStyle = night > 0.5 ? '#f3ecd6' : '#d8392b'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
  // kasumi bands
  const gold = '#e9cf8e', goldLine = '#8a6a2a', lw = h * lerp(0.002, 0.006, p.x1);
  const inner = ctx.createPattern(seigaihaTile(R * 0.5, gold, '#c9a65a', 3), 'repeat');
  const n = Math.round(lerp(3, 7, p.coverage)), sc = lerp(0.7, 1.3, p.scale), mot = lerp(0.2, 1.4, p.x3);
  for (let i = 0; i < n; i++) {
    const len = w * (0.35 + 0.3 * h1(i + 2)) * sc, ht = h * 0.075 * sc, span = w + len + h * 0.4;
    const x = wrap(h1(i) * span + t * h * 0.015 * wx * (0.6 + 0.6 * h1(i + 4)), -len - h * 0.2, w + h * 0.2);
    const y = h * (0.1 + 0.78 * ((i * 0.618 + 0.25) % 1)) + Math.sin(t * 0.3 * mot + i) * h * 0.01 * mot;
    const path = new Path2D();
    pill(path, x, y, len, ht);
    pill(path, x + len * 0.18, y - ht * 0.62, len * 0.5, ht * 0.9);
    pill(path, x + len * 0.42, y + ht * 0.58, len * 0.46, ht * 0.85);
    ctx.lineWidth = lw * 2; ctx.strokeStyle = goldLine; ctx.lineJoin = 'round'; ctx.stroke(path);
    inner.setTransform(new DOMMatrix().translate(x, y));
    ctx.fillStyle = p.x2 > 0.2 ? inner : gold; ctx.fill(path);
  }
  // pine-needle scatter of tiny gold leaves
  ctx.fillStyle = '#e9cf8e';
  for (let i = 0; i < 18; i++) {
    const x = wrap(h1(i + 90) * w + t * h * 0.03 * wx, 0, w), y = wrap(h1(i + 91) * h + t * h * 0.02, 0, h), a = t * 0.5 + i;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, h * 0.01, h * 0.004, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
}

// ---------- 5. Art Deco ----------
function artdeco(S, f) {
  const { ctx, w, h, t, p } = f;
  const night = clamp(1 - p.light / 0.25);
  ctx.fillStyle = css(mix3([18, 26, 32], [8, 8, 14], night)); ctx.fillRect(0, 0, w, h);
  const G1 = [232, 196, 120], G2 = [180, 138, 64];
  const cx = w / 2, hz = h * 0.82;
  // sunburst
  const NR = 36, rot = t * 0.02;
  for (let i = 0; i < NR; i++) {
    if (i & 1) continue;
    const a0 = Math.PI + i / NR * Math.PI + rot % (TAU / NR * 2), a1 = a0 + Math.PI / NR;
    ctx.fillStyle = css(G2, 0.22); ctx.beginPath(); ctx.moveTo(cx, hz); ctx.arc(cx, hz, Math.hypot(w, h), a0, a1); ctx.closePath(); ctx.fill();
  }
  // half sun with stepped rings
  const sr = h * 0.3, rings = Math.round(lerp(4, 10, p.detail));
  for (let k = 0; k < rings; k++) {
    const r = sr * (1 - k / rings);
    ctx.fillStyle = css(k & 1 ? [26, 30, 36] : mix3(G1, G2, k / rings)); ctx.beginPath(); ctx.arc(cx, hz, r, Math.PI, TAU); ctx.fill();
  }
  // clouds of stacked semicircles with concentric arcs, mirrored pair plus drifting extras
  const lw = h * lerp(0.002, 0.006, p.x1), sc = h * lerp(0.045, 0.08, p.scale), mot = lerp(0.2, 1.4, p.x3);
  const decoCloud = (x, y, s, phase) => {
    const bumps = [[-1.5, 0, 1], [0, 0, 1], [1.5, 0, 1], [-0.75, -0.95, 1], [0.75, -0.95, 1], [0, -1.9, 0.95]];
    for (const [bx, by, br] of bumps) {
      const X = x + bx * s, Y = y + by * s + Math.sin(t * 0.8 * mot + phase + bx) * s * 0.05 * mot, R = br * s;
      ctx.fillStyle = '#0c0e12'; ctx.beginPath(); ctx.arc(X, Y, R, Math.PI, TAU); ctx.closePath(); ctx.fill();
      const nr = Math.round(lerp(3, 6, p.detail));
      for (let k = 0; k < nr; k++) {
        const rr = R * (1 - k / nr) - lw;
        if (rr <= 0) continue;
        const sh = 0.5 + 0.5 * Math.sin(t * 1.2 - k * 0.8 + phase);
        ctx.strokeStyle = css(mix3(G2, G1, sh)); ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(X, Y, rr, Math.PI, TAU); ctx.stroke();
      }
    }
    ctx.fillStyle = css(G1); ctx.fillRect(x - 2.5 * s, y, 5 * s, lw * 1.5);
  };
  const n = Math.round(lerp(1, 4, p.coverage)), wx = windX(p.wind);
  for (let i = 0; i < n; i++) {
    const s = sc * (0.6 + 0.3 * h1(i + 4)), span = w + 6 * s;
    const x = wrap(h1(i) * span + t * h * 0.02 * wx, -3 * s, span - 3 * s);
    decoCloud(x, h * (0.22 + 0.15 * h1(i + 8)), s, i);
  }
  const sway = Math.sin(t * 0.25) * w * 0.02;
  decoCloud(w * 0.24 + sway, h * 0.62, sc, 1);
  decoCloud(w * 0.76 - sway, h * 0.62, sc, 2);
  // horizon & frame
  ctx.fillStyle = css(G1); ctx.fillRect(0, hz, w, lw * 2);
  ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, hz + lw * 2, w, h - hz);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = css(G2, 0.9 - i * 0.15); ctx.fillRect(0, hz + h * 0.025 * (i + 1), w, lw * (1.5 - i * 0.2)); }
  ctx.strokeStyle = css(G1); ctx.lineWidth = lw;
  const m = h * 0.03, st = h * 0.03;
  ctx.beginPath();
  ctx.moveTo(m + st, m); ctx.lineTo(w - m - st, m); ctx.lineTo(w - m - st, m + st); ctx.lineTo(w - m, m + st); ctx.lineTo(w - m, h - m - st); ctx.lineTo(w - m - st, h - m - st);
  ctx.lineTo(w - m - st, h - m); ctx.lineTo(m + st, h - m); ctx.lineTo(m + st, h - m - st); ctx.lineTo(m, h - m - st); ctx.lineTo(m, m + st); ctx.lineTo(m + st, m + st); ctx.closePath(); ctx.stroke();
}

// ---------- 6. Memphis ----------
function memphis(S, f) {
  const { ctx, w, h, t, p } = f;
  ctx.fillStyle = '#f6e6dc'; ctx.fillRect(0, 0, w, h);
  // dot grid
  ctx.fillStyle = 'rgba(30,30,40,0.18)';
  const g = h * 0.045;
  for (let y = g / 2; y < h; y += g) for (let x = ((y / g | 0) & 1) * g / 2; x < w; x += g) { ctx.beginPath(); ctx.arc(x, y, h * 0.0035, 0, TAU); ctx.fill(); }
  const BLK = '#151515', cols = ['#ff7eb6', '#4fd1c5', '#ffd23f', '#9b8cff', '#ff6f59', '#7bdff2'];
  const lw = h * lerp(0.003, 0.009, p.x1), mot = lerp(0.2, 1.5, p.x3), wx = windX(p.wind);
  // confetti: squiggles, triangles, zigzags, rings
  const nd = Math.round(lerp(10, 34, p.x2));
  for (let i = 0; i < nd; i++) {
    const x = wrap(h1(i + 20) * (w + h * 0.4) + t * h * 0.015 * wx, -h * 0.2, w + h * 0.2), y = h1(i + 21) * h;
    const rot = t * 0.3 * mot * (h1(i + 22) - 0.5) + i, s = h * (0.025 + 0.02 * h1(i + 23)), kind = i % 4;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.lineWidth = lw; ctx.strokeStyle = BLK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = cols[i % cols.length];
    if (kind === 0) { ctx.beginPath(); for (let k = 0; k <= 20; k++) { const u = k / 20; ctx.lineTo((u - 0.5) * s * 3, Math.sin(u * TAU * 1.5 + t * 2 * mot) * s * 0.35); } ctx.stroke(); }
    else if (kind === 1) { ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, s * 0.6); ctx.lineTo(-s * 0.9, s * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (kind === 2) { ctx.beginPath(); for (let k = 0; k <= 6; k++) ctx.lineTo((k / 6 - 0.5) * s * 2.6, (k & 1 ? -1 : 1) * s * 0.3); ctx.strokeStyle = cols[(i + 2) % cols.length]; ctx.lineWidth = lw * 1.3; ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.lineWidth = lw * 1.4; ctx.strokeStyle = cols[(i + 1) % cols.length]; ctx.stroke(); }
    ctx.restore();
  }
  // clouds: chunky blobs with offset shadows and a fill pattern
  const n = Math.round(lerp(2, 6, p.coverage)), sc = h * lerp(0.1, 0.18, p.scale);
  for (let i = 0; i < n; i++) {
    const R = rng(i * 31 + 7), shape = blobCloud(R, 4 + (i % 3)), s = sc * (0.75 + 0.4 * h1(i + 2)), span = w + s * 4;
    const x = wrap(h1(i) * span + t * h * 0.03 * wx * (0.6 + 0.5 * h1(i + 3)), -s * 2, span - s * 2);
    const y = h * (0.25 + 0.6 * ((i * 0.618 + 0.2) % 1)) + Math.sin(t * 0.7 * mot + i) * h * 0.015 * mot;
    const circ = shape.map(([dx, dy, r], k) => [x + dx * s, y + dy * s + Math.sin(t * 1.3 * mot + k + i) * s * 0.02 * mot, r * s]);
    const path = circlesPath(circ);
    const bottom = new Path2D(); bottom.rect(x - 1.1 * s, y - s * 0.3, 2.2 * s, s * 0.3); path.addPath(bottom);
    ctx.save(); ctx.translate(s * 0.12, s * 0.12); ctx.fillStyle = BLK; ctx.lineWidth = lw * 2; ctx.strokeStyle = BLK; ctx.stroke(path); ctx.fill(path); ctx.restore();
    outlinedUnion(ctx, path, cols[i % cols.length], BLK, lw);
    ctx.save(); ctx.clip(path);
    ctx.strokeStyle = 'rgba(20,20,20,0.85)'; ctx.fillStyle = 'rgba(20,20,20,0.85)'; ctx.lineWidth = lw * 0.8;
    if (i % 3 === 0) { ctx.beginPath(); for (let k = -6; k < 10; k++) { const xx = x - 2 * s + k * s * 0.22; ctx.moveTo(xx, y + s * 0.2); ctx.lineTo(xx + s, y - s * 1.4); } ctx.stroke(); }
    else if (i % 3 === 1) { for (let yy = y - s * 1.3; yy < y; yy += s * 0.18) for (let xx = x - 1.6 * s + ((yy / s * 5.5 | 0) & 1) * s * 0.09; xx < x + 1.6 * s; xx += s * 0.18) { ctx.beginPath(); ctx.arc(xx, yy, s * 0.025, 0, TAU); ctx.fill(); } }
    else { ctx.beginPath(); for (let k = 0; k < 4; k++) { const yy = y - s * (0.2 + k * 0.28); for (let q = 0; q <= 24; q++) { const xx = x - 1.6 * s + q / 24 * 3.2 * s; ctx[q ? 'lineTo' : 'moveTo'](xx, yy + Math.sin(q * 1.1 + t * 2 * mot) * s * 0.05); } } ctx.stroke(); }
    ctx.restore();
  }
  wash(ctx, w, h, p.light, 0.7);
}

// ---------- 7. minimalist line clouds ----------
function lineClouds(S, f) {
  const { ctx, w, h, t, p } = f;
  const night = clamp(1 - p.light / 0.22);
  const paper = mix3([244, 238, 226], [30, 32, 40], night), ink = mix3([48, 46, 50], [220, 214, 200], night);
  ctx.fillStyle = css(paper); ctx.fillRect(0, 0, w, h);
  const lw = h * lerp(0.0015, 0.005, p.x1), wx = windX(p.wind);
  // sun / moon
  const sx = w * 0.66, sy = h * lerp(0.62, 0.3, smooth(0.1, 0.6, p.light));
  ctx.fillStyle = css(night > 0.5 ? [236, 230, 210] : mix3([214, 108, 72], [232, 150, 90], clamp(p.light))); ctx.beginPath(); ctx.arc(sx, sy, h * 0.085, 0, TAU); ctx.fill();
  // horizon lines
  ctx.strokeStyle = css(ink); ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.84); ctx.lineTo(w * 0.94, h * 0.84); ctx.stroke();
  // wind lines
  for (let i = 0; i < Math.round(lerp(1, 5, p.x2)); i++) {
    const L = w * 0.12, x = wrap(h1(i + 60) * (w + L) + t * h * 0.05 * wx, -L, w), y = h * (0.15 + 0.6 * h1(i + 61));
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y); ctx.moveTo(x + L * 0.3, y + h * 0.015); ctx.lineTo(x + L * 0.8, y + h * 0.015); ctx.stroke(); ctx.globalAlpha = 1;
  }
  const n = Math.round(lerp(2, 6, p.coverage)), sc = h * lerp(0.08, 0.15, p.scale);
  for (let i = 0; i < n; i++) {
    const R = rng(i * 13 + 5), nb = 3 + (R() * 3 | 0), s = sc * (0.7 + 0.5 * h1(i + 1)), span = w + s * 4;
    const x0 = wrap(h1(i) * span + t * h * 0.012 * wx * (0.7 + 0.5 * h1(i + 2)), -s * 2, span - s * 2);
    const base = h * (0.22 + 0.5 * ((i * 0.618 + 0.3) % 1));
    const bumps = [];
    for (let k = 0; k < nb; k++) { const u = k / (nb - 1); bumps.push([(u - 0.5) * 2.2 * s, (k === 0 || k === nb - 1) ? 0 : -s * (0.25 + 0.3 * Math.sin(u * Math.PI)), s * (0.38 + 0.35 * Math.sin(u * Math.PI)) * (0.85 + 0.3 * R())]); }
    const xl = bumps[0][0] - bumps[0][2], xr = bumps[nb - 1][0] + bumps[nb - 1][2];
    const pts = [];
    const M = 90;
    for (let k = 0; k <= M; k++) {
      const X = xl + (xr - xl) * k / M; let Y = 0;
      for (const [bx, by, br] of bumps) { const dx = X - bx; if (Math.abs(dx) < br) Y = Math.min(Y, by - Math.sqrt(br * br - dx * dx)); }
      pts.push([x0 + X, base + Y + Math.sin(k * 0.4 + i) * lw * 0.3]);
    }
    pts.push([x0 + xl + (xr - xl) * 0.15, base]);
    // draw-on cycle
    const P = 18 + 6 * h1(i + 9), u = fract(t / P + h1(i + 8));
    const prog = u < 0.35 ? smooth(0, 0.35, u) : u < 0.85 ? 1 : 1 - smooth(0.85, 1, u);
    const tail = u < 0.85 ? 0 : 0;
    ctx.fillStyle = css(paper, 0.85 * prog);
    ctx.beginPath(); pts.forEach(([X, Y], k) => ctx[k ? 'lineTo' : 'moveTo'](X, Y)); ctx.closePath(); ctx.fill();
    const upto = Math.max(1, Math.floor(prog * pts.length));
    ctx.strokeStyle = css(ink); ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = tail; k < upto; k++) ctx[k ? 'lineTo' : 'moveTo'](pts[k][0], pts[k][1]);
    ctx.stroke();
  }
  // a pair of birds
  for (let i = 0; i < 3; i++) {
    const x = wrap(w * (0.2 + i * 0.07) + t * h * 0.04, -h * 0.1, w + h * 0.1), y = h * (0.3 + 0.04 * i) + Math.sin(t * 0.7 + i) * h * 0.02, s = h * 0.012, fl = Math.sin(t * 6 + i * 2) * 0.5;
    ctx.beginPath(); ctx.moveTo(x - s, y - s * (0.4 + fl)); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.3, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.3, x + s, y - s * (0.4 + fl)); ctx.stroke();
  }
}

// ---------- 8. isometric ----------
const ISO = Math.cos(Math.PI / 6);
function isometric(S, f) {
  const { ctx, w, h, t, p } = f;
  const pal = skyPal(clamp(p.light * 0.9 + 0.1));
  const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, css(mix3(pal.top, [255, 255, 255], 0.25))); bg.addColorStop(1, css(mix3(pal.bot, [255, 236, 220], 0.4)));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const u = h * 0.06 * lerp(0.8, 1.2, p.scale), ox = w / 2, oy = h * 0.52;
  const P = (X, Y, Z) => [ox + (X - Y) * ISO * u, oy + (X + Y) * 0.5 * u - Z * u];
  const poly = (pts, c) => { ctx.fillStyle = css(c); ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); ctx.fill(); };
  const night = clamp(1 - p.light / 0.25), dim = c => mix3(c, mix3(c, [40, 50, 100], 0.7), night);
  // floating island
  const bob = Math.sin(t * 0.5) * 0.15, I = 3.2;
  const top = [P(-I, -I, bob), P(I, -I, bob), P(I, I, bob), P(-I, I, bob)];
  poly([P(-I, I, bob), P(I, I, bob), P(I, I, bob - 0.8), P(-I, I, bob - 0.8)], dim([196, 140, 96]));
  poly([P(I, -I, bob), P(I, I, bob), P(I, I, bob - 0.8), P(I, -I, bob - 0.8)], dim([160, 108, 72]));
  poly([P(-I, I, bob - 0.8), P(I, I, bob - 0.8), P(0, 0, bob - 4), P(-I * 0.6, I * 0.6, bob - 2.5)], dim([140, 96, 70]));
  poly([P(I, -I, bob - 0.8), P(I, I, bob - 0.8), P(0, 0, bob - 4)], dim([118, 80, 60]));
  poly(top, dim([132, 206, 120]));
  // trees and a little house on the island
  const tree = (X, Y) => {
    const b = P(X, Y, bob), tp = P(X, Y, bob + 1.6);
    ctx.fillStyle = css(dim([120, 84, 60])); ctx.fillRect(b[0] - u * 0.06, b[1] - u * 0.5, u * 0.12, u * 0.5);
    ctx.fillStyle = css(dim([70, 160, 100])); ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(b[0] + u * 0.4, b[1] - u * 0.4); ctx.lineTo(b[0] - u * 0.4, b[1] - u * 0.4); ctx.fill();
    ctx.fillStyle = css(dim([50, 130, 86])); ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(b[0] + u * 0.4, b[1] - u * 0.4); ctx.lineTo(b[0], b[1] - u * 0.3); ctx.fill();
  };
  const box = (X, Y, Z, sx, sy, sz, c) => {
    poly([P(X, Y + sy, Z), P(X + sx, Y + sy, Z), P(X + sx, Y + sy, Z + sz), P(X, Y + sy, Z + sz)], dim(c.map(v => v * 0.85)));
    poly([P(X + sx, Y, Z), P(X + sx, Y + sy, Z), P(X + sx, Y + sy, Z + sz), P(X + sx, Y, Z + sz)], dim(c.map(v => v * 0.7)));
    poly([P(X, Y, Z + sz), P(X + sx, Y, Z + sz), P(X + sx, Y + sy, Z + sz), P(X, Y + sy, Z + sz)], dim(c));
  };
  tree(-2.2, -1.5); tree(-1.4, 1.8); tree(1.8, 2.2);
  box(0.2, -1.6, bob, 1.4, 1.2, 1.0, [250, 240, 228]);
  poly([P(0.2, -1.6, bob + 1), P(1.6, -1.6, bob + 1), P(0.9, -1, bob + 1.8), P(0.2 + 0, -1.6 + 0, bob + 1)], dim([226, 96, 80]));
  poly([P(1.6, -1.6, bob + 1), P(1.6, -0.4, bob + 1), P(0.9, -1.0, bob + 1.8)], dim([190, 70, 60]));
  // clouds of iso cylinders, drifting along the X axis
  const n = Math.round(lerp(2, 6, p.coverage)), wx = windX(p.wind) >= 0 ? 1 : -1, L = 16;
  const clouds = [];
  for (let i = 0; i < n; i++) {
    const X = wrap(h1(i) * L + t * 0.35 * wx * (0.7 + 0.5 * h1(i + 1)), -L / 2, L / 2), Y = (h1(i + 2) - 0.5) * 7, Z = 3.2 + h1(i + 3) * 2.5 + Math.sin(t * 0.6 + i) * 0.12;
    clouds.push([X, Y, Z, i]);
  }
  clouds.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const cW = [255, 255, 255], cL = [226, 234, 248], cR = [186, 200, 230];
  // shadows on the island
  ctx.save(); ctx.beginPath(); top.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); ctx.clip();
  for (const [X, Y] of clouds) { const c = P(X, Y, bob); ctx.fillStyle = 'rgba(30,70,40,0.25)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], u * 1.6 * ISO * 1.2, u * 0.8 * 1.2, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
  for (const [X, Y, Z, i] of clouds) {
    const R = rng(i * 17 + 3), parts = [];
    for (let k = 0; k < 4; k++) parts.push([(R() - 0.5) * 2, (R() - 0.5) * 1.2, 0.5 + R() * 0.5 + (k === 1 ? 0.4 : 0), 0.45 + R() * 0.9]);
    parts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [dx, dy, r, hh] of parts) {
      const c = P(X + dx, Y + dy, Z), cTop = P(X + dx, Y + dy, Z + hh), rx = r * u * ISO * 1.15, ry = r * u * 0.58;
      ctx.fillStyle = css(dim(cL)); ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI); ctx.lineTo(cTop[0] - rx, cTop[1]); ctx.lineTo(cTop[0], cTop[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(dim(cR)); ctx.beginPath(); ctx.moveTo(c[0], c[1] + ry); ctx.ellipse(c[0], c[1], rx, ry, 0, Math.PI / 2, 0, true); ctx.lineTo(cTop[0] + rx, cTop[1]); ctx.lineTo(cTop[0], cTop[1]); ctx.lineTo(c[0], c[1] + ry); ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(dim(cW)); ctx.beginPath(); ctx.ellipse(cTop[0], cTop[1], rx, ry, 0, 0, TAU); ctx.fill();
    }
    if (i % 3 === 0 && p.x2 > 0.25) { // rain
      ctx.strokeStyle = css(dim([110, 150, 230]), 0.8); ctx.lineWidth = u * 0.06; ctx.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const dx = (h1(k + i * 9) - 0.5) * 2, dy = (h1(k + i * 9 + 1) - 0.5) * 1.2, fz = Z - fract(t * 0.8 + h1(k + i)) * (Z - bob);
        const a = P(X + dx, Y + dy, fz), b = P(X + dx, Y + dy, fz - 0.35); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
  }
  // stars at night
  if (night > 0.05) { ctx.fillStyle = css([255, 255, 255], night); for (let i = 0; i < 60; i++) ctx.fillRect(h1(i + 300) * w, h1(i + 301) * h * 0.5, h * 0.003, h * 0.003); }
}

const DRAW = { lowpoly, bauhaus, xiangyun, seigaiha, artdeco, memphis, line: lineClouds, iso: isometric };

export default {
  id: 'geometric', name: 'Geometric & Designed', kind: '2d', res: 1,
  params: [
    { id: 'x1', label: 'Line weight', value: 0.5 },
    { id: 'x2', label: 'Ornament', value: 0.6 },
    { id: 'x3', label: 'Motion', value: 0.5 },
  ],
  create(ctx, opts) {
    const fn = DRAW[opts.style] || lowpoly, S = {};
    return { render(f) { f.ctx.globalAlpha = 1; f.ctx.globalCompositeOperation = 'source-over'; f.ctx.setLineDash([]); fn(S, f); } };
  }
};

const d = (id, name, desc, opts, params, tags) => ({ id: 'geometric-' + id, name, desc, opts, params, tags: ['stylized', 'abstract', '2d', ...tags] });
export const scenes = [
  d('lowpoly', 'Low-Poly Sky', 'A faceted, triangulated sky where clouds drift through the mesh.', { style: 'lowpoly' }, { light: 0.32, coverage: 0.55, detail: 0.6 }, ['sunset']),
  d('bauhaus', 'Bauhaus Weather', 'Semicircle clouds in bold primaries on a cream grid, under a turning half-sun.', { style: 'bauhaus' }, { light: 0.9, coverage: 0.5 }, ['art']),
  d('xiangyun', 'Auspicious Clouds', 'Gold xiangyun scroll clouds with curling tails drifting on lacquer red.', { style: 'xiangyun' }, { light: 0.9, coverage: 0.5, speed: 0.45 }, ['art', 'fantasy']),
  d('seigaiha', 'Seigaiha Mist', 'Gold kasumi bands patterned with waves, drifting over an indigo seigaiha sea.', { style: 'seigaiha' }, { light: 0.8, coverage: 0.5, speed: 0.45 }, ['art', 'sea']),
  d('artdeco', 'Art Deco Skyline', 'Concentric gold arc clouds before a stepped sunburst, black and gold.', { style: 'artdeco' }, { light: 0.8, coverage: 0.4 }, ['art', 'retro']),
  d('memphis', 'Memphis Squiggles', 'Chunky patterned clouds, squiggles and confetti in 80s Memphis style.', { style: 'memphis' }, { light: 0.9, coverage: 0.5, speed: 0.5 }, ['cartoon', 'retro', 'pastel']),
  d('line', 'Single-Line Clouds', 'Minimal ink clouds that draw themselves on, drift and fade on cream paper.', { style: 'line' }, { light: 0.6, coverage: 0.45, speed: 0.5 }, ['art']),
  d('iso', 'Isometric Island', 'Flat-design iso clouds drifting over a tiny floating island.', { style: 'iso' }, { light: 0.85, coverage: 0.5, speed: 0.5 }, ['cartoon', 'fantasy', 'pastel']),
];
