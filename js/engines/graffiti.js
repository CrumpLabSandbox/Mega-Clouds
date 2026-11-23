// Graffiti clouds: clouds sprayed dot by dot onto walls (brick, concrete, plaster, sidewalk, a passing train).
// Each cloud lives in its own off-screen "paint" canvas that is filled in incrementally as a spray can works
// through a recipe of strokes (fill, shading, outline, highlights), then it drips, drifts, fades and is repainted.
import { clamp, lerp, wrap, rng, hash, windX, buffer, noise2 } from '../util.js';

const TAU = Math.PI * 2;

function makeShape(rand, detail) {
  const n = 3 + Math.round(detail * 3) + (rand() * 2 | 0), b = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) * 2 - 1, mid = 1 - Math.abs(u), r = 0.34 + 0.32 * mid + rand() * 0.1;
    b.push({ x: u + (rand() - 0.5) * 0.12, y: 0.1 - r * 0.5 - mid * 0.22, r });
  }
  const m = 3 + Math.round(detail * 2);
  for (let j = 0; j < m; j++) { const u = j / (m - 1) * 2 - 1; b.push({ x: u * 1.08, y: 0.2, r: 0.3 + rand() * 0.06 }); }
  return b;
}
const inside = (sh, x, y, pad = 0) => { for (const c of sh) { const dx = x - c.x, dy = y - c.y; if (dx * dx + dy * dy < (c.r + pad) * (c.r + pad)) return true; } return false; };
// boundary points of the union of circles, left to right, with outward normals
function contour(sh, step) {
  const pts = [], cs = [...sh].sort((a, b) => a.x - b.x);
  for (const c of cs) {
    const n = Math.max(8, Math.ceil(TAU * c.r / step));
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 0.5 + k / n * TAU, x = c.x + Math.cos(a) * c.r, y = c.y + Math.sin(a) * c.r;
      let ok = true; for (const o of sh) if (o !== c && Math.hypot(x - o.x, y - o.y) < o.r - 1e-3) { ok = false; break; }
      if (ok) pts.push([x, y, Math.cos(a), Math.sin(a)]);
    }
  }
  return pts;
}
const hexRgb = s => { if (s[0] !== '#') return s; const n = parseInt(s.slice(1), 16); return `${n >> 16},${n >> 8 & 255},${n & 255}`; };
const mixRgb = (a, b, t) => { const A = hexRgb(a).split(',').map(Number), B = hexRgb(b).split(',').map(Number); return A.map((v, i) => Math.round(lerp(v, B[i], t))).join(','); };
// a round paint dot: solid core out to `hd`, then a falloff (hd near 1 = marker, low hd = soft spray)
const dotCache = new Map();
function dotSprite(rgb, hd) {
  const key = rgb + '|' + hd.toFixed(2); let c = dotCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(Math.min(0.97, hd), `rgba(${rgb},${hd > 0.6 ? 1 : 0.75})`);
  if (hd < 0.6) gr.addColorStop(Math.min(0.98, hd + (1 - hd) * 0.5), `rgba(${rgb},0.22)`);
  gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, 48, 48); dotCache.set(key, c); return c;
}

// --- stroke recipes: return dots [x, y, size, alpha, colourIndex, hardness, clip] in unit space ---
function recipe(style, sh, rand, soft, palette) {
  const dots = [], cols = [];
  const ci = c => { let i = cols.indexOf(c); if (i < 0) { cols.push(c); i = cols.length - 1; } return i; };
  const add = (x, y, s, a, c, hd = 0.35, clip = 0) => dots.push([x, y, s, a, ci(c), hd, clip]);
  let minY = 1e9, maxY = -1e9; for (const c of sh) { minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r); }
  const zig = (step, dot, fn, jit = 0.03) => {
    let dir = 1;
    for (let y = minY; y < maxY; y += step) {
      const xs = []; for (let x = -1.6; x < 1.6; x += dot) xs.push(x);
      if (dir < 0) xs.reverse(); dir = -dir;
      for (const x of xs) { const xx = x + (rand() - 0.5) * jit, yy = y + (rand() - 0.5) * jit; if (inside(sh, xx, yy)) fn(xx, yy, (yy - minY) / (maxY - minY)); }
    }
  };
  const ctr = contour(sh, 0.035);
  if (style === 'brick') {
    const [fill, shade, line, hi] = palette;
    zig(0.07, 0.06, (x, y) => add(x, y, 0.24 * soft, 0.55, fill, 0.35));
    zig(0.08, 0.07, (x, y, v) => { if (v > 0.5) add(x, y + 0.03, 0.2 * soft, 0.7 * (v - 0.45), shade, 0.3); });
    for (const [x, y, nx, ny] of ctr) add(x + nx * 0.01, y + ny * 0.01, 0.075 + 0.03 * soft, 0.85, line, 0.55);
    for (const [x, y, nx, ny] of ctr) if (ny < -0.4 && nx < 0.3 && rand() < 0.8) add(x - nx * 0.09, y - ny * 0.09, 0.05, 0.8, hi, 0.6);
  } else if (style === 'bubble') {
    const [c1, c2, line, ext, hi] = palette;
    for (const [x, y, nx, ny] of ctr) add(x + 0.1 + nx * 0.06, y + 0.12 + ny * 0.06, 0.15, 0.95, ext, 0.85);
    zig(0.06, 0.05, (x, y, v) => add(x, y, 0.14, 1, v < 0.22 ? mixRgb(c1, '#ffffff', 0.3) : mixRgb(c1, c2, Math.round(clamp((v - 0.3) * 1.6) * 5) / 5), 0.85), 0.01);
    for (const [x, y, nx, ny] of ctr) add(x + nx * 0.04, y + ny * 0.04, 0.09, 1, line, 0.9);
    for (const [x, y, nx, ny] of ctr) if (ny < -0.3 && rand() < 0.9) add(x - nx * 0.11, y - ny * 0.11, 0.045, 0.95, hi, 0.9);
    for (let k = 0; k < 4; k++) { const c = sh[(rand() * (sh.length - 3)) | 0]; add(c.x - c.r * 0.35, c.y - c.r * 0.4, 0.07, 1, hi, 0.95); add(c.x - c.r * 0.2, c.y - c.r * 0.5, 0.035, 1, hi, 0.95); }
  } else if (style === 'wild') {
    const [n1, n2, fill] = palette;
    zig(0.08, 0.09, (x, y) => { if (rand() < 0.55) add(x, y, 0.2 * soft, 0.22, fill, 0.3); });
    // arrows bursting off the outline
    const spikes = [];
    for (let k = 0; k < 4; k++) { const p = ctr[(rand() * ctr.length) | 0]; if (p[3] < 0.5) spikes.push(p); }
    const neon = (pts, c, s) => { for (const [x, y] of pts) add(x, y, s * 3.2 * soft, 0.12, c, 0.1); for (const [x, y] of pts) add(x, y, s, 0.95, c, 0.75); for (const [x, y] of pts) add(x, y, s * 0.4, 0.9, '#ffffff', 0.8); };
    neon(ctr.map(([x, y, nx, ny]) => [x + nx * 0.02, y + ny * 0.02]), n1, 0.06);
    for (const [x, y, nx, ny] of spikes) {
      const L = 0.35 + rand() * 0.35, tx = x + nx * L, ty = y + ny * L, px = -ny, py = nx, pts = [];
      for (let s = 0; s <= 1; s += 0.06) pts.push([x + (tx - x) * s, y + (ty - y) * s]);
      for (const sg of [-1, 1]) for (let s = 0; s <= 1; s += 0.15) pts.push([tx - (nx * 0.14 - sg * px * 0.1) * s, ty - (ny * 0.14 - sg * py * 0.1) * s]);
      neon(pts, n2, 0.045);
    }
    neon(ctr.filter((_, i) => i % 2 === 0).map(([x, y, nx, ny]) => [x - nx * 0.12, y - ny * 0.12]).filter(([x, y]) => inside(sh, x, y, -0.05)), n2, 0.03);
  } else if (style === 'stencil') {
    const [c] = palette;
    zig(0.07, 0.06, (x, y) => add(x, y, 0.16, 0.45, c, 0.35, 1));
    for (let k = 0; k < 160 * soft; k++) { const p = ctr[(rand() * ctr.length) | 0], o = 0.03 + rand() * 0.18; add(p[0] + p[2] * o, p[1] + p[3] * o, 0.03 + rand() * 0.05, 0.25 * soft, c, 0.6); }
  } else if (style === 'chalk') {
    const [line, hatch] = palette;
    // grains: size<0 marks a square grain (fillRect) instead of a soft dot
    for (let pass = 0; pass < 2; pass++) for (const [x, y, nx, ny] of ctr) for (let k = 0; k < 2; k++) if (rand() < 0.8) add(x + (rand() - 0.5) * 0.03 + nx * pass * 0.02, y + (rand() - 0.5) * 0.03, -(0.012 + rand() * 0.012), 0.75, line);
    const ang = -0.6, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let o = -2; o < 2; o += 0.075) {
      for (let s = -2; s < 2; s += 0.012) {
        const x = ca * s - sa * o, y = sa * s + ca * o;
        if (inside(sh, x, y, -0.04) && rand() < 0.7) add(x + (rand() - 0.5) * 0.012, y + (rand() - 0.5) * 0.012, -(0.01 + rand() * 0.01), 0.6, hatch);
      }
    }
  }
  return { dots, cols };
}

const STYLES = {
  brick:    { recipe: 'brick', palettes: [['#ffffff', '#7fb6ff', '#1d3b8f', '#ffffff'], ['#fff6e0', '#ff9ec4', '#6a1b6e', '#ffffff'], ['#eafcff', '#62d0c0', '#0f4d5c', '#ffffff']] },
  bubble:   { recipe: 'bubble', palettes: [['#ff7ac8', '#8b5cff', '#111111', '#3a1458', '#ffffff'], ['#5ee0ff', '#2e7bff', '#0b0b0b', '#0d2a6b', '#ffffff'], ['#ffe14d', '#ff7b2e', '#111111', '#6b2a00', '#ffffff'], ['#9dff6e', '#20b070', '#111111', '#0b4a2a', '#ffffff']] },
  wild:     { recipe: 'wild', palettes: [['#29f6ff', '#ff2ed1', '#1a2a5a'], ['#b6ff2e', '#29a8ff', '#1c3a1c'], ['#ff3b6b', '#ffd12e', '#4a1030'], ['#c45cff', '#2effc4', '#2a1450']] },
  stencil:  { recipe: 'stencil', palettes: [['#141414'], ['#c8202a'], ['#1d3f8a'], ['#141414'], ['#2f6b3a']] },
  chalk:    { recipe: 'chalk', palettes: [['#ffffff', '#9fd3ff'], ['#ffffff', '#ffc4e1'], ['#fffbe0', '#bfe8b8'], ['#ffffff', '#d9c4ff']] },
  subway:   { recipe: 'bubble', palettes: [['#ff7ac8', '#8b5cff', '#111111', '#3a1458', '#ffffff'], ['#5ee0ff', '#2e7bff', '#0b0b0b', '#0d2a6b', '#ffffff'], ['#ffe14d', '#ff7b2e', '#111111', '#6b2a00', '#ffffff'], ['#9dff6e', '#20b070', '#111111', '#0b4a2a', '#ffffff']] },
};

function noiseLayer(w, h, seed, a1, a2, freq = 0.06) {
  const b = buffer(w, h), id = b.ctx.createImageData(b.canvas.width, b.canvas.height), r = rng(seed), W = b.canvas.width;
  for (let y = 0; y < b.canvas.height; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = 128 + (r() - 0.5) * a1 + (noise2(x * freq + seed, y * freq) - 0.5) * a2 + (noise2(x * freq * 4, y * freq * 4 + seed) - 0.5) * a2 * 0.4;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  b.ctx.putImageData(id, 0, 0); return b.canvas;
}

function buildWall(mode, w, h) {
  const B = buffer(w, h), g = B.ctx, r = rng(11);
  const grime = (a1, a2, f) => { g.save(); g.globalCompositeOperation = 'overlay'; g.imageSmoothingEnabled = true; g.drawImage(noiseLayer(w / 3, h / 3, 5, a1, a2, f), 0, 0, w, h); g.restore(); };
  if (mode === 'brick') {
    g.fillStyle = '#8f857a'; g.fillRect(0, 0, w, h);
    const bh = h / 17, bw = bh * 2.7, m = Math.max(1, bh * 0.12);
    const cols = ['#9c4a35', '#a8553c', '#8e4330', '#b25e45', '#7f3d2c', '#a04b3a', '#94503a'];
    for (let row = 0, y = 0; y < h; row++, y += bh) {
      for (let x = -(row % 2) * bw / 2; x < w; x += bw) {
        g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + m / 2, y + bh - m * 1.6, bw - m, m * 1.1);
        g.fillStyle = 'rgba(255,220,200,0.12)'; g.fillRect(x + m / 2, y + m / 2, bw - m, m * 0.8);
      }
    }
    grime(60, 120, 0.05);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0.15)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,10,0,0.45)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } else if (mode === 'bubble' || mode === 'wild') {
    const wild = mode === 'wild';
    g.fillStyle = wild ? '#2b2b31' : '#cfcac0'; g.fillRect(0, 0, w, h);
    grime(wild ? 50 : 40, wild ? 90 : 110, 0.04);
    // old paint patches and faded tags
    for (let i = 0; i < 9; i++) {
      g.fillStyle = wild ? `hsla(${r() * 360},30%,${18 + r() * 10}%,0.5)` : `hsla(${r() * 360},40%,${70 + r() * 15}%,0.45)`;
      g.fillRect(r() * w, r() * h, w * (0.1 + r() * 0.25), h * (0.1 + r() * 0.3));
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = wild ? `hsla(${r() * 360},50%,40%,0.25)` : `hsla(${r() * 360},50%,35%,0.18)`; g.lineWidth = h * (0.004 + r() * 0.006);
      let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.3) * h * 0.06; y += (r() - 0.5) * h * 0.06; g.quadraticCurveTo(x + (r() - 0.5) * h * 0.05, y - h * 0.04, x, y); }
      g.stroke();
    }
    g.fillStyle = wild ? 'rgba(0,0,0,0.5)' : 'rgba(80,70,60,0.35)';
    for (let x = w * 0.25; x < w; x += w * 0.25 + h * 0.1) g.fillRect(x, 0, Math.max(1, h * 0.003), h);
    g.fillRect(0, h * 0.82, w, Math.max(1, h * 0.003));
    const gr = g.createLinearGradient(0, h * 0.82, 0, h); gr.addColorStop(0, wild ? 'rgba(0,0,0,0.4)' : 'rgba(60,50,40,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr; g.fillRect(0, h * 0.82, w, h * 0.18);
  } else if (mode === 'stencil') {
    g.fillStyle = '#d9cbac'; g.fillRect(0, 0, w, h);
    grime(30, 90, 0.03);
    // ghosts of torn posters
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(r() * w, r() * h); g.rotate((r() - 0.5) * 0.1);
      const pw = h * (0.2 + r() * 0.2), ph = pw * 1.4;
      g.fillStyle = `hsla(${r() * 360},35%,${65 + r() * 15}%,0.55)`;
      g.beginPath(); g.moveTo(0, 0); for (let k = 0; k <= 10; k++) g.lineTo(k / 10 * pw, (r() - 0.5) * h * 0.02);
      for (let k = 0; k <= 10; k++) g.lineTo(pw + (r() - 0.5) * h * 0.02, k / 10 * ph);
      for (let k = 10; k >= 0; k--) g.lineTo(k / 10 * pw, ph + (r() - 0.5) * h * 0.03); g.closePath(); g.fill();
      g.fillStyle = 'rgba(40,30,20,0.15)'; for (let k = 0; k < 4; k++) g.fillRect(pw * 0.1, ph * (0.15 + k * 0.12), pw * (0.4 + r() * 0.4), ph * 0.04);
      g.restore();
    }
    g.strokeStyle = 'rgba(70,55,40,0.5)'; g.lineWidth = Math.max(1, h * 0.002);
    for (let i = 0; i < 5; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 14; k++) { x += (r() - 0.5) * h * 0.05; y += r() * h * 0.03; g.lineTo(x, y); } g.stroke(); }
  }
  return B.canvas;
}

export default {
  id: 'graffiti',
  name: 'Graffiti',
  kind: '2d',
  params: [
    { id: 'x1', label: 'Paint speed', value: 0.5 },
    { id: 'x2', label: 'Drips', value: 0.5 },
    { id: 'x3', label: 'Overspray', value: 0.5 },
    { id: 'x4', label: 'Neon / chalk glow', value: 0.5 },
  ],
  create(ctx, opts) {
    const mode = opts.mode || 'brick', ST = STYLES[mode];
    let warm = false, wall = null, wallKey = '', slots = [], sidewalk = null, sideKey = '', city = null, cityKey = '';
    const cars = new Map();
    const sprite = (rgb, hd) => dotSprite(rgb, Math.round(hd * 20) / 20);

    // build the stroke list for one slot cycle
    function prepare(slot, i, cyc, R, p) {
      const r = rng(i * 7919 + cyc * 104729 + 3);
      const shape = mode === 'stencil' ? makeShape(rng(42), Math.round(p.detail * 3) / 3) : makeShape(r, Math.round(p.detail * 3) / 3);
      const pal = ST.palettes[mode === 'stencil' ? (i + cyc) % ST.palettes.length : (r() * ST.palettes.length) | 0];
      const soft = lerp(0.6, 1.6, p.x3);
      const { dots, cols } = recipe(ST.recipe, shape, r, soft, pal);
      const W = Math.ceil(R * 4.2), H = Math.ceil(R * 3.4), ox = W / 2, oy = H * 0.58;
      if (!slot.buf || slot.buf.canvas.width !== W || slot.buf.canvas.height !== H) slot.buf = buffer(W, H);
      slot.buf.ctx.clearRect(0, 0, W, H);
      const rgb = cols.map(hexRgb);
      slot.dots = dots; slot.rgb = rgb; slot.R = R; slot.ox = ox; slot.oy = oy; slot.drawn = 0; slot.cyc = cyc; slot.shape = shape; slot.pal = pal;
      slot.key = R + '|' + p.detail.toFixed(2) + '|' + p.x3.toFixed(2);
      // stencil clip + bridges
      if (mode === 'stencil') {
        const clip = new Path2D(); for (const c of shape) { clip.moveTo(ox + (c.x + c.r) * R, oy + c.y * R); clip.arc(ox + c.x * R, oy + c.y * R, c.r * R, 0, TAU); }
        const br = new Path2D(); const bwid = R * 0.035;
        const tops = shape.slice(0, shape.length - 4);
        for (let k = 0; k < tops.length - 1; k++) { const x = ox + (tops[k].x + tops[k + 1].x) / 2 * R; br.rect(x - bwid / 2, oy - R * 1.3, bwid, R * 1.2); }
        br.rect(ox - R * 1.5, oy + R * 0.05, R * 3, bwid);
        slot.clip = clip; slot.bridges = br;
      }
      // drips from bottom-facing outline points
      const ctr = contour(shape, 0.05).filter(q => q[3] > 0.55);
      const nd = Math.round(p.x2 * 7);
      slot.drips = [];
      for (let k = 0; k < nd && ctr.length; k++) { const q = ctr[(r() * ctr.length) | 0]; slot.drips.push({ x: q[0], y: q[1] - 0.02, len: 0.25 + r() * r() * 1.1, wid: 0.025 + r() * 0.03, delay: r() * 3, rate: 0.15 + r() * 0.35, col: pal[0] }); }
    }
    function paintTo(slot, target) {
      const g = slot.buf.ctx, R = slot.R, ox = slot.ox, oy = slot.oy, D = slot.dots;
      target = Math.min(D.length, target);
      if (target <= slot.drawn) return;
      let inClip = false;
      for (let k = slot.drawn; k < target; k++) {
        const [x, y, s, a, c, hd, clip] = D[k];
        if (clip && !inClip) { g.save(); g.clip(slot.clip); inClip = true; }
        if (!clip && inClip) { g.restore(); inClip = false; }
        g.globalAlpha = a;
        if (s < 0) { const q = -s * R; g.fillStyle = `rgb(${slot.rgb[c]})`; g.fillRect(ox + x * R - q / 2, oy + y * R - q / 2, q, q); }
        else { const q = s * R; g.drawImage(sprite(slot.rgb[c], hd), ox + x * R - q / 2, oy + y * R - q / 2, q, q); }
      }
      if (inClip) g.restore();
      g.globalAlpha = 1;
      if (slot.bridges) { g.globalCompositeOperation = 'destination-out'; g.fill(slot.bridges); g.globalCompositeOperation = 'source-over'; }
      slot.drawn = target;
    }
    function drawDrips(g, slot, x0, y0, age, alpha) {
      const R = slot.R;
      for (const d of slot.drips) {
        const a = age - d.delay; if (a <= 0) continue;
        const L = d.len * (1 - Math.exp(-a * d.rate)) * R, x = x0 + d.x * R, y = y0 + d.y * R, wd = d.wid * R;
        g.globalAlpha = alpha * 0.9; g.fillStyle = d.col;
        g.beginPath(); g.moveTo(x - wd / 2, y); g.lineTo(x - wd * 0.35, y + L); g.lineTo(x + wd * 0.35, y + L); g.lineTo(x + wd / 2, y); g.fill();
        g.beginPath(); g.arc(x, y + L, wd * 0.55, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    function can(g, x, y, R, color, t) {
      g.save(); g.translate(x + R * 0.22, y + R * 0.12); g.rotate(-0.5 + Math.sin(t * 9) * 0.06);
      const cw = R * 0.14, ch = R * 0.36;
      g.fillStyle = '#2a2a2a'; g.fillRect(-cw / 2, -ch * 0.05, cw, ch);
      g.fillStyle = color; g.fillRect(-cw / 2, ch * 0.2, cw, ch * 0.45);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-cw * 0.3, 0, cw * 0.15, ch * 0.9);
      g.fillStyle = '#bbb'; g.beginPath(); g.ellipse(0, -ch * 0.05, cw / 2, cw * 0.3, 0, Math.PI, TAU); g.fill();
      g.fillStyle = '#eee'; g.fillRect(-cw * 0.12, -ch * 0.2, cw * 0.24, ch * 0.13);
      g.restore();
    }
    function tint(g, w, h, light) {
      const n = clamp((0.6 - light) / 0.6);
      if (n > 0.01) {
        g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${lerp(255, 30, n) | 0},${lerp(255, 36, n) | 0},${lerp(255, 80, n) | 0})`; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'lighter';
        const gl = g.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, h * 1.1);
        gl.addColorStop(0, `rgba(255,190,110,${0.35 * n})`); gl.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gl; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      }
      const dk = Math.max(0, 1 - Math.abs(light - 0.3) / 0.2);
      if (dk > 0.01) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = `rgba(255,120,50,${dk * 0.6})`; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
    }

    // ----- sidewalk (chalk) -----
    function sidewalkTex(w, h) {
      const per = Math.round(h * 0.55), W = w + per;
      const B = buffer(W, h), g = B.ctx, r = rng(9);
      g.fillStyle = '#8e8d87'; g.fillRect(0, 0, W, h);
      g.save(); g.globalCompositeOperation = 'overlay';
      const nz = noiseLayer(per / 2, h / 2, 3, 40, 30, 0.12);
      for (let x = 0; x < W; x += per) g.drawImage(nz, x, 0, per, h);
      g.restore();
      g.strokeStyle = 'rgba(40,40,38,0.55)'; g.lineWidth = Math.max(2, h * 0.006);
      for (let x = 0; x <= W; x += per) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(W, h * 0.5); g.stroke();
      g.fillStyle = 'rgba(30,30,28,0.35)'; for (let i = 0; i < 400; i++) g.fillRect(r() * W, r() * h, 2, 2);
      g.strokeStyle = 'rgba(40,38,35,0.6)'; g.lineWidth = Math.max(1, h * 0.002);
      for (let i = 0; i < 3; i++) { const x0 = (i + 0.3 + r() * 0.4) * per; let x = x0, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (r() - 0.5) * h * 0.04; y += h * 0.025; g.lineTo(x, y); } g.stroke(); }
      // copy the first period to the end so it tiles
      g.drawImage(B.canvas, 0, 0, per, h, W - per, 0, per, h);
      return { canvas: B.canvas, per };
    }
    // ----- subway -----
    function cityTex(w, h) {
      const B = buffer(w * 2, h), g = B.ctx, r = rng(4);
      for (let x = 0; x < w * 2;) {
        const bw = h * (0.06 + r() * 0.12), bh = h * (0.15 + r() * 0.4);
        g.fillStyle = '#20203a'; g.fillRect(x, h * 0.7 - bh, bw, bh + h * 0.3);
        for (let wy = h * 0.7 - bh + h * 0.02; wy < h * 0.68; wy += h * 0.03) for (let wx = x + h * 0.01; wx < x + bw - h * 0.015; wx += h * 0.02) if (r() < 0.35) { g.fillStyle = r() < 0.7 ? '#ffd27a' : '#9fd8ff'; g.fillRect(wx, wy, h * 0.008, h * 0.012); }
        x += bw + h * r() * 0.02;
      }
      return B.canvas;
    }
    function carTex(k, carW, carH, p) {
      const B = buffer(carW, carH), g = B.ctx, r = rng(k * 31 + 5);
      const body = g.createLinearGradient(0, 0, 0, carH); body.addColorStop(0, '#d9dde2'); body.addColorStop(0.5, '#a9b0b8'); body.addColorStop(1, '#6f7680');
      g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(0, 0, carW, carH, carH * 0.06) : g.rect(0, 0, carW, carH); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = carH * 0.05; x < carW; x += carH * 0.035) g.fillRect(x, carH * 0.6, Math.max(1, carH * 0.006), carH * 0.38);
      // windows and doors
      for (let j = 0; j < 4; j++) { const x = carW * (0.08 + j * 0.24); g.fillStyle = '#1c2230'; g.fillRect(x, carH * 0.14, carW * 0.13, carH * 0.3); g.fillStyle = 'rgba(255,240,200,0.25)'; g.fillRect(x + 3, carH * 0.16, carW * 0.04, carH * 0.26); }
      g.strokeStyle = 'rgba(30,30,40,0.6)'; g.lineWidth = Math.max(1, carH * 0.01);
      for (const dx of [0.22, 0.74]) { g.strokeRect(carW * dx, carH * 0.1, carW * 0.08, carH * 0.86); }
      // the piece: one or two big bubble clouds, fully painted
      const pieces = 1 + (r() < 0.6 ? 1 : 0);
      for (let q = 0; q < pieces; q++) {
        const tmp = { buf: null };
        const R = carH * (pieces === 1 ? 0.42 : 0.32) * lerp(0.8, 1.2, p.scale);
        prepare(tmp, k * 3 + q, 1000 + k, R, p); paintTo(tmp, 1e9);
        const cx = carW * (pieces === 1 ? 0.5 : 0.28 + q * 0.44) + (r() - 0.5) * carW * 0.06, cy = carH * 0.62;
        g.drawImage(tmp.buf.canvas, cx - tmp.ox, cy - tmp.oy);
        drawDrips(g, tmp, cx, cy, 30, 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, carH * 0.94, carW, carH * 0.06);
      return B.canvas;
    }

    return {
      render(f) {
        const g = f.ctx, w = f.w, h = f.h, t = f.t, p = f.p, wx = windX(p.wind);
        const R = Math.round(h * lerp(0.08, 0.2, p.scale));

        if (mode === 'subway') {
          // dusk sky, skyline, elevated track, and a painted train rolling by
          const sk = g.createLinearGradient(0, 0, 0, h); sk.addColorStop(0, '#26305e'); sk.addColorStop(0.55, '#c0607a'); sk.addColorStop(0.8, '#ffb07a'); g.fillStyle = sk; g.fillRect(0, 0, w, h);
          if (!city || cityKey !== w + 'x' + h) { city = cityTex(w, h); cityKey = w + 'x' + h; cars.clear(); }
          const co = wrap(t * h * 0.01, 0, w); g.drawImage(city, -co, 0); g.drawImage(city, w * 2 - co, 0);
          const carW = Math.round(h * 1.5), carH = Math.round(h * 0.42), gap = Math.round(h * 0.03), slotW = carW + gap, trainCars = 6, cycle = 8;
          const ty = Math.round(h * 0.4), speed = h * lerp(0.1, 0.9, p.x1) * (wx >= 0 ? 1 : -1);
          const X = t * speed;
          // bridge structure
          g.fillStyle = '#15151f'; g.fillRect(0, ty + carH + h * 0.03, w, h * 0.05);
          for (let x = 0; x < w; x += h * 0.35) g.fillRect(x, ty + carH + h * 0.08, h * 0.03, h);
          g.strokeStyle = '#15151f'; g.lineWidth = h * 0.008;
          for (let x = 0; x < w; x += h * 0.35) { g.beginPath(); g.moveTo(x, ty + carH + h * 0.08); g.lineTo(x + h * 0.35, h); g.moveTo(x + h * 0.35, ty + carH + h * 0.08); g.lineTo(x, h); g.stroke(); }
          const first = Math.floor((X - w) / slotW) - 1, last = Math.floor((X + w) / slotW) + 1;
          for (let k = first; k <= last; k++) {
            const m = ((k % cycle) + cycle) % cycle; if (m >= trainCars) continue;
            const x = Math.round(k * slotW - X);
            if (x > w || x + carW < 0) continue;
            if (!cars.has(k)) { cars.set(k, carTex(k, carW, carH, p)); if (cars.size > 6) cars.delete(cars.keys().next().value); }
            g.drawImage(cars.get(k), x, ty);
            g.fillStyle = '#111'; g.fillRect(x + carW * 0.08, ty + carH, carW * 0.18, h * 0.035); g.fillRect(x + carW * 0.74, ty + carH, carW * 0.18, h * 0.035);
            g.fillStyle = '#333'; g.fillRect(x + carW, ty + carH * 0.45, gap, carH * 0.2);
          }
          // platform in the foreground
          g.fillStyle = '#2a2a33'; g.fillRect(0, h * 0.9, w, h * 0.1); g.fillStyle = '#e8c840'; g.fillRect(0, h * 0.9, w, h * 0.012);
          tint(g, w, h, p.light);
          return;
        }

        // ---------- wall ----------
        if (mode === 'chalk') {
          if (!sidewalk || sideKey !== w + 'x' + h) { sidewalk = sidewalkTex(w, h); sideKey = w + 'x' + h; }
          const off = wrap(t * h * 0.02 * wx, 0, sidewalk.per);
          g.drawImage(sidewalk.canvas, -off, 0);
        } else {
          if (!wall || wallKey !== w + 'x' + h) { wall = buildWall(mode, w, h); wallKey = w + 'x' + h; }
          g.drawImage(wall, 0, 0);
        }
        if (mode === 'wild') tint(g, w, h, p.light);

        // ---------- painted clouds ----------
        const N = Math.round(lerp(2, mode === 'stencil' ? 8 : 7, p.coverage));
        const P = 34, pe = clamp(lerp(0.75, 0.22, p.x1)), pan = mode === 'chalk' ? t * h * 0.02 * wx : 0;
        let budget = warm ? 2500 : 1e9; warm = true; // the very first frame paints everything due; later frames cap the work
        for (let i = 0; i < N; i++) {
          if (!slots[i]) slots[i] = {};
          const slot = slots[i];
          const u = t / P + i / N + (mode === 'stencil' ? 0 : hash(i, 2) * 0.2), cyc = Math.floor(u), ph = u - cyc;
          const Ri = Math.round(R * (mode === 'stencil' ? 0.8 : 0.85 + hash(i, cyc) * 0.35));
          const key = Ri + '|' + p.detail.toFixed(2) + '|' + p.x3.toFixed(2);
          if (slot.cyc !== cyc || slot.key !== key || !slot.buf) prepare(slot, i, cyc, Ri, p);
          const prog = clamp(ph / pe), target = Math.floor(Math.pow(prog, 0.9) * slot.dots.length);
          if (target < slot.drawn) { slot.buf.ctx.clearRect(0, 0, slot.buf.canvas.width, slot.buf.canvas.height); slot.drawn = 0; }
          const want = Math.min(target, slot.drawn + budget); budget -= want - slot.drawn; paintTo(slot, want);
          // position: a loose grid, drifting with the wind after it's finished
          let cx, cy;
          if (mode === 'stencil') { const cols = Math.ceil(N / 2); cx = ((i % cols) + 0.5) / cols * w; cy = h * (i < cols ? 0.34 : 0.74); }
          else if (mode === 'chalk') { const per = w / Math.max(2, N - 0.5); cx = wrap((i + 0.5) * per + hash(i, cyc) * per * 0.3 - pan, -per * 0.5, N * per - per * 0.5); cy = h * (0.25 + hash(i, cyc + 5) * 0.5); }
          else { cx = ((i + 0.5) / N + (hash(i, cyc) - 0.5) * 0.12) * w; cy = h * (0.22 + hash(i, cyc + 3) * 0.42) + (i % 2) * h * 0.08; }
          const hold = Math.max(0, ph - pe) * P;
          if (mode !== 'stencil' && mode !== 'chalk') { cx += hold * h * 0.006 * wx; cy += Math.sin(hold * 0.4 + i) * h * 0.004; }
          const alpha = 1 - clamp((ph - 0.9) / 0.1);
          const x0 = Math.round(cx - slot.ox), y0 = Math.round(cy - slot.oy);
          g.globalAlpha = alpha;
          g.drawImage(slot.buf.canvas, x0, y0);
          g.globalAlpha = 1;
          if (mode === 'wild') { // neon pulse
            const fl = 0.25 + 0.25 * Math.sin(f.clock * 3 + i * 2) * p.x4 + (hash(Math.floor(f.clock * 10), i) > 0.97 ? -0.2 : 0);
            g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(fl * alpha * (0.4 + p.x4)); g.drawImage(slot.buf.canvas, x0, y0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
          }
          if (mode !== 'chalk' && mode !== 'stencil' && prog >= 1) drawDrips(g, slot, cx, cy, hold, alpha);
          if (prog > 0 && prog < 1 && slot.drawn > 0) {
            const dd = slot.dots[slot.drawn - 1], nx = cx + dd[0] * slot.R, ny = cy + dd[1] * slot.R;
            if (mode === 'chalk') {
              g.save(); g.translate(nx, ny); g.rotate(0.7); g.fillStyle = `rgb(${slot.rgb[dd[4]]})`; g.fillRect(-R * 0.03, -R * 0.02, R * 0.06, R * 0.22); g.restore();
            } else {
              g.globalAlpha = 0.18 * p.x3 + 0.05; g.drawImage(sprite(slot.rgb[dd[4]], 0.1), nx - R * 0.2, ny - R * 0.2, R * 0.4, R * 0.4); g.globalAlpha = 1;
              can(g, nx, ny, R, `rgb(${slot.rgb[dd[4]]})`, f.clock);
            }
          }
        }
        if (mode === 'chalk') {
          // a chalk sun in the corner, scrolling with the sidewalk
          const sx = wrap(w * 0.85 - pan, -h * 0.3, w + h * 0.3), sy = h * 0.2, sr = h * 0.08;
          g.globalAlpha = 0.85; g.strokeStyle = '#ffe680'; g.lineWidth = h * 0.006; g.setLineDash([h * 0.012, h * 0.004]);
          g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.stroke();
          for (let k = 0; k < 10; k++) { const a = k / 10 * TAU + Math.sin(t) * 0.05; g.beginPath(); g.moveTo(sx + Math.cos(a) * sr * 1.3, sy + Math.sin(a) * sr * 1.3); g.lineTo(sx + Math.cos(a) * sr * 1.8, sy + Math.sin(a) * sr * 1.8); g.stroke(); }
          g.setLineDash([]); g.globalAlpha = 1;
          if (p.x4 > 0) { g.save(); g.globalCompositeOperation = 'overlay'; g.fillStyle = `rgba(255,255,255,${p.x4 * 0.15})`; g.fillRect(0, 0, w, h); g.restore(); }
        }
        if (mode !== 'wild') tint(g, w, h, p.light);
      }
    };
  }
};

const d = (id, name, desc, mode, params, tags = []) => ({ id: 'graffiti-' + id, name, desc, opts: { mode }, params, tags: ['art', 'stylized', '2d', ...tags] });
export const scenes = [
  d('brick', 'Spray Clouds on Brick', 'Soft spray-paint clouds with overspray and running drips on an old brick wall.', 'brick', { coverage: 0.5, scale: 0.55, x1: 0.55, x2: 0.6, light: 0.85 }),
  d('bubble', 'Bubble-Letter Clouds', 'Fat candy-coloured clouds with black outlines, 3D shadows and shine.', 'bubble', { coverage: 0.45, scale: 0.45, x1: 0.5, x2: 0.5, light: 0.9 }, ['cartoon']),
  d('wildstyle', 'Neon Wildstyle', 'Glowing outlines and arrows sprayed onto dark concrete at night.', 'wild', { coverage: 0.5, scale: 0.55, x1: 0.5, x2: 0.4, x4: 0.7, light: 0.1 }, ['night', 'abstract']),
  d('stencil', 'Stencil Series', 'The same cloud stencil sprayed again and again in red, black and blue.', 'stencil', { coverage: 0.55, scale: 0.45, x1: 0.6, x3: 0.5, light: 0.9 }),
  d('chalk', 'Sidewalk Chalk', 'Hatched chalk clouds drawn on concrete slabs as you stroll past.', 'chalk', { coverage: 0.5, scale: 0.5, x1: 0.5, x4: 0.3, light: 0.9 }, ['pastel']),
  d('subway', 'Painted Train', 'A graffiti-covered train rolls across an elevated track at dusk.', 'subway', { coverage: 0.5, scale: 0.55, x1: 0.45, light: 0.6 }, ['sunset']),
];
