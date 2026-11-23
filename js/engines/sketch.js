// Hand-drawn clouds. Each cloud is a union of circles; its outline is traced, jittered and redrawn a few
// times a second ("boiling" lines), and the shadow side is hatched/scribbled. Seven media share the geometry.
import { clamp, lerp, smooth, fract, wrap, rng, hash, noise2, windDir, buffer } from '../util.js';

const TAU = Math.PI * 2;
const HAND = '"Marker Felt","Chalkboard SE","Comic Sans MS","Comic Neue",cursive';
const CHALK = '"Chalkduster","Chalkboard SE","Comic Sans MS",cursive';
const TECH = '"Menlo","Consolas","DejaVu Sans Mono",monospace';

// ---------- geometry ----------
function cloudPuffs(seed, S, detail) {
  const r = rng(seed), k = 3 + (r() * 3 | 0) + Math.round(detail * 2), width = (k - 1) * S * 0.36 * (0.85 + r() * 0.35), puffs = [];
  for (let i = 0; i < k; i++) {
    const u = i / (k - 1) - 0.5, rad = S * (0.28 + 0.26 * (1 - Math.abs(u) * 1.5) + r() * 0.12);
    puffs.push({ x: u * width + (r() - 0.5) * S * 0.15, y: -rad * 0.8, r: rad });
  }
  const m = 1 + (r() * 2.4 | 0);
  for (let i = 0; i < m; i++) { const rad = S * (0.38 + r() * 0.22); puffs.push({ x: (r() - 0.5) * width * 0.55, y: -S * 0.5 - rad * 0.35, r: rad }); }
  return puffs;
}
function bbox(c) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of c.puffs) { x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r); }
  return { x0, y0, x1, y1 };
}
function unionPath(ctx, puffs, dx = 0, dy = 0, k = 1) {
  for (const p of puffs) { ctx.moveTo(p.x + dx + p.r * k, p.y + dy); ctx.arc(p.x + dx, p.y + dy, p.r * k, 0, TAU); }
}
// Outer silhouette as runs of points (arcs of each circle not inside another circle)
function outlineRuns(puffs, step) {
  const runs = [];
  puffs.forEach((c, i) => {
    const N = Math.max(10, Math.ceil(TAU * c.r / step)), pts = [], ins = [];
    for (let k = 0; k < N; k++) {
      const a = k / N * TAU, x = c.x + Math.cos(a) * c.r, y = c.y + Math.sin(a) * c.r;
      let inside = false;
      for (let j = 0; j < puffs.length && !inside; j++) if (j !== i) { const q = puffs[j]; inside = (x - q.x) ** 2 + (y - q.y) ** 2 < (q.r * 0.995) ** 2; }
      pts.push(x, y, a); ins.push(inside);
    }
    let s = ins.findIndex((v, k) => !v && ins[(k - 1 + N) % N]);
    const closed = s < 0;
    if (closed && ins[0]) return;
    if (closed) s = 0;
    let run = null;
    for (let n = 0; n <= N; n++) {
      const k = (s + n) % N;
      if (n === N && !closed) break;
      if (!ins[k]) { if (!run) runs.push(run = { pts: [], cx: c.x, cy: c.y, r: c.r }); run.pts.push(pts[k * 3], pts[k * 3 + 1]); }
      else run = null;
    }
  });
  return runs;
}
// A wobbly stroke through points, displaced by smooth noise that changes every boil frame
function wobble(ctx, pts, amp, seed, bf) {
  const n = pts.length / 2;
  if (n < 2) return;
  const P = [];
  for (let k = 0; k < n; k++) {
    P.push(pts[k * 2] + (noise2(k * 0.33 + seed, bf * 3.1) - 0.5) * 2 * amp, pts[k * 2 + 1] + (noise2(k * 0.33 + seed + 40, bf * 3.1 + 7) - 0.5) * 2 * amp);
  }
  ctx.moveTo(P[0], P[1]);
  for (let k = 1; k < n - 1; k++) ctx.quadraticCurveTo(P[k * 2], P[k * 2 + 1], (P[k * 2] + P[k * 2 + 2]) / 2, (P[k * 2 + 1] + P[k * 2 + 3]) / 2);
  ctx.lineTo(P[n * 2 - 2], P[n * 2 - 1]);
}
function strokeOutline(ctx, c, E, passes, amp, seed = 0) {
  for (let ps = 0; ps < passes; ps++) {
    ctx.beginPath();
    c.runs.forEach((r, i) => wobble(ctx, r.pts, amp, c.seed * 0.13 + i * 7.7 + ps * 31 + seed, E.bf));
    ctx.stroke();
  }
}
function wobCircle(ctx, x, y, r, amp, seed, bf, from = 0, to = TAU, n = 28) {
  const pts = [];
  for (let k = 0; k <= n; k++) { const a = lerp(from, to, k / n); pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  wobble(ctx, pts, amp, seed, bf);
}
function wobLine(ctx, x0, y0, x1, y1, amp, seed, bf, n = 6) {
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(lerp(x0, x1, k / n), lerp(y0, y1, k / n));
  wobble(ctx, pts, amp, seed, bf);
}
function starPath(ctx, x, y, r, rot = 0) {
  for (let k = 0; k <= 10; k++) { const a = rot - Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; k ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
}

// Shade the far-from-sun part of a cloud with a pattern drawn by `draw(g, box)`, through a scratch buffer.
function shade(ctx, st, c, E, k, draw, litAlpha = 1) {
  const B = st.hb, g = B.ctx, bb = c.bb, pad = 4;
  const x = Math.max(0, bb.x0 - pad | 0), y = Math.max(0, bb.y0 - pad | 0), w = Math.min(E.w, bb.x1 + pad) - x, h = Math.min(E.h, bb.y1 + pad) - y;
  if (w <= 1 || h <= 1) return;
  g.clearRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.save(); g.beginPath(); unionPath(g, c.puffs); g.clip(); draw(g, { x, y, w, h }); g.restore();
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = litAlpha; g.fillStyle = '#000';
  g.beginPath(); unionPath(g, c.puffs, c.sx * c.S * k, c.sy * c.S * k, 0.97); g.fill();
  g.restore();
  ctx.drawImage(B.canvas, x, y, w, h, x, y, w, h);
}
function hatch(g, box, ang, sp, amp, seed, bf) {
  const ca = Math.cos(ang), sa = Math.sin(ang), cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.hypot(box.w, box.h) / 2;
  g.beginPath();
  for (let d = -R, i = 0; d <= R; d += sp, i++) {
    const j = (hash(i, seed, bf) - 0.5) * amp, l0 = -R * (0.8 + hash(i, seed + 1, bf) * 0.2), l1 = R * (0.8 + hash(i, seed + 2, bf) * 0.2);
    const ox = cx - sa * (d + j), oy = cy + ca * (d + j);
    g.moveTo(ox + ca * l0, oy + sa * l0); g.lineTo(ox + ca * l1, oy + sa * l1 + amp * 0.5);
  }
  g.stroke();
}
// curly ballpoint loops filling a box
function loops(g, box, r, sp, seed, bf) {
  g.beginPath();
  for (let y = box.y + sp * 0.5, row = 0; y < box.y + box.h; y += sp, row++) {
    let s = hash(row, seed) * TAU;
    const j = (noise2(row, bf) - 0.5) * sp * 0.6;
    g.moveTo(box.x + r * Math.cos(s), y + j + r * Math.sin(s));
    for (let x = box.x; x < box.x + box.w; x += r * 0.45) { s += 1.3; g.lineTo(x + r * Math.cos(s), y + j + r * Math.sin(s) * 1.15 + Math.sin(x * 0.05 + row * 1.7 + bf) * sp * 0.15); }
  }
  g.stroke();
}
function zigzag(g, x0, y0, x1, y1, sp, amp, seed, bf, ang = 0.25) {
  // back-and-forth crayon strokes covering a box
  g.beginPath();
  let first = true;
  for (let x = x0, i = 0; x < x1 + sp; x += sp, i++) {
    const top = y0 + (hash(i, seed, bf) - 0.5) * amp, bot = y1 + (hash(i, seed + 3, bf) - 0.5) * amp;
    const a = i % 2 ? [x, top] : [x + (y1 - y0) * ang, bot];
    first ? g.moveTo(a[0], a[1]) : g.lineTo(a[0], a[1]); first = false;
  }
  g.stroke();
}

// ---------- cached textures ----------
function grain(st, w, h, key, fn) {
  const k = key + w + 'x' + h;
  if (!st.tex) st.tex = {};
  if (!st.tex[k]) { const b = buffer(w, h); fn(b.ctx, w, h); st.tex[k] = b.canvas; }
  return st.tex[k];
}
function paperGrain(g, w, h, strength = 1, seed = 1) {
  const r = rng(seed), n = Math.round(w * h / 90);
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(80,70,50,${(r() * 0.06 * strength).toFixed(3)})`; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
  g.strokeStyle = `rgba(120,100,70,${0.05 * strength})`; g.lineWidth = 0.7;
  for (let i = 0; i < 260; i++) { const x = r() * w, y = r() * h, a = r() * TAU, l = 4 + r() * h * 0.03; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
}
function speckle(g, w, h, dens, seed, streak = 1) {
  const r = rng(seed), n = Math.round(w * h * dens / 6), u = Math.max(1, h / 400);
  g.fillStyle = '#000';
  for (let i = 0; i < n; i++) g.fillRect(r() * w, r() * h, u * (0.6 + r() * 1.6) * streak, u * (0.6 + r() * 1.2));
}

// ---------- scene state ----------
function layout(f, st, E) {
  const { w, h, p } = f, [wx, wy] = windDir(p.wind), t = E.tq;
  const n = Math.round(lerp(3, 12, p.coverage)), base = h * lerp(0.09, 0.23, p.scale);
  const clouds = [];
  const sunD = (c) => { const dx = E.sun.x - c.x, dy = E.sun.y - (c.y - c.S * 0.5), l = Math.hypot(dx, dy) || 1; c.sx = dx / l; c.sy = dy / l; };
  for (let i = 0; i < n; i++) {
    const r = rng(Math.imul(i + 1, 2654435761) ^ Math.imul((E.seed | 0) + 3, 40503)), depth = r();
    const S = base * (0.55 + 0.7 * depth) * (0.8 + r() * 0.4), span = w + S * 5;
    const v = h * 0.035 * (0.8 + 0.4 * depth);
    const c = { S, seed: i * 17 + 3, depth,
      x: wrap((i + r() * 0.7) / n * span + t * v * wx, -S * 2.5, w + S * 2.5),
      y: wrap(h * lerp(0.2, E.yMax, clamp(depth * 0.55 + r() * 0.45)) + t * v * wy * 0.5, h * 0.1, h * (E.yMax + 0.15)) + Math.sin(t * 0.1 + i) * h * 0.01 };
    clouds.push(c);
  }
  for (const q of st.spawn) {
    const age = t - q.t0; if (age < 0) continue;
    clouds.push({ S: base * 1.1 * Math.min(1, 0.3 + age * 1.5), seed: q.seed, depth: 1.2, x: q.x + age * h * 0.06 * wx, y: q.y + age * h * 0.06 * wy * 0.15 });
  }
  const pt = f.pointer;
  clouds.sort((a, b) => a.depth - b.depth);
  for (const c of clouds) {
    if (pt.moved) {
      const dx = c.x - pt.x * w, dy = c.y - c.S * 0.5 - pt.y * h, d = Math.hypot(dx, dy) || 1, R = c.S * 2.5;
      if (d < R) { const k = (1 - d / R) ** 2 * c.S * 1.2; c.x += dx / d * k; c.y += dy / d * k * 0.6; }
    }
    c.puffs = cloudPuffs(c.seed, c.S, p.detail).map(q => ({ x: q.x + c.x, y: q.y + c.y, r: q.r }));
    c.bb = bbox(c); sunD(c);
    c.runs = outlineRuns(c.puffs, h * lerp(0.02, 0.01, p.detail));
  }
  return clouds.filter(c => c.bb.x1 > -10 && c.bb.x0 < w + 10);
}

// ---------- styles ----------
const STYLES = {};

STYLES.pencil = {
  yMax: 0.68,
  bg(ctx, f, st, E) {
    const { w, h, p } = f;
    ctx.fillStyle = '#f2eee3'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(grain(st, w, h, 'pp', (g, w, h) => paperGrain(g, w, h, 1.2, 7)), 0, 0);
    // sky tone: soft horizontal strokes, heavier at night
    const night = smooth(0.4, 0.05, p.light);
    ctx.strokeStyle = `rgba(60,60,70,${0.08 + night * 0.25})`; ctx.lineWidth = h * 0.0014 * E.lw;
    const rows = Math.round(18 + night * 50);
    ctx.beginPath();
    for (let i = 0; i < rows; i++) {
      const y = h * (i / rows) * lerp(0.4, 0.95, night), x = hash(i, 2) * w * 0.6;
      wobLine(ctx, x, y, x + w * (0.2 + hash(i, 3) * 0.5), y + h * 0.01, h * 0.003 * E.amp, i, E.bf);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(45,45,55,0.75)'; ctx.lineWidth = h * 0.002 * E.lw;
    if (E.night) {
      ctx.beginPath(); wobCircle(ctx, E.sun.x, E.sun.y, h * 0.05, h * 0.002 * E.amp, 3, E.bf, -1.2, 1.9); wobCircle(ctx, E.sun.x + h * 0.025, E.sun.y - h * 0.008, h * 0.042, h * 0.002 * E.amp, 4, E.bf, 1.75, -1.0 + TAU, 20); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 14; i++) { const x = hash(i, 9) * w, y = hash(i, 8) * h * 0.5, s = h * 0.008; ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); } ctx.stroke();
    } else {
      ctx.beginPath(); wobCircle(ctx, E.sun.x, E.sun.y, h * 0.055, h * 0.002 * E.amp, 3, E.bf, 0, TAU * 1.08); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + E.tq * 0.05, r0 = h * 0.075, r1 = h * (0.1 + (i % 2) * 0.02); wobLine(ctx, E.sun.x + Math.cos(a) * r0, E.sun.y + Math.sin(a) * r0, E.sun.x + Math.cos(a) * r1, E.sun.y + Math.sin(a) * r1, h * 0.002 * E.amp, i, E.bf, 2); }
      ctx.stroke();
    }
    // distant hills and a few birds
    ctx.strokeStyle = 'rgba(55,55,65,0.55)'; ctx.lineWidth = h * 0.0018 * E.lw;
    const pts = []; for (let x = -10; x <= w + 10; x += h * 0.03) pts.push(x, h * (0.9 - 0.06 * noise2(x / h * 2.5, 3)));
    ctx.beginPath(); wobble(ctx, pts, h * 0.002 * E.amp, 5, E.bf); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.moveTo(-10, h); for (let k = 0; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); ctx.lineTo(w + 10, h); ctx.clip();
    ctx.lineWidth = h * 0.0012 * E.lw; ctx.strokeStyle = 'rgba(60,60,70,0.35)'; hatch(ctx, { x: 0, y: h * 0.8, w, h: h * 0.2 }, -0.6, h * 0.007, h * 0.002, 4, E.bf); ctx.restore();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const x = wrap(hash(i, 4) * w + E.tq * h * 0.05, -20, w + 20), y = h * (0.25 + hash(i, 5) * 0.2), s = h * 0.015; ctx.moveTo(x - s, y - s * 0.4); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.6, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s, y - s * 0.4); }
    ctx.stroke();
  },
  cloud(ctx, c, f, st, E) {
    const h = f.h;
    ctx.fillStyle = '#f2eee3'; ctx.beginPath(); unionPath(ctx, c.puffs); ctx.fill();
    ctx.lineWidth = h * 0.0015 * E.lw;
    const sp = h * lerp(0.016, 0.006, E.shade);
    shade(ctx, st, c, E, 0.35, (g, b) => { g.strokeStyle = 'rgba(55,55,65,0.55)'; g.lineWidth = h * 0.0014 * E.lw; hatch(g, b, 0.75, sp, h * 0.003, c.seed, E.bf); });
    if (E.shade > 0.35) shade(ctx, st, c, E, 0.16, (g, b) => { g.strokeStyle = 'rgba(50,50,60,0.5)'; g.lineWidth = h * 0.0012 * E.lw; hatch(g, b, -0.7, sp * 1.2, h * 0.003, c.seed + 9, E.bf); });
    ctx.strokeStyle = 'rgba(40,40,48,0.32)'; ctx.lineWidth = h * 0.0014 * E.lw; strokeOutline(ctx, c, E, 1, h * 0.006 * E.amp, 50);
    ctx.strokeStyle = 'rgba(35,35,45,0.8)'; ctx.lineWidth = h * 0.0022 * E.lw; strokeOutline(ctx, c, E, 1, h * 0.0025 * E.amp);
  }
};

STYLES.charcoal = {
  yMax: 0.75,
  bg(ctx, f, st, E) {
    const { w, h, p } = f;
    ctx.fillStyle = '#d6cdbb'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(grain(st, w, h, 'cp', (g, w, h) => paperGrain(g, w, h, 2.2, 11)), 0, 0);
    // soft smudged sky + cloud masses in a low-res buffer, scaled up = finger-blended charcoal
    const L = (st.sm && st.sm.canvas.width === Math.ceil(w / 8)) ? st.sm : (st.sm = buffer(Math.ceil(w / 8), Math.ceil(h / 8)));
    const g = L.ctx, lw = L.canvas.width, lh = L.canvas.height;
    g.clearRect(0, 0, lw, lh);
    const night = smooth(0.45, 0.05, p.light);
    const sk = g.createLinearGradient(0, 0, 0, lh);
    sk.addColorStop(0, `rgba(30,26,24,${0.45 + night * 0.4})`); sk.addColorStop(0.75, `rgba(30,26,24,${0.08 + night * 0.3})`); sk.addColorStop(1, 'rgba(30,26,24,0)');
    g.fillStyle = sk; g.fillRect(0, 0, lw, lh);
    for (let i = 0; i < 7; i++) { // diagonal smudge streaks
      g.strokeStyle = `rgba(30,26,24,${0.08 + hash(i, 1) * 0.1})`; g.lineWidth = lh * (0.05 + hash(i, 2) * 0.08);
      const y = hash(i, 3) * lh * 0.6; g.beginPath(); g.moveTo(-5, y); g.quadraticCurveTo(lw * 0.5, y + lh * 0.1 * (hash(i, 4) - 0.5), lw + 5, y - lh * 0.15); g.stroke();
    }
    g.save(); g.scale(1 / 8, 1 / 8);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    for (const c of E.clouds) { g.beginPath(); unionPath(g, c.puffs, 0, 0, 1.08); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    for (const c of E.clouds) {
      for (const q of c.puffs) {
        let x = q.x - c.sx * q.r * 0.55, y = q.y - c.sy * q.r * 0.55 + q.r * 0.25;
        let rg = g.createRadialGradient(x, y, 0, x, y, q.r * 1.05);
        rg.addColorStop(0, 'rgba(25,22,20,0.4)'); rg.addColorStop(1, 'rgba(25,22,20,0)');
        g.fillStyle = rg; g.fillRect(x - q.r * 1.1, y - q.r * 1.1, q.r * 2.2, q.r * 2.2);
        x = q.x + c.sx * q.r * 0.45; y = q.y + c.sy * q.r * 0.45;
        rg = g.createRadialGradient(x, y, 0, x, y, q.r * 0.75);
        rg.addColorStop(0, 'rgba(252,249,240,0.75)'); rg.addColorStop(1, 'rgba(252,249,240,0)');
        g.fillStyle = rg; g.fillRect(x - q.r, y - q.r, q.r * 2, q.r * 2);
      }
    }
    // sun/moon lifted out with an eraser
    g.globalCompositeOperation = 'destination-out';
    const rg = g.createRadialGradient(E.sun.x, E.sun.y, 0, E.sun.x, E.sun.y, h * 0.2);
    rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(0.3, 'rgba(0,0,0,0.9)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(E.sun.x - h * 0.2, E.sun.y - h * 0.2, h * 0.4, h * 0.4);
    g.restore();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(L.canvas, 0, 0, w, h);
    ctx.fillStyle = 'rgba(250,247,238,0.8)'; ctx.beginPath(); wobCircle(ctx, E.sun.x, E.sun.y, h * 0.045, h * 0.002, 1, E.bf); ctx.fill();
  },
  cloud(ctx, c, f, st, E) {
    const h = f.h;
    shade(ctx, st, c, E, 0.22, (g, b) => { g.strokeStyle = 'rgba(30,26,23,0.18)'; g.lineWidth = h * 0.003 * E.lw; hatch(g, b, 0.35, h * lerp(0.014, 0.006, E.shade), h * 0.006, c.seed + 3, E.bf); });
    ctx.lineCap = 'round';
    // outline: thick, broken, heavier facing away from the sun
    for (const r of c.runs) {
      const n = r.pts.length / 2;
      for (let k = 0; k < n - 1; k += 2) {
        const x = r.pts[k * 2], y = r.pts[k * 2 + 1], dot = ((x - r.cx) * c.sx + (y - r.cy) * c.sy) / r.r;
        if (hash(k, c.seed, E.bf) < 0.15) continue;
        const dark = dot < 0;
        ctx.strokeStyle = dark ? `rgba(28,24,22,${0.2 + -dot * 0.5})` : `rgba(253,251,245,${0.1 + dot * 0.35})`;
        ctx.lineWidth = h * (dark ? 0.0045 + -dot * 0.004 : 0.004) * E.lw;
        const seg = r.pts.slice(k * 2, Math.min(r.pts.length, k * 2 + 6));
        ctx.beginPath(); wobble(ctx, seg, h * 0.003 * E.amp, c.seed + k, E.bf); ctx.stroke();
      }
    }
  },
  fg(ctx, f, st, E) {
    // paper tooth breaks up the dark marks
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.5;
    ctx.drawImage(grain(st, f.w, f.h, 'tooth', (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const r = rng(5), n = w * h / 40; g.fillStyle = 'rgba(210,200,185,0.5)'; for (let i = 0; i < n; i++) g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }), 0, 0);
    ctx.restore();
  }
};

STYLES.chalk = {
  yMax: 0.55, layer: true,
  bg(ctx, f, st, E) {
    const { w, h } = f;
    ctx.drawImage(grain(st, w, h, 'board', (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#30503f'); gr.addColorStop(1, '#223a2e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 26; i++) { // old eraser smears
        g.strokeStyle = `rgba(230,240,230,${0.025 + r() * 0.035})`; g.lineWidth = h * (0.05 + r() * 0.08); g.lineCap = 'round';
        const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 4; k++) g.lineTo(x + (r() - 0.3) * w * 0.4, y + (r() - 0.5) * h * 0.2);
        g.stroke();
      }
      g.globalAlpha = 0.5; paperGrain(g, w, h, 1, 4); g.globalAlpha = 1;
    }), 0, 0);
  },
  layerDraw(g, f, st, E) {
    const { w, h, p } = f;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // heading
    g.font = `${(h * 0.055).toFixed(0)}px ${CHALK}`; g.fillStyle = 'rgba(245,245,235,0.9)'; g.textBaseline = 'top';
    g.fillText(E.night ? 'Tonight: clear-ish' : "Today's forecast: cloudy", h * 0.08 + (hash(E.bf) - 0.5) * 2, h * 0.075);
    g.strokeStyle = 'rgba(245,245,235,0.7)'; g.lineWidth = h * 0.004;
    g.beginPath(); wobLine(g, h * 0.08, h * 0.15, h * 0.08 + h * 0.62, h * 0.155, h * 0.003 * E.amp, 2, E.bf); g.stroke();
    // sun spiral or moon + stars
    if (E.night) {
      g.fillStyle = 'rgba(250,245,200,0.85)'; g.beginPath(); g.arc(E.sun.x, E.sun.y, h * 0.06, 0, TAU); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(E.sun.x + h * 0.03, E.sun.y - h * 0.015, h * 0.055, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(250,240,170,0.85)'; g.lineWidth = h * 0.003;
      for (let i = 0; i < 9; i++) { g.beginPath(); starPath(g, hash(i, 1) * w, h * (0.2 + hash(i, 2) * 0.35), h * (0.012 + hash(i, 3) * 0.012), hash(i, E.bf) * 0.2); g.stroke(); }
    } else {
      g.strokeStyle = 'rgba(250,230,120,0.9)'; g.lineWidth = h * 0.006;
      const pts = []; for (let k = 0; k < 60; k++) { const a = k * 0.42, r = h * 0.004 + k * h * 0.0011; pts.push(E.sun.x + Math.cos(a) * r, E.sun.y + Math.sin(a) * r); }
      g.beginPath(); wobble(g, pts, h * 0.002 * E.amp, 1, E.bf); g.stroke();
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + E.tq * 0.1; wobLine(g, E.sun.x + Math.cos(a) * h * 0.09, E.sun.y + Math.sin(a) * h * 0.09, E.sun.x + Math.cos(a) * h * 0.13, E.sun.y + Math.sin(a) * h * 0.13, h * 0.002, i, E.bf, 2); } g.stroke();
    }
    const cols = ['190,225,245', '245,198,214', '247,240,176', '235,235,235', '200,235,200'];
    for (const c of E.clouds) {
      const col = cols[c.seed % cols.length];
      g.save(); g.beginPath(); unionPath(g, c.puffs); g.clip();
      g.strokeStyle = `rgba(${col},0.45)`; g.lineWidth = h * 0.009 * E.lw;
      zigzag(g, c.bb.x0 - c.S, c.bb.y0, c.bb.x1, c.bb.y1, h * lerp(0.022, 0.012, E.shade), h * 0.01, c.seed, E.bf, -0.4);
      g.restore();
      shade(g, st, c, E, 0.3, (gg, b) => { gg.strokeStyle = 'rgba(130,160,200,0.6)'; gg.lineWidth = h * 0.006 * E.lw; hatch(gg, b, 0.9, h * lerp(0.02, 0.01, E.shade), h * 0.004, c.seed, E.bf); });
      g.strokeStyle = 'rgba(250,250,245,0.92)'; g.lineWidth = h * 0.0055 * E.lw;
      strokeOutline(g, c, E, 1, h * 0.003 * E.amp);
      g.strokeStyle = 'rgba(250,250,245,0.35)'; g.lineWidth = h * 0.003 * E.lw;
      strokeOutline(g, c, E, 1, h * 0.006 * E.amp, 9);
    }
    // chalk is grainy: knock holes in the whole layer
    g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.7;
    g.drawImage(grain(st, w, h, 'chalkspk', (gg, w, h) => speckle(gg, w, h, 0.5, 8, 1.8)), 0, 0); g.restore();
  },
  fg(ctx, f, st, E) {
    const { w, h } = f, fr = h * 0.035;
    ctx.drawImage(grain(st, w, h, 'frame', (g, w, h) => {
      const wood = g.createLinearGradient(0, 0, 0, fr); wood.addColorStop(0, '#9a6a3c'); wood.addColorStop(1, '#6e4524');
      g.fillStyle = '#7d5230'; g.fillRect(0, 0, w, fr); g.fillRect(0, h - fr * 1.5, w, fr * 1.5); g.fillRect(0, 0, fr, h); g.fillRect(w - fr, 0, fr, h);
      g.strokeStyle = 'rgba(40,20,5,0.35)'; g.lineWidth = 1; const r = rng(2);
      for (let i = 0; i < 70; i++) { const y = r() * fr; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (r() - 0.5) * 3); g.stroke(); const x = r() * fr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 3, h); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(fr, fr, w - fr * 2, h * 0.008); g.fillRect(fr, fr, h * 0.008, h - fr * 2.5);
      // chalk tray: sticks and an eraser
      g.fillStyle = '#5b3a1f'; g.fillRect(fr * 0.5, h - fr * 1.5, w - fr, fr * 0.35);
      const stick = (x, col, l) => { g.fillStyle = col; g.fillRect(x, h - fr * 1.32, l, fr * 0.28); };
      stick(w * 0.3, '#f4f1e6', h * 0.07); stick(w * 0.36, '#f5b8c8', h * 0.045); stick(w * 0.4, '#f8ec9a', h * 0.055);
      g.fillStyle = '#3c3f55'; g.fillRect(w * 0.62, h - fr * 1.62, h * 0.14, fr * 0.45); g.fillStyle = '#ddd6c0'; g.fillRect(w * 0.62, h - fr * 1.27, h * 0.14, fr * 0.12);
    }), 0, 0);
  }
};

STYLES.crayon = {
  yMax: 0.5, layer: true,
  bg(ctx, f, st, E) {
    const { w, h } = f;
    ctx.fillStyle = '#fcfbf6'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(grain(st, w, h, 'crp', (g, w, h) => paperGrain(g, w, h, 0.8, 21)), 0, 0);
  },
  layerDraw(g, f, st, E) {
    const { w, h, p } = f;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const night = E.night;
    // sky scribble: a band at the top (day) or the whole sky (night)
    g.strokeStyle = night ? 'rgba(40,40,120,0.85)' : p.light < 0.4 ? 'rgba(250,140,90,0.75)' : 'rgba(80,150,235,0.75)';
    g.lineWidth = h * 0.012;
    zigzag(g, -h * 0.2, -h * 0.02, w, h * (night ? 0.8 : 0.3), h * lerp(0.03, 0.014, E.shade), h * 0.05, 1, E.bf, 0.35);
    // rainbow
    if (!night) {
      const rc = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
      rc.forEach((col, i) => { g.strokeStyle = col; g.lineWidth = h * 0.02; g.beginPath(); wobCircle(g, w * 0.36, h * 0.92, h * (0.36 - i * 0.022), h * 0.004 * E.amp, i, E.bf, Math.PI * 1.08, Math.PI * 1.9, 30); g.stroke(); });
    }
    // ground with flowers, a tree and a house
    g.strokeStyle = 'rgba(70,170,60,0.9)'; g.lineWidth = h * 0.014;
    zigzag(g, -h * 0.1, h * 0.86, w, h * 1.02, h * 0.016, h * 0.03, 2, E.bf, 0.1);
    const hx = w * 0.78, hy = h * 0.86, hs = h * 0.17;
    g.strokeStyle = 'rgba(230,80,60,0.9)'; g.lineWidth = h * 0.012; zigzag(g, hx - hs * 0.5, hy - hs * 0.75, hx + hs * 0.5, hy, h * 0.014, h * 0.008, 5, E.bf, 0);
    g.strokeStyle = 'rgba(40,30,30,0.9)'; g.lineWidth = h * 0.005;
    g.beginPath(); wobLine(g, hx - hs * 0.5, hy, hx - hs * 0.5, hy - hs * 0.75, h * 0.002, 1, E.bf); wobLine(g, hx - hs * 0.5, hy - hs * 0.75, hx + hs * 0.5, hy - hs * 0.75, h * 0.002, 2, E.bf); wobLine(g, hx + hs * 0.5, hy - hs * 0.75, hx + hs * 0.5, hy, h * 0.002, 3, E.bf);
    wobLine(g, hx - hs * 0.62, hy - hs * 0.72, hx, hy - hs * 1.25, h * 0.002, 4, E.bf); wobLine(g, hx, hy - hs * 1.25, hx + hs * 0.62, hy - hs * 0.72, h * 0.002, 5, E.bf);
    g.rect(hx - hs * 0.1, hy - hs * 0.38, hs * 0.2, hs * 0.38); g.rect(hx + hs * 0.18, hy - hs * 0.6, hs * 0.18, hs * 0.16); g.stroke();
    g.strokeStyle = 'rgba(120,70,30,0.95)'; g.lineWidth = h * 0.018; g.beginPath(); wobLine(g, w * 0.12, h * 0.9, w * 0.12, h * 0.68, h * 0.003, 6, E.bf); g.stroke();
    g.strokeStyle = 'rgba(40,140,50,0.9)'; g.lineWidth = h * 0.012; g.beginPath();
    const pts = []; for (let k = 0; k < 80; k++) { const a = k * 0.7, r = h * (0.02 + 0.07 * fract(k * 0.137)); pts.push(w * 0.12 + Math.cos(a) * r * 1.1, h * 0.6 + Math.sin(a) * r); } wobble(g, pts, h * 0.003, 3, E.bf); g.stroke();
    for (let i = 0; i < 9; i++) {
      const x = w * (0.2 + hash(i, 1) * 0.5), y = h * (0.9 + hash(i, 2) * 0.06);
      g.strokeStyle = 'rgba(40,140,50,0.9)'; g.lineWidth = h * 0.005; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h * 0.04); g.stroke();
      g.fillStyle = ['#e53935', '#ec407a', '#ab47bc', '#ffb300'][i % 4]; for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; g.beginPath(); g.arc(x + Math.cos(a) * h * 0.011, y - h * 0.045 + Math.sin(a) * h * 0.011, h * 0.009, 0, TAU); g.fill(); }
      g.fillStyle = '#fdd835'; g.beginPath(); g.arc(x, y - h * 0.045, h * 0.007, 0, TAU); g.fill();
    }
    // sun (or moon) with a face, in the corner where suns belong
    const sx = h * 0.17, sy = h * lerp(0.4, 0.16, smooth(0.1, 0.7, p.light)), sr = h * 0.09;
    if (night) {
      g.fillStyle = 'rgba(250,230,120,0.95)'; g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(sx + sr * 0.55, sy - sr * 0.25, sr * 0.85, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
      g.strokeStyle = '#333'; g.lineWidth = h * 0.004; g.beginPath(); g.arc(sx - sr * 0.45, sy - sr * 0.1, sr * 0.12, 0.2, Math.PI - 0.2); g.stroke();
      g.fillStyle = 'rgba(250,230,120,0.95)'; for (let i = 0; i < 10; i++) { g.beginPath(); starPath(g, hash(i, 4) * w, h * (0.1 + hash(i, 5) * 0.55), h * 0.018, 0.2); g.fill(); }
    } else {
      g.strokeStyle = 'rgba(253,200,40,0.95)'; g.lineWidth = h * 0.01; g.beginPath();
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + E.tq * 0.15; wobLine(g, sx + Math.cos(a) * sr * 1.2, sy + Math.sin(a) * sr * 1.2, sx + Math.cos(a) * sr * 1.75, sy + Math.sin(a) * sr * 1.75, h * 0.003, i, E.bf, 2); }
      g.stroke();
      g.save(); g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.clip(); g.strokeStyle = 'rgba(255,215,40,0.95)'; g.lineWidth = h * 0.014; zigzag(g, sx - sr, sy - sr, sx + sr, sy + sr, h * 0.012, h * 0.01, 3, E.bf, 0.3); g.restore();
      g.strokeStyle = 'rgba(245,140,20,0.95)'; g.lineWidth = h * 0.007; g.beginPath(); wobCircle(g, sx, sy, sr, h * 0.003, 2, E.bf); g.stroke();
      g.fillStyle = '#2a2222'; g.beginPath(); g.arc(sx - sr * 0.35, sy - sr * 0.2, sr * 0.1, 0, TAU); g.arc(sx + sr * 0.35, sy - sr * 0.2, sr * 0.1, 0, TAU); g.fill();
      g.strokeStyle = '#2a2222'; g.lineWidth = h * 0.006; g.beginPath(); g.arc(sx, sy + sr * 0.05, sr * 0.45, 0.35, Math.PI - 0.35); g.stroke();
      g.fillStyle = 'rgba(240,100,100,0.5)'; g.beginPath(); g.arc(sx - sr * 0.55, sy + sr * 0.2, sr * 0.14, 0, TAU); g.arc(sx + sr * 0.55, sy + sr * 0.2, sr * 0.14, 0, TAU); g.fill();
    }
    // clouds: erase the sky to paper white, then a scribbly outline
    for (const c of E.clouds) {
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath(); unionPath(g, c.puffs); g.fill();
      g.globalCompositeOperation = 'source-over';
      shade(g, st, c, E, 0.3, (gg, b) => { gg.strokeStyle = 'rgba(150,160,190,0.6)'; gg.lineWidth = h * 0.01 * E.lw; zigzag(gg, b.x - h * 0.1, b.y, b.x + b.w, b.y + b.h, h * lerp(0.03, 0.014, E.shade), h * 0.02, c.seed, E.bf, 0.2); });
      g.strokeStyle = night ? 'rgba(220,220,240,0.95)' : 'rgba(40,90,190,0.95)'; g.lineWidth = h * 0.007 * E.lw;
      strokeOutline(g, c, E, 2, h * 0.006 * E.amp);
    }
    // birds
    g.strokeStyle = '#222'; g.lineWidth = h * 0.005; g.beginPath();
    for (let i = 0; i < 3; i++) { const x = wrap(hash(i, 7) * w + E.tq * h * 0.07, -30, w + 30), y = h * (0.42 + hash(i, 8) * 0.12), s = h * 0.02 * (1 + Math.sin(E.tq * 3 + i) * 0.15); g.moveTo(x - s, y - s * 0.5); g.quadraticCurveTo(x - s * 0.5, y - s, x, y); g.quadraticCurveTo(x + s * 0.5, y - s, x + s, y - s * 0.5); }
    g.stroke();
    // waxy gaps
    g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.85;
    g.drawImage(grain(st, w, h, 'wax', (gg, w, h) => speckle(gg, w, h, 0.35, 13, 3)), 0, 0); g.restore();
  }
};

STYLES.blueprint = {
  yMax: 0.55,
  bg(ctx, f, st, E) {
    const { w, h, p } = f;
    ctx.drawImage(grain(st, w, h, 'bp', (g, w, h) => {
      const gr = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, w * 0.75); gr.addColorStop(0, '#2160a8'); gr.addColorStop(1, '#16457e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const s = h / 40;
      for (let k = 0, x = 0; x < w; x += s, k++) { g.fillStyle = k % 5 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)'; g.fillRect(x, 0, 1, h); }
      for (let k = 0, y = 0; y < h; y += s, k++) { g.fillStyle = k % 5 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)'; g.fillRect(0, y, w, 1); }
      g.globalAlpha = 0.6; paperGrain(g, w, h, 1.2, 6); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(235,245,255,0.75)'; g.lineWidth = Math.max(1, h * 0.002); g.strokeRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06);
      g.lineWidth = Math.max(1, h * 0.001); g.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
      // title block
      const bw = h * 0.55, bh = h * 0.16, bx = w - h * 0.04 - bw, by = h - h * 0.04 - bh;
      g.fillStyle = 'rgba(22,69,126,0.9)'; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh);
      g.beginPath(); g.moveTo(bx, by + bh * 0.45); g.lineTo(bx + bw, by + bh * 0.45); g.moveTo(bx + bw * 0.55, by + bh * 0.45); g.lineTo(bx + bw * 0.55, by + bh); g.stroke();
      g.fillStyle = 'rgba(235,245,255,0.9)'; g.textBaseline = 'middle';
      g.font = `bold ${(h * 0.03).toFixed(0)}px ${TECH}`; g.fillText('CUMULUS HUMILIS — GEN. ARR.', bx + bh * 0.1, by + bh * 0.23);
      g.font = `${(h * 0.02).toFixed(0)}px ${TECH}`;
      g.fillText('DWG MC-0042  REV C', bx + bh * 0.1, by + bh * 0.62); g.fillText('SCALE 1:50 000', bx + bh * 0.1, by + bh * 0.84);
      g.fillText('DRAWN: M.C.', bx + bw * 0.58, by + bh * 0.62); g.fillText('SHEET 1 OF 1', bx + bw * 0.58, by + bh * 0.84);
    }), 0, 0);
    const line = 'rgba(235,245,255,0.85)', faint = 'rgba(235,245,255,0.35)';
    // datum line + ground hatch
    const gy = h * 0.82;
    ctx.strokeStyle = line; ctx.lineWidth = h * 0.0018;
    ctx.beginPath(); ctx.moveTo(h * 0.04, gy); ctx.lineTo(w - h * 0.6, gy); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(h * 0.04, gy, w - h * 0.64, h * 0.025); ctx.clip(); ctx.strokeStyle = faint; ctx.lineWidth = h * 0.0012; hatch(ctx, { x: 0, y: gy, w: w, h: h * 0.03 }, -0.8, h * 0.01, 0, 1, 0); ctx.restore();
    ctx.fillStyle = line; ctx.font = `${(h * 0.02).toFixed(0)}px ${TECH}`; ctx.textBaseline = 'bottom';
    ctx.fillText('DATUM ±0.00 (MSL)', h * 0.06, gy - h * 0.006);
    // sun with elevation angle
    const ox = h * 0.06 + h * 0.3, el = Math.atan2(gy - E.sun.y, E.sun.x - ox);
    ctx.strokeStyle = faint; ctx.setLineDash([h * 0.012, h * 0.008]);
    ctx.beginPath(); ctx.moveTo(ox, gy); ctx.lineTo(E.sun.x, E.sun.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.arc(ox, gy, h * 0.12, -el, 0); ctx.stroke();
    ctx.fillText(`α = ${(el * 180 / Math.PI).toFixed(1)}°`, ox + h * 0.13, gy - h * 0.03);
    ctx.beginPath(); ctx.arc(E.sun.x, E.sun.y, h * 0.045, 0, TAU); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2; ctx.moveTo(E.sun.x + Math.cos(a) * h * 0.06, E.sun.y + Math.sin(a) * h * 0.06); ctx.lineTo(E.sun.x + Math.cos(a) * h * 0.085, E.sun.y + Math.sin(a) * h * 0.085); } ctx.stroke();
    ctx.beginPath(); ctx.moveTo(E.sun.x - h * 0.06, E.sun.y); ctx.lineTo(E.sun.x + h * 0.06, E.sun.y); ctx.moveTo(E.sun.x, E.sun.y - h * 0.06); ctx.lineTo(E.sun.x, E.sun.y + h * 0.06); ctx.stroke();
    ctx.textBaseline = 'top'; ctx.fillText(E.night ? 'MOON' : 'SOL', E.sun.x + h * 0.05, E.sun.y + h * 0.05);
  },
  cloud(ctx, c, f, st, E, idx) {
    const h = f.h, line = 'rgba(235,245,255,0.9)', faint = 'rgba(235,245,255,0.3)', T = h * 0.0015;
    ctx.fillStyle = 'rgba(30,90,160,0.85)'; ctx.beginPath(); unionPath(ctx, c.puffs); ctx.fill();
    ctx.strokeStyle = faint; ctx.lineWidth = T * 0.8; ctx.setLineDash([h * 0.01, h * 0.006]);
    ctx.beginPath(); unionPath(ctx, c.puffs); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); for (const q of c.puffs) { const s = h * 0.008; ctx.moveTo(q.x - s, q.y); ctx.lineTo(q.x + s, q.y); ctx.moveTo(q.x, q.y - s); ctx.lineTo(q.x, q.y + s); } ctx.stroke();
    shade(ctx, st, c, E, 0.3, (g, b) => { g.strokeStyle = 'rgba(235,245,255,0.28)'; g.lineWidth = T; hatch(g, b, 0.785, h * lerp(0.02, 0.009, E.shade), 0, 1, 0); });
    ctx.strokeStyle = line; ctx.lineWidth = h * 0.0022 * E.lw; strokeOutline(ctx, c, E, 1, h * 0.0012 * E.amp);
    // annotations
    ctx.fillStyle = line; ctx.strokeStyle = line; ctx.lineWidth = T; ctx.font = `${(h * 0.019).toFixed(0)}px ${TECH}`;
    const base = c.y, km = v => (v / h * 12).toFixed(2);
    const arrow = (x, y, a) => { const s = h * 0.012; ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a - 0.3) * s, y - Math.sin(a - 0.3) * s); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a + 0.3) * s, y - Math.sin(a + 0.3) * s); };
    if (idx % 2 === 0) {
      const dy = base + h * 0.05, x0 = c.bb.x0, x1 = c.bb.x1;
      ctx.beginPath(); ctx.moveTo(x0, base); ctx.lineTo(x0, dy + h * 0.012); ctx.moveTo(x1, base); ctx.lineTo(x1, dy + h * 0.012);
      ctx.moveTo(x0, dy); ctx.lineTo(x1, dy); arrow(x1, dy, 0); arrow(x0, dy, Math.PI); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(`${km(x1 - x0)} km`, (x0 + x1) / 2, dy - h * 0.004);
    } else {
      const x = c.bb.x0 - h * 0.025, gy = h * 0.82;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, base); arrow(x, base, -Math.PI / 2); arrow(x, gy, Math.PI / 2);
      ctx.moveTo(x - h * 0.012, base); ctx.lineTo(c.bb.x0 + c.S * 0.3, base); ctx.stroke();
      ctx.save(); ctx.translate(x - h * 0.008, (gy + base) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`ALT ${Math.round((gy - base) / h * 4000)} m`, 0, 0); ctx.restore();
    }
    const big = c.puffs.reduce((a, b) => b.r > a.r ? b : a), a = -0.8;
    ctx.beginPath(); ctx.moveTo(big.x, big.y); ctx.lineTo(big.x + Math.cos(a) * big.r, big.y + Math.sin(a) * big.r);
    arrow(big.x + Math.cos(a) * big.r, big.y + Math.sin(a) * big.r, a); ctx.lineTo(big.x + Math.cos(a) * big.r * 1.35, big.y + Math.sin(a) * big.r * 1.35); ctx.lineTo(big.x + Math.cos(a) * big.r * 1.35 + h * 0.06, big.y + Math.sin(a) * big.r * 1.35); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`R ${km(big.r)}`, big.x + Math.cos(a) * big.r * 1.35 + h * 0.005, big.y + Math.sin(a) * big.r * 1.35 - h * 0.003);
    const tx = c.bb.x1 - c.S * 0.2, ty = c.bb.y0 - h * 0.01;
    ctx.beginPath(); ctx.arc(tx, ty, h * 0.022, 0, TAU); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`C${idx + 1}`, tx, ty);
  }
};

STYLES.ballpoint = {
  yMax: 0.8,
  bg(ctx, f, st, E) {
    const { w, h, p } = f;
    ctx.drawImage(grain(st, w, h, 'bpp', (g, w, h) => {
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h); paperGrain(g, w, h, 0.7, 31);
      // a coffee ring
      const x = w * 0.86, y = h * 0.78, r = h * 0.13;
      g.strokeStyle = 'rgba(150,100,50,0.18)'; g.lineWidth = h * 0.012; g.beginPath(); g.arc(x, y, r, 0.3, TAU - 0.4); g.stroke();
      g.lineWidth = h * 0.004; g.strokeStyle = 'rgba(130,85,40,0.22)'; g.beginPath(); g.arc(x + 2, y + 1, r * 1.02, 0, TAU * 0.8); g.stroke();
      g.fillStyle = 'rgba(160,110,60,0.05)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }), 0, 0);
    const ink = 'rgba(28,45,140,0.85)';
    ctx.strokeStyle = ink; ctx.lineWidth = h * 0.0017 * E.lw;
    // scribbled sun: a ball of loops
    ctx.save(); ctx.beginPath(); ctx.arc(E.sun.x, E.sun.y, h * 0.06, 0, TAU); ctx.clip();
    loops(ctx, { x: E.sun.x - h * 0.07, y: E.sun.y - h * 0.07, w: h * 0.14, h: h * 0.14 }, h * 0.012, h * (E.night ? 0.006 : 0.016), 1, E.bf); ctx.restore();
    ctx.beginPath(); wobCircle(ctx, E.sun.x, E.sun.y, h * 0.062, h * 0.002 * E.amp, 2, E.bf, 0, TAU * 1.1); ctx.stroke();
    // wind swirls
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = wrap(hash(i, 1) * w + E.tq * h * 0.08 * windDir(p.wind)[0], -h * 0.3, w + h * 0.1), y = h * (0.7 + hash(i, 2) * 0.15), pts = [];
      for (let k = 0; k < 40; k++) { const s = k / 39; pts.push(x + s * h * 0.25, y + Math.sin(s * 6) * h * 0.01); }
      for (let k = 0; k < 18; k++) { const a = k / 17 * TAU * 1.2, r = h * 0.03 * (1 - k / 22); pts.push(x + h * 0.25 + Math.sin(a) * r, y - h * 0.03 + Math.cos(a) * r); }
      wobble(ctx, pts, h * 0.002 * E.amp, i, E.bf);
    }
    ctx.stroke();
  },
  cloud(ctx, c, f, st, E) {
    const h = f.h, ink = 'rgba(28,45,140,0.85)';
    ctx.fillStyle = '#fbfaf6'; ctx.beginPath(); unionPath(ctx, c.puffs); ctx.fill();
    shade(ctx, st, c, E, 0.4, (g, b) => { g.strokeStyle = 'rgba(28,45,140,0.55)'; g.lineWidth = h * 0.0014 * E.lw; loops(g, b, h * 0.015, h * lerp(0.04, 0.019, E.shade), c.seed, E.bf); }, 0.85);
    if (E.shade > 0.4) shade(ctx, st, c, E, 0.15, (g, b) => { g.strokeStyle = 'rgba(28,45,140,0.45)'; g.lineWidth = h * 0.0014 * E.lw; loops(g, b, h * 0.009, h * lerp(0.025, 0.01, E.shade), c.seed + 5, E.bf); });
    ctx.strokeStyle = ink; ctx.lineWidth = h * 0.0018 * E.lw; strokeOutline(ctx, c, E, 3, h * 0.005 * E.amp);
  }
};

STYLES.marker = {
  yMax: 0.8,
  bg(ctx, f, st, E) {
    const { w, h } = f;
    ctx.drawImage(grain(st, w, h, 'nb', (g, w, h) => {
      g.fillStyle = '#fdfdf7'; g.fillRect(0, 0, w, h); paperGrain(g, w, h, 0.5, 41);
      const sp = h / 18;
      g.fillStyle = 'rgba(90,150,220,0.45)'; for (let y = h * 0.14; y < h; y += sp) g.fillRect(0, y, w, Math.max(1, h * 0.0015));
      g.fillStyle = 'rgba(230,80,90,0.6)'; g.fillRect(h * 0.2, 0, Math.max(1, h * 0.002), h); g.fillRect(h * 0.21, 0, Math.max(1, h * 0.0012), h);
      for (const y of [0.2, 0.5, 0.8]) { g.fillStyle = '#2b2f36'; g.beginPath(); g.arc(h * 0.08, h * y, h * 0.028, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = h * 0.004; g.stroke(); }
    }), 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // sun doodle: spiral + triangle rays, highlighted yellow
    const s = E.sun;
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = E.night ? 'rgba(180,200,255,0.8)' : 'rgba(255,235,60,0.8)';
    ctx.beginPath(); ctx.arc(s.x + h * 0.01, s.y + h * 0.008, h * 0.06, 0, TAU); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(20,20,25,0.92)'; ctx.lineWidth = h * 0.005 * E.lw;
    ctx.beginPath(); wobCircle(ctx, s.x, s.y, h * 0.06, h * 0.002 * E.amp, 1, E.bf); ctx.stroke();
    if (E.night) { ctx.beginPath(); wobCircle(ctx, s.x + h * 0.025, s.y - h * 0.01, h * 0.05, h * 0.002, 2, E.bf, 1.9, 4.4, 14); ctx.stroke(); }
    else {
      ctx.lineWidth = h * 0.003 * E.lw; const pts = []; for (let k = 0; k < 40; k++) { const a = k * 0.45, r = k * h * 0.0011; pts.push(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r); }
      ctx.beginPath(); wobble(ctx, pts, h * 0.0015, 3, E.bf); ctx.stroke();
      ctx.lineWidth = h * 0.005 * E.lw; ctx.beginPath();
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + Math.sin(E.tq * 0.3) * 0.1; wobLine(ctx, s.x + Math.cos(a) * h * 0.08, s.y + Math.sin(a) * h * 0.08, s.x + Math.cos(a) * h * 0.11, s.y + Math.sin(a) * h * 0.11, h * 0.002, i, E.bf, 2); }
      ctx.stroke();
    }
    // margin notes
    ctx.fillStyle = 'rgba(30,60,170,0.85)'; ctx.font = `${(h * 0.04).toFixed(0)}px ${HAND}`; ctx.textBaseline = 'alphabetic';
    ctx.save(); ctx.translate(h * 0.24 + (hash(E.bf) - 0.5) * 1.5, h * 0.1); ctx.rotate(-0.03); ctx.fillText('weather journal — p. 42', 0, 0); ctx.restore();
  },
  cloud(ctx, c, f, st, E, idx) {
    const h = f.h, cols = ['255,238,88', '128,222,234', '244,143,177', '165,214,167', '206,147,216'];
    const col = cols[c.seed % cols.length], ox = c.S * 0.07, oy = c.S * 0.05;
    ctx.fillStyle = '#fdfdf7'; ctx.beginPath(); unionPath(ctx, c.puffs); ctx.fill();
    // highlighter: overlapping chisel strokes, slightly off-register
    ctx.save(); ctx.beginPath(); unionPath(ctx, c.puffs, ox, oy, 0.96); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = `rgba(${col},0.6)`; ctx.lineWidth = c.S * lerp(0.35, 0.18, E.shade); ctx.lineCap = 'butt';
    ctx.beginPath(); for (let y = c.bb.y0, i = 0; y < c.bb.y1 + c.S; y += ctx.lineWidth * 0.8, i++) wobLine(ctx, c.bb.x0, y, c.bb.x1 + c.S * 0.3, y + c.S * 0.08, h * 0.002, i + c.seed, 0, 3);
    ctx.stroke(); ctx.restore();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,20,25,0.92)'; ctx.lineWidth = h * 0.0055 * E.lw; strokeOutline(ctx, c, E, 1, h * 0.003 * E.amp);
    // doodles: rain drops under some clouds, a star or an arrow note on others
    ctx.lineWidth = h * 0.004 * E.lw;
    if (idx % 3 === 0) {
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const x = lerp(c.bb.x0 + c.S * 0.4, c.bb.x1 - c.S * 0.4, k / 3), y = c.y + c.S * (0.3 + (k % 2) * 0.25) + fract(E.tq * 0.6 + k * 0.3) * c.S * 0.2, d = c.S * 0.09;
        ctx.moveTo(x, y - d * 1.8); ctx.quadraticCurveTo(x + d, y, x, y + d * 0.6); ctx.quadraticCurveTo(x - d, y, x, y - d * 1.8); }
      ctx.stroke();
    } else if (idx % 3 === 1) {
      ctx.beginPath(); starPath(ctx, c.bb.x1 + c.S * 0.15, c.bb.y0 + c.S * 0.1, c.S * 0.15, hash(E.bf, idx) * 0.15); ctx.stroke();
    } else {
      const x = c.bb.x1 + c.S * 0.1, y = c.y + c.S * 0.3;
      ctx.beginPath(); wobLine(ctx, x + c.S * 0.6, y + c.S * 0.35, x, y, h * 0.002, idx, E.bf, 4); ctx.moveTo(x, y); ctx.lineTo(x + c.S * 0.14, y + c.S * 0.02); ctx.moveTo(x, y); ctx.lineTo(x + c.S * 0.04, y + c.S * 0.13); ctx.stroke();
      ctx.fillStyle = 'rgba(20,20,25,0.92)'; ctx.font = `${(h * 0.035).toFixed(0)}px ${HAND}`; ctx.fillText('fluffy!', x + c.S * 0.62, y + c.S * 0.5);
    }
  }
};

// ---------- engine ----------
export default {
  id: 'sketch',
  name: 'Sketchbook',
  kind: '2d',
  res: 1,
  params: [
    { id: 'x1', label: 'Wobble', value: 0.5 },
    { id: 'x2', label: 'Shading', value: 0.5 },
    { id: 'x3', label: 'Line weight', value: 0.5 },
    { id: 'x4', label: 'Boil rate', value: 0.4 },
  ],
  create(ctx, opts) {
    const style = STYLES[opts.style] || STYLES.pencil;
    const st = { spawn: [], lastBf: null, tq: 0 };
    return {
      render(f) {
        const { w, h, p } = f;
        const fps = lerp(3, 14, p.x4), bf = Math.floor(f.clock * fps);
        if (bf !== st.lastBf || f.dt === 0 && st.tq !== f.t && Math.abs(st.tq - f.t) > 1) { st.lastBf = bf; st.tq = f.t; }
        for (const c of f.pointer.clicks || []) { st.spawn.push({ x: c.x * w, y: c.y * h + h * 0.05, t0: st.tq, seed: 500 + (Math.random() * 1000 | 0) }); if (st.spawn.length > 6) st.spawn.shift(); }
        st.spawn = st.spawn.filter(q => Math.abs(st.tq - q.t0) < 40);
        if (!st.hb || st.hb.canvas.width !== w || st.hb.canvas.height !== h) st.hb = buffer(w, h);
        const l = p.light;
        const E = { w, h, bf, tq: st.tq, amp: lerp(0.1, 2.2, p.x1), shade: p.x2, lw: lerp(0.5, 1.8, p.x3), seed: opts.seed || 0, yMax: style.yMax,
          night: l < 0.15, sun: { x: w - h * 0.32, y: l < 0.15 ? h * lerp(0.17, 0.6, l / 0.15) : h * lerp(0.6, 0.17, smooth(0.15, 0.8, l)) } };
        E.clouds = layout(f, st, E);
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        style.bg(ctx, f, st, E);
        if (style.layer) {
          if (!st.layer || st.layer.canvas.width !== w || st.layer.canvas.height !== h) st.layer = buffer(w, h);
          const g = st.layer.ctx; g.clearRect(0, 0, w, h); g.save(); style.layerDraw(g, f, st, E); g.restore();
          ctx.drawImage(st.layer.canvas, 0, 0);
        } else {
          E.clouds.forEach((c, i) => { ctx.save(); style.cloud(ctx, c, f, st, E, i); ctx.restore(); });
        }
        if (style.fg) style.fg(ctx, f, st, E);
        ctx.restore();
      }
    };
  }
};

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'sketch-' + id, name, desc, opts, params, tags: ['art', '2d', ...tags] });
export const scenes = [
  d('pencil', 'Graphite Study', 'Pencil clouds on cream paper, hatched and cross-hatched, lines gently boiling.',
    { style: 'pencil' }, { speed: 0.4, scale: 0.55, coverage: 0.45, detail: 0.6, light: 0.8, x1: 0.45, x2: 0.55, x3: 0.5, x4: 0.4 }),
  d('charcoal', 'Charcoal Smudge', 'Finger-blended charcoal skies with chalk-white highlights on toned paper.',
    { style: 'charcoal', seed: 3 }, { speed: 0.35, scale: 0.7, coverage: 0.5, detail: 0.5, light: 0.55, x1: 0.6, x2: 0.5, x3: 0.6, x4: 0.35 }, ['moody']),
  d('chalk', 'Chalkboard Forecast', "Pastel chalk clouds on a classroom blackboard, today's forecast scrawled above.",
    { style: 'chalk', seed: 5 }, { speed: 0.4, scale: 0.5, coverage: 0.45, detail: 0.5, light: 0.8, x1: 0.5, x2: 0.5, x3: 0.5, x4: 0.4 }, ['cartoon']),
  d('crayon', "Crayon Afternoon", 'A kid’s waxy crayon drawing: smiling sun, rainbow, house and scribbled sky.',
    { style: 'crayon', seed: 2 }, { speed: 0.4, scale: 0.5, coverage: 0.35, detail: 0.4, light: 0.85, x1: 0.6, x2: 0.5, x3: 0.6, x4: 0.45 }, ['cartoon', 'pastel']),
  d('blueprint', 'Cloud Blueprint', 'Technical drawings of cumulus: construction circles, dimensions and a title block.',
    { style: 'blueprint', seed: 4 }, { speed: 0.35, scale: 0.5, coverage: 0.3, detail: 0.5, light: 0.7, x1: 0.3, x2: 0.4, x3: 0.5, x4: 0.25 }, ['stylized']),
  d('ballpoint', 'Ballpoint Daydream', 'Blue ballpoint clouds, shaded with curly loops on a page with a coffee ring.',
    { style: 'ballpoint', seed: 6 }, { speed: 0.4, scale: 0.55, coverage: 0.45, detail: 0.55, light: 0.75, x1: 0.5, x2: 0.55, x3: 0.5, x4: 0.4 }),
  d('marker', 'Notebook Doodles', 'Fat marker and highlighter clouds doodled over a lined school notebook.',
    { style: 'marker', seed: 8 }, { speed: 0.4, scale: 0.5, coverage: 0.4, detail: 0.45, light: 0.85, x1: 0.5, x2: 0.5, x3: 0.5, x4: 0.4 }, ['cartoon', 'pastel']),
];
