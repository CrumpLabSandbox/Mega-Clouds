// Painted skies: a 2D cloud field (domain-warped fbm, Worley cells or streaks), lit by stepping toward the sun.
// PERSP 1 lays the field on a plane above a horizon, so clouds shrink into the distance.
import { shaderEngine } from '../gl.js';

const fs = `
float T;
float shape(vec2 p, float oct){
  vec2 w = windDir();
  p += w*T*.06;
  float n;
#if defined(MODE_1)
  // cirrus: long stretched wisps, strongly warped
  vec2 s = vec2(p.x*.35, p.y*2.2);
  vec2 q = vec2(fbm2(s*.7 + T*.01, 4.), fbm2(s*.7 + 7.3, 4.));
  n = fbm2(s + q*2.5 + vec2(T*.02, 0.), oct);
  n = pow(n, 1.6)*1.6;
#elif defined(MODE_2)
  // mackerel sky: rows of small cells
  vec2 s = p*2.4 + vec2(0., fbm2(p*.6, 3.)*1.5);
  float c = 1. - worley2(s + T*.03);
  n = c*.6 + fbm2(p*3. + T*.02, oct)*.5;
  n *= smoothstep(.2, .7, fbm2(p*.35 + 3., 3.) + .2);
#elif defined(MODE_3)
  // stratus: a heavy low deck with soft undulation
  n = .55 + .45*fbm2(p*vec2(.5,1.4) + T*.02, oct) - .1*worley2(p*1.5);
#else
  // cumulus: warped fbm with billowy worley lumps
  vec2 q = vec2(fbm2(p*.8 + vec2(0., T*.01), 4.), fbm2(p*.8 + vec2(5.2, 1.3), 4.));
  n = fbm2(p + q*WARP + vec2(0., T*.008), oct);
  n = n*.8 + (1. - worley2(p*2.3 + q))*.25;
#endif
  return n;
}
float dens(vec2 p, float oct){
  float n = shape(p, oct);
  float cov = mix(.82, .25, uCoverage);
  return clamp((n - cov)*SHARP, 0., 1.);
}
void main(){
  T = uTime;
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  uv += (uMouse.w > .5 ? (uMouse.xy - .5)*.04 : vec2(0.));
  float day = uLight;
  float oct = mix(2., 7., uDetail);
  float sc = mix(4.5, .7, uScale);
  vec2 p; float fade = 1.; float horizon = HORIZON;
  float y = uv.y - horizon;
#if defined(PERSP_1)
  if (y <= 0.002) { p = vec2(0.); fade = 0.; }
  else { p = vec2(uv.x/y, 1./y)*.35*sc; fade = smoothstep(.0, .25, y); }
#else
  p = uv*sc;
#endif
  vec3 top = TOP, bot = BOT;
  float dusk = smoothstep(.55, .0, abs(day - .22));
  float night = smoothstep(.2, .0, day);
  top = mix(top, vec3(.12,.12,.32), dusk*.6); bot = mix(bot, vec3(1.,.55,.35), dusk*.8);
  top = mix(top, vec3(.0,.01,.04), night); bot = mix(bot, vec3(.03,.04,.1), night);
  vec3 sky = mix(bot, top, smoothstep(-.5, .6, uv.y));
  // stars at night
  float st = step(.997, hash12(floor(gl_FragCoord.xy/1.5)))*night*(.6+.4*sin(uClock*3.+hash12(floor(gl_FragCoord.xy))*20.));
  sky += st;
  vec2 sunPos = vec2(mix(-.5, .35, day), mix(-.05, .38, smoothstep(0., .6, day)) + horizon);
#if defined(MOON_1)
  sunPos = vec2(.4, .3);
  sky += vec3(.9,.9,1.)*smoothstep(.06, .055, length(uv - sunPos)) + vec3(.2,.25,.4)*exp(-length(uv-sunPos)*6.);
#else
  float sd = length(uv - sunPos);
  sky += vec3(1.,.85,.6)*(smoothstep(.05, .045, sd)*1.2 + exp(-sd*5.)*.35*(1.-night));
#endif
  vec3 col = sky;
  if (fade > 0.) {
    float d = dens(p, oct);
    // light: sample toward the sun in field space
    vec2 ld = normalize(sunPos - uv + 1e-4)*.12*sc*.35;
#if defined(PERSP_1)
    ld = vec2(ld.x, -abs(ld.y)) ;
#endif
    float d2 = dens(p + ld, oct*.7), d3 = dens(p + ld*2.5, oct*.5);
    float shade = clamp(1. - (d2*.6 + d3*.4)*SHADOW, 0., 1.);
    vec3 lit = LIT, dark = DARK;
    lit = mix(lit, vec3(1.,.6,.4), dusk*.7); dark = mix(dark, vec3(.35,.2,.35), dusk*.6);
    lit = mix(lit, vec3(.25,.28,.4), night); dark = mix(dark, vec3(.03,.04,.08), night);
#if defined(MOON_1)
    lit = mix(lit, vec3(.6,.65,.8), night*.6);
#endif
    vec3 cc = mix(dark, lit, shade);
    // silver lining near the sun
    float rim = smoothstep(.0, .3, d) * (1. - smoothstep(.3, .9, d)) * exp(-length(uv - sunPos)*3.)*(1.-night);
    cc += vec3(1.,.9,.7)*rim*.8;
    float a = smoothstep(0., 1., d)*fade*ALPHA;
    col = mix(sky, cc, a);
  }
#if defined(PERSP_1)
  if (y <= 0.) {
    // ground or sea below the horizon
    float g = -y;
    vec3 ground = GROUND;
    ground = mix(ground, ground*.15, night);
    ground = mix(ground, ground*vec3(1.2,.8,.7), dusk);
  #if defined(SEA_1)
    vec2 sp = vec2(uv.x/max(g,1e-3), 1./max(g,1e-3));
    float wv = noise2(sp*vec2(2.,.6) + vec2(0., uTime*.3));
    vec3 refl = mix(bot, top, .3) * (.55 + .3*wv);
    ground = mix(refl, ground, smoothstep(0., .5, g));
    float glint = exp(-abs(uv.x - sunPos.x)*8.)*smoothstep(.6, 1., wv)*(1.-night);
    ground += vec3(1.,.8,.5)*glint*.6;
  #endif
    col = mix(ground, col, smoothstep(.004, .0, g));
  }
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'sky', name: 'Painted Sky', fs, res: 0.75,
  defaults: { MODE: 0, PERSP: 0, SEA: 0, MOON: 0, HORIZON: -0.32, WARP: 1.6, SHARP: 3.5, SHADOW: 1.2, ALPHA: 1.0,
    TOP: [0.16, 0.38, 0.78], BOT: [0.62, 0.78, 0.95], LIT: [1, 1, 1], DARK: [0.55, 0.6, 0.7], GROUND: [0.18, 0.3, 0.16] },
  params: []
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'sky-' + id, name, desc, opts, params, tags: ['realistic', '2d', ...tags] });
export const scenes = [
  d('fair', 'Fair-Weather Cumulus', 'Flat-bottomed puffs drifting overhead on a summer day.', {}, { coverage: 0.45, light: 0.85 }),
  d('cirrus', 'Mare’s Tails', 'High, wispy cirrus streaks stretched by jet-stream winds.', { MODE: 1, SHARP: 2.0, SHADOW: 0.3, ALPHA: 0.9 }, { coverage: 0.5, scale: 0.6, speed: 0.6 }),
  d('mackerel', 'Mackerel Sky', 'Altocumulus ripples, like fish scales.', { MODE: 2, SHARP: 4.0, SHADOW: 0.8 }, { coverage: 0.55, scale: 0.55 }),
  d('overcast', 'Overcast Stratus', 'A low grey lid on the world.', { MODE: 3, SHARP: 2.0, SHADOW: 1.6, LIT: [0.82, 0.84, 0.86], DARK: [0.42, 0.44, 0.48], TOP: [0.55, 0.58, 0.62], BOT: [0.7, 0.72, 0.74] }, { coverage: 0.8, light: 0.7 }, ['moody']),
  d('horizon', 'Clouds to the Horizon', 'A cloud deck receding into the distance over fields.', { PERSP: 1 }, { coverage: 0.5, scale: 0.45, light: 0.8 }, ['distance']),
  d('ocean', 'Ocean Horizon', 'Trade-wind cumulus marching over open sea.', { PERSP: 1, SEA: 1, GROUND: [0.04, 0.16, 0.28], HORIZON: -0.18 }, { coverage: 0.42, scale: 0.4 }, ['distance', 'sea']),
  d('golden', 'Golden Hour', 'Low sun setting the cloud edges alight.', { PERSP: 1, SEA: 1, GROUND: [0.1, 0.08, 0.1], HORIZON: -0.15 }, { light: 0.24, coverage: 0.55, scale: 0.5 }, ['sunset', 'distance']),
  d('cotton', 'Cotton Candy', 'Pastel pink and blue puffs.', { TOP: [0.55, 0.65, 0.98], BOT: [1.0, 0.78, 0.88], LIT: [1.0, 0.86, 0.94], DARK: [0.72, 0.62, 0.9], SHADOW: 0.9 }, { coverage: 0.5, light: 1.0, scale: 0.6 }, ['pastel']),
  d('moonlit', 'Moonlit Clouds', 'Silvery clouds sliding past a full moon and stars.', { MOON: 1 }, { light: 0.06, coverage: 0.45, speed: 0.45 }, ['night']),
  d('timelapse', 'Time-Lapse Sky', 'A day’s worth of weather, fast-forwarded.', { PERSP: 1 }, { speed: 0.95, coverage: 0.55, light: 0.7 }, ['fast', 'distance']),
  d('alien', 'Alien Sky', 'Teal clouds on a magenta world.', { TOP: [0.35, 0.05, 0.35], BOT: [0.95, 0.4, 0.5], LIT: [0.55, 1.0, 0.85], DARK: [0.15, 0.35, 0.45], PERSP: 1, GROUND: [0.25, 0.08, 0.2] }, { coverage: 0.55, light: 0.9 }, ['fantasy', 'distance']),
  d('rush', 'Racing Clouds', 'Low scud tearing past in a gale.', { WARP: 2.4, SHARP: 2.5 }, { speed: 0.92, coverage: 0.6, scale: 0.35, wind: 0.5, light: 0.6 }, ['fast', 'moody']),
  d('cirrocumulus', 'Cirrocumulus Rippled', 'Tiny high grains in rippling sheets.', { MODE: 2, SHARP: 5.0, SHADOW: 0.4, PERSP: 1 }, { scale: 0.2, coverage: 0.6, light: 0.9 }, ['distance']),
];
