// Particle clouds: many soft billboard puffs (cached, noise-textured sprites), perspective projected and depth sorted.
// Each puff is drawn twice: once in the shade colour, then again in the lit colour nudged toward the sun, which gives
// every puff (and so every cloud) a lit side and a shadowed side. Positions are pure functions of time where possible.
import { clamp, lerp, smooth, fract, wrap, rng, fbm2, noise2, noise3, buffer, windX } from '../util.js';

// ---------- sprites ----------
let SPR = null;
function sprites() {
  if (SPR) return SPR;
  SPR = [];
  const S = 128;
  for (let v = 0; v < 4; v++) {
    const { canvas, ctx } = buffer(S, S);
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (r < 1) {
        const n = fbm2(dx * 2.4 + v * 13.1, dy * 2.4 + v * 7.7, 4);
        a = smooth(1.0, 0.1, r + (n - 0.5) * 0.75) * smooth(1, 0.6, r);
        a = a * a * (3 - 2 * a);
      }
      const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
    SPR.push(canvas);
  }
  return SPR;
}
const tints = new Map();
function tint(v, c) {
  const r = c[0] & 0xf8, g = c[1] & 0xf8, b = c[2] & 0xf8, key = v * 16777216 + (r << 16) + (g << 8) + b;
  let t = tints.get(key);
  if (t) return t;
  if (tints.size > 400) tints.clear();
  const src = sprites()[v];
  const { canvas, ctx } = buffer(src.width, src.height);
  ctx.drawImage(src, 0, 0); ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, src.width, src.height);
  tints.set(key, canvas);
  return canvas;
}
function blit(ctx, spr, x, y, r, a) {
  if (a <= 0.004 || r < 0.4) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(spr, x - r, y - r, 2 * r, 2 * r);
}

// ---------- colour ----------
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const KEYS = [
  [0.0, { top: [5, 9, 26], bot: [20, 28, 58], lit: [120, 132, 175], shade: [30, 36, 66], sun: [215, 225, 255] }],
  [0.14, { top: [28, 30, 78], bot: [205, 105, 95], lit: [250, 165, 135], shade: [88, 62, 104], sun: [255, 170, 110] }],
  [0.3, { top: [58, 92, 172], bot: [255, 188, 135], lit: [255, 222, 182], shade: [146, 126, 156], sun: [255, 225, 165] }],
  [0.55, { top: [48, 112, 208], bot: [172, 206, 240], lit: [255, 255, 255], shade: [150, 166, 200], sun: [255, 250, 235] }],
  [1.0, { top: [32, 102, 214], bot: [150, 200, 250], lit: [255, 255, 255], shade: [164, 180, 210], sun: [255, 255, 246] }],
];
function palette(light) {
  let i = 0; while (i < KEYS.length - 2 && light > KEYS[i + 1][0]) i++;
  const [l0, a] = KEYS[i], [l1, b] = KEYS[i + 1], t = clamp((light - l0) / (l1 - l0));
  const o = {}; for (const k in a) o[k] = mix3(a[k], b[k], t);
  return o;
}
// scene colour overrides blended over the light-driven palette
function scenePal(f, over, amt = 1) {
  const p = palette(f.p.light);
  if (over) for (const k in over) p[k] = mix3(p[k], over[k], amt * clamp(f.p.light * 1.4));
  return p;
}
function sky(ctx, w, h, pal, y0 = 0, y1 = h) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, css(pal.top)); g.addColorStop(1, css(pal.bot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function glow(ctx, x, y, r, c, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(c, a)); g.addColorStop(0.25, css(c, a * 0.35)); g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function stars(ctx, w, h, night, clock, yMax = 1) {
  if (night <= 0.02) return;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 160; i++) {
    const x = fract(Math.sin(i * 91.7) * 4375.5) * w, y = fract(Math.sin(i * 47.3) * 2531.1) * h * yMax;
    ctx.globalAlpha = night * (0.4 + 0.6 * fract(Math.sin(i * 13.1) * 999)) * (0.7 + 0.3 * Math.sin(clock * 2 + i));
    const s = h * 0.0018 * (1 + (i % 3)); ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}
const sunPos = (w, h, light) => [w * lerp(0.2, 0.68, clamp(light)), h * lerp(0.62, 0.14, smooth(0, 0.6, light))];
// shaded puff: shade sprite, then lit sprite offset toward light (lx, ly unit screen vector)
function shaded(ctx, v, shadeC, litC, x, y, r, a, lit, lx, ly) {
  blit(ctx, tint(v, shadeC), x, y, r, a);
  blit(ctx, tint(v, litC), x + lx * r * 0.22, y + ly * r * 0.22, r * 0.86, a * lit);
}

// ---------- scenes ----------
function makeFly(R) {
  const cl = [];
  for (let i = 0; i < 70; i++) {
    const floor = i % 3 === 0;
    const c = { x: (R() * 2 - 1) * (floor ? 16 : 11), y: floor ? -4 - R() * 1.5 : (R() * 2 - 1) * 3, z0: R(), flat: floor, puffs: [] };
    const n = 5 + (R() * 9 | 0);
    for (let j = 0; j < n; j++) c.puffs.push({ dx: (R() * 2 - 1) * (floor ? 3 : 1.6), dy: (R() * 2 - 1) * (floor ? 0.3 : 0.8) + (floor ? 0 : 0.3 * R()), dz: (R() * 2 - 1) * 1.4, r: 0.6 + R() * 0.9, v: j & 3 });
    cl.push(c);
  }
  return cl;
}
function renderFly(S, f) {
  const { ctx, w, h, t, p } = f, F = h * 0.9, pal = palette(p.light);
  sky(ctx, w, h, pal);
  const [sx0, sy0] = sunPos(w, h, Math.max(p.light, 0.2));
  stars(ctx, w, h, 1 - smooth(0, 0.15, p.light), f.clock, 0.7);
  glow(ctx, sx0, sy0, h * 0.8, pal.sun, 0.55);
  const near = 0.25, far = 34, L = far - near, vel = 3.2;
  const pm = f.pointer.moved ? f.pointer : { x: 0.5, y: 0.5 };
  const camX = Math.sin(t * 0.23) * 1.4 + (pm.x - 0.5) * 4, camY = Math.sin(t * 0.17) * 0.6 - (pm.y - 0.5) * 2.5;
  const roll = Math.sin(t * 0.19) * 0.12 - (pm.x - 0.5) * 0.25;
  const list = [], act = Math.round(S.fly.length * lerp(0.3, 1, p.coverage)), sc = lerp(0.6, 1.7, p.scale);
  for (let i = 0; i < act; i++) {
    const c = S.fly[i], zc = far - fract(c.z0 + t * vel / L) * L;
    for (const q of c.puffs) {
      const Z = zc + q.dz; if (Z < 0.12) continue;
      const X = c.x + q.dx + windX(p.wind) * Math.sin(t * 0.1 + i) * 0.3 - camX, Y = c.y + q.dy - camY;
      list.push([Z, X, Y, q.r * sc, q.v]);
    }
  }
  list.sort((a, b) => b[0] - a[0]);
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(roll);
  const lx = (sx0 - w / 2) / w, ly = (sy0 - h / 2) / h, ln = Math.hypot(lx, ly) || 1;
  const fog = lerp(0.3, 0.75, p.x3);
  for (const [Z, X, Y, r, v] of list) {
    const R = r / Z * F; if (R > h * 3) continue;
    const a = smooth(far, far * (1 - fog), Z) * smooth(0.15, 1.6, Z) * smooth(h * 3, h * 1.2, R) * 0.85;
    const lit = 0.55 + 0.45 * clamp(Y * 0.4 + 0.5);
    shaded(ctx, v, pal.shade, pal.lit, X / Z * F, -Y / Z * F, R, a, lit, lx / ln, ly / ln);
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function makeSea(R) {
  const a = [];
  for (let i = 0; i < 260; i++) a.push({ x: R(), z: 1.2 + Math.pow(R(), 1.6) * 40, r: 0.7 + R() * 0.8, v: i & 3, y: R() * 0.25 });
  for (let k = 0; k < 4; k++) { // distant towers
    const x = R(), z = 18 + R() * 16;
    for (let j = 0; j < 14; j++) a.push({ x: x + (R() - 0.5) * 0.04, z: z + R(), r: 1.2 + R(), v: j & 3, y: R() * 4 + 0.5, tower: 1 });
  }
  return a.sort((p, q) => q.z - p.z);
}
function roundRect(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function renderWindow(S, f) {
  const { ctx, w, h, t, p } = f, pal = palette(p.light);
  const wh = h * 0.88, ww = Math.min(h * 0.64, w * 0.8), cx = w / 2, cy = h / 2, wx = cx - ww / 2, wy = cy - wh / 2, rr = ww * 0.46;
  const bob = Math.sin(t * 1.7) * h * 0.003 + Math.sin(t * 0.61) * h * 0.004;
  ctx.save(); ctx.beginPath(); roundRect(ctx, wx, wy, ww, wh, rr); ctx.clip();
  const hy = cy - h * 0.02 + bob;
  sky(ctx, w, h, pal, wy, hy);
  stars(ctx, w, h * 0.5, 1 - smooth(0, 0.15, p.light), f.clock);
  const sx = cx + ww * 0.22, sy = lerp(hy - h * 0.02, wy + wh * 0.12, smooth(0, 0.6, p.light));
  glow(ctx, sx, sy, h * 0.4, pal.sun, 0.5);
  ctx.globalAlpha = 1; ctx.fillStyle = css(pal.sun); ctx.beginPath(); ctx.arc(sx, sy, h * 0.022, 0, 7); ctx.fill();
  // cloud sea below
  const F = h * 0.9, Hc = 1, span = ww * 2.2, vel = 1.6 * -windX(p.wind) || 1.6, sc = lerp(0.6, 1.5, p.scale);
  ctx.fillStyle = css(mix3(pal.shade, pal.lit, 0.7)); ctx.fillRect(0, hy + h * 0.004, w, h);
  const cov = lerp(0.45, 1, p.coverage);
  for (let i = 0; i < S.sea.length; i++) {
    const q = S.sea[i]; if (!q.tower && fract(q.x * 7.3 + q.z) > cov) continue;
    const X = wrap(q.x * span - t * vel * F * 0.05 / q.z, -span / 2, span / 2);
    const y = hy + Hc / q.z * F * 0.4 - q.y / q.z * F * 0.4, r = q.r * sc * (q.tower ? 1 : 1.6) / q.z * F * 0.4;
    const a = smooth(42, 20, q.z);
    shaded(ctx, q.v, pal.shade, pal.lit, cx + X, y, r, a, q.tower ? 1 : 0.95, 0.2, -1);
  }
  ctx.globalAlpha = 1;
  // haze line at the horizon
  const hz = ctx.createLinearGradient(0, hy - h * 0.06, 0, hy + h * 0.05);
  hz.addColorStop(0, css(pal.bot, 0)); hz.addColorStop(0.55, css(mix3(pal.bot, pal.sun, 0.3), 0.75)); hz.addColorStop(1, css(pal.bot, 0));
  ctx.fillStyle = hz; ctx.fillRect(0, hy - h * 0.06, w, h * 0.11);
  // wing
  const day = smooth(0, 0.3, p.light);
  ctx.save(); ctx.translate(0, bob * 2.5);
  const wg = ctx.createLinearGradient(0, cy + h * 0.15, 0, cy + h * 0.4);
  const wc = mix3([40, 44, 60], [228, 232, 238], day);
  wg.addColorStop(0, css(mix3(wc, pal.sun, 0.25))); wg.addColorStop(1, css(mix3(wc, [60, 66, 80], 0.5)));
  ctx.fillStyle = wg; ctx.beginPath();
  ctx.moveTo(wx - ww * 0.1, cy + h * 0.17); ctx.lineTo(cx + ww * 0.3, cy + h * 0.1); ctx.lineTo(cx + ww * 0.36, cy + h * 0.115);
  ctx.lineTo(cx + ww * 0.12, cy + h * 0.21); ctx.lineTo(wx - ww * 0.1, cy + h * 0.55); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); // flap line
  ctx.moveTo(cx + ww * 0.12, cy + h * 0.21); ctx.lineTo(wx - ww * 0.1, cy + h * 0.55); ctx.lineTo(wx - ww * 0.1, cy + h * 0.5); ctx.lineTo(cx + ww * 0.1, cy + h * 0.205); ctx.fill();
  ctx.fillStyle = css(mix3(wc, [255, 255, 255], 0.4)); ctx.beginPath(); // winglet
  ctx.moveTo(cx + ww * 0.3, cy + h * 0.1); ctx.lineTo(cx + ww * 0.33, cy + h * 0.055); ctx.lineTo(cx + ww * 0.36, cy + h * 0.06); ctx.lineTo(cx + ww * 0.36, cy + h * 0.115); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = css([255, 255, 255], 0.35 * day); ctx.lineWidth = h * 0.003; ctx.beginPath();
  ctx.moveTo(wx - ww * 0.1, cy + h * 0.17); ctx.lineTo(cx + ww * 0.3, cy + h * 0.1); ctx.stroke();
  if (Math.sin(f.clock * 6) > 0.85) glow(ctx, cx + ww * 0.34, cy + h * 0.06, h * 0.03, [255, 60, 60], 0.9); // nav light
  ctx.restore();
  // glass reflection
  const rg = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  rg.addColorStop(0.2, 'rgba(255,255,255,0)'); rg.addColorStop(0.32, 'rgba(255,255,255,0.08)'); rg.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(wx, wy, ww, wh);
  // pulled-down shade
  const shadeY = wy + wh * (0.1 + 0.06 * p.x2);
  const sg = ctx.createLinearGradient(0, wy, 0, shadeY);
  sg.addColorStop(0, '#d9d6cf'); sg.addColorStop(1, '#c4c0b8');
  ctx.fillStyle = sg; ctx.fillRect(wx, wy, ww, shadeY - wy);
  ctx.fillStyle = '#9c978e'; ctx.fillRect(cx - ww * 0.12, shadeY - h * 0.012, ww * 0.24, h * 0.008);
  ctx.restore();
  // cabin wall with the window cut out
  const inner = lerp(0.18, 1, smooth(0, 0.35, p.light));
  const wall = ctx.createRadialGradient(cx, cy, wh * 0.4, cx, cy, w * 0.75);
  wall.addColorStop(0, css(mix3([40, 40, 44], [232, 229, 222], inner))); wall.addColorStop(1, css(mix3([20, 20, 24], [180, 176, 168], inner)));
  ctx.fillStyle = wall; ctx.beginPath(); ctx.rect(0, 0, w, h);
  const pad = h * 0.07; roundRect(ctx, wx - pad, wy - pad, ww + 2 * pad, wh + 2 * pad, rr + pad); ctx.fill('evenodd');
  const bev = ctx.createLinearGradient(0, wy - pad, 0, wy + wh + pad);
  bev.addColorStop(0, css(mix3([30, 30, 34], [200, 196, 188], inner))); bev.addColorStop(1, css(mix3([50, 50, 56], [246, 244, 238], inner)));
  ctx.fillStyle = bev; ctx.beginPath(); roundRect(ctx, wx - pad, wy - pad, ww + 2 * pad, wh + 2 * pad, rr + pad); roundRect(ctx, wx, wy, ww, wh, rr); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = h * 0.006; ctx.beginPath(); roundRect(ctx, wx, wy, ww, wh, rr); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = h * 0.003; ctx.beginPath(); roundRect(ctx, wx - pad, wy - pad, ww + 2 * pad, wh + 2 * pad, rr + pad); ctx.stroke();
}

function makeCluster(R, big) {
  const blobs = [];
  const nb = big ? 9 : 7;
  for (let i = 0; i < nb; i++) {
    const a = i / nb * Math.PI * 2;
    blobs.push({ x: Math.cos(a) * (big ? 1.4 : 1.1) * (0.6 + R() * 0.5), y: 0.2 + R() * 0.3, z: Math.sin(a) * 0.9 * (0.6 + R() * 0.5), r: 0.8 + R() * 0.35 });
  }
  for (let i = 0; i < (big ? 7 : 6); i++) blobs.push({ x: (R() * 2 - 1) * 0.9, y: 0.9 + R() * (big ? 1.1 : 1.5), z: (R() * 2 - 1) * 0.6, r: 0.55 + R() * 0.45 });
  const vol = blobs.map(b => b.r ** 3), tot = vol.reduce((a, b) => a + b, 0);
  const pts = [];
  for (let i = 0; i < 420; i++) {
    let u = R() * tot, k = 0; while (u > vol[k]) { u -= vol[k]; k++; }
    const b = blobs[k];
    let dx, dy, dz; do { dx = R() * 2 - 1; dy = R() * 2 - 1; dz = R() * 2 - 1; } while (dx * dx + dy * dy + dz * dz > 1);
    const s = 0.55 + 0.45 * Math.cbrt(R());
    let x = b.x + dx * b.r * s, y = b.y + dy * b.r * s, z = b.z + dz * b.r * s;
    if (y < -0.25) y = -0.25 + R() * 0.08;
    const nl = Math.hypot(dx, dy, dz) || 1;
    pts.push({ x, y, z, nx: dx / nl, ny: dy / nl, nz: dz / nl, r: (0.32 + R() * 0.28) * b.r, v: i & 3, s: R() * 100 });
  }
  return pts;
}
function renderCluster(S, f, o) {
  const { ctx, w, h, t, p } = f, pal = scenePal(f, o.pal);
  const morph = o.mode === 'morph' ? 1 : 0;
  sky(ctx, w, h, pal, 0, morph ? h : h * 0.85);
  stars(ctx, w, h, 1 - smooth(0, 0.15, p.light), f.clock);
  const [sx, sy] = sunPos(w, h, p.light);
  glow(ctx, sx, sy, h * 0.6, pal.sun, 0.6);
  // distant flat cloud deck on the horizon
  const hy = h * 0.82;
  if (!morph) {
  const hz = ctx.createLinearGradient(0, hy - h * 0.1, 0, h);
  hz.addColorStop(0, css(pal.bot, 0)); hz.addColorStop(0.4, css(mix3(pal.bot, pal.lit, 0.5), 0.9)); hz.addColorStop(1, css(mix3(pal.shade, pal.bot, 0.5)));
  ctx.fillStyle = hz; ctx.fillRect(0, hy - h * 0.1, w, h);
  for (let i = 0; i < 40; i++) {
    const x = wrap(hash1(i) * w * 1.4 + t * h * 0.004 * windX(p.wind), -w * 0.2, w * 1.2), y = hy + hash1(i + 50) * h * 0.12;
    shaded(ctx, i & 3, pal.shade, pal.lit, x, y, h * (0.04 + 0.06 * hash1(i + 9)) * (1 + (y - hy) / h * 6), 0.6, 0.8, 0, -1);
  }
  }
  const yaw = (morph ? t * 0.015 : t * 0.07) + f.pointer.dragX * 3;
  const pitch = clamp((morph ? -0.12 : 0.12) + f.pointer.dragY * 1.5, -0.6, 1.0);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const F = h * (morph ? 1.15 : 0.75) * lerp(0.75, 1.3, p.scale), D = 6;
  const sel = elevAz(p.light), turb = lerp(0.1, 0.6, p.x2) * (morph ? 1.4 : 0.5);
  const n = Math.round(lerp(morph ? 100 : 140, morph ? 200 : 420, p.detail) * lerp(0.6, 1, p.coverage));
  const list = [], drift = morph ? Math.sin(t * 0.05) * 0.4 : 0;
  const ox = w * 0.5, oy = h * (morph ? 0.64 : 0.6);
  for (let i = 0; i < n; i++) {
    const q = S.cluster[i];
    let x = q.x, y = q.y, z = q.z, r = q.r;
    if (turb > 0) {
      const k = t * (morph ? 0.06 : 0.04);
      x += (noise3(q.s, k, 1.3) - 0.5) * turb * 2; y += (noise3(q.s + 7, k, 4.1) - 0.5) * turb * 1.5; z += (noise3(q.s + 3, k, 8.2) - 0.5) * turb * 2;
      r *= 0.75 + 0.5 * noise3(q.s + 11, k * 1.3, 2);
      if (y < -0.25) y = -0.25;
    }
    x += drift;
    // rotate (yaw about y, then pitch about x)
    const X = x * cyw - z * syw, Z1 = x * syw + z * cyw;
    const Y = (y - 0.5) * cp - Z1 * sp, Z = (y - 0.5) * sp + Z1 * cp + D;
    // normals rotate with the cloud; light is in camera space
    const nx = q.nx * cyw - q.nz * syw, nz1 = q.nx * syw + q.nz * cyw, ny = q.ny * cp - nz1 * sp, nz = q.ny * sp + nz1 * cp;
    const lamb = clamp(nx * sel[0] + ny * sel[1] + nz * sel[2]);
    const lit = clamp(0.25 + 0.75 * lamb + (y - 0.3) * 0.25) * (y < 0 ? 0.6 : 1);
    list.push([Z, ox + X / Z * F, oy - Y / Z * F, r / Z * F * (morph ? 0.95 : 1.15), q.v, lit]);
  }
  list.sort((a, b) => b[0] - a[0]);
  const ln = Math.hypot(sel[0], sel[1]) || 1;
  for (const [, x, y, r, v, lit] of list) shaded(ctx, v, pal.shade, pal.lit, x, y, r, 0.92, lit, sel[0] / ln, -sel[1] / ln);
  ctx.globalAlpha = 1;
}
const hash1 = i => fract(Math.sin(i * 127.1 + 3.7) * 43758.5453);
// light direction in camera space: sun to the upper left at noon, low on the horizon at golden hour
function elevAz(light) { const e = lerp(0.05, 1.1, smooth(0, 0.7, light)), a = -0.9; return [Math.sin(a) * Math.cos(e) * -1, Math.sin(e), -Math.cos(a) * Math.cos(e) * 0.6]; }

function renderContrails(S, f) {
  const { ctx, w, h, t, p } = f, pal = scenePal(f, { top: [18, 74, 190], bot: [120, 180, 245] });
  sky(ctx, w, h, pal);
  stars(ctx, w, h, 1 - smooth(0, 0.15, p.light), f.clock);
  const [sx, sy] = sunPos(w, h, p.light);
  glow(ctx, sx, sy, h * 0.5, pal.sun, 0.7);
  // faint cirrus veil
  for (let i = 0; i < 14; i++) {
    const x = wrap(hash1(i) * w * 1.5 + t * h * 0.006 * windX(p.wind), -w * 0.25, w * 1.25), y = hash1(i + 3) * h * 0.8;
    ctx.save(); ctx.translate(x, y); ctx.scale(3, 0.5); blit(ctx, tint(i & 3, pal.lit), 0, 0, h * 0.12, 0.08 + 0.1 * p.coverage); ctx.restore();
  }
  const planes = Math.round(lerp(2, 6, p.coverage)), life = lerp(14, 30, p.x2), NS = Math.round(lerp(60, 130, p.detail));
  const ds = life / NS, sc = lerp(0.6, 1.6, p.scale), wx = windX(p.wind);
  const lit = pal.lit, shade = mix3(pal.shade, pal.lit, 0.4);
  for (let k = 0; k < planes; k++) {
    const P = 22 + k * 5.3, ph = hash1(k + 1) * P;
    const path = s => { // flight index and position (screen units of h) at time s
      const n = Math.floor((s + ph) / P), u = (s + ph) / P - n, seed = n * 7 + k * 31;
      const ang = (hash1(seed) - 0.5) * 1.2 + (hash1(seed + 1) > 0.5 ? 0 : Math.PI);
      const dx = Math.cos(ang), dy = Math.sin(ang) * 0.6, cy0 = h * (0.15 + 0.6 * hash1(seed + 2)), cx0 = w / 2 + (hash1(seed + 3) - 0.5) * w * 0.4;
      const len = Math.hypot(w, h) * 1.5;
      return [cx0 + dx * (u - 0.4) * len, cy0 + dy * (u - 0.4) * len, n, -dy, dx];
    };
    // coarse samples for the old, spread trail; fine ones (on their own fixed grid) near the plane
    const fine = ds / 5, young = 2.5, samples = [];
    for (let s = Math.floor((t - life) / ds) * ds; s < t - young; s += ds) samples.push(s);
    for (let s = Math.ceil((t - young) / fine) * fine; s <= t; s += fine) samples.push(s);
    for (let q = 0; q < samples.length; q++) {
      const s = samples[q], age = t - s, j = Math.round(s / fine); if (age < 0) continue;
      const [x, y, , nx, ny] = path(s);
      const d = age * h * 0.004, X = x + wx * d * 1.5, Y = y + d * 0.2 + (noise2(s * 0.3, k) - 0.5) * age * h * 0.004;
      if (X < -h * 0.3 || X > w + h * 0.3 || Y < -h * 0.3 || Y > h * 1.3) continue;
      const r = h * (0.005 + 0.009 * Math.sqrt(age)) * sc, a = 0.7 * smooth(0, 0.6, age) * Math.exp(-age / (life * 0.45)) * smooth(life, life * 0.7, age);
      const sep = h * 0.007 * (1 - smooth(1, 6, age));
      if (sep > 0.5) {
        blit(ctx, tint(j & 3, lit), X + nx * sep, Y + ny * sep, r, a);
        blit(ctx, tint((j + 1) & 3, lit), X - nx * sep, Y - ny * sep, r, a);
      } else blit(ctx, tint(j & 3, mix3(shade, lit, 0.8)), X, Y, r * 1.2, a);
    }
    const [hx, hy] = path(t);
    ctx.globalAlpha = 1; glow(ctx, hx, hy, h * 0.012, [255, 255, 255], 0.9);
    ctx.fillStyle = css(mix3([40, 40, 50], [235, 235, 240], p.light)); ctx.beginPath(); ctx.arc(hx, hy, h * 0.0025, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderSmoke(S, f) {
  const { ctx, w, h, t, p } = f;
  const day = p.light;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, css(mix3([10, 12, 20], [70, 84, 110], day))); bg.addColorStop(1, css(mix3([40, 24, 26], [190, 150, 130], day)));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const lx = w * 0.12, ly = h * 0.1;
  glow(ctx, lx, ly, h * 1.1, mix3([255, 170, 110], [255, 236, 210], day), 0.35 + 0.3 * p.x1);
  const shade = mix3([40, 42, 56], [120, 124, 140], day), lit = mix3([255, 200, 160], [255, 250, 245], day);
  const sc = lerp(0.6, 1.5, p.scale), wx = windX(p.wind), list = [];
  // steam vents
  const vents = Math.round(lerp(2, 5, p.coverage)), em = lerp(0.3, 0.15, p.detail), life = 8.5;
  for (let k = 0; k < vents; k++) {
    const vx = w * (0.15 + 0.7 * (vents === 1 ? 0.5 : k / (vents - 1))), vy = h * 1.02;
    const s0 = Math.floor(t / em) * em;
    for (let j = Math.ceil(life / em); j >= 0; j--) {
      const s = s0 - j * em, age = t - s, id = Math.round(s / em) + k * 1000;
      const sway = (noise2(id * 0.05 + age * 0.25, k * 3.1) - 0.5) * h * 0.11 * age * (0.4 + p.x2);
      const x = vx + sway + wx * Math.pow(age, 1.5) * h * 0.012, y = vy - h * 0.13 * Math.pow(age, 0.85);
      const r = h * (0.018 + 0.03 * age) * sc, a = 0.2 * smooth(0, 0.5, age) * smooth(life, life * 0.4, age);
      list.push([age, x, y, r, a, id & 3]);
    }
  }
  for (const [, x, y, r, a, v] of list) {
    const dx = lx - x, dy = ly - y, dl = Math.hypot(dx, dy) || 1;
    shaded(ctx, v, shade, lit, x, y, r, a, 0.85, dx / dl, dy / dl);
  }
  // smoke rings: periodic plus clicked
  const rings = [];
  const RP = 3.6, s0 = Math.floor(t / RP) * RP;
  for (let j = 0; j < 4; j++) { const s = s0 - j * RP, n = Math.round(s / RP); rings.push([t - s, w * (0.5 + (hash1(n) - 0.5) * 0.25), h * 0.85, n]); }
  for (const c of S.rings) if (t - c.t0 < 14 && t >= c.t0) rings.push([t - c.t0, c.x * w, c.y * h, c.t0 * 13]);
  S.rings = S.rings.filter(c => t - c.t0 < 14 && t >= c.t0);
  for (const [age, cx, cy0, n] of rings) {
    const cy = cy0 - h * 0.075 * age, R = h * (0.05 + 0.03 * age) * sc, tilt = 0.32 + 0.1 * Math.sin(n);
    const a = 0.5 * smooth(0, 0.6, age) * smooth(13, 5, age), M = 30, pr = h * (0.022 + 0.012 * age) * sc;
    const pts = [];
    for (let i = 0; i < M; i++) {
      const phi = i / M * Math.PI * 2 + age * 0.4;
      const wob = 1 + 0.08 * Math.sin(phi * 3 + age * 1.3 + n);
      pts.push([Math.sin(phi), cx + Math.cos(phi) * R * wob + wx * age * age * h * 0.004, cy + Math.sin(phi) * R * tilt * wob, i]);
    }
    pts.sort((p1, p2) => p1[0] - p2[0]);
    for (const [, x, y, i] of pts) {
      const dx = lx - x, dy = ly - y, dl = Math.hypot(dx, dy) || 1;
      shaded(ctx, i & 3, shade, lit, x, y, pr, a, 0.9, dx / dl, dy / dl);
    }
  }
  ctx.globalAlpha = 1;
}

function makeKingdom(R) {
  const layers = [];
  for (let d = 0; d < 5; d++) {
    const n = 26 + d * 4, puffs = [];
    for (let i = 0; i < n; i++) puffs.push({ x: (i + R() * 0.6) / n, y: R(), r: 0.6 + R() * 0.7, v: (i + d) & 3 });
    layers.push({ puffs, castle: d === 2 ? 0.3 : d === 3 ? 0.78 : -1 });
  }
  return layers;
}
function castle(ctx, x, base, s, cA, cB, roof, t) {
  const tw = [[-1.6, 1.4, 0.32], [-0.8, 2.1, 0.38], [0, 3.0, 0.48], [0.8, 2.2, 0.38], [1.6, 1.5, 0.32]];
  ctx.fillStyle = cB; ctx.fillRect(x - 1.7 * s, base - 1.1 * s, 3.4 * s, 1.1 * s);
  for (const [dx, ht, wd] of tw) {
    const X = x + dx * s, top = base - ht * s;
    const g = ctx.createLinearGradient(X - wd * s, 0, X + wd * s, 0); g.addColorStop(0, cA); g.addColorStop(1, cB);
    ctx.fillStyle = g; ctx.fillRect(X - wd * s, top, wd * 2 * s, ht * s);
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(X - wd * 1.25 * s, top); ctx.lineTo(X, top - wd * 2.6 * s); ctx.lineTo(X + wd * 1.25 * s, top); ctx.fill();
    const fy = top - wd * 2.6 * s; ctx.strokeStyle = roof; ctx.lineWidth = s * 0.04; ctx.beginPath(); ctx.moveTo(X, fy); ctx.lineTo(X, fy - 0.35 * s); ctx.stroke();
    ctx.fillStyle = '#ff9fc6'; ctx.beginPath(); ctx.moveTo(X, fy - 0.35 * s); ctx.quadraticCurveTo(X + 0.2 * s, fy - (0.32 + 0.04 * Math.sin(t * 3 + dx)) * s, X + 0.35 * s, fy - 0.27 * s); ctx.lineTo(X, fy - 0.2 * s); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,200,0.9)'; ctx.fillRect(X - 0.06 * s, top + 0.4 * s, 0.12 * s, 0.22 * s);
  }
}
function renderKingdom(S, f) {
  const { ctx, w, h, t, p } = f;
  const night = 1 - smooth(0.05, 0.4, p.light);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, css(mix3([150, 160, 240], [40, 30, 90], night))); bg.addColorStop(0.55, css(mix3([250, 190, 225], [120, 70, 140], night))); bg.addColorStop(1, css(mix3([255, 222, 200], [200, 120, 150], night)));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h, night, f.clock, 0.6);
  const pm = f.pointer.moved ? f.pointer : { x: 0.5, y: 0.5 };
  const sx = w * 0.7, sy = h * 0.28;
  glow(ctx, sx, sy, h * 0.9, [255, 246, 220], 0.75);
  // rainbow
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const rb = ['#ff6b6b', '#ffb36b', '#fff16b', '#7dff8a', '#6bc8ff', '#8a7dff', '#d67dff'];
  for (let i = 0; i < 7; i++) { ctx.strokeStyle = rb[i]; ctx.globalAlpha = 0.09 * (1 - night); ctx.lineWidth = h * 0.016; ctx.beginPath(); ctx.arc(w * 0.38, h * 0.95, h * (0.62 - i * 0.016), Math.PI, 2 * Math.PI); ctx.stroke(); }
  ctx.restore();
  const lits = [[255, 246, 250], [255, 236, 244], [255, 230, 236], [255, 240, 230], [255, 250, 248]];
  const shades = [[214, 196, 236], [226, 186, 222], [236, 180, 210], [230, 176, 196], [240, 186, 200]];
  const sc = lerp(0.7, 1.4, p.scale), wx = windX(p.wind) || 1;
  for (let d = 0; d < 5; d++) {
    const L = S.kingdom[d], depth = 1 + d * 0.5, span = w + h * 0.8;
    const baseY = h * (0.42 + d * 0.13) + (pm.y - 0.5) * h * 0.03 * d, par = (pm.x - 0.5) * h * 0.04 * d;
    const off = t * h * 0.012 * depth * wx;
    const lit = mix3(lits[d], [150, 140, 200], night * 0.6), shade = mix3(shades[d], [70, 60, 120], night * 0.6);
    if (L.castle >= 0) {
      const x = wrap(L.castle * span + off + par, -h * 0.4, span - h * 0.4);
      castle(ctx, x, baseY - h * 0.02, h * 0.05 * depth * 0.8, css(mix3([255, 250, 252], [180, 170, 220], night)), css(mix3([236, 214, 240], [120, 100, 170], night)), css(mix3([200, 150, 230], [110, 80, 170], night)), t);
    }
    const cov = lerp(0.55, 1, p.coverage);
    for (const q of L.puffs) {
      if (fract(q.x * 13.7) > cov) continue;
      const x = wrap(q.x * span + off + par, -h * 0.4, span - h * 0.4), r = h * 0.055 * depth * q.r * sc;
      const y = baseY + Math.sin(q.x * 18 + d) * h * 0.02 - q.y * r * 0.5 + Math.sin(t * 0.5 + q.x * 30) * h * 0.003;
      shaded(ctx, q.v, shade, lit, x, y, r, 0.95, 0.9, 0.15, -1);
      blit(ctx, tint(q.v, shade), x, y + r * 0.9, r * 1.1, 0.9);
    }
  }
  // bloom + sparkles
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glow(ctx, sx, sy, h * 0.35, [255, 230, 240], 0.35 + 0.4 * p.x1);
  for (let i = 0; i < 40; i++) {
    const x = hash1(i) * w, y = hash1(i + 70) * h * 0.85, tw = Math.pow(Math.max(0, Math.sin(f.clock * (1 + hash1(i + 4)) + i * 2)), 6);
    if (tw < 0.02) continue;
    const s = h * 0.014 * tw; ctx.globalAlpha = tw; ctx.fillStyle = '#fff8ff';
    ctx.beginPath(); ctx.moveTo(x, y - s * 2); ctx.lineTo(x + s * 0.3, y - s * 0.3); ctx.lineTo(x + s * 2, y); ctx.lineTo(x + s * 0.3, y + s * 0.3);
    ctx.lineTo(x, y + s * 2); ctx.lineTo(x - s * 0.3, y + s * 0.3); ctx.lineTo(x - s * 2, y); ctx.lineTo(x - s * 0.3, y - s * 0.3); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function makeTunnel(R) { const a = []; for (let i = 0; i < 520; i++) a.push({ th: R() * Math.PI * 2, z0: R(), rr: 0.85 + R() * 0.5, r: 0.35 + R() * 0.45, v: i & 3, hue: R() }); return a; }
function hueRGB(hh, sat = 0.55, val = 1) {
  const k = n => { const x = (n + hh * 6) % 6; return val * (1 - sat * Math.max(0, Math.min(x, 4 - x, 1))); };
  return [k(5) * 255, k(3) * 255, k(1) * 255];
}
function renderTunnel(S, f) {
  const { ctx, w, h, t, p } = f, F = h * 0.75;
  const near = 0.2, far = 28, L = far - near, vel = lerp(2, 6, p.x2);
  const pm = f.pointer.moved ? f.pointer : { x: 0.5, y: 0.5 };
  const path = z => [Math.sin(z * 0.11 + t * 0.35) * 1.4, Math.cos(z * 0.09 + t * 0.27) * 1.0];
  const [c0x, c0y] = path(0);
  const ox = w / 2 + (pm.x - 0.5) * w * 0.25, oy = h / 2 + (pm.y - 0.5) * h * 0.25;
  ctx.fillStyle = '#05030d'; ctx.fillRect(0, 0, w, h);
  const [ex, ey] = path(10); const EX = ox + (ex - c0x) / 10 * F, EY = oy + (ey - c0y) / 10 * F;
  const day = p.light;
  glow(ctx, EX, EY, h * 0.9, mix3([140, 90, 255], [255, 240, 220], day), 0.9);
  glow(ctx, EX, EY, h * 0.15, [255, 255, 255], 1);
  const list = [], n = Math.round(lerp(220, 520, p.detail) * lerp(0.6, 1, p.coverage)), sc = lerp(0.6, 1.5, p.scale);
  for (let i = 0; i < n; i++) {
    const q = S.tunnel[i], Z = far - fract(q.z0 + t * vel / L) * L;
    const [px, py] = path(Z), th = q.th + t * 0.25 + Z * 0.06;
    const X = Math.cos(th) * 1.6 * q.rr + px - c0x, Y = Math.sin(th) * 1.6 * q.rr + py - c0y;
    list.push([Z, X, Y, q]);
  }
  list.sort((a, b) => b[0] - a[0]);
  const base = lerp(0.78, 0.5, day);
  for (const [Z, X, Y, q] of list) {
    const R = q.r * sc / Z * F; if (R > h * 2.5) continue;
    const a = smooth(far, far * 0.55, Z) * smooth(0.2, 1.2, Z) * 0.9;
    const hh = fract(base + Z * 0.007 + q.hue * 0.09 + Math.sin(t * 0.05) * 0.06);
    const lit = hueRGB(Math.round(hh * 24) / 24, 0.45, 1), sh = hueRGB(Math.round(hh * 24) / 24 + 0.04, 0.7, 0.45);
    const sx = ox + X / Z * F, sy = oy + Y / Z * F, dx = EX - sx, dy = EY - sy, dl = Math.hypot(dx, dy) || 1;
    shaded(ctx, q.v, sh, lit, sx, sy, R, a, 0.85, dx / dl, dy / dl);
  }
  ctx.globalAlpha = 1;
  if (p.x1 > 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, EX, EY, h * 0.5, [255, 220, 255], 0.3 * p.x1); ctx.restore(); }
}

function makeBank(R) {
  const a = [];
  let tries = 0;
  while (a.length < 300 && tries++ < 20000) {
    const x = R(), y = R();
    const d = fbm2(x * 6, y * 3 + 2, 4) - 0.42 + 0.3 * (1 - Math.abs(y - 0.4) * 2.2);
    if (d > R() * 0.25 + 0.05) a.push({ x, y, r: 0.6 + R() * 0.8, v: a.length & 3, d });
  }
  return a.sort((p, q) => q.y - p.y);
}
function renderRays(S, f) {
  const { ctx, w, h, t, p } = f;
  const pal = scenePal(f, { top: [70, 110, 190], bot: [255, 226, 180], lit: [255, 246, 228], shade: [150, 140, 160], sun: [255, 244, 210] }, 0.8);
  sky(ctx, w, h, pal);
  const pm = f.pointer.moved ? f.pointer : null;
  const sx = pm ? pm.x * w : w * (0.5 + Math.sin(t * 0.03) * 0.12), sy = pm ? pm.y * h : h * lerp(0.34, 0.24, p.light);
  glow(ctx, sx, sy, h * 0.7, pal.sun, 0.6);
  const sc = lerp(0.65, 1.5, p.scale), cov = lerp(0.45, 1, p.coverage), wx = windX(p.wind), span = w + h * 0.6;
  const cl = [];
  for (const q of S.bank) {
    if (fract(q.x * 17.3 + q.y * 3.1) > cov) continue;
    const x = wrap(q.x * span + t * h * 0.01 * wx, -h * 0.3, span - h * 0.3), y = h * (0.02 + q.y * 0.62) + Math.sin(t * 0.2 + q.x * 9) * h * 0.005;
    cl.push([x, y, h * 0.1 * q.r * sc, q.v]);
  }
  // occlusion buffer → radial streaks
  const bw = Math.max(16, w >> 2), bh = Math.max(9, h >> 2);
  if (!S.bufA || S.bufA.canvas.width !== bw || S.bufA.canvas.height !== bh) { S.bufA = buffer(bw, bh); S.bufB = buffer(bw, bh); }
  const A = S.bufA.ctx, B = S.bufB.ctx, k = bw / w;
  A.globalAlpha = 1; A.globalCompositeOperation = 'source-over'; A.fillStyle = '#000'; A.fillRect(0, 0, bw, bh);
  glow(A, sx * k, sy * k, bh * 0.4, [255, 240, 210], 1);
  for (const [x, y, r, v] of cl) blit(A, tint(v, [0, 0, 0]), x * k, y * k, r * k * 0.9, 1);
  A.globalAlpha = 1;
  B.globalCompositeOperation = 'source-over'; B.globalAlpha = 1; B.clearRect(0, 0, bw, bh); B.globalCompositeOperation = 'lighter';
  const NR = 18, spread = lerp(0.03, 0.08, p.x2);
  for (let i = 0; i < NR; i++) {
    const s = 1 + i * spread; B.globalAlpha = 0.3 * (1 - i / NR);
    B.drawImage(S.bufA.canvas, sx * k * (1 - s), sy * k * (1 - s), bw * s, bh * s);
  }
  // explicit beams fanning out behind the clouds
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const RL = Math.hypot(w, h) * 1.2;
  for (let i = 0; i < 28; i++) {
    const ang = Math.PI * (0.08 + 0.84 * hash1(i * 3 + 1)) + Math.sin(t * 0.02 + i) * 0.03, wd = 0.012 + 0.03 * hash1(i * 5 + 2);
    const a = (0.06 + 0.1 * p.x1) * Math.pow(0.5 + 0.5 * Math.sin(t * (0.1 + 0.15 * hash1(i)) + i * 2.3), 2);
    if (a < 0.005) continue;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, RL);
    g.addColorStop(0, css(pal.sun, a)); g.addColorStop(0.6, css(pal.sun, a * 0.35)); g.addColorStop(1, css(pal.sun, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang - wd) * RL, sy + Math.sin(ang - wd) * RL); ctx.lineTo(sx + Math.cos(ang + wd) * RL, sy + Math.sin(ang + wd) * RL); ctx.fill();
  }
  ctx.restore();
  // clouds, backlit
  const shade = mix3(pal.shade, [205, 180, 170], 0.45);
  for (const [x, y, r, v] of cl) {
    const dx = sx - x, dy = sy - y, dl = Math.hypot(dx, dy) || 1, near = Math.exp(-dl / (h * 0.45));
    shaded(ctx, v, shade, pal.lit, x, y, r, 0.95, 0.5 + 0.5 * near, dx / dl, dy / dl);
  }
  ctx.globalAlpha = lerp(0.4, 1, p.x1); ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(S.bufB.canvas, 0, 0, w, h);
  if (p.x1 > 0.5) { ctx.globalAlpha = (p.x1 - 0.5) * 1.6; ctx.drawImage(S.bufB.canvas, 0, 0, w, h); }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// ---------- engine ----------
const RENDER = { fly: renderFly, window: renderWindow, orbit: renderCluster, morph: renderCluster, contrails: renderContrails, smoke: renderSmoke, kingdom: renderKingdom, tunnel: renderTunnel, rays: renderRays };

export default {
  id: 'particles', name: 'Particle Clouds', kind: '2d', res: 1,
  params: [
    { id: 'x1', label: 'Glow', value: 0.5 },
    { id: 'x2', label: 'Turbulence', value: 0.5 },
    { id: 'x3', label: 'Haze', value: 0.5 },
  ],
  create(ctx, opts) {
    sprites();
    const mode = opts.mode || 'fly', R = rng(opts.seed || 7);
    const S = { rings: [] };
    if (mode === 'fly') S.fly = makeFly(R);
    if (mode === 'window') S.sea = makeSea(R);
    if (mode === 'orbit' || mode === 'morph') S.cluster = makeCluster(R, mode === 'morph');
    if (mode === 'kingdom') S.kingdom = makeKingdom(R);
    if (mode === 'tunnel') S.tunnel = makeTunnel(R);
    if (mode === 'rays') S.bank = makeBank(R);
    return {
      render(f) {
        for (const c of f.pointer.clicks || []) if (mode === 'smoke') S.rings.push({ x: c.x, y: c.y, t0: f.t });
        f.ctx.globalAlpha = 1; f.ctx.globalCompositeOperation = 'source-over';
        RENDER[mode](S, f, opts);
      }
    };
  }
};

const d = (id, name, desc, opts, params, tags) => ({ id: 'particles-' + id, name, desc, opts, params, tags: ['3d', ...tags] });
export const scenes = [
  d('flythrough', 'Flying Through Clouds', 'Puffs rush past as you glide through a cloud field; move the pointer to steer.', { mode: 'fly', seed: 3 }, { speed: 0.55, coverage: 0.55, light: 0.75 }, ['realistic', 'fast', 'interactive']),
  d('window', 'Window Seat', 'The view from 35,000 feet: wingtip, sun, and a sea of cloud sliding by.', { mode: 'window', seed: 5 }, { speed: 0.5, coverage: 0.75, light: 0.62 }, ['realistic', 'distance']),
  d('orbit', 'Cumulus You Can Orbit', 'A towering cumulus cluster in late light; drag to fly around it.', { mode: 'orbit', seed: 11 }, { speed: 0.5, light: 0.32, x2: 0.3 }, ['realistic', 'interactive', 'sunset']),
  d('morph', 'One Big Poofy Cloud', 'A lone, giant cloud slowly kneading itself into new shapes.', { mode: 'morph', seed: 21 }, { speed: 0.6, light: 0.85, x2: 0.6, scale: 0.55 }, ['realistic']),
  d('contrails', 'Crossing Contrails', 'Jets scratch white lines across a deep blue sky that slowly spread and fade.', { mode: 'contrails', seed: 2 }, { speed: 0.55, coverage: 0.5, light: 0.9 }, ['realistic', 'distance']),
  d('smoke', 'Steam & Smoke Rings', 'Steam plumes and rolling smoke rings rising through warm lamplight; click to puff a ring.', { mode: 'smoke', seed: 4 }, { speed: 0.5, light: 0.35, coverage: 0.35 }, ['moody', 'interactive', 'abstract']),
  d('kingdom', 'Pastel Cloud Kingdom', 'Dreamy pink cloud banks, sky castles, a rainbow and sparkles in soft bloom.', { mode: 'kingdom', seed: 9 }, { speed: 0.45, light: 0.9, x1: 0.6 }, ['fantasy', 'pastel']),
  d('wormhole', 'Cloud Wormhole', 'A twisting tunnel of glowing cloud pulling you toward the light.', { mode: 'tunnel', seed: 13 }, { speed: 0.55, light: 0.2, x1: 0.6 }, ['fantasy', 'fast', 'space', 'interactive']),
  d('heaven', 'Heavenly Rays', 'Sunbeams fan out through gaps in a golden cloud bank; hover to move the sun.', { mode: 'rays', seed: 17 }, { speed: 0.45, light: 0.55, coverage: 0.6, x1: 0.6 }, ['realistic', 'interactive', 'fantasy']),
];
