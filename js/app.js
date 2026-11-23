// Mega-Clouds host: gallery, viewer, controls, screensaver shuffle, recording, Invisible Hands, and the embed API.
import { loadAll, defaultsFor, CONTROLS, LOOK } from './registry.js';
import { createOutput } from './post.js';

const $ = s => document.querySelector(s);
const clamp = (v, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
const query = new URLSearchParams(location.search);
const EMBED = query.get('ui') === '0';
const EXTRA = ['x1', 'x2', 'x3', 'x4'];
const ALL_IDS = [...CONTROLS.map(c => c.id), ...EXTRA, ...LOOK.map(c => c.id)];
// Speed: 0 freezes, 0.5 is real time, 1 is 16×
const speedFactor = s => s < 0.02 ? 0 : Math.pow(2, (s - 0.5) * 8);

let scenes = [], engines = [];
let cur = null;           // current slot { scene, engine, canvas, ctx, inst, t }
let old = null;           // outgoing slot during a crossfade
let fadeT = 1, fadeDur = 1.5;
let params = {};          // live control values for the current scene
let paused = false, view = 'gallery';
let output;
let quality = 'auto', autoScale = 0.75;
let shuffleSec = 0, shuffleAt = 0, filterTag = 'all', searchText = '';
const pointer = { x: 0.5, y: 0.5, down: false, moved: false, dragX: 0, dragY: 0, clicks: [] };
let recorder = null, hands = null, lastMeasure = { luma: 0, white: 0 };

// ---------------------------------------------------------------- slots
function makeSlot(scene) {
  const engine = scene.engine;
  const canvas = document.createElement('canvas');
  const ctx = engine.kind === 'gl'
    ? canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: false })
    : canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a ' + engine.kind + ' context');
  const slot = { scene, engine, canvas, ctx, inst: null, t: 20 + Math.random() * 80, nearest: !!engine.nearest };
  sizeSlot(slot);
  slot.inst = engine.create(ctx, scene.opts || {});
  return slot;
}
function disposeSlot(s) {
  if (!s) return;
  try { s.inst?.dispose?.(); } catch (e) { console.warn(e); }
  if (s.engine.kind === 'gl') s.ctx.getExtension('WEBGL_lose_context')?.loseContext();
  s.canvas.width = s.canvas.height = 1;
}
// the gallery backdrop is blurred, so it renders small
function renderScale() { return view === 'gallery' ? 0.3 : quality === 'auto' ? autoScale : +quality; }
function sizeSlot(s) {
  const W = output.canvas.width, H = output.canvas.height;
  const k = renderScale() * (s.scene.res ?? s.engine.res ?? 1) / outScale();
  const w = Math.max(16, Math.round(W * k)), h = Math.max(9, Math.round(H * k));
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w; s.canvas.height = h;
    s.inst?.resize?.(w, h);
  }
}
// the output canvas is at most 1.0× device pixels (capped at 1920 wide); engines render at a fraction of it
function outScale() { return 1; }
function sizeOutput() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  const cap = 1920 * 1200; if (w * h > cap) { const k = Math.sqrt(cap / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
  if (output.canvas.width !== w || output.canvas.height !== h) { output.canvas.width = w; output.canvas.height = h; }
  if (cur) sizeSlot(cur); if (old) sizeSlot(old);
}

// ---------------------------------------------------------------- scene switching
function setScene(scene, { fade = true, keepParams = false } = {}) {
  if (!scene) return;
  let next;
  try { next = makeSlot(scene); }
  catch (e) { console.error(e); toast('Could not start ' + scene.name + ': ' + e.message); return; }
  if (old) disposeSlot(old);
  if (cur && fade && fadeDur > 0) { old = cur; fadeT = 0; } else { disposeSlot(cur); old = null; fadeT = 1; }
  cur = next;
  if (!keepParams) params = defaultsFor(scene.engine, scene);
  buildPanel();
  $('#s-name').textContent = scene.name;
  $('#s-engine').textContent = `${scene.engine.name} · ${scenes.indexOf(scene) + 1}/${scenes.length}`;
  $('#s-desc').textContent = scene.desc || '';
  document.title = scene.name + ' · Mega-Clouds';
  pointer.dragX = pointer.dragY = 0;
  shuffleAt = performance.now() / 1000 + shuffleSec;
  hands?.describe();
  writeURL();
}
function pool() {
  const list = filtered();
  return list.length ? list : scenes;
}
function step(dir) {
  const list = pool(); const i = list.indexOf(cur?.scene);
  setScene(list[(i + dir + list.length) % list.length]);
}
function randomScene() {
  const list = pool().filter(s => s !== cur?.scene);
  setScene(list[Math.floor(Math.random() * list.length)] || scenes[0]);
}

// ---------------------------------------------------------------- render loop
let last = performance.now(), frameMs = 16, slowFor = 0, fastFor = 0, fpsShown = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (!cur) return;
  const t0 = performance.now();
  const sdt = paused ? 0 : dtReal * speedFactor(params.speed);
  renderSlot(cur, sdt, now / 1000);
  if (old) {
    fadeT += dtReal / fadeDur;
    if (fadeT >= 1) { disposeSlot(old); old = null; fadeT = 1; }
    else renderSlot(old, sdt, now / 1000, true);
  }
  pointer.clicks.length = 0;
  output.draw(cur, old, fadeT, params, now / 1000);
  // adaptive quality: keep the frame time under ~30 ms
  frameMs = frameMs * 0.95 + (performance.now() - t0 + (dtReal * 1000 > 40 ? dtReal * 1000 - 16 : 0)) * 0.05;
  if (quality === 'auto' && view === 'viewer' && !old) {
    if (frameMs > 30) { if (++slowFor > 45) { autoScale = Math.max(0.3, autoScale * 0.85); slowFor = 0; sizeSlot(cur); } } else slowFor = 0;
    if (frameMs < 10) { if (++fastFor > 240 && autoScale < 1) { autoScale = Math.min(1, autoScale * 1.12); fastFor = 0; sizeSlot(cur); } } else fastFor = 0;
  }
  if (++frames % 30 === 0) {
    const fps = Math.round(1000 / Math.max(1, (now - fpsShown) / 30)); fpsShown = now;
    if (view === 'viewer' && !$('#panel').hidden) $('#fps').textContent = `${fps} fps · ${cur.canvas.width}×${cur.canvas.height} render → ${output.canvas.width}×${output.canvas.height}`;
  }
  if (hands && frames % 12 === 0) lastMeasure = output.measure();
  if (shuffleSec > 0 && view === 'viewer' && !paused && now / 1000 > shuffleAt) randomScene();
}
function renderSlot(s, sdt, clock, frozenPointer) {
  sizeSlot(s);
  s.t += sdt;
  const p = s === cur ? params : (s.params ||= defaultsFor(s.engine, s.scene));
  try {
    s.inst.render({ ctx: s.ctx, w: s.canvas.width, h: s.canvas.height, t: s.t, dt: sdt, clock, p,
      pointer: frozenPointer ? { ...pointer, clicks: [] } : pointer, opts: s.scene.opts || {} });
  } catch (e) {
    if (!s.failed) { console.error(e); toast(s.scene.name + ': ' + e.message); s.failed = true; }
  }
}

// ---------------------------------------------------------------- controls panel
function slider(host, id, label, tip) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('label'); lab.textContent = label; lab.htmlFor = 'c-' + id; if (tip) lab.title = tip;
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.001; inp.id = 'c-' + id; inp.value = params[id];
  const out = document.createElement('output'); out.textContent = Math.round(params[id] * 100);
  inp.oninput = () => { params[id] = +inp.value; out.textContent = Math.round(params[id] * 100); hands?.recenter(id); writeURLSoon(); };
  inp.ondblclick = () => { params[id] = defaultsFor(cur.engine, cur.scene)[id]; syncSliders(); writeURLSoon(); };
  if (hands) lab.append(hands.tag(id));
  row.append(lab, inp, out); host.append(row);
}
function buildPanel() {
  const main = $('#ctl-main'), extra = $('#ctl-extra'), look = $('#ctl-look');
  main.textContent = extra.textContent = look.textContent = '';
  for (const c of CONTROLS) slider(main, c.id, c.label, c.tip);
  const ex = cur.engine.params || [];
  for (const x of ex) slider(extra, x.id, x.label, x.tip);
  $('#h-extra').hidden = !ex.length;
  for (const c of LOOK) slider(look, c.id, c.label);
}
function syncSliders() {
  for (const id of ALL_IDS) { const el = $('#c-' + id); if (el) { el.value = params[id]; el.nextSibling.textContent = Math.round(params[id] * 100); } }
}
function labelFor(id) {
  const c = CONTROLS.find(c => c.id === id) || LOOK.find(c => c.id === id) || (cur?.engine.params || []).find(c => c.id === id);
  return c ? c.label : null;
}

// ---------------------------------------------------------------- URL state
function writeURL() {
  if (view !== 'viewer' || !cur) return;
  const q = new URLSearchParams();
  q.set('scene', cur.scene.id);
  const def = defaultsFor(cur.engine, cur.scene);
  for (const id of ALL_IDS) if (params[id] !== undefined && Math.abs(params[id] - def[id]) > 0.004) q.set(id, params[id].toFixed(3));
  if (EMBED) q.set('ui', '0');
  if (shuffleSec) q.set('shuffle', shuffleSec);
  if (hands?.room) q.set('room', hands.room);
  history.replaceState(null, '', '?' + q.toString().replace(/%2C/g, ','));
}
let urlTimer = 0;
function writeURLSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(writeURL, 300); }

// ---------------------------------------------------------------- views
function showViewer(scene) {
  view = 'viewer';
  document.body.classList.remove('gallery-mode');
  $('#gallery').hidden = true; $('#hud').hidden = EMBED;
  if (scene && scene !== cur?.scene) setScene(scene, { fade: false });
  writeURL(); wake();
}
function showGallery() {
  view = 'gallery';
  document.body.classList.add('gallery-mode');
  $('#gallery').hidden = false; $('#hud').hidden = true;
  history.replaceState(null, '', location.pathname);
  document.title = 'Mega-Clouds';
  thumbs.kick();
}

// gallery grid + filters
function filtered() {
  const q = searchText.trim().toLowerCase();
  return scenes.filter(s => (filterTag === 'all' || s.tags.includes(filterTag)) &&
    (!q || (s.name + ' ' + s.desc + ' ' + s.tags.join(' ') + ' ' + s.engine.name).toLowerCase().includes(q)));
}
function buildGallery() {
  $('#count').textContent = scenes.length;
  const counts = {};
  for (const s of scenes) for (const t of s.tags) counts[t] = (counts[t] || 0) + 1;
  const tags = Object.keys(counts).filter(t => counts[t] >= 2).sort((a, b) => counts[b] - counts[a]);
  const chips = $('#chips'); chips.textContent = '';
  for (const t of ['all', ...tags]) {
    const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', t === filterTag);
    b.innerHTML = `${t}<small>${t === 'all' ? scenes.length : counts[t]}</small>`;
    b.onclick = () => { filterTag = t; chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b)); drawGrid(); };
    chips.append(b);
  }
  drawGrid();
}
function drawGrid() {
  const grid = $('#grid'); grid.textContent = '';
  thumbs.reset();
  for (const s of filtered()) {
    const card = document.createElement('button'); card.className = 'card'; card.title = s.desc || s.name;
    const c = document.createElement('canvas'); c.width = 384; c.height = 216;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<strong></strong><span></span>`;
    meta.firstChild.textContent = s.name; meta.lastChild.textContent = s.engine.name;
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = s.desc || '';
    card.append(c, desc, meta);
    card.onclick = () => showViewer(s);
    grid.append(card);
    thumbs.watch(c, s);
  }
}

// Thumbnails: render one frame of each visible card on two shared canvases (one WebGL2, one 2D), one per idle slice.
const thumbs = (() => {
  const W = 384, H = 216, cache = new Map();
  let queue = [], busy = false, io = null, glc = null, c2 = null;
  function ctxFor(kind) {
    if (kind === 'gl') {
      if (!glc || glc.ctx.isContextLost()) { const c = document.createElement('canvas'); c.width = W; c.height = H; glc = { c, ctx: c.getContext('webgl2', { preserveDrawingBuffer: true }) }; }
      return glc;
    }
    if (!c2) { const c = document.createElement('canvas'); c.width = W; c.height = H; c2 = { c, ctx: c.getContext('2d') }; }
    return c2;
  }
  function paint(target, s) {
    const g = target.getContext('2d');
    if (cache.has(s.id)) { g.drawImage(cache.get(s.id), 0, 0); return; }
    const { c, ctx } = ctxFor(s.engine.kind);
    let inst;
    try {
      inst = s.engine.create(ctx, s.opts || {});
      const p = defaultsFor(s.engine, s);
      const ptr = { x: 0.5, y: 0.5, down: false, moved: false, dragX: 0, dragY: 0, clicks: [] };
      for (let i = 0; i < (s.engine.kind === 'gl' ? 1 : 3); i++) inst.render({ ctx, w: W, h: H, t: 30 + i / 30, dt: 1 / 30, clock: 30 + i / 30, p, pointer: ptr, opts: s.opts || {} });
      const keep = document.createElement('canvas'); keep.width = W; keep.height = H; keep.getContext('2d').drawImage(c, 0, 0);
      cache.set(s.id, keep); g.drawImage(keep, 0, 0);
    } catch (e) { console.warn('thumb', s.id, e); g.fillStyle = '#334'; g.fillRect(0, 0, W, H); }
    try { inst?.dispose?.(); } catch {}
  }
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const go = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 30) { const { el, s } = queue.shift(); if (el.isConnected) paint(el, s); }
      busy = false; if (queue.length) setTimeout(pump, 0);
    };
    (window.requestIdleCallback || setTimeout)(go, { timeout: 100 });
  }
  return {
    reset() { queue = []; io?.disconnect(); io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target._q); } pump(); }, { rootMargin: '300px' }); },
    watch(el, s) { el._q = { el, s }; io.observe(el); },
    kick: pump
  };
})();

// ---------------------------------------------------------------- HUD behaviour
let idleTimer = 0;
function wake() {
  $('#hud').classList.remove('idle'); document.body.classList.remove('hide-cursor');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (view === 'viewer' && $('#panel').hidden) { $('#hud').classList.add('idle'); document.body.classList.add('hide-cursor'); } }, 3000);
}
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

function togglePause() { paused = !paused; $('#b-pause').textContent = paused ? '▶' : '❚❚'; toast(paused ? 'Paused' : 'Playing'); }
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }
function snapshot() {
  output.canvas.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${cur.scene.id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  toast('Saved PNG');
}
function toggleRecord() {
  const b = $('#b-rec');
  if (recorder) { recorder.stop(); return; }
  const stream = output.canvas.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType }); recorder = null; b.classList.remove('on');
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cur.scene.id}.${type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
    toast('Recording saved');
  };
  recorder.start(); b.classList.add('on'); toast('Recording… press again to stop');
}

function bindUI() {
  $('#b-gallery').onclick = showGallery;
  $('#b-prev').onclick = () => step(-1);
  $('#b-next').onclick = () => step(1);
  $('#b-random').onclick = randomScene;
  $('#b-pause').onclick = togglePause;
  $('#b-full').onclick = toggleFull;
  $('#b-snap').onclick = snapshot;
  $('#b-rec').onclick = toggleRecord;
  $('#b-panel').onclick = () => { $('#panel').hidden = !$('#panel').hidden; wake(); };
  $('#b-link').onclick = () => { writeURL(); navigator.clipboard?.writeText(location.href).then(() => toast('Link copied'), () => toast(location.href)); };
  $('#b-reset').onclick = () => { params = defaultsFor(cur.engine, cur.scene); syncSliders(); pointer.dragX = pointer.dragY = 0; writeURL(); };
  $('#b-dice').onclick = () => { for (const c of [...CONTROLS, ...(cur.engine.params || [])]) if (c.id !== 'speed') params[c.id] = clamp(params[c.id] + (Math.random() - 0.5) * 0.6); params.hue = Math.random() < 0.3 ? Math.random() : 0; syncSliders(); writeURL(); };
  $('#b-shuffle').onchange = e => setShuffle(+e.target.value);
  $('#quality').onchange = e => { quality = e.target.value; if (quality === 'auto') autoScale = 0.75; };
  $('#fade').onchange = e => { fadeDur = +e.target.value; };
  $('#g-shuffle').onclick = () => { setShuffle(shuffleSec || 30); showViewer(); randomScene(); };
  $('#search').oninput = e => { searchText = e.target.value; drawGrid(); };

  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { if (view === 'viewer') wake(); }, { passive: true });
  const cv = output.canvas;
  let dragging = false, lx = 0, ly = 0, downAt = 0, moved = 0;
  cv.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; downAt = performance.now(); moved = 0; pointer.down = true; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    pointer.x = e.clientX / innerWidth; pointer.y = e.clientY / innerHeight; pointer.moved = true;
    if (dragging) { const dx = (e.clientX - lx) / innerHeight, dy = (e.clientY - ly) / innerHeight; pointer.dragX += dx; pointer.dragY += dy; moved += Math.abs(dx) + Math.abs(dy); lx = e.clientX; ly = e.clientY; }
  });
  const up = () => { if (dragging && moved < 0.01 && performance.now() - downAt < 400) pointer.clicks.push({ x: pointer.x, y: pointer.y }); dragging = false; pointer.down = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', toggleFull);

  addEventListener('keydown', e => {
    if (e.target.matches('input[type=search], input[type=text], select')) return;
    if (view !== 'viewer') { if (e.key === 'Enter' && document.activeElement?.classList.contains('card')) return; return; }
    const k = e.key.toLowerCase();
    if (k === 'arrowright') step(1); else if (k === 'arrowleft') step(-1);
    else if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'f') toggleFull();
    else if (k === 'h') { $('#hud').hidden = !$('#hud').hidden; }
    else if (k === 'c') $('#b-panel').click();
    else if (k === 'r') randomScene();
    else if (k === 's') snapshot();
    else if (k === 'v') toggleRecord();
    else if (k === 'g' || k === 'escape') { if (k === 'escape' && document.fullscreenElement) return; showGallery(); }
  });
  addEventListener('resize', sizeOutput);
}
function setShuffle(sec) {
  shuffleSec = sec; $('#b-shuffle').value = String(sec);
  shuffleAt = performance.now() / 1000 + sec;
  if (sec) toast(`Screensaver: new scene every ${sec < 60 ? sec + ' s' : sec / 60 + ' min'}`);
  writeURL();
}

// ---------------------------------------------------------------- Invisible Hands
function setupHands() {
  if (!window.InvisibleHands) return;
  const ctl = id => ({ id, get label() { return labelFor(id) || id; }, get: () => params[id] ?? 0, set: v => { params[id] = v; syncSlider(id); } });
  const syncSlider = id => { const el = $('#c-' + id); if (el) { el.value = params[id]; el.nextSibling.textContent = Math.round(params[id] * 100); } };
  const sceneCtl = {
    id: 'scene', label: 'Scene',
    get: () => scenes.length > 1 ? Math.max(0, scenes.indexOf(cur?.scene)) / (scenes.length - 1) : 0,
    set: v => { const s = scenes[Math.round(clamp(v) * (scenes.length - 1))]; if (s && s !== cur?.scene) setScene(s); }
  };
  let nextHeld = 0, pauseHeld = 0;
  hands = window.InvisibleHands.create({
    app: 'mega-clouds', name: 'Mega-Clouds',
    params: [
      ...CONTROLS.map(c => ctl(c.id)),
      ...EXTRA.map(ctl),
      ...LOOK.map(c => ctl(c.id)),
      sceneCtl,
      { id: 'next', label: 'Next scene', kind: 'trig', get: () => nextHeld, set: v => { if (v > 0.5 && nextHeld <= 0.5) step(1); nextHeld = v; } },
      { id: 'pause', label: 'Pause', kind: 'toggle', get: () => paused ? 1 : 0, set: v => { if ((v > 0.5) !== paused) togglePause(); pauseHeld = v; } },
    ],
    outs: [
      { id: 'brightness', label: 'Brightness', get: () => lastMeasure.luma },
      { id: 'cloudiness', label: 'White share', get: () => lastMeasure.white },
      { id: 'scene', label: 'Scene', get: () => sceneCtl.get() },
    ]
  });
  // the extra controls are relabelled per scene, so re-describe when the scene changes
  hands.on('status', () => writeURLSoon());
  $('#hands-slot').append(hands.badge({ label: 'Hands' }));
}

// ---------------------------------------------------------------- embed API (Mega CV and other hosts)
// Same-origin pages (e.g. crumplabsandbox.github.io/mega-cv) can iframe this page with ?ui=0 and read
// iframe.contentWindow.megaClouds.canvas directly; any page can drive it with postMessage:
//   frame.postMessage({ megaClouds: { scene: 'volumetric-cumulus', set: { speed: 0.7 }, next: true } }, '*')
function exposeAPI() {
  const api = {
    get canvas() { return output.canvas; },
    get scenes() { return scenes.map(s => ({ id: s.id, name: s.name, engine: s.engine.id, tags: s.tags })); },
    get scene() { return cur?.scene.id; },
    get params() { return { ...params }; },
    setScene(id) { const s = scenes.find(s => s.id === id) || scenes[+id]; if (s) { if (view !== 'viewer') showViewer(s); else setScene(s); } return !!s; },
    set(id, v) { if (ALL_IDS.includes(id)) { params[id] = clamp(+v); syncSliders(); } },
    next() { step(1); }, prev() { step(-1); }, random() { randomScene(); },
    pause(on = true) { if (paused !== on) togglePause(); },
    measure: () => lastMeasure
  };
  window.megaClouds = api;
  addEventListener('message', e => {
    const m = e.data && e.data.megaClouds; if (!m || typeof m !== 'object') return;
    if (m.scene) api.setScene(m.scene);
    if (m.set && typeof m.set === 'object') for (const [k, v] of Object.entries(m.set)) api.set(k, v);
    if (m.next) api.next(); if (m.prev) api.prev(); if (m.random) api.random();
    if ('pause' in m) api.pause(!!m.pause);
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  try { output = createOutput($('#out')); }
  catch (e) { $('#err').hidden = false; $('#err').textContent = 'Mega-Clouds needs WebGL2: ' + e.message; return; }
  sizeOutput();
  ({ scenes, engines } = await loadAll());
  if (!scenes.length) { $('#err').hidden = false; $('#err').textContent = 'No scenes loaded.'; return; }
  setupHands();
  bindUI();
  exposeAPI();
  buildGallery();
  const want = query.get('scene');
  const first = scenes.find(s => s.id === want);
  // the gallery's backdrop is a live scene, blurred
  setScene(first || scenes.find(s => s.id === 'volumetric-cumulus') || scenes[0], { fade: false });
  if (first) {
    for (const id of ALL_IDS) if (query.has(id)) params[id] = clamp(+query.get(id));
    syncSliders();
  }
  if (query.get('quality')) { quality = query.get('quality'); $('#quality').value = quality; }
  const sh = +query.get('shuffle'); if (sh) setShuffle(sh);
  if (first || EMBED || sh) { showViewer(); if (sh && !first) randomScene(); } else showGallery();
  requestAnimationFrame(frame);
}
boot();
