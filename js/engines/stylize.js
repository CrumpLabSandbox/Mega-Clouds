// Art styles: one animated 2D cloud field (domain-warped fbm + Worley billows, lit by stepping toward the sun),
// rendered through a different artistic filter per scene: cel shading, halftone, Bayer dither, woodblock, ink wash,
// watercolour, pointillism, stained glass, line art, thermal camera, risograph, vaporwave, brushstrokes, op-art.
// MODE selects the style at compile time.
import { shaderEngine } from '../gl.js';

const fs = `
float T, OCT, SC, COV, DUSK, NIGHT, ASP, LPX;
vec2 SUN;

float field(vec2 p, float oct){
  p += windDir()*T*.07;
  vec2 q = vec2(fbm2(p*.5 + vec2(0., T*.013), 3.), fbm2(p*.5 + vec2(5.2, 1.3) - vec2(T*.011, 0.), 3.));
  float n = fbm2(p + q*1.1, oct);
  float b = (1. - worley2(p*1.6 + q*.9))*.24 + (1. - worley2(p*3.7 + q*1.5 + T*.02))*.1*smoothstep(2., 4., oct);
  return n*.72 + b;
}
float dens(vec2 p, float oct){ return clamp((field(p, oct) - COV)*SHARP, 0., 1.); }
vec2 toField(vec2 uv){
  vec2 p = uv*SC;
  if (uMouse.w > .5) { vec2 m = (uMouse.xy - .5)*vec2(ASP, 1.); vec2 dd = uv - m; p -= dd*exp(-dot(dd, dd)*30.)*.8*SC; }
  return p;
}
// x = density 0..1, y = sunlight 0 (shadowed) .. 1 (lit): a bump term (billows lit on the sun side) plus occlusion
vec2 cloud(vec2 uv, float oct){
  vec2 p = toField(uv);
  float d = dens(p, oct);
  vec2 ld = normalize(SUN - uv + 1e-4)*.07;
  float d1 = dens(p + ld, oct*.8), d2 = dens(p + ld*4., max(oct*.5, 2.));
  float l = .62 + (d - d1)*2.6 - d2*.45 - (1. - smoothstep(.0, .5, d))*.0;
  return vec2(d, clamp(l, 0., 1.));
}
vec3 tint(vec3 day, vec3 dusk, vec3 night){ return mix(mix(day, dusk, DUSK), night, NIGHT); }
// anti-aliased line on the iso-level of v; width in device pixels
float isoLine(float v, float level, float wpx){ float fw = max(fwidth(v), 1e-5); return 1. - smoothstep(wpx*.5 - .5, wpx*.5 + .5, abs(v - level)/fw); }
float contours(float v, float n, float wpx){ float x = v*n; float fw = max(fwidth(x), 1e-5); return 1. - smoothstep(wpx*.5 - .5, wpx*.5 + .5, abs(fract(x + .5) - .5)/fw); }
float paperTex(vec2 uv){ return .5*fbm2(uv*vec2(140., 18.), 3.) + .5*noise2(uv*600.); }
float bayer2(vec2 a){ a = floor(a); return fract(a.x/2. + a.y*a.y*.75); }
float bayer4(vec2 a){ return bayer2(.5*a)*.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(.5*a)*.25 + bayer2(a); }

#if defined(MODE_7)
// Voronoi with distance to the cell border (after Inigo Quilez). Returns (border distance, vector to centre).
vec3 voronoi(vec2 x){
  vec2 n = floor(x), f = fract(x), mg = vec2(0.), mr = vec2(0.); float md = 8.;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec2 g = vec2(i,j); vec2 r = g + hash22(n+g) - f; float d = dot(r,r); if (d<md){ md=d; mr=r; mg=g; } }
  md = 8.;
  for (int j=-2;j<=2;j++) for (int i=-2;i<=2;i++){ vec2 g = mg + vec2(i,j); vec2 r = g + hash22(n+g) - f;
    if (dot(mr-r, mr-r) > 1e-5) md = min(md, dot(.5*(mr+r), normalize(r-mr))); }
  return vec3(md, mr);
}
// pointed-arch window: signed distance (negative inside)
float arch(vec2 p, float cx, float w, float yb, float ybot){
  vec2 q = vec2(p.x - cx, p.y);
  float s = p.y < yb ? abs(q.x) - w : max(length(vec2(q.x + w, q.y - yb)) - 2.*w, length(vec2(q.x - w, q.y - yb)) - 2.*w);
  return max(s, ybot - p.y);
}
#endif

#if defined(MODE_6) || defined(MODE_12) || defined(MODE_13)
// ---- painterly source images, sampled once per dot / stroke ----
  #if defined(MODE_12)
vec2 VC1, VC2, MOON;
vec3 sceneCol(vec2 uv){
  // swirl the domain around the big vortex
  vec2 r = uv - VC1; float l2 = dot(r, r);
  vec2 q = VC1 + rot2(r, 2.6*exp(-l2/.07));
  vec2 c = cloud(q*vec2(.8, 1.4), 3.5);
  vec3 sky = mix(tint(vec3(.06,.14,.4), vec3(.1,.12,.35), vec3(.03,.08,.28)), tint(vec3(.3,.55,.85), vec3(.9,.55,.3), vec3(.16,.32,.6)), smoothstep(.5, -.4, uv.y));
  vec3 sw = mix(tint(vec3(.45,.65,.85), vec3(.7,.5,.6), vec3(.32,.5,.75)), tint(vec3(.98,.96,.8), vec3(1.,.85,.5), vec3(.82,.9,.85)), c.y);
  vec3 col = mix(sky, sw, smoothstep(0., .45, c.x));
  // moon with rings of halo
  float md = length(uv - MOON);
  col = mix(col, vec3(.95,.85,.35), smoothstep(.2, .0, md)*(.35 + .35*step(.5, fract(md*28.))));
  float cres = step(md, .055)*step(.05, length(uv - MOON - vec2(-.025, .015)));
  col = mix(col, vec3(1.,.8,.2), max(cres, smoothstep(.09, .05, md)*.5));
  // stars
  vec2 sg = uv*6.; vec2 si = floor(sg); vec2 sp = (si + .25 + .5*hash22(si + 7.))/6.;
  float sd = length(uv - sp);
  if (hash12(si + 3.) > .62 && sp.y > -.05) col = mix(col, mix(vec3(1.,.95,.6), vec3(.85,.95,.6), step(.5, fract(sd*90.))), smoothstep(.05, .01, sd));
  // rolling hills and a village glow
  float hz = -.3 + .06*sin(uv.x*3.5 + 1.) + .03*sin(uv.x*9.);
  if (uv.y < hz) col = mix(vec3(.05,.12,.22), vec3(.15,.28,.35), smoothstep(hz - .25, hz, uv.y)*(.5+.5*noise2(uv*8.)));
  if (uv.y < hz - .06 && hash12(floor(uv*vec2(40., 30.))) > .93) col = vec3(.95,.8,.35);
  // a cypress like a dark flame
  float cx = -ASP*.5 + .28, cy = uv.y + .5;
  float cw = .085*pow(max(1. - cy/.95, 0.), .8)*(.8 + .3*sin(cy*40. + T*.5)) + .01;
  if (abs(uv.x - cx - .02*sin(cy*6.)) < cw && cy < .95) col = mix(vec3(.04,.08,.05), vec3(.18,.3,.15), noise2(uv*30.));
  return col;
}
vec2 flowDir(vec2 c){
  float a = (noise2(c*2.2 + vec2(T*.04, 0.)) - .5)*2.2;
  vec2 v = vec2(cos(a), sin(a));
  vec2 r = c - VC1; float l = length(r); v += vec2(-r.y, r.x)/max(l, 1e-3)*exp(-l*l/.08)*3.;
  r = c - VC2; l = length(r); v += vec2(r.y, -r.x)/max(l, 1e-3)*exp(-l*l/.03)*2.5;
  r = c - MOON; l = length(r); v += vec2(-r.y, r.x)/max(l, 1e-3)*exp(-l*l/.02)*4.;
  float hz = -.3 + .06*sin(c.x*3.5 + 1.);
  if (c.y < hz) v = vec2(1., .2*cos(c.x*4.));
  float cx = -ASP*.5 + .28; if (abs(c.x - cx) < .09 && c.y < .45) v = vec2(.15*sin(c.y*30.), 1.);
  return normalize(v);
}
  #elif defined(MODE_13)
vec3 sceneCol(vec2 uv){
  float hz = -.1;
  vec2 q = uv; float water = step(uv.y, hz);
  if (water > .5) { q.y = 2.*hz - uv.y; q.x += sin(uv.y*70. + T*1.3)*.006*min((hz - uv.y)*8., 1.); }
  vec2 c = cloud(q, 3.);
  vec3 sky = mix(tint(vec3(.96,.88,.8), vec3(1.,.7,.5), vec3(.25,.25,.4)), tint(vec3(.5,.68,.92), vec3(.55,.5,.8), vec3(.1,.12,.3)), smoothstep(hz, .5, q.y));
  vec3 cl = mix(tint(vec3(.72,.66,.88), vec3(.75,.5,.65), vec3(.2,.2,.35)), tint(vec3(1.,.94,.86), vec3(1.,.75,.55), vec3(.45,.45,.6)), c.y);
  vec3 col = mix(sky, cl, smoothstep(0., .4, c.x));
  float tb = hz + .05 + .07*fbm2(vec2(q.x*3.5, 2.), 4.) - .03;
  if (q.y < tb) col = mix(tint(vec3(.3,.46,.42), vec3(.45,.35,.35), vec3(.06,.08,.12)), tint(vec3(.55,.65,.55), vec3(.7,.5,.4), vec3(.1,.12,.18)), noise2(q*vec2(30., 10.)));
  if (water > .5) {
    col = mix(col, tint(vec3(.22,.42,.48), vec3(.35,.3,.4), vec3(.04,.06,.1)), .35);
    float dz = hz - uv.y;
    vec2 lp = vec2(uv.x*5./(dz + .15), 3./(dz + .15));
    float cl2 = smoothstep(.45, .6, noise2(lp*.25 + 11.));
    float w = worley2(lp);
    if (w < .38 && cl2 > 0.) col = mix(col, mix(vec3(.25,.45,.2), vec3(.5,.65,.3), hash12(floor(lp))), cl2);
    if (w < .1 && cl2 > .5 && hash12(floor(lp) + 3.) > .6) col = vec3(.98,.6,.7);
  }
  return col;
}
vec2 flowDir(vec2 c){
  float a = (noise2(c*3. + 4.) - .5)*1.4;
  if (c.y > -.1 && c.y < -.02) a = 1.4 + (noise2(c*9.) - .5);
  return vec2(cos(a), sin(a)*(c.y < -.1 ? .3 : 1.));
}
  #else
vec3 sceneCol(vec2 uv){
  float hz = -.22;
  vec2 c = cloud(uv, 3.5);
  vec3 sky = mix(tint(vec3(.98,.86,.6), vec3(1.,.6,.35), vec3(.15,.15,.3)), tint(vec3(.3,.48,.9), vec3(.4,.35,.75), vec3(.05,.07,.2)), smoothstep(hz, .2, uv.y));
  vec3 cl = mix(tint(vec3(.65,.55,.85), vec3(.7,.4,.6), vec3(.15,.15,.3)), tint(vec3(1.,.97,.85), vec3(1.,.75,.5), vec3(.5,.5,.65)), c.y);
  vec3 col = mix(sky, cl, smoothstep(0., .4, c.x));
  float sd = length(uv - SUN); col = mix(col, vec3(1.,.95,.7), smoothstep(.07, .05, sd)*(1. - NIGHT));
  if (uv.y < hz) {
    float rv = -.32 + .05*sin(uv.x*2. + .5);
    col = uv.y > rv ? tint(vec3(.25,.55,.65), vec3(.5,.45,.55), vec3(.05,.08,.15)) : tint(vec3(.3,.6,.2), vec3(.5,.45,.2), vec3(.04,.1,.06));
    if (uv.y > rv) col = mix(col, mix(sky, cl, .5), .25*noise2(uv*vec2(4., 40.)));
    if (uv.y < rv) col *= .8 + .3*smoothstep(rv - .3, rv, uv.y);
  }
  return col;
}
vec2 flowDir(vec2 c){ return vec2(1., 0.); }
  #endif
#endif

void main(){
  T = uTime;
  ASP = uRes.x/uRes.y;
  LPX = uRes.y/720.;
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  OCT = mix(2., 6., uDetail);
  SC = mix(6., 1.5, uScale)*FIELD;
  COV = mix(.8, .38, uCoverage);
  DUSK = smoothstep(.5, .0, abs(uLight - .22));
  NIGHT = smoothstep(.18, .0, uLight);
  SUN = vec2(mix(-.6, .45, uLight), mix(-.12, .3, smoothstep(0., .6, uLight)));
  vec3 col = vec3(0.);

#if defined(MODE_1)
  // ---- halftone comic (Ben-Day dots) ----
  vec2 c = cloud(uv, min(OCT, 4.));
  float d = c.x, sh = c.y;
  vec3 paper = vec3(.98,.95,.86), blue = tint(vec3(.1,.42,.85), vec3(.85,.2,.25), vec3(.08,.12,.4)), black = vec3(.05,.05,.08);
  float cs = mix(.008, .022, uX2);
  vec2 g = rot2(uv, .785)/cs; float r = length(fract(g) - .5); float aa = fwidth(r)*.8;
  float skyTone = mix(.18, .62, smoothstep(-.5, .5, uv.y));
  float dotSky = smoothstep(sqrt(skyTone)*.56 + aa, sqrt(skyTone)*.56 - aa, r);
  vec3 sky = mix(paper, blue, dotSky);
  if (NIGHT > .5) sky = mix(blue, black, dotSky*.6);
  // sun: yellow disc with red dots, black outline
  float sdist = length(uv - SUN) - .09;
  vec2 g2 = rot2(uv, .26)/(cs*.8); float r2 = length(fract(g2) - .5);
  vec3 sunC = mix(vec3(1.,.85,.1), vec3(.92,.15,.12), smoothstep(.2 + aa, .2 - aa, r2)*smoothstep(-.09, 0., sdist));
  sky = mix(sky, sunC, step(sdist, 0.)*(1. - NIGHT));
  sky = mix(sky, black, isoLine(sdist, 0., 3.*LPX)*(1. - NIGHT));
  float fw = max(fwidth(d), 1e-4);
  float body = smoothstep(.12 - fw, .12 + fw, d);
  float shTone = clamp((.6 - sh)*1.2, 0., .75);
  vec2 g3 = rot2(uv, -.26)/(cs*.75); float r3 = length(fract(g3) - .5);
  float dotCl = smoothstep(sqrt(shTone)*.55 + aa, sqrt(shTone)*.55 - aa, r3);
  vec3 cl = mix(NIGHT > .5 ? vec3(.7,.75,.9) : paper, blue*.8, dotCl);
  col = mix(sky, cl, body);
  float wl = mix(1.5, 6., uX1)*LPX;
  col = mix(col, black, isoLine(d, .12, wl));
  col = mix(col, black, isoLine(sh, .42, wl*.45)*body*smoothstep(.15, .3, d));

#elif defined(MODE_2)
  // ---- 1-bit Bayer dither ----
  float px = max(1., floor(mix(1.5, 5., uX2)*LPX + .5));
  vec2 cell = floor(gl_FragCoord.xy/px);
  vec2 q = ((cell + .5)*px - .5*uRes)/uRes.y;
  float hz = -.3;
  float tone;
  if (q.y > hz) {
    vec2 c = cloud(q, OCT);
    float skyT = mix(.62, .22, smoothstep(hz, .5, q.y))*mix(.35, 1., smoothstep(0., .4, uLight));
    float sd = length(q - SUN);
    skyT += smoothstep(.07, .06, sd)*.8 + exp(-sd*8.)*.25;
    float clT = mix(.3, .95, c.y)*mix(.35, 1., smoothstep(0., .4, uLight));
    float edge = smoothstep(.0, .06, c.x)*smoothstep(.2, .06, c.x);
    tone = mix(skyT, clT, smoothstep(.0, .2, c.x)) - edge*.25*uX1*2.;
  } else {
    // the sea, reflecting light in streaks
    float z = 1./(hz - q.y + .02);
    float wv = noise2(vec2(q.x*z*2., z*.6 + T*.4)) + .5*noise2(vec2(q.x*z*5., z*1.5 - T*.6));
    tone = (.1 + .25*smoothstep(.6, 1.3, wv) + .45*exp(-abs(q.x - SUN.x)*4.)*smoothstep(.7, 1.2, wv))*mix(.4, 1., smoothstep(0., .4, uLight));
  }
  float b = bayer8(cell);
  col = tone > b ? C1 : C0;

#elif defined(MODE_3)
  // ---- ukiyo-e woodblock ----
  vec3 paper = vec3(.94,.88,.75);
  float bk = smoothstep(.1, .42, uv.y + .03*noise2(uv*4.));
  vec3 sky = mix(paper, tint(vec3(.12,.24,.46), vec3(.25,.2,.42), vec3(.06,.1,.22)), bk);
  sky = mix(sky, tint(vec3(.95,.72,.55), vec3(.93,.45,.3), vec3(.2,.2,.32)), smoothstep(-.05, -.42, uv.y)*.75);
  col = sky;
  vec2 c = cloud(uv, 3.);
  float fw = max(fwidth(c.x), 1e-4);
  float cm = smoothstep(-.2, .05, uv.y);
  float body = smoothstep(.1 - fw, .1 + fw, c.x)*cm;
  vec3 cream = tint(vec3(.98,.95,.86), vec3(1.,.85,.7), vec3(.55,.58,.68));
  vec3 cl = mix(cream*vec3(.86,.86,.86), cream, step(.45, c.y));
  col = mix(col, cl, body);
  vec3 indigo = vec3(.12,.16,.3);
  col = mix(col, indigo, isoLine(c.x, .1, mix(.8, 3., uX1)*LPX)*cm*.85);
  float wx = windDir().x;
  // Fuji
  float fx = .32*ASP;
  float h = min(.02, .06 - pow(abs(uv.x - fx), 1.1)*.95);
  float fd = uv.y - h;
  vec3 mtn = mix(tint(vec3(.16,.26,.48), vec3(.6,.2,.12), vec3(.08,.1,.2)), tint(vec3(.35,.48,.62), vec3(.8,.4,.25), vec3(.12,.14,.26)), smoothstep(.02, -.3, uv.y));
  float snow = step(h - .065 - .025*abs(sin((uv.x - fx)*55.))*noise2(vec2(uv.x*30., 1.)), uv.y);
  mtn = mix(mtn, vec3(.97,.95,.9), snow);
  // kasumi bands
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float y = .0 - fi*.085 + .03*hash11(fi + 1.);
    float len = .22 + .28*hash11(fi*3.7 + 2.);
    float range = ASP + 2.*len + .4;
    float x = mod(hash11(fi*7.1)*range + T*.012*(1. + fi*.35)*(wx >= 0. ? 1. : -1.), range) - range*.5;
    float th = .022 + .01*hash11(fi + 9.);
    float sd = length(max(abs(uv - vec2(x, y)) - vec2(len, 0.), 0.)) - th;
    vec3 bc = i % 2 == 0 ? tint(vec3(.92,.66,.55), vec3(.95,.55,.4), vec3(.35,.3,.4)) : tint(vec3(.96,.9,.76), vec3(1.,.8,.6), vec3(.4,.42,.5));
    if (i == 2) { col = mix(col, mtn, step(fd, 0.)); col = mix(col, indigo, isoLine(fd, 0., 1.5*LPX)*.8); }
    col = mix(col, bc, step(sd, 0.));
    col = mix(col, vec3(.45,.25,.2), isoLine(sd, 0., 1.4*LPX));
  }
  if (uv.y < -.42) col = mix(col, vec3(.2,.35,.5), smoothstep(-.42, -.5, uv.y));
  col *= .9 + .13*paperTex(uv)*uX3*2.;

#elif defined(MODE_4)
  // ---- sumi-e ink wash ----
  vec3 paper = vec3(.95,.93,.87);
  float ink = .28*smoothstep(-.15, .5, uv.y)*(.55 + .7*fbm2(uv*2.2 + 3., 3.));
  vec2 uw = uv + (vec2(fbm2(uv*7., 3.), fbm2(uv*7. + 5., 3.)) - .5)*.03;
  vec2 c = cloud(uw, OCT);
  ink *= 1. - smoothstep(0., .25, c.x);
  float ring = smoothstep(.0, .05, c.x)*smoothstep(.22, .06, c.x);
  ink += .22*ring*(.6 + .8*noise2(uv*40.)) + c.x*(1. - c.y)*.3;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float rd = 1. - abs(fbm2(vec2(uv.x*(1.2 + fk*.7) + fk*7. + uSeed*3., fk*3.), 5.)*2. - 1.);
    float ridge = -.12 - fk*.1 + .22*rd;
    float m = smoothstep(ridge + .004, ridge - .004, uv.y);
    float li = (.3 + .25*fk)*smoothstep(ridge - .22 + fk*.03, ridge, uv.y)*(.8 + .4*noise2(uv*vec2(60., 8.)));
    li += .25*isoLine(uv.y - ridge, 0., 2.*LPX)*(.5 + .5*noise2(uv*50.));
    ink = mix(ink, li, m);
  }
  ink *= .85 + .3*noise2(uv*300.);
  col = paper*(1. - clamp(ink, 0., 1.)*vec3(.9,.9,.86));
  // red seal
  vec2 sp = uv - vec2(ASP*.5 - .1, -.36);
  if (max(abs(sp.x), abs(sp.y)) < .035) {
    vec2 gi = floor((sp + .035)/.07*4.);
    float gly = step(.45, hash12(gi + floor(uSeed*10.)));
    float red = step(.25, noise2(sp*300.))*(1. - gly*step(max(abs(sp.x), abs(sp.y)), .028));
    col = mix(col, vec3(.72,.12,.08), red*.9);
  }
  col *= .93 + .1*paperTex(uv)*uX3*2.;

#elif defined(MODE_5)
  // ---- watercolour ----
  vec3 paper = vec3(.99,.97,.93);
  vec2 uw = uv + (vec2(fbm2(uv*5., 3.), fbm2(uv*5. + 7.3, 3.)) - .5)*.035;
  vec2 c = cloud(uw, OCT);
  float gran = noise2(uv*260.)*.6 + noise2(uv*60.)*.4;
  float blotch = .65 + .7*fbm2(uv*2.5 + 9., 3.);
  float skyAmt = mix(.3, .95, smoothstep(-.4, .5, uv.y))*blotch;
  float edge = smoothstep(.0, .04, c.x)*smoothstep(.16, .04, c.x);
  float open = 1. - smoothstep(0., .1, c.x);
  float a1 = skyAmt*open + edge*.7*mix(.6, 1.6, uX1);
  float a2 = c.x*(1. - c.y)*.9*(.7 + .5*fbm2(uv*4., 3.));
  float e2 = isoLine(c.y, .5, 2.*LPX)*smoothstep(.1, .3, c.x)*.25;
  float a3 = smoothstep(.1, -.45, uv.y)*.35*(.6 + .6*fbm2(uv*3. + 2., 3.))*open;
  vec3 absSky = tint(vec3(.95,.45,.12), vec3(.5,.55,.2), vec3(1.4,1.,.5));
  vec3 absSh = tint(vec3(.4,.42,.22), vec3(.25,.5,.35), vec3(.7,.6,.4));
  vec3 absWarm = tint(vec3(.02,.15,.45), vec3(.0,.3,.7), vec3(.6,.6,.4));
  float g = mix(1., .6 + .8*gran, uX3);
  vec3 od = (a1*absSky + (a2 + e2)*absSh + a3*absWarm)*g;
  col = paper*exp(-od*1.6);
  float sd = length(uv - SUN);
  col = mix(col, paper*vec3(1.,.95,.75), smoothstep(.08, .06, sd)*(1. - NIGHT)*open);
  col *= .96 + .04*paperTex(uv);

#elif defined(MODE_6)
  // ---- pointillism ----
  float cs = mix(.009, .024, uX2);
  vec3 bg = vec3(.93,.9,.82);
  float best = -1.; vec2 bc = uv; float bid = 0.; float brr = 1.;
  for (int L = 0; L < 2; L++) {
    vec2 g = uv/cs + float(L)*.5; vec2 gi = floor(g);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
      vec2 id = gi + vec2(i,j) + float(L)*37.;
      vec2 o = hash22(id);
      vec2 ctr = (gi + vec2(i,j) + .15 + .7*o - float(L)*.5)*cs;
      float rr = length(uv - ctr)/(cs*(.42 + .15*hash12(id + 5.)));
      float pr = hash12(id + 9.);
      if (rr < 1. && pr > best) { best = pr; bc = ctr; bid = hash12(id + 1.7); brr = rr; }
    }
  }
  col = bg;
  if (best >= 0.) {
    vec3 base = sceneCol(bc);
    vec3 v = base;
    if (bid < .3) v = base*vec3(1.15, 1., .85);
    else if (bid < .55) v = base*vec3(.85, .95, 1.2);
    else if (bid < .63) v = mix(base, vec3(1.) - base*.8, .35);
    else if (bid < .72) v = mix(base, vec3(1.,.95,.8), .4);
    v = clamp(v*(.92 + .16*hash11(bid*91.)), 0., 1.);
    col = mix(v, bg, smoothstep(.75, 1., brr));
  }
  col *= .95 + .05*paperTex(uv);

#elif defined(MODE_7)
  // ---- stained glass ----
  float cs = mix(.05, .12, uX2);
  vec3 vo = voronoi(uv/cs);
  vec2 ctr = uv + vo.yz*cs;
  float edgeD = vo.x*cs;
  float dpx = dens(toField(uv), min(OCT, 3.5));
  vec2 cc = cloud(ctr, min(OCT, 3.5));
  float id = hash12(floor(uv/cs + vo.yz) + 3.);
  vec3 skyA = tint(vec3(.06,.18,.55), vec3(.45,.1,.35), vec3(.03,.05,.2));
  vec3 skyB = tint(vec3(.2,.45,.85), vec3(.95,.45,.2), vec3(.08,.14,.4));
  vec3 glass = mix(skyB, skyA, smoothstep(-.3, .5, ctr.y) + (id - .5)*.4);
  vec3 cl = mix(tint(vec3(.55,.62,.85), vec3(.7,.4,.6), vec3(.2,.25,.45)), tint(vec3(.95,.96,.9), vec3(1.,.8,.45), vec3(.6,.65,.8)), step(.45, cc.y + (id - .5)*.2));
  float body = step(.1, dpx);
  glass = mix(glass, cl, body);
  float sd = length(ctr - SUN);
  glass = mix(glass, mix(vec3(1.,.85,.2), vec3(1.,.5,.1), step(.08, sd)), smoothstep(.16, .13, sd)*(1. - NIGHT));
  glass *= .85 + .3*fbm2(uv*vec2(30., 8.) + id*10., 3.);
  glass *= 1. + .35*smoothstep(.0, 1., 1. - length(vo.yz))*(1. + uX4);
  float lw = mix(.003, .01, uX1);
  float lead = max(1. - smoothstep(lw, lw + 1.5/uRes.y, edgeD), isoLine(dpx, .1, mix(2., 5., uX1)*LPX));
  vec3 leadC = vec3(.06,.06,.07) + vec3(.08)*smoothstep(lw, 0., edgeD)*.5;
  col = mix(glass, leadC, lead);
  // three lancet windows in a stone wall
  float a = min(min(arch(uv, 0., .28, .05, -.44), arch(uv, -.62, .2, -.02, -.44)), arch(uv, .62, .2, -.02, -.44));
  vec3 stone = vec3(.16,.14,.13)*(.6 + .5*fbm2(uv*12., 4.))*(.7 + .3*step(.5, fract(uv.y*12. + step(.5, fract(uv.x*4. + floor(uv.y*12.)*.5))*.0)));
  stone += glass*.12*exp(-max(a, 0.)*12.);
  col = mix(col, stone, smoothstep(-.002, .002, a));
  col = mix(col, vec3(.03), isoLine(a, 0., 4.*LPX));

#elif defined(MODE_8)
  // ---- Moebius line art ----
  vec2 c = cloud(uv, min(OCT, 3.5));
  float d = c.x, sh = c.y;
  vec3 sky = mix(tint(vec3(1.,.88,.66), vec3(1.,.62,.45), vec3(.25,.25,.4)), tint(vec3(.55,.82,.86), vec3(.55,.5,.75), vec3(.08,.12,.25)), smoothstep(-.3, .5, uv.y));
  float body = smoothstep(.1 - .5*fwidth(d), .1 + .5*fwidth(d), d);
  vec3 lit = tint(vec3(1.,.97,.88), vec3(1.,.82,.65), vec3(.45,.48,.6));
  vec3 shd = tint(vec3(.78,.82,.9), vec3(.8,.6,.7), vec3(.25,.28,.4));
  float shadow = 1. - step(.45, sh);
  vec3 cl = mix(lit, shd, shadow);
  col = mix(sky, cl, body);
  float wl = mix(.8, 3., uX1)*LPX;
  float hat = contours(uv.x*.7 + uv.y*.7, 120.*mix(.6, 1.5, uX2), wl*.6)*shadow;
  hat = max(hat, contours(uv.x*.7 - uv.y*.7, 120.*mix(.6, 1.5, uX2), wl*.6)*step(sh, .18));
  hat = max(hat, contours(d, 6., wl*.7)*smoothstep(.55, .3, sh));
  col = mix(col, vec3(.1,.08,.1), hat*body*.85);
  col = mix(col, vec3(.08,.06,.08), isoLine(d, .1, wl*1.6));
  col = mix(col, vec3(.08,.06,.08), isoLine(sh, .45, wl*.8)*body*smoothstep(.12, .2, d));
  // desert with mesas
  float hz = -.3;
  float mx = noise2(vec2(uv.x*2.4 + 3.1, .5));
  float h = hz + (.06 + .14*noise2(vec2(floor(uv.x*2.4 + 3.1), 9.)))*smoothstep(.52, .58, mx);
  float md = uv.y - h;
  if (md < 0.) {
    float sideShade = step(.5, fract((uv.x*2.4 + 3.1)));
    col = uv.y > hz ? mix(vec3(.88,.5,.38), vec3(.7,.38,.32), sideShade) : vec3(.95,.8,.58);
    if (uv.y > hz) col = mix(col, vec3(.15,.08,.08), contours(uv.x*.7 - uv.y*.7, 140., wl*.6)*sideShade*.8);
    else col = mix(col, vec3(.4,.25,.2), contours(log(hz - uv.y + .01), 14., wl*.5)*.5);
  }
  col = mix(col, vec3(.08,.06,.08), max(isoLine(md, 0., wl*1.6), isoLine(uv.y, hz, wl)*step(md, 0.)));

#elif defined(MODE_9)
  // ---- thermal infrared camera ----
  vec2 c = cloud(uv, OCT);
  float tp = .1 + .14*smoothstep(.5, -.4, uv.y);
  tp += c.x*(.3 + .3*(1. - c.y)) + c.x*c.x*.15;
  // skyline, warm buildings with hot windows
  float bx = floor(uv.x*9. + 50.);
  float bh = -.33 + .16*hash11(bx*1.7) + .06*step(.8, hash11(bx*3.3));
  if (uv.y < bh) {
    tp = .45 + .1*hash11(bx*5.1) - .1*smoothstep(bh - .2, bh, uv.y);
    vec2 wg = vec2(uv.x*9.*5., uv.y*55.);
    float win = step(.25, fract(wg.x))*step(.35, fract(wg.y))*step(.45, hash12(floor(wg) + bx));
    tp += win*.3*(.8 + .2*sin(uClock*.5 + hash12(floor(wg))*30.));
  }
  if (uv.y < -.42) tp = .55 + .1*noise2(uv*20.);
  tp += (hash12(gl_FragCoord.xy + floor(uClock*30.)*17.) - .5)*.04*(.5 + uX3) + (hash11(floor(gl_FragCoord.x)) - .5)*.012;
  tp = clamp((tp - .1)*mix(.7, 1.6, uX1) + .05, 0., 1.);
  // ironbow / white-hot palette
  vec3 ib = mix(vec3(0.,0.,.04), vec3(.28,0.,.5), smoothstep(0., .2, tp));
  ib = mix(ib, vec3(.78,.05,.45), smoothstep(.2, .42, tp));
  ib = mix(ib, vec3(.97,.38,.05), smoothstep(.42, .62, tp));
  ib = mix(ib, vec3(1.,.78,.12), smoothstep(.62, .82, tp));
  ib = mix(ib, vec3(1.,1.,.88), smoothstep(.82, 1., tp));
  col = mix(ib, vec3(tp), step(.75, uX4));
  col *= .94 + .06*sin(gl_FragCoord.y*3.1416*.5);
  // HUD: reticle, palette bar, corner brackets
  vec2 m = uMouse.w > .5 ? (uMouse.xy - .5)*vec2(ASP, 1.) : vec2(0.);
  vec2 r = abs(uv - m);
  float hud = step(r.x, 1.*LPX/uRes.y*1.5)*step(.012, r.y)*step(r.y, .045) + step(r.y, 1.*LPX/uRes.y*1.5)*step(.012, r.x)*step(r.x, .045);
  float bx2 = ASP*.5 - .05;
  vec2 bp = uv - vec2(bx2, 0.);
  if (abs(bp.x) < .012 && abs(bp.y) < .3) {
    float tb = .5 + bp.y/.6;
    vec3 bb = mix(vec3(0.,0.,.04), vec3(.28,0.,.5), smoothstep(0., .2, tb));
    bb = mix(bb, vec3(.78,.05,.45), smoothstep(.2, .42, tb)); bb = mix(bb, vec3(.97,.38,.05), smoothstep(.42, .62, tb));
    bb = mix(bb, vec3(1.,.78,.12), smoothstep(.62, .82, tb)); bb = mix(bb, vec3(1.,1.,.88), smoothstep(.82, 1., tb));
    col = step(.75, uX4) > .5 ? vec3(tb) : bb;
  }
  // spot-temperature marker on the bar
  vec2 cm = cloud(m, 3.);
  float spot = clamp((.1 + .14*smoothstep(.5, -.4, m.y) + cm.x*(.3 + .3*(1. - cm.y)) + cm.x*cm.x*.15 - .1)*mix(.7, 1.6, uX1) + .05, 0., 1.);
  float mk = step(abs(uv.y - (spot - .5)*.6), .004)*step(abs(uv.x - bx2 + .025), .01);
  hud += mk;
  float fr = .06;
  vec2 cq = abs(uv) - vec2(ASP*.5 - fr, .5 - fr);
  hud += step(abs(cq.x), 1.5/uRes.y)*step(0., cq.y)*step(cq.y, .05) + step(abs(cq.y), 1.5/uRes.y)*step(0., cq.x)*step(cq.x, .05);
  col = mix(col, vec3(1.), clamp(hud, 0., 1.)*.9);

#elif defined(MODE_10)
  // ---- risograph, two inks with misregistration ----
  vec3 paper = vec3(.97,.95,.9);
  vec2 mis = (hash22(vec2(floor(T*1.3), 3.)) - .5)*.014*uX4*2. + vec2(.003, -.002);
  vec2 c = cloud(uv, min(OCT, 4.));
  float fw = max(fwidth(c.x), 1e-4);
  float body = smoothstep(.1 - fw, .1 + fw, c.x);
  float aA = (1. - body)*mix(.25, .85, smoothstep(-.5, .5, uv.y)) + body*(1. - c.y)*.6;
  vec2 ub = uv + mis;
  float dB = dens(toField(ub), min(OCT, 4.));
  float bodyB = smoothstep(.08, .14, dB);
  float sd = length(ub - SUN);
  float aB = smoothstep(.13, .12, sd) + smoothstep(-.05, -.5, ub.y)*.7*(1. - bodyB) + bodyB*.28*smoothstep(.3, -.3, ub.y + dB*.2);
  aB *= 1. - .5*bodyB*smoothstep(.5, 1., dB);
  float gA = hash12(floor(gl_FragCoord.xy/max(1., LPX*1.2)));
  float gB = hash12(floor(gl_FragCoord.xy/max(1., LPX*1.2)) + 71.);
  float gs = mix(.05, .3, uX3);
  float inkA = smoothstep(gA - gs, gA + gs, aA*(.9 + .2*noise2(uv*vec2(3., 80.))));
  float inkB = smoothstep(gB - gs, gB + gs, aB*(.9 + .2*noise2(uv*vec2(80., 3.))));
  vec3 cA = RISO_A, cB = RISO_B;
  col = paper*mix(vec3(1.), cA, inkA)*mix(vec3(1.), cB, inkB);

#elif defined(MODE_11)
  // ---- vaporwave ----
  float hz = -.12;
  vec3 sky = mix(vec3(1.,.55,.35), vec3(.92,.22,.62), smoothstep(hz, .15, uv.y));
  sky = mix(sky, vec3(.16,.04,.35), smoothstep(.1, .5, uv.y));
  sky += step(.996, hash12(floor(gl_FragCoord.xy/2.)))*smoothstep(.15, .45, uv.y)*.8;
  vec2 sc = vec2(0., .06); float sr = .27;
  float sdist = length(uv - sc);
  vec3 sunC = mix(vec3(1.,.25,.55), vec3(1.,.92,.3), smoothstep(sc.y - sr, sc.y + sr, uv.y));
  float yy = (sc.y - uv.y)/sr;
  float slit = yy > -.1 ? step(fract(yy*6. + T*.25), mix(.08, .55, clamp((yy + .1)/1.1, 0., 1.))) : 0.;
  col = mix(sky, sunC, step(sdist, sr)*(1. - slit));
  col += vec3(1.,.4,.6)*exp(-max(sdist - sr, 0.)*9.)*.35;
  if (uv.y > hz) {
    vec2 c = cloud(uv + vec2(0., -.05), min(OCT, 4.));
    float d = c.x;
    float fw = max(fwidth(d), 1e-4);
    float body = smoothstep(.1 - fw, .1 + fw, d)*smoothstep(hz, hz + .08, uv.y);
    float e = c.y*.65 + d*.35 + .12*sin(uv.y*18. + d*4.);
    vec3 chrome = e > .5 ? mix(vec3(.15,.45,1.), vec3(.95,.98,1.), smoothstep(.5, .95, e)) : mix(vec3(.12,.02,.25), vec3(1.,.45,.65), smoothstep(.05, .5, e));
    chrome = mix(chrome, vec3(.05,.0,.15), isoLine(e, .5, 2.5*LPX));
    col = mix(col, chrome, body);
    col = mix(col, vec3(1.,.9,1.), isoLine(d, .1, 1.5*LPX)*smoothstep(hz, hz + .08, uv.y));
  } else {
    float dz = hz - uv.y;
    float z = .25/dz;
    vec2 gp = vec2(uv.x*z, z + T*mix(.5, 2.5, uX4));
    float gl = max(contours(gp.x, 2., 1.6*LPX), contours(gp.y, 1.5, 1.6*LPX));
    vec3 floorC = mix(vec3(.12,.0,.22), vec3(.35,.05,.4), smoothstep(.3, 0., dz));
    vec3 neon = mix(vec3(.2,.9,1.), vec3(1.,.2,.9), smoothstep(.0, .35, dz));
    col = floorC + neon*gl*smoothstep(0., .02, dz);
    col += vec3(1.,.4,.8)*exp(-dz*25.)*.6;
  }
  col *= .95 + .05*sin(gl_FragCoord.y*1.5);

#elif defined(MODE_12) || defined(MODE_13)
  // ---- brushstrokes: Van Gogh (long, swirling) / Monet (short dabs) ----
  #if defined(MODE_12)
  VC1 = vec2(-.12, .14); VC2 = vec2(.35, .05); MOON = vec2(ASP*.5 - .3, .3);
  float cs = mix(.01, .024, uX2); float halfL = .85, halfW = .28, jit = .15;
  #else
  float cs = mix(.016, .036, uX2); float halfL = .55, halfW = .38, jit = .35;
  #endif
  float best = -1.; vec2 bc = uv; vec2 bl = vec2(0.); float bid = 0.;
  for (int L = 0; L < 2; L++) {
    vec2 g = uv/cs + float(L)*.5; vec2 gi = floor(g);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
      vec2 cid = gi + vec2(i,j);
      vec2 id = cid + float(L)*53.;
      vec2 ctr = (cid + .2 + .6*hash22(id) - float(L)*.5)*cs;
      vec2 dir = flowDir(ctr);
      float ja = (hash12(id + 2.) - .5)*jit; dir = rot2(dir, ja);
      vec2 lp = uv - ctr;
      vec2 st = vec2(dot(lp, dir), dot(lp, vec2(-dir.y, dir.x)))/cs;
      float hl = halfL*(.75 + .5*hash12(id + 4.));
      float w = halfW*(1. - .5*smoothstep(hl*.4, hl + halfW, abs(st.x)));
      float sdf = length(vec2(max(abs(st.x) - hl, 0.), st.y)) - w;
      float pr = hash12(id + 9.);
      if (sdf < 0. && pr > best) { best = pr; bc = ctr; bl = vec2(st.y/max(w, .01), sdf); bid = hash12(id + 1.); }
    }
  }
  vec3 base = sceneCol(bc);
  if (best < 0.) col = base*.75;
  else {
    vec3 v = base;
  #if defined(MODE_13)
    v += (hash22(vec2(bid*37., 1.)).xyx - .5)*vec3(.08,.06,.09);
  #else
    v *= .88 + .24*bid;
  #endif
    float bristle = .9 + .1*sin(bl.x*mix(6., 14., hash11(bid*13.)) + bid*20.);
    float ridge = 1. + mix(.08, .25, uX3)*(-bl.x)*(1. - bl.x*bl.x);
    col = v*bristle*ridge;
    col *= 1. - .25*smoothstep(-.12, 0., bl.y)*uX1*2.;
  }
  col = clamp(col, 0., 1.);

#elif defined(MODE_14)
  // ---- Magritte: crisp clouds by day over a street at night ----
  vec2 c = cloud(uv, min(OCT, 3.2));
  float fw = max(fwidth(c.x), 1e-4);
  float body = smoothstep(.06 - fw*1.2, .06 + fw*1.2, c.x);
  vec3 sky = mix(vec3(.66,.82,.95), vec3(.22,.47,.84), smoothstep(-.3, .5, uv.y));
  vec3 cl = mix(vec3(.62,.69,.83), vec3(1.,.99,.96), smoothstep(.15, .85, c.y))*(.94 + .06*smoothstep(.1, .8, c.x));
  col = mix(sky, cl, body);
  float gnd = mix(-.42, -.1, uX4);
  // trees as round crowns along a line
  float tx = uv.x*7.; float ti = floor(tx);
  float th = 0.;
  for (int k = -1; k <= 1; k++) { float fi = ti + float(k); float cx = fi + .5 + (hash11(fi*1.3) - .5)*.6; float rr = .45 + .5*hash11(fi*2.1);
    float yy = (1. - pow(clamp(abs(tx - cx)/rr, 0., 1.), 2.)); th = max(th, sqrt(max(yy, 0.))*rr*(.7 + .6*hash11(fi*5.3))/7.); }
  float treeTop = gnd + .06 + th + .006*noise2(uv*90.);
  vec3 night = vec3(.015,.025,.03);
  vec2 lamp = vec2(-.05, gnd + .02);
  float lg = exp(-length(uv - lamp)*14.);
  if (uv.y < treeTop) col = night + vec3(.25,.18,.05)*lg*.6;
  // house front with lit windows
  float hx0 = .12, hx1 = .62, hy1 = gnd + .1;
  if (uv.x > hx0 && uv.x < hx1 && uv.y < hy1) {
    col = vec3(.06,.065,.08) + vec3(.5,.35,.15)*exp(-length(uv - lamp)*7.)*.35;
    vec2 wq = vec2((uv.x - hx0)/(hx1 - hx0)*4., (uv.y - (gnd - .2))/(hy1 - gnd + .2)*3.);
    vec2 wf = fract(wq); vec2 wi = floor(wq);
    float win = step(.3, wf.x)*step(wf.x, .7)*step(.25, wf.y)*step(wf.y, .75)*step(.35, hash12(wi + 4.));
    col = mix(col, vec3(1.,.78,.4), win);
  }
  float pole = step(abs(uv.x - lamp.x), .0035)*step(uv.y, lamp.y);
  col = mix(col, vec3(.01), pole);
  col += vec3(1.,.85,.5)*(smoothstep(.012, .008, length(uv - lamp)) + lg*.5)*step(uv.y, treeTop + .03);
  col = mix(col, vec3(.04,.05,.06), step(uv.y, gnd - .12));

#elif defined(MODE_15)
  // ---- op-art contour stripes ----
  vec2 p = toField(uv);
  float f = field(p, min(OCT, 4.));
  float d = clamp((f - COV)*SHARP, 0., 1.);
  float freq = mix(14., 60., uX2);
  float v = uv.y*freq + smoothstep(0., 1., d)*mix(3., 12., uX1) + (f - .5)*mix(2., 8., uX1);
  float s = sin(v*TAU);
  float aa = fwidth(s)*.9;
  float stripe = smoothstep(-aa, aa, s);
  vec3 dark = OP_A, lite = OP_B;
  float band = step(.5, fract(v*.5 + .25));
  vec3 acc = mix(OP_C, OP_D, step(.5, fract(floor(v)*.37)));
  lite = mix(lite, acc, uX4*smoothstep(.05, .3, d)*band);
  col = mix(dark, lite, stripe);

#else
  // ---- MODE 0: anime / cel shading with ink outlines ----
  vec2 c = cloud(uv, min(OCT, 4.5));
  float d = c.x, sh = c.y;
  vec3 top = tint(vec3(.08,.32,.82), vec3(.22,.22,.58), vec3(.02,.04,.13));
  vec3 bot = tint(vec3(.58,.85,1.), vec3(1.,.62,.45), vec3(.07,.11,.25));
  vec3 sky = mix(bot, top, smoothstep(-.55, .5, uv.y));
  float sd = length(uv - SUN);
  sky += tint(vec3(1.,.95,.8), vec3(1.,.7,.4), vec3(.8,.85,1.))*(smoothstep(.055, .05, sd) + exp(-sd*7.)*.3);
  sky += step(.997, hash12(floor(gl_FragCoord.xy/1.5)))*NIGHT;
  float fw = max(fwidth(d), 1e-4);
  float body = smoothstep(.1 - fw, .1 + fw, d);
  vec3 hi = tint(vec3(1.), vec3(1.,.88,.72), vec3(.62,.68,.85));
  vec3 mid = tint(vec3(.83,.89,1.), vec3(.98,.66,.6), vec3(.32,.36,.58));
  vec3 lo = tint(vec3(.58,.66,.9), vec3(.58,.4,.62), vec3(.15,.17,.34));
  float fs2 = max(fwidth(sh), 1e-4);
  vec3 cel = mix(lo, mid, smoothstep(.3 - fs2, .3 + fs2, sh));
  cel = mix(cel, hi, smoothstep(.65 - fs2, .65 + fs2, sh));
  float rim = smoothstep(.1, .14, d)*(1. - smoothstep(.14, .2, d))*step(.6, sh);
  cel = mix(cel, hi*1.05, rim*.0);
  col = mix(sky, cel, body);
  vec3 inkC = tint(vec3(.15,.22,.45), vec3(.35,.15,.3), vec3(.02,.03,.08));
  col = mix(col, inkC, isoLine(d, .1, mix(.6, 3.5, uX1)*LPX)*.9);
  col = mix(col, inkC, isoLine(sh, .3, mix(.3, 1.5, uX1)*LPX)*body*.5);
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'stylize', name: 'Art Styles', fs, res: 0.75,
  defaults: {
    MODE: 0, SHARP: 3.2, FIELD: 1.0,
    C0: [0.17, 0.16, 0.13], C1: [0.9, 0.88, 0.76],
    RISO_A: [0.0, 0.47, 0.75], RISO_B: [1.0, 0.32, 0.55],
    OP_A: [0.04, 0.04, 0.05], OP_B: [0.96, 0.95, 0.92], OP_C: [0.9, 0.2, 0.2], OP_D: [0.15, 0.35, 0.85],
  },
  params: [
    { id: 'x1', label: 'Line weight', value: 0.5 },
    { id: 'x2', label: 'Mark size', value: 0.5 },
    { id: 'x3', label: 'Texture', value: 0.5 },
    { id: 'x4', label: 'Accent', value: 0.5 },
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'stylize-' + id, name, desc, opts, params, tags: ['art', 'stylized', '2d', ...tags] });
export const scenes = [
  d('anime', 'Anime Summer Sky', 'Cel-shaded cumulus with crisp ink outlines, like a summer anime backdrop.', { MODE: 0 }, { coverage: 0.5, scale: 0.8, light: 0.85, x1: 0.35 }, ['cartoon']),
  d('halftone', 'Ben-Day Clouds', 'Pop-art comic clouds in halftone dots with a bold black outline.', { MODE: 1 }, { coverage: 0.45, scale: 0.6, light: 0.85, x2: 0.5 }, ['retro', 'cartoon']),
  d('dither', 'One-Bit Dither', 'Bayer-dithered sky and sea, like a classic one-bit adventure game.', { MODE: 2 }, { coverage: 0.5, light: 0.7, x2: 0.5 }, ['retro', 'pixel']),
  d('ukiyoe', 'Woodblock Fuji', 'Ukiyo-e print: bokashi sky, drifting kasumi bands and Mount Fuji.', { MODE: 3 }, { coverage: 0.45, scale: 0.7, light: 0.7 }, ['mountains']),
  d('sumie', 'Sumi-e Mountains', 'Ink-wash clouds with wet edges over misty ridges, signed with a red seal.', { MODE: 4 }, { coverage: 0.45, scale: 0.5, light: 0.8 }, ['mountains', 'moody']),
  d('watercolor', 'Wet Watercolour', 'Bleeding pigment washes with pooled edges and grainy paper.', { MODE: 5 }, { coverage: 0.5, scale: 0.5, light: 0.75, x3: 0.7 }, ['pastel']),
  d('seurat', 'Pointillist Afternoon', 'Seurat-style dots of broken colour over a river bank.', { MODE: 6 }, { coverage: 0.62, scale: 0.7, light: 0.65, x2: 0.4 }, []),
  d('glass', 'Cathedral Glass', 'Leaded stained-glass lancets with clouds drifting across the panes.', { MODE: 7 }, { coverage: 0.5, scale: 0.5, light: 0.75, x2: 0.4 }, ['fantasy']),
  d('moebius', 'Desert Line Art', 'Clean ink outlines and hatching over pastel mesas, in a bande-dessinée mood.', { MODE: 8 }, { coverage: 0.45, scale: 0.55, light: 0.7 }, ['cartoon']),
  d('thermal', 'Thermal Camera', 'Infrared ironbow view of clouds over a warm city skyline.', { MODE: 9 }, { coverage: 0.55, scale: 0.5, light: 0.5, x3: 0.5 }, ['night', 'abstract']),
  d('riso', 'Risograph Print', 'Two-ink riso print, blue and fluorescent pink, slightly misregistered.', { MODE: 10 }, { coverage: 0.5, scale: 0.55, light: 0.7, x4: 0.5 }, ['retro']),
  d('vaporwave', 'Vaporwave Sunset', 'Chrome clouds over a striped sun and an endless neon grid.', { MODE: 11 }, { coverage: 0.4, scale: 0.6, light: 0.3, x4: 0.4 }, ['retro', 'sunset']),
  d('vangogh', 'Swirling Night', 'Long swirling brushstrokes, a ringed moon and a cypress like a flame.', { MODE: 12 }, { coverage: 0.5, scale: 0.6, light: 0.08, x2: 0.45 }, ['night']),
  d('monet', 'Lily Pond Impression', 'Soft broken-colour dabs: clouds reflected in a pond of water lilies.', { MODE: 13 }, { coverage: 0.6, scale: 0.7, light: 0.6, x2: 0.4 }, ['pastel', 'sea']),
  d('magritte', 'Empire of Light', 'Crisp daylight clouds above a lamplit street at night.', { MODE: 14 }, { coverage: 0.38, scale: 0.55, light: 0.9, x4: 0.4 }, ['fantasy', 'night']),
  d('opart', 'Op-Art Stripes', 'Black and white stripes bent by passing clouds.', { MODE: 15, SHARP: 2.0 }, { coverage: 0.5, scale: 0.5, x1: 0.5, x2: 0.45, x4: 0.0 }, ['abstract']),
];
