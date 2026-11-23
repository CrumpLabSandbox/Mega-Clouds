// Seen from above: top-down and orbital cloud views. A hurricane over the ocean, cloud streets over farmland,
// a von Kármán vortex street behind an island, the whole Earth from orbit, a weather-radar scope and an
// enhanced-infrared satellite image. MODE picks the view; drag pans the maps and turns the globe.
import { shaderEngine } from '../gl.js';

const fs = `
float T, ASP, OCT;
vec2 L2;   // sun direction across the image (for cast shadows)

float isoLine(float v, float level, float wpx){ float fw = max(fwidth(v), 1e-5); return 1. - smoothstep(wpx*.5 - .5, wpx*.5 + .5, abs(v - level)/fw); }
float gridLine(float v, float wpx){ float fw = max(fwidth(v), 1e-5); return 1. - smoothstep(wpx*.5 - .5, wpx*.5 + .5, abs(fract(v + .5) - .5)/fw); }
vec3 oceanCol(vec2 p, float day){
  float w = noise2(p*40. + vec2(T*.2, 0.))*.5 + noise2(p*90. - vec2(0., T*.3))*.5;
  vec3 c = mix(vec3(.01,.05,.13), vec3(.02,.12,.26), .5 + .5*fbm2(p*2., 3.));
  c += vec3(.02,.04,.05)*w;
  return c*day;
}
vec3 landCol(vec2 p, float day){
  float n = fbm2(p*5., 5.);
  vec3 c = mix(vec3(.12,.22,.08), vec3(.35,.3,.16), smoothstep(.35, .7, n));
  c = mix(c, vec3(.5,.42,.28), smoothstep(.62, .8, fbm2(p*1.3 + 9., 3.)));
  return c*day*(.8 + .4*noise2(p*60.));
}
float landMask(vec2 p, float amt){ return smoothstep(.0, .01, fbm2(p*1.2 + 31.7, 6.) - mix(.75, .4, amt)); }

#if defined(MODE_0)
// ---- hurricane: differential rotation + log-spiral rain bands ----
float hur(vec2 p, float oct){
  float R = .72;
  float x = length(p)/R;
  float a = atan(p.y, p.x);
  float om = mix(.04, .3, uX1);
  // rigid rotation + fixed log-spiral twist; the noise itself evolves, so shear never piles up
  float th = 1.3*log(x + .05) - T*om;
  vec2 q = rot2(p, th)/R;
  float ev = T*om*.15;
  float n = fbm2(q*2.6 + vec2(5. + ev, -ev), oct)*.6 + fbm2(rot2(q, .5*sin(ev))*5.5 + 9., max(oct - 1., 2.))*.4;
  float bands = .5 + .5*sin(2.*a - 7.*log(x + .05) + T*om);
  float env = smoothstep(1.5, .35, x);
  float ew = exp(-pow((x - .1)/.045, 2.));
  float eye = smoothstep(.045, .085, x);
  float st = mix(.6, 1.25, uX2);
  float core = smoothstep(.75, .1, x);
  float d = (n*1.4 - .35)*env + bands*env*.45*smoothstep(.2, .6, x) + core*.45*st + ew*.5*st;
  d *= eye;
  d += fbm2(p*7. + vec2(T*.02, 0.), 3.)*.2*smoothstep(1., 1.8, x) - .05;
  return d;
}
#endif

#if defined(MODE_3)
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
float globeClouds(vec3 n, float oct){
  vec3 w = vec3(fbm3(n*2. + 3., 3.), fbm3(n*2. + 9., 3.), fbm3(n*2. + 17., 3.));
  float lat = n.y;
  float c = fbm3(n*3.2 + w*1.6 + vec3(0., 0., T*.01), oct);
  float belt = .1*exp(-lat*lat*80.) + .12*exp(-pow(abs(lat) - .7, 2.)*30.) - .1*exp(-pow(abs(lat) - .35, 2.)*40.);
  return smoothstep(mix(.62, .4, uCoverage), .78, c + belt);
}
#endif

#if defined(MODE_4)
float refl(vec2 p, float t){
  vec2 w = windDir();
  p -= w*t*.025;
  vec2 q = vec2(fbm2(p*1.3 + vec2(0., t*.01), 3.), fbm2(p*1.3 + 4.1, 3.));
  float n = fbm2(p*2.4 + q*1.5, OCT);
  float line = exp(-pow(dot(p - vec2(.1, 0.), normalize(vec2(1., .6))) + .15*sin(p.y*3.), 2.)*25.);
  float cells = (1. - worley2(p*4. + q*2.))*.35;
  return n*.85 + line*.25*uX2*2. + cells*smoothstep(.45, .7, n) - mix(.3, .05, uCoverage);
}
#endif

#if defined(MODE_5)
float cloudTop(vec2 p, float oct){
  // comma head: a broad spiral
  vec2 cc = vec2(-.45, .22);
  vec2 r = p - cc; float x = length(r);
  vec2 q = rot2(r, 2.*log(x + .05) - T*.02);
  float h1 = (fbm2(q*3. + 2., oct)*1.4 - .2)*smoothstep(.75, .1, x)*(.55 + .45*sin(atan(r.y, r.x) + 4.*log(x + .05)));
  // the trailing cold front
  float fy = .15 - .55*(p.x + .45) + .12*sin(p.x*3. + 1.);
  float fd = (p.y - fy)/(.07 + .05*fbm2(p*2., 3.));
  float h2 = exp(-fd*fd)*(.55 + .6*fbm2(p*5. + vec2(T*.03, 0.), oct))*smoothstep(-.6, -.2, p.x - (-.45))*smoothstep(1.2, .6, p.x);
  // scattered convection that grows and decays
  float h3 = 0.;
  vec2 pd = p - windDir()*T*.012;
  vec2 g = pd/.35; vec2 gi = floor(g);
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
    vec2 id = gi + vec2(i,j);
    vec2 c = (id + .2 + .6*hash22(id))*.35;
    float life = sin(T*.08 + hash12(id + 3.)*TAU);
    float rad = .03 + .07*max(life, 0.);
    float b = exp(-dot(pd - c, pd - c)/(rad*rad))*smoothstep(0., .3, life);
    h3 = max(h3, b*(.85 + .3*hash12(id + 7.)));
  }
  h3 *= .65 + .5*fbm2(p*14. + T*.02, 3.);
  float low = smoothstep(.45, .75, fbm2(pd*4. + vec2(T*.01, 3.), oct))*.4;
  return max(max(max(h1, h2), h3), low);
}
vec3 enhance(float v){
  // cool cloud tops in a rainbow ramp, warm scene in grey (an "enhanced IR" colour curve)
  vec3 c = vec3(mix(.08, .8, smoothstep(.0, .55, v)));
  c = mix(c, vec3(.3,.85,1.), smoothstep(.55, .6, v));
  c = mix(c, vec3(.1,.25,.95), smoothstep(.62, .67, v));
  c = mix(c, vec3(.1,.85,.2), smoothstep(.69, .74, v));
  c = mix(c, vec3(1.,.95,.1), smoothstep(.76, .81, v));
  c = mix(c, vec3(1.,.15,.05), smoothstep(.83, .88, v));
  c = mix(c, vec3(.05), smoothstep(.9, .93, v));
  c = mix(c, vec3(1.), smoothstep(.95, .98, v));
  return c;
}
#endif

void main(){
  T = uTime;
  ASP = uRes.x/uRes.y;
  OCT = mix(2., 7., uDetail);
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  float lpx = uRes.y/720.;
  float day = mix(.12, 1., smoothstep(.0, .35, uLight));
  L2 = normalize(vec2(-.7, .5));
  float zoom = mix(1.7, .6, uScale);
  vec2 pan = -uDrag*.5;
  vec3 col = vec3(0.);

#if defined(MODE_0)
  // ---------------- hurricane from above ----------------
  vec2 p = uv*zoom + pan - vec2(.08, 0.);
  vec3 ground = oceanCol(p, day);
  float lm = landMask(p + vec2(-.9, .2), uX3);
  ground = mix(ground, landCol(p, day), lm);
  float d = hur(p, OCT);
  float ds = hur(p + L2*.03, max(OCT - 2., 2.));
  float dsh = hur(p - L2*.035, 3.);
  ground *= 1. - .55*smoothstep(.25, .7, dsh);
  float a = smoothstep(.2, .7, d);
  float bump = clamp(.75 + (d - ds)*2.5, .35, 1.2);
  vec3 cl = mix(vec3(.62,.66,.74), vec3(1.), smoothstep(.3, 1.2, d))*bump*day;
  cl = mix(cl, cl*vec3(1.05,.85,.7), smoothstep(.4, .15, uLight)*.8);
  col = mix(ground, cl, a);
  // city lights on land at night
  col += vec3(1.,.75,.4)*step(.86, noise2(p*120.))*lm*(1. - day)*(1. - a)*.8;
  col = mix(col, vec3(.95,.8,.3), gridLine((p.x + pan.x*0.)*4., 1.*lpx)*uX4*.25);
  col = mix(col, vec3(.95,.8,.3), gridLine(p.y*4., 1.*lpx)*uX4*.25);

#elif defined(MODE_1)
  // ---------------- cloud streets over farmland ----------------
  vec2 p = uv*zoom + pan;
  float wa = (uWind - .5)*TAU;
  vec2 fp = rot2(p, .35)*3.;
  vec2 fi = floor(fp*vec2(2.2, 3.)), ff = fract(fp*vec2(2.2, 3.));
  float hv = hash12(fi);
  vec3 field = hv < .3 ? vec3(.32,.42,.16) : hv < .55 ? vec3(.62,.55,.28) : hv < .75 ? vec3(.24,.36,.14) : hv < .9 ? vec3(.45,.36,.22) : vec3(.55,.6,.3);
  field *= .85 + .2*noise2(fp*vec2(40., 4.)*(hv > .5 ? 1. : -1.));
  float hedge = max(1. - smoothstep(.0, .03, min(ff.x, 1. - ff.x)), 1. - smoothstep(.0, .03, min(ff.y, 1. - ff.y)));
  field = mix(field, vec3(.12,.18,.08), hedge*.7);
  float rv = abs(p.y + .15 + .2*sin(p.x*2.2) + .08*fbm2(p*3., 4.)) - .008;
  field = mix(field, vec3(.08,.18,.28), 1. - smoothstep(0., .004, rv));
  float town = smoothstep(.72, .76, fbm2(p*3. + 50., 4.));
  field = mix(field, vec3(.55,.53,.5)*(.7 + .5*hash12(floor(p*200.))), town);
  vec3 ground = field*day;
  vec2 q = rot2(p, -wa);
  float rows = mix(5., 11., uX2);
  vec2 qa = q - vec2(T*.03, 0.);
  float street = pow(.5 + .5*cos((q.y + .06*fbm2(qa*1.5, 3.))*rows*TAU), .8);
  float cells = 1. - worley2(vec2(qa.x*rows*1.1, q.y*rows*1.6));
  float n = fbm2(qa*vec2(5., 9.) + vec2(0., T*.01), OCT);
  float base = mix(.85, .35, uCoverage);
  float dd = street*(cells*.65 + n*.75) - base*.9;
  float dens = smoothstep(.0, .25, dd);
  vec2 sq = rot2(p - L2*.04, -wa);
  vec2 sqa = sq - vec2(T*.03, 0.);
  float sstreet = pow(.5 + .5*cos((sq.y + .06*fbm2(sqa*1.5, 3.))*rows*TAU), .8);
  float shd = smoothstep(.0, .25, sstreet*((1. - worley2(vec2(sqa.x*rows*1.1, sq.y*rows*1.6)))*.65 + fbm2(sqa*vec2(5., 9.), 3.)*.75) - base*.9);
  ground *= 1. - .45*shd;
  vec3 cl = mix(vec3(.75,.78,.84), vec3(1.), smoothstep(.0, .4, dd + n*.2 - .1))*day;
  col = mix(ground, cl, dens*.97);
  col = mix(col, col*vec3(1.1,.85,.7), smoothstep(.4, .15, uLight)*.6);

#elif defined(MODE_2)
  // ---------------- von Kármán vortex street ----------------
  vec2 p = uv*zoom + pan;
  float wa = (uWind - .5)*TAU;
  vec2 q = rot2(p, -wa);
  vec2 isl = vec2(-.55*zoom, .02);
  vec2 f = q - isl;
  float Ls = mix(.2, .32, uScale)*.9, h = Ls*.32;
  float U = .03*mix(.5, 2., uX1);
  float ph = fract(T*U/Ls);
  vec2 g = f;
  for (int k = 0; k < 9; k++) {
    float fk = float(k);
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? 1. : -1.;
      float xk = .06 + Ls*(fk + ph + (s == 0 ? 0. : .5));
      vec2 c = vec2(xk, side*h*(.5 + .5*smoothstep(0., .4, xk)));
      float sig = .02 + .06*xk;
      float str = smoothstep(.04, .2, xk)*exp(-xk*.5)*mix(1., 3.2, uX2);
      vec2 r = g - c;
      g = c + rot2(r, side*str*exp(-dot(r, r)/(sig*sig*1.5)));
    }
  }
  vec2 ga = g - vec2(U*T, 0.);
  float cellN = (1. - worley2(ga*mix(14., 26., uDetail)))*.55 + fbm2(ga*4., OCT)*.6;
  float deck = smoothstep(mix(.7, .3, uCoverage), mix(.9, .55, uCoverage), cellN + .15*fbm2(ga*1.2 + 4., 3.));
  float x = f.x;
  float wake = exp(-pow(f.y/(.012 + .07*max(x, 0.)), 2.))*smoothstep(-.02, .02, x)*exp(-x*2.5);
  deck *= 1. - .85*wake;
  deck *= smoothstep(.04, .08, length(f*vec2(1., 1.2)));
  float lm = 1. - smoothstep(.035, .04, length(f));
  float hgt = smoothstep(.04, .0, length(f));
  vec3 ground = oceanCol(p, day);
  vec3 isc = mix(vec3(.3,.28,.18), vec3(.45,.4,.35), hgt)*day*(.8 + .4*noise2(f*200.));
  ground = mix(ground, isc, lm);
  vec3 cl = mix(vec3(.55,.6,.66), vec3(.97,.98,1.), smoothstep(.0, 1., cellN))*day;
  col = mix(ground, cl, deck*.95);
  col = mix(col, col*vec3(1.1,.85,.72), smoothstep(.4, .15, uLight)*.6);

#elif defined(MODE_3)
  // ---------------- Earth from orbit ----------------
  float R = mix(.33, .47, uScale);
  float r = length(uv);
  float ph = (1. - uLight)*PI*.85 + .25;
  vec3 L = normalize(vec3(sin(ph), .25, -cos(ph)));
  vec3 bg = vec3(step(.9975, hash12(floor(gl_FragCoord.xy/1.5)))*.8) + vec3(.01,.01,.025);
  col = bg;
  // atmosphere halo
  vec2 dir = uv/max(r, 1e-4);
  float limbLit = smoothstep(-.35, .5, dot(vec3(dir, 0.), L));
  float halo = exp(-max(r - R, 0.)/(R*.05))*step(R, r);
  col += vec3(.3,.55,1.)*halo*limbLit*.9;
  if (r < R) {
    vec3 n = vec3(uv/R, -sqrt(1. - r*r/(R*R)));
    float yaw = T*mix(.0, .12, uX1) + uDrag.x*3., pitch = .35 + uDrag.y*2.;
    vec3 np = rotY(yaw)*rotX(pitch)*n;
    float lat = np.y;
    float cont = fbm3(np*1.8 + 3.3 + uSeed*.0, 6.) + .1*fbm3(np*6., 3.) - mix(.62, .42, uX3);
    float land = smoothstep(0., .01, cont);
    float ice = smoothstep(.8, .86, abs(lat) + .05*noise3(np*10.));
    vec3 lc = mix(vec3(.14,.28,.08), vec3(.6,.5,.3), smoothstep(.15, .05, abs(abs(lat) - .3)) * smoothstep(.0, .1, cont));
    lc = mix(lc, vec3(.3,.3,.18), smoothstep(.5, .7, abs(lat)));
    lc *= .8 + .4*fbm3(np*12., 3.);
    vec3 oc = mix(vec3(.01,.06,.2), vec3(.02,.15,.32), smoothstep(-.06, 0., cont));
    vec3 surf = mix(oc, lc, land);
    surf = mix(surf, vec3(.92,.95,1.), ice);
    float diff = dot(n, L);
    float lit = smoothstep(-.08, .25, diff);
    // clouds rotate slightly faster than the ground, and cast a shadow
    vec3 cn = rotY(T*mix(.0, .02, uX1))*np;
    float c = globeClouds(cn, OCT);
    float cs = globeClouds(normalize(cn - L*.015), max(OCT - 3., 2.));
    vec3 rd = vec3(0., 0., 1.);
    vec3 h = normalize(L - rd);
    float spec = pow(max(dot(n, h), 0.), 60.)*(1. - land)*(1. - ice)*.8;
    vec3 day3 = surf*(1. - .5*cs)*max(diff, 0.)*1.4 + vec3(1.,.9,.75)*spec;
    vec3 term = vec3(1.,.45,.2)*exp(-pow(diff/.08, 2.))*.35;
    vec3 cityC = vec3(1.,.72,.35)*step(.78, noise3(np*70.))*step(.55, noise3(np*9.))*land*(1. - ice)*smoothstep(.05, -.15, diff)*1.2;
    vec3 ccol = vec3(1.)*(max(diff, 0.)*1.2 + .02) + term*.6;
    col = day3 + cityC*(1. - c) + term*(1. - c)*.4;
    col = mix(col, ccol, c*smoothstep(-.15, .1, diff + .1));
    col = mix(col, col*.2 + cityC*.3, c*(1. - lit)*.0);
    // atmospheric haze toward the limb
    float fr = pow(1. - abs(n.z), 3.);
    col += vec3(.25,.5,1.)*fr*lit*.7 + vec3(.15,.25,.6)*fr*.05;
  }

#elif defined(MODE_4)
  // ---------------- weather radar ----------------
  float rr = length(uv);
  float ang = atan(uv.y, uv.x);
  vec2 p = uv*zoom*1.6 + pan;
  vec3 land = mix(vec3(.05,.06,.07), vec3(.11,.13,.11), landMask(p*.8, uX3));
  float coast = isoLine(fbm2(p*.8*1.2 + 31.7, 6.), mix(.75, .4, uX3), 1.2*lpx);
  col = land + vec3(.25,.3,.35)*coast;
  col += vec3(.08,.09,.1)*max(gridLine(p.x*3., 1.*lpx), gridLine(p.y*3., 1.*lpx));
  // cities
  vec2 ci = floor(p*3.); vec2 cp = (ci + .2 + .6*hash22(ci))/3.;
  col += vec3(.7)*smoothstep(.006, .003, length(p - cp))*step(.6, hash12(ci + 5.));
  float sw = mix(.6, 2.5, uX1);
  float sa = T*sw;
  float since = fract((sa - ang)/TAU);
  float teff = T - since*TAU/sw;
  // polar range bins
  float bins = 160.*mix(.6, 1.4, uDetail);
  float rq = (floor(rr*bins) + .5)/bins;
  float aq = (floor(ang/TAU*720.) + .5)/720.*TAU;
  vec2 pq = vec2(cos(aq), sin(aq))*rq*zoom*1.6 + pan;
  float z = refl(pq, teff);
  vec3 rc = vec3(0.); float ra = 0.;
  if (z > .4) { rc = vec3(.15,.75,.2); ra = .85; }
  if (z > .5) rc = vec3(.05,.5,.1);
  if (z > .58) rc = vec3(.95,.9,.1);
  if (z > .65) rc = vec3(1.,.55,.05);
  if (z > .72) rc = vec3(.95,.1,.08);
  if (z > .8) rc = vec3(.9,.1,.75);
  col = mix(col, rc, ra*(.85 + .15*exp(-since*5.)));
  // range rings, beam and phosphor trail
  float ringD = rr/.12;
  col += vec3(.1,.45,.2)*gridLine(ringD, 1.2*lpx)*.6*step(rr, .48);
  col += vec3(.1,.45,.2)*(isoLine(uv.x, 0., 1.*lpx) + isoLine(uv.y, 0., 1.*lpx))*.35*step(rr, .48);
  col += vec3(.2,1.,.4)*exp(-since*TAU*6.)*.35*step(rr, .48);
  col += vec3(.5,1.,.6)*(1. - smoothstep(0., .004, abs(rr*sin(ang - sa))))*step(0., cos(ang - sa))*step(rr, .48);
  col = mix(col, vec3(.02,.025,.03), smoothstep(.48, .482, rr));
  col += vec3(.2,.6,.3)*isoLine(rr, .48, 2.*lpx);
  // dBZ colour key
  vec2 kp = uv - vec2(ASP*.5 - .07, -.35);
  if (abs(kp.x) < .012 && kp.y > 0. && kp.y < .3) {
    float kz = .4 + kp.y/.3*.45;
    col = kz > .8 ? vec3(.9,.1,.75) : kz > .72 ? vec3(.95,.1,.08) : kz > .65 ? vec3(1.,.55,.05) : kz > .58 ? vec3(.95,.9,.1) : kz > .5 ? vec3(.05,.5,.1) : vec3(.15,.75,.2);
  }

#elif defined(MODE_5)
  // ---------------- enhanced infrared satellite image ----------------
  vec2 p = uv*zoom + pan + vec2(.15, 0.);
  float v = cloudTop(p, OCT);
  float lm = landMask(p, uX3);
  float surf = mix(.12, .22, lm) + .04*fbm2(p*6., 3.);
  float tv = max(surf, v*mix(.8, 1.15, uX2));
  col = enhance(tv);
  // coastlines and a lat/lon grid
  float coast = isoLine(fbm2(p*1.2 + 31.7, 6.), mix(.75, .4, uX3), 1.2*lpx);
  col = mix(col, vec3(.95,.85,.2), coast*.8*uX4*1.6);
  col = mix(col, vec3(.7,.7,.75), max(gridLine(p.x*2.5, 1.*lpx), gridLine(p.y*2.5, 1.*lpx))*.3*uX4*1.6);
  col *= .96 + .04*hash12(gl_FragCoord.xy + floor(uClock*20.));
  // colour bar along the bottom
  if (uv.y < -.47) col = enhance(clamp((uv.x/ASP + .5), 0., 1.));
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'satellite', name: 'From Above', fs, res: 0.75,
  defaults: { MODE: 0 },
  params: [
    { id: 'x1', label: 'Spin', value: 0.5 },
    { id: 'x2', label: 'Intensity', value: 0.5 },
    { id: 'x3', label: 'Land', value: 0.4 },
    { id: 'x4', label: 'Overlay', value: 0.3 },
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'satellite-' + id, name, desc, opts, params, tags: ['realistic', 'distance', ...(tags.includes('3d') ? [] : ['2d']), ...tags] });
export const scenes = [
  d('hurricane', 'Hurricane Eye', 'A category-five spiral turning over warm ocean, seen from orbit.', { MODE: 0 }, { coverage: 0.55, scale: 0.5, light: 0.8, x1: 0.45, x2: 0.6, x3: 0.35, x4: 0.0 }, ['storm', 'sea', 'interactive']),
  d('streets', 'Cloud Streets', 'Rows of fair-weather cumulus lined up by the wind over patchwork farmland.', { MODE: 1 }, { coverage: 0.5, scale: 0.5, light: 0.75, x2: 0.5 }, ['interactive']),
  d('karman', 'Vortex Street', 'Alternating eddies shed into a stratocumulus deck downwind of an island.', { MODE: 2 }, { coverage: 0.55, scale: 0.5, light: 0.8, x1: 0.5, x2: 0.5 }, ['sea', 'interactive']),
  d('earth', 'Blue Marble', 'The whole Earth turning beneath its clouds; drag to spin the globe.', { MODE: 3 }, { coverage: 0.5, scale: 0.6, light: 0.6, x1: 0.4, x3: 0.5 }, ['space', '3d', 'interactive']),
  d('radar', 'Doppler Radar', 'Storm cells painted green, yellow and red as the sweep goes round.', { MODE: 4 }, { coverage: 0.5, scale: 0.5, x1: 0.5, x2: 0.5 }, ['weather', 'storm', 'abstract']),
  d('infrared', 'Infrared Satellite', 'Enhanced-IR false colour: the coldest storm tops glow red and white.', { MODE: 5 }, { coverage: 0.5, scale: 0.4, x2: 0.5, x4: 0.4 }, ['weather', 'abstract']),
];
