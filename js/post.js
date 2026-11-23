// The output stage. Every scene draws into its own canvas; this copies it onto the visible WebGL2 canvas with the
// "look" controls (hue, saturation, brightness, contrast, vignette, grain) and crossfades between scenes.
// The output canvas is what Record, Snapshot and embedding (window.megaClouds.canvas) see.
import { compile, fullscreenVS } from './gl.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform float uMix, uHue, uSat, uBright, uContrast, uVig, uGrain, uTime;
uniform vec2 uRes;
out vec4 o;
vec3 hueRot(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a);
  return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.-ca); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec3 c = texture(uA, uv).rgb;
  if (uMix < 1.) c = mix(texture(uB, uv).rgb, c, smoothstep(0., 1., uMix));
  c = hueRot(c, uHue*6.2831853);
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(vec3(l), c, uSat*2.);
  c = (c - .5)*(.25 + uContrast*1.5) + .5;
  c *= uBright*2.;
  vec2 q = uv - .5; q.x *= uRes.x/uRes.y;
  c *= 1. - uVig*1.4*smoothstep(.25, 1.1, length(q));
  c += (h12(gl_FragCoord.xy + fract(uTime*7.)*917.) - .5)*uGrain*.35;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

export function createOutput(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const prog = compile(gl, fullscreenVS, FS);
  const U = n => gl.getUniformLocation(prog, n);
  const u = { A: U('uA'), B: U('uB'), mix: U('uMix'), hue: U('uHue'), sat: U('uSat'), bright: U('uBright'), contrast: U('uContrast'), vig: U('uVig'), grain: U('uGrain'), time: U('uTime'), res: U('uRes') };
  const vao = gl.createVertexArray();
  const tex = () => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  };
  const texA = tex(), texB = tex();
  let small = null, sctx = null; // read-back for the brightness output (Invisible Hands)

  function upload(t, src, nearest) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  }

  return {
    gl, canvas,
    // a, b: { canvas, nearest } — b is the outgoing scene during a crossfade (or null). look: post controls 0..1.
    draw(a, b, mix, look, time) {
      if (a) upload(texA, a.canvas, a.nearest);
      if (b && mix < 1) upload(texB, b.canvas, b.nearest);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA); gl.uniform1i(u.A, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.uniform1i(u.B, 1);
      gl.uniform1f(u.mix, b ? mix : 1);
      gl.uniform1f(u.hue, look.hue); gl.uniform1f(u.sat, look.saturation); gl.uniform1f(u.bright, look.brightness);
      gl.uniform1f(u.contrast, look.contrast); gl.uniform1f(u.vig, look.vignette); gl.uniform1f(u.grain, look.grain);
      gl.uniform1f(u.time, time); gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    // average luminance and the share of bright pixels, from a 16×9 copy of the output (call a few times a second)
    measure() {
      if (!small) { small = document.createElement('canvas'); small.width = 16; small.height = 9; sctx = small.getContext('2d', { willReadFrequently: true }); }
      sctx.drawImage(canvas, 0, 0, 16, 9);
      const d = sctx.getImageData(0, 0, 16, 9).data; let sum = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; sum += l; if (l > 0.72) bright++; }
      return { luma: sum / 144, white: bright / 144 };
    }
  };
}
