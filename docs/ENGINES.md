# Writing an engine

An **engine** is one way of drawing clouds (a raymarcher, cartoon puffs, pixel art…). A **scene** is an engine plus
preset values. The gallery lists scenes. Each engine lives in `js/engines/<id>.js` and is listed in `js/registry.js`.

```js
// js/engines/example.js
import { clamp, windX } from '../util.js';

export default {
  id: 'example',
  name: 'Example',
  kind: '2d',          // '2d' → the host passes a CanvasRenderingContext2D; 'gl' → a WebGL2RenderingContext
  res: 1,              // render-resolution multiplier (0.5 for heavy shaders); the host upscales
  params: [            // up to four engine-specific controls, mapped to p.x1..p.x4, all 0..1
    { id: 'x1', label: 'Outline', value: 0.5 },
  ],
  create(ctx, opts) {  // opts = the scene's opts object (constants: palettes, modes, counts)
    return {
      render(f) { /* draw one frame; see the frame object below */ },
      resize(w, h) {},  // optional
      dispose() {}      // optional
    };
  }
};

export const scenes = [
  { id: 'example-basic', name: 'Basic Example', tags: ['cartoon'], desc: 'One line about it.',
    opts: { palette: 'day' },
    params: { speed: 0.5, scale: 0.5, coverage: 0.5, detail: 0.5, wind: 0.5, light: 0.8, x1: 0.5 } },
];
```

## The frame object

| field | meaning |
|---|---|
| `f.ctx` | the context (same one `create` got) |
| `f.w`, `f.h` | canvas size in pixels (already includes the quality scale) |
| `f.t` | scene time in seconds, **already scaled by the Speed control** (Speed 0 freezes it). Animate with `f.t`. |
| `f.dt` | scaled seconds since the last frame (0 when frozen) |
| `f.clock` | real seconds, unscaled (only for things like flicker) |
| `f.p` | controls, all **0..1**: `scale` (cloud size), `coverage` (how much sky is cloud), `detail`, `wind` (direction: 0.5 = blowing right, a full turn across the range; see `windX`/`windDir`), `light` (0 night → ~0.3 golden hour → 1 noon), `x1..x4` (engine extras) |
| `f.pointer` | `{ x, y }` in 0..1 (y down), `down`, `moved` (true once the pointer has been over the canvas), `dragX`, `dragY` accumulated drag in screen heights (use for orbit/pan), `clicks` (array of `{x,y}` clicks since the last frame) |
| `f.opts` | the scene opts |

Rules:
- Draw the **whole** frame every call (no reliance on the previous frame) unless the engine deliberately does trails.
- Look good on the very first frame, at any `t` (the host starts `t` at a random offset, and thumbnails render a single
  frame). Prefer state that is a pure function of `t`; if you keep particles, warm them up in `create`.
- Be resolution independent: size things relative to `f.h` / `f.w`, never fixed pixels.
- No network requests, no external libraries. Plain ES modules.
- `rng(seed)` gives correlated first values for nearby seeds; spread them first, e.g. `rng(Math.imul(i + 1, 2654435761))`.
- Hue/saturation/brightness/contrast/vignette/grain are applied by the host afterwards — don't duplicate them.

## Shader engines

`js/gl.js` exports `shaderEngine({ id, name, fs, params, res, defaults })`. `fs` is GLSL ES 3.00 with a `main()` that
writes `outColor`; the header (uniforms `uRes uTime uClock uMouse uDrag uScale uCoverage uDetail uWind uLight uX1..uX4
uSeed`) and a noise library (`noise2/3`, `fbm2/3(p, octaves)`, `worley2/3`, `hash*`, `hsv2rgb`, `skyColor`, `windDir`,
`rot2`, `luma`) are prepended. Scene `opts` that are numbers become float `#define`s (`K: 0.5` → `#define K 0.50000`, `MODE: 2` → `#define MODE 2.00000`);
a non-negative integer also defines a flag, `MODE: 2` → `#define MODE_2`, so `#ifdef MODE_2` / `#if defined(MODE_2)`
selects code at compile time. Use plain `if (MODE == 2.0)` in expressions (constant-folded, free). Arrays of 2–4 numbers
become `vecN`. Give every define a default in the engine's `defaults` (only the flag for the value actually set exists).
