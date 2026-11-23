// Mountains and clouds: a raymarched ridged-fbm heightfield (or a lone peak, karst pillars, a canyon) with a
// volumetric cloud slab marched between the camera and the ground. CLOUD picks the cloud form: a sea of clouds,
// valley fog, a lenticular cap, a banner plume, layered mist bands or a storm deck. INK renders as a shan shui painting.
import { shaderEngine } from '../gl.js';

const fs = `
float T, DAY, NIGHT, OCT, HZ;
vec3 SUN, MOON, KEY, KEYC, AMB, WIND, SUMMIT, HAZEC;

float ridged(vec2 p, float oct){
  float s = 0., a = .5, n = 0., pw = 1.;
  mat2 m = mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<8;i++){ float w = clamp(oct-float(i), 0., 1.); if(w<=0.) break;
    float r = 1. - abs(noise2(p)*2. - 1.); r *= r;
    s += w*a*r*pw; n += w*a; pw = clamp(r*1.6, .25, 1.);
    p = m*p + vec2(3.1, 1.7); a *= .5; }
  return s/max(n, 1e-4);
}
float path(float z){ return sin(z*.18)*1.6 + sin(z*.071 + 1.)*2.4; }

float terrain(vec2 p, float oct){
  float amp = mix(.6, 1.4, uX1);
#if defined(TERRAIN_1)
  // one great peak (Matterhorn / Everest)
  vec2 q = p - PEAK;
  float a = atan(q.y, q.x);
  float r = length(q)*(1. + .16*sin(a*3. + 1.) + .07*sin(a*7. + 2.));
  float cone = pow(max(1. - r/PEAKR, 0.), 1.5);
  return cone*PEAKH*amp + ridged(p*.5, oct)*1.1*(.35 + .65*smoothstep(.0, .5, r/PEAKR)) - .6;
#elif defined(TERRAIN_2)
  // karst pillars
  vec2 pp = p*KARST + (vec2(noise2(p*2.1), noise2(p*2.1 + 7.)) - .5)*.3;
  vec2 ip = floor(pp), fp = fract(pp);
  float h = -.45 + noise2(p*1.3)*.2;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(x,y);
    float hh = hash12(ip + g + 13.1);
    vec2 r = g + .2 + .6*hash22(ip + g) - fp;
    float rad = .2 + .17*hash12(ip + g + 5.3);
    float u = length(r)/rad;
    float ph = mix(.2, 2.6, hh*hh)*amp;
    float prof = (1. - smoothstep(.72, 1., u))*(1. - .2*u*u);
    h = max(h, -.45 + (ph + .45)*prof);
  }
  return h + (noise2(p*9.)-.5)*.05;
#elif defined(TERRAIN_3)
  // a winding canyon
  float cx = p.x - path(p.y);
  float wall = smoothstep(.3, 1.3, abs(cx));
  float r = ridged(p*.6, oct);
  return mix(-.45 + noise2(p*2.)*.08, (.9 + r*1.5)*amp, wall) + (r - .5)*.25*wall;
#else
  return ridged(p*TFREQ, oct)*TAMP*amp + (fbm2(p*.09 + 3.7, 3.) - .5)*1.6 - .35;
#endif
}

// cloud density in world space
float cloudD(vec3 p, float oct){
  float cs = mix(1.9, .55, uScale);
  float cov = uCoverage;
  vec3 q = p*cs;
  float lift = (uX2 - .5)*.8;
  float d = 0.;
#if defined(CLOUD_0)
  // a sea of clouds with billowing tops
  float top = CTOP + lift + (cov - .5)*.5 + (fbm2(p.xz*.3 - WIND.xz*T*.02, 3.) - .5)*.6;
  float n = fbm3(q*vec3(1., 1.7, 1.) - WIND*T*.05 + vec3(0., T*.01, 0.), oct);
  d = clamp((top - p.y)*2.2 + (n - .5)*2.4, 0., 1.);
#elif defined(CLOUD_1)
  // valley fog, thin and pooling
  float top = CTOP + lift + (cov - .5)*.4 + (fbm2(p.xz*.4 - WIND.xz*T*.015, 3.) - .5)*.3;
  float n = fbm3(q*vec3(.8, 2.5, .8) - WIND*T*.04, oct);
  d = clamp((top - p.y)*2.5 + (n - .5)*1.6, 0., 1.)*.75;
#elif defined(CLOUD_2)
  // a lenticular cap: stacked lenses that stay put while the air streams through them
  vec3 c = SUMMIT + vec3(0., -.1 + lift*.5, 0.);
  vec3 r3 = p - c;
  vec2 hz = vec2(dot(r3.xz, WIND.xz), dot(r3.xz, vec2(-WIND.z, WIND.x)));
  float n = fbm3(vec3(hz.x - T*.35, r3.y, hz.y)*3.2*cs, oct);
  float sz = mix(1.1, 1.7, cov);
  for(int k=0;k<3;k++){
    float fk = float(k);
    float rr = length(hz/vec2(1.8, 1.2))/(sz*(1. - fk*.22));
    float th = .15*(1. - rr*rr)*(1. - fk*.15);
    float yk = fk*.24;
    d = max(d, smoothstep(0., .07, th - abs(r3.y - yk) + (n - .5)*.05));
  }
  d *= .7 + .5*n;
  // a few low cumulus around the foot
  float lo = clamp((CTOP - p.y)*2. + (fbm3(q*1.2 - WIND*T*.06, oct) - .62)*3. + (cov-.5), 0., 1.);
  d = max(d, lo*.8);
#elif defined(CLOUD_3)
  // banner cloud streaming off the summit to leeward
  vec3 r3 = p - SUMMIT;
  float al = dot(r3.xz, WIND.xz), la = dot(r3.xz, vec2(-WIND.z, WIND.x));
  float w = .09 + max(al, 0.)*.3;
  float yc = -.12 - max(al, 0.)*.08 + .05*sin(al*1.3 - T*.4);
  float env = exp(-(la*la*.6 + (r3.y - yc)*(r3.y - yc)*1.6)/(w*w)) * smoothstep(-.15, .12, al) * smoothstep(4.5*(.5+cov), .5, al);
  float n = fbm3(vec3(al - T*.45, r3.y, la)*3.*cs + vec3(0., 0., T*.05), oct);
  d = clamp(env*2.6*(n*1.8 - .35), 0., 1.);
  float lo = clamp((CTOP - p.y)*2. + (fbm3(q*1.1 - WIND*T*.05, oct) - .6)*3. + (cov-.5), 0., 1.);
  d = max(d, lo*.7);
#elif defined(CLOUD_4)
  // layered mist bands drifting between pillars
  float n = fbm3(q*vec3(.7, 2.2, .7) - WIND*T*.05, oct);
  float wob = (fbm2(p.xz*.5 + T*.01, 3.) - .5)*.35;
  for(int k=0;k<3;k++){
    float hk = MISTY + float(k)*MISTGAP + lift + wob;
    float b = exp(-pow((p.y - hk)/(.09 + .05*float(k)), 2.));
    d += b*(.5 - .35*float(k)*.5);
  }
  d = clamp(d*(n*2.2 - .55 + cov*.6), 0., 1.);
#elif defined(CLOUD_5)
  // storm deck rolling over the ridge and spilling down
  float n = fbm3(q*.8 - WIND*T*.14 + vec3(0., T*.015, 0.), oct);
  float base = CTOP + lift + (noise2(p.xz*.4 - WIND.xz*T*.1) - .5)*.5;
  float th = terrain(p.xz, 3.);
  base = mix(base, min(base, th + .12), smoothstep(CTOP - 1., CTOP - .3, th)); // pour down over high ridges
  d = smoothstep(base - .15, base + .3, p.y)*smoothstep(CTOP + 1.6, CTOP + .8, p.y);
  d = clamp(d*((n - .5)*5. + .1 + cov*.6), 0., 1.);
#endif
  return d;
}

vec3 sky(vec3 rd){
  vec3 col = skyColor(rd, SUN, DAY);
#if defined(CLOUD_5)
  col = mix(col, vec3(luma(col)), .6)*.5;
#endif
  // warm dawn wash toward the sun
  float dusk = smoothstep(.45, .1, DAY)*(1. - NIGHT);
  col += vec3(1., .5, .35)*dusk*.35*pow(max(dot(rd, SUN), 0.), 3.)*(1. - rd.y);
  if (NIGHT > 0.) {
    col = mix(col, mix(vec3(.03, .05, .1), vec3(.004, .008, .025), pow(max(rd.y, 0.), .5)), NIGHT);
    vec2 sp = vec2(atan(rd.x, rd.z), rd.y)*220.;
    float st = step(.996, hash12(floor(sp)))*smoothstep(.0, .2, rd.y);
    col += st*NIGHT*(.5 + .5*sin(uClock*2. + hash12(floor(sp))*30.));
    float m = dot(rd, MOON);
    col += vec3(.9, .92, 1.)*smoothstep(.9994, .9996, m)*NIGHT*1.4 + vec3(.15, .2, .35)*pow(max(m, 0.), 60.)*NIGHT;
  }
  return col;
}

float marchTerrain(vec3 ro, vec3 rd, float tmax){
  float t = .05, lt = t;
  for(int i=0;i<150;i++){
    vec3 p = ro + rd*t;
    float d = p.y - terrain(p.xz, TOCT);
    if (d < .0015*t) {
      float a = lt, b = t;
      for(int j=0;j<5;j++){ float m = .5*(a+b); vec3 q = ro + rd*m; if (q.y - terrain(q.xz, TOCT) < 0.) b = m; else a = m; }
      return .5*(a+b);
    }
    lt = t;
    t += clamp(d*STEPK, .01 + .003*t, .3 + .04*t);
    if (t > tmax || (p.y > 3.6 && rd.y > 0.)) break;
  }
  return -1.;
}
float shadowT(vec3 p, vec3 L){
  float s = 1., t = .06;
  for(int i=0;i<18;i++){ vec3 q = p + L*t; float d = q.y - terrain(q.xz, 4.); s = min(s, 9.*d/t); if (s < 0. || q.y > 3.6) break; t += max(.06, d*.6); }
  return clamp(s, 0., 1.);
}
vec3 normalT(vec2 p, float e){
  float o = OCT + 1.;
  return normalize(vec3(terrain(p - vec2(e,0.), o) - terrain(p + vec2(e,0.), o), 2.*e, terrain(p - vec2(0.,e), o) - terrain(p + vec2(0.,e), o)));
}

vec4 marchClouds(vec3 ro, vec3 rd, float tEnd){
  float t0, t1;
  if (abs(rd.y) < 1e-4) { if (ro.y < CLO || ro.y > CHI) return vec4(0.,0.,0.,1.); t0 = 0.; t1 = tEnd; }
  else { float ta = (CLO - ro.y)/rd.y, tb = (CHI - ro.y)/rd.y; t0 = max(min(ta, tb), 0.); t1 = min(max(ta, tb), tEnd); }
  if (t1 <= t0) return vec4(0.,0.,0.,1.);
  float tr = 1.; vec3 acc = vec3(0.);
  float ph = .55 + .9*pow(max(dot(rd, KEY), 0.), 5.) + .3*pow(max(dot(rd, KEY), 0.), 40.);
  float ds0 = max((t1 - t0)/60., .03);
  float t = t0 + ds0*hash12(gl_FragCoord.xy + fract(uClock)*17.);
  for(int i=0;i<64;i++){
    if (t > t1) break;
    float ds = ds0*(1. + t*.04);
    vec3 p = ro + rd*t;
    float d = cloudD(p, OCT - 1.);
    if (d > .004) {
      float l1 = cloudD(p + KEY*.08, OCT*.5), l2 = cloudD(p + KEY*.3, 2.5);
      float sh = exp(-(l1*.08 + l2*.25)*DENS*1.3);
      float hgt = clamp((p.y - CLO)/(CHI - CLO), 0., 1.);
      vec3 lc = KEYC*sh*ph*(1. - exp(-d*DENS*.25))*1.6 + AMB*(.55 + .6*hgt);
#if defined(CLOUD_5)
      lc = KEYC*sh*ph*.8 + AMB*mix(.25, 1.1, hgt*hgt);
      float fl = step(.93, hash11(floor(T*3.)))*step(.5, hash11(floor(T*3.) + 7.));
      lc += vec3(.8, .85, 1.)*fl*exp(-length(p.xz - vec2(sin(floor(T*3.))*3., 6.))*.6)*2.;
#endif
      lc = mix(lc, HAZEC, 1. - exp(-t*HZ));
      float a = 1. - exp(-d*DENS*ds);
      acc += tr*a*lc; tr *= 1. - a;
      if (tr < .02) break;
    }
    t += ds;
  }
  return vec4(acc, tr);
}

vec3 albedo(vec3 p, vec3 n){
  vec3 rock = ROCK*(.7 + .6*noise2(p.xz*7. + p.y*3.));
  float g = smoothstep(GSLOPE, GSLOPE + .15, n.y + (noise2(p.xz*5. + p.y*4.) - .5)*.5);
  vec3 col = mix(rock, GRASS*(.8 + .4*noise2(p.xz*11.)), g*smoothstep(SNOWH, SNOWH - .5, p.y));
  float sn = smoothstep(SNOWH - .1, SNOWH + .2, p.y + (noise2(p.xz*4.) - .5)*.5)*smoothstep(.35, .65, n.y);
  return mix(col, vec3(.9, .92, .97), sn);
}

void main(){
  T = uTime; HZ = HAZE*mix(.25, 1.75, uX3);
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  DAY = uLight; NIGHT = smoothstep(.15, .05, DAY);
  OCT = mix(3., 7., uDetail);
  vec2 wd = windDir(); WIND = vec3(wd.x, 0., wd.y);
  float el = mix(-.1, 1.2, DAY);
  SUN = normalize(vec3(sin(SUNAZ)*cos(el), sin(el), cos(SUNAZ)*cos(el)));
  MOON = normalize(vec3(sin(MOONAZ), .13, cos(MOONAZ)));
  float sunUp = smoothstep(-.08, .06, SUN.y);
  vec3 sunCol = mix(vec3(1., .38, .14), vec3(1., .93, .85), smoothstep(.04, .5, SUN.y))*2.3*sunUp;
  KEY = normalize(mix(SUN, MOON, NIGHT));
  KEYC = sunCol*(1. - NIGHT) + vec3(.32, .4, .62)*.6*NIGHT;
  AMB = mix(vec3(.025, .035, .07), mix(vec3(.42, .34, .42), vec3(.5, .6, .8), smoothstep(.15, .5, DAY)), smoothstep(.03, .25, DAY));
#if defined(CLOUD_5)
  KEYC *= .45; AMB *= .7;
#endif
#if defined(TERRAIN_1)
  SUMMIT = vec3(PEAK.x, terrain(PEAK, 5.), PEAK.y);
#endif

  // camera: drag orbits around the target; a slow drift keeps the view alive
  vec3 ro, ta;
#if defined(FLY_1)
  float z = T*FLYSPD;
  ro = vec3(path(z), CAMP.y, z);
  ta = vec3(path(z + 2.5), CAMP.y - .12, z + 2.5);
  vec3 off = ta - ro;
  off.xz = rot2(off.xz, -uDrag.x*1.2); off.y += uDrag.y*1.5;
  ta = ro + off;
#else
  ta = CAMT; vec3 off = CAMP - CAMT;
  float yaw = uDrag.x*1.3 + sin(T*.025)*.35*uX4;
  off.xz = rot2(off.xz, yaw);
  off.y = clamp(off.y + uDrag.y*length(off)*.6, -.5, length(off)*1.2);
  ro = ta + off;
  ro.y = max(ro.y, terrain(ro.xz, 4.) + .25);
#endif
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(0.,1.,0.), fw)), up = cross(fw, rt);
  vec3 rd = normalize(fw*FOCAL + uv.x*rt + uv.y*up);

  HAZEC = sky(normalize(vec3(rd.x, .03, rd.z)))*mix(1., .7, NIGHT);
  float tmax = 40.;
  float th = marchTerrain(ro, rd, tmax);
  vec3 col; float tEnd = th > 0. ? th : tmax;
  vec3 pos = ro + rd*tEnd; vec3 nor = vec3(0.,1.,0.); float dif = 0.;
  if (th > 0.) {
    nor = normalT(pos.xz, .002 + .0015*th);
    vec3 alb = albedo(pos, nor);
    dif = max(dot(nor, KEY), 0.);
    float sh = dif > 0. ? shadowT(pos + nor*.01, KEY) : 0.;
    // shadow cast by the cloud layer overhead
    float cy = CSHY;
    float csh = exp(-cloudD(pos + KEY*max(cy - pos.y, 0.)/max(KEY.y, .15), 2.)*2.5);
    float bounce = .5 + .5*nor.y;
    col = alb*(KEYC*dif*sh*csh + AMB*bounce*1.1);
    dif *= sh*csh;
    col = mix(col, HAZEC, 1. - exp(-th*HZ));
  } else {
    col = sky(rd);
  }
  vec4 cl = marchClouds(ro, rd, tEnd);

#if defined(INK_1)
  // shan shui: ink tone from shading and slope, fading into paper mist with distance and height
  vec3 paper = vec3(.93, .89, .8) - .05*length(uv);
  paper *= .96 + .04*noise2(gl_FragCoord.xy*.35) ;
  float ink = 0.;
  if (th > 0.) {
    float tex = noise2(vec2(pos.x*6. + pos.z*2., pos.y*30.)) ;
    float tone = (1. - dif)*.75 + (1. - nor.y)*.45 + smoothstep(.55, .9, tex)*.3;
    float fade = exp(-th*.11)*smoothstep(-.4, .7, pos.y);
    ink = clamp(tone*fade*1.1, 0., 1.);
    // dark edges along silhouettes
    ink += smoothstep(.35, .0, abs(dot(nor, -rd)))*fade*.5;
  }
  ink *= cl.a;
  ink = clamp(ink, 0., 1.);
  vec3 inkc = mix(vec3(.08, .09, .1), vec3(.22, .3, .28), smoothstep(.3, .9, pos.y)*.4);
  col = mix(paper, inkc, ink);
  col = mix(col, paper*1.03, (1. - cl.a)*.85);
  // a pale vermilion sun and the artist's seal
  float sd = length(uv - vec2(.48, .28));
  col = mix(col, vec3(.86, .4, .3), smoothstep(.065, .06, sd)*.45*(1. - ink));
  vec2 sq = abs(uv - vec2(.5*uRes.x/uRes.y - .09, -.37));
  float seal = step(max(sq.x, sq.y), .035)*step(.3, noise2(gl_FragCoord.xy*.4 + 3.));
  col = mix(col, vec3(.72, .12, .1), seal*.85);
  outColor = vec4(col, 1.);
#else
  col = col*cl.a + cl.rgb;
#if defined(CLOUD_5)
  // rain curtains under the storm deck
  float rain = noise2(vec2(uv.x*120. + uv.y*25., uv.y*4. + T*16.))*noise2(vec2(uv.x*7. - T*.2, 0.));
  col = mix(col, AMB*1.2, smoothstep(.45, .8, rain)*.35*uCoverage*smoothstep(.5, -.1, uv.y));
#endif
  col = 1. - exp(-col*EXPO);
  col = pow(col, vec3(.95));
  outColor = vec4(col, 1.);
#endif
}`;

export default shaderEngine({
  id: 'mountains', name: 'Mountain Clouds', fs, res: 0.5,
  defaults: {
    TERRAIN: 0, CLOUD: 0, INK: 0, FLY: 0, FLYSPD: 0.6,
    TFREQ: 0.32, TAMP: 2.0, TOCT: 5, STEPK: 0.5, PEAK: [0, 7], PEAKR: 3.6, PEAKH: 3.2, KARST: 1.1,
    CTOP: 0.6, CSHY: 0.4, CLO: -0.6, CHI: 1.4, DENS: 9, MISTY: -0.1, MISTGAP: 0.45, HAZE: 0.045,
    SUNAZ: 0.0, MOONAZ: 0.3, FOCAL: 1.6, EXPO: 1.5,
    CAMP: [0, 2.6, -1], CAMT: [0, 1.0, 8],
    ROCK: [0.34, 0.3, 0.28], GRASS: [0.16, 0.22, 0.1], GSLOPE: 0.8, SNOWH: 1.6
  },
  params: [
    { id: 'x1', label: 'Peak height', value: 0.5 },
    { id: 'x2', label: 'Cloud height', value: 0.5 },
    { id: 'x3', label: 'Haze', value: 0.5 },
    { id: 'x4', label: 'Camera drift', value: 0.5 }
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'mountains-' + id, name, desc, opts, params, tags: ['mountains', '3d', 'realistic', ...tags] });
export const scenes = [
  d('cloudsea', 'Sea of Clouds', 'Summits rising out of a glowing cloud sea at sunrise.',
    { CLOUD: 0, CTOP: 0.75, CLO: -0.6, CHI: 1.4, CAMP: [0, 3.0, -1], CAMT: [0, 1.4, 8], SUNAZ: 0.25, HAZE: 0.035 },
    { light: 0.22, coverage: 0.55, scale: 0.5 }, ['sunset', 'distance']),
  d('valleyfog', 'Valley Fog at Dawn', 'Cold fog pooled in the valleys while the ridges catch first light.',
    { CLOUD: 1, CTOP: 0.15, CLO: -0.6, CHI: 0.6, CAMP: [0, 2.2, -1], CAMT: [0, 0.4, 8], SUNAZ: -1.0, HAZE: 0.06, GSLOPE: 0.7, SNOWH: 9, GRASS: [0.13, 0.2, 0.09] },
    { light: 0.3, coverage: 0.5, scale: 0.55, speed: 0.4 }, ['moody']),
  d('lenticular', 'Lenticular Cap', 'A stack of saucer clouds parked on a summit while the wind pours through.',
    { TERRAIN: 1, CLOUD: 2, CTOP: -0.1, CLO: -0.6, CHI: 3.6, CAMP: [-2.5, 0.9, -2], CAMT: [0, 2.0, 7], SUNAZ: -2.2, SNOWH: 1.2, STEPK: 0.45 },
    { light: 0.55, coverage: 0.5, scale: 0.5, x4: 0.3 }, ['weather']),
  d('banner', 'Himalayan Banner', 'A plume of cloud streaming off a high pyramid peak in a jet-stream gale.',
    { TERRAIN: 1, CLOUD: 3, CTOP: -0.2, CLO: -0.6, CHI: 3.6, PEAKH: 3.6, PEAKR: 3.2, CAMP: [-3.5, 1.0, -2], CAMT: [1.2, 2.2, 7], SUNAZ: 2.6, SNOWH: 0.9, HAZE: 0.03, ROCK: [0.28, 0.27, 0.27] },
    { light: 0.75, coverage: 0.5, scale: 0.55, speed: 0.6, x4: 0.2 }, ['weather']),
  d('karst', 'Karst Pillars in Mist', 'Sheer sandstone towers wrapped in drifting layers of mist.',
    { TERRAIN: 2, CLOUD: 4, CLO: -0.6, CHI: 1.6, MISTY: -0.15, MISTGAP: 0.5, CAMP: [0.4, 2.2, -4], CAMT: [0, 0.5, 6], SUNAZ: 0.6, HAZE: 0.1, STEPK: 0.35, ROCK: [0.42, 0.4, 0.36], GRASS: [0.12, 0.22, 0.1], GSLOPE: 0.25, SNOWH: 9 },
    { light: 0.6, coverage: 0.55, scale: 0.5 }, ['fantasy', 'moody']),
  d('shanshui', 'Shan Shui Ink', 'Mountains and mist brushed in ink on rice paper.',
    { TERRAIN: 0, CLOUD: 4, INK: 1, TFREQ: 0.45, TAMP: 2.6, CLO: -0.6, CHI: 2.0, MISTY: 0.0, MISTGAP: 0.6, CAMP: [0, 2.4, -6], CAMT: [0, 1.0, 8], SUNAZ: 1.2, STEPK: 0.4 },
    { light: 0.7, coverage: 0.55, scale: 0.6, speed: 0.4 }, ['art', 'stylized']),
  d('storm', 'Alpine Storm', 'A dark front rolling over the ridge, spilling down the slopes.',
    { CLOUD: 5, CSHY: 2.4, CTOP: 1.9, CLO: -0.2, CHI: 3.6, DENS: 7, CAMP: [0, 1.0, -1], CAMT: [0, 1.6, 8], SUNAZ: 2.8, HAZE: 0.07, SNOWH: 1.5, ROCK: [0.18, 0.18, 0.2], GRASS: [0.1, 0.14, 0.08] },
    { light: 0.5, coverage: 0.6, scale: 0.55, speed: 0.65, wind: 0.25 }, ['storm', 'weather', 'moody']),
  d('moonlit', 'Moonlit Range', 'Snowy peaks silvered by the moon above a low cloud deck.',
    { CLOUD: 0, CTOP: 0.35, CLO: -0.6, CHI: 1.0, CAMP: [0, 2.5, -1], CAMT: [0, 1.4, 8], MOONAZ: 0.45, SNOWH: 1.0, EXPO: 3.0 },
    { light: 0.04, coverage: 0.45, scale: 0.5, speed: 0.4 }, ['night']),
  d('canyon', 'Misty Canyon Flight', 'Gliding low through a winding canyon thick with mist.',
    { TERRAIN: 3, CLOUD: 1, FLY: 1, FLYSPD: 0.7, CTOP: 0.0, CLO: -0.6, CHI: 1.0, CAMP: [0, 0.45, 0], SUNAZ: 0.4, HAZE: 0.09, ROCK: [0.4, 0.33, 0.28], GSLOPE: 0.6, SNOWH: 9, FOCAL: 1.3 },
    { light: 0.45, coverage: 0.55, scale: 0.55, x4: 0 }, ['moody', 'fast']),
];
