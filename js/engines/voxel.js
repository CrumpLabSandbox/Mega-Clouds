// Blocky 3D clouds. MODE 0: a Minecraft-style flat cloud layer, grid-marched in 2D (seen from below or above).
// MODE 1: an isometric voxel diorama with cumulus built from cubes (3D DDA, per-face AO, cast shadows).
// MODE 2: a low-poly world: SDF clouds flat-shaded per Voronoi facet over a faceted sea.
// MODE 3: sugar-cube clouds: clusters of rounded cubes in pastel colours.
import { shaderEngine } from '../gl.js';

const fs = `
float T, DAY, NIGHT, FK, LIFT;
vec3 SUN, WIND, KEYC, AMB;

vec3 skyGrad(vec3 rd){
  vec3 top = TOP, bot = BOT;
  float dusk = smoothstep(.5, .1, DAY)*(1. - NIGHT);
  top = mix(top, vec3(.22, .2, .45), dusk*.7); bot = mix(bot, vec3(1., .62, .45), dusk*.85);
  top = mix(top, vec3(.01, .015, .05), NIGHT); bot = mix(bot, vec3(.05, .07, .16), NIGHT);
  vec3 col = mix(bot, top, smoothstep(-.1, .7, rd.y));
  return col;
}

// ---------- MODE 0: Minecraft flat layer ----------
float CSZ;
float layerOn(vec2 cell){
  float n = fbm2(cell*mix(.16, .1, uScale) + 3.1, 3.)*.75 + hash12(cell)*.25*uDetail;
  return step(mix(.78, .38, uCoverage), n);
}
vec2 layerOff(){ return WIND.xz*T*LAYSPD; }
// returns t of the hit and the face normal in n (0 if none); a = alpha
float marchLayer(vec3 ro, vec3 rd, out vec3 nrm){
  nrm = vec3(0.);
  float y0 = LAYY + LIFT*12., y1 = y0 + LAYH;
  float t0, t1;
  if (abs(rd.y) < 1e-5) { if (ro.y < y0 || ro.y > y1) return -1.; t0 = 0.; t1 = 600.; }
  else { float ta = (y0 - ro.y)/rd.y, tb = (y1 - ro.y)/rd.y; t0 = max(min(ta, tb), 0.); t1 = min(max(ta, tb), 600.); }
  if (t1 <= t0) return -1.;
  vec2 off = layerOff();
  vec2 g = (ro.xz + rd.xz*t0 - off)/CSZ;
  vec2 cell = floor(g);
  vec2 rdg = rd.xz + vec2(rd.x == 0. ? 1e-6 : 0., rd.z == 0. ? 1e-6 : 0.);
  vec2 st = sign(rdg);
  vec2 tD = CSZ/abs(rdg);
  vec2 tM = t0 + (cell + max(st, 0.) - g)*CSZ/rdg;
  float t = t0; int axis = -1;
  for(int i=0;i<90;i++){
    if (layerOn(cell) > .5) {
      if (axis < 0) nrm = vec3(0., ro.y < y0 ? -1. : 1., 0.);
      else if (axis == 0) nrm = vec3(-st.x, 0., 0.);
      else nrm = vec3(0., 0., -st.y);
      return t;
    }
    if (tM.x < tM.y) { t = tM.x; tM.x += tD.x; cell.x += st.x; axis = 0; }
    else { t = tM.y; tM.y += tD.y; cell.y += st.y; axis = 1; }
    if (t > t1) break;
  }
  return -1.;
}
float layerShadow(vec3 p){
  float t = (LAYY + LIFT*12. + LAYH*.5 - p.y)/max(SUN.y, .1);
  vec3 q = p + SUN*t;
  return layerOn(floor((q.xz - layerOff())/CSZ));
}
vec3 groundCol(vec2 p){
  vec2 c = floor(p/GSZ);
  float n = fbm2(c*.045 + 7., 4.);
  float h = hash12(c);
  vec3 col = vec3(.36, .6, .22)*(.85 + .3*h);                 // grass
  col = mix(col, vec3(.18, .38, .16)*(.8 + .3*h), step(.56, n)); // forest
  col = mix(col, vec3(.85, .8, .55), step(n, .4));            // sand
  col = mix(col, vec3(.16, .36, .72)*(.9 + .1*h), step(n, .37)); // water
  vec2 f = fract(p/GSZ);
  col *= .92 + .08*step(.06, min(min(f.x, f.y), min(1. - f.x, 1. - f.y)));
  return col;
}
vec3 squareDisc(vec3 rd, vec3 d, float size){
  vec3 a = normalize(cross(d, vec3(0., 1., 0.))), b = cross(a, d);
  vec2 q = vec2(dot(rd, a), dot(rd, b));
  return vec3(step(max(abs(q.x), abs(q.y)), size)*step(0., dot(rd, d)), max(abs(q.x), abs(q.y)), 0.);
}

// ---------- MODE 1: iso voxel diorama ----------
float occ(vec3 c){
  if (abs(c.x + .5) > BOX || abs(c.z + .5) > BOX) return 0.;
  if (c.y < 0.) return c.y >= -3. ? 1. : 0.;
  vec3 q = c + .5;
  float hg = q.y - BASEY - floor(LIFT*3.);
  if (hg < -2. || hg > 12.) return 0.;
  vec3 dr = WIND*T*1.1;
  float sc = mix(.2, .09, uScale);
  vec2 h2 = (q.xz - dr.xz)*sc;
  float n = noise2(h2)*.75 + noise2(h2*2.3 + 5.)*.25;
  float edge = max(abs(q.x), abs(q.z))/BOX;
  float v = n - mix(.7, .45, uCoverage) - smoothstep(.55, 1., edge)*.35;
  float top = sqrt(max(v, 0.))*11. + (noise3((q - dr)*sc*1.8) - .5)*2.5*(.3 + .7*uDetail);
  float bot = -v*4.;
  return step(0., v)*step(hg, top)*step(bot, hg - 1.5);
}
float isoShadow(vec3 c){
  // walk cells toward the sun from the cell above c
  float s = 1.;
  vec3 p = c + .5;
  for(int i=1;i<26;i++){ vec3 q = floor(p + SUN*float(i)*.9); if (q.y > 0. && occ(q) > .5) { s = .45; break; } if (q.y > BASEY + 13.) break; }
  return s;
}

// ---------- MODE 2/3: SDF cloud clusters ----------
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
float rbox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r; }
vec3 CID;
float clouds(vec3 p){
  vec3 q = p; q.xz -= WIND.xz*T*CSPD;
  float cs = CELL;
#if defined(MODE_3)
  vec3 id = floor(q/cs); vec3 l = q - (id + .5)*cs;
#else
  vec3 id = vec3(floor(q.xz/cs), 0.).xzy; vec3 l = vec3(q.x - (id.x + .5)*cs, q.y - CLY - LIFT*2., q.z - (id.z + .5)*cs);
#endif
  CID = id;
  float edge = cs*.5 - max(abs(l.x), max(abs(l.z), MODE == 3. ? abs(l.y) : 0.));
  float has = step(hash13(id + 4.2), mix(.25, 1., uCoverage));
  if (has < .5) return max(edge, 0.) + .3;
  float sz = mix(.6, 1.1, uScale);
  vec3 c0 = (vec3(hash13(id), hash13(id + 1.3), hash13(id + 2.7)) - .5)*cs*vec3(.2, .15, .2);
  float d = 1e3;
#if defined(MODE_3)
  for(int k=0;k<6;k++){
    float fk = float(k);
    vec3 h = vec3(hash13(id + fk*3.1), hash13(id + fk*5.7 + 1.), hash13(id + fk*7.3 + 2.));
    vec3 o = c0 + (h - .5)*vec3(3.2, 1.2, 2.2)*sz + vec3(0., (k < 3 ? .0 : .8)*sz, 0.);
    float s = mix(.55, 1.05, hash13(id + fk*9.1))*sz*(k < 3 ? 1. : .8);
    vec3 lp = l - o; lp.xz = rot2(lp.xz, (h.x - .5)*.8 + sin(T*.3 + fk)*.05);
    d = min(d, rbox(lp, vec3(s), .12*s));
  }
#else
  for(int k=0;k<6;k++){
    float fk = float(k);
    vec3 h = vec3(hash13(id + fk*3.1), hash13(id + fk*5.7 + 1.), hash13(id + fk*7.3 + 2.));
    vec3 o = c0 + (h - .5)*vec3(4.2, .6, 2.4)*sz + vec3(0., .35*sz, 0.);
    float r = mix(.9, 1.6, hash13(id + fk*9.1))*sz*(1. - abs(h.x - .5)*.6);
    d = smin(d, length(l - o) - r, .7*sz);
  }
  d = max(d, -(l.y + .2*sz)); // flat base
#endif
  return min(d, max(edge, 0.) + .3);
}
float sceneSDF(vec3 p){
  float d = clouds(p);
  return d;
}
vec3 sdfNormal(vec3 p){
  vec2 e = vec2(.01, 0.);
  return normalize(vec3(clouds(p + e.xyy) - clouds(p - e.xyy), clouds(p + e.yxy) - clouds(p - e.yxy), clouds(p + e.yyx) - clouds(p - e.yyx)));
}
// nearest Worley feature point, for flat facets
vec3 facetPoint(vec3 p){
  vec3 i = floor(p), f = fract(p); float best = 9.; vec3 bp = vec3(0.);
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(x, y, z); vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 31.7));
    vec3 r = g + o - f; float dd = dot(r, r); if (dd < best) { best = dd; bp = i + g + o; } }
  return bp;
}
vec2 facet2(vec2 p, out vec2 cid){
  vec2 i = floor(p), f = fract(p); float best = 9.; vec2 bp = vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(x, y); vec2 r = g + hash22(i + g) - f; float dd = dot(r, r); if (dd < best) { best = dd; bp = i + g + hash22(i + g); } }
  cid = floor(bp*7.); return bp;
}

void main(){
  T = uTime; FK = FOGK*mix(.3, 2.2, uX2); LIFT = (uX1 - .5)*2.;
  vec2 uv = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  DAY = uLight; NIGHT = smoothstep(.15, .04, DAY);
  vec2 wd = windDir(); WIND = vec3(wd.x, 0., wd.y);
  float el = mix(-.1, 1.15, DAY);
  SUN = normalize(vec3(sin(SUNAZ)*cos(el), sin(el), cos(SUNAZ)*cos(el)));
  if (NIGHT > .5) SUN = normalize(vec3(sin(SUNAZ + 2.)*.85, .5, cos(SUNAZ + 2.)*.85));
  float dusk = smoothstep(.5, .1, DAY)*(1. - NIGHT);
  KEYC = mix(vec3(1., .97, .9), vec3(1., .6, .38), dusk)*mix(1., .22, NIGHT)*mix(vec3(1.), vec3(.6, .7, 1.), NIGHT);
  AMB = skyGrad(vec3(0., 1., 0.))*.6 + .15*(1. - NIGHT);
  vec3 col;

#if defined(MODE_1)
  // orthographic iso camera
  float yaw = .785 + uDrag.x*1.6 + T*.03*uX4;
  float pit = clamp(.62 + uDrag.y*.6, .12, 1.45);
  vec3 fw = -vec3(cos(pit)*sin(yaw), sin(pit), cos(pit)*cos(yaw));
  vec3 rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);
  float zoom = BOX*mix(2.3, 1.6, uX3);
  vec3 rd = fw;
  vec3 ro = vec3(0., BASEY*.5, 0.) + (rt*uv.x + up*uv.y)*zoom - fw*80.;
  col = skyGrad(normalize(vec3(uv.x, uv.y + .4, 1.)));
  // box intersection
  vec3 bmin = vec3(-BOX, -3., -BOX), bmax = vec3(BOX, BASEY + 12., BOX);
  vec3 ird = 1./rd;
  vec3 ta = (bmin - ro)*ird, tb = (bmax - ro)*ird;
  vec3 tn = min(ta, tb), tf = max(ta, tb);
  float t0 = max(max(tn.x, tn.y), tn.z), t1 = min(min(tf.x, tf.y), tf.z);
  if (t1 > max(t0, 0.)) {
    vec3 p = ro + rd*(t0 + 1e-3);
    vec3 c = floor(p);
    vec3 st = sign(rd);
    vec3 tD = abs(ird);
    vec3 tM = (c + max(st, 0.) - p)*ird;
    vec3 nrm = -st*step(tn.yzx, tn)*step(tn.zxy, tn);
    bool hit = false;
    for(int i=0;i<110;i++){
      if (occ(c) > .5) { hit = true; break; }
      vec3 m = step(tM, tM.yzx)*step(tM, tM.zxy);
      tM += m*tD; c += m*st; nrm = -m*st;
      if (any(greaterThan(abs(c + .5), vec3(BOX + 1., 40., BOX + 1.))) || c.y < -4.) break;
    }
    if (hit) {
      // hit position on the face for AO weights
      vec3 tPrev = tM - tD*abs(nrm);
      float th = dot(tPrev, abs(nrm));
      vec3 hp = p + rd*th;
      vec3 U = abs(nrm.x) > .5 ? vec3(0., 1., 0.) : vec3(1., 0., 0.);
      vec3 V = cross(abs(nrm), U);
      vec2 f = vec2(dot(fract(hp), U), dot(fract(hp), V));
      vec3 cn = c + nrm;
      float s1 = occ(cn + U), s2 = occ(cn - U), s3 = occ(cn + V), s4 = occ(cn - V);
      float ao = s1*f.x + s2*(1. - f.x) + s3*f.y + s4*(1. - f.y);
      ao += occ(cn + U + V)*f.x*f.y + occ(cn - U + V)*(1. - f.x)*f.y + occ(cn + U - V)*f.x*(1. - f.y) + occ(cn - U - V)*(1. - f.x)*(1. - f.y);
      ao = 1. - .55*clamp(ao*.7, 0., 1.);
      float face = nrm.y > .5 ? 1. : nrm.y < -.5 ? .55 : (abs(nrm.x) > .5 ? .82 : .7);
      float dif = max(dot(nrm, SUN), 0.);
      vec3 base;
      if (c.y < 0.) {
        vec2 cc = c.xz;
        float n = fbm2(cc*.12 + 3., 3.);
        vec3 grass = vec3(.38, .62, .26)*(.85 + .3*hash12(cc));
        vec3 water = vec3(.2, .45, .78)*(.9 + .15*sin(T*2. + hash12(cc)*6.));
        base = c.y < -1.5 || nrm.y < .5 ? vec3(.5, .34, .22)*(.8 + .3*hash13(c)) : mix(grass, water, step(n, .42));
        if (c.y > -1.5 && nrm.y < .5) base = mix(base, vec3(.38, .62, .26), step(.75, dot(fract(hp), vec3(0., 1., 0.))));
      } else {
        base = mix(vec3(.9, .92, .98), vec3(1.), clamp((c.y - BASEY)/5., 0., 1.));
      }
      float sh = dif > 0. ? isoShadow(c + nrm) : 1.;
      col = base*(KEYC*dif*sh*.55 + AMB*.4 + .42)*face*ao;
    }
  }
#elif defined(MODE_0)
  CSZ = mix(5., 14., uScale);
  vec3 ro = CAMP + vec3(WIND.x, 0., WIND.z)*T*CAMSPD;
  float yaw = uDrag.x*1.4 + CAMYAW + sin(T*.03)*.2*uX4;
  float pit = clamp(CAMPIT + uDrag.y*.8, -1.4, 1.4);
  vec3 fw = vec3(cos(pit)*sin(yaw), sin(pit), cos(pit)*cos(yaw));
  vec3 rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);
  vec3 rd = normalize(fw*1.5 + uv.x*rt + uv.y*up);
  col = skyGrad(rd);
  // square sun / moon
  vec3 sq = squareDisc(rd, SUN, NIGHT > .5 ? .03 : .045);
  col = mix(col, NIGHT > .5 ? vec3(.85, .88, .95) : vec3(1., .97, .8), sq.x);
  col += (NIGHT > .5 ? vec3(.1, .12, .2) : vec3(1., .8, .5))*exp(-sq.y*12.)*.25*step(0., dot(rd, SUN));
  if (NIGHT > 0.) { vec2 sp = floor(vec2(atan(rd.x, rd.z), rd.y)*140.); col += step(.996, hash12(sp))*NIGHT*smoothstep(0., .2, rd.y); }
  float tg = rd.y < 0. ? -ro.y/rd.y : -1.;
  vec3 nrm;
  float tc = marchLayer(ro, rd, nrm);
  vec3 fogc = skyGrad(normalize(vec3(rd.x, .02, rd.z)));
  if (tg > 0. && (tc < 0. || tg < tc)) {
    vec3 gp = ro + rd*tg;
    vec3 g = groundCol(gp.xz);
    float sh = 1. - .45*layerShadow(gp);
    g *= (KEYC*max(SUN.y, 0.)*sh + AMB*.5);
    col = mix(g, fogc, 1. - exp(-tg*FK));
  }
  if (tc > 0.) {
    float face = nrm.y > .5 ? 1. : nrm.y < -.5 ? .9 : (abs(nrm.x) > .5 ? .96 : .92);
    vec3 cc = mix(KEYC, AMB + .3, .3)*(.92 + .12*max(dot(nrm, SUN), 0.))*face*mix(1., .5, NIGHT);
    cc = mix(cc, fogc, 1. - exp(-tc*FK*.8));
    col = mix(col, cc, CALPHA);
  }
#else
  // perspective orbit around a slowly drifting target
  vec3 ta = CAMT;
  vec3 off = CAMP - CAMT;
  off.xz = rot2(off.xz, uDrag.x*1.4 + sin(T*.04)*.4*uX4);
  off.y = clamp(off.y + uDrag.y*length(off)*.6, -length(off)*.8, length(off)*.9);
  vec3 ro = ta + off;
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);
  vec3 rd = normalize(fw*1.5 + uv.x*rt + uv.y*up);
  col = skyGrad(rd);
  float sd = length(rd - SUN);
  col = mix(col, mix(vec3(1., .95, .8), vec3(1., .8, .6), dusk), smoothstep(.09, .08, sd)*step(0., SUN.y));
  col += vec3(1., .7, .5)*exp(-sd*4.)*.2*(1. - NIGHT);
  float t = .1, hitT = -1.;
  for(int i=0;i<110;i++){
    vec3 p = ro + rd*t;
    float d = sceneSDF(p);
    if (d < .002*t) { hitT = t; break; }
    t += min(d*.9, 3.);
    if (t > 90.) break;
  }
  float tSea = -1.;
#if defined(MODE_2)
  tSea = rd.y < 0. ? (SEAY - ro.y)/rd.y : -1.;
#endif
  vec3 fogc = skyGrad(normalize(vec3(rd.x, .03, rd.z)));
  if (tSea > 0. && (hitT < 0. || tSea < hitT)) {
    vec3 sp = ro + rd*tSea;
    vec2 cid;
    vec2 fp = facet2(sp.xz*.6 + vec2(T*.15, 0.), cid);
    vec2 tilt = (hash22(floor(fp*13.)) - .5)*.55 + .12*vec2(sin(T + fp.x*3.), cos(T*.8 + fp.y*2.));
    vec3 n = normalize(vec3(tilt.x, 1., tilt.y));
    vec3 sea = SEAC*(.55 + .45*max(dot(n, SUN), 0.)) + skyGrad(reflect(rd, n))*.35*(1. - n.y*.3);
    sea += KEYC*pow(max(dot(reflect(rd, n), SUN), 0.), 30.)*.5;
    col = mix(sea, fogc, 1. - exp(-tSea*FK));
  } else if (hitT > 0.) {
    vec3 p = ro + rd*hitT;
    vec3 n = sdfNormal(p);
    vec3 alb = vec3(1.);
#if defined(MODE_2)
    // flat facets: take the normal at the nearest Worley point, so each Voronoi patch is one flat face
    vec3 fpnt = facetPoint(p*FACET)/FACET;
    vec3 fp = fpnt - n*clouds(fpnt);
    vec3 nf = sdfNormal(fp);
    n = normalize(mix(n, nf, .92));
    float dif = max(dot(n, SUN), 0.);
    float hb = clamp(n.y*.5 + .5, 0., 1.);
    col = alb*(KEYC*dif*.6 + mix(SHADEC, AMB*1.1 + .2, hb)*.8);
#else
    float hcl = hash13(CID + 9.);
    alb = hcl < .25 ? PAL1 : hcl < .5 ? PAL2 : hcl < .75 ? PAL3 : PAL4;
    alb = mix(alb, vec3(1.), .08);
    float dif = max(dot(n, SUN), 0.);
    // soft shadow + AO
    float s = 1., st = .05;
    for(int i=0;i<20;i++){ float h = clouds(p + n*.02 + SUN*st); s = min(s, 8.*h/st); st += clamp(h, .05, .6); if (s < .01 || st > 8.) break; }
    s = clamp(s, 0., 1.);
    float ao = 0.;
    for(int i=1;i<=4;i++){ float hh = .15*float(i); ao += (hh - clouds(p + n*hh))/hh; }
    ao = clamp(1. - ao*.22, 0., 1.);
    col = alb*(KEYC*dif*s*.75 + (AMB*.6 + .35*mix(SHADEC, vec3(1.), .5 + .5*n.y))*ao);
    col += vec3(1.)*pow(1. - max(dot(n, -rd), 0.), 4.)*.15;
#endif
    col = mix(col, fogc, 1. - exp(-hitT*FK));
  }
#endif
  outColor = vec4(col, 1.);
}`;

export default shaderEngine({
  id: 'voxel', name: 'Voxel Clouds', fs, res: 0.75,
  defaults: {
    MODE: 0, SUNAZ: 0.6, TOP: [0.3, 0.52, 0.95], BOT: [0.68, 0.82, 1.0],
    LAYY: 40, LAYH: 4, LAYSPD: 2.0, GSZ: 2.0, FOGK: 0.004, CALPHA: 0.9,
    CAMP: [0, 6, 0], CAMYAW: 0, CAMPIT: 0.45, CAMSPD: 0,
    BOX: 14, BASEY: 6,
    CELL: 12, CLY: 4, CSPD: 0.6, SEAY: 0, FACET: 1.2, SEAC: [0.1, 0.45, 0.55],
    CAMT: [0, 4, 10], SHADEC: [0.55, 0.6, 0.8],
    PAL1: [1.0, 0.72, 0.8], PAL2: [0.7, 0.92, 0.85], PAL3: [0.78, 0.74, 1.0], PAL4: [1.0, 0.86, 0.68]
  },
  params: [
    { id: 'x1', label: 'Cloud height', value: 0.5 },
    { id: 'x2', label: 'Haze', value: 0.5 },
    { id: 'x3', label: 'Zoom', value: 0.5 },
    { id: 'x4', label: 'Camera drift', value: 0.5 }
  ]
});

const d = (id, name, desc, opts, params, tags = []) => ({ id: 'voxel-' + id, name, desc, opts, params, tags: ['3d', ...tags] });
export const scenes = [
  d('below', 'Blocky Sky Above', 'Flat block clouds sliding overhead, seen from the grass below.',
    { MODE: 0, CAMP: [0, 2, 0], CAMPIT: 0.38, LAYY: 34 },
    { coverage: 0.6, scale: 0.5, light: 0.85, x4: 0.4 }, ['retro', 'stylized']),
  d('above', 'Above the Block Layer', 'Flying over a blocky cloud deck with the patchwork world far below.',
    { MODE: 0, CAMP: [0, 105, 0], CAMPIT: -0.5, LAYY: 40, CAMSPD: 3, FOGK: 0.0035 },
    { coverage: 0.58, scale: 0.5, light: 0.75, x4: 0.4 }, ['retro', 'stylized', 'distance']),
  d('dusk', 'Block Sunset', 'A square sun sinking behind slabs of pink cloud.',
    { MODE: 0, CAMP: [0, 30, 0], CAMPIT: 0.08, CAMYAW: 0.6, LAYY: 42, SUNAZ: 0.6, CALPHA: 0.8 },
    { coverage: 0.5, scale: 0.55, light: 0.2, x4: 0.4 }, ['retro', 'sunset']),
  d('iso', 'Isometric Cumulus', 'A voxel diorama: cube-built cumulus drifting over a tiny world, with shadows.',
    { MODE: 1, BOX: 14, BASEY: 6, SUNAZ: 2.2 },
    { coverage: 0.62, scale: 0.45, light: 0.8, x4: 0.5, speed: 0.6 }, ['stylized']),
  d('lowpoly', 'Low-Poly Skies', 'Faceted clouds floating over a faceted sea at golden hour.',
    { MODE: 2, CELL: 12, CLY: 4, CAMP: [0, 3, -4], CAMT: [0, 3.5, 10], SUNAZ: 2.3, TOP: [0.35, 0.45, 0.85], BOT: [1.0, 0.8, 0.7], FOGK: 0.018, SHADEC: [0.6, 0.5, 0.75] },
    { coverage: 0.65, scale: 0.55, light: 0.32, x4: 0.5 }, ['stylized']),
  d('sugar', 'Sugar Cubes', 'Pastel cube clouds tumbling gently through a candy sky.',
    { MODE: 3, CELL: 11, CAMP: [0, 1, 0], CAMT: [0, 0, 6], SUNAZ: 2.4, TOP: [0.55, 0.68, 1.0], BOT: [1.0, 0.84, 0.9], FOGK: 0.018, SHADEC: [0.75, 0.7, 0.95] },
    { coverage: 0.5, scale: 0.8, light: 0.85, x4: 0.5 }, ['stylized', 'pastel']),
];
