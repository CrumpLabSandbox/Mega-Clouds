# Mega-Clouds

A cloud simulator for the browser: over a hundred animated cloudscapes, from raymarched volumetric cumulus and clouds
wrapped around mountains to cartoon, 8-bit, graffiti, ink, ASCII and paper-craft clouds. It works as a gallery, a
screensaver, and a clean video source.

**Live:** https://crumplabsandbox.github.io/Mega-Clouds/

No build step and no dependencies: plain ES modules, WebGL2 and canvas 2D. Serve the folder with any static server
(`python3 -m http.server`) and open `index.html`.

## Using it

- **Gallery**: filter by tag or search, then click a scene.
- **Viewer**: drag to look around or orbit in 3D scenes. Click to interact where a scene supports it (spawn clouds,
  trigger lightning, blow the fluid clouds). Press ⚙ for controls.
- **Controls** (all 0–1): Speed (0 freezes, the middle is real time, the top is a 16× time-lapse), Size, Coverage,
  Detail, Wind direction, Light (night → golden hour → noon), up to four scene-specific controls, and a Look section
  (hue, saturation, brightness, contrast, vignette, grain) applied to every scene.
- **Screensaver**: the ⟳ menu changes scene every 15 s to 5 min with a crossfade. Shuffle respects the gallery filter.
- **Keys**: `←` `→` scene · `Space` pause · `R` random · `F` full screen · `H` hide the HUD · `C` controls ·
  `S` save a PNG · `V` record WebM · `G`/`Esc` gallery.
- **Quality**: Auto lowers the render resolution until the frame rate holds, then raises it again.

## As a video source

URL parameters:

| parameter | effect |
|---|---|
| `scene=<id>` | open a scene (ids are shown by 🔗 *Copy link*) |
| `ui=0` | no HUD, no gallery: just the picture (H still toggles the HUD) |
| `shuffle=<seconds>` | screensaver mode |
| `speed=0.7`, `coverage=0.3`, `hue=0.5`, … | any control, 0–1 |
| `quality=0.5 \| 0.75 \| 1 \| 1.5` | fix the render scale |
| `room=<code>` | join an Invisible Hands room |

Embedding: `window.megaClouds` exposes `canvas` (the output, a WebGL2 canvas with `preserveDrawingBuffer`), `scenes`,
`setScene(id)`, `set(control, value)`, `next()`, `prev()`, `random()`, `pause()` and `measure()`. A page on the same
origin, such as [MEGA·CV](https://crumplabsandbox.github.io/mega-cv/) on `crumplabsandbox.github.io`, can iframe
`?ui=0` and read that canvas each frame as a texture. Any page can drive it with
`frame.contentWindow.postMessage({ megaClouds: { scene: 'volumetric-cumulus', set: { speed: 0.7 }, next: true } }, '*')`.
Screen capture of the tab works too.

## Invisible Hands

The **Hands** button in the viewer joins an [Invisible Hands](https://github.com/samuelling/InvisibleHands) room
(Sam Ling's protocol, `js/vendor/invisible-hands.js`, copied unchanged from MEGA·CV), so other apps, MEGA·CV's Hands
module for one, can move the controls. It exposes every control (`speed`, `scale`, `coverage`, `detail`, `wind`,
`light`, `x1`–`x4`, the look controls), `scene` (0–1 across the list), `next` (trigger) and `pause` (toggle), and
publishes `brightness`, `cloudiness` (the share of bright pixels) and `scene`. Opening the page with `?room=<code>`
joins that room. While linked, the page holds a WebSocket to Sam's relay, `invisible-hands.samuelling.workers.dev`.

## How it is built

```
index.html, css/style.css
js/app.js          gallery, viewer, controls, shuffle, recording, Invisible Hands, embed API
js/post.js         output stage: look controls and crossfades on one WebGL2 canvas
js/registry.js     engine list, standard controls, defaults
js/gl.js           shaderEngine() helper and the GLSL noise library
js/util.js         2D helpers: noise, random, puff sprites, sky gradients
js/engines/*.js    one file per engine, each exporting the engine and its scenes
tools/preview.html + tools/shot.mjs   render every scene of an engine headlessly and screenshot it
```

An **engine** is a way of drawing clouds; a **scene** is an engine plus presets. To add one, see
[docs/ENGINES.md](docs/ENGINES.md). `node tools/shot.mjs <engine> out.png` renders all its scenes to one image
(needs Playwright).
