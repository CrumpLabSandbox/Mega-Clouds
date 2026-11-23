// Stable-fluids clouds (WebGL2): semi-Lagrangian advection, vorticity confinement and a Jacobi pressure projection
// carry a cloud-density dye that is then lit like a cloud. Drag to blow, click to puff in new cloud. An ambient wind
// plus curl-noise turbulence keeps it moving with no input; the sky scene also regrows clouds toward a drifting
// noise field so the sky never empties.
import { compile, fullscreenVS, NOISE } from '../gl.js';
import { clamp, lerp, windDir } from '../util.js';

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uTexel;   // 1 / target size
uniform float uWind;
out vec4 o;
`;
const UV = 'vec2 uv = gl_FragCoord.xy * uTexel;';
const NB = (s) => `vec2 dx = vec2(uTexel.x, 0.), dy = vec2(0., uTexel.y);
  float L = texture(${s}, uv - dx).x, R = texture(${s}, uv + dx).x, B = texture(${s}, uv - dy).x, T = texture(${s}, uv + dy).x;`;

const FS = {
  copy: `uniform sampler2D uSrc; void main(){ ${UV} o = texture(uSrc, uv); }`,
  advect: `uniform sampler2D uVel, uSrc; uniform vec2 uVelTexel; uniform float uDt, uDiss, uInflow;
    void main(){ ${UV} vec2 v = texture(uVel, uv).xy; vec2 q = uv - uDt * v * uVelTexel;
      float inside = step(0., q.x) * step(q.x, 1.) * step(0., q.y) * step(q.y, 1.);
      o = texture(uSrc, q) * uDiss * mix(uInflow, 1., inside); }`,
  div: `uniform sampler2D uVel;
    void main(){ ${UV} vec2 dx = vec2(uTexel.x, 0.), dy = vec2(0., uTexel.y);
      float L = texture(uVel, uv - dx).x, R = texture(uVel, uv + dx).x, B = texture(uVel, uv - dy).y, T = texture(uVel, uv + dy).y;
      o = vec4(.5 * (R - L + T - B), 0., 0., 1.); }`,
  curl: `uniform sampler2D uVel;
    void main(){ ${UV} vec2 dx = vec2(uTexel.x, 0.), dy = vec2(0., uTexel.y);
      float L = texture(uVel, uv - dx).y, R = texture(uVel, uv + dx).y, B = texture(uVel, uv - dy).x, T = texture(uVel, uv + dy).x;
      o = vec4(.5 * ((R - L) - (T - B)), 0., 0., 1.); }`,
  vort: `uniform sampler2D uVel, uCurl; uniform float uK, uDt;
    void main(){ ${UV} ${NB('uCurl')} float C = texture(uCurl, uv).x;
      vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); f /= length(f) + 1e-4; f *= uK * C; f.y = -f.y;
      vec2 v = texture(uVel, uv).xy + f * uDt; v *= min(1., 240. / max(length(v), 1e-4));
      o = vec4(v, 0., 1.); }`,
  jacobi: `uniform sampler2D uP, uDiv;
    void main(){ ${UV} ${NB('uP')} o = vec4((L + R + B + T - texture(uDiv, uv).x) * .25, 0., 0., 1.); }`,
  grad: `uniform sampler2D uP, uVel;
    void main(){ ${UV} ${NB('uP')} o = vec4(texture(uVel, uv).xy - .5 * vec2(R - L, T - B), 0., 1.); }`,
  splat: `uniform sampler2D uSrc; uniform vec2 uPoint; uniform vec4 uColor; uniform float uRadius, uAspect;
    void main(){ ${UV} vec2 d = uv - uPoint; d.x *= uAspect; o = texture(uSrc, uv) + uColor * exp(-dot(d, d) / uRadius); }`,
  // ambient wind + curl-noise turbulence (relaxation toward it) + buoyancy from dye density
  force: `uniform sampler2D uVel, uDye; uniform vec2 uWindV; uniform float uDt, uTurb, uBuoy, uAspect, uRelax, uNScale, uT;
    float pot(vec2 q){ return noise3(vec3(q, uT * .07)) + .5 * noise3(vec3(q * 2.1 + 5.3, uT * .11)); }
    void main(){ ${UV} vec2 v = texture(uVel, uv).xy;
      vec2 q = vec2(uv.x * uAspect, uv.y) * uNScale; float e = .02;
      vec2 cn = vec2(pot(q + vec2(0., e)) - pot(q - vec2(0., e)), -(pot(q + vec2(e, 0.)) - pot(q - vec2(e, 0.)))) / (2. * e);
      vec2 target = uWindV + cn * uTurb;
      v = mix(v, target, 1. - exp(-uDt * uRelax));
      v.y += uBuoy * texture(uDye, uv).a * uDt;
      o = vec4(v, 0., 1.); }`,
  // relax the dye toward a drifting noise cloud field (sky); uK = 1 seeds it
  field: `uniform sampler2D uDye; uniform float uK, uCov, uScl, uAspect, uOct, uT; uniform vec2 uDrift; uniform vec3 uTint;
    void main(){ ${UV}
      vec2 q = vec2((uv.x - uDrift.x) * uAspect, uv.y - uDrift.y) * uScl;
      vec2 w = vec2(fbm2(q * .7 + uT * .01, 3.), fbm2(q * .7 + 7.3, 3.));
      float n = fbm2(q + w * 1.3, uOct) * .85 + (1. - worley2(q * 1.6 + w)) * .22;
      float band = .82 + .25 * smoothstep(.0, .6, uv.y) - .2 * smoothstep(.75, 1., uv.y);
      float d = smoothstep(uCov, uCov + .22, n * band);
      vec4 tgt = vec4(uTint * d, d) * 1.15;
      o = mix(texture(uDye, uv), tgt, uK); }`,
  display: `uniform sampler2D uDye; uniform vec2 uDyeTexel, uSun; uniform float uAspect, uMode, uLight, uClock, uDense;
    uniform vec3 uTop, uBot, uLit, uShade, uSunC;
    void main(){ ${UV}
      vec4 d = texture(uDye, uv);
      float a = max(d.a, 0.);
      vec3 tint = a > 1e-3 ? clamp(d.rgb / a, 0., 1.5) : vec3(1.);
      vec2 toSun = (uSun - uv) * vec2(uAspect, 1.); float sd = length(toSun);
      vec2 st = normalize(toSun + 1e-5) / vec2(uAspect, 1.) * .012;
      float occ = texture(uDye, uv + st).a * .45 + texture(uDye, uv + st * 2.5).a * .35 + texture(uDye, uv + st * 5.).a * .2;
      occ = max(occ, 0.);
      float lit = exp(-(occ * .7 + max(occ - a, 0.) * 2.));
      lit = mix(lit, 1., .15) * mix(.85, 1.05, uv.y);
      float alpha = 1. - exp(-a * uDense);
      vec3 bg = mix(uBot, uTop, smoothstep(-.1, 1.05, uv.y));
      vec3 col;
      if (uMode > 2.5) {
        // ink on paper: pooled edges, soft wash
        float gx = texture(uDye, uv + vec2(uDyeTexel.x * 2., 0.)).a - texture(uDye, uv - vec2(uDyeTexel.x * 2., 0.)).a;
        float gy = texture(uDye, uv + vec2(0., uDyeTexel.y * 2.)).a - texture(uDye, uv - vec2(0., uDyeTexel.y * 2.)).a;
        float edge = clamp(length(vec2(gx, gy)) * 3., 0., 1.);
        float paperN = fbm2(gl_FragCoord.xy * .02, 3.) * .06;
        bg = uBot * (1. - paperN) ;
        vec3 ink = tint * mix(1., .55, edge);
        col = mix(bg, ink, clamp(alpha + edge * .25 * alpha, 0., 1.));
      } else {
        bg += uSunC * (exp(-sd * 9.) * .6 + exp(-sd * 2.5) * .18);
        bg += uSunC * smoothstep(.035, .03, sd) * step(.5, uMode < .5 || uMode > 1.5 ? 1. : 0.);
        vec3 cc = mix(uShade, uLit, lit) * tint;
        float rim = alpha * (1. - alpha) * 4. * exp(-sd * 4.);
        cc += uSunC * rim * .5;
        col = mix(bg, cc, alpha);
      }
      o = vec4(col, 1.);
    }`,
};

// light-driven palettes for the sky and paint scenes
const KEYS = [
  [0.0, [6, 10, 30], [22, 30, 62], [110, 122, 165], [30, 36, 66], [200, 210, 255]],
  [0.15, [34, 32, 86], [210, 110, 96], [250, 170, 140], [92, 64, 108], [255, 170, 110]],
  [0.3, [60, 94, 174], [255, 190, 138], [255, 224, 186], [150, 128, 158], [255, 226, 168]],
  [0.6, [46, 112, 208], [172, 206, 240], [255, 255, 255], [148, 164, 198], [255, 250, 236]],
  [1.0, [32, 102, 214], [150, 200, 250], [255, 255, 255], [162, 178, 210], [255, 255, 246]],
];
function pal(light) {
  let i = 0; while (i < KEYS.length - 2 && light > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((light - a[0]) / (b[0] - a[0]));
  const m = k => [0, 1, 2].map(j => lerp(a[k][j], b[k][j], t) / 255);
  return { top: m(1), bot: m(2), lit: m(3), shade: m(4), sun: m(5) };
}
const mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const MODES = { sky: 0, smoke: 1, paint: 2, ink: 3 };
const PAINT = [[1.0, 0.45, 0.55], [1.0, 0.65, 0.3], [0.65, 0.4, 0.85], [1.0, 0.85, 0.45], [0.95, 0.35, 0.4]];

export default {
  id: 'fluid', name: 'Fluid Clouds', kind: 'gl', res: 1,
  params: [
    { id: 'x1', label: 'Swirl', value: 0.5 },
    { id: 'x2', label: 'Blow strength', value: 0.5 },
    { id: 'x3', label: 'Regrow', value: 0.5 },
    { id: 'x4', label: 'Turbulence', value: 0.5 },
  ],
  create(gl, opts) {
    const mode = MODES[opts.mode] ?? 0;
    const P = {};
    for (const k in FS) {
      const prog = compile(gl, fullscreenVS, HEAD + NOISE + FS[k]);
      const locs = {};
      P[k] = { prog, u: n => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(prog, n))) };
    }
    const vao = gl.createVertexArray();
    // texture format: half float if renderable, else 8-bit
    let fmt = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) fmt = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
    gl.getExtension('OES_texture_float_linear');
    const target = (w, h) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (fmt.internal !== gl.RGBA8 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fb); gl.deleteTexture(t); fmt = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }; return target(w, h);
      }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return { t, fb, w, h };
    };
    const dbl = (w, h) => { const a = target(w, h), b = target(w, h); return { w, h, a, b, flip: 0, read() { return this.flip ? this.b : this.a; }, write() { return this.flip ? this.a : this.b; }, swap() { this.flip ^= 1; } }; };
    const free = x => { if (!x) return; for (const t of x.a ? [x.a, x.b] : [x]) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); } };

    let S = null, simT = 0, warm = false, prev = null;
    const texUnit = (prog, name, tex, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(prog.u(name), unit); };
    // run program k into target dst with uniforms/textures
    const run = (k, dst, set) => {
      const p = P[k]; gl.useProgram(p.prog);
      const w = dst ? dst.w : S.cw, h = dst ? dst.h : S.ch;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null); gl.viewport(0, 0, w, h);
      gl.uniform2f(p.u('uTexel'), 1 / w, 1 / h);
      set(p);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const pass = (k, d, set) => { run(k, d.write(), set); d.swap(); };

    function alloc(cw, ch) {
      const aspect = cw / ch;
      const simH = 128, simW = Math.max(8, Math.round(simH * aspect));
      const dyeH = Math.round(clamp(ch * 0.6, 160, 540)), dyeW = Math.max(8, Math.round(dyeH * aspect));
      const N = { cw, ch, aspect, simW, simH, dyeW, dyeH,
        vel: dbl(simW, simH), dye: dbl(dyeW, dyeH), p: dbl(simW, simH), div: target(simW, simH), curl: target(simW, simH) };
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
      if (S) { // carry the old state across a resize
        run('copy', N.vel.write(), p => texUnit(p, 'uSrc', S.vel.read(), 0)); N.vel.swap();
        run('copy', N.dye.write(), p => texUnit(p, 'uSrc', S.dye.read(), 0)); N.dye.swap();
        for (const k of ['vel', 'dye', 'p', 'div', 'curl']) free(S[k]);
      }
      return N;
    }

    const splat = (d, x, y, c, r) => pass('splat', d, p => {
      texUnit(p, 'uSrc', d.read(), 0); gl.uniform2f(p.u('uPoint'), x, y); gl.uniform4f(p.u('uColor'), c[0], c[1], c[2], c[3]);
      gl.uniform1f(p.u('uRadius'), r); gl.uniform1f(p.u('uAspect'), S.aspect);
    });

    const cfg = f => {
      const pp = f.p, wd = windDir(pp.wind);
      const windSpeed = mode === 0 ? 10 : mode === 1 ? 3 : mode === 2 ? 4 : 1.5;
      return {
        windV: [wd[0] * windSpeed, -wd[1] * windSpeed * 0.4], // screen y is down in windDir; sim y is up
        turb: lerp(2, 16, pp.x4) * (mode === 3 ? 0.6 : mode === 2 ? 1.2 : mode === 0 ? 0.6 : 1),
        relax: mode === 0 ? 0.5 : mode === 1 ? 0.6 : 0.25,
        buoy: mode === 1 ? 8 : 0,
        curlK: lerp(2, 16, pp.x1),
        diss: mode === 0 ? 0.02 : mode === 1 ? 0.5 : mode === 2 ? 0.07 : 0.06,
        regrow: mode === 0 ? lerp(0.05, 0.6, pp.x3) : 0,
        cov: lerp(0.66, 0.42, pp.coverage), scl: lerp(4.5, 1.4, pp.scale), oct: lerp(2, 6, pp.detail),
      };
    };
    const fieldPass = (f, c, k, tint) => pass('field', S.dye, p => {
      texUnit(p, 'uDye', S.dye.read(), 0);
      gl.uniform1f(p.u('uK'), k); gl.uniform1f(p.u('uCov'), c.cov); gl.uniform1f(p.u('uScl'), c.scl); gl.uniform1f(p.u('uAspect'), S.aspect);
      gl.uniform1f(p.u('uOct'), c.oct); gl.uniform1f(p.u('uT'), simT);
      gl.uniform2f(p.u('uDrift'), c.windV[0] * simT / S.simW, c.windV[1] * simT / S.simH); gl.uniform3f(p.u('uTint'), tint[0], tint[1], tint[2]);
    });

    function seed(f) {
      const c = cfg(f);
      // velocity: start at the ambient wind
      run('force', S.vel.write(), p => {
        texUnit(p, 'uVel', S.vel.read(), 0); texUnit(p, 'uDye', S.dye.read(), 1);
        gl.uniform2f(p.u('uWindV'), c.windV[0], c.windV[1]); gl.uniform1f(p.u('uDt'), 10); gl.uniform1f(p.u('uTurb'), c.turb);
        gl.uniform1f(p.u('uBuoy'), 0); gl.uniform1f(p.u('uAspect'), S.aspect); gl.uniform1f(p.u('uRelax'), 1); gl.uniform1f(p.u('uNScale'), 2.5); gl.uniform1f(p.u('uT'), simT);
      }); S.vel.swap();
      if (mode === 0) fieldPass(f, c, 1, [1, 1, 1]);
      else if (mode === 2) {
        fieldPass(f, { ...c, cov: c.cov + 0.05 }, 1, [1.0, 0.62, 0.58]);
        for (let i = 0; i < 14; i++) splat(S.dye, Math.random(), 0.3 + Math.random() * 0.6, [...PAINT[i % PAINT.length].map(v => v * 0.5), 0.5], 0.004 + Math.random() * 0.006);
      } else if (mode === 1) {
        for (let i = 0; i < 6; i++) splat(S.dye, 0.2 + Math.random() * 0.6, 0.15 + i * 0.12, [0.5, 0.5, 0.5, 0.5], 0.002);
      } else {
        const inks = [[0.08, 0.1, 0.18], [0.12, 0.14, 0.32], [0.05, 0.05, 0.07]];
        for (let i = 0; i < 9; i++) { const c3 = inks[i % 3]; splat(S.dye, 0.1 + Math.random() * 0.8, 0.15 + Math.random() * 0.7, [c3[0], c3[1], c3[2], 1].map(v => v * 0.9), 0.002 + Math.random() * 0.004); }
      }
    }

    function step(f, dt) {
      const c = cfg(f), velT = [1 / S.simW, 1 / S.simH];
      simT += dt;
      // ambient forces
      pass('force', S.vel, p => {
        texUnit(p, 'uVel', S.vel.read(), 0); texUnit(p, 'uDye', S.dye.read(), 1);
        gl.uniform2f(p.u('uWindV'), c.windV[0], c.windV[1]); gl.uniform1f(p.u('uDt'), dt); gl.uniform1f(p.u('uTurb'), c.turb);
        gl.uniform1f(p.u('uBuoy'), c.buoy); gl.uniform1f(p.u('uAspect'), S.aspect); gl.uniform1f(p.u('uRelax'), c.relax);
        gl.uniform1f(p.u('uNScale'), mode === 3 ? 3.5 : 2.5); gl.uniform1f(p.u('uT'), simT);
      });
      // emitters
      if (mode === 1) {
        for (let k = 0; k < 3; k++) {
          const x = 0.5 + 0.32 * Math.sin(simT * (0.13 + k * 0.05) + k * 2.1) * (k === 1 ? 0.4 : 1), y = 0.1;
          splat(S.dye, x, y, [0.9 * dt * 5, 0.9 * dt * 5, 0.92 * dt * 5, dt * 5].map(v => v * lerp(0.5, 1.3, f.p.coverage)), 0.0012 * lerp(0.6, 2, f.p.scale));
          splat(S.vel, x, y, [Math.sin(simT * 0.7 + k) * 10, 40, 0, 0].map(v => v * dt * 20), 0.002);
        }
      } else if (mode === 2) {
        for (let k = 0; k < 2; k++) {
          const ph = simT * 0.21 + k * 3.1, x = 0.5 + 0.42 * Math.sin(ph * 1.3 + k), y = 0.55 + 0.32 * Math.sin(ph * 0.9 + 1.7 * k);
          const vx = 0.42 * 1.3 * Math.cos(ph * 1.3 + k) * 0.21, vy = 0.32 * 0.9 * Math.cos(ph * 0.9 + 1.7 * k) * 0.21;
          const col = PAINT[Math.floor(simT / 4 + k * 2) % PAINT.length], amt = dt * 1.4 * lerp(0.4, 1.4, f.p.coverage);
          splat(S.dye, x, y, [col[0] * amt, col[1] * amt, col[2] * amt, amt], 0.0018 * lerp(0.6, 2, f.p.scale));
          splat(S.vel, x, y, [vx * S.simW * dt * 25, vy * S.simH * dt * 25, 0, 0], 0.003);
        }
      } else if (mode === 3) {
        const P0 = 1.6, n = Math.floor(simT / P0);
        if (Math.floor((simT - dt) / P0) !== n) {
          const r = k => ((Math.sin(n * 91.7 + k * 13.3) * 43758.5) % 1 + 1) % 1;
          const inks = [[0.06, 0.07, 0.12], [0.12, 0.15, 0.36], [0.04, 0.04, 0.05], [0.55, 0.12, 0.12]];
          const c3 = inks[n % 7 === 6 ? 3 : n % 3], x = 0.1 + 0.8 * r(1), y = 0.15 + 0.7 * r(2), a = r(3) * 6.283, sz = lerp(0.5, 2, f.p.scale);
          splat(S.dye, x, y, [c3[0], c3[1], c3[2], 1].map(v => v * lerp(0.5, 1.4, f.p.coverage)), 0.002 * sz);
          splat(S.vel, x, y, [Math.cos(a) * 80, Math.sin(a) * 80, 0, 0], 0.003 * sz);
        }
      }
      // vorticity confinement
      run('curl', S.curl, p => texUnit(p, 'uVel', S.vel.read(), 0));
      pass('vort', S.vel, p => { texUnit(p, 'uVel', S.vel.read(), 0); texUnit(p, 'uCurl', S.curl, 1); gl.uniform1f(p.u('uK'), c.curlK); gl.uniform1f(p.u('uDt'), dt); });
      // projection
      run('div', S.div, p => texUnit(p, 'uVel', S.vel.read(), 0));
      const iters = Math.round(lerp(14, 28, f.p.detail));
      for (let i = 0; i < iters; i++) pass('jacobi', S.p, p => { texUnit(p, 'uP', S.p.read(), 0); texUnit(p, 'uDiv', S.div, 1); });
      pass('grad', S.vel, p => { texUnit(p, 'uP', S.p.read(), 0); texUnit(p, 'uVel', S.vel.read(), 1); });
      // advection
      pass('advect', S.vel, p => {
        texUnit(p, 'uVel', S.vel.read(), 0); texUnit(p, 'uSrc', S.vel.read(), 1);
        gl.uniform2f(p.u('uVelTexel'), velT[0], velT[1]); gl.uniform1f(p.u('uDt'), dt); gl.uniform1f(p.u('uDiss'), 1); gl.uniform1f(p.u('uInflow'), 1);
      });
      pass('advect', S.dye, p => {
        texUnit(p, 'uVel', S.vel.read(), 0); texUnit(p, 'uSrc', S.dye.read(), 1);
        gl.uniform2f(p.u('uVelTexel'), velT[0], velT[1]); gl.uniform1f(p.u('uDt'), dt); gl.uniform1f(p.u('uDiss'), Math.exp(-c.diss * dt)); gl.uniform1f(p.u('uInflow'), 0);
      });
      if (c.regrow > 0) fieldPass(f, c, 1 - Math.exp(-c.regrow * dt), [1, 1, 1]);
    }

    function input(f) {
      const pt = f.pointer, x = pt.x, y = 1 - pt.y, str = lerp(0.3, 2, f.p.x2);
      if (pt.moved && prev) {
        const du = x - prev[0], dv = y - prev[1];
        if (Math.abs(du) + Math.abs(dv) > 1e-5) {
          let vx = du * S.simW * 18 * str, vy = dv * S.simH * 18 * str;
          const m = Math.hypot(vx, vy), cap = 600; if (m > cap) { vx *= cap / m; vy *= cap / m; }
          const k = pt.down ? 1 : 0.35;
          splat(S.vel, x, y, [vx * k, vy * k, 0, 0], pt.down ? 0.0025 : 0.0015);
          if (pt.down && mode !== 0) {
            const col = mode === 2 ? PAINT[Math.floor(simT * 0.5) % PAINT.length] : mode === 3 ? [0.08, 0.1, 0.2] : [0.85, 0.85, 0.88];
            splat(S.dye, x, y, [col[0] * 0.15, col[1] * 0.15, col[2] * 0.15, 0.15], 0.0012);
          }
        }
      }
      prev = pt.moved ? [x, y] : null;
      for (const c of pt.clicks || []) {
        const cx = c.x, cy = 1 - c.y;
        const col = mode === 2 ? PAINT[(Math.random() * PAINT.length) | 0] : mode === 3 ? [0.06, 0.07, 0.14] : [1, 1, 1];
        const amt = mode === 3 ? 1.1 : 0.9, r = mode === 1 ? 0.004 : 0.006;
        splat(S.dye, cx, cy, [col[0] * amt, col[1] * amt, col[2] * amt, amt], r);
        for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; splat(S.vel, cx + Math.cos(a) * 0.03 / S.aspect, cy + Math.sin(a) * 0.03, [Math.cos(a) * 60, Math.sin(a) * 60, 0, 0], 0.0006); }
      }
    }

    function display(f) {
      const pp = f.p;
      let c;
      if (mode === 0) c = pal(pp.light);
      else if (mode === 2) {
        const b = pal(clamp(pp.light * 0.6, 0.12, 0.6));
        c = { top: mixc(b.top, [0.18, 0.12, 0.38], 0.5), bot: mixc(b.bot, [1.0, 0.55, 0.32], 0.5), lit: [1, 0.95, 0.9], shade: [0.45, 0.3, 0.45], sun: [1, 0.75, 0.45] };
      } else if (mode === 1) {
        const l = clamp(pp.light);
        c = { top: mixc([0.02, 0.025, 0.04], [0.16, 0.2, 0.27], l), bot: mixc([0.08, 0.05, 0.05], [0.42, 0.36, 0.34], l), lit: mixc([1, 0.78, 0.6], [1, 0.97, 0.94], l), shade: mixc([0.12, 0.12, 0.17], [0.42, 0.44, 0.5], l), sun: mixc([1, 0.6, 0.35], [1, 0.9, 0.75], l) };
      } else {
        const l = clamp(pp.light);
        const paper = mixc([0.62, 0.58, 0.5], [0.96, 0.93, 0.86], l);
        c = { top: paper, bot: paper, lit: [1, 1, 1], shade: [1, 1, 1], sun: [1, 1, 1] };
      }
      const sun = mode === 1 ? [0.1, 0.92] : mode === 2 ? [0.5, 0.3] : [lerp(0.2, 0.7, pp.light), lerp(0.3, 0.85, clamp(pp.light / 0.6))];
      run('display', null, p => {
        texUnit(p, 'uDye', S.dye.read(), 0);
        gl.uniform2f(p.u('uDyeTexel'), 1 / S.dyeW, 1 / S.dyeH); gl.uniform2f(p.u('uSun'), sun[0], sun[1]);
        gl.uniform1f(p.u('uAspect'), S.aspect); gl.uniform1f(p.u('uMode'), mode); gl.uniform1f(p.u('uLight'), pp.light); gl.uniform1f(p.u('uClock'), f.clock);
        gl.uniform1f(p.u('uDense'), mode === 3 ? 2.2 : mode === 1 ? 3.5 : 2.8);
        gl.uniform3fv(p.u('uTop'), c.top); gl.uniform3fv(p.u('uBot'), c.bot); gl.uniform3fv(p.u('uLit'), c.lit); gl.uniform3fv(p.u('uShade'), c.shade); gl.uniform3fv(p.u('uSunC'), c.sun);
      });
    }

    return {
      render(f) {
        gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(vao);
        if (!S || S.cw !== f.w || S.ch !== f.h) { S = alloc(f.w, f.h); }
        if (!warm) { simT = f.t; seed(f); for (let i = 0; i < 24; i++) step(f, 1 / 30); warm = true; }
        input(f);
        const dt = Math.min(f.dt || 0, 1 / 24);
        if (dt > 0) step(f, dt);
        display(f);
      },
      resize(w, h) { if (S && (S.cw !== w || S.ch !== h)) S = alloc(w, h); },
      dispose() {
        if (S) for (const k of ['vel', 'dye', 'p', 'div', 'curl']) free(S[k]);
        for (const k in P) gl.deleteProgram(P[k].prog);
        gl.deleteVertexArray(vao);
      }
    };
  }
};

const d = (id, name, desc, opts, params, tags) => ({ id: 'fluid-' + id, name, desc, opts, params, tags: ['interactive', '2d', ...tags] });
export const scenes = [
  d('blow', 'Blow the Clouds', 'A live fluid sky: drag to blow the clouds around, click to puff in a new one.', { mode: 'sky' }, { speed: 0.55, coverage: 0.5, light: 0.85, x1: 0.45 }, ['realistic']),
  d('smoke', 'Smoke & Steam', 'Rising, curling smoke lit by a low lamp; drag to stir, click for a puff.', { mode: 'smoke' }, { speed: 0.55, coverage: 0.5, light: 0.4, x1: 0.6 }, ['moody', 'abstract']),
  d('sunset', 'Sunset Cloud Painting', 'Wandering brushes paint warm clouds into a fluid sunset; drag to smear, click to dab.', { mode: 'paint' }, { speed: 0.5, coverage: 0.5, light: 0.3, x1: 0.5 }, ['sunset', 'art', 'pastel']),
  d('ink', 'Ink-Cloud Swirl', 'Sumi ink blooms into swirling clouds on rice paper; click to drop more ink.', { mode: 'ink' }, { speed: 0.5, coverage: 0.5, light: 0.9, x1: 0.65, x4: 0.6 }, ['art', 'abstract']),
];
