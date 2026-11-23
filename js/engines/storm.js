// Storm: dramatic weather. Modes 0,1,3,4,5 raymarch a storm volume (supercell, night storm, tornado, mammatus,
// shelf cloud) with a billboard plane for bolts / the funnel composited at the right depth. Modes 2,6,7,8 are
// painted 2.5D scenes (rain shafts, snow, rainbow, rain on a window). Lightning timing runs on uClock so it
// flickers at real speed; x1 sets how often it strikes, and holding the pointer down calls a bolt under it.
import { shaderEngine } from '../gl.js';

const fs = `
float T, DAY;
vec3 SUN, SUNC;
#if defined(MODE_0) || defined(MODE_1) || defined(MODE_3) || defined(MODE_4) || defined(MODE_5)
#define VOL 1
#else
#define VOL 0
#endif

// ---------------- lightning ----------------
float lnoise(float x){ float i = floor(x); return mix(hash11(i), hash11(i+1.), fract(x)); }
float jag(float s, float sd){
  return (lnoise(s*6. + sd*13.1) - .5)*.55 + (lnoise(s*17. + sd*7.3) - .5)*.2 + (lnoise(s*47. + sd*3.7) - .5)*.07;
}
float strikeEnv(float tl){
  if (tl < 0.) return 0.;
  return min(1.2, exp(-tl*11.) + .9*exp(-abs(tl-.12)*45.) + .75*exp(-abs(tl-.27)*38.) + .4*exp(-abs(tl-.4)*30.));
}
// x = brightness envelope, y = strike seed, z = 1 for cloud-to-ground (a visible bolt)
vec3 flashInfo(){
  float rate = max(mix(.06, 1.1, uX1)*FLASHRATE, 1e-3);
  float k = floor(uClock*rate);
  float u = fract(uClock*rate);
  float tl = (u - hash11(k*1.7 + uSeed*31.)*.5)/rate;
  float env = strikeEnv(tl)*step(hash11(k*3.3 + uSeed*17.), .8)*step(.02, uX1)*step(.001, FLASHRATE);
  vec3 r = vec3(env, k + uSeed*97., step(.4, hash11(k*5.1 + 2.)));
  if (FORCE > 0.) r = vec3(1., 3. + floor(uClock*.5), 1.);
  if (uMouse.z > .5) {
    float fk = floor(uClock*9.);
    r = vec3(.45 + .65*hash11(fk), floor(uClock*1.7) + 500., 1.);
  }
  return r;
}
// glow of a branching bolt in a 2D plane; a = top point, L = length downward
float boltGlow(vec2 p, vec2 a, float L, float lean, float sd, float w){
  float g = 0.;
  float s = (a.y - p.y)/L;
  if (s > -.01 && s < 1.01) {
    float x = a.x + lean*s*L + jag(s, sd)*L*.28;
    float d = abs(p.x - x);
    g += (1. - smoothstep(0., w, d)) + .3*exp(-d/(w*9.));
  }
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float sb = .05 + fi*.15 + hash11(sd + fi*7.)*.1;
    float bx = a.x + lean*sb*L + jag(sb, sd)*L*.28;
    float by = a.y - sb*L;
    float bl = L*(.1 + .25*hash11(sd*1.3 + fi));
    float dir = hash11(sd + fi*3.) < .5 ? -1. : 1.;
    float s2 = (by - p.y)/bl;
    if (s2 > 0. && s2 < 1.) {
      float x2 = bx + dir*s2*bl*(.4 + .8*hash11(sd + fi*9.)) + jag(s2, sd + fi*11.)*bl*.35;
      float d2 = abs(p.x - x2);
      g += ((1. - smoothstep(0., w*.6, d2)) + .22*exp(-d2/(w*7.)))*(1. - s2)*.75;
    }
  }
  return g;
}

void sunSetup(){
  float el = mix(-.07, 1.15, DAY);
  float az = SUNAZ;
  SUN = normalize(vec3(sin(az)*cos(el), sin(el), cos(az)*cos(el)));
  SUNC = mix(vec3(1., .42, .16), vec3(1., .95, .88), smoothstep(.02, .5, el))*smoothstep(-.12, .04, el)*SUNI;
  if (MOONI > 0.) { SUN = normalize(vec3(sin(az), .6, cos(az))); SUNC = vec3(.45, .55, .8)*MOONI; }
}

#if VOL
// ---------------- volumes ----------------
vec3 DRIFT; float NSC; float GUST;
vec3 LPOS; float LENV;

vec2 map(vec3 p, float oct){
#if defined(MODE_0)
  // supercell: rotating striated updraft, anvil, lowered wall cloud and a rain/hail core
  vec3 q = p - vec3(0., 0., 15.);
  float bh = q.y - 1.3;
  float r = length(q.xz);
  float ang = atan(q.z, q.x);
  float rt = T*.1*mix(.2, 2.5, uX2);
  float stri = sin(bh*4. + ang + rt*3.);
  float R = 4.4 - .28*bh + (.35*stri + .3*smoothstep(.55, .8, fract(bh*.9 + ang*.08 + rt*.4)))*smoothstep(0., 1., bh)*smoothstep(6.5, 2.5, bh);
  float tower = min(min((R - r)*.6, bh*3.), (7.8 - bh)*.7);
  vec2 ac = q.xz - vec2(5., 3.);
  float anvil = min(min((8.6 - bh)*1.6, (bh - 6.3 + .4*smoothstep(.6, .1, worley2(q.xz*.5)))*1.2), (10. - length(ac*vec2(.6, 1.)))*.3);
  float wall = min(min((2.2 - length(q.xz - vec2(-.8, -1.8)))*1., (bh + .6)*3.), (.3 - bh)*3.);
  float d = max(max(tower, anvil + .4), wall);
  float rain = min((2.4 - length(q.xz - vec2(4.2, .8)))*.6, -bh);
  if (d < -1.1 && rain < -.4) return vec2(0.);
  vec2 rq = rot2(q.xz, rt*(r < 4.5 ? 1. : .2));
  vec3 np = vec3(rq.x, q.y*1.15, rq.y)*NSC + DRIFT*.3;
  float n = fbm3(np, oct);
  d = max(max(tower, wall) + (n - .5)*1.1, anvil + (n - .5)*.8 + .15) + (uCoverage - .5)*.9;
  float dens = smoothstep(0., .35, d)*1.6;
  float pr = clamp(rain + (noise3(vec3(q.x*2.5 - q.y*.4*GUST, q.y*.25 + T*.6, q.z*2.5)) - .5)*1.2, 0., 1.)*.3*mix(.3, 2., uX3);
  return vec2(dens + pr, 1.);
#elif defined(MODE_1)
  // night thunderstorm field: towering cells over a common base
  vec3 q = p + DRIFT;
  float hf = fbm2(q.xz*.07*NSC + 3.1, 4.);
  float band = smoothstep(18., 26., p.z)*smoothstep(60., 45., p.z);
  float top = 1.4 + 8.*band*smoothstep(.35, .75, hf + (uCoverage - .5)*.3);
  float d = min(min((p.y - 1.2)*3., (top - p.y)*.6), (band - .3)*4.);
  if (d < -1.2) return vec2(0.);
  d += (fbm3(q*.55*NSC, oct) - .5)*2.6;
  float dens = smoothstep(0., .5, d)*1.3;
  float pr = clamp((noise2(q.xz*.3) - .55)*3., 0., 1.)*step(p.y, 1.25)*.05*mix(.3, 2., uX3);
  return vec2(dens + pr, 1.);
#elif defined(MODE_3)
  // tornado-producing base: a low dark deck with a rotating lowered wall cloud
  vec3 c = vec3(sin(T*.05)*.8, 0., TZ);
  vec3 q = p - c;
  float rw = length(q.xz - vec2(0., .6));
  float base = 1.15 - .42*exp(-rw*rw*.25);
  float d = min((p.y - base)*3.5, (3.2 - p.y)*.8);
  float rain = min((3.0 - length(q.xz - vec2(-5.5, 6.)))*.4, base - p.y);
  if (d < -1.2 && rain < -.3) return vec2(0.);
  vec2 rq = rot2(q.xz, T*.12*mix(.2, 3., uX2)*exp(-rw*.15));
  vec3 np = vec3(rq.x, p.y*2.5, rq.y)*NSC*2. + DRIFT*.2;
  d += (fbm3(np, oct) - .5)*3. + (uCoverage - .5)*.6;
  float pr = clamp(rain + (noise3(vec3(q.x*2. - q.y*.5*GUST, q.y*.3 + T*.8, q.z*2.)) - .5)*1.3, 0., 1.)*.1*mix(.3, 2., uX3);
  return vec2(smoothstep(0., .6, d)*1.5 + pr, 1.);
#elif defined(MODE_4)
  // mammatus: pouches hanging from an anvil
  vec2 xz = p.xz + DRIFT.xz;
  vec2 g = xz*.85*NSC;
  float c = worley2(g + vec2(0., T*.02));
  float pouch = sqrt(max(0., 1. - c*c/.42));
  float base = 1.6 - pouch*(.55 + .15*noise2(g*.5));
  float d = min((p.y - base)*5., (2.3 - p.y)*2.);
  if (d < -1.) return vec2(0.);
  d += (fbm3(vec3(xz.x, p.y*2., xz.y)*1.4*NSC + T*.02, oct) - .5)*mix(.8, 2., uX4) + (uCoverage - .5)*.6;
  return vec2(smoothstep(0., .5, d)*1.4, 1.);
#else
  // shelf cloud: a tiered wedge on the leading edge of the gust front
  vec3 q = p;
  float ze = 3.6 + .8*sin(q.x*.13 + .7) + .4*sin(q.x*.31 + T*.05);
  vec3 dq = q + vec3(0., 0., T*.25*mix(.3, 2., uX4));   // air rolling toward us
  float e = q.z - ze + (.13*sin(q.y*14. + noise2(q.xz*.5)*4.) + .05*sin(q.y*37.))*mix(.5, 1.5, uDetail)*smoothstep(2.2, 1.4, q.y);
  float bot = .5 + .06*max(e, 0.) + .25*smoothstep(4., 9., e);
  float topf = min(.48 + 1.1*e, 1.35 + .1*e) + max(e - 3.5, 0.)*1.6;
  float d = min(min((q.y - bot)*4., (topf - q.y)*2.2), (5.5 - q.y)*.6);
  float rain = min(e - 5., bot - q.y)*.6;
  if (d < -1.2 && rain < -.3) return vec2(0.);
  float n = fbm3(vec3(dq.x*.6, dq.y*1.8, dq.z*.9)*NSC + DRIFT*.2, oct);
  d += (n - .5)*mix(1.4, 3., smoothstep(1.4, 3., q.y)) + (uCoverage - .5)*.6;
  float pr = clamp(rain + (noise3(vec3(q.x*2.2 - q.y*.6*GUST, q.y*.3 + T*.9, q.z)) - .5)*1.2, 0., 1.)*.1*mix(.3, 2., uX3);
  return vec2(smoothstep(0., .5, d)*1.4 + pr, 1.);
#endif
}

float hg(float c, float g){ float g2 = g*g; return (1. - g2)/(4.*PI*pow(1. + g2 - 2.*g*c, 1.5)); }

vec4 march(vec3 ro, vec3 rd, float t0, float t1, vec4 bb, float tb, float oct){
  float Tr = 1.; vec3 L = vec3(0.);
  float dt = DTN;
  float t = t0 + DTN*hash12(gl_FragCoord.xy + fract(uClock*7.)*31.);
  float cs = dot(rd, SUN);
  float ph = mix(hg(cs, .55), hg(cs, -.2), .5)*7.;
  bool bdone = tb > 1e5;
  for (int i = 0; i < int(STEPS); i++) {
    if (t > t1 || Tr < .02) break;
    if (!bdone && t > tb) { L += Tr*bb.rgb; Tr *= 1. - bb.a; bdone = true; }
    vec3 p = ro + rd*t;
    vec2 m = map(p, oct);
    if (m.x > .002) {
      float ls = 0.;
      ls += map(p + SUN*.25, oct*.6).x*.25;
      ls += map(p + SUN*.7, oct*.5).x*.45;
      ls += map(p + SUN*1.6, 2.).x*.9;
      float sh = exp(-ls*SHADK);
      float powder = 1. - exp(-m.x*3.);
      float hy = clamp((p.y - AMBLO)/(AMBHI - AMBLO), 0., 1.);
      vec3 amb = mix(AMBB, AMBT, hy)*mix(.15, 1., smoothstep(-.1, .4, DAY) + .15);
      vec3 c = SUNC*sh*ph*mix(.6, 1., powder) + amb;
      float ld = length(p - LPOS);
      c += vec3(.75, .8, 1.)*LENV*LIGHTI*exp(-ld*LFALL)*(.4 + .6*exp(-m.x*1.5));
      float a = 1. - exp(-m.x*dt*DENS*smoothstep(DIST, DIST*.75, t));
      L += Tr*a*c*ALB; Tr *= 1. - a;
    }
    dt = m.y > .5 ? DTN*(1. + t*DTG) : DTN*3.*(1. + t*DTG);
    t += dt;
  }
  if (!bdone && tb < t1 + 1e4) { L += Tr*bb.rgb; Tr *= 1. - bb.a; }
  return vec4(L, Tr);
}

vec3 groundCol(vec3 h, float dist, vec3 fogc, float fl){
  vec2 g = h.xz;
  float n = fbm2(g*.9, 4.), n2 = noise2(g*vec2(6., .5));
  vec3 c = mix(GROUND, GROUND*vec3(1.25, 1.1, .7), n)*(.8 + .3*n2);
  float lit = max(SUN.y, 0.)*.9 + .12;
  float shade = 1.;
#if defined(MODE_5)
  shade = mix(1., .18, smoothstep(3., 5., h.z + sin(h.x*.13)*.8));
#elif defined(MODE_0)
  shade = mix(.35, 1., smoothstep(7., 16., length(h.xz - vec2(0., 24.))));
#else
  shade = .45;
#endif
  c *= (SUNC*lit*shade + AMBB*.6)*GLIT + vec3(.6, .7, 1.)*fl*.25;
#if defined(MODE_1)
  // scattered town lights on the plain
  vec2 cp = g*1.3; vec2 id = floor(cp); vec2 o = hash22(id);
  float lt = step(.85, hash12(id + 7.))*exp(-length(fract(cp) - o)*mix(40., 12., smoothstep(10., 40., dist)));
  c += vec3(1., .65, .3)*lt*1.5;
#endif
  return mix(c, fogc, smoothstep(FOGN, FOGF, dist));
}
#endif

// ---------------- 2.5D helpers ----------------
// perspective cloud-deck sample; returns (density, lit amount)
vec2 deck(vec2 uv, float hz, float H, float sc, float oct, float cov, vec2 lightDir){
  float yy = uv.y - hz;
  vec2 p = vec2(uv.x/yy, 1./yy)*H*sc;
  vec2 w = windDir();
  p += w*T*.08;
  float n = fbm2(p + fbm2(p*.5 + 3., 3.)*.8, oct);
  n = n*.8 + (1. - worley2(p*1.3))*.3;
  float d = clamp((n - mix(.85, .25, cov))*3., 0., 1.);
  float n2 = fbm2(p + lightDir*.18, oct*.6)*.8 + (1. - worley2(p*1.3 + lightDir*.23))*.3;
  float d2 = clamp((n2 - mix(.85, .25, cov))*3., 0., 1.);
  return vec2(d, clamp(.5 + (d - d2)*2.5, 0., 1.));
}

void main(){
  T = uTime; DAY = uLight;
  sunSetup();
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  vec3 fl = flashInfo();
  float fenv = fl.x;
  vec3 col;
#if VOL
  // ---------- camera ----------
  float yaw = CAMYAW + uDrag.x*.5;
  float pitch = clamp(CAMPITCH + uDrag.y*.4, -.2, 1.2);
  vec3 ro = vec3(0., CAMY, 0.);
  vec3 fwd = vec3(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch));
  vec3 rt = normalize(cross(vec3(0., 1., 0.), fwd)), up = cross(fwd, rt);
  vec3 rd = normalize(fwd*FL + rt*uv.x + up*uv.y);
  NSC = mix(1.5, .55, uScale);
  vec2 wd = windDir(); DRIFT = vec3(wd.x, 0., wd.y)*T*.12;
  GUST = mix(.2, 2.5, uX4);
  float oct = mix(2.5, 6., uDetail);

  // sky
  vec3 sky = skyColor(rd, SUN, DAY);
  float hzy = rd.y;
  sky = mix(sky, SKYTINT*mix(.12, 1., smoothstep(-.05, .4, DAY)), SKYGREY*smoothstep(-.3, .2, hzy));
  sky += SKYGLOW*smoothstep(.25, .0, abs(hzy - .02))*mix(.3, 1., smoothstep(0., .3, DAY));
  sky += vec3(.5, .55, .75)*fenv*.08;
  // stars on clear night patches
  sky += step(.996, hash12(floor(rd.xy/rd.z*300.)))*smoothstep(.15, .0, DAY)*.5*step(0., rd.y);

  // lightning placement: in a vertical plane at depth PZ
  float sd = fl.y;
  float pz = PZ + (hash11(sd*2.1) - .5)*PZR;
  float bx = (hash11(sd*1.1) - .5)*BXR;
  if (uMouse.z > .5) {
    vec2 mu = (uMouse.xy - .5)*vec2(uRes.x/uRes.y, 1.);
    vec3 md = normalize(fwd*FL + rt*mu.x + up*mu.y);
    bx = ro.x + md.x*(pz - ro.z)/max(md.z, .05);
  }
  LPOS = vec3(bx, BOLTTOP + LUP*(fl.z > .5 ? .5 : 1.), pz);
  LENV = fenv;
  vec4 bb = vec4(0.); float tb = 1e6;
  if (rd.z > .01) {
    tb = (pz - ro.z)/rd.z;
    vec3 h = ro + rd*tb;
    float w = .004*pz;
    float g = boltGlow(h.xy, vec2(bx, BOLTTOP), BOLTTOP, (hash11(sd*4.7) - .5)*.25, sd, w)*fl.z;
    bb.rgb = vec3(.75, .8, 1.)*g*fenv*2.5;
  }
#if defined(MODE_3)
  // the funnel and debris whirl, drawn on a billboard through the vortex axis
  {
    vec3 c = vec3(sin(T*.05)*.8, 0., TZ);
    float tf = (c.z - ro.z)/max(rd.z, .01);
    vec3 h = ro + rd*tf;
    float base = .74;
    float hy = clamp(h.y/base, 0., 1.);
    float cx = c.x + .35*sin(hy*2.2 + T*.3)*(1. - hy)*hy*2. + .12*sin(h.y*6. + T*1.1)*(1. - hy);
    float rf = .08 + .025*sin(h.y*9. - T*2.) + .4*pow(hy, 2.5)*mix(.6, 1.6, uScale);
    float u = (h.x - cx)/rf;
    float rotS = T*mix(1., 9., uX2);
    float ang = asin(clamp(u, -1., 1.));
    float stri = noise2(vec2(ang*2.5 + rotS + h.y*3., h.y*14.));
    float edge = 1. - smoothstep(.65, 1.05 + stri*.2, abs(u));
    float fa = edge*smoothstep(-.02, .06, h.y)*smoothstep(base + .05, base - .2, h.y);
    float shade = .55 + .45*sqrt(max(0., 1. - u*u))*(.6 + .4*(-u*SUN.x + .5));
    vec3 fc = mix(vec3(.3, .32, .33), vec3(.2, .22, .23), hy)*shade*(.7 + .6*stri);
    fc = mix(fc, vec3(.38, .3, .22)*shade, smoothstep(.3, .0, h.y));
    fc *= mix(.3, 1., smoothstep(0., .5, DAY));
    // debris cloud
    vec2 dq = vec2(h.x - c.x, h.y);
    float dn = fbm2(vec2(dq.x*4. + rotS*.4*sign(dq.x), dq.y*5. - T*.5), 4.);
    float deb = smoothstep(.0, .25, .55*mix(.6, 1.6, uScale) - length(dq*vec2(1., 1.8)) - (dn - .5)*.6)*smoothstep(.0, .05, h.y + .02);
    vec3 dc = vec3(.4, .32, .24)*(.6 + .6*dn)*mix(.3, 1., smoothstep(0., .5, DAY));
    float ta = clamp(fa + deb*.8, 0., 1.);
    vec3 tc = mix(fc, dc, clamp(deb*.8/(ta + 1e-3), 0., 1.));
    if (tf < tb) { bb = vec4(tc*ta + bb.rgb*(1. - ta), ta); tb = tf; }
    else bb = vec4(bb.rgb + tc*ta, ta);
  }
#endif
  // bounds: slab [YMIN, YMAX]
  float t0 = 0., t1 = DIST;
  if (rd.y > 1e-4) { t0 = max(0., (YMIN - ro.y)/rd.y); t1 = min(t1, (YMAX - ro.y)/rd.y); }
  else if (rd.y < -1e-4) { t1 = min(t1, (YMIN - ro.y)/rd.y); if (ro.y < YMIN) t1 = -1.; }
  float tg = rd.y < 0. ? -ro.y/rd.y : 1e6;
  t1 = min(t1, tg);
  vec3 bg = sky;
  if (rd.y < 0.) bg = groundCol(ro + rd*tg, tg, sky*.9 + FOGC, fenv);
  vec4 v = t1 > t0 ? march(ro, rd, t0, t1, bb, tb, oct) : vec4(bb.rgb, 1. - bb.a);
  if (t1 <= t0) { v = vec4(bb.rgb, 1. - bb.a); }
  col = bg*v.a + v.rgb;
  col = 1. - exp(-col*EXPO);

#elif defined(MODE_2)
  // ---------- rain shafts and virga over the plains ----------
  float hz = -.16 + uDrag.y*.1;
  float H = .42;
  float sc = mix(1.8, .7, uScale);
  float oct = mix(2.5, 6.5, uDetail);
  vec2 sunP = vec2(.3 + uDrag.x*.2, hz + mix(-.02, .3, DAY));
  float golden = smoothstep(.6, .1, DAY);
  float dl = mix(.2, 1., smoothstep(0., .25, DAY));
  vec3 hzc = mix(vec3(.78, .82, .86), vec3(1., .7, .38), golden)*dl;
  vec3 top = mix(vec3(.45, .55, .7), vec3(.75, .5, .4), golden)*dl;
  vec3 sky = mix(hzc, top, smoothstep(hz, hz + .3, uv.y));
  float sdist = length(uv - sunP);
  sky += vec3(1., .85, .55)*(smoothstep(.03, .026, sdist)*1.5 + exp(-sdist*8.)*.6)*smoothstep(0., .2, DAY);
  col = sky;
  float edgeN = fbm2(vec2(uv.x*1.5 + T*.01, 1.), 3.);
  float dFront = 3. + edgeN*3.;               // the deck ends at this distance, leaving a bright slot
  if (uv.y > hz + .002) {
    float yy = uv.y - hz;
    float dist = H/yy;
    vec2 dk = deck(uv, hz, H, sc, oct, uCoverage*.6 + .45, normalize(sunP - uv)*vec2(1., -1.));
    float far = smoothstep(dFront + .6, dFront, dist);
    float a = mix(dk.x, 1., .75)*far;
    vec3 dark = mix(vec3(.14, .15, .2), vec3(.2, .14, .16), golden)*dl;
    vec3 lit = mix(vec3(.6, .62, .66), vec3(1., .6, .32), golden)*dl;
    float edgeLit = smoothstep(dFront - 1.2, dFront, dist) + exp(-length(uv - sunP)*4.)*.3;
    vec3 cc = mix(dark*(.75 + .6*dk.y), lit, clamp(edgeLit*(1. - dk.x*.3), 0., 1.));
    cc += lit*.25*(1. - dk.x)*smoothstep(.5, 1., dk.y);
    col = mix(sky, cc, clamp(a, 0., 1.));
  }
  // plains, in the storm's shadow up close and sunlit far away
  if (uv.y <= hz) {
    float yy = hz - uv.y;
    float dist = .06/yy;
    vec2 gp = vec2(uv.x*dist, dist);
    float n = fbm2(gp*vec2(3., 1.5), 4.);
    float rows = .5 + .5*sin(gp.x*30. + n*4.);
    vec3 g = mix(vec3(.42, .36, .14), vec3(.66, .55, .24), n)*(.85 + .2*rows*smoothstep(1.5, .3, dist));
    float sunlit = smoothstep(dFront*.6, dFront*.6 + .6, dist + (noise2(vec2(uv.x*2. - T*.03, 0.)) - .5)*1.5);
    g *= mix(.4, 1.3, sunlit)*mix(vec3(.7, .78, .95), vec3(1., .82, .55), golden)*dl;
    col = mix(g, hzc*.85, exp(-yy*60.)*.7);
  }
  // shafts and virga, far to near
  vec2 wv = windDir();
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float di = mix(dFront - .2, .9, fi/6.);
    float topY = hz + H/di, botY = hz - .06/di;
    float virga = step(.6, hash11(fi*3.7 + 1.));
    float endY = mix(botY, mix(topY, botY, .35 + .25*hash11(fi)), virga);
    float lean = wv.x*.35*mix(.2, 1.6, uX4);
    float xc = (hash11(fi*5.3) - .5)*3. + T*.01*wv.x*(1. + 1./di);
    xc = mod(xc + 1.6, 3.2) - 1.6;
    float wdt = (.12 + .2*hash11(fi*9.1))/di*mix(.5, 1.4, uX3);
    float x = uv.x - xc - lean*(topY - uv.y)*(1. + .3*(topY - uv.y)/(topY - botY));
    float prof = fbm2(vec2(x*8.*di, uv.y*2.*di + T*.05), 3.);
    float sh = 1. - smoothstep(wdt*.2, wdt, abs(x) + (prof - .5)*wdt*1.2);
    float streak = .55 + .45*noise2(vec2(x*200.*di, uv.y*3. + T*1.2));
    float vy = smoothstep(topY + .02, topY - .04, uv.y)*smoothstep(endY, endY + .06/di + virga*.08, uv.y);
    float a = sh*streak*vy*mix(.35, .8, uCoverage)*mix(.7, 1., hash11(fi*2.2));
    float back = exp(-abs(uv.x - sunP.x)*2.)*(1. - fi/8.);
    vec3 sc2 = mix(vec3(.24, .25, .31)*mix(1., .8, fi/6.), mix(vec3(.75, .78, .85), vec3(1., .72, .45), golden), back*.85)*dl;
    col = mix(col, sc2, a);
  }
  // a distant bolt inside one of the shafts
  {
    float sd = fl.y;
    float bxp = (hash11(sd*1.1) - .5)*1.4;
    if (uMouse.z > .5) bxp = (uMouse.x - .5)*uRes.x/uRes.y;
    float g = boltGlow(uv, vec2(bxp, hz + .12), .14, (hash11(sd*3.) - .5)*.3, sd, .0018)*fl.z;
    col += vec3(.8, .85, 1.)*g*fenv*1.5 + vec3(.4, .42, .5)*fenv*.15*smoothstep(-.2, .3, uv.y);
  }

#elif defined(MODE_6)
  // ---------- snow clouds and falling snow ----------
  float hz = -.05 + uDrag.y*.1;
  float sc = mix(1.8, .7, uScale);
  float oct = mix(2.5, 6.5, uDetail);
  float dl = mix(.25, 1., smoothstep(0., .5, DAY));
  vec3 sky = mix(vec3(.72, .74, .79), vec3(.34, .37, .45), smoothstep(hz, hz + .45, uv.y))*dl;
  col = sky;
  if (uv.y > hz + .002) {
    vec2 dk = deck(uv, hz, .25, sc, oct, uCoverage*.5 + .5, vec2(0., -1.));
    float far = smoothstep(.0, .12, uv.y - hz);
    vec3 cc = mix(vec3(.26, .28, .35), vec3(.66, .68, .75), dk.y*.9)*dl;
    col = mix(sky, cc, dk.x*far*.95);
  }
  // snowy hills, three layers
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float xo = uv.x + uDrag.x*(.05 + fi*.08);
    float hy = hz + .02 + fi*-.07 + .07*fbm2(vec2(xo*(1.2 + fi*.8) + fi*7., fi), 5.) - .02*fi;
    float m = smoothstep(.002, -.002, uv.y - hy);
    float sl = noise2(vec2(xo*8. + fi*7., (uv.y - hy)*25.));
    vec3 hc = mix(vec3(.95, .96, 1.), vec3(.66, .72, .84), smoothstep(.0, .3, hy - uv.y)*.6 + sl*.08)*mix(.9, 1.05, fi*.5);
    hc = mix(hc, sky*1.05, .55 - fi*.25)*dl;
    // pines on the nearest layers
    if (i > 0) {
      float tx = xo*mix(26., 14., fi - 1.);
      float id = floor(tx);
      float have = step(.35, hash11(id + fi*13.));
      float th = (.05 + .05*hash11(id*1.7))*(fi*.6);
      float lx = abs(fract(tx) - .5)/mix(26., 14., fi - 1.);
      float ty = uv.y - (hy - .005);
      float tri = step(0., ty)*step(ty, th)*step(lx, (th - ty)*.28*(.8 + .25*sin(ty*180.)));
      vec3 tc = mix(vec3(.06, .11, .1), vec3(.75, .8, .88), smoothstep(.6, .9, noise2(vec2(lx*900., ty*300.)))*.7)*dl;
      m = max(m, tri*have);
      hc = mix(hc, mix(tc, sky, .5 - fi*.2), tri*have);
    }
    col = mix(col, hc, m);
  }
  // falling snow, parallax layers
  float amt = mix(.15, .95, uX3);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float s = mix(28., 5., fi/4.);
    vec2 w = windDir();
    vec2 p = uv*s + vec2(-w.x*T*(.3 + fi*.25)*mix(.4, 2., uX4), T*(.5 + fi*.35)) + vec2(uDrag.x*fi, 0.);
    p.x += sin(p.y*.5 + fi)*.3;
    vec2 id = floor(p);
    vec2 f = fract(p) - .5;
    vec2 o = (hash22(id + fi*31.) - .5)*.7;
    o.x += sin(T*1.3 + hash12(id)*6.28)*.12;
    float r = mix(.035, .08, hash12(id + 3.))*(1. + fi*.1);
    float blur = mix(.4, 1., fi/4.);
    float fl2 = smoothstep(r, r*(1. - blur), length(f - o))*step(hash12(id + 7.), amt*mix(1., .35, fi/4.));
    col = mix(col, vec3(.97, .98, 1.)*mix(.6, 1., dl), fl2*mix(.55, .95, fi/4.));
  }

#elif defined(MODE_7)
  // ---------- rainbow after the storm ----------
  float hz = -.2 + uDrag.y*.1;
  float sc = mix(3.5, 1.2, uScale);
  float oct = mix(2.5, 6.5, uDetail);
  float dl = mix(.2, 1., smoothstep(0., .3, DAY));
  vec3 blue = mix(vec3(.62, .74, .9), vec3(.22, .42, .78), smoothstep(hz, .5, uv.y))*dl;
  // departing storm wall on the right
  float sx = .1 + .25*fbm2(vec2(uv.y*2., T*.01), 4.) - uDrag.x*.3 + (uCoverage - .5)*.4;
  float storm = smoothstep(sx - .05, sx + .15, uv.x + .15*(uv.y - hz));
  vec3 sdark = mix(vec3(.2, .22, .3), vec3(.32, .34, .42), fbm2(uv*vec2(3., 6.) + vec2(T*.02, 0.), oct))*dl;
  float rainv = .7 + .3*noise2(vec2(uv.x*120. - uv.y*20., uv.y*3. + T*2.));
  sdark *= rainv;
  vec3 sky = mix(blue, sdark, storm);
  // sunlit breaking cumulus
  vec2 cp = uv*sc + vec2(windDir().x*T*.05, 0.);
  vec2 q = vec2(fbm2(cp*.8, 4.), fbm2(cp*.8 + 5.2, 4.));
  float n = fbm2(cp + q*1.6, oct)*.8 + (1. - worley2(cp*2.3 + q))*.25;
  float cov = mix(.8, .5, uCoverage) + storm*.0;
  float d = clamp((n - cov)*3.5, 0., 1.)*smoothstep(hz + .02, hz + .25, uv.y);
  float d2 = clamp((fbm2(cp + q*1.6 + vec2(0., -.12), oct*.7)*.8 + (1. - worley2(cp*2.3 + q + vec2(0., -.15)))*.25 - cov)*3.5, 0., 1.);
  float shade = clamp(1. - d2*.9, 0., 1.);
  vec3 cc = mix(vec3(.55, .58, .68), vec3(1., .97, .9), shade)*dl;
  cc = mix(cc, cc*vec3(1., .85, .7), smoothstep(.5, .15, DAY));
  col = mix(sky, cc, d*(1. - storm*.6));
  // rainbow centred on the antisolar point
  vec2 A = vec2(-.1 + uDrag.x*.2, hz - mix(.02, .55, smoothstep(0., .9, DAY)));
  float r = length(uv - A);
  float R = .62*mix(.8, 1.25, uScale*.0 + .5);
  float k = (r - R)/.06;
  vec3 bow = clamp(abs(fract(vec3(.0, .66, .33) - k*.75 + 1.) * 6. - 3.) - 1., 0., 1.);
  bow = hsv2rgb(vec3(clamp(.78 - k*.8, 0., .8), .85, 1.));
  float band = smoothstep(.0, .25, k)*smoothstep(1.05, .75, k);
  float k2 = (r - R*1.24)/.09;
  vec3 bow2 = hsv2rgb(vec3(clamp(k2*.8, 0., .8), .8, 1.));
  float band2 = smoothstep(.0, .25, k2)*smoothstep(1.05, .75, k2);
  float vis = mix(.12, 1., storm)*smoothstep(hz, hz + .05, uv.y)*(1. - d*.8)*mix(.3, 1.2, uX3)*smoothstep(0., .3, DAY);
  col *= 1. - .18*vis*smoothstep(R + .07, R + .1, r)*smoothstep(R*1.24 + .02, R*1.22, r);
  col += .08*vis*smoothstep(R + .02, R - .1, r);
  col += bow*band*.36*vis + bow2*band2*.13*vis;
  // wet meadow
  if (uv.y < hz) {
    float yy = hz - uv.y, dist = .08/yy;
    vec2 gp = vec2(uv.x*dist, dist);
    float gn = fbm2(gp*vec2(4., 2.), 5.);
    vec3 g = mix(vec3(.18, .38, .12), vec3(.42, .6, .2), gn)*dl*mix(1.1, .6, storm);
    g *= .8 + .35*noise2(vec2(uv.x*300., uv.y*40.*dist));
    g *= mix(.75, 1.1, smoothstep(.3, .7, noise2(gp*vec2(.6, .4) + vec2(T*.03, 0.))));
    col = mix(g, mix(blue, sdark, storm), exp(-yy*50.)*.5);
    float bk = (length(vec2(uv.x, 2.*hz - uv.y) - A) - R)/.06;
    col += hsv2rgb(vec3(clamp(.78 - bk*.8, 0., .8), .8, 1.))*smoothstep(.0, .25, bk)*smoothstep(1.05, .75, bk)*.0;
  }
  col += vec3(.7, .75, .9)*fenv*.15*storm;

#else
  // ---------- rain on a window, storm outside ----------
  vec2 w = uv;
  float dropAmt = mix(.2, 1., uX3);
  // drops: static beads at two sizes plus running drops with trails
  vec2 off = vec2(0.); float dm = 0.; float rim = 0.;
  for (int L = 0; L < 2; L++) {
    float fl2 = float(L);
    float S = mix(9., 22., fl2);
    vec2 gp = w*S + vec2(0., fl2*3.7);
    vec2 id = floor(gp), f = fract(gp);
    vec2 h = hash22(id + fl2*17.);
    float life = fract(T*.05 + h.x*7.);
    float on = step(hash12(id + 3.), dropAmt*.8)*smoothstep(1., .85, life);
    vec2 c = .25 + .5*h;
    float r = max(mix(.12, .3, hash12(id + 9.))*smoothstep(0., .1, life), .01);
    vec2 dv = (f - c)/r;
    float dd = length(dv*vec2(1., 1.1));
    float m = smoothstep(1., .85, dd)*on;
    off += -dv*m*r/S*2.5;
    dm = max(dm, m);
    rim = max(rim, smoothstep(.65, 1., dd)*m);
  }
  // running drops
  {
    float S = 5.;
    vec2 gp = vec2(w.x*S*2., w.y*S*.5);
    float cid = floor(gp.x);
    float hx = hash11(cid*7.7);
    float run = step(hx, dropAmt*.6);
    float y = 1. - fract(T*(.05 + .08*hash11(cid*3.1)) + hx*5.);
    float fx = fract(gp.x) - .5 - .2*sin(gp.y*8. + cid)*.3;
    float dy = (fract(gp.y) - y)*4.;
    vec2 dv = vec2(fx*4., dy)/.55;
    float dd = length(dv);
    float m = smoothstep(1., .8, dd)*run;
    off += -vec2(dv.x, dv.y)*m*.02;
    rim = max(rim, smoothstep(.6, 1., dd)*m);
    dm = max(dm, m);
    // trail of beads above it
    float ty = fract(gp.y*6.);
    float tdd = length(vec2(fx*4.*1.5, (ty - .5)*1.2))/.28;
    float tm = smoothstep(1., .8, tdd)*run*step(y, fract(gp.y))*smoothstep(.35, .0, fract(gp.y) - y)*step(.3, hash11(floor(gp.y*6.) + cid));
    off += -vec2(fx, ty - .5)*tm*.012;
    dm = max(dm, tm);
  }
  // storm outside: sharp through drops (flipped), blurred elsewhere
  vec2 su = mix(w, w + off*6. - (w - (w + off))*0., dm);
  su = w + off*4.;
  float blur = mix(1., 0., dm);
  float oct = mix(5., 2., blur);
  float hz = -.4;
  float sdl = mix(.15, 1., smoothstep(0., .5, DAY));
  vec3 sky = mix(vec3(.62, .62, .66), vec3(.2, .22, .28), smoothstep(hz, .5, su.y))*sdl;
  vec2 dk = deck(vec2(su.x, max(su.y, hz + .01)), hz, .3, mix(1.6, .7, uScale), oct, .55 + uCoverage*.45, vec2(.3, -1.));
  vec3 cc = mix(vec3(.12, .13, .17), vec3(.55, .57, .63), dk.y)*sdl;
  vec3 bgc = mix(sky, cc, dk.x*smoothstep(hz, hz + .08, su.y));
  // town at the horizon
  float town = step(su.y, hz + .02*step(.5, hash11(floor(su.x*30.)))*hash11(floor(su.x*30.) + 1.) + .003);
  vec3 tcol = vec3(.1, .1, .13)*sdl;
  vec2 lp = su*vec2(90., 160.); vec2 lid = floor(lp);
  tcol += vec3(1., .7, .35)*step(.96, hash12(lid))*smoothstep(.5, .1, length(fract(lp) - .5))*mix(.4, 1., blur*0. + 1.)*step(su.y, hz + .02);
  bgc = mix(bgc, tcol, town);
  float bxp = (hash11(fl.y*1.1) - .5)*1.2;
  if (uMouse.z > .5) bxp = (uMouse.x - .5)*uRes.x/uRes.y;
  float g = boltGlow(su, vec2(bxp, .45), .45 - hz, (hash11(fl.y*3.) - .5)*.3, fl.y, mix(.002, .012, blur))*fl.z;
  bgc += vec3(.8, .85, 1.)*g*fenv*mix(1.5, .7, blur) + vec3(.35, .38, .5)*fenv*.35*smoothstep(-.3, .4, su.y);
  // soften the out-of-focus background
  bgc = mix(bgc, mix(sky, cc, .5), blur*.25);
  col = bgc*mix(1., .85, rim);
  col += vec3(.9, .95, 1.)*pow(max(0., dot(normalize(off + 1e-5), normalize(vec2(-.6, .8)))), 8.)*rim*.25*(.4 + fenv);
  // condensation haze
  col = mix(col, vec3(.5, .53, .58)*sdl, (1. - dm)*.12*(.5 + .5*noise2(w*3.)));
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'storm', name: 'Storm', fs, res: 0.5,
  defaults: {
    MODE: 0, DTN: 0.2, DTG: 0.02, STEPS: 90, DIST: 60, YMIN: 0, YMAX: 11, CAMY: 0.05, CAMYAW: 0, CAMPITCH: 0.2, FL: 1.2,
    SUNAZ: 2.4, SUNI: 1.0, SHADK: 1.6, DENS: 1.4, ALB: 1.0, EXPO: 1.3, LIGHTI: 6.0, LFALL: 0.6, FLASHRATE: 1.0,
    AMBT: [0.32, 0.38, 0.5], AMBB: [0.1, 0.11, 0.12], AMBLO: 1, AMBHI: 8,
    SKYTINT: [0.4, 0.45, 0.48], SKYGREY: 0.5, SKYGLOW: [0, 0, 0], FOGC: [0, 0, 0], FOGN: 5, FOGF: 60,
    GROUND: [0.16, 0.2, 0.1], LUP: 1.5, MOONI: 0, FORCE: 0, GLIT: 2.0, TZ: 6, PZ: 20, PZR: 4, BXR: 8, BOLTTOP: 1.3
  },
  params: [
    { id: 'x1', label: 'Lightning', value: 0.4 },
    { id: 'x2', label: 'Rotation', value: 0.5 },
    { id: 'x3', label: 'Precipitation', value: 0.5 },
    { id: 'x4', label: 'Turbulence', value: 0.5 },
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'storm-' + id, name, desc, opts, params, tags: ['storm', 'weather', ...tags] });
export const scenes = [
  d('supercell', 'Supercell Mothership', 'A rotating, striated supercell with an anvil overhead and lightning under the base. Hold to strike.',
    { MODE: 0, STEPS: 100, DTN: 0.22, DIST: 45, YMAX: 9.5, CAMPITCH: 0.3, FL: 1.1, SUNAZ: 1.8, SUNI: 2.8, SHADK: 1.3, SKYTINT: [0.26, 0.33, 0.33], SKYGREY: 0.7,
      AMBT: [0.3, 0.36, 0.44], AMBB: [0.08, 0.1, 0.09], AMBLO: 0.5, AMBHI: 9, PZ: 15, PZR: 2, BXR: 5, BOLTTOP: 1.2, SKYGLOW: [0.5, 0.42, 0.2], FOGC: [0.05, 0.05, 0.04], FOGF: 40 },
    { light: 0.3, coverage: 0.5, x1: 0.35, x2: 0.5, speed: 0.6 }, ['realistic', '3d', 'interactive', 'moody']),
  d('night', 'Night Lightning', 'Towering storms flicker from within as branching bolts reach the plains.',
    { MODE: 1, MOONI: 0.35, SKYGLOW: [0.05, 0.03, 0.02], STEPS: 100, DTN: 0.25, DTG: 0.03, DIST: 62, YMIN: 1.0, YMAX: 10.5, CAMPITCH: 0.1, FL: 1.2, LUP: 4, SUNAZ: 2.2, SUNI: 0.0, AMBT: [0.07, 0.08, 0.14], AMBB: [0.14, 0.08, 0.05], AMBLO: 1.2, AMBHI: 3,
      SKYTINT: [0.03, 0.04, 0.08], SKYGREY: 0.97, LIGHTI: 14, LFALL: 0.3, PZ: 34, PZR: 14, BXR: 34, BOLTTOP: 1.25, GROUND: [0.1, 0.11, 0.1], FOGC: [0.03, 0.025, 0.03], FOGN: 5, FOGF: 50, EXPO: 1.5, FLASHRATE: 1.6, GLIT: 1.0 },
    { light: 0.0, coverage: 0.55, x1: 0.6, speed: 0.4 }, ['realistic', '3d', 'night', 'interactive', 'moody']),
  d('shafts', 'Rain Shafts & Virga', 'Curtains of rain and wisps of virga hang from a dark base over golden plains.',
    { MODE: 2, FLASHRATE: 0.5 }, { light: 0.28, coverage: 0.55, x1: 0.25, x3: 0.55, x4: 0.4, speed: 0.45 }, ['realistic', '2d', 'distance', 'sunset']),
  d('tornado', 'Tornado Touchdown', 'A funnel snakes down from a rotating wall cloud, kicking up a debris whirl.',
    { MODE: 3, STEPS: 100, DTN: 0.1, DTG: 0.05, DIST: 40, YMIN: 0.3, YMAX: 3.4, CAMY: 0.06, CAMPITCH: 0.14, FL: 0.85, SUNAZ: 0.5, SHADK: 2.0, SKYTINT: [0.45, 0.52, 0.48], SKYGREY: 0.6,
      AMBT: [0.36, 0.4, 0.4], AMBB: [0.05, 0.06, 0.06], AMBLO: 0.4, AMBHI: 3, SKYGLOW: [0.6, 0.62, 0.45], FOGC: [0.08, 0.09, 0.07], FOGF: 35, GROUND: [0.22, 0.24, 0.12],
      PZ: 12, PZR: 4, BXR: 10, BOLTTOP: 1.0, DENS: 1.6, TZ: 2.8 },
    { light: 0.3, coverage: 0.55, x1: 0.15, x2: 0.6, speed: 0.55 }, ['realistic', '3d', 'moody', 'interactive']),
  d('mammatus', 'Mammatus at Sunset', 'Pouches hang from an anvil, lit orange from below by the setting sun.',
    { MODE: 4, STEPS: 80, DTN: 0.07, DTG: 0.05, DIST: 30, YMIN: 0.85, YMAX: 2.3, CAMPITCH: 0.42, FL: 1.0, SUNAZ: 1.0, SUNI: 1.6, SHADK: 1.2, SKYTINT: [0.3, 0.15, 0.2], SKYGREY: 0.3,
      AMBT: [0.22, 0.12, 0.18], AMBB: [0.25, 0.12, 0.12], AMBLO: 1, AMBHI: 2.2, SKYGLOW: [1.0, 0.45, 0.15], GROUND: [0.06, 0.05, 0.05], FOGC: [0.3, 0.12, 0.05], FOGN: 2, FOGF: 20, BOLTTOP: 0.9, PZ: 14, FLASHRATE: 0.4, GLIT: 1.0 },
    { light: 0.12, coverage: 0.55, x1: 0.0, x4: 0.4, speed: 0.4 }, ['realistic', '3d', 'sunset']),
  d('shelf', 'Shelf Cloud Arrives', 'A tiered arcus rolls in over sunlit fields with the storm’s dark mouth behind.',
    { MODE: 5, STEPS: 100, DTN: 0.1, DTG: 0.05, DIST: 40, YMIN: 0.35, YMAX: 5.6, CAMY: 0.05, CAMPITCH: 0.14, FL: 0.95, SUNAZ: 1.5, SUNI: 0.8, SHADK: 2.6, SKYTINT: [0.45, 0.55, 0.62], SKYGREY: 0.2,
      AMBT: [0.22, 0.27, 0.36], AMBB: [0.06, 0.07, 0.09], AMBLO: 0.45, AMBHI: 4, GROUND: [0.25, 0.3, 0.12], FOGC: [0.04, 0.04, 0.05], FOGN: 4, FOGF: 30, PZ: 9, PZR: 2, BXR: 10, BOLTTOP: 0.6, FLASHRATE: 0.6 },
    { light: 0.4, coverage: 0.5, x1: 0.2, x4: 0.4, speed: 0.55 }, ['realistic', '3d', 'moody']),
  d('snow', 'Snow Squall', 'Heavy grey snow clouds over pine ridges, flakes falling in deep parallax.',
    { MODE: 6, FLASHRATE: 0.0 }, { light: 0.6, coverage: 0.6, x3: 0.6, x4: 0.4, speed: 0.45 }, ['realistic', '2d', 'mountains']),
  d('rainbow', 'After the Storm', 'The storm wall retreats, the clouds break and a double rainbow appears.',
    { MODE: 7, FLASHRATE: 0.4 }, { light: 0.35, coverage: 0.5, x1: 0.15, x3: 0.6, speed: 0.4 }, ['realistic', '2d']),
  d('window', 'Rain on the Window', 'Drops bead and run down the glass, each one an upside-down storm.',
    { MODE: 8, FLASHRATE: 1.0 }, { light: 0.35, coverage: 0.6, x1: 0.35, x3: 0.6, speed: 0.4 }, ['realistic', '2d', 'moody', 'interactive']),
];
