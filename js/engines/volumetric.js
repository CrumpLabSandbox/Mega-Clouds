// Raymarched volumetric clouds: a slab of fbm + Worley-eroded density, lit by marching toward the sun
// (Beer's law, powder term, two-lobe Henyey-Greenstein phase). Cameras: from the ground, above the deck, inside it.
// Drag to look around.
import { shaderEngine } from '../gl.js';

const fs = `
vec3 SUN; float DAY;
float CT;
float hg(float c, float g){ float g2 = g*g; return (1.-g2)/(4.*PI*pow(1.+g2-2.*g*c, 1.5)); }

float cloud(vec3 p, bool cheap){
  float h = (p.y - LO)/(HI - LO);
  if (h < 0. || h > 1.) return 0.;
  float f = mix(.55, .12, uScale);           // cloud size
  vec3 q = p*f;
  vec2 w = windDir()*CT*WINDV;
  q.xz -= w;
  q.y -= CT*.004;
  float cov = mix(.3, .85, uCoverage);
  float base = fbm3(q*vec3(1., .6, 1.) + vec3(0., 0., CT*EVOLVE), cheap ? 3. : 4.);
  base = base*.8 + (1. - worley3(q*.8 + vec3(0., CT*EVOLVE, 0.)))*.3 - .1;
#ifdef MEGA_1
  // one enormous cloud: fade the field out away from a centre in front of the camera
  vec2 c = vec2(0., 14.) ;
  float r = length((p.xz - c)*vec2(.7, 1.))/9.;
  base = base*.55 + .6*(1. - smoothstep(.2, 1., r));
#endif
  // height profile: rounded tops, flat-ish bases (cumulus) or a flat sheet (stratus)
  float prof = smoothstep(0., BASESOFT, h)*smoothstep(1., TOPROUND, h);
  prof = mix(1., prof, PROFILE);
  // coverage remap: only the top of the noise becomes cloud, which gives crisp edges
  float d = (base*prof - (1. - cov))/max(cov, .05);
  if (d <= 0.) return 0.;
  if (!cheap) {
    float det = mix(.0, .55, uDetail);
    float hf = (1. - worley3(q*4. + vec3(CT*.03, -CT*.02, 0.)))*.65 + noise3(q*11. + CT*.05)*.35;
    hf = mix(hf, 1. - hf, smoothstep(.0, .4, h));   // wispy bases, cauliflower tops
    d = (d - hf*det*(1. - d))/(1. - hf*det*.5);
    if (d <= 0.) return 0.;
  }
  return clamp(d*DENS, 0., 1.);
}

vec3 ambientCol(float h){
  vec3 top = mix(vec3(.04,.05,.1), vec3(.55,.7,.95), smoothstep(-.05, .4, DAY));
  vec3 bot = mix(vec3(.02,.02,.05), vec3(.35,.38,.45), smoothstep(-.05, .4, DAY));
  return mix(bot, top, h)*AMB;
}

float lightMarch(vec3 p){
  float s = 0., st = (HI - LO)*.12;
  for (int i = 0; i < 5; i++) { p += SUN*st; s += cloud(p, true)*st; st *= 1.4; }
  return s;
}

vec4 march(vec3 ro, vec3 rd, float maxT, out float firstT){
  firstT = -1.;
  float t0, t1;
  if (abs(rd.y) < 1e-4) { if (ro.y < LO || ro.y > HI) return vec4(0.,0.,0.,1.); t0 = 0.; t1 = maxT; }
  else {
    float a = (LO - ro.y)/rd.y, b = (HI - ro.y)/rd.y;
    t0 = max(min(a, b), 0.); t1 = min(max(a, b), maxT);
  }
  if (t1 <= t0) return vec4(0.,0.,0.,1.);
  float N = STEPS;
  float dt = (t1 - t0)/N; dt = max(dt, .04);
  float t = t0 + dt*hash12(gl_FragCoord.xy + fract(uClock)*13.);
  vec3 sum = vec3(0.); float T = 1.;
  float cosA = dot(rd, SUN);
  float phase = mix(hg(cosA, .6), hg(cosA, -.25), .3)*4.*PI;
  vec3 sunCol = mix(vec3(1.,.42,.2), vec3(1.,.96,.9), smoothstep(.0, .45, DAY))*SUNPOW*smoothstep(-.12, .05, SUN.y);
#ifdef MOON_1
  sunCol = vec3(.55,.62,.85)*.9;
#endif
  for (int i = 0; i < 96; i++) {
    if (float(i) >= N || T < .02 || t > t1) break;
    vec3 p = ro + rd*t;
    float d = cloud(p, false);
    if (d > .001) {
      if (firstT < 0.) firstT = t;
      float ld = lightMarch(p);
      float h = (p.y - LO)/(HI - LO);
      float beer = exp(-ld*ABSORB);
      float powder = 1. - exp(-ld*ABSORB*2.);
      vec3 L = sunCol*beer*mix(1., powder*2., .5)*phase + ambientCol(h)*(.4 + .6*h);
      float a = 1. - exp(-d*dt*EXT);
      sum += T*a*L;
      T *= 1. - a;
    }
    t += dt*(d > .001 ? 1. : 1.6);
  }
  return vec4(sum, T);
}

void main(){
  CT = uTime + uSeed*200.;
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  DAY = uLight;
  float sa = mix(-.12, 1.1, DAY);
  float az = SUNAZ;
  SUN = normalize(vec3(sin(az)*cos(sa), sin(sa), cos(az)*cos(sa)));
#ifdef MOON_1
  SUN = normalize(vec3(.3, .45, 1.));
#endif
  // camera
  float yaw = uDrag.x*1.6 + YAW;
  float pitch = clamp(PITCH + uDrag.y*1.2, -1.45, 1.45);
  vec3 ro = vec3(0., CAMY, 0.);
  ro.z += uTime*FLY;
  ro.x += sin(uTime*.05)*FLYSWAY;
#ifdef CAM_2
  ro.y += sin(uTime*.13)*.15;
#endif
  vec3 fw = normalize(vec3(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)));
  vec3 rt = normalize(cross(vec3(0.,1.,0.), fw)), up = cross(fw, rt);
  vec3 rd = normalize(fw*FOV + uv.x*rt + uv.y*up);

  vec3 sky = skyColor(rd, SUN, DAY);
#ifdef MOON_1
  sky = mix(vec3(.005,.01,.03), vec3(.04,.06,.14), pow(1.-max(rd.y,0.), 3.));
  float md = dot(rd, SUN);
  sky += vec3(.9,.9,1.)*smoothstep(.9994, .9996, md) + vec3(.15,.2,.35)*pow(max(md,0.), 60.);
  sky += step(.998, hash12(floor(rd.xy*500. + rd.z*300.)))*.8*smoothstep(0., .2, rd.y);
#endif
  sky = mix(sky, PALTOP, PALMIX*smoothstep(-.2, .6, rd.y));
  sky = mix(sky, PALBOT, PALMIX*(1. - smoothstep(-.1, .4, rd.y)));
  vec3 col = sky;

  // ground (below the horizon, seen from above or from the ground)
  float gT = rd.y < 0. ? -ro.y/rd.y : 1e9;
  float maxT = min(gT, MAXD);
  if (rd.y < 0.) {
    vec3 gp = ro + rd*gT;
    vec3 g = GROUND*(.4 + .6*fbm2(gp.xz*.3, 4.));
    g = mix(g, g*vec3(.6,.75,1.2), .2*noise2(gp.xz*2.));
    // cloud shadow: one cheap sample through the slab toward the sun
    vec3 sp = gp + SUN*((LO+HI)*.5 - gp.y)/max(SUN.y, .05);
    float sh = exp(-cloud(sp, true)*6.);
    float lit = max(SUN.y, 0.)*sh;
    g *= .25 + 1.2*lit*vec3(1., .95, .85);
#ifdef MOON_1
    g *= .25;
#endif
    float fog = 1. - exp(-gT*.035);
    col = mix(g, sky, clamp(fog + (1. - smoothstep(-.01, -.2, rd.y))*.0, 0., 1.));
  }
  float ft;
  vec4 c = march(ro, rd, maxT, ft);
  // aerial perspective: distant clouds fade into the sky
  float haze = ft > 0. ? 1. - exp(-ft*HAZE) : 0.;
  vec3 cl = mix(c.rgb, sky*(1. - c.a), haze);
  col = col*c.a + cl;
  col = col*PALTINT;
  // tone map
  col = 1. - exp(-col*EXPOSURE);
  col = pow(col, vec3(.95));
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'volumetric', name: 'Volumetric 3D', fs, res: 0.5,
  defaults: {
    CAM: 0, MEGA: 0, MOON: 0, LO: 1.5, HI: 4.0, CAMY: 0.05, PITCH: 0.35, YAW: 0.0, FOV: 1.3, FLY: 0.0, FLYSWAY: 0.0,
    STEPS: 56, DENS: 2.4, EXT: 3.6, ABSORB: 2.4, AMB: 0.6, SUNPOW: 2.2, WINDV: 0.25, EVOLVE: 0.01, PROFILE: 1.0,
    BASESOFT: 0.12, TOPROUND: 0.55, HAZE: 0.035, MAXD: 60.0, SUNAZ: 0.6, EXPOSURE: 1.3, GROUND: [0.16, 0.24, 0.12],
    PALTOP: [0, 0, 0], PALBOT: [0, 0, 0], PALMIX: 0.0, PALTINT: [1, 1, 1]
  },
  params: []
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'volumetric-' + id, name, desc, opts, params, tags: ['realistic', '3d', ...tags] });
export const scenes = [
  d('cumulus', 'Cumulus Overhead', 'Raymarched summer cumulus seen from a meadow. Drag to look around.', {}, { coverage: 0.5, light: 0.75 }),
  d('cloudsea', 'Above the Cloud Sea', 'Cruising altitude over an endless deck at sunrise.', { CAM: 1, CAMY: 5.2, LO: 1.8, HI: 3.6, PITCH: -0.12, FLY: 0.35, SUNAZ: 0.2 }, { coverage: 0.7, light: 0.3 }, ['sunset', 'distance']),
  d('flythrough', 'Fly Through', 'Gliding inside the cloud layer, puffs streaming past.', { CAM: 2, CAMY: 2.6, LO: 1.6, HI: 3.6, PITCH: 0.0, FLY: 1.6, FLYSWAY: 2.0, HAZE: 0.08 }, { coverage: 0.6, light: 0.8, scale: 0.55 }, ['fast']),
  d('towers', 'Towering Cumulus', 'Congestus climbing high into a deep blue sky.', { LO: 1.2, HI: 7.0, PITCH: 0.42, TOPROUND: 0.35, DENS: 1.9 }, { coverage: 0.42, scale: 0.6, light: 0.7 }),
  d('sunset', 'Sunset Cumulus', 'Low sun lighting the undersides gold and rose.', { PITCH: 0.22, SUNAZ: 0.15 }, { coverage: 0.5, light: 0.2 }, ['sunset']),
  d('moonlit', 'Moonlit Cloud Sea', 'A silver deck under a full moon and stars.', { CAM: 1, MOON: 1, CAMY: 5.0, LO: 1.8, HI: 3.4, PITCH: -0.08, FLY: 0.25, AMB: 0.5 }, { coverage: 0.65, light: 0.0 }, ['night', 'distance']),
  d('stratocumulus', 'Stratocumulus Deck', 'A lumpy grey-white sheet seen from below.', { LO: 1.4, HI: 2.3, PROFILE: 0.6, DENS: 2.2, PITCH: 0.3 }, { coverage: 0.72, scale: 0.65, light: 0.65 }, ['moody']),
  d('gloom', 'Gathering Gloom', 'Heavy, dark bases on a dim afternoon.', { LO: 1.2, HI: 5.0, DENS: 3.0, ABSORB: 2.6, AMB: 0.55, PITCH: 0.18 }, { coverage: 0.78, light: 0.45 }, ['moody', 'storm']),
  d('dawnflight', 'Dawn Flight', 'Skimming the tops at first light.', { CAM: 2, CAMY: 3.7, LO: 1.6, HI: 3.6, PITCH: -0.05, FLY: 1.0, FLYSWAY: 3.0, SUNAZ: 0.0 }, { coverage: 0.55, light: 0.22 }, ['sunset']),
  d('mega', 'The Mega Cloud', 'One colossal cloud filling the sky.', { MEGA: 1, LO: 0.8, HI: 9.0, PITCH: 0.3, TOPROUND: 0.3, MAXD: 80.0, STEPS: 72 }, { coverage: 0.35, scale: 0.7, light: 0.7 }),
  d('shadows', 'Cloud Shadows', 'High above patchwork fields dappled by cloud shadow.', { CAM: 1, CAMY: 9.0, LO: 1.5, HI: 2.8, PITCH: -0.75, FLY: 0.3, HAZE: 0.02 }, { coverage: 0.55, light: 0.85 }, ['distance']),
  d('boiling', 'Boiling Time-Lapse', 'Convection churning at time-lapse speed.', { EVOLVE: 0.08, WINDV: 0.1, LO: 1.2, HI: 6.0, TOPROUND: 0.4 }, { speed: 0.88, coverage: 0.5, light: 0.7 }, ['fast']),
  d('heaven', 'Pastel Heaven', 'Soft, glowing pastel clouds all around.', { CAM: 2, CAMY: 2.8, LO: 1.6, HI: 4.0, PITCH: 0.05, FLY: 0.3, AMB: 1.6, ABSORB: 0.8, PALTOP: [0.75, 0.75, 1.0], PALBOT: [1.0, 0.82, 0.9], PALMIX: 0.7, PALTINT: [1.05, 0.95, 1.05] }, { coverage: 0.62, light: 0.6 }, ['pastel', 'fantasy']),
  d('horizon', 'Endless Horizon', 'Rows of clouds receding over the plains.', { PITCH: 0.04, CAMY: 0.3, MAXD: 90.0, HAZE: 0.02 }, { coverage: 0.45, scale: 0.35, light: 0.6 }, ['distance']),
];
