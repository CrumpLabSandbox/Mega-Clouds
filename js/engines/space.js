// Space: clouds beyond Earth. Gas-giant bands (close flyover and whole globe), Saturn's polar hexagon with rings,
// Venus' sulfuric deck, a drifting emission nebula, and two fantasy cloud seas (floating islands, aurora).
import { shaderEngine } from '../gl.js';

const fs = `
float T, OCT;

vec3 stars(vec3 rd){
  vec3 c = vec3(0.);
  float dens = mix(.004, .03, uX4);
  for (int i = 0; i < 2; i++) {
    float K = i == 0 ? 90. : 210.;
    vec3 p = rd*K; vec3 id = floor(p); vec3 f = fract(p) - .5;
    float h = hash13(id + float(i)*17.);
    if (h < dens*(i == 0 ? .5 : 1.)) {
      vec3 o = (vec3(hash13(id + 3.1), hash13(id + 5.7), hash13(id + 9.2)) - .5)*.5;
      float d = length(f - o);
      float b = smoothstep(.14, 0., d)*(.35 + .65*hash13(id + 1.3))*(.8 + .2*sin(uClock*2.3 + h*400.));
      c += b*mix(vec3(1., .82, .62), vec3(.7, .82, 1.), hash13(id + 8.));
    }
  }
  return c;
}

vec3 cameraRay(vec2 uv, vec3 ro, vec3 ta, float fl){
  vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0., 1., 0.), f)), u = cross(f, r);
  return normalize(f*fl + r*uv.x + u*uv.y);
}
float sphereHit(vec3 ro, vec3 rd, vec3 c, float R){
  vec3 oc = ro - c; float b = dot(oc, rd); float h = b*b - dot(oc, oc) + R*R;
  if (h < 0.) return -1.; return -b - sqrt(h);
}
vec3 rotY(vec3 p, float a){ vec2 r = rot2(p.xz, a); return vec3(r.x, p.y, r.y); }
vec3 rotX(vec3 p, float a){ vec2 r = rot2(p.yz, a); return vec3(p.x, r.x, r.y); }

#if defined(MODE_0) || defined(MODE_1)
// ---------------- Jupiter ----------------
float wrapA(float a){ return mod(a + PI, TAU) - PI; }
// the Great Red Spot: a swirl whose inside spins at rate W (phase tt in seconds)
vec2 grsWarp(vec2 ll, float tt, float storm, out float grs){
  vec2 c = vec2(2.2, -.38);
  vec2 dl = vec2(wrapA(ll.x - c.x)*cos(ll.y), ll.y - c.y);
  vec2 e = dl/vec2(.2, .085);
  float r = length(e);
  e = rot2(e, 2.5*exp(-r*r*1.2)*storm + tt*smoothstep(1.3, .2, r));
  dl = e*vec2(.2, .085);
  grs = smoothstep(1.15, .7, r);
  return vec2(c.x + dl.x/cos(ll.y), c.y + dl.y);
}
vec3 jupPattern(float lon, float lat, float storm, float sc){
  vec3 q0 = vec3(cos(lon)*2.*sc, sin(lon)*2.*sc, lat*7.*sc);
  float w1 = fbm3(q0 + 3.1, 3.);
  float la = lat + (w1 - .5)*.07*storm;
  // zonal jets: each band slides at its own speed; the warped band edges hide the seams as festoons
  float bi = floor(la*BANDS/PI + .5);
  float jl = lon + T*(hash11(bi*7.3) - .5)*.06*mix(.2, 2.5, uX1);
  vec3 q = vec3(cos(jl)*3.*sc, sin(jl)*3.*sc, la*26.*sc);
  float fine = fbm3(q + vec3(w1*2.), OCT);
  float fine2 = fbm3(q*vec3(2., 2., 1.) + 9.1, OCT);
  float prof = .5 + .24*sin(la*BANDS + 1.3) + .16*sin(la*BANDS*1.73 + .4) + .1*sin(la*BANDS*3.1 + 2.);
  prof = mix(prof, .85, exp(-la*la*60.)*.8);
  float zone = smoothstep(.42, .62, prof + (fine - .5)*.5*storm);
  vec3 c = mix(mix(BELT1, BELT2, fine2), mix(ZONE1, ZONE2, fine2*.8), zone);
  c *= .8 + .35*fine;
  c = mix(c, c*vec3(.85, .9, 1.05), smoothstep(.4, .9, abs(lat)));
  c = mix(c, POLE*(.8 + .4*fine), smoothstep(.85, 1.25, abs(lat)));
  return vec3(c);
}
vec3 jupiter(float lon, float lat){
  float storm = mix(.3, 1.8, uX2);
  float sc = mix(1.7, .6, uScale);
  // a string of white ovals, gently sloshing
  float ovl = 0.;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(fi*1.6 - 2. + T*.004, -.62 + .03*sin(fi*3.));
    vec2 dl = vec2(wrapA(lon - c.x)*cos(lat), lat - c.y);
    vec2 e = dl/vec2(.05, .03);
    float r = length(e);
    e = rot2(e, (2. + .8*sin(T*.3 + fi))*exp(-r*r)*storm);
    dl = e*vec2(.05, .03);
    lon = c.x + dl.x/cos(lat); lat = c.y + dl.y;
    ovl = max(ovl, smoothstep(1., .6, r));
  }
  // the red spot spins continuously: two phases cross-faded so the swirl never winds up
  float W = .25*mix(.3, 2., uX1), P = 4.;
  float ph = fract(T/P);
  float grs;
  vec2 la = grsWarp(vec2(lon, lat), ph*P*W, storm, grs);
  vec3 c = jupPattern(la.x, la.y, storm, sc);
  if (grs > 0. || length(vec2(wrapA(lon - 2.2)*cos(lat)/.2, (lat + .38)/.085)) < 1.4) {
    float g2;
    vec2 lb = grsWarp(vec2(lon, lat), fract(ph + .5)*P*W, storm, g2);
    vec3 cb = jupPattern(lb.x, lb.y, storm, sc);
    float wa = 1. - abs(2.*ph - 1.);
    c = c*wa + cb*(1. - wa);
    float fine = fbm3(vec3(la*vec2(9., 20.), 1.)*sc, OCT);
    c = mix(c, GRSC*(.75 + .5*fine), grs*.8);
  }
  c = mix(c, vec3(.95, .93, .88), ovl*.85);
  return c;
}
#endif

#if defined(MODE_4)
// ---------------- Saturn's north pole ----------------
vec3 saturnPole(vec3 n){
  float th = acos(clamp(n.y, -1., 1.));     // colatitude
  float ph = atan(n.z, n.x);
  float sc = mix(1.6, .7, uScale);
  float storm = mix(.3, 1.8, uX2);
  float rot = T*.03*mix(.2, 2.5, uX1);
  // the eye: a tight vortex spinning faster near the pole
  float sw = (5.*exp(-th*14.) + T*.5*mix(.2, 2.5, uX1)*exp(-th*10.))*storm;
  float pa = ph + sw;
  float hx = th*cos(mod(ph + rot, PI/3.) - PI/6.)/cos(PI/6.);
  float m = mix(th, hx, smoothstep(.5, .3, th));
  vec3 q = vec3(cos(pa)*m*6.*sc, sin(pa)*m*6.*sc, m*14.*sc);
  float w = fbm3(q + 1.7, OCT);
  float mm = m + (w - .5)*.04*storm;
  float bi = floor(mm*30.);
  vec3 q2 = vec3(rot2(vec2(cos(pa), sin(pa))*mm*9.*sc, T*(hash11(bi) - .5)*.05), mm*60.*sc);
  float fine = fbm3(q2 + w, OCT);
  float bands = .5 + .3*sin(mm*34. + 1.) + .2*sin(mm*77. + fine*2.);
  vec3 outer = mix(vec3(.78, .66, .46), vec3(.93, .84, .64), bands)*(.85 + .3*fine);
  vec3 inner = mix(vec3(.28, .4, .5), vec3(.5, .6, .66), bands*.7 + fine*.3);
  vec3 c = mix(inner, outer, smoothstep(.31, .37, mm));
  // the hexagonal jet: a bright-dark ribbon
  float jet = exp(-abs(mm - .335)*110.);
  c = mix(c, vec3(.85, .8, .64), jet*.7);
  c *= 1. - .35*exp(-abs(mm - .31)*140.);
  c = mix(c, c*vec3(.8, .95, 1.1), smoothstep(.3, .1, mm)*.5);
  // eye
  c = mix(c, vec3(.12, .16, .2), smoothstep(.06, .015, th));
  c = mix(c, vec3(.6, .5, .4), exp(-abs(th - .07)*60.)*.5);
  return c;
}
float ringDens(float r){
  float d = 0.;
  d += .25*smoothstep(1.24, 1.26, r)*smoothstep(1.53, 1.51, r);            // C ring
  d += .85*smoothstep(1.52, 1.55, r)*smoothstep(1.95, 1.94, r);            // B ring
  d += .6*smoothstep(2.02, 2.03, r)*smoothstep(2.27, 2.26, r);             // A ring
  d *= 1. - .9*smoothstep(.003, .0, abs(r - 2.215));                        // Encke gap
  d *= .75 + .25*sin(r*380.) * .5 + .25*noise2(vec2(r*90., 1.));
  return clamp(d, 0., 1.);
}
#endif

// ---------------- cloud seas (modes 2, 5, 6) ----------------
#if defined(MODE_2) || defined(MODE_5) || defined(MODE_6)
// height of a billowy cloud sea at p (plane coordinates)
float seaH(vec2 p, float oct){
  vec2 w = windDir();
  p += w*T*SEASPD;
#if defined(MODE_2)
  p *= vec2(.45, 1.);                   // Venus: stretched by superrotation
#endif
  float n = fbm2(p + fbm2(p*.4 + 2.3, 3.)*1.2, oct);
  float b = 1. - worley2(p*1.2 + n*.8);
  return n*.7 + b*b*.45;
}
vec3 cloudSea(vec3 ro, vec3 rd, vec3 L, out float hit){
  hit = 0.;
  if (rd.y >= -.001) return vec3(0.);
  float t = (SEAY - ro.y)/rd.y;
  vec3 p = ro + rd*t;
  float sc = mix(1.4, .45, uScale);
  vec2 pp = p.xz*sc;
  float oct = OCT*smoothstep(80., 5., t) + 2.;
  float h = seaH(pp, oct);
  float e = .06;
  float hx = seaH(pp + vec2(e, 0.), oct*.7), hz = seaH(pp + vec2(0., e), oct*.7);
  vec3 n = normalize(vec3(-(hx - h)/e*.5, 1., -(hz - h)/e*.5));
  float dif = clamp(dot(n, L)*.6 + .4, 0., 1.);
  float lit = clamp(.5 + (h - seaH(pp + L.xz*.25, oct*.6))*2.5, 0., 1.);
  hit = smoothstep(.0, 1., (h - mix(.75, .2, uCoverage))*3. + .5);
  return vec3(dif*.6 + lit*.4, h, t);
}
#endif

void main(){
  T = uTime;
  OCT = mix(2.5, 7., uDetail);
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  vec3 col = vec3(0.);
  float sunEl = mix(-.3, 1.2, uLight);

#if defined(MODE_0)
  // ---------- skimming Jupiter's cloud tops ----------
  float alt = .04;
  vec3 ro = vec3(0., 1. + alt, 0.);
  float yaw = .55 + uDrag.x*.8, pit = -.42 + uDrag.y*.3;
  vec3 rd = cameraRay(uv, ro, ro + vec3(cos(yaw), pit, sin(yaw)), 1.0);
  vec3 sun = normalize(vec3(.75, sunEl*.7, -.45));
  float spin = T*.004*mix(.2, 2.5, uX1);
  float t = sphereHit(ro, rd, vec3(0.), 1.);
  vec3 bg = stars(rd)*.8;
  // the Galilean moon Io hanging above the limb
  vec3 mc = ro + normalize(vec3(.75, .02, .9))*4.;
  float tm = sphereHit(ro, rd, mc, .14);
  if (tm > 0.) { vec3 mn = normalize(ro + rd*tm - mc); float mf = fbm2(mn.xy*8. + mn.z*3., 4.);
    bg = mix(vec3(.95, .85, .45), vec3(.75, .45, .2), mf)*(clamp(dot(mn, sun), 0., 1.)*.95 + .03); }
  col = bg;
  // limb haze
  float b = length(cross(rd, -ro));
  col += vec3(.45, .6, .9)*exp(-max(b - 1., 0.)/.006)*.7*smoothstep(-.3, .3, sunEl)*mix(.4, 1.5, uX3);
  if (t > 0.) {
    vec3 n = normalize(ro + rd*t);
    vec3 nt = rotX(n, 1.67);              // tilt so the red spot's latitude is under us
    nt = rotY(nt, spin - 2.1);
    float lat = asin(clamp(nt.y, -1., 1.)), lon = atan(nt.z, nt.x);
    vec3 c = jupiter(lon*4., lat*4.);     // a zoomed-in patch: four times the detail
    float dif = clamp(dot(n, sun)*.8 + .2, 0., 1.);
    float graze = 1. - clamp(dot(n, -rd), 0., 1.);
    c *= dif*1.1 + .03;
    c = mix(c, vec3(.6, .7, .9)*(dif*.8 + .05), pow(graze, 5.)*.7*mix(.4, 1.5, uX3));
    col = c;
  }

#elif defined(MODE_1)
  // ---------- Jupiter, the whole globe ----------
  vec3 ro = rotY(vec3(0., .25, -3.6), uDrag.x*1.5);
  ro.y += uDrag.y*1.5;
  vec3 rd = cameraRay(uv, ro, vec3(0.), mix(1.3, 2.1, uScale*.0 + .5));
  float sa = mix(2.4, .2, uLight);
  vec3 sun = normalize(vec3(sin(sa), .1, -cos(sa)));
  float spin = T*.05*mix(.2, 2.5, uX1);
  col = stars(rd);
  // moon orbiting, casting a shadow
  float ma = T*.08 + 1.;
  vec3 mc = vec3(cos(ma)*1.9, sin(ma)*.12, sin(ma)*1.9);
  float tm = sphereHit(ro, rd, mc, .06);
  float t = sphereHit(ro, rd, vec3(0.), 1.);
  if (tm > 0. && (t < 0. || tm < t)) {
    vec3 mn = normalize(ro + rd*tm - mc); float mf = fbm2(mn.xy*8. + mn.z*3., 4.);
    col = mix(vec3(.95, .85, .45), vec3(.75, .45, .2), mf)*(clamp(dot(mn, sun), 0., 1.) + .02);
  } else if (t > 0.) {
    vec3 p = ro + rd*t, n = normalize(p);
    vec3 nt = rotY(n, -spin);
    float lat = asin(clamp(nt.y, -1., 1.)), lon = atan(nt.z, nt.x);
    vec3 c = jupiter(lon, lat);
    float dif = clamp(dot(n, sun), 0., 1.);
    float mu = clamp(dot(n, -rd), 0., 1.);
    c *= smoothstep(-.05, .3, dot(n, sun))*(.25 + .85*pow(mu, .35))*1.2;
    // moon shadow
    vec3 tom = mc - p; float along = dot(tom, sun);
    float sh = along > 0. ? smoothstep(.05, .07, length(tom - sun*along)) : 1.;
    c *= sh;
    col = c + vec3(.3, .4, .6)*pow(1. - mu, 4.)*dif*.4*mix(.4, 1.5, uX3);
  }
  float b = length(cross(rd, -ro));
  col += vec3(.4, .55, .9)*exp(-max(b - 1., 0.)/.02)*.35*step(t, 0.)*mix(.4, 1.5, uX3);

#elif defined(MODE_2)
  // ---------- Venus: inside the sulfuric deck ----------
  vec3 ro = vec3(0., 0., 0.);
  vec3 ta = vec3(uDrag.x*.8, -.12 + uDrag.y*.4, 1.);
  vec3 rd = cameraRay(uv, ro, ta, 1.1);
  vec3 L = normalize(vec3(-.3, max(sunEl, .05)*.6 + .2, .8));
  float hzv = rd.y;
  vec3 sky = mix(vec3(1., .86, .55), vec3(.5, .3, .12), smoothstep(-.05, .5, hzv));
  float sd = max(dot(rd, L), 0.);
  sky += vec3(1., .9, .65)*(pow(sd, 18.)*.8 + pow(sd, 4.)*.25)*mix(.5, 1.3, uX3);
  // overhead haze streaks
  if (rd.y > 0.) {
    vec2 hp = rd.xz/rd.y*1.5 + vec2(T*SEASPD*2.5, 0.);
    float hs = fbm2(hp*vec2(.4, 2.2), OCT*.7);
    sky = mix(sky, vec3(.9, .72, .42)*(.8 + .4*sd), smoothstep(.45, .8, hs)*.5*smoothstep(.0, .2, rd.y));
  }
  col = sky;
  float hit;
  vec3 cs = cloudSea(ro, rd, L, hit);
  if (rd.y < 0.) {
    float stv = fbm2((ro + rd*cs.z).xz*vec2(.06, .5)*mix(1.4, .45, uScale) + vec2(T*SEASPD*.3, 0.), 4.);
    vec3 cc = mix(vec3(.42, .24, .08), vec3(1., .9, .62), pow(cs.x, 1.4));
    cc *= mix(1.05, .7, smoothstep(.45, .7, stv));
    cc = mix(cc, cc*vec3(1., .85, .65), smoothstep(.3, .9, cs.y));
    float fog = 1. - exp(-cs.z*.035);
    cc = mix(cc, vec3(1., .85, .55), fog);
    col = mix(sky, cc, smoothstep(-.0, -.02, rd.y));
  }
  col *= mix(.25, 1.1, smoothstep(-.3, .6, sunEl));

#elif defined(MODE_3)
  // ---------- drifting through an emission nebula ----------
  float spd = mix(.05, .5, uX1);
  vec3 ro = vec3(sin(T*.03)*2., cos(T*.023)*1.5, T*spd);
  vec3 rd = normalize(vec3(uv, 1.2));
  rd.xz = rot2(rd.xz, uDrag.x*1.5 + sin(T*.02)*.3);
  rd.yz = rot2(rd.yz, -uDrag.y*1.5);
  float sc = mix(.9, .35, uScale);
  float cov = mix(.68, .42, uCoverage);
  vec3 L = vec3(0.); float Tr = 1.;
  float dt = .19;
  float t = .05 + dt*hash12(gl_FragCoord.xy);
  for (int i = 0; i < 46; i++) {
    vec3 p = (ro + rd*t)*sc;
    vec3 w = vec3(fbm3(p*.7 + 1.3, 2.), fbm3(p*.7 + 7.7, 2.), 0.);
    float f = fbm3(p + w*1.5, OCT);
    float e = smoothstep(cov, cov + .22, f);
    float hue = noise3(p*.6 + 4.);
    vec3 ec = hsv2rgb(vec3(fract(HUE0 + smoothstep(.25, .75, hue)*HUER), .8, 1.));
    ec = mix(ec, NEB3, smoothstep(.3, .8, e)*.6);
    float dust = smoothstep(.52, .62, fbm3(p*1.4 + w + 11., OCT*.7));
    L += Tr*ec*pow(e, 1.3)*dt*mix(.35, 1.6, uX3)*(1. - dust*.8);
    Tr *= exp(-(dust*1.8 + e*.3)*dt);
    t += dt*(1. + t*.04);
    if (Tr < .03) break;
  }
  vec3 bg = stars(rd)*1.2;
  col = bg*Tr + L;
  // bright stars embedded in the cloud, approaching as we drift
  for (int k = 0; k < 6; k++) {
    float SP = 1.6;
    float zw = (floor(ro.z/SP) + float(k) + 1.)*SP;
    float tz = (zw - ro.z)/max(rd.z, .05);
    vec2 hp = (ro + rd*tz).xy;
    vec2 id = floor(hp*.5);
    float hh = hash12(id + zw*.37);
    if (hh > .86 - uX4*.1) {
      vec2 sp = (id + .2 + .6*hash22(id + zw))*2.;
      vec2 d = (hp - sp)/tz;
      float r = length(d);
      float fade = smoothstep(SP*6., SP*2., tz)*smoothstep(.0, .5, tz);
      vec3 sc2 = mix(vec3(1., .75, .55), vec3(.7, .85, 1.), hash12(id + 2.));
      float g = .0008/(r*r + .0004) * .02 + exp(-r*400.)*1.5;
      g += (exp(-abs(d.x)*900.)*exp(-abs(d.y)*25.) + exp(-abs(d.y)*900.)*exp(-abs(d.x)*25.))*.6;
      col += sc2*g*fade*(.6 + .4*hh);
    }
  }
  col = 1. - exp(-col*1.3);

#elif defined(MODE_4)
  // ---------- Saturn's polar hexagon ----------
  float az = uDrag.x*1.5 + .4, el = clamp(1.2 + uDrag.y*1.2, .15, 1.5);
  vec3 ro = vec3(cos(el)*sin(az), sin(el), -cos(el)*cos(az))*mix(2.3, 3.8, 1. - uScale);
  vec3 rd = cameraRay(uv, ro, vec3(0., .6, 0.), 1.2);
  float sa = mix(2.6, .2, uLight);
  vec3 sun = normalize(vec3(sin(sa), .9, -cos(sa)));
  col = stars(rd);
  float t = sphereHit(ro, rd, vec3(0.), 1.);
  // rings in the equatorial plane
  float tr = -ro.y/rd.y;
  vec4 ring = vec4(0.);
  if (tr > 0.) {
    vec3 p = ro + rd*tr; float r = length(p.xz);
    float d = ringDens(r);
    if (d > 0.) {
      float sh = sphereHit(p, sun, vec3(0.), 1.) > 0. ? .15 : 1.;
      vec3 rc = mix(vec3(.75, .66, .52), vec3(.95, .88, .74), noise2(vec2(r*60., 0.)));
      rc *= (.35 + .75*abs(sun.y))*sh;
      ring = vec4(rc, d);
    }
  }
  if (t > 0. && (tr < 0. || t < tr || ring.a == 0.)) {
    vec3 p = ro + rd*t, n = normalize(p);
    vec3 c = saturnPole(n);
    if (n.y < .3) {
      // mid-latitudes: plain golden bands
      float lat = asin(n.y);
      float bnd = .5 + .3*sin(lat*24.) + .2*fbm2(vec2(atan(n.z, n.x)*2., lat*80.), 4.);
      c = mix(c, mix(vec3(.8, .68, .48), vec3(.95, .86, .66), bnd), smoothstep(.3, .15, n.y));
    }
    float dif = clamp(dot(n, sun), 0., 1.);
    float mu = clamp(dot(n, -rd), 0., 1.);
    // ring shadow on the planet
    float trs = -p.y/sun.y;
    float rsh = 1.;
    if (trs > 0.) { vec3 q = p + sun*trs; rsh = 1. - ringDens(length(q.xz))*.8; }
    c *= (smoothstep(-.05, .25, dot(n, sun))*.95 + .03)*(.35 + .75*pow(mu, .3))*rsh;
    c += vec3(.3, .45, .7)*pow(1. - mu, 5.)*dif*.25*mix(.4, 1.5, uX3);
    col = c;
    if (tr > 0. && tr < t) col = mix(col, ring.rgb, ring.a);
  } else if (ring.a > 0.) {
    col = mix(col, ring.rgb, ring.a);
  }

#elif defined(MODE_5)
  // ---------- alien cloud ocean with floating islands ----------
  vec3 ro = vec3(0., 0., 0.);
  vec3 ta = vec3(uDrag.x*.8, -.05 + uDrag.y*.4, 1.);
  vec3 rd = cameraRay(uv, ro, ta, 1.1);
  float day = uLight;
  vec3 L = normalize(vec3(.5, max(sunEl, .05)*.5 + .08, .8));
  vec3 skyT = mix(vec3(.08, .06, .2), vec3(.32, .5, .78), smoothstep(0., .6, day));
  vec3 skyH = mix(vec3(.5, .25, .4), vec3(1., .72, .7), smoothstep(0., .6, day));
  vec3 sky = mix(skyH, skyT, pow(clamp(rd.y + .02, 0., 1.), .5));
  sky += stars(rd)*smoothstep(.4, .1, day);
  // twin suns
  float s1 = max(dot(rd, L), 0.);
  vec3 L2 = normalize(L + vec3(.12, .05, 0.));
  float s2 = max(dot(rd, L2), 0.);
  sky += vec3(1., .85, .7)*(smoothstep(.9996, .9998, s1)*2. + pow(s1, 30.)*.4) + vec3(.7, .85, 1.)*(smoothstep(.9998, .9999, s2)*2. + pow(s2, 60.)*.3);
  // a ringed giant rising
  vec3 pc = normalize(vec3(-.55, .28, 1.))*10.;
  float tp = sphereHit(ro, rd, pc, 2.2);
  {
    vec3 rn = normalize(vec3(.35, 1., -.9));
    float trp = dot(pc - ro, rn)/dot(rd, rn);
    vec3 rp = ro + rd*trp - pc; float rr = length(rp)/2.2;
    float rdn = smoothstep(1.4, 1.45, rr)*smoothstep(2.3, 2.2, rr)*(.6 + .4*sin(rr*60.));
    bool front = tp < 0. || trp < tp;
    if (tp > 0.) {
      vec3 n = normalize(ro + rd*tp - pc);
      float bands = .5 + .5*sin(dot(n, rn)*14. + fbm2(n.xy*6., 3.)*2.);
      vec3 pcol = mix(vec3(.85, .55, .7), vec3(.55, .75, .9), bands)*(smoothstep(-.3, .6, dot(n, normalize(L + vec3(.6, 0., -.3))))*.85 + .2);
      sky = mix(sky, mix(pcol, skyH, .25), .92);
    }
    if (front || tp < 0.) sky = mix(sky, vec3(1., .9, .85)*.9, rdn*.6);
  }
  col = sky;
  float hit;
  ro.y = 0.;
  vec3 cs = cloudSea(ro, rd, L, hit);
  if (rd.y < 0.) {
    vec3 cc = mix(SEA1, SEA2, cs.x)*mix(.3, 1., smoothstep(0., .5, day));
    float fog = 1. - exp(-cs.z*.04);
    cc = mix(cc, skyH*.95, fog);
    col = mix(sky, cc, smoothstep(.0, -.015, rd.y));
  }
  // floating islands, far to near (screen-space sprites set at depths)
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float di = mix(14., 3.2, fi/5.);
    float xw = (hash11(fi*4.3) - .5)*di*1.6 + T*.08*windDir().x*(1. + 3./di);
    float span = di*1.8;
    xw = mod(xw + span*.5, span) - span*.5;
    float yw = SEAY + 1.4 + .9*hash11(fi*7.1) + .08*sin(T*.4 + fi*2.);
    vec3 cw = vec3(xw, yw, di);
    vec3 dir = cw - ro;
    // project onto screen through the same camera
    vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0., 1., 0.), f)), u = cross(f, r);
    float z = dot(dir, f);
    if (z < .5) continue;
    vec2 sp = vec2(dot(dir, r), dot(dir, u))/z*1.1;
    float s = (.55 + .5*hash11(fi*2.9))/z*1.1;
    vec2 q = (uv - sp)/s;
    float nx = q.x;
    // grassy cap
    float capTop = .14*(1. - nx*nx) + .03*noise2(vec2(nx*8., fi));
    float body = 1.25*(1. - pow(abs(nx), 1.3))*(.75 + .4*fbm2(vec2(nx*4. + fi*3., fi), 4.));
    float inside = step(abs(nx), 1.)*step(q.y, capTop)*step(-body, q.y);
    // trees: round puffs on the top
    float tree = 0.;
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      vec2 tc = vec2((hash11(fi*3. + fj) - .5)*1.3, 0.);
      tc.y = .14*(1. - tc.x*tc.x) + .18 + .1*hash11(fi + fj*5.);
      float tr = .14 + .08*hash11(fi*9. + fj);
      tree = max(tree, step(length(q - tc), tr));
      tree = max(tree, step(abs(q.x - tc.x), .025)*step(q.y, tc.y)*step(.1, q.y));
    }
    float a = max(inside, tree);
    // waterfall off one edge
    float wx = .55*sign(hash11(fi*6.6) - .5);
    float wf = smoothstep(.05, .0, abs(q.x - wx - .02*sin(q.y*10. + T*3.)))*step(q.y, .05)*smoothstep(-2.8, 0., q.y)*(.6 + .4*noise2(vec2(q.x*20., q.y*6. + T*4.)));
    float sea = smoothstep(.0, -.04, uv.y - (SEAY/z*1.1)*(1. - .0));  // hidden below the nearer cloud tops
    if (a > 0. || wf > 0.) {
      float depthT = (capTop - q.y)/(capTop + body + 1e-3);
      vec3 rock = mix(vec3(.55, .38, .42), vec3(.18, .12, .2), depthT)*(.75 + .35*fbm2(q*vec2(3., 14.) + fi, 4.));
      rock *= .7 + .5*clamp(-nx*L.x + .5, 0., 1.);
      vec3 grass = mix(vec3(.25, .75, .6), vec3(.55, .95, .7), smoothstep(-.05, .1, q.y - capTop + .06));
      vec3 ic = mix(rock, grass, step(capTop - .07, q.y)*inside);
      ic = mix(ic, mix(vec3(.9, .45, .65), vec3(1., .7, .8), q.y - .2), tree*(1. - inside*step(q.y, capTop - .01)));
      ic *= mix(.35, 1., smoothstep(0., .5, day));
      float haze = 1. - exp(-di*.06);
      ic = mix(ic, skyH, haze);
      col = mix(col, ic, a*(1. - sea*.0));
      col = mix(col, mix(vec3(.85, .95, 1.), skyH, haze), wf*.7*(1. - a));
    }
  }

#else
  // ---------- aurora over a cloud sea ----------
  vec3 ro = vec3(0., 0., 0.);
  vec3 ta = vec3(uDrag.x*.8, .12 + uDrag.y*.4, 1.);
  vec3 rd = cameraRay(uv, ro, ta, 1.0);
  vec3 sky = mix(vec3(.02, .04, .08), vec3(.0, .01, .03), clamp(rd.y*1.5, 0., 1.));
  sky += stars(rd)*1.1;
  vec3 mdir = normalize(vec3(-.6, .22, .8));
  float md = dot(rd, mdir);
  sky += vec3(.9, .92, 1.)*smoothstep(.99965, .9998, md) + vec3(.15, .18, .26)*pow(max(md, 0.), 60.);
  // milky way
  float mw = fbm2(vec2(dot(rd, normalize(vec3(1., .6, .3)))*5., rd.y*3.), 5.);
  sky += vec3(.15, .14, .2)*smoothstep(.25, .0, abs(dot(rd, normalize(vec3(.4, -.3, .8)))))*mw*.6;
  // aurora curtains: stacked planes
  vec3 aur = vec3(0.);
  float glow = mix(.4, 1.8, uX3);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float h = 1. + fi*.07;
    vec3 dir = rd;
    if (dir.y < .01) break;
    vec2 p = dir.xz*(h/dir.y);
    float curve = 5. + 2.2*sin(p.x*.18 + T*.07) + 1.1*sin(p.x*.47 - T*.11) + 2.*fbm2(vec2(p.x*.25 + T*.03, 0.), 3.);
    float d = p.y - curve;
    float rays = .5 + .5*noise2(vec2(p.x*2.5 + d*.3 + T*.4, 0.));
    rays = pow(rays, 2.5)*1.8 + .15;
    float I = exp(-abs(d)*(d < 0. ? 3. : 1.))*rays*smoothstep(30., 6., length(p));
    vec3 ac = mix(vec3(.15, 1., .45), vec3(.75, .2, .85), smoothstep(6., 24., fi));
    aur += ac*I*(1. - fi/30.)*.13;
  }
  sky += aur*glow;
  col = sky;
  float hit;
  vec3 Lm = normalize(vec3(-.6, .22, .8));
  vec3 cs = cloudSea(ro, rd, Lm, hit);
  if (rd.y < 0.) {
    vec3 cc = mix(vec3(.04, .06, .11), vec3(.32, .38, .5), cs.x);
    // the aurora's green glow on the cloud tops
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    float ag = 0.;
    for (int i = 0; i < 6; i++) {
      float h = 1. + float(i)*.25; vec2 p = rr.xz*(h/max(rr.y, .01));
      ag += exp(-abs(p.y - 5. - 2.2*sin(p.x*.18 + T*.07))*.6);
    }
    cc += vec3(.1, .45, .25)*ag*.08*glow*(.4 + .6*cs.y);
    float fog = 1. - exp(-cs.z*.03);
    cc = mix(cc, vec3(.03, .07, .08) + aur*glow*.2, fog);
    col = mix(sky, cc, smoothstep(.0, -.015, rd.y));
  }
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'space', name: 'Space', fs, res: 0.5,
  defaults: {
    MODE: 0, BANDS: 19, SEAY: -0.35, SEASPD: 0.05,
    BELT1: [0.52, 0.36, 0.26], BELT2: [0.74, 0.56, 0.4], ZONE1: [0.94, 0.91, 0.84], ZONE2: [0.86, 0.78, 0.64],
    POLE: [0.45, 0.45, 0.5], GRSC: [0.78, 0.35, 0.2],
    HUE0: 0.52, HUER: 0.42, NEB3: [1.0, 0.9, 0.75],
    SEA1: [0.42, 0.3, 0.55], SEA2: [1.0, 0.8, 0.82]
  },
  params: [
    { id: 'x1', label: 'Spin', value: 0.5 },
    { id: 'x2', label: 'Storms', value: 0.5 },
    { id: 'x3', label: 'Glow', value: 0.5 },
    { id: 'x4', label: 'Stars', value: 0.5 },
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'space-' + id, name, desc, opts, params, tags: ['space', 'fantasy', ...tags] });
export const scenes = [
  d('jupiter-flyover', 'Jovian Cloud Tops', 'Skimming Jupiter’s belts and zones past the Great Red Spot, Io above the limb.',
    { MODE: 0 }, { light: 0.6, scale: 0.2, x1: 0.5, x2: 0.55, speed: 0.5 }, ['realistic', '3d', 'interactive']),
  d('jupiter-globe', 'Jupiter Turning', 'The whole banded giant rotating, a moon and its shadow crossing the clouds.',
    { MODE: 1 }, { light: 0.7, x1: 0.5, x2: 0.5, speed: 0.5 }, ['realistic', '3d', 'interactive']),
  d('venus', 'Venusian Haze', 'Sulfuric cloud decks streaming under a smothered yellow sky.',
    { MODE: 2, SEAY: -0.3, SEASPD: 0.25 }, { light: 0.7, coverage: 0.6, scale: 0.45, speed: 0.55 }, ['3d', 'moody']),
  d('nebula', 'Nebula Drift', 'Gliding through glowing gas and dark dust lanes, young stars sliding past.',
    { MODE: 3 }, { coverage: 0.62, scale: 0.5, x1: 0.4, x3: 0.65, x4: 0.6, speed: 0.5 }, ['3d', 'abstract', 'interactive']),
  d('saturn-hexagon', 'Saturn’s Hexagon', 'The six-sided polar jet and its spinning eye, framed by the rings.',
    { MODE: 4 }, { light: 0.6, scale: 0.5, x1: 0.5, x2: 0.55, speed: 0.5 }, ['realistic', '3d', 'interactive']),
  d('islands', 'Sky Islands', 'Floating islands drift over a pastel cloud ocean beneath twin suns and a ringed giant.',
    { MODE: 5, SEAY: -0.4 }, { light: 0.6, coverage: 0.55, scale: 0.5, speed: 0.45 }, ['3d', 'pastel', 'sea']),
  d('aurora', 'Aurora Cloud Sea', 'Green and violet curtains ripple over a moonlit sea of clouds.',
    { MODE: 6, SEAY: -0.3, SEASPD: 0.03 }, { light: 0.05, coverage: 0.55, scale: 0.5, x3: 0.55, speed: 0.45 }, ['3d', 'night']),
];
