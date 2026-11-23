// Pixel-art clouds: everything is rasterised by hand into a small palette-limited buffer (ordered dithering, 1px
// outlines, per-bump ball shading) and then blown up with nearest-neighbour scaling.
import { clamp, lerp, wrap, rng, hash, fract, windX, buffer } from '../util.js';

const TAU = Math.PI * 2;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const hex = s => { const n = parseInt(s.slice(1), 16); return ((255 << 24) | ((n & 255) << 16) | ((n >> 8 & 255) << 8) | (n >> 16)) >>> 0; };
const pal = a => Uint32Array.from(a.map(hex));
const mix32 = (a, b, t) => { // blend two packed colours (for flash/fog tables)
  const r = lerp(a & 255, b & 255, t), g = lerp(a >> 8 & 255, b >> 8 & 255, t), bl = lerp(a >> 16 & 255, b >> 16 & 255, t);
  return ((255 << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
};

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

// tileable value noise for the Mode-7 texture
function tnoise(x, y, P) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = v => ((v % P) + P) % P, h = (a, b) => hash(m(a), m(b), P);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), ux), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), ux), uy);
}

const SCENES = {
  nes:    { sky: ['#5c94fc'], cloud: ['#a4e4fc', '#fcfcfc'], outline: '#000000', light: [-0.2, -0.9, 0.4], vert: 0.6, layers: [[1, 0.06, 0.45, 1, 1]], tint: 1 },
  gb:     { sky: ['#306230', '#8bac0f'], cloud: ['#306230', '#8bac0f', '#9bbc0f', '#9bbc0f', '#9bbc0f'], outline: '#0f380f', light: [-0.4, -0.8, 0.5], vert: 0.4, layers: [[1, 0.05, 0.5, 1, 1]], lcd: 1 },
  cga:    { sky: ['#000000', '#000000', '#ff55ff'], cloud: ['#ff55ff', '#55ffff', '#ffffff'], outline: '#000000', light: [-0.3, -0.8, 0.5], vert: 0.3, layers: [[1, 0.06, 0.4, 1, 1]] },
  pico:   { sky: ['#29adff', '#29adff', '#29adff', '#c2c3c7'], cloud: ['#83769c', '#c2c3c7', '#fff1e8'], outline: null, light: [-0.4, -0.8, 0.5], vert: 0.5, layers: [[0.8, 0.05, 0.4, 0.7, 0.8], [0.6, 0.02, 0.3, 1.1, 1.2]], tint: 1 },
  snes:   { sky: ['#1830a0', '#2848c0', '#3c68e0', '#5888f0', '#80aaf8', '#b0ccf8', '#e0ecff'], tint: 1, light: [-0.3, -0.85, 0.45], vert: 0.4 },
  sunset: { sky: ['#2b1b4f', '#5a2a6e', '#a33a74', '#e8556b', '#ff8a50', '#ffc65a'], cloud: ['#2a1640', '#5a2a6e', '#b0447a', '#ff9a6a'], outline: null, light: [0.2, 0.85, 0.3], vert: -0.5, layers: [[1, 0.06, 0.5, 1, 1]] },
  mode7:  { sky: ['#3050c8', '#5078e8', '#80a8f8', '#c8dcff'], tint: 1 },
  iso:    { sky: ['#78b8f8', '#a8d8ff', '#d8f0ff'], tint: 1 },
  storm:  { sky: ['#0c0c18', '#16162a', '#22223c', '#30304e'], cloud: ['#101020', '#22223a', '#3a3a5a', '#5c5c84', '#8080a8'], outline: null, light: [-0.2, -0.9, 0.4], vert: 0.7, layers: [[0.9, -0.04, 0.25, 0.7, 1.2], [0.7, 0.0, 0.3, 1.2, 1.6]] },
};

export default {
  id: 'pixel',
  name: 'Pixel Art',
  kind: '2d',
  nearest: true,
  params: [
    { id: 'x1', label: 'Pixel size', value: 0.5 },
    { id: 'x2', label: 'Dither', value: 0.7 },
    { id: 'x3', label: 'Outline', value: 1 },
    { id: 'x4', label: 'Extras', value: 0.5 },
  ],
  create(ctx, opts) {
    const mode = opts.mode || 'nes', S = SCENES[mode];
    const P = {}; for (const k in S) if (Array.isArray(S[k]) && typeof S[k][0] === 'string') P[k] = pal(S[k]);
    const OUT = S.outline ? hex(S.outline) : 0;
    let buf = null, img = null, u32 = null, mask = null, stamp = 1, bw = 0, bh = 0, shapeKey = -1, shapes = [];
    let tex = null, tex2 = null, cube = null, cubeS = 0, shadowCube = null, lcd = null;

    function alloc(W, H) {
      bw = W; bh = H; buf = buffer(W, H); img = buf.ctx.createImageData(W, H);
      u32 = new Uint32Array(img.data.buffer); mask = new Int32Array(W * H); stamp = 1; cube = null; lcd = null;
    }
    const pick = (ramp, v, x, y, d) => {
      const n = ramp.length; if (n === 1) return ramp[0];
      let i = Math.floor(clamp(v) * (n - 1) + 0.5 + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * d);
      return ramp[i < 0 ? 0 : i >= n ? n - 1 : i];
    };
    // dithered bands: mostly flat bands, dithered only near each transition
    const pickBand = (ramp, v, x, y, d) => {
      const n = ramp.length, fv = clamp(v) * (n - 1), i0 = Math.floor(fv), fr = fv - i0;
      const s = clamp((fr - 0.5) * (1 + 3 * (1 - d)) + 0.5);
      const i = BAYER[(y & 3) * 4 + (x & 3)] < s ? i0 + 1 : i0;
      return ramp[i >= n ? n - 1 : i];
    };
    function skyFill(ramp, y0, y1, d, band = false, yStart = 0, yEnd = bh) {
      for (let y = Math.max(0, yStart); y < Math.min(bh, yEnd); y++) {
        const v = (y - y0) / (y1 - y0), o = y * bw;
        for (let x = 0; x < bw; x++) u32[o + x] = band ? pickBand(ramp, v, x, y, d) : pick(ramp, v, x, y, d);
      }
    }
    const rect = (x0, y0, x1, y1, c) => {
      x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(bw, x1 | 0); y1 = Math.min(bh, y1 | 0);
      for (let y = y0; y < y1; y++) u32.fill(c, y * bw + x0, y * bw + x1);
    };
    const px = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < bw && y < bh) u32[y * bw + x] = c; };
    function line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (let k = 0; k < 4000; k++) { px(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    function disc(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r * r) px(x, y, c);
      }
    }

    // The heart: one cloud, shaded per bump like a ball, dithered into a ramp, with an optional 1px outline.
    function cloud(cx, cy, R, shape, ramp, out, L, vert, d, bright = 0) {
      const cs = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const b of shape) {
        const c = [cx + b.x * R, cy + b.y * R, Math.max(1, b.r * R)]; cs.push(c);
        x0 = Math.min(x0, c[0] - c[2]); x1 = Math.max(x1, c[0] + c[2]); y0 = Math.min(y0, c[1] - c[2]); y1 = Math.max(y1, c[1] + c[2]);
      }
      x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1); x1 = Math.min(bw - 1, Math.ceil(x1) + 1); y1 = Math.min(bh - 1, Math.ceil(y1) + 1);
      if (x0 > x1 || y0 > y1) return;
      const st = ++stamp, ll = Math.hypot(L[0], L[1], L[2]), lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll, n = cs.length;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5, o = y * bw;
        for (let x = x0; x <= x1; x++) {
          const pxx = x + 0.5; let best = 0, bi = -1;
          for (let k = 0; k < n; k++) { const c = cs[k], dx = pxx - c[0], dy = py - c[1], q = 1 - (dx * dx + dy * dy) / (c[2] * c[2]); if (q > best) { best = q; bi = k; } }
          if (bi < 0) continue;
          const c = cs[bi], nx = (pxx - c[0]) / c[2], ny = (py - c[1]) / c[2], nz = Math.sqrt(best);
          const v = 0.55 + 0.6 * (nx * lx + ny * ly + nz * lz) - vert * (py - cy) / R * 0.5 + bright;
          u32[o + x] = pick(ramp, v, x, y, d); mask[o + x] = st;
        }
      }
      if (!out) return;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * bw + x; if (mask[i] === st) continue;
        if ((x > 0 && mask[i - 1] === st) || (x < bw - 1 && mask[i + 1] === st) || (y > 0 && mask[i - bw] === st) || (y < bh - 1 && mask[i + bw] === st)) u32[i] = out;
      }
    }

    function ensureShapes(detail) {
      const k = Math.round(detail * 3); if (k === shapeKey) return; shapeKey = k;
      shapes = []; for (let i = 0; i < 40; i++) shapes.push(makeShape(rng(77 + i * 13), k / 3));
    }
    // a parallax layer of clouds. L = [count, y0, y1, size, speed]
    function cloudLayer(f, L, li, ramp, out, light, vert, d, bright = 0) {
      const p = f.p, n = Math.round(L[0] * lerp(2, 12, p.coverage)), R = bh * lerp(0.05, 0.14, p.scale) * L[3], m = R * 2.4, wx = windX(p.wind);
      for (let i = 0; i < n; i++) {
        const s = hash(i, li * 7.3), sz = 0.7 + hash(i, li + 3.1) * 0.6;
        const x = Math.round(wrap(s * (bw + 2 * m) + f.t * bh * 0.02 * L[4] * (0.8 + 0.4 * hash(i, 9)) * wx, -m, bw + m));
        const y = Math.round(bh * lerp(L[1], L[2], hash(i, li + 5.7)) + R * 0.5);
        cloud(x, y, R * sz, shapes[(i + li * 11) % shapes.length], ramp, out, light, vert, d, bright);
      }
    }

    function hillsPx(cx, by, rx, ry, fill, edge) {
      for (let y = Math.floor(by - ry) - 1; y < by; y++) for (let x = Math.floor(cx - rx) - 1; x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - by) / ry, q = dx * dx + dy * dy;
        if (q <= 1) px(x, y, q > 1 - 2.2 / Math.min(rx, ry) ? edge : fill);
      }
    }
    // a ridge line of mountains/hills across the screen, from a 1D noise
    function ridge(y0, amp, freq, off, ramp, d, snow = 0, snowCol = 0) {
      for (let x = 0; x < bw; x++) {
        const u = (x + off) * freq, hgt = (Math.abs(Math.sin(u * 1.3) * 0.6 + Math.sin(u * 2.9 + 1) * 0.3 + Math.sin(u * 6.1 + 2) * 0.1)), top = Math.round(y0 - hgt * amp);
        for (let y = Math.max(0, top); y < bh; y++) {
          const v = (y - top) / (amp + 1);
          u32[y * bw + x] = snow && y - top < snow * hgt * amp * 0.25 && hgt > 0.55 ? snowCol : pick(ramp, 1 - v * 1.5, x, y, d);
        }
      }
    }

    // ---------- Mode 7 textures ----------
    function buildTex() {
      tex = new Uint8Array(128 * 128); tex2 = new Uint8Array(128 * 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        let s = 0, a = 0.5, n = 0;
        for (let o = 0, P = 4; o < 4; o++, P *= 2) { s += a * tnoise(x / 128 * P, y / 128 * P, P); n += a; a *= 0.5; }
        tex[y * 128 + x] = (s / n) * 255;
        tex2[y * 128 + x] = tnoise(x / 128 * 16, y / 128 * 16, 16) * 255;
      }
    }
    // ---------- isometric cube sprites ----------
    function buildCube(s) {
      cubeS = s; const W = 2 * s, H = 2 * s;
      const make = (top, left, right, edge, a = 255) => {
        const b = buffer(W, H), id = b.ctx.createImageData(W, H), d = new Uint32Array(id.data.buffer), cls = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const u = x + 0.5 - s, v = y + 0.5; let c = 0;
          if (Math.abs(u) / s + Math.abs(v - s / 2) / (s / 2) <= 1) c = 1;
          else if (u < 0 && v >= s / 2 + (u + s) / 2 && v <= s / 2 + (u + s) / 2 + s) c = 2;
          else if (u >= 0 && v >= s - u / 2 && v <= s - u / 2 + s) c = 3;
          cls[y * W + x] = c;
        }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const c = cls[y * W + x]; if (!c) continue;
          const nb = (xx, yy) => xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : cls[yy * W + xx];
          const isEdge = !nb(x - 1, y) || !nb(x + 1, y) || !nb(x, y - 1) || !nb(x, y + 1);
          let col = c === 1 ? top : c === 2 ? left : right;
          if (isEdge && edge) col = edge;
          d[y * W + x] = a === 255 ? col : (col & 0xffffff) | (a << 24);
        }
        b.ctx.putImageData(id, 0, 0); return b.canvas;
      };
      cube = make(hex('#ffffff'), hex('#dde6f4'), hex('#aabbd8'), hex('#8ea2c8'));
      shadowCube = null;
    }

    function tint(g, w, h, light) {
      const n = clamp((0.62 - light) / 0.62), dk = Math.max(0, 1 - Math.abs(light - 0.32) / 0.22);
      if (dk > 0.01) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = `rgba(255,110,40,${dk * 0.7})`; g.fillRect(0, 0, w, h); }
      if (n > 0.01) { g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${lerp(255, 40, n) | 0},${lerp(255, 50, n) | 0},${lerp(255, 120, n) | 0})`; g.fillRect(0, 0, w, h); }
      g.globalCompositeOperation = 'source-over';
    }

    const C = s => hex(s);
    const col = {
      black: C('#000000'), white: C('#fcfcfc'), green: C('#00a800'), lgreen: C('#80d010'), brick: C('#c84c0c'), brickHi: C('#fcbcb0'),
      gb0: C('#0f380f'), gb1: C('#306230'), gb2: C('#8bac0f'), gb3: C('#9bbc0f'),
      cyan: C('#55ffff'), mag: C('#ff55ff'), cw: C('#ffffff'),
    };
    const PICO = pal(['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa']);

    return {
      render(f) {
        const g = f.ctx, w = f.w, h = f.h, t = f.t, p = f.p;
        const H = Math.max(40, Math.round(lerp(240, 56, p.x1) * (mode === 'snes' || mode === 'mode7' ? 1.1 : 1)));
        const W = Math.max(40, Math.round(H * w / h));
        if (!buf || W !== bw || H !== bh) alloc(W, H);
        ensureShapes(p.detail);
        const d = p.x2, out = p.x3 > 0.5, ex = p.x4, wx = windX(p.wind), bctx = buf.ctx;
        const post = []; // sprite draws after putImageData

        if (mode === 'nes') {
          skyFill(P.sky, 0, bh, d);
          const gy = Math.round(bh * 0.82), scroll = Math.floor(t * bh * 0.12);
          cloudLayer(f, S.layers[0], 0, P.cloud, out ? OUT : 0, S.light, S.vert, d);
          const hp = Math.round(bh * 1.3);
          for (let j = Math.floor(scroll * 0.5 / hp) - 1; j < (scroll * 0.5 + bw) / hp + 1; j++) {
            const cx = Math.round(j * hp - scroll * 0.5 + hp * 0.3), big = hash(j, 2) > 0.4, rx = bh * (big ? 0.26 : 0.16), ry = bh * (big ? 0.22 : 0.12);
            hillsPx(cx, gy, rx, ry, col.green, out ? col.black : C('#005800'));
            const ey = Math.round(gy - ry * 0.62);
            for (const s of [-1, 1]) rect(cx + s * Math.round(rx * 0.16) - 1, ey - 2, cx + s * Math.round(rx * 0.16) + 1, ey + 3, col.black);
            cloud(Math.round(j * hp - scroll * 0.5 + hp * 0.85), gy - Math.round(bh * 0.03), bh * 0.05, shapes[j & 7 & 31], pal(['#00a800', '#80d010']), out ? col.black : 0, S.light, 0.5, d);
          }
          // brick ground
          const bs = Math.max(4, Math.round(bh * 0.045));
          for (let y = gy; y < bh; y++) {
            const row = Math.floor((y - gy) / bs), yy = (y - gy) % bs;
            for (let x = 0; x < bw; x++) {
              const xx = ((x + scroll + (row & 1) * (bs >> 1)) % bs + bs) % bs;
              u32[y * bw + x] = yy === 0 || xx === 0 ? col.black : yy === 1 || xx === 1 ? col.brickHi : col.brick;
            }
          }
          // ? blocks bobbing
          if (ex > 0.2) {
            const qp = Math.round(bh * 1.7), qs = bs * 2;
            for (let j = Math.floor(scroll / qp) - 1; j < (scroll + bw) / qp + 1; j++) {
              const x = j * qp - scroll + (qp >> 1), y = gy - Math.round(bh * 0.28) - (fract(t * 0.5 + j * 0.37) < 0.08 ? 2 : 0);
              rect(x, y, x + qs, y + qs, col.black); rect(x + 1, y + 1, x + qs - 1, y + qs - 1, C('#fc9838'));
              const q = ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'], cs = Math.max(1, Math.floor((qs - 2) / 7));
              q.forEach((r, ry) => [...r].forEach((ch, rxi) => { if (ch === '#') rect(x + (qs - 5 * cs >> 1) + rxi * cs, y + 2 + ry * cs, x + (qs - 5 * cs >> 1) + (rxi + 1) * cs, y + 2 + (ry + 1) * cs, C('#7c0800')); }));
            }
          }
        } else if (mode === 'gb') {
          skyFill(P.sky, -bh * 0.35, bh * 0.75, Math.max(0.6, d));
          cloudLayer(f, S.layers[0], 0, P.cloud, out ? OUT : 0, S.light, S.vert, d, 0.25);
          const sc = t * bh * 0.05;
          ridge(Math.round(bh * 0.8), bh * 0.14, 0.03, sc * 0.4, pal(['#306230']), 0);
          ridge(Math.round(bh * 0.9), bh * 0.06, 0.06, sc, pal(['#0f380f']), 0);
          // little pine trees on the near ridge
          const tp = Math.round(bh * 0.18);
          for (let j = Math.floor(sc / tp) - 1; j < (sc + bw) / tp + 1; j++) {
            if (hash(j, 4) < 0.4) continue;
            const x = Math.round(j * tp - sc), th = Math.round(bh * (0.06 + hash(j) * 0.05)), by = Math.round(bh * 0.86);
            for (let k = 0; k < th; k++) { const hw = Math.floor((th - k) * 0.35 + (k % 3 === 0 ? 1 : 0)); rect(x - hw, by - k, x + hw + 1, by - k + 1, col.gb0); }
          }
          if (ex > 0.3) { // a bird
            const bx = Math.round(wrap(t * bh * 0.08, -10, bw + 10)), by = Math.round(bh * 0.3 + Math.sin(t) * 4), fl = Math.sin(t * 8) > 0 ? -1 : 1;
            px(bx - 2, by + fl, col.gb0); px(bx - 1, by, col.gb0); px(bx, by + 1, col.gb0); px(bx + 1, by, col.gb0); px(bx + 2, by + fl, col.gb0);
          }
        } else if (mode === 'cga') {
          skyFill(P.sky, 0, bh * 0.75, d);
          for (let i = 0; i < 30 + ex * 60; i++) { const x = hash(i, 1) * bw | 0, y = hash(i, 2) * bh * 0.45 | 0; if (Math.sin(t * 2 + i) > -0.6) px(x, y, i % 3 ? col.cw : col.cyan); }
          // big striped CGA sun
          const sx = Math.round(bw * 0.7), sy = Math.round(bh * 0.5), sr = bh * 0.18;
          for (let y = Math.floor(sy - sr); y < sy + sr; y++) { const k = (y - (sy - sr)) / (2 * sr); if (k > 0.45 && ((y - sy) & 3) === 0) continue; for (let x = Math.floor(sx - sr); x < sx + sr; x++) { const dx = x + 0.5 - sx, dy = y + 0.5 - sy; if (dx * dx + dy * dy < sr * sr) px(x, y, k < 0.5 ? col.cw : col.mag); } }
          cloudLayer(f, S.layers[0], 0, P.cloud, out ? OUT : 0, S.light, S.vert, d);
          ridge(Math.round(bh * 0.72), bh * 0.18, 0.025, t * bh * 0.01, pal(['#000000', '#ff55ff']), d, 1, col.cw);
          // perspective grid floor
          const gy = Math.round(bh * 0.74); rect(0, gy, bw, bh, col.black);
          for (let y = gy; y < bh; y++) { const z = (y - gy + 1); if (Math.floor(Math.log(z) * 6 - t * 3) % 2 === 0 && Math.floor(Math.log(z - 1 || 1) * 6 - t * 3) % 2 !== 0) u32.fill(col.mag, y * bw, y * bw + bw); }
          for (let k = -12; k <= 12; k++) line(bw / 2 + k * 2, gy, bw / 2 + k * bw * 0.12, bh - 1, col.cyan);
          line(0, gy, bw - 1, gy, col.cyan);
        } else if (mode === 'pico') {
          const hy = Math.round(bh * 0.68);
          skyFill(P.sky, 0, hy, d, false, 0, hy);
          const sx = Math.round(bw * 0.2), sy = Math.round(bh * 0.22);
          disc(sx, sy, bh * 0.09, PICO[9]); disc(sx, sy, bh * 0.075, PICO[10]);
          cloudLayer(f, S.layers[0], 0, P.cloud, 0, S.light, S.vert, d);
          // sea
          for (let y = hy; y < bh; y++) {
            const z = (y - hy) / (bh - hy);
            for (let x = 0; x < bw; x++) {
              const wv = Math.sin(x * 0.25 / (0.3 + z) + t * 2 + y * 1.7) + Math.sin(x * 0.11 - t * 1.3 + y);
              u32[y * bw + x] = wv > 1.75 - z * 0.3 ? PICO[7] : wv > 1.2 ? PICO[12] : PICO[1];
            }
            // sun glitter column
            const gx = sx + Math.round(Math.sin(t * 3 + y) * 3 * (1 + (y - hy) * 0.05));
            if (((y + Math.floor(t * 6)) & 1) === 0) rect(gx - 2 - (y - hy) * 0.1, y, gx + 2 + (y - hy) * 0.1, y + 1, PICO[10]);
          }
          rect(0, hy, bw, hy + 1, PICO[6]);
          // island with palm
          const ix = Math.round(bw * 0.72), iw = Math.round(bh * 0.16);
          for (let y = 0; y < 5; y++) rect(ix - iw + y * 2, hy - y, ix + iw - y * 2, hy - y + 1, y < 2 ? PICO[15] : PICO[11]);
          const sway = Math.round(Math.sin(t * 1.5) * 2);
          for (let k = 0; k < bh * 0.16; k++) px(ix + Math.round(Math.sin(k * 0.12) * 2 + (k / (bh * 0.16)) * sway), hy - 4 - k, PICO[4]);
          const tx = ix + 2 + sway, ty = Math.round(hy - 4 - bh * 0.16);
          for (const [ax, ay] of [[1, 0.3], [-1, 0.3], [0.7, 0.8], [-0.7, 0.8], [0.3, -0.5]]) for (let k = 0; k < bh * 0.09; k++) px(tx + ax * k, ty + ay * k * 0.6 + k * k * 0.03, PICO[3]);
          // gulls
          for (let i = 0; i < Math.round(ex * 5); i++) {
            const bx = Math.round(wrap(hash(i) * bw + t * bh * 0.06 * (1 + hash(i, 2)), -5, bw + 5)), by = Math.round(bh * (0.15 + hash(i, 3) * 0.3) + Math.sin(t + i) * 3), fl = Math.sin(t * 7 + i) > 0 ? -1 : 0;
            px(bx - 2, by + fl, PICO[7]); px(bx - 1, by - 1, PICO[7]); px(bx, by, PICO[7]); px(bx + 1, by - 1, PICO[7]); px(bx + 2, by + fl, PICO[7]);
          }
          cloudLayer(f, S.layers[1], 1, P.cloud, 0, S.light, S.vert, d);
        } else if (mode === 'snes') {
          skyFill(P.sky, 0, bh * 0.8, d);
          const far = pal(['#5870c8', '#7890e0', '#a8bcf0']), mid = pal(['#6c84d0', '#a0b4ec', '#d8e2fc', '#ffffff']), near = pal(['#7890d8', '#b8c8f4', '#e8eeff', '#ffffff']);
          cloudLayer(f, [1, 0.05, 0.35, 0.5, 0.35], 0, far, 0, S.light, 0.3, d);
          ridge(Math.round(bh * 0.72), bh * 0.3, 0.018, t * bh * 0.006, pal(['#283070', '#4050a0', '#6878c0']), d, 1, C('#e8ecff'));
          cloudLayer(f, [0.8, 0.3, 0.55, 0.8, 0.7], 1, mid, out ? C('#5068b8') : 0, S.light, 0.4, d);
          ridge(Math.round(bh * 0.86), bh * 0.12, 0.05, t * bh * 0.03, pal(['#103828', '#1c5838', '#2c7848']), d);
          // near cloud bank rolling across the bottom
          const R = bh * lerp(0.08, 0.16, p.scale), step = R * 1.4, off = t * bh * 0.08 * wx;
          for (let j = Math.floor(-off / step) - 2; j < (bw - off) / step + 2; j++) {
            const x = Math.round(j * step + off);
            cloud(x, Math.round(bh * (0.97 + hash(j, 3) * 0.05)), R * (0.8 + hash(j) * 0.5), shapes[((j % 31) + 31) % 31], near, out ? C('#6078c8') : 0, S.light, 0.3, d);
          }
        } else if (mode === 'sunset') {
          const hy = Math.round(bh * 0.7);
          skyFill(P.sky, -bh * 0.05, hy, d, true, 0, hy);
          const sx = Math.round(bw * 0.5), sr = bh * 0.2, sunC = pal(['#ff6a50', '#ffb347', '#ffe680']);
          for (let y = Math.floor(hy - sr); y < hy; y++) {
            const k = (y - (hy - sr)) / sr; if (k > 0.4 && ((y - hy) % Math.max(2, Math.round(6 - k * 4)) === 0)) continue;
            for (let x = Math.floor(sx - sr); x < sx + sr; x++) { const dx = x + 0.5 - sx, dy = y + 0.5 - hy; if (dx * dx + dy * dy < sr * sr) u32[y * bw + x] = pick(sunC, 1 - k, x, y, d); }
          }
          cloudLayer(f, S.layers[0], 0, P.cloud, 0, S.light, S.vert, d, 0);
          const sea = pal(['#1a1030', '#2b1b4f', '#5a2a6e']), refl = pal(['#ff8a50', '#ffc65a', '#ffe680']);
          for (let y = hy; y < bh; y++) {
            const z = (y - hy) / (bh - hy), o = y * bw;
            for (let x = 0; x < bw; x++) u32[o + x] = pickBand(sea, 1 - z * 0.9, x, y, d);
            const wob = Math.sin(y * 1.3 + t * 2) * 2 + Math.sin(y * 0.7 - t) * 2, half = sr * (1 - z * 0.5) * (0.6 + 0.4 * Math.sin(y * 2.1 + t * 3));
            if ((y & 1) === 0) for (let x = Math.round(sx - half + wob); x < sx + half + wob; x++) if (x >= 0 && x < bw) u32[o + x] = refl[Math.min(2, Math.floor((1 - z) * 3))];
          }
          // a flock in silhouette
          for (let i = 0; i < Math.round(ex * 7); i++) {
            const bx = Math.round(wrap(hash(i) * bw + t * bh * 0.05, -6, bw + 6)), by = Math.round(bh * (0.3 + hash(i, 1) * 0.2) + Math.sin(t * 0.7 + i) * 3), fl = Math.sin(t * 6 + i * 1.3) > 0 ? -1 : 1;
            const c = hex('#1a1030'); px(bx - 2, by + fl, c); px(bx - 1, by, c); px(bx, by + 1, c); px(bx + 1, by, c); px(bx + 2, by + fl, c);
          }
        } else if (mode === 'mode7') {
          if (!tex) buildTex();
          const hy = Math.round(bh * 0.36);
          skyFill(P.sky, -bh * 0.1, hy, d, false, 0, hy);
          // distant sun
          disc(Math.round(bw * 0.78), Math.round(hy * 0.45), bh * 0.05, C('#fff4c0'));
          const yaw = (p.wind - 0.5) * TAU + Math.sin(t * 0.08) * 0.35, fx = Math.cos(yaw), fz = Math.sin(yaw);
          const tsc = lerp(40, 14, p.scale), camX = t * 1.2 * fx, camZ = t * 1.2 * fz, thr = lerp(0.66, 0.4, p.coverage) * 255;
          const haze = C('#c8dcff'), cr = pal(['#6c84c8', '#9cb0e4', '#d4def8', '#ffffff']), sea = pal(['#0c2468', '#14348c', '#2050b0']);
          for (let y = hy; y < bh; y++) {
            const dz = y - hy + 0.5, z = bh * 0.9 / dz, fog = clamp(z / 120), o = y * bw;
            for (let x = 0; x < bw; x++) {
              const sx = (x - bw / 2) / bh * 1.6 * z;
              const wxp = camX + fx * z - fz * sx, wzp = camZ + fz * z + fx * sx;
              const u = Math.floor(wxp * tsc) & 127, v = Math.floor(wzp * tsc) & 127, dn = tex[v * 128 + u];
              let c;
              if (dn > thr) {
                const dl = tex[((v - 2) & 127) * 128 + ((u - 2) & 127)];
                c = pick(cr, 0.35 + (dn - thr) / 90 + (dl - dn) / 50, x, y, d);
              } else {
                const s2 = tex2[(Math.floor(wzp * 30 + t * 6) & 127) * 128 + (Math.floor(wxp * 30) & 127)];
                c = dn > thr - 10 ? sea[0] : pick(sea, s2 / 255 * 0.9 + (fract(s2 * 0.13 + t * 0.5) > 0.96 ? 0.5 : 0), x, y, d);
                if (dn > thr - 10) c = hex('#08184c');
              }
              u32[o + x] = BAYER[(y & 3) * 4 + (x & 3)] < fog * fog * 1.1 ? haze : c;
            }
          }
          // our little plane
          if (ex > 0.15) {
            const plane = ['.....#.....', '....###....', '#.#######.#', '###########', '....###....', '...#####...'];
            const ps = Math.max(1, Math.round(bh / 120)), pxx = Math.round(bw / 2 - 5.5 * ps + Math.sin(t * 0.9) * bh * 0.03), pyy = Math.round(bh * 0.68 + Math.sin(t * 1.7) * bh * 0.015);
            const bank = Math.sin(t * 0.9 + 1.4);
            plane.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '#') rect(pxx + rx * ps, pyy + ry * ps + Math.round(bank * (rx - 5) * 0.25) * ps, pxx + (rx + 1) * ps, pyy + (ry + 1) * ps + Math.round(bank * (rx - 5) * 0.25) * ps, ry === 3 ? C('#a82020') : C('#e83838')); }));
            rect(pxx + 2 * ps, pyy + 9 * ps, pxx + 9 * ps, pyy + 10 * ps, C('#0c2468'));
          }
        } else if (mode === 'iso') {
          skyFill(P.sky, 0, bh, d);
          const N = 22, s = Math.max(2, Math.floor(bw * 0.46 / N / 2) * 2 || 2), ox = Math.round(bw / 2), oy = Math.round(bh * 0.5 - N * s / 2 + bh * 0.2), th = s * 2;
          if (!cube || cubeS !== s) buildCube(s);
          // clouds as voxel columns (world units, drifting along X)
          const nC = Math.round(lerp(2, 8, p.coverage)), vox = [], shadow = new Uint8Array(N * N), rs = lerp(1.6, 4.2, p.scale);
          for (let i = 0; i < nC; i++) {
            const span = N + 16, cxw = wrap(hash(i, 1) * span + t * 0.6 * (0.7 + hash(i, 2) * 0.6) * wx, -8, N + 8), cyw = hash(i, 3) * N;
            const rx = rs * (0.8 + hash(i, 4) * 0.6), ry = rx * (0.6 + hash(i, 5) * 0.3), alt = 6 + Math.round(hash(i, 6) * 3);
            const fxw = Math.floor(cxw), frac = cxw - fxw;
            for (let gy = -Math.ceil(ry); gy <= ry; gy++) for (let gx = -Math.ceil(rx); gx <= rx; gx++) {
              const q = (gx * gx) / (rx * rx) + (gy * gy) / (ry * ry); if (q > 1) continue;
              const hgt = 1 + Math.round((1 - q) * 2.2 * (0.6 + p.detail * 0.6) + (hash(gx + i * 9, gy) - 0.5) * 1.2);
              const X = fxw + gx, Y = Math.round(cyw) + gy;
              for (let z = 0; z < hgt; z++) vox.push([X + frac, Y, alt + z - (q > 0.7 ? 0 : 0)]);
              if (X >= 0 && Y >= 0 && X < N && Y < N) shadow[Y * N + X] = 1;
            }
          }
          // ground plane: a sea with a grassy island, per pixel
          const water = pal(['#1f5fb8', '#2c7bd6', '#5aa8f0']), grass = pal(['#3c9a3a', '#5cc84a']), sand = C('#e8d48c');
          const sideL = pal(['#7a5030', '#1a4a90']), sideR = pal(['#5c3a22', '#143a74']);
          const ground = (X, Y) => { const dx = X - N * 0.5, dy = Y - N * 0.55, r = Math.hypot(dx * 1.1, dy) + (Math.sin(X * 0.9) + Math.cos(Y * 1.1)) * 0.8; return r < 5 ? 2 : r < 6.2 ? 1 : 0; };
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              let X = ((x + 0.5 - ox) / s + (y + 0.5 - oy) / (s / 2)) / 2, Y = ((y + 0.5 - oy) / (s / 2) - (x + 0.5 - ox) / s) / 2;
              const i = y * bw + x;
              if (X >= 0 && Y >= 0 && X < N && Y < N) {
                const tx = X | 0, ty = Y | 0, k = ground(tx, ty), sh = shadow[ty * N + tx];
                let c;
                if (k === 2) c = grass[(tx + ty) & 1];
                else if (k === 1) c = sand;
                else { const wv = Math.sin(X * 1.7 + t * 2) + Math.sin(Y * 2.3 - t * 1.6); c = water[wv > 1.5 ? 2 : (tx + ty) & 1]; }
                if (sh) c = mix32(c, hex('#102040'), 0.4);
                u32[i] = c;
              } else {
                const y2 = y - th;
                X = ((x + 0.5 - ox) / s + (y2 + 0.5 - oy) / (s / 2)) / 2; Y = ((y2 + 0.5 - oy) / (s / 2) - (x + 0.5 - ox) / s) / 2;
                if (X >= 0 && Y >= 0 && X < N && Y < N) {
                  const k = ground(Math.min(N - 1, X | 0), Math.min(N - 1, Y | 0)) ? 0 : 1;
                  u32[i] = x < ox ? sideL[k] : sideR[k];
                }
              }
            }
          }
          // a little tree or two on the island
          const tiso = (X, Y, Z) => [ox + (X - Y) * s, oy + (X + Y) * s / 2 - Z * s];
          for (const [X, Y] of [[N * 0.45, N * 0.5], [N * 0.55, N * 0.62]]) {
            const [tx, ty] = tiso(X, Y, 0);
            rect(tx - 1, ty - s * 2, tx + 1, ty, C('#6b4226')); disc(tx, ty - s * 2.4, s * 0.9, C('#2d7a2d')); disc(tx - 1, ty - s * 2.7, s * 0.5, C('#4caf50'));
          }
          vox.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2]);
          for (const [X, Y, Z] of vox) { const [sx, sy] = tiso(X, Y, Z + 1); post.push([cube, Math.round(sx - s), Math.round(sy)]); }
        } else if (mode === 'storm') {
          const per = 3.2, k = Math.floor(t / per), ph = fract(t / per), strike = hash(k, 5) < 0.35 + ex * 0.65, flash = strike && ph < 0.12 ? (ph < 0.04 || (ph > 0.07 && ph < 0.1) ? 1 : 0.5) : 0;
          const br = flash * 0.5;
          const skyR = flash ? P.sky.map(c => mix32(c, hex('#b0b0e0'), flash * 0.6)) : P.sky;
          const hy = Math.round(bh * 0.8);
          skyFill(skyR, 0, hy, d, false, 0, hy);
          cloudLayer(f, S.layers[0], 0, P.cloud, 0, S.light, S.vert, d, br);
          // the bolt
          if (flash) {
            const r = rng(k * 31 + 7); let x = bw * (0.2 + r() * 0.6), y = bh * 0.15; const tgt = hy;
            const bolt = C('#ffffff'), glow = C('#a0a0ff');
            while (y < tgt) { const nx = x + (r() - 0.5) * bh * 0.08, ny = Math.min(tgt, y + bh * (0.03 + r() * 0.04)); line(x + 1, y, nx + 1, ny, glow); line(x - 1, y, nx - 1, ny, glow); line(x, y, nx, ny, bolt); if (r() < 0.25) { line(nx, ny, nx + (r() - 0.5) * bh * 0.15, ny + bh * 0.06, glow); } x = nx; y = ny; }
          }
          cloudLayer(f, S.layers[1], 1, P.cloud, 0, S.light, S.vert, d, br * 0.6);
          // sea, cliff and lighthouse
          const sea = pal(['#080c18', '#101828', '#1c2840', '#3a4a70']);
          for (let y = hy; y < bh; y++) for (let x = 0; x < bw; x++) {
            const wv = Math.sin(x * 0.3 + t * 3 + y * 2.1) + Math.sin(x * 0.13 - t * 2 + y);
            u32[y * bw + x] = flash ? sea[2 + (wv > 1.2)] : sea[wv > 1.6 ? 3 : wv > 0.8 ? 1 : 0];
          }
          const cx0 = Math.round(bw * 0.78);
          for (let y = Math.round(bh * 0.7); y < bh; y++) { const e = cx0 - Math.round((y - bh * 0.7) * 0.6 + Math.sin(y * 0.7) * 1.5); rect(e, y, bw, y + 1, flash ? C('#3a3a50') : C('#14141c')); }
          const lx = Math.round(bw * 0.86), lt = Math.round(bh * 0.46), lb = Math.round(bh * 0.7), lw = Math.max(2, Math.round(bh * 0.025));
          for (let y = lt; y < lb; y++) { const k2 = (y - lt) / (lb - lt), hw = Math.round(lw * (0.7 + k2 * 0.5)); rect(lx - hw, y, lx + hw, y + 1, Math.floor((y - lt) / Math.max(2, lw)) & 1 ? C('#c03030') : C('#d8d8e0')); }
          rect(lx - lw, lt - lw * 2, lx + lw, lt, C('#ffe680')); rect(lx - lw - 1, lt - lw * 2 - 2, lx + lw + 1, lt - lw * 2, C('#202030'));
          // sweeping beam (dithered)
          const ang = t * 1.2, bxx = Math.cos(ang), beamY = lt - lw;
          if (Math.abs(bxx) > 0.05) {
            const len = bw * 0.9 * Math.abs(bxx), dir = Math.sign(bxx);
            for (let x = 0; x < len; x++) { const spread = x * 0.12, xx = lx + dir * x; for (let y = Math.round(beamY - spread); y <= beamY + spread; y++) if (BAYER[(y & 3) * 4 + (xx & 3)] < 0.55 * (1 - x / len) && xx >= 0 && xx < bw && y >= 0) u32[y * bw + xx] = C('#ffe680'); }
          }
          // rain
          const rc = flash ? C('#c0c8f0') : C('#4a5a80'), n = Math.round(80 + ex * 300);
          for (let i = 0; i < n; i++) {
            const x = wrap(hash(i, 1) * bw + t * bh * 0.4 * wx, 0, bw), y = wrap(hash(i, 2) * bh + t * bh * (1.6 + hash(i) * 0.6), 0, bh);
            line(x, y, x + wx * 2, y + 3, rc);
          }
        }

        img && buf.ctx.putImageData(img, 0, 0);
        for (const [im, x, y] of post) bctx.drawImage(im, x, y);
        g.imageSmoothingEnabled = false;
        g.drawImage(buf.canvas, 0, 0, w, h);
        g.imageSmoothingEnabled = true;
        if (S.lcd) {
          const cw = w / bw, ch = h / bh;
          if (cw >= 3) {
            g.fillStyle = 'rgba(15,56,15,0.18)';
            for (let x = 0; x < bw; x++) g.fillRect(Math.round(x * cw), 0, 1, h);
            for (let y = 0; y < bh; y++) g.fillRect(0, Math.round(y * ch), w, 1);
          }
        }
        if (S.tint) tint(g, w, h, p.light);
      }
    };
  }
};

const d = (id, name, desc, mode, params, tags = []) => ({ id: 'pixel-' + id, name, desc, opts: { mode }, params, tags: ['pixel', 'retro', '2d', ...tags] });
export const scenes = [
  d('nes', '8-Bit Overworld', 'NES-palette clouds over hills with eyes, brick ground and bobbing ? blocks.', 'nes', { coverage: 0.4, scale: 0.5, x1: 0.55, x2: 0.3, light: 1 }, ['cartoon']),
  d('gameboy', 'Pocket Monochrome', 'Four shades of green, dithered clouds and an LCD dot grid.', 'gb', { coverage: 0.45, scale: 0.55, x1: 0.62, x2: 1, light: 0.9 }),
  d('cga', 'CGA Synthwave', 'Magenta, cyan and white clouds over a scrolling grid in 4-colour CGA.', 'cga', { coverage: 0.4, scale: 0.5, x1: 0.55, x2: 1, light: 0.5 }, ['night']),
  d('pico', 'Fantasy Console Isle', 'PICO-8 palette: puffy clouds, glittering sea and a swaying palm.', 'pico', { coverage: 0.45, scale: 0.5, x1: 0.6, x2: 0.6, light: 1 }, ['sea']),
  d('snes', '16-Bit Parallax', 'Layer upon layer of dithered clouds and mountains scrolling at different speeds.', 'snes', { coverage: 0.5, scale: 0.5, x1: 0.3, x2: 0.8, x3: 0, light: 1 }, ['mountains', 'distance']),
  d('sunset', 'Dithered Sunset', 'Ordered-dither colour bands, a striped sun and its shimmering reflection.', 'sunset', { coverage: 0.4, scale: 0.55, x1: 0.42, x2: 0.5, light: 0.9 }, ['sunset', 'sea']),
  d('mode7', 'Mode 7 Cloud Sea', 'Flying over a perspective plane of clouds, SNES Mode-7 style.', 'mode7', { coverage: 0.6, scale: 0.5, x1: 0.35, x2: 0.8, light: 1, speed: 0.6 }, ['distance', 'fast']),
  d('iso', 'Isometric Voxel Sky', 'Blocky voxel clouds drifting over a tiny island, casting square shadows.', 'iso', { coverage: 0.5, scale: 0.5, x1: 0.3, light: 1 }, ['sea']),
  d('storm', 'Pixel Thunderstorm', 'Rain streaks, palette-flash lightning and a lighthouse sweeping the dark.', 'storm', { coverage: 0.6, scale: 0.6, x1: 0.45, x2: 0.8, light: 0.2 }, ['storm', 'weather', 'night', 'moody']),
];
