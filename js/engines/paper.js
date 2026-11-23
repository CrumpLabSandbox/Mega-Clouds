// Crafty clouds: paper cut-outs, felt, origami, clay, cotton-ball puppets and tissue collage.
// Everything is drawn from simple circle-union cloud shapes with per-medium shading and cached textures.
import { clamp, lerp, smooth, fract, wrap, rng, hash, noise2, windDir, buffer, mixHex } from '../util.js';

const TAU = Math.PI * 2;

// ---------- geometry (circle-union clouds) ----------
function cloudPuffs(seed, S, detail, flat = true) {
  const r = rng(seed), k = 3 + (r() * 3 | 0) + Math.round(detail * 2), width = (k - 1) * S * 0.36 * (0.85 + r() * 0.35), puffs = [];
  for (let i = 0; i < k; i++) {
    const u = i / (k - 1) - 0.5, rad = S * (0.28 + 0.26 * (1 - Math.abs(u) * 1.5) + r() * 0.12);
    puffs.push({ x: u * width + (r() - 0.5) * S * 0.12, y: flat ? -rad * 0.8 : (r() - 0.5) * S * 0.2 - rad * 0.5, r: rad });
  }
  const m = 1 + (r() * 2.4 | 0);
  for (let i = 0; i < m; i++) { const rad = S * (0.38 + r() * 0.22); puffs.push({ x: (r() - 0.5) * width * 0.55, y: -S * 0.5 - rad * 0.35, r: rad }); }
  return puffs;
}
function unionPath(ctx, puffs, dx = 0, dy = 0, k = 1, dr = 0) {
  for (const p of puffs) { const r = Math.max(0.5, p.r * k + dr); ctx.moveTo(p.x + dx + r, p.y + dy); ctx.arc(p.x + dx, p.y + dy, r, 0, TAU); }
}
function outlineRuns(puffs, step, dr = 0) {
  const runs = [];
  puffs.forEach((c, i) => {
    const R = c.r + dr; if (R <= 1) return;
    const N = Math.max(10, Math.ceil(TAU * R / step)), pts = [], ins = [];
    for (let k = 0; k < N; k++) {
      const a = k / N * TAU, x = c.x + Math.cos(a) * R, y = c.y + Math.sin(a) * R;
      let inside = false;
      for (let j = 0; j < puffs.length && !inside; j++) if (j !== i) { const q = puffs[j]; inside = (x - q.x) ** 2 + (y - q.y) ** 2 < (q.r + dr) ** 2 * 0.99; }
      pts.push(x, y); ins.push(inside);
    }
    let s = ins.findIndex((v, k) => !v && ins[(k - 1 + N) % N]);
    const closed = s < 0; if (closed && ins[0]) return; if (closed) s = 0;
    let run = null;
    for (let n = 0; n <= N; n++) {
      if (n === N && !closed) break;
      const k = (s + n) % N;
      if (!ins[k]) { if (!run) runs.push(run = []); run.push(pts[k * 2], pts[k * 2 + 1]); } else run = null;
    }
  });
  return runs;
}
function polyline(ctx, pts) { ctx.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); }
function bbox(puffs) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of puffs) { x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r); }
  return { x0, y0, x1, y1 };
}
// torn-paper blob
function tornPath(ctx, cx, cy, rx, ry, seed, rot = 0, n = 44, rough = 1) {
  for (let k = 0; k <= n; k++) {
    const a = k / n * TAU, j = 1 + rough * (0.07 * (noise2(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + seed) - 0.5) * 2 + 0.025 * (hash(k % n, seed) - 0.5));
    const x = Math.cos(a) * rx * j, y = Math.sin(a) * ry * j;
    const X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
    k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.closePath();
}

// ---------- palettes and textures ----------
function sky(light) {
  const day = smooth(0.15, 0.7, light), dusk = Math.max(0, 1 - Math.abs(light - 0.3) / 0.17);
  let top = mixHex('#1b2350', '#7fb6e6', day), bot = mixHex('#3a3f78', '#cfe6f5', day);
  if (dusk > 0) { top = mixHex(top.startsWith('rgb') ? rgbHex(top) : top, '#6d5ba8', dusk * 0.7); bot = mixHex(rgbHex(bot), '#f6b48a', dusk); }
  return [rgbHex(top), rgbHex(bot)];
}
function rgbHex(s) {
  if (s[0] === '#') return s;
  const m = s.match(/\d+/g).map(Number);
  return '#' + m.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
}
function cached(st, key, w, h, fn) {
  st.tex ||= {};
  const k = key + w + 'x' + h;
  if (!st.tex[k]) { const b = buffer(w, h); fn(b.ctx, w, h); st.tex[k] = b.canvas; }
  return st.tex[k];
}
function grainTex(g, w, h, seed = 1) {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  const r = rng(seed), n = Math.round(w * h / 30);
  for (let i = 0; i < n; i++) { const v = 128 + (r() - 0.5) * 70 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r()); }
  g.lineWidth = 0.8;
  for (let i = 0; i < w * h / 900; i++) { const v = r() > 0.5 ? 175 : 95, x = r() * w, y = r() * h, a = r() * TAU, l = 3 + r() * h * 0.02;
    g.strokeStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 1) * l, y + Math.sin(a + 1) * l, x + Math.cos(a) * l * 1.5, y + Math.sin(a) * l * 1.5); g.stroke(); }
}
function overlayGrain(ctx, st, w, h, amt) {
  if (amt < 0.02) return;
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = amt;
  ctx.drawImage(cached(st, 'grain', w, h, grainTex), 0, 0); ctx.restore();
}
// soft shadows: draw shapes into a 1/8-res buffer and scale up (cheap blur)
function softShadow(ctx, st, w, h, alpha, draw) {
  const bw = Math.ceil(w / 8), bh = Math.ceil(h / 8);
  if (!st.ssb || st.ssb.canvas.width !== bw || st.ssb.canvas.height !== bh) st.ssb = buffer(bw, bh);
  const g = st.ssb.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh); g.setTransform(bw / w, 0, 0, bh / h, 0, 0);
  g.fillStyle = '#000'; draw(g);
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(st.ssb.canvas, 0, 0, w, h); ctx.restore();
}
const sunPos = (f) => ({ x: f.w - f.h * 0.35, y: f.p.light < 0.15 ? f.h * lerp(0.18, 0.65, f.p.light / 0.15) : f.h * lerp(0.65, 0.18, smooth(0.15, 0.8, f.p.light)), night: f.p.light < 0.15 });

// cloud field shared by most scenes: positions as a pure function of t
function field(f, st, opt = {}) {
  const { w, h, p } = f, [wx, wy] = windDir(p.wind), t = opt.t ?? f.t;
  const n = Math.round(lerp(3, 11, p.coverage)), base = h * lerp(0.1, 0.25, p.scale) * (opt.size || 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng(Math.imul(i + 1, 2654435761) ^ Math.imul((opt.seed || 0) + 7, 40503)), depth = r(), S = base * (0.6 + 0.6 * depth) * (0.85 + r() * 0.3), span = w + S * 5;
    const v = h * 0.03 * (0.8 + 0.4 * depth);
    out.push({ S, depth, seed: i * 31 + 7 + (opt.seed || 0), i,
      x: wrap((i + r() * 0.7) / n * span + t * v * wx, -S * 2.5, w + S * 2.5),
      y: wrap(h * lerp(opt.y0 ?? 0.22, opt.y1 ?? 0.6, clamp(depth * 0.5 + r() * 0.5)) + t * v * wy * 0.4, h * 0.12, h * ((opt.y1 ?? 0.6) + 0.12)) });
  }
  for (const q of st.spawn) {
    const age = t - q.t0; if (age < 0) continue;
    out.push({ S: base * Math.min(1.1, 0.3 + age * 1.5), depth: 1.1, seed: q.seed, i: out.length, x: q.x + age * h * 0.05 * wx, y: q.y + age * h * 0.05 * wy * 0.4 });
  }
  out.sort((a, b) => a.depth - b.depth);
  const pt = f.pointer;
  for (const c of out) {
    if (pt.moved) {
      const dx = c.x - pt.x * w, dy = c.y - c.S * 0.5 - pt.y * h, d = Math.hypot(dx, dy) || 1, R = c.S * 2.4;
      if (d < R) { const k = (1 - d / R) ** 2 * c.S; c.x += dx / d * k; c.y += dy / d * k * 0.5; }
    }
    c.puffs = cloudPuffs(c.seed, c.S, p.detail, opt.flat !== false).map(q => ({ x: q.x + c.x, y: q.y + c.y, r: q.r }));
    c.bb = bbox(c.puffs);
  }
  return out.filter(c => c.bb.x1 > -20 && c.bb.x0 < w + 20);
}
function backdrop(ctx, w, h, light) {
  const [a, b] = sky(light), g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// ---------- scenes ----------
const MODES = {};

// 1. layered paper cut-out with parallax
MODES.cutout = (ctx, f, st) => {
  const { w, h, p, t } = f, light = p.light, [wx] = windDir(p.wind);
  backdrop(ctx, w, h, light);
  const sh = lerp(0, 1, p.x1), sun = sunPos(f);
  const shadow = (k) => { ctx.shadowColor = `rgba(20,25,50,${0.18 + 0.2 * sh})`; ctx.shadowBlur = h * 0.02 * sh * k; ctx.shadowOffsetX = h * 0.004 * sh * k; ctx.shadowOffsetY = h * 0.008 * sh * k; };
  const px = f.pointer.moved ? (f.pointer.x - 0.5) * h * 0.06 : 0;
  // sun: stacked paper discs
  const sc = sun.night ? ['#f4f1dc', '#e6e1c4'] : light < 0.45 ? ['#ffb36b', '#ffd59a', '#fff0c8'] : ['#ffd84d', '#ffe98a', '#fff6c9'];
  sc.forEach((c, i) => { shadow(0.6); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sun.x - px * 0.2, sun.y, h * (0.1 - i * 0.025), 0, TAU); ctx.fill(); });
  ctx.shadowColor = 'transparent';
  if (light < 0.25) for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(255,250,220,${smooth(0.25, 0.05, light) * (0.5 + hash(i, 3) * 0.5)})`; ctx.beginPath(); ctx.arc(hash(i, 1) * w, hash(i, 2) * h * 0.55, h * 0.004, 0, TAU); ctx.fill(); }
  // floating cut-out clouds
  const floaters = field(f, st, { y0: 0.15, y1: 0.4, size: 0.8 });
  const sOff = h * 0.012 * sh, sA = 0.12 + 0.25 * sh;
  softShadow(ctx, st, w, h, sA, g => { g.beginPath(); for (const c of floaters) unionPath(g, c.puffs, -px * c.depth * 0.5 + sOff * 0.5, sOff); g.fill(); });
  for (const c of floaters) {
    ctx.fillStyle = mixHex('#e7eef7', '#ffffff', c.depth);
    ctx.beginPath(); unionPath(ctx, c.puffs, -px * c.depth * 0.5); ctx.fill();
  }
  // banks of cloud strips, far to near
  const L = Math.round(lerp(3, 6, p.x3));
  const [skyTop, skyBot] = sky(light);
  for (let k = 0; k < L; k++) {
    const z = (k + 1) / L, R = h * lerp(0.05, 0.13, p.scale) * (0.6 + z * 0.6);
    const base = h * (lerp(0.85, 0.55, p.coverage) + z * 0.24 - 0.12);
    const off = t * h * 0.02 * (0.4 + z * 1.4) * wx + px * z * 2, sx = R * 1.05;
    const i0 = Math.floor((off - R * 2) / sx), i1 = Math.ceil((off + w + R * 2) / sx);
    const band = (g, dx, dy) => {
      g.beginPath();
      for (let i = i0; i <= i1; i++) {
        const r = R * (0.6 + 0.65 * hash(i, k)), x = i * sx - off + dx, y = base - r * 0.55 * hash(i, k, 2) - R * 0.15 * Math.sin(i * 0.9 + k) + dy;
        g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU);
      }
      g.rect(-10 + dx, base + dy, w + 20, h - base + 10);
    };
    softShadow(ctx, st, w, h, sA * (0.8 + z * 0.4), g => { band(g, sOff * 0.4, -sOff * (0.6 + z * 0.6)); g.fill(); });
    band(ctx, 0, 0);
    ctx.fillStyle = mixHex(k % 2 ? '#f6d9e6' : rgbHex(skyBot), '#ffffff', lerp(0.25, 0.82, z));
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  overlayGrain(ctx, st, w, h, lerp(0, 0.6, p.x2));
};

// 2. felt and stitching
MODES.felt = (ctx, f, st) => {
  const { w, h, p } = f, light = p.light;
  const [a, b] = sky(light);
  ctx.fillStyle = mixHex(a, b, 0.5); ctx.fillRect(0, 0, w, h);
  const fibre = (key, light2) => cached(st, key, w, h, (g, w, h) => {
    const r = rng(key.length * 7 + 3), n = Math.round(w * h / 22);
    g.lineWidth = Math.max(0.6, h / 1100);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, an = r() * TAU, l = h * (0.003 + r() * 0.008);
      g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.1 * light2})` : `rgba(0,0,0,${0.04 + r() * 0.06})`;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(an + 1.2) * l, y + Math.sin(an + 1.2) * l, x + Math.cos(an) * l * 1.6, y + Math.sin(an) * l * 1.6); g.stroke();
    }
  });
  ctx.drawImage(fibre('feltA', 1), 0, 0);
  const sun = sunPos(f), stitchW = h * 0.0045, dash = [h * 0.013, h * 0.009];
  const felt = (path, color, thread, inset, runs) => {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.15 + p.x1 * 0.3})`; ctx.shadowBlur = h * 0.012 * (0.3 + p.x1); ctx.shadowOffsetY = h * 0.006 * (0.3 + p.x1);
    ctx.fillStyle = color; ctx.beginPath(); path(0); ctx.fill(); ctx.restore();
    // fuzzy edge
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = h * 0.004; ctx.setLineDash([1, h * 0.004]); ctx.beginPath(); path(0); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.beginPath(); path(0); ctx.clip(); ctx.globalAlpha = 0.9; ctx.drawImage(fibre('feltB', 2), 0, 0); ctx.restore();
    // running stitch
    ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash(dash); ctx.lineWidth = stitchW;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); runs ? runs.forEach(r => polyline(ctx, r.map((v, i) => v + (i % 2 ? 1 : 0.6)))) : path(-inset); ctx.stroke();
    ctx.strokeStyle = thread; ctx.beginPath(); runs ? runs.forEach(r => polyline(ctx, r)) : path(-inset); ctx.stroke();
    ctx.restore();
  };
  // sun with blanket stitch, or moon with stars as buttons
  const sr = h * 0.085;
  felt(d => { ctx.arc(sun.x, sun.y, sr + d, 0, TAU); }, sun.night ? '#efe9c8' : light < 0.45 ? '#ffa54d' : '#ffcf3d', sun.night ? '#8b86b8' : '#d0562a', h * 0.014);
  ctx.strokeStyle = sun.night ? '#8b86b8' : '#d0562a'; ctx.lineWidth = stitchW; ctx.beginPath();
  for (let i = 0; i < 28; i++) { const an = i / 28 * TAU; ctx.moveTo(sun.x + Math.cos(an) * sr * 0.86, sun.y + Math.sin(an) * sr * 0.86); ctx.lineTo(sun.x + Math.cos(an) * sr * 1.04, sun.y + Math.sin(an) * sr * 1.04); }
  ctx.stroke();
  const button = (x, y, r, col) => {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.25;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(x + u * r * 0.25, y + v * r * 0.25, r * 0.1, 0, TAU); ctx.fill(); }
  };
  const night = smooth(0.35, 0.1, light);
  if (night > 0) for (let i = 0; i < 9; i++) { ctx.globalAlpha = night; button(hash(i, 1) * w, h * (0.08 + hash(i, 2) * 0.45), h * (0.012 + hash(i, 3) * 0.01), ['#f3e7a0', '#ffffff', '#c9d7ff'][i % 3]); ctx.globalAlpha = 1; }
  const threads = ['#e86a92', '#4b8fd6', '#f2b134', '#7c5cc4', '#3aa38a'];
  for (const c of field(f, st, { y0: 0.2, y1: 0.68 })) {
    const runs = outlineRuns(c.puffs, h * 0.01, -h * 0.014);
    felt(d => unionPath(ctx, c.puffs, 0, 0, 1, d), night > 0.5 ? '#d9dcef' : '#fbfbf8', threads[c.seed % threads.length], h * 0.014, runs);
    if (c.i % 2 === 0) button(c.bb.x1 - c.S * 0.45, c.bb.y0 + c.S * 0.45, h * 0.014, threads[(c.seed + 2) % threads.length]);
  }
  // felt hills with a stitched seam
  const hills = Math.round(lerp(1, 3, p.x3));
  for (let k = 0; k < hills; k++) {
    const pts = [], y0 = h * (0.8 + k * 0.06);
    for (let x = -20; x <= w + 20; x += h * 0.04) pts.push(x, y0 - h * 0.08 * noise2(x / h * 1.3 + k * 5, k));
    const path = d => { ctx.moveTo(-20, h + 20); for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1] - d); ctx.lineTo(w + 20, h + 20); ctx.closePath(); };
    felt(path, ['#6fae5a', '#4f9a4a', '#3c7d3c'][k], '#e9f2d0', 0, [pts.map((v, i) => i % 2 ? v + h * 0.015 : v)]);
  }
  overlayGrain(ctx, st, w, h, lerp(0, 0.4, p.x2));
};

// 3. origami: faceted, folded clouds
MODES.origami = (ctx, f, st) => {
  const { w, h, p, t } = f, light = p.light;
  backdrop(ctx, w, h, light);
  // big faint fold creases across the sheet
  ctx.drawImage(cached(st, 'folds', w, h, (g, w, h) => {
    g.lineWidth = Math.max(1, h / 700);
    const ls = [[0, 0, w, h], [w, 0, 0, h], [w / 2, 0, w / 2, h], [0, h / 2, w, h / 2]];
    for (const [a, b, c, d] of ls) {
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.06)'; g.beginPath(); g.moveTo(a + 1.5, b + 1.5); g.lineTo(c + 1.5, d + 1.5); g.stroke();
    }
  }), 0, 0);
  const sun = sunPos(f);
  const lx = Math.cos(-2.3 + (sun.x / w - 0.5)), ly = Math.sin(-2.3);
  const pt = f.pointer, tilt = pt.moved ? [(pt.x - 0.5) * 0.6, (pt.y - 0.5) * 0.6] : [Math.sin(t * 0.2) * 0.15, 0];
  const facets = (cx, cy, r, n, base, rot, apex) => {
    const ax = cx + apex[0] * r, ay = cy + apex[1] * r;
    for (let k = 0; k < n; k++) {
      const a0 = rot + k / n * TAU, a1 = rot + (k + 1) / n * TAU;
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const am = (a0 + a1) / 2, lit = 0.5 + 0.5 * (Math.cos(am) * lx + Math.sin(am) * ly);
      const shadeK = lerp(0.72, 1.04, lit) * (k % 2 ? 0.97 : 1);
      ctx.fillStyle = mixHex('#000000', base, clamp(shadeK)); if (shadeK > 1) ctx.fillStyle = mixHex(base, '#ffffff', shadeK - 1);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = Math.max(0.6, h * 0.001); ctx.stroke();
    }
  };
  // folded paper star-sun
  const sb = sun.night ? '#efeacd' : light < 0.45 ? '#ff9d5c' : '#ffcf48';
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = h * 0.02 * p.x1; ctx.shadowOffsetY = h * 0.01 * p.x1;
  ctx.fillStyle = sb; ctx.beginPath(); ctx.arc(sun.x, sun.y, h * 0.07, 0, TAU); ctx.fill(); ctx.restore();
  const rot = t * 0.05;
  for (let k = 0; k < 16; k++) {
    const a0 = rot + k / 16 * TAU, a1 = rot + (k + 1) / 16 * TAU, R = k % 2 ? h * 0.11 : h * 0.075, Rn = k % 2 ? h * 0.075 : h * 0.11;
    ctx.fillStyle = mixHex(sb, k % 2 ? '#ffffff' : '#000000', 0.12);
    ctx.beginPath(); ctx.moveTo(sun.x, sun.y); ctx.lineTo(sun.x + Math.cos(a0) * R, sun.y + Math.sin(a0) * R); ctx.lineTo(sun.x + Math.cos(a1) * Rn, sun.y + Math.sin(a1) * Rn); ctx.closePath(); ctx.fill();
  }
  const pal = light < 0.15 ? ['#cfd4ef', '#b8bfe6', '#dfe2f5'] : light < 0.45 ? ['#ffe3d3', '#f8d0e0', '#fff3e6'] : ['#ffffff', '#eef4fb', '#f5f0ff'];
  for (const c of field(f, st, { y0: 0.2, y1: 0.72, flat: false })) {
    const n = 5 + Math.round(p.detail * 3);
    ctx.save(); ctx.shadowColor = 'rgba(30,40,80,0.28)'; ctx.shadowBlur = h * 0.025 * p.x1; ctx.shadowOffsetX = h * 0.01 * p.x1; ctx.shadowOffsetY = h * 0.02 * p.x1;
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    c.puffs.forEach((q, i) => { const rr = rng(c.seed + i)() * TAU; for (let k = 0; k <= n; k++) { const a = rr + k / n * TAU; k ? ctx.lineTo(q.x + Math.cos(a) * q.r, q.y + Math.sin(a) * q.r) : ctx.moveTo(q.x + Math.cos(a) * q.r, q.y + Math.sin(a) * q.r); } ctx.closePath(); });
    ctx.fill(); ctx.restore();
    const order = c.puffs.map((q, i) => i).sort((a, b) => c.puffs[a].y - c.puffs[b].y);
    for (const i of order) {
      const q = c.puffs[i], rr = rng(c.seed + i)() * TAU, bob = Math.sin(t * 0.6 + i + c.seed) * 0.08;
      facets(q.x, q.y, q.r, n, pal[(c.seed + i) % pal.length], rr, [tilt[0] + bob, tilt[1] - 0.15]);
    }
  }
  // a few paper cranes gliding
  const [wx] = windDir(p.wind);
  for (let i = 0; i < Math.round(p.x3 * 3); i++) {
    const x = wrap(hash(i, 1) * w + t * h * 0.08 * (wx || 1), -h * 0.2, w + h * 0.2), y = h * (0.7 + hash(i, 2) * 0.15) + Math.sin(t * 1.5 + i) * h * 0.015, s = h * 0.06 * (0.7 + hash(i, 3) * 0.5), dir = wx < 0 ? -1 : 1;
    const flap = Math.sin(t * 4 + i * 2) * 0.5;
    const tri = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + pts[0] * s * dir, y + pts[1] * s); ctx.lineTo(x + pts[2] * s * dir, y + pts[3] * s); ctx.lineTo(x + pts[4] * s * dir, y + pts[5] * s); ctx.closePath(); ctx.fill(); };
    const cc = ['#e85d75', '#4fa3d9', '#f2a93b'][i % 3];
    tri([-1.4, -0.3, 0, 0.2, 0.3, 0], mixHex(cc, '#000000', 0.15));
    tri([0, 0.2, 1.3, -0.5, 0.4, 0], cc);
    tri([-0.2, 0, 0.3, 0, 0.1, -1.1 + flap], mixHex(cc, '#ffffff', 0.25));
  }
  overlayGrain(ctx, st, w, h, lerp(0, 0.35, p.x2));
};

// 4. claymation: stop-motion at 12 fps with fingerprinted plasticine
function fingerprint(g, s) {
  const r = rng(9);
  for (let k = 0; k < 9; k++) {
    const cx = r() * s, cy = r() * s, R = s * (0.15 + r() * 0.2), a0 = r() * TAU;
    for (let j = 1; j < 9; j++) {
      g.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.08})`; g.lineWidth = s / 180;
      g.beginPath(); g.ellipse(cx, cy, R * j / 8, R * j / 8 * 0.7, a0, r() * 1, Math.PI * (0.6 + r() * 0.7)); g.stroke();
    }
  }
}
MODES.clay = (ctx, f, st) => {
  const { w, h, p } = f, light = p.light;
  const fps = 12, step = Math.floor(f.t * fps), tq = step / fps;
  const jit = (k, a) => (hash(step, k) - 0.5) * a;
  // plasticine backdrop smeared with thumbs
  const [a, b] = sky(light);
  ctx.fillStyle = mixHex(a, b, 0.4); ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cached(st, 'smear', w, h, (g, w, h) => {
    const r = rng(4);
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, R = h * (0.02 + r() * 0.05), an = r() * TAU;
      const gr = g.createRadialGradient(x, y, 0, x, y, R); const v = r() > 0.5 ? '255,255,255' : '0,0,0';
      gr.addColorStop(0, `rgba(${v},0.07)`); gr.addColorStop(1, `rgba(${v},0)`);
      g.fillStyle = gr; g.save(); g.translate(x, y); g.rotate(an); g.scale(2, 0.7); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
    }
  }), 0, 0);
  const fp = cached(st, 'fp', 256, 256, (g) => fingerprint(g, 256));
  const ball = (x, y, r, col, lightCol, darkCol, k) => {
    const lx = x - r * 0.35, ly = y - r * 0.4;
    const gr = ctx.createRadialGradient(lx, ly, r * 0.05, x, y, r * 1.05);
    gr.addColorStop(0, lightCol); gr.addColorStop(0.55, col); gr.addColorStop(1, darkCol);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (p.x2 > 0.02) { ctx.save(); ctx.clip(); ctx.globalAlpha = p.x2 * 0.9; ctx.translate(x, y); ctx.rotate(k); ctx.drawImage(fp, -r, -r, r * 2, r * 2); ctx.restore(); }
  };
  const sun = sunPos(f);
  ball(sun.x + jit(1, h * 0.003), sun.y + jit(2, h * 0.003), h * 0.08, sun.night ? '#ece6c8' : '#ffb43a', sun.night ? '#fffbe8' : '#ffe08a', sun.night ? '#a8a28a' : '#e0751f', 0.3);
  // clay clouds with faces
  const clouds = field(f, st, { t: tq, y0: 0.2, y1: 0.55 });
  const base = light < 0.15 ? ['#c9cde6', '#eef0ff', '#7e84a8'] : light < 0.45 ? ['#fde3e0', '#fff8f2', '#d9a0a6'] : ['#f2f5fa', '#ffffff', '#a9b6c9'];
  softShadow(ctx, st, w, h, 0.15 + p.x1 * 0.25, g => { g.beginPath(); for (const c of clouds) unionPath(g, c.puffs, h * 0.03 * p.x1, h * 0.05 * p.x1); g.fill(); });
  for (const c of clouds) {
    const order = c.puffs.map((q, i) => i).sort((a, b) => c.puffs[a].y - c.puffs[b].y);
    for (const i of order) {
      const q = c.puffs[i];
      // a little "squish" every frame like hand-repositioned clay
      ball(q.x + jit(i + c.seed, h * 0.002), q.y + jit(i + c.seed + 50, h * 0.002), q.r * (1 + jit(i, 0.015)), base[0], base[1], base[2], c.seed + i);
    }
    // face on the largest lump
    const big = c.puffs.reduce((a, b) => b.r > a.r ? b : a), r = big.r;
    const blink = fract(tq * 0.23 + c.seed * 0.37) < 0.03;
    ctx.fillStyle = '#2a2633';
    for (const s of [-1, 1]) {
      const ex = big.x + s * r * 0.3, ey = big.y - r * 0.05;
      if (blink) { ctx.fillRect(ex - r * 0.09, ey, r * 0.18, r * 0.035); continue; }
      ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.08, r * 0.1, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - r * 0.025, ey - r * 0.035, r * 0.025, 0, TAU); ctx.fill(); ctx.fillStyle = '#2a2633';
    }
    ctx.strokeStyle = '#2a2633'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(big.x, big.y + r * 0.12, r * 0.16, 0.4, Math.PI - 0.4); ctx.stroke();
    ctx.fillStyle = 'rgba(240,120,140,0.45)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(big.x + s * r * 0.48, big.y + r * 0.12, r * 0.1, r * 0.06, 0, 0, TAU); ctx.fill(); }
  }
  // clay hills in front
  const hills = [['#7cc26a', '#a8e08f', '#4b8a3e'], ['#5fae55', '#8fd078', '#3b7432']];
  hills.forEach((hc, k) => {
    for (let i = -1; i < 7; i++) {
      const x = (i + (k ? 0.5 : 0)) * w / 5 + jit(i + k * 9, h * 0.002), y = h * (0.98 + k * 0.08), r = h * (0.22 + hash(i, k) * 0.1);
      ball(x, y, r, hc[0], hc[1], hc[2], i + k);
    }
  });
};

// 5. cotton-ball clouds hanging on strings in a puppet theatre
function cottonSprite(seed, S) {
  const size = Math.ceil(S * 3.2), b = buffer(size, size), g = b.ctx, r = rng(seed), cx = size / 2, cy = size / 2;
  const n = 26 + (r() * 14 | 0);
  for (let i = 0; i < n * 3; i++) { // fibrous fluff
    const a = r() * TAU, d = Math.sqrt(r()), x = cx + Math.cos(a) * d * S * 1.2, y = cy + Math.sin(a) * d * S * 0.6;
    const rr = S * (0.12 + r() * 0.2), shade = 235 - (y - cy) / S * 40 + r() * 15 | 0;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(${shade},${shade},${shade + 8},0.55)`); gr.addColorStop(0.6, `rgba(${shade},${shade},${shade + 8},0.25)`); gr.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(0.6, S / 120);
  for (let i = 0; i < 160; i++) { const a = r() * TAU, d = 0.6 + r() * 0.5, x = cx + Math.cos(a) * d * S * 1.15, y = cy + Math.sin(a) * d * S * 0.58; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * S * 0.2, y + (r() - 0.5) * S * 0.2, x + Math.cos(a) * S * 0.12, y + Math.sin(a) * S * 0.08); g.stroke(); }
  return b.canvas;
}
MODES.puppet = (ctx, f, st) => {
  const { w, h, p, t } = f, light = p.light;
  const top = h * 0.16, floor = h * 0.84, side = w * 0.13;
  // painted backdrop
  const [a, b] = sky(light);
  const g0 = ctx.createLinearGradient(0, top, 0, floor); g0.addColorStop(0, mixHex(a, '#000000', 0.25)); g0.addColorStop(1, b);
  ctx.fillStyle = g0; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cached(st, 'canvas', w, h, (g, w, h) => {
    const r = rng(12); g.lineWidth = h * 0.03;
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(255,255,255,${r() * 0.04})`; const y = r() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * h * 0.1, w * 0.7, y + (r() - 0.5) * h * 0.1, w, y); g.stroke(); }
  }), 0, 0);
  const [wx] = windDir(p.wind), sway = lerp(0.02, 0.25, p.x4);
  if (light < 0.3) { ctx.fillStyle = `rgba(255,245,200,${smooth(0.3, 0.05, light) * 0.8})`; for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc(side + hash(i, 1) * (w - side * 2), top + hash(i, 2) * (floor - top) * 0.6, h * 0.004, 0, TAU); ctx.fill(); } }
  // hanging items: a cardboard sun and cotton clouds
  const items = [];
  const sp = sunPos(f);
  items.push({ kind: 'sun', px: sp.x - w * 0.1, L: (sp.y - top * 0.2) * 0.9 + h * 0.05, ph: 0.7, r: h * 0.08 });
  const n = Math.round(lerp(2, 6, p.coverage)), S = h * lerp(0.07, 0.13, p.scale);
  for (let i = 0; i < n; i++) {
    const travel = (w - side * 2 - S * 2) / 2;
    const px = w / 2 + Math.sin(t * 0.08 * (0.6 + hash(i, 4)) * (wx >= 0 ? 1 : -1) + i * 2.1) * travel * 0.9;
    items.push({ kind: 'cloud', i, px, L: h * (0.22 + hash(i, 5) * 0.3), ph: hash(i, 6) * TAU, S: S * (0.8 + hash(i, 7) * 0.5) });
  }
  // spotlight
  const pt = f.pointer, spx = pt.moved ? pt.x * w : w * (0.5 + 0.2 * Math.sin(t * 0.15));
  const lg = ctx.createRadialGradient(spx, h * 0.55, 0, spx, h * 0.55, h * 0.55);
  lg.addColorStop(0, `rgba(255,240,200,${0.18 + 0.12 * p.x1})`); lg.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h); ctx.restore();
  for (const it of items) {
    const ang = Math.sin(t * (1.1 + (it.i || 0) * 0.07) + it.ph) * sway + wx * 0.04;
    it.x = it.px + Math.sin(ang) * it.L; it.y = top * 0.2 + Math.cos(ang) * it.L; it.ang = ang;
  }
  // cast shadows on the backdrop, away from the spotlight
  softShadow(ctx, st, w, h, 0.25 + p.x1 * 0.3, g => {
    g.beginPath();
    for (const it of items) {
      const x = it.x + (it.x - spx) * 0.06 + h * 0.015, y = it.y + h * 0.03;
      if (it.kind === 'sun') { g.moveTo(x + it.r, y); g.arc(x, y, it.r, 0, TAU); } else { g.moveTo(x + it.S * 1.1, y); g.ellipse(x, y, it.S * 1.1, it.S * 0.55, 0, 0, TAU); }
    }
    g.fill();
  });
  for (const it of items) {
    const x = it.x, y = it.y, ang = it.ang;
    // string
    ctx.strokeStyle = 'rgba(235,230,215,0.7)'; ctx.lineWidth = Math.max(1, h * 0.0015);
    ctx.beginPath(); ctx.moveTo(it.px, 0); ctx.lineTo(x, y - (it.kind === 'sun' ? it.r : it.S * 0.45)); ctx.stroke();
    if (it.kind === 'sun') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang * 0.5 + t * 0.1);
      ctx.fillStyle = sp.night ? '#e8e2c0' : '#f5b630';
      ctx.beginPath(); for (let k = 0; k <= 24; k++) { const rr = k % 2 ? it.r * 1.3 : it.r; const an = k / 24 * TAU; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.fill();
      ctx.fillStyle = sp.night ? '#f6f1d8' : '#ffd25a'; ctx.beginPath(); ctx.arc(0, 0, it.r * 0.82, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,70,20,0.35)'; ctx.lineWidth = it.r * 0.04; ctx.stroke(); ctx.restore();
    } else {
      st.cotton ||= {};
      const key = it.i + ':' + Math.round(it.S);
      if (!st.cotton[key]) st.cotton[key] = cottonSprite(100 + it.i, Math.round(it.S));
      const spr = st.cotton[key];
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang * 0.6); ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore();
    }
  }
  // stage floor
  const fg = ctx.createLinearGradient(0, floor, 0, h); fg.addColorStop(0, '#8a5a32'); fg.addColorStop(1, '#4a2d16');
  ctx.fillStyle = fg; ctx.fillRect(0, floor, w, h - floor);
  ctx.strokeStyle = 'rgba(30,15,5,0.45)'; ctx.lineWidth = Math.max(1, h * 0.002);
  ctx.beginPath(); for (let k = 1; k < 5; k++) { const y = floor + (h - floor) * (k / 5) ** 1.4; ctx.moveTo(0, y); ctx.lineTo(w, y); } for (let k = -8; k <= 8; k++) { ctx.moveTo(w / 2 + k * w * 0.05, floor); ctx.lineTo(w / 2 + k * w * 0.12, h); } ctx.stroke();
  ctx.fillStyle = 'rgba(255,230,180,0.25)'; ctx.fillRect(0, floor, w, h * 0.006);
  // curtains
  const curtain = (x0, x1, flip) => {
    const folds = 7, cw = (x1 - x0) / folds;
    for (let k = 0; k < folds; k++) {
      const x = x0 + k * cw, gr = ctx.createLinearGradient(x, 0, x + cw, 0);
      gr.addColorStop(0, '#5a0b12'); gr.addColorStop(0.45, '#b81f2c'); gr.addColorStop(0.6, '#d0323f'); gr.addColorStop(1, '#5a0b12');
      ctx.fillStyle = gr; ctx.beginPath();
      const sw = Math.sin(t * 0.7 + k) * h * 0.004;
      ctx.moveTo(x, 0); ctx.lineTo(x + cw + 0.5, 0); ctx.lineTo(x + cw + 0.5 + sw, h); ctx.lineTo(x + sw, h); ctx.fill();
    }
    // tie-back
    const tx = flip ? x0 + (x1 - x0) * 0.3 : x0 + (x1 - x0) * 0.7;
    ctx.fillStyle = '#d4a53a'; ctx.fillRect(Math.min(x0, x1), h * 0.55, Math.abs(x1 - x0), h * 0.02);
    ctx.beginPath(); ctx.arc(tx, h * 0.56, h * 0.018, 0, TAU); ctx.fill();
  };
  curtain(0, side, false); curtain(w - side, w, true);
  // valance with scallops and gold trim
  ctx.fillStyle = '#9c1823'; ctx.fillRect(0, 0, w, top * 0.7);
  ctx.beginPath(); const sc = w / 12; for (let k = 0; k < 12; k++) { ctx.moveTo(k * sc, top * 0.7); ctx.arc(k * sc + sc / 2, top * 0.7, sc / 2, 0, Math.PI); } ctx.fill();
  ctx.strokeStyle = '#e2b84a'; ctx.lineWidth = h * 0.008; ctx.beginPath(); for (let k = 0; k < 12; k++) ctx.arc(k * sc + sc / 2, top * 0.7, sc / 2 - h * 0.004, 0, Math.PI); ctx.stroke();
  ctx.fillStyle = '#e2b84a'; for (let k = 0; k < 12; k++) { ctx.beginPath(); ctx.arc(k * sc + sc / 2, top * 0.7 + sc / 2 + h * 0.012, h * 0.01, 0, TAU); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, top * 0.62, w, h * 0.008);
  // overall stage lighting falloff
  const vg = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  overlayGrain(ctx, st, w, h, lerp(0, 0.3, p.x2));
};

// 6. tissue-paper collage: torn, overlapping translucent pieces
MODES.collage = (ctx, f, st) => {
  const { w, h, p, t } = f, light = p.light, [wx] = windDir(p.wind);
  ctx.fillStyle = '#f4efe3'; ctx.fillRect(0, 0, w, h);
  const day = light > 0.45, night = light < 0.15;
  const bands = night ? ['#1d2a63', '#2c3b7d', '#3d2f6e', '#24366e', '#4a3c80'] : day ? ['#7ab8e8', '#9fd0f0', '#5ea2dc', '#b9def3', '#86c3e6'] : ['#f08a5d', '#f6b26b', '#e2668a', '#b05b9e', '#f7c873'];
  // torn strips of sky, layered
  const L = Math.round(lerp(5, 11, p.x3));
  for (let k = 0; k < L; k++) {
    const y = h * (k / (L - 1)) * 1.05 - h * 0.05, th = h / (L - 1) * 1.5, r = rng(k * 13 + 1);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.75;
    ctx.fillStyle = bands[k % bands.length];
    ctx.beginPath(); ctx.moveTo(-10, y);
    for (let x = -10; x <= w + 10; x += h * 0.02) ctx.lineTo(x, y + (noise2(x / h * 6, k * 3) - 0.5) * th * 0.25 + Math.sin(x / w * 3 + k) * th * 0.15);
    for (let x = w + 10; x >= -10; x -= h * 0.02) ctx.lineTo(x, y + th + (noise2(x / h * 6, k * 3 + 1) - 0.5) * th * 0.25 + Math.sin(x / w * 3 + k) * th * 0.15);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  // sun: stacked torn discs
  const sun = sunPos(f);
  const sc = night ? ['#f2eecf', '#d8d4b8'] : ['#ffcf3f', '#ff9f3a', '#ffe680'];
  sc.forEach((c, i) => { ctx.save(); ctx.globalCompositeOperation = i ? 'multiply' : 'source-over'; ctx.globalAlpha = 0.9; ctx.fillStyle = c; ctx.beginPath(); tornPath(ctx, sun.x + i * h * 0.01, sun.y - i * h * 0.006, h * (0.09 - i * 0.02), h * (0.09 - i * 0.02), i * 5 + 1, 0, 40, 1); ctx.fill(); ctx.restore(); });
  // clouds: torn paper pieces with white fibre edges plus tissue tints
  const tints = night ? ['#c3c8ef', '#e5d6f5', '#b6d4f0'] : day ? ['#ffffff', '#f7f3ea', '#e9f1fb', '#fbe8ef'] : ['#fff1e6', '#ffd9e1', '#ffe9c7'];
  const tissue = ['#f8b4c8', '#b4d8f8', '#fff0a0', '#c8b4f8', '#b8f0d0'];
  for (const c of field(f, st, { y0: 0.2, y1: 0.8 })) {
    c.puffs.forEach((q, i) => {
      const rot = Math.sin(t * 0.3 + i + c.seed) * 0.08 + hash(i, c.seed) * 3, seed = c.seed * 7 + i;
      ctx.save(); ctx.shadowColor = `rgba(40,30,20,${0.12 + p.x1 * 0.25})`; ctx.shadowBlur = h * 0.01 * (0.4 + p.x1); ctx.shadowOffsetY = h * 0.005 * (0.4 + p.x1);
      ctx.fillStyle = '#fffdf8'; ctx.beginPath(); tornPath(ctx, q.x, q.y, q.r * 1.04, q.r * 0.95, seed + 0.5, rot, 46, 1.3); ctx.fill(); ctx.restore();
      ctx.fillStyle = tints[(c.seed + i) % tints.length]; ctx.beginPath(); tornPath(ctx, q.x, q.y, q.r * 0.98, q.r * 0.9, seed, rot, 46, 1); ctx.fill();
    });
    // a translucent tissue square or two on top
    for (let k = 0; k < 2; k++) {
      const q = c.puffs[(c.seed + k * 3) % c.puffs.length];
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45;
      ctx.fillStyle = tissue[(c.seed + k) % tissue.length]; ctx.beginPath();
      tornPath(ctx, q.x + q.r * 0.3 * (k ? -1 : 1), q.y + q.r * 0.25, q.r * 0.7, q.r * 0.5, c.seed + k * 11, hash(c.seed, k) * 3 + t * 0.02, 8, 1.5); ctx.fill(); ctx.restore();
    }
    // newspaper scrap
    if (c.i % 3 === 0) {
      const q = c.puffs[0], s = q.r * 0.8, rot = hash(c.seed, 9) - 0.5;
      ctx.save(); ctx.translate(q.x, q.y + q.r * 0.2); ctx.rotate(rot);
      ctx.fillStyle = '#ece6d6'; ctx.beginPath(); tornPath(ctx, 0, 0, s, s * 0.45, c.seed + 3, 0, 30, 0.8); ctx.fill();
      ctx.clip(); ctx.fillStyle = 'rgba(60,55,50,0.45)';
      for (let y = -s * 0.4, l = 0; y < s * 0.45; y += s * 0.09, l++) ctx.fillRect(-s * 0.85, y, s * (1.5 + hash(l, c.seed) * 0.2), s * 0.035);
      ctx.restore();
    }
  }
  // birds cut from paper
  for (let i = 0; i < 3; i++) {
    const x = wrap(hash(i, 1) * w + t * h * 0.07 * (wx || 1), -h * 0.1, w + h * 0.1), y = h * (0.72 + hash(i, 2) * 0.15) + Math.sin(t + i) * h * 0.01, s = h * 0.03;
    ctx.fillStyle = '#2b2a33'; ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.3); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.6, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s, y - s * 0.3); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.2, x, y + s * 0.15); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.2, x - s, y - s * 0.3); ctx.fill();
  }
  overlayGrain(ctx, st, w, h, lerp(0, 0.55, p.x2));
};

export default {
  id: 'paper',
  name: 'Paper Craft',
  kind: '2d',
  res: 1,
  params: [
    { id: 'x1', label: 'Shadow depth', value: 0.6 },
    { id: 'x2', label: 'Texture', value: 0.5 },
    { id: 'x3', label: 'Layers', value: 0.5 },
    { id: 'x4', label: 'Sway', value: 0.5 },
  ],
  create(ctx, opts) {
    const st = { spawn: [] };
    const fn = MODES[opts.mode] || MODES.cutout;
    return {
      render(f) {
        for (const c of f.pointer.clicks || []) { st.spawn.push({ x: c.x * f.w, y: c.y * f.h + f.h * 0.05, t0: f.t, seed: 900 + (Math.random() * 1000 | 0) }); if (st.spawn.length > 6) st.spawn.shift(); }
        st.spawn = st.spawn.filter(q => Math.abs(f.t - q.t0) < 40);
        if (opts.mode === 'clay') {
          const pt = f.pointer, key = [Math.floor(f.t * 12), f.w, f.h, JSON.stringify(f.p), pt.moved && pt.x.toFixed(3), pt.moved && pt.y.toFixed(3), st.spawn.length].join('|');
          if (!st.frame || st.frame.canvas.width !== f.w || st.frame.canvas.height !== f.h) st.frame = buffer(f.w, f.h);
          if (key !== st.frameKey) { const g = st.frame.ctx; g.save(); fn(g, f, st); g.restore(); st.frameKey = key; }
          ctx.drawImage(st.frame.canvas, 0, 0);
          return;
        }
        ctx.save(); ctx.lineCap = 'butt'; fn(ctx, f, st); ctx.restore();
      }
    };
  }
};

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'paper-' + id, name, desc, opts, params, tags: ['art', '2d', ...tags] });
export const scenes = [
  d('cutout', 'Paper Cut Layers', 'Stacked cut-paper cloud banks with soft drop shadows, drifting in parallax.',
    { mode: 'cutout' }, { speed: 0.4, scale: 0.5, coverage: 0.5, detail: 0.5, light: 0.85, x1: 0.6, x2: 0.5, x3: 0.6 }, ['stylized', 'pastel']),
  d('felt', 'Felt and Stitches', 'Soft felt clouds sewn on with running stitches, buttons and a blanket-stitched sun.',
    { mode: 'felt' }, { speed: 0.35, scale: 0.55, coverage: 0.45, detail: 0.45, light: 0.8, x1: 0.5, x2: 0.4, x3: 0.6 }, ['cartoon', 'pastel']),
  d('origami', 'Origami Sky', 'Faceted folded-paper clouds, a pleated star sun and paper cranes in flight.',
    { mode: 'origami' }, { speed: 0.4, scale: 0.5, coverage: 0.45, detail: 0.4, light: 0.35, x1: 0.6, x2: 0.4, x3: 0.6 }, ['stylized', 'sunset']),
  d('clay', 'Claymation Cloudies', 'Fingerprinted plasticine clouds with faces, animated on twelves like stop-motion.',
    { mode: 'clay' }, { speed: 0.4, scale: 0.55, coverage: 0.4, detail: 0.45, light: 0.85, x1: 0.6, x2: 0.6 }, ['cartoon']),
  d('puppet', 'Cotton Ball Theatre', 'Cotton-wool clouds and a cardboard sun swing on strings under a spotlight.',
    { mode: 'puppet' }, { speed: 0.45, scale: 0.5, coverage: 0.5, detail: 0.5, light: 0.55, x1: 0.6, x2: 0.4, x4: 0.5 }, ['cartoon', 'interactive']),
  d('collage', 'Tissue Paper Collage', 'Torn-paper clouds and translucent tissue strips layered like stained glass.',
    { mode: 'collage' }, { speed: 0.35, scale: 0.55, coverage: 0.5, detail: 0.45, light: 0.3, x1: 0.5, x2: 0.5, x3: 0.5 }, ['stylized', 'sunset']),
];
