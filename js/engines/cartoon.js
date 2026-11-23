// Cartoon clouds: puffy circle clusters with bold outlines, flat two-tone shading and faces.
// Each scene (opts.mode) paints its own backdrop and props; clouds bob and squash, and clicks pop in new ones.
import { clamp, lerp, wrap, rng, hash, fract, windX, buffer } from '../util.js';

const TAU = Math.PI * 2;

// A cloud outline in unit space: a row of top bumps (biggest in the middle) over a flat-ish base row.
function makeShape(rand, detail, flat = 0) {
  const n = 3 + Math.round(detail * 3) + (rand() * 2 | 0);
  const b = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) * 2 - 1, mid = 1 - Math.abs(u);
    const r = 0.34 + 0.32 * mid + rand() * 0.1;
    b.push({ x: u * 1.0 + (rand() - 0.5) * 0.12, y: 0.1 - r * 0.5 - mid * 0.22, r });
  }
  const m = 3 + Math.round(detail * 2);
  for (let j = 0; j < m; j++) { const u = j / (m - 1) * 2 - 1; b.push({ x: u * 1.08, y: 0.2 - flat * 0.05, r: 0.3 + rand() * 0.06 }); }
  return b;
}

function circles(g, b, grow = 0, dx = 0, dy = 0, wob = null) {
  g.beginPath();
  for (const c of b) {
    const r = Math.max(0.01, c.r + grow + (wob ? wob(c) : 0));
    g.moveTo(c.x + dx + r, c.y + dy); g.arc(c.x + dx, c.y + dy, r, 0, TAU);
  }
}

// Draw one cloud. st: { fill, shade, outline, ow (px), lift, hi, shadow, wob, squash, rot, face(g) }
function drawCloud(g, shape, x, y, R, st) {
  g.save();
  g.translate(x, y);
  if (st.rot) g.rotate(st.rot);
  const sq = st.squash || 0;
  g.scale(R * (1 + sq), R * (1 - sq));
  const ow = (st.ow || 0) / R;
  if (ow > 0 || st.shadow) {
    if (st.shadow) { g.shadowColor = st.shadow; g.shadowBlur = R * 0.22; g.shadowOffsetX = R * 0.06; g.shadowOffsetY = R * 0.12; }
    circles(g, shape, ow, 0, 0, st.wob); g.fillStyle = st.outline || st.shade; g.fill();
    g.shadowColor = 'transparent';
  }
  circles(g, shape, 0, 0, 0, st.wob); g.fillStyle = st.shade; g.fill();
  g.save(); g.clip();
  circles(g, shape, 0, 0, -(st.lift ?? 0.13), st.wob); g.fillStyle = st.fill; g.fill();
  if (st.hi) {
    g.strokeStyle = st.hi; g.lineWidth = 0.07; g.lineCap = 'round';
    const top = shape.slice(0, Math.max(1, shape.length - 4)).sort((a, b) => a.y - a.r - (b.y - b.r)).slice(0, 2);
    for (const c of top) { g.beginPath(); g.arc(c.x - c.r * 0.05, c.y, c.r * 0.68, Math.PI * 1.18, Math.PI * 1.42); g.stroke(); }
  }
  g.restore();
  if (st.face) st.face(g);
  g.restore();
}

const blink = (t, s) => { const b = fract(t / (3.2 + s * 2) + s * 7.1); return b > 0.955 ? Math.abs((b - 0.9775) / 0.0225) : 1; };

// Faces drawn in cloud unit space (centre of the cloud ≈ (0, -0.15)).
function face(kind, t, seed, look, lw, ink = '#2a2233') {
  return g => {
    const e = blink(t, seed), lx = look[0] * 0.05, ly = look[1] * 0.04;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = lw; g.strokeStyle = ink; g.fillStyle = ink;
    const ey = -0.18;
    if (kind === 'sleep') {
      for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 0.27, ey - 0.02, 0.09, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      const br = 0.035 + 0.02 * Math.sin(t * 1.6 + seed * 5);
      g.beginPath(); g.ellipse(0.02, 0.06, br * 0.8, br, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,140,190,0.45)';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.43, 0.0, 0.09, 0.05, 0, 0, TAU); g.fill(); }
      return;
    }
    if (kind === 'mario') {
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.17 + lx * 0.5, ey - 0.02, 0.055, 0.14 * e + 0.01, 0, 0, TAU); g.fill(); }
      return;
    }
    if (kind === 'hose') {
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(s * 0.17, ey - 0.04, 0.1, 0.19 * e + 0.01, 0, 0, TAU); g.fillStyle = ink; g.fill();
        if (e > 0.5) { g.beginPath(); g.moveTo(s * 0.17 + lx, ey - 0.04 + ly); g.arc(s * 0.17 + lx, ey - 0.04 + ly, 0.16, -1.9, -1.35); g.closePath(); g.fillStyle = '#fff'; g.fill(); }
      }
      g.beginPath(); g.moveTo(-0.32, 0.04); g.quadraticCurveTo(0, 0.42, 0.32, 0.04); g.quadraticCurveTo(0, 0.18, -0.32, 0.04);
      g.fillStyle = ink; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(0, 0.2, 0.09, 0.05, 0, 0, TAU); g.fillStyle = '#777'; g.fill();
      return;
    }
    // kawaii / sad / grumpy
    const big = kind === 'grumpy' ? 0.075 : 0.07;
    for (const s of [-1, 1]) {
      const x = s * 0.27;
      if (kind === 'grumpy') {
        g.beginPath(); g.ellipse(x, ey, 0.1, 0.1 * e + 0.005, 0, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.stroke();
        g.beginPath(); g.arc(x + lx, ey + ly + 0.02, 0.045 * Math.min(1, e * 1.5), 0, TAU); g.fillStyle = ink; g.fill();
        g.lineWidth = lw * 1.6; g.beginPath(); g.moveTo(x - s * 0.13, ey - 0.17); g.lineTo(x + s * 0.11, ey - 0.08); g.stroke(); g.lineWidth = lw;
      } else {
        g.beginPath(); g.ellipse(x + lx, ey + ly, big * 0.85, big * e + 0.004, 0, 0, TAU); g.fillStyle = ink; g.fill();
        if (e > 0.6) { g.beginPath(); g.arc(x + lx - 0.022, ey + ly - 0.03, 0.022, 0, TAU); g.fillStyle = '#fff'; g.fill(); }
      }
    }
    if (kind !== 'grumpy') {
      g.fillStyle = kind === 'sad' ? 'rgba(130,160,255,0.45)' : 'rgba(255,120,170,0.5)';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.45, -0.04, 0.1, 0.055, 0, 0, TAU); g.fill(); }
    }
    g.beginPath();
    if (kind === 'kawaii') { g.arc(-0.055, -0.07, 0.055, 0.15 * Math.PI, 0.9 * Math.PI); g.moveTo(0.11, -0.04); g.arc(0.055, -0.07, 0.055, 0.1 * Math.PI, 0.85 * Math.PI); }
    else if (kind === 'sad') { g.arc(0, 0.02, 0.09, 1.15 * Math.PI, 1.85 * Math.PI); }
    else { g.moveTo(-0.15, 0.02); g.lineTo(-0.07, -0.03); g.lineTo(0, 0.02); g.lineTo(0.07, -0.03); g.lineTo(0.15, 0.02); }
    g.lineWidth = lw; g.strokeStyle = ink; g.stroke();
    if (kind === 'sad') {
      const a = fract(t * 0.5 + seed);
      g.beginPath(); g.ellipse(-0.3, ey + 0.08 + a * 0.25, 0.025, 0.04, 0, 0, TAU); g.fillStyle = `rgba(120,170,255,${1 - a})`; g.fill();
    }
  };
}

// Per-mode look: sky colours, cloud style, which faces, vertical band for clouds.
const STYLES = {
  classic:  { top: '#2f8de4', bot: '#bfe8ff', fill: '#ffffff', shade: '#c4dcf4', outline: '#1f3a5f', hi: null, ow: 0.035, band: [0.08, 0.6], face: null, big: 1.15 },
  kawaii:   { top: '#ffc9e3', bot: '#cdeeff', fill: '#ffffff', shade: '#f7d3ea', outline: '#5b4560', hi: 'rgba(255,255,255,0)', ow: 0.022, band: [0.12, 0.62], face: 'kawaii', big: 1.25 },
  mario:    { top: '#5c94fc', bot: '#5c94fc', fill: '#ffffff', shade: '#a4e4fc', outline: '#000000', ow: 0.035, band: [0.06, 0.42], face: 'mario', lift: 0.16 },
  storm:    { top: '#262b3d', bot: '#4b5368', fill: '#7c8598', shade: '#545c70', outline: '#141720', ow: 0.03, band: [0.02, 0.36], face: 'grumpy', big: 1.6 },
  simpsons: { top: '#1b63c6', bot: '#86c8f4', fill: '#ffffff', shade: '#cfe0f3', outline: null, ow: 0, band: [0, 1], face: null, lift: 0.1 },
  sticker:  { top: '#86c9e6', bot: '#a8dcef', fill: '#ffffff', shade: '#e6e6e6', outline: '#ffffff', ow: 0.03, band: [0.1, 0.75], face: null, lift: 0.08, big: 1.3 },
  bedtime:  { top: '#0a1238', bot: '#2b2d6e', fill: '#8a90d6', shade: '#5f64ab', outline: '#1a1c48', hi: 'rgba(200,205,255,0.7)', ow: 0.022, band: [0.3, 0.78], face: 'sleep', big: 1.2 },
  hose:     { top: '#9c9c9c', bot: '#e2e2e2', fill: '#fafafa', shade: '#c9c9c9', outline: '#0d0d0d', ow: 0.04, band: [0.12, 0.5], face: 'hose', big: 1.35 },
  sunset:   { top: '#7a6bb8', bot: '#ffd3a1', fill: '#ffe3d0', shade: '#f2b8b8', outline: null, ow: 0, band: [0.04, 0.42], face: null, lift: 0.18, big: 0.9 },
};
const STICKERS = ['#ffffff', '#fff1a8', '#ffc8dd', '#c9ecc0', '#d5c2ec', '#bfe0ff', '#ffd6a5'];

export default {
  id: 'cartoon',
  name: 'Cartoon',
  kind: '2d',
  params: [
    { id: 'x1', label: 'Outline', value: 0.5 },
    { id: 'x2', label: 'Bounce', value: 0.5 },
    { id: 'x3', label: 'Faces', value: 0.5 },
    { id: 'x4', label: 'Extras', value: 0.5 },
  ],
  create(ctx, opts) {
    const mode = opts.mode || 'classic', S = STYLES[mode] || STYLES.classic;
    const MAX = 16;
    let clouds = [], shapeKey = -1, spawned = [], grain = null, grainPat = null, paper = null, lastT = null;
    const base = [];
    { const r = rng(opts.seed || 7);
      for (let i = 0; i < MAX; i++) base.push({ x0: r(), y: r(), size: 0.75 + r() * 0.5, depth: r(), seed: r(), rot: (r() - 0.5) * 0.3, color: STICKERS[i % STICKERS.length], z: r() }); }
    base.sort((a, b) => a.depth - b.depth);
    function shapes(detail) {
      const k = Math.round(detail * 3); if (k === shapeKey) return; shapeKey = k;
      clouds = base.map((c, i) => ({ ...c, shape: makeShape(rng(1000 + i * 31), k / 3, mode === 'mario' ? 1 : 0) }));
    }

    function sky(g, w, h, top, bot) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    // night/dusk tint for daytime scenes, driven by the Light control
    function tint(g, w, h, light) {
      const n = clamp((0.62 - light) / 0.62), d = Math.max(0, 1 - Math.abs(light - 0.32) / 0.22);
      if (d > 0.01) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = `rgba(255,110,40,${d * 0.7})`; g.fillRect(0, 0, w, h); }
      if (n > 0.01) { g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(${lerp(255, 40, n) | 0},${lerp(255, 50, n) | 0},${lerp(255, 120, n) | 0},1)`; g.fillRect(0, 0, w, h); }
      g.globalCompositeOperation = 'source-over';
    }

    function look(f, x, y, s) {
      if (!f.pointer.moved) return [Math.sin(f.t * 0.4 + s * 9), Math.cos(f.t * 0.3 + s * 5) * 0.5];
      const dx = f.pointer.x * f.w - x, dy = f.pointer.y * f.h - y, l = Math.hypot(dx, dy) + 1e-3;
      return [dx / l, dy / l];
    }

    function sun(g, x, y, r, t, ow, ink, c1 = '#ffd23f', c2 = '#ffe66d') {
      g.save(); g.translate(x, y); g.rotate(t * 0.15);
      g.fillStyle = c1; g.strokeStyle = ink; g.lineWidth = ow; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, a2 = a + TAU / 24, l = r * (1.55 + 0.12 * Math.sin(t * 3 + i)); g.moveTo(Math.cos(a - 0.12) * r * 1.1, Math.sin(a - 0.12) * r * 1.1); g.lineTo(Math.cos(a2) * l, Math.sin(a2) * l); g.lineTo(Math.cos(a + 0.36) * r * 1.1, Math.sin(a + 0.36) * r * 1.1); }
      g.fill(); if (ow) g.stroke();
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = c2; g.fill(); if (ow) g.stroke();
      g.restore();
    }

    function birds(g, w, h, t, n, ink) {
      g.strokeStyle = ink; g.lineWidth = h * 0.004; g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = wrap(hash(i, 3) * w * 1.4 + t * h * (0.05 + hash(i) * 0.04), -w * 0.2, w * 1.2), y = h * (0.15 + hash(i, 9) * 0.35) + Math.sin(t + i) * h * 0.02;
        const s = h * (0.012 + hash(i, 5) * 0.01), fl = Math.sin(t * 7 + i * 2) * s * 0.7;
        g.beginPath(); g.moveTo(x - s, y - fl); g.quadraticCurveTo(x - s * 0.4, y - s * 0.6 - fl * 0.3, x, y); g.quadraticCurveTo(x + s * 0.4, y - s * 0.6 - fl * 0.3, x + s, y - fl); g.stroke();
      }
    }

    function rain(g, w, h, t, n, wx, x0, x1, y0, col, lw) {
      g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
      const len = h * 0.035, sl = wx * 0.35;
      for (let k = 0; k < n; k++) {
        const x = x0 + wrap(hash(k, 1.3) * (x1 - x0) + t * sl * h * 0.9, 0, x1 - x0);
        const y = y0 + wrap(hash(k, 2.7) * (h - y0) + t * h * (0.8 + hash(k, 4.1) * 0.4), 0, h - y0 + len);
        g.moveTo(x, y - len); g.lineTo(x + sl * len, y);
      }
      g.stroke();
    }

    function hill(g, cx, by, rw, rh, fill, ink, ow, eyes, t, s) {
      g.beginPath(); g.moveTo(cx - rw, by); g.bezierCurveTo(cx - rw, by - rh * 1.3, cx + rw, by - rh * 1.3, cx + rw, by);
      g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = ow; g.strokeStyle = ink; g.stroke();
      if (eyes) { const e = blink(t, s); g.fillStyle = ink; for (const k of [-1, 1]) { g.beginPath(); g.ellipse(cx + k * rw * 0.16, by - rh * 0.62, rw * 0.05, rh * 0.13 * e + 1, 0, 0, TAU); g.fill(); } }
    }

    function grainLayer(g, w, h, t) {
      if (!grain) {
        grain = buffer(160, 160); const id = grain.ctx.createImageData(160, 160), r = rng(5);
        for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 70; }
        grain.ctx.putImageData(id, 0, 0); grainPat = null;
      }
      if (!grainPat) grainPat = g.createPattern(grain.canvas, 'repeat');
      const step = Math.floor(t * 12);
      g.save(); g.translate(-hash(step) * 160, -hash(step, 2) * 160); g.globalCompositeOperation = 'overlay'; g.fillStyle = grainPat; g.fillRect(0, 0, w + 160, h + 160); g.restore();
      // scratches and dust
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, h * 0.0015);
      for (let i = 0; i < 3; i++) if (hash(step, i) > 0.6) { const x = hash(step, i + 7) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (hash(step, i) - 0.5) * 20, h); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 0; i < 4; i++) if (hash(step, i + 20) > 0.7) { g.beginPath(); g.arc(hash(step, i + 30) * w, hash(step, i + 40) * h, h * 0.003 * (1 + hash(i, step) * 2), 0, TAU); g.fill(); }
      const fl = 0.06 * hash(step, 99);
      g.fillStyle = `rgba(0,0,0,${fl})`; g.fillRect(0, 0, w, h);
      const vg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.85)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    }

    function paperLayer(g, w, h) {
      if (!paper || paper.canvas.width !== (w >> 2) || paper.canvas.height !== (h >> 2)) {
        paper = buffer(w >> 2, h >> 2); const pw = paper.canvas.width, ph = paper.canvas.height;
        const id = paper.ctx.createImageData(pw, ph), r = rng(3);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = (y * pw + x) * 4, v = 128 + (r() - 0.5) * 40 + (hash(x * 0.3 | 0, y) - 0.5) * 30; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 40; }
        paper.ctx.putImageData(id, 0, 0);
      }
      g.save(); g.globalCompositeOperation = 'overlay'; g.drawImage(paper.canvas, 0, 0, w, h); g.restore();
    }

    return {
      render(f) {
        const g = f.ctx, w = f.w, h = f.h, t = f.t, p = f.p;
        if (lastT !== null && t < lastT - 1) spawned = [];
        lastT = t;
        shapes(p.detail);
        const wx = windX(p.wind), olw = lerp(0, 2.2, p.x1), bounce = p.x2 * 2, faces = p.x3, extras = p.x4;
        const count = Math.round(lerp(3, MAX, p.coverage)), Rb = h * lerp(0.05, 0.17, p.scale) * (S.big || 1);
        const ink = S.outline || '#000';
        // hose: animate on twos (12 fps) for that hand-drawn feel
        const ta = mode === 'hose' ? Math.floor(t * 12) / 12 : t;
        for (const c of f.pointer.clicks || []) {
          spawned.push({ x: c.x * w, y: c.y * h, born: t, seed: Math.random(), shape: makeShape(Math.random, p.detail), color: STICKERS[(Math.random() * STICKERS.length) | 0], rot: (Math.random() - 0.5) * 0.3, z: 0.25 });
          if (spawned.length > 12) spawned.shift();
        }

        // ---------- backdrop ----------
        sky(g, w, h, S.top, S.bot);
        if (mode === 'classic') {
          sun(g, w * 0.82, h * 0.2, h * 0.08 * lerp(0.7, 1.3, p.scale), t, h * 0.006 * olw, ink);
        } else if (mode === 'kawaii') {
          const cols = ['#ffb3c7', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'], bw = h * 0.045;
          g.globalAlpha = 0.85 * (0.4 + extras * 0.6);
          cols.forEach((c, i) => { g.beginPath(); g.arc(w * 0.5, h * 1.15, h * 0.95 - i * bw, Math.PI, TAU); g.lineWidth = bw + 1; g.strokeStyle = c; g.stroke(); });
          g.globalAlpha = 1;
          for (let i = 0; i < 4 + extras * 14; i++) {
            const x = hash(i, 11) * w, y = hash(i, 12) * h * 0.9, s = h * 0.018 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7)) * (0.6 + hash(i) * 0.8);
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - s * 2); g.quadraticCurveTo(x, y, x + s * 2, y); g.quadraticCurveTo(x, y, x, y + s * 2); g.quadraticCurveTo(x, y, x - s * 2, y); g.quadraticCurveTo(x, y, x, y - s * 2); g.fill();
          }
        } else if (mode === 'storm') {
          g.fillStyle = 'rgba(30,34,48,0.8)';
          for (let i = 0; i < 6; i++) { const x = wrap(hash(i, 4) * w * 1.5 + t * h * 0.02 * wx, -w * 0.25, w * 1.25); g.beginPath(); g.ellipse(x, h * (0.45 + hash(i, 2) * 0.1), h * 0.35, h * 0.08, 0, 0, TAU); g.fill(); }
        } else if (mode === 'bedtime') {
          for (let i = 0; i < 60 + extras * 100; i++) {
            const x = hash(i, 21) * w, y = hash(i, 22) * h * 0.85, tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(i) * 2) + i);
            const s = h * 0.003 * (1 + hash(i, 23) * 2) * (0.6 + tw * 0.6);
            g.fillStyle = `rgba(255,250,210,${0.4 + tw * 0.6})`;
            if (hash(i, 24) > 0.85) { g.beginPath(); g.moveTo(x, y - s * 3); g.lineTo(x + s * 0.7, y - s * 0.7); g.lineTo(x + s * 3, y); g.lineTo(x + s * 0.7, y + s * 0.7); g.lineTo(x, y + s * 3); g.lineTo(x - s * 0.7, y + s * 0.7); g.lineTo(x - s * 3, y); g.lineTo(x - s * 0.7, y - s * 0.7); g.fill(); }
            else g.fillRect(x - s / 2, y - s / 2, s, s);
          }
          // the sleeping moon
          const mx = w * 0.78, my = h * 0.24 + Math.sin(t * 0.5) * h * 0.01, mr = h * 0.12;
          const gl = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 2.6); gl.addColorStop(0, 'rgba(255,240,180,0.35)'); gl.addColorStop(1, 'rgba(255,240,180,0)');
          g.fillStyle = gl; g.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
          g.save(); g.translate(mx, my); g.rotate(Math.sin(t * 0.4) * 0.12);
          g.beginPath(); g.arc(0, 0, mr, 0, TAU); g.save(); g.clip();
          g.beginPath(); g.arc(0, 0, mr, 0, TAU); g.arc(mr * 0.55, -mr * 0.25, mr * 0.9, 0, TAU);
          g.fillStyle = '#ffe9a8'; g.fill('evenodd'); g.restore();
          g.strokeStyle = '#5a4a2a'; g.lineWidth = h * 0.004; g.lineCap = 'round';
          g.beginPath(); g.arc(-mr * 0.5, -mr * 0.1, mr * 0.13, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
          g.beginPath(); g.arc(-mr * 0.42, mr * 0.38, mr * 0.1, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
          g.fillStyle = 'rgba(255,150,150,0.5)'; g.beginPath(); g.ellipse(-mr * 0.68, mr * 0.2, mr * 0.1, mr * 0.06, 0, 0, TAU); g.fill();
          // nightcap
          g.fillStyle = '#5a7be0'; g.beginPath(); g.moveTo(-mr * 0.85, -mr * 0.45); g.quadraticCurveTo(-mr * 0.3, -mr * 1.35, mr * 0.45, -mr * 1.2 + Math.sin(t) * mr * 0.05); g.quadraticCurveTo(-mr * 0.2, -mr * 0.9, -mr * 0.25, -mr * 0.92); g.closePath(); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(mr * 0.48, -mr * 1.2 + Math.sin(t) * mr * 0.05, mr * 0.12, 0, TAU); g.fill();
          g.restore();
        } else if (mode === 'hose') {
          sun(g, w * 0.15, h * 0.2, h * 0.08, Math.floor(t * 6) / 6 * 2, h * 0.006, '#0d0d0d', '#cfcfcf', '#f4f4f4');
          const sx = w * 0.15, sy = h * 0.2, r = h * 0.08;
          g.fillStyle = '#0d0d0d'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(sx + s * r * 0.3, sy - r * 0.15, r * 0.1, r * 0.2, 0, 0, TAU); g.fill(); }
          g.lineWidth = h * 0.006; g.beginPath(); g.arc(sx, sy + r * 0.05, r * 0.45, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        } else if (mode === 'sticker') {
          const sx = w * 0.84, sy = h * 0.2, r = h * 0.09;
          g.save(); g.translate(sx, sy); g.rotate(Math.sin(t * 0.5) * 0.08);
          g.shadowColor = 'rgba(20,40,60,0.45)'; g.shadowBlur = r * 0.3; g.shadowOffsetX = r * 0.08; g.shadowOffsetY = r * 0.14;
          g.fillStyle = '#fff'; g.beginPath();
          for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, rr = i % 2 ? r * 1.25 : r * 1.6; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          g.fill(); g.shadowColor = 'transparent';
          g.fillStyle = '#ffc94a'; g.beginPath();
          for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, rr = i % 2 ? r * 1.08 : r * 1.42; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          g.fill(); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = '#ffe27a'; g.fill();
          g.restore();
        } else if (mode === 'sunset') {
          // retro striped sun on the horizon
          const sx = w * 0.5, hy = h * 0.8, sr = h * 0.3;
          g.save(); g.beginPath();
          for (let y = hy - sr; y < hy; ) { const k = (y - (hy - sr)) / sr, gap = k > 0.25 ? h * 0.004 + (k - 0.25) * h * 0.03 : 0, band = h * 0.03; g.rect(sx - sr, y, sr * 2, band); y += band + gap; }
          g.clip(); const sg = g.createLinearGradient(0, hy - sr, 0, hy); sg.addColorStop(0, '#fff3b8'); sg.addColorStop(1, '#ff9a8b');
          g.beginPath(); g.arc(sx, hy, sr, 0, TAU); g.fillStyle = sg; g.fill(); g.restore();
        }

        // ---------- clouds ----------
        const items = [];
        if (mode === 'simpsons') {
          // fly-through: clouds stream toward the camera
          const n = Math.round(lerp(8, 26, p.coverage));
          for (let i = 0; i < n; i++) {
            const life = 7, a = fract(t / life + hash(i, 1.7)), z = lerp(4, 0.25, a), cyc = Math.floor(t / life + hash(i, 1.7));
            const sx = (hash(i, cyc) - 0.5) * 3.2 + wx * (a - 0.5) * 1.2, sy = (hash(i, cyc + 0.5) - 0.62) * 1.4;
            items.push({ z, x: w / 2 + sx * h * 0.5 / z, y: h * 0.5 + sy * h * 0.5 / z, R: Rb * 1.6 / z, shape: clouds[i % clouds.length].shape, seed: hash(i, cyc), a: clamp(a * 5) * clamp((z - 0.25) * 3) });
          }
          items.sort((a, b) => b.z - a.z);
        } else {
          const m = Rb * 2.6;
          for (let i = 0; i < count; i++) {
            const c = clouds[i], R = Rb * c.size * lerp(0.6, 1.1, c.depth);
            const x = wrap(c.x0 * (w + 2 * m) + t * h * 0.025 * (0.4 + c.depth) * wx, -m, w + m);
            const y = h * lerp(S.band[0], S.band[1], c.y) + R * 0.4;
            items.push({ x, y, R, shape: c.shape, seed: c.seed, c, i });
          }
          for (const s of spawned) {
            const age = t - s.born, pop = age < 0 ? 0 : 1 - Math.exp(-6 * age) * Math.cos(14 * age);
            items.push({ x: s.x + age * h * 0.04 * wx, y: s.y, R: Rb * 1.1 * pop, shape: s.shape, seed: s.seed, c: s, spawned: true });
          }
          spawned = spawned.filter(s => { const x = s.x + (t - s.born) * h * 0.04 * wx; return x > -Rb * 4 && x < w + Rb * 4; });
        }

        if (mode === 'sunset') {
          // layered flat cloud banks in front of the sun
          const layers = [['#d4b0de', 0.74, 0.2], ['#eaa9c4', 0.78, 0.35], ['#f6bca9', 0.82, 0.55], ['#b07aa8', 0.87, 0.8], ['#8a5c96', 0.93, 1.1]];
          layers.forEach(([col, ly, sp], li) => {
            const step = Rb * (0.9 + li * 0.25), off = t * h * 0.03 * sp * wx;
            g.beginPath(); g.moveTo(-10, h); g.lineTo(-10, h * ly);
            const j0 = Math.floor(-off / step) - 2, j1 = j0 + Math.ceil(w / step) + 4;
            for (let j = j0; j < j1; j++) { const cx = j * step + off, r = step * (0.55 + 0.5 * hash(j, li)); const y = h * ly - r * 0.25 - Math.sin(t * 0.5 + j) * r * 0.03 * bounce; g.moveTo(cx + r, y); g.arc(cx, y, r, 0, TAU); }
            g.rect(-10, h * ly, w + 20, h); g.fillStyle = col; g.fill();
          });
        }

        // ground behind clouds for some scenes is drawn after; draw clouds
        for (const it of items) {
          const sd = it.seed, bob = Math.sin(t * (1.2 + sd) + sd * 20);
          const st = { fill: S.fill, shade: S.shade, outline: S.outline, ow: S.ow * h * olw * (it.R / Rb) * 0.5 + (S.ow ? 0.5 : 0), lift: S.lift, hi: S.hi,
            squash: bob * 0.035 * bounce, wob: null, rot: 0 };
          let y = it.y + bob * it.R * 0.06 * bounce;
          if (mode === 'hose') {
            const tq = Math.floor(t * 12);
            st.wob = c => (hash(c.x * 7 + tq, c.y * 7, sd) - 0.5) * 0.05;
            const beat = Math.abs(Math.sin(t * Math.PI * 1.0 + sd * 0.0)); y = it.y - beat * it.R * 0.25 * bounce; st.squash = (beat < 0.25 ? (0.25 - beat) * 0.5 : -0.02) * bounce;
          }
          if (mode === 'sticker') {
            st.fill = it.c.color; st.shade = it.c.color; st.lift = 0; st.shadow = 'rgba(20,40,60,0.45)'; st.ow = h * 0.012 * (it.R / Rb) * (0.6 + p.x1);
            st.rot = it.c.rot + Math.sin(t * 0.7 + sd * 9) * 0.05 * bounce; st.squash = 0;
          }
          if (mode === 'kawaii' && it.i === 0) { st.fill = '#c9d2e6'; st.shade = '#a3aec8'; }
          if (mode === 'storm') { const k = it.i !== undefined ? it.i % 3 : 1; st.fill = ['#7c8598', '#6a7286', '#8a92a6'][k]; }
          if (mode === 'simpsons') { g.globalAlpha = it.a; st.squash *= 0.3; }
          if (mode === 'sunset') { st.fill = '#ffe6d6'; st.shade = '#f4b3bf'; }
          let fk = S.face;
          if (fk && hash(sd, 3.3) > faces * 1.1 && !(mode === 'kawaii' && it.i === 0)) fk = null;
          if (mode === 'kawaii' && it.i === 0) fk = 'sad';
          if (fk) st.face = face(fk, mode === 'hose' ? ta : t, sd, look(f, it.x, y, sd), mode === 'hose' ? 0.06 : 0.045, mode === 'bedtime' ? '#1a1c48' : mode === 'storm' ? '#0f1118' : mode === 'mario' || mode === 'hose' ? '#000' : '#3a2a40');
          if (it.R > 0.5) drawCloud(g, it.shape, it.x, y, it.R, st);
          g.globalAlpha = 1;

          // per-cloud extras
          if (mode === 'kawaii' && it.i === 0) rain(g, w, h, t, 16, 0, it.x - it.R, it.x + it.R, y + it.R * 0.3, '#8fb4ff', h * 0.006);
          if (mode === 'bedtime' && fk) {
            g.fillStyle = '#e8e6ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
            for (let k = 0; k < 3; k++) {
              const a = fract(t * 0.22 + k / 3 + sd);
              g.globalAlpha = Math.sin(a * Math.PI) * 0.9;
              g.font = `bold ${(it.R * (0.25 + 0.35 * a)) | 0}px "Comic Sans MS", "Chalkboard SE", sans-serif`;
              g.fillText('Z', it.x + it.R * (0.7 + a * 0.6) + Math.sin(a * 7) * it.R * 0.1, y - it.R * (0.9 + a * 1.4));
            }
            g.globalAlpha = 1;
          }
          if (mode === 'storm' && it.i !== undefined && it.i < 4) {
            const per = 2.6 + hash(it.i, 8) * 2, k = Math.floor(t / per + hash(it.i)), ph = fract(t / per + hash(it.i));
            if (ph < 0.08 && hash(k, it.i) < 0.4 + extras * 0.6) {
              const r = rng(k * 13 + it.i), x0 = it.x + (r() - 0.5) * it.R, pts = [[x0 - it.R * 0.15, y + it.R * 0.3], [x0 + it.R * 0.15, y + it.R * 0.3]];
              let x = x0, yy = y + it.R * 0.3; const segs = 5, dy = (h * 0.95 - yy) / segs;
              const L = [], Rr = [];
              for (let s = 0; s <= segs; s++) { const wdt = it.R * 0.12 * (1 - s / segs) + h * 0.004; L.push([x - wdt, yy]); Rr.push([x + wdt, yy]); x += (r() - 0.5) * it.R * 0.9; yy += dy; }
              g.beginPath(); g.moveTo(L[0][0], L[0][1]);
              for (let s = 1; s <= segs; s++) { const a2 = s % 2 ? L : Rr; g.lineTo(a2[s][0] + (s % 2 ? -1 : 1) * it.R * 0.12, a2[s][1]); }
              for (let s = segs; s >= 0; s--) { const a2 = s % 2 ? Rr : L; g.lineTo(a2[s][0], a2[s][1] - (s ? it.R * 0.15 : 0)); }
              g.closePath(); g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = h * 0.005; g.strokeStyle = '#141720'; g.lineJoin = 'round'; g.stroke();
              g.fillStyle = `rgba(255,255,230,${0.35 * (1 - ph / 0.08)})`; g.fillRect(0, 0, w, h);
            }
          }
        }

        // ---------- foreground ----------
        if (mode === 'classic') {
          birds(g, w, h, t, Math.round(extras * 8), '#1f3a5f');
          const gy = h * 0.88; g.fillStyle = '#7fce5c'; g.strokeStyle = ink; g.lineWidth = h * 0.006 * olw;
          g.beginPath(); g.moveTo(0, h); g.lineTo(0, gy);
          for (let x = 0; x <= w + 20; x += 20) g.lineTo(x, gy + Math.sin(x / w * 7 + 1) * h * 0.03);
          g.lineTo(w, h); g.closePath(); g.fill(); if (olw > 0) g.stroke();
        } else if (mode === 'mario') {
          const scroll = t * h * 0.18, gy = h * 0.84, ow = h * 0.006 * olw + 1;
          const hp = h * 1.6;
          for (let j = Math.floor(scroll * 0.5 / hp) - 1; j < Math.floor(scroll * 0.5 / hp) + w / hp + 2; j++) {
            const cx = j * hp - scroll * 0.5, big = hash(j, 2) > 0.4;
            hill(g, cx + hp * 0.3, gy, h * (big ? 0.28 : 0.17), h * (big ? 0.26 : 0.14), '#00a800', '#000', ow, true, t, hash(j));
            const bx = cx + hp * 0.85;
            drawCloud(g, clouds[(j & 7) + 1 < clouds.length ? (j & 7) + 1 : 0].shape, bx, gy - h * 0.045, h * 0.06, { fill: '#7ce010', shade: '#00a800', outline: '#000', ow, lift: 0.12 });
          }
          // brick ground
          const bh = h * 0.08, bw2 = bh;
          g.fillStyle = '#c84c0c'; g.fillRect(0, gy, w, h - gy);
          g.strokeStyle = '#000'; g.lineWidth = Math.max(1, h * 0.003);
          g.beginPath();
          for (let row = 0; gy + row * bh < h; row++) {
            const y = gy + row * bh; g.moveTo(0, y); g.lineTo(w, y);
            const o = (scroll % bw2) + (row % 2) * bw2 / 2;
            for (let x = -o; x < w + bw2; x += bw2) { g.moveTo(x, y); g.lineTo(x, y + bh); }
          }
          g.stroke();
          g.fillStyle = '#fc9838';
          for (let row = 0; gy + row * bh < h; row++) { const y = gy + row * bh, o = (scroll % bw2) + (row % 2) * bw2 / 2; for (let x = -o; x < w + bw2; x += bw2) g.fillRect(x + 2, y + 2, bw2 * 0.8, h * 0.008); }
          // floating ? blocks
          if (extras > 0.2) {
            const qb = h * 0.07, qp = h * 2.4;
            for (let j = Math.floor(scroll / qp) - 1; j < Math.floor(scroll / qp) + w / qp + 2; j++) {
              const x = j * qp - scroll + qp * 0.5, y = gy - h * 0.3 - Math.max(0, Math.sin(t * 3 + j)) * h * 0.02;
              g.fillStyle = '#fca044'; g.fillRect(x, y, qb, qb); g.lineWidth = Math.max(1, h * 0.004); g.strokeRect(x, y, qb, qb);
              g.fillStyle = '#000'; g.font = `bold ${qb * 0.8 | 0}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', x + qb / 2, y + qb / 2 + qb * 0.04);
            }
          }
        } else if (mode === 'storm') {
          rain(g, w, h, t, Math.round(60 + extras * 260), wx, -w * 0.2, w * 1.2, 0, 'rgba(140,170,230,0.7)', h * 0.004);
          g.fillStyle = '#1c2a22'; g.strokeStyle = '#0b0f0d'; g.lineWidth = h * 0.006;
          g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w + 20; x += 20) g.lineTo(x, h * 0.9 + Math.sin(x / w * 5 + 2) * h * 0.04); g.lineTo(w, h); g.closePath(); g.fill(); g.stroke();
        } else if (mode === 'hose') {
          g.fillStyle = '#2a2a2a'; g.strokeStyle = '#000'; g.lineWidth = h * 0.007;
          const tq = Math.floor(t * 12);
          g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w + 30; x += 30) g.lineTo(x, h * 0.86 + Math.sin(x / w * 6) * h * 0.03 + (hash(x, tq) - 0.5) * h * 0.004); g.lineTo(w, h); g.closePath(); g.fill(); g.stroke();
          // bouncing flowers
          for (let i = 0; i < 2 + Math.round(extras * 6); i++) {
            const x = (i + 0.5) / (2 + Math.round(extras * 6)) * w, base = h * 0.86 + Math.sin(x / w * 6) * h * 0.03, beat = Math.abs(Math.sin(t * Math.PI + i));
            const top = base - h * (0.08 + beat * 0.03); g.strokeStyle = '#000'; g.lineWidth = h * 0.006;
            g.beginPath(); g.moveTo(x, base); g.quadraticCurveTo(x + Math.sin(t * Math.PI + i) * h * 0.03, (base + top) / 2, x, top); g.stroke();
            g.fillStyle = '#fff'; for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + t; g.beginPath(); g.arc(x + Math.cos(a) * h * 0.02, top + Math.sin(a) * h * 0.02, h * 0.014, 0, TAU); g.fill(); g.stroke(); }
            g.fillStyle = '#000'; g.beginPath(); g.arc(x, top, h * 0.012, 0, TAU); g.fill();
          }
          grainLayer(g, w, h, t);
        } else if (mode === 'sticker') {
          paperLayer(g, w, h);
        } else if (mode === 'sunset') {
          g.fillStyle = 'rgba(255,255,255,0.18)';
          for (let i = 0; i < 6; i++) { const y = h * (0.9 + i * 0.018); g.fillRect(w * 0.5 - h * (0.2 - i * 0.02) + Math.sin(t + i) * h * 0.02, y, h * (0.4 - i * 0.04), h * 0.004); }
        }

        if (!['bedtime', 'hose', 'storm'].includes(mode)) tint(g, w, h, p.light);
        else if (mode === 'bedtime' && p.light > 0.3) tint(g, w, h, 1 - (p.light - 0.3));
      }
    };
  }
};

const d = (id, name, desc, mode, params, tags = []) => ({ id: 'cartoon-' + id, name, desc, opts: { mode }, params, tags: ['cartoon', '2d', ...tags] });
export const scenes = [
  d('classic', 'Saturday Morning Sky', 'Bold-outlined puffs bobbing past a spinning cartoon sun.', 'classic', { coverage: 0.55, scale: 0.55, light: 0.9 }),
  d('kawaii', 'Kawaii Cloud Friends', 'Blushing, blinking clouds under a pastel rainbow (one is having a rainy day).', 'kawaii', { coverage: 0.45, scale: 0.55, x3: 1, light: 1 }, ['pastel']),
  d('mario', 'Plumber’s Sky', 'Clouds with eyes drifting over smiling green hills and brick ground.', 'mario', { coverage: 0.4, scale: 0.45, x3: 1, light: 1 }, ['retro']),
  d('storm', 'Grumpy Thunderheads', 'Scowling storm clouds spitting zigzag lightning and cartoon rain.', 'storm', { coverage: 0.5, scale: 0.55, x3: 0.8, light: 0.7 }, ['storm', 'weather', 'moody']),
  d('flythrough', 'Opening Titles Sky', 'Big soft clouds rushing toward the camera through a deep blue sky.', 'simpsons', { coverage: 0.55, scale: 0.6, speed: 0.55, light: 0.95 }, ['distance']),
  d('sticker', 'Sticker Book Clouds', 'Die-cut paper stickers in candy colours, casting little shadows.', 'sticker', { coverage: 0.6, scale: 0.5, x1: 0.5, light: 1 }, ['pastel']),
  d('bedtime', 'Bedtime Sky', 'Sleepy clouds snoring Zzz under a moon in a nightcap.', 'bedtime', { coverage: 0.45, scale: 0.5, x3: 1, light: 0.1 }, ['night']),
  d('rubberhose', 'Rubber-Hose Reel', 'A 1930s cartoon: grinning clouds bouncing on the beat, with film grain.', 'hose', { coverage: 0.35, scale: 0.55, x3: 1, x2: 0.7, light: 0.8 }, ['retro']),
  d('sunset', 'Pastel Sunset Layers', 'Flat cloud banks stacked in front of a striped retro sun.', 'sunset', { coverage: 0.5, scale: 0.55, light: 0.9 }, ['sunset', 'pastel']),
];
