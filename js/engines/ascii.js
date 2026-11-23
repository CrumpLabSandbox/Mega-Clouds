// Text-mode clouds: an fbm density field sampled on a coarse character grid, mapped to a character ramp.
// Modes: phosphor terminal, amber teletype, emoji, matrix rain, ANSI/BBS blocks, kanji typography.
import { clamp, lerp, smooth, fract, hash, noise2, fbm2, windDir, buffer, mixHex } from '../util.js';

const MONO = '"Menlo","SF Mono","Consolas","DejaVu Sans Mono",monospace';
const JP = '"Hiragino Mincho ProN","Hiragino Mincho Pro","Yu Mincho","Noto Serif CJK JP","MS Mincho",serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const KATA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>';
const CGA = { blk: '#000000', blu: '#0000AA', grn: '#00AA00', cyn: '#00AAAA', red: '#AA0000', mag: '#AA00AA', brn: '#AA5500', lgr: '#AAAAAA',
  dgr: '#555555', lbl: '#5555FF', lgn: '#55FF55', lcy: '#55FFFF', lrd: '#FF5555', lmg: '#FF55FF', yel: '#FFFF55', wht: '#FFFFFF' };

// ---- the shared density field (screen-height units: u across, v down) ----
function makeField(f, st, vprof) {
  const p = f.p, t = f.t, [wx, wy] = windDir(p.wind);
  const sc = lerp(3.6, 1.1, p.scale), oct = 2 + Math.round(p.detail * 3);
  const cov = lerp(0.7, 0.36, p.coverage);
  const ox = t * 0.045 * wx, oy = t * 0.045 * wy * 0.3;
  const pt = f.pointer, pm = pt.moved, px = pt.x * f.w / f.h, py = pt.y;
  const puffs = st.puffs.map(q => ({ x: q.x + (t - q.t0) * 0.045 * wx, y: q.y + (t - q.t0) * 0.045 * wy * 0.3, a: clamp(1 - (t - q.t0) / 12) }))
    .filter(q => q.a > 0);
  return (u, v) => {
    const x = (u - ox) * sc, y = (v - oy) * sc * 1.8;
    const wq = noise2(x * 0.45 + t * 0.017, y * 0.45 - t * 0.011);
    const n = fbm2(x + wq * 1.4, y + wq * 0.8 + t * 0.006, oct);
    let d = (n - cov) / (1 - cov) * 2.6;
    if (vprof) d -= 1 - vprof(v);
    for (const q of puffs) { const dd = (u - q.x) ** 2 + (v - q.y) ** 2; d += 1.6 * q.a * Math.exp(-dd / 0.012); }
    if (pm) { const dd = (u - px) ** 2 + (v - py) ** 2; d -= 1.3 * Math.exp(-dd / 0.008); }
    return clamp(d);
  };
}
function sunPos(f) {
  const l = f.p.light;
  return { u: 0.8 * f.w / f.h, v: l < 0.15 ? lerp(0.22, 0.85, l / 0.15) : lerp(0.85, 0.2, smooth(0.15, 0.85, l)), night: l < 0.15, r: 0.075 };
}

// ---- helpers ----
function ensure(st, key, w, h) {
  const b = st[key];
  if (!b || b.canvas.width !== Math.max(1, w | 0) || b.canvas.height !== Math.max(1, h | 0)) st[key] = buffer(w, h);
  return st[key];
}
function bloom(ctx, st, src, w, h, amt, blur = 3) {
  if (amt <= 0.01) return;
  const b = ensure(st, 'bloom', w / 6, h / 6);
  b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
  b.ctx.imageSmoothingQuality = 'high';
  b.ctx.filter = `blur(${blur}px)`;
  b.ctx.drawImage(src, 0, 0, b.canvas.width, b.canvas.height);
  b.ctx.filter = 'none';
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = amt; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(b.canvas, 0, 0, w, h); ctx.drawImage(b.canvas, 0, 0, w, h); ctx.restore();
}
function scanlines(ctx, st, w, h, amt, roll) {
  if (amt <= 0.01) return;
  const per = Math.max(2, Math.round(h / 220));
  if (!st.scan || st.scanPer !== per) {
    const c = buffer(4, per * 2); c.ctx.fillStyle = '#000'; c.ctx.fillRect(0, per, 4, per);
    st.scan = ctx.createPattern(c.canvas, 'repeat'); st.scanPer = per;
  }
  ctx.save(); ctx.globalAlpha = amt * 0.55; ctx.fillStyle = st.scan; ctx.fillRect(0, 0, w, h);
  // a slow rolling refresh band
  const y = fract(roll) * (h * 1.4) - h * 0.2, g = ctx.createLinearGradient(0, y - h * 0.12, 0, y + h * 0.12);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.05 * amt})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, y - h * 0.12, w, h * 0.24);
  ctx.restore();
}
function grid(f, rel, aspect = 0.6) {
  const ch = f.h * rel, cw = ch * aspect;
  return { ch, cw, cols: Math.ceil(f.w / cw) + 1, rows: Math.ceil(f.h / ch) + 1 };
}
const twinkle = (i, j, c) => hash(i * 1.37, j * 2.11) > 0.985 ? 0.4 + 0.6 * Math.abs(Math.sin(c * (1 + hash(i, j) * 2) + i)) : 0;

// ---- modes ----
function terminal(f, st, amber) {
  const { ctx, w, h, p, t } = f;
  const g = grid(f, lerp(0.05, 0.022, p.detail));
  const L = ensure(st, 'layer', w, h), lc = L.ctx;
  lc.clearRect(0, 0, w, h);
  lc.font = `${(g.ch * 0.92).toFixed(1)}px ${MONO}`; lc.textAlign = 'center'; lc.textBaseline = 'middle';
  const ramp = amber ? ' .,:;irsXA253hMHGS#9B&@' : ' .,:;-~=+*cxoO0#%&@';
  const fg = amber ? [255, 176, 40] : [80, 255, 120];
  const field = makeField(f, st, amber ? null : v => smooth(1.05, 0.55, v));
  const sun = sunPos(f), ink = lerp(0.6, 1.4, p.x4);
  // teletype: the page scrolls up a line at a time; the bottom line is being typed
  const rate = amber ? lerp(1.5, 5, p.speed) : 0, lineF = t * rate, line = Math.floor(lineF);
  const top = amber ? 1 : 1, bottom = g.rows - (amber ? 2 : 2);
  const buckets = new Map();
  for (let j = top; j < bottom; j++) {
    const jj = amber ? j + line : j;
    const v = amber ? (jj + 0.5) * g.ch / h - line * g.ch / h : (j + 0.5) * g.ch / h;
    const typed = amber && j === bottom - 1 ? Math.floor(fract(lineF) * g.cols * 1.15) : 1e9;
    for (let i = 0; i < g.cols; i++) {
      if (i > typed) break;
      const u = (i + 0.5) * g.cw / h;
      let d = field(u, amber ? (jj + 0.5) * g.ch / h * 0.9 : v);
      let c = Math.round(clamp(d * ink) * (ramp.length - 1));
      if (c === 0) {
        const su = u - sun.u, sv = v - sun.v, sd = Math.sqrt(su * su + sv * sv * 0.6);
        if (!sun.night && sd < sun.r * 1.8) c = sd < sun.r ? ramp.length - 1 : (hash(i, jj, Math.floor(f.clock * 3)) > 0.6 ? 2 : 0);
        else if (sun.night && sd < sun.r * 0.8 && su < sun.r * 0.25) c = ramp.length - 4;
        else if (p.light < 0.35 && twinkle(i, jj, f.clock) > 0.5) c = 1;
      }
      if (!c) continue;
      let ch = ramp[c];
      if (amber && hash(i, jj) > 0.97) ch = ramp[Math.max(1, c - 3)];
      let arr = buckets.get(c); if (!arr) buckets.set(c, arr = []);
      arr.push(i * g.cw + g.cw / 2, j * g.ch + g.ch / 2 - (amber ? fract(lineF) ** 8 * g.ch : 0), ch);
    }
  }
  for (const [c, arr] of buckets) {
    const a = 0.35 + 0.65 * c / (ramp.length - 1);
    lc.fillStyle = `rgba(${fg[0]},${fg[1]},${fg[2]},${a})`;
    for (let k = 0; k < arr.length; k += 3) lc.fillText(arr[k + 2], arr[k], arr[k + 1]);
  }
  // chrome: status bar and prompt
  const clockStr = new Date(2026, 0, 1, 0, 0, Math.floor(t)).toTimeString().slice(0, 8);
  lc.fillStyle = `rgba(${fg[0]},${fg[1]},${fg[2]},1)`;
  lc.fillRect(0, 0, w, g.ch * 1.05);
  lc.fillStyle = amber ? '#1a0e00' : '#021a08'; lc.textAlign = 'left';
  lc.fillText(amber ? ` TTY-33  WX TELETYPE  LINE ${String(line % 100000).padStart(5, '0')}  ${clockStr}` :
    ` MEGA-CLOUDS v1.0   STATION 7   COV ${(p.coverage * 100) | 0}%   ${clockStr}`, 0, g.ch * 0.55);
  lc.fillStyle = `rgba(${fg[0]},${fg[1]},${fg[2]},1)`;
  const cursor = fract(f.clock * 1.1) < 0.55 ? '█' : ' ';
  const promptY = (g.rows - 1.5) * g.ch;
  lc.fillText(amber ? `>> PRINTING FORECAST ... ${cursor}` : `C:\\SKY> forecast --live ${cursor}`, g.cw, Math.min(promptY, h - g.ch * 0.7));
  lc.textAlign = 'center';
  // compose
  const bgc = amber ? `rgb(${26 + p.light * 8 | 0},${13 + p.light * 5 | 0},2)` : `rgb(2,${12 + p.light * 8 | 0},6)`;
  ctx.fillStyle = bgc; ctx.fillRect(0, 0, w, h);
  const rg = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.7);
  rg.addColorStop(0, amber ? 'rgba(255,140,20,0.06)' : 'rgba(60,255,120,0.05)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
  bloom(ctx, st, L.canvas, w, h, lerp(0, 1.1, p.x1));
  const jit = (hash(Math.floor(f.clock * 24)) - 0.5) * p.x2 * g.ch * 0.03;
  ctx.drawImage(L.canvas, jit, 0);
  scanlines(ctx, st, w, h, p.x2, f.clock * 0.12);
}

function emoji(f, st) {
  const { ctx, w, h, p, t } = f;
  { // cartoon sky: night navy → sunset peach → day blue
    const l = p.light, day = smooth(0.2, 0.7, l), dusk = Math.max(0, 1 - Math.abs(l - 0.28) / 0.16);
    const top = mixHex(mixHex('#141c4a', '#3d8fe0', day).replace(/rgb\((\d+),(\d+),(\d+)\)/, (m, r, g, b) => '#' + [r, g, b].map(v => (+v).toString(16).padStart(2, '0')).join('')), '#6a5aa8', dusk * 0.6);
    const bot = dusk > 0.01 ? mixHex('#a9d6f5', '#ffb38a', clamp(dusk + (1 - day) * 0.3)) : mixHex('#2a3470', '#a9d6f5', day);
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }
  const g = grid(f, lerp(0.13, 0.065, p.detail), 1);
  const field = makeField(f, st, v => smooth(1.0, 0.6, v));
  const sun = sunPos(f);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // sun / moon and stars
  if (p.light < 0.3) for (let i = 0; i < 40; i++) {
    const a = 0.5 + 0.5 * Math.sin(f.clock * 2 + i * 3.1);
    ctx.globalAlpha = a * smooth(0.3, 0.05, p.light); ctx.font = `${(g.ch * 0.35).toFixed(0)}px ${EMOJI}`;
    ctx.fillText('✨', hash(i, 1) * w, hash(i, 2) * h * 0.8);
  }
  ctx.globalAlpha = 1;
  ctx.font = `${(h * 0.16).toFixed(0)}px ${EMOJI}`;
  ctx.fillText(sun.night ? '🌙' : '☀️', sun.u * h, sun.v * h);
  // a rainbow that drifts slowly behind the clouds
  if (p.light > 0.2) {
    ctx.globalAlpha = smooth(0.2, 0.45, p.light) * 0.9;
    ctx.font = `${(h * 0.32).toFixed(0)}px ${EMOJI}`;
    ctx.fillText('🌈', (0.3 + 0.08 * Math.sin(t * 0.05)) * w, h * 0.72);
    ctx.globalAlpha = 1;
  }
  // grass strip
  ctx.font = `${(g.ch * 0.8).toFixed(0)}px ${EMOJI}`;
  for (let x = g.cw * 0.3; x < w + g.cw; x += g.cw * 0.7) {
    const k = hash(Math.round(x / g.cw * 3), 7);
    ctx.fillText(k > 0.88 ? '🌷' : k > 0.8 ? '🌻' : '🌿', x, h - g.ch * 0.35 + Math.sin(f.clock * 2 + x) * g.ch * 0.04);
  }
  const rain = p.x3, drops = [];
  const cells = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const bob = Math.sin(f.clock * 1.3 + hash(i, j) * 6.28) * g.ch * 0.06;
    const u = (i + 0.5 + (j % 2) * 0.5) * g.cw / h, v = (j + 0.5) * g.ch / h;
    const d = field(u, v);
    if (d < 0.08) continue;
    const e = d > 0.88 && p.coverage > 0.45 ? '⛈️' : d > 0.62 ? '🌧️' : '☁️';
    cells.push(d, u * h, v * h + bob, e);
    if (d > 0.62 && rain > 0.05 && hash(i, j, 3) < rain) drops.push(u * h, v * h, hash(i, j, 9));
  }
  ctx.font = `${(g.ch * 0.4).toFixed(0)}px ${EMOJI}`;
  for (let k = 0; k < drops.length; k += 3) {
    const fall = fract(t * 0.6 + drops[k + 2]);
    ctx.globalAlpha = 1 - fall;
    ctx.fillText('💧', drops[k] + (drops[k + 2] - 0.5) * g.cw, drops[k + 1] + fall * h * 0.45);
  }
  ctx.globalAlpha = 1;
  for (let k = 0; k < cells.length; k += 4) {
    const d = cells[k], s = g.ch * lerp(0.55, 1.75, d);
    ctx.font = `${s.toFixed(0)}px ${EMOJI}`;
    if (cells[k + 3] === '⛈️' && hash(Math.floor(f.clock * 6), k) > 0.995) { ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    ctx.fillText(cells[k + 3], cells[k + 1], cells[k + 2]);
  }
}

function matrix(f, st) {
  const { ctx, w, h, p, t } = f;
  const g = grid(f, lerp(0.045, 0.024, p.detail), 0.62);
  const L = ensure(st, 'layer', w, h), lc = L.ctx;
  lc.clearRect(0, 0, w, h);
  lc.font = `${(g.ch * 0.9).toFixed(1)}px ${MONO}`; lc.textAlign = 'center'; lc.textBaseline = 'middle';
  const field = makeField(f, st, v => smooth(0.75, 0.25, v));
  const K = KATA.length, c10 = Math.floor(f.clock * 8);
  const bottomRow = new Int16Array(g.cols).fill(-1), colD = new Float32Array(g.cols);
  const lv = [[], [], [], []];
  for (let j = 0; j < g.rows; j++) {
    const v = (j + 0.5) * g.ch / h;
    if (v > 0.8) break;
    for (let i = 0; i < g.cols; i++) {
      const d = field((i + 0.5) * g.cw / h, v);
      if (d < 0.06) continue;
      if (d > 0.35) { bottomRow[i] = j; colD[i] = Math.max(colD[i], d); }
      const ch = KATA[Math.floor(hash(i, j, Math.floor(c10 * hash(i, j) * 0.3)) * K)];
      lv[Math.min(3, d * 4 | 0)].push(i, j, ch);
    }
  }
  const cols = ['rgba(0,140,50,0.55)', 'rgba(0,200,70,0.8)', 'rgba(60,255,120,0.95)', 'rgba(200,255,210,1)'];
  for (let k = 0; k < 4; k++) {
    lc.fillStyle = cols[k]; const a = lv[k];
    for (let n = 0; n < a.length; n += 3) lc.fillText(a[n + 2], a[n] * g.cw + g.cw / 2, a[n + 1] * g.ch + g.ch / 2);
  }
  // digital rain falling from under each cloud
  const rain = lerp(0.2, 1, p.x3);
  for (let i = 0; i < g.cols; i++) {
    if (bottomRow[i] < 0 || hash(i, 5) > rain * (0.4 + colD[i])) continue;
    for (let s = 0; s < 2; s++) {
      const sp = lerp(7, 22, hash(i, s, 1)), len = 6 + (hash(i, s, 2) * 16 | 0);
      const span = g.rows - bottomRow[i] + len;
      const head = bottomRow[i] + 1 + ((t * sp + hash(i, s, 3) * span) % span);
      for (let k = 0; k < len; k++) {
        const j = Math.floor(head) - k;
        if (j <= bottomRow[i] || j >= g.rows) continue;
        const a = k === 0 ? 1 : (1 - k / len) * 0.85;
        lc.fillStyle = k === 0 ? `rgba(230,255,235,${a})` : `rgba(20,${200 + 55 * (1 - k / len) | 0},80,${a})`;
        lc.fillText(KATA[Math.floor(hash(i, j, Math.floor(f.clock * 12 + hash(i, j) * 9)) * K)], i * g.cw + g.cw / 2, j * g.ch + g.ch / 2);
      }
    }
  }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const gr = ctx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, `rgba(0,${30 + p.light * 30 | 0},12,1)`); gr.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  bloom(ctx, st, L.canvas, w, h, lerp(0, 1.2, p.x1), 2);
  ctx.drawImage(L.canvas, 0, 0);
  scanlines(ctx, st, w, h, p.x2 * 0.6, f.clock * 0.08);
}

function bbs(f, st) {
  const { ctx, w, h, p, t } = f;
  const cols = Math.round(lerp(56, 120, p.detail)), cw = w / cols, chh = cw * 2, rows = Math.ceil(h / chh);
  const field = makeField(f, st, v => smooth(1.05, 0.6, v));
  const sun = sunPos(f), day = p.light;
  const S = [' ', '░', '▒', '▓', '█'];
  ctx.font = `${(chh * 0.98).toFixed(1)}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  // sky colour pairs by time of day (top → horizon)
  const skyPair = day < 0.15 ? [CGA.blk, CGA.blu] : day < 0.4 ? [CGA.blu, CGA.mag, CGA.red, CGA.brn] : [CGA.blu, CGA.lbl, CGA.cyn];
  const draws = new Map();
  const put = (bg, fg, ch, x, y) => { const k = bg + fg + ch; let a = draws.get(k); if (!a) draws.set(k, a = []); a.push(x, y); };
  for (let j = 1; j < rows - 1; j++) {
    const v = (j + 0.5) * chh / h;
    const sp = clamp(v / (rows * chh / h)) * (skyPair.length - 1), si = Math.min(skyPair.length - 2, sp | 0), sf = sp - si;
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) * cw / h;
      const d = field(u, v), dn = field(u, v + chh / h * 1.5);
      const x = i * cw, y = j * chh;
      // sky: ordered-dither between two neighbouring colours
      const sk = Math.min(3, Math.floor(sf * 4 + ((i + j) % 2) * 0.5));
      let bg = skyPair[si], fg = skyPair[si + 1], ch = S[sk];
      const su = u - sun.u, sv = v - sun.v, sd = Math.sqrt(su * su + sv * sv);
      if (sd < sun.r * 1.6) {
        const k = sd < sun.r ? 4 : sd < sun.r * 1.3 ? 2 : 1;
        bg = skyPair[si]; fg = sun.night ? CGA.lgr : day < 0.4 ? CGA.yel : CGA.yel; ch = S[k];
        if (sun.night && su > sun.r * 0.2) ch = S[k > 2 ? 1 : 0];
      } else if (day < 0.25 && hash(i, j) > 0.985) { ch = (fract(f.clock * 0.7 + hash(i, j, 2)) < 0.5) ? '·' : '+'; fg = CGA.wht; bg = skyPair[si]; }
      if (d > 0.04) {
        const shade = clamp(dn - d + 0.25) * 1.3 + clamp(1 - d) * 0.3; // undersides darker
        const lit = day < 0.15 ? [CGA.dgr, CGA.lgr] : day < 0.4 ? [CGA.mag, CGA.lrd, CGA.yel] : [CGA.dgr, CGA.lgr, CGA.wht];
        const tone = lit[Math.max(0, Math.min(lit.length - 1, Math.round((1 - shade) * (lit.length - 1))))];
        const lvl = Math.min(4, 1 + Math.floor(d * 4.5));
        fg = tone; ch = S[lvl];
        if (lvl === 4) { bg = tone; ch = ' '; }
      }
      put(bg, fg, ch, x, y);
    }
  }
  for (const [k, a] of draws) {
    const bg = k.slice(0, 7), fg = k.slice(7, 14), ch = k.slice(14);
    ctx.fillStyle = bg; for (let n = 0; n < a.length; n += 2) ctx.fillRect(a[n], a[n + 1], cw + 0.6, chh + 0.6);
    if (ch !== ' ') { ctx.fillStyle = fg; for (let n = 0; n < a.length; n += 2) ctx.fillText(ch, a[n] + cw / 2, a[n + 1] + chh / 2); }
  }
  // header and footer bars
  const bar = (y, bgc, fgc, s) => {
    ctx.fillStyle = bgc; ctx.fillRect(0, y, w, chh);
    ctx.fillStyle = fgc; ctx.textAlign = 'left'; ctx.fillText(s, cw * 0.5, y + chh / 2); ctx.textAlign = 'center';
  };
  const hdr = ` ░▒▓█ MEGA-CLOUDS BBS █▓▒░  node 1  14400 baud  ${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')} online`;
  bar(0, CGA.mag, CGA.wht, hdr);
  ctx.fillStyle = CGA.lmg; ctx.fillRect(0, chh * 0.92, w, chh * 0.08);
  const cur = fract(f.clock) < 0.5 ? '▄' : ' ';
  bar((rows - 1) * chh, CGA.blk, CGA.lcy, ` [C]louds  [W]eather  [R]ain  [G]oodbye   Command » ${cur}`);
  if (p.x1 > 0.02) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.x1 * 0.18; ctx.filter = `blur(${(cw * 0.6).toFixed(1)}px)`;
    ctx.drawImage(ctx.canvas, 0, 0, w, h); ctx.restore();
  }
  scanlines(ctx, st, w, h, p.x2 * 0.7, f.clock * 0.1);
}

function kanji(f, st) {
  const { ctx, w, h, p, t } = f;
  const night = p.light < 0.3;
  const day = p.light;
  // paper or night indigo
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  if (night) { bg.addColorStop(0, '#0e1430'); bg.addColorStop(1, '#22284a'); }
  else if (day < 0.5) { bg.addColorStop(0, '#f0dcc0'); bg.addColorStop(1, '#f6c79a'); }
  else { bg.addColorStop(0, '#f3ecdc'); bg.addColorStop(1, '#e9dfc8'); }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // washi fibres (cached)
  if (!st.washi || st.washi.w !== w || st.washi.h !== h) {
    const b = buffer(w, h), r = (n) => hash(n, 4.2);
    b.ctx.strokeStyle = 'rgba(120,90,50,0.08)'; b.ctx.lineWidth = Math.max(1, h / 900);
    for (let i = 0; i < 700; i++) {
      const x = r(i) * w, y = r(i + 1e3) * h, a = r(i + 2e3) * 6.28, l = h * (0.01 + r(i + 3e3) * 0.04);
      b.ctx.beginPath(); b.ctx.moveTo(x, y); b.ctx.quadraticCurveTo(x + Math.cos(a) * l, y + Math.sin(a + 1) * l, x + Math.cos(a + 0.4) * l * 1.6, y + Math.sin(a + 0.4) * l * 1.6); b.ctx.stroke();
    }
    st.washi = { c: b.canvas, w, h };
  }
  ctx.globalAlpha = night ? 0.4 : 1; ctx.drawImage(st.washi.c, 0, 0); ctx.globalAlpha = 1;
  const ink = night ? [240, 232, 210] : [26, 22, 30];
  const g = grid(f, lerp(0.075, 0.038, p.detail), 1);
  const field = makeField(f, st, v => smooth(1.0, 0.55, v));
  const RAMP = ['・', 'ー', 'つ', 'く', 'も', 'ふ', '気', '霞', '霧', '雲'];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const inkAmt = lerp(0.6, 1.3, p.x4);
  // set by size buckets to keep font switches few
  const bucket = [];
  for (let i = 0; i < g.cols; i++) for (let j = 0; j < g.rows; j++) {
    const u = (i + 0.5) * g.cw / h, v = (j + 0.5) * g.ch / h;
    const d = clamp(field(u, v) * inkAmt);
    if (d < 0.07) continue;
    const k = Math.min(RAMP.length - 1, Math.floor(d * RAMP.length));
    const sz = Math.min(5, Math.floor(d * 6));
    (bucket[sz] ||= []).push(u * h + (hash(i, j) - 0.5) * g.cw * 0.15, v * h, RAMP[k], d);
  }
  for (let s = 0; s < bucket.length; s++) {
    const a = bucket[s]; if (!a) continue;
    ctx.font = `${(g.ch * (0.45 + s * 0.14)).toFixed(1)}px ${JP}`;
    for (let n = 0; n < a.length; n += 4) {
      ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${(0.18 + 0.82 * a[n + 3]).toFixed(2)})`;
      ctx.fillText(a[n + 2], a[n], a[n + 1]);
    }
  }
  // falling rain marks
  if (p.x3 > 0.05) {
    ctx.font = `${(g.ch * 0.5).toFixed(1)}px ${JP}`;
    const n = Math.round(p.x3 * 70);
    for (let i = 0; i < n; i++) {
      const x = hash(i, 3) * w, ph = fract(t * (0.15 + hash(i, 4) * 0.1) + hash(i, 5));
      const d = field(x / h, 0.25);
      ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${(0.5 * (1 - ph) * clamp(d * 3)).toFixed(2)})`;
      ctx.fillText(i % 3 ? '丶' : '雨', x + ph * h * 0.05 * windDir(p.wind)[0], h * (0.3 + ph * 0.7));
    }
  }
  // sun or moon as an ink circle (ensō)
  const sun = sunPos(f);
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = night ? 'rgba(245,235,200,0.85)' : 'rgba(190,40,30,0.85)';
  ctx.lineWidth = h * 0.012;
  ctx.beginPath(); ctx.arc(sun.u * h * 0.25 + h * 0.15, sun.v * h * 0.5 + h * 0.05, h * 0.06, 0.3, 0.3 + Math.PI * 1.85); ctx.stroke();
  ctx.restore();
  // vertical title column and a red hanko seal
  ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.9)`;
  ctx.font = `${(h * 0.07).toFixed(0)}px ${JP}`;
  const title = '空ゆく雲';
  for (let k = 0; k < title.length; k++) ctx.fillText(title[k], w - h * 0.07, h * 0.12 + k * h * 0.08);
  const sx = w - h * 0.07, sy = h * 0.12 + title.length * h * 0.08 + h * 0.03, ss = h * 0.075;
  ctx.fillStyle = '#c0281e'; ctx.fillRect(sx - ss / 2, sy - ss / 2, ss, ss);
  ctx.fillStyle = night ? '#22284a' : '#f3ecdc'; ctx.font = `${(ss * 0.78).toFixed(0)}px ${JP}`; ctx.fillText('雲', sx, sy + ss * 0.03);
}

const MODES = { phosphor: f => terminal(f, f.st, false), amber: f => terminal(f, f.st, true), emoji: f => emoji(f, f.st),
  matrix: f => matrix(f, f.st), bbs: f => bbs(f, f.st), kanji: f => kanji(f, f.st) };

export default {
  id: 'ascii',
  name: 'ASCII Clouds',
  kind: '2d',
  res: 1,
  params: [
    { id: 'x1', label: 'Glow', value: 0.6 },
    { id: 'x2', label: 'Scanlines', value: 0.5 },
    { id: 'x3', label: 'Rain', value: 0.4 },
    { id: 'x4', label: 'Ink', value: 0.5 },
  ],
  create(ctx, opts) {
    const st = { puffs: [] };
    const fn = MODES[opts.mode] || MODES.phosphor;
    return {
      render(f) {
        for (const c of f.pointer.clicks || []) {
          st.puffs.push({ x: c.x * f.w / f.h, y: c.y, t0: f.t });
          if (st.puffs.length > 12) st.puffs.shift();
        }
        st.puffs = st.puffs.filter(q => f.t - q.t0 < 12 && f.t >= q.t0);
        f.st = st;
        ctx.save(); fn(f); ctx.restore();
      }
    };
  }
};

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'ascii-' + id, name, desc, opts, params, tags: ['retro', 'stylized', '2d', ...tags] });
export const scenes = [
  d('phosphor', 'Green Phosphor Sky', 'Clouds typed out on a glowing green CRT, scanlines rolling past.',
    { mode: 'phosphor' }, { speed: 0.45, scale: 0.5, coverage: 0.5, detail: 0.6, light: 0.8, x1: 0.65, x2: 0.6, x4: 0.55 }, ['night']),
  d('amber', 'Amber Teletype', 'A weather teletype prints the sky line by line in warm amber.',
    { mode: 'amber' }, { speed: 0.4, scale: 0.45, coverage: 0.55, detail: 0.55, light: 0.3, x1: 0.55, x2: 0.5, x4: 0.5 }, ['moody']),
  d('emoji', 'Emoji Weather', 'Clouds, rain clouds and thunderheads made of emoji, sized by density.',
    { mode: 'emoji' }, { speed: 0.4, scale: 0.55, coverage: 0.5, detail: 0.5, light: 0.85, x3: 0.35 }, ['cartoon', 'weather']),
  d('matrix', 'Digital Downpour', 'Katakana clouds shed green code rain into the dark.',
    { mode: 'matrix' }, { speed: 0.5, scale: 0.5, coverage: 0.5, detail: 0.6, light: 0.3, x1: 0.7, x2: 0.3, x3: 0.7 }, ['night', 'weather']),
  d('bbs', 'ANSI BBS Sky', 'Block-shaded ░▒▓█ clouds in 16 CGA colours, straight off a dial-up board.',
    { mode: 'bbs' }, { speed: 0.4, scale: 0.5, coverage: 0.5, detail: 0.45, light: 0.85, x1: 0.3, x2: 0.35 }, ['pixel']),
  d('kanji', 'Kumo Calligraphy', 'Clouds written in kana and kanji — 雲, 霧, 気 — on washi paper.',
    { mode: 'kanji' }, { speed: 0.35, scale: 0.5, detail: 0.5, coverage: 0.58, light: 0.9, x3: 0.25, x4: 0.7 }, ['art']),
];
