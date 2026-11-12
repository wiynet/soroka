// Кепка Mestario: рендер без сторонних библиотек. Форма задана полем расстояний (SDF) и считается лучами
// прямо во фрагментном шейдере WebGL2 — отсюда мягкие тени, объёмный «дутый» логотип и швы.
// Кадры снимает render.js (window.setup(id) → {dur}, window.frame(t) → PNG dataURL).
"use strict";
const SIZE = Number(new URLSearchParams(location.search).get("size") || 320), SS = Number(new URLSearchParams(location.search).get("ss") || 2);
const TAU = Math.PI * 2;

const FRAG = `#version 300 es
precision highp float;
out vec4 outC;
uniform vec2 uRes;
uniform vec3 uCam, uLook;
uniform mat3 uRot;        // мир → кепка
uniform vec3 uPos;
uniform float uT;
uniform int uModel;
uniform vec3 uBtn;        // пуговица на макушке
uniform vec3 uLc, uLv;    // центр логотипа на куполе и его ось «вверх» (вдоль ткани)
uniform vec3 uEye[6];     // люверсы
uniform vec3 uFab, uFabSheen, uLogoA, uLogoB, uUnder;
uniform float uLogoGloss, uLogoEm, uLogoScale, uKey, uRim, uEnv;
uniform vec3 uRimCol;
const float PI = 3.14159265;

float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r), k1 = length(p/(r*r)); return k0*(k0-1.)/k1; }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; return length(pa - ba*clamp(dot(pa,ba)/dot(ba,ba), 0., 1.)); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

// купол: структурированная бейсболка — лоб выше и круче, затылок ниже
float sdSup(vec3 p, vec3 r, float n){ vec3 q = pow(abs(p/r), vec3(n)); return (pow(q.x + q.y + q.z, 1./n) - 1.) * min(r.x, min(r.y, r.z)); }
float crownS(vec3 p){
  float a = sdEll(p - vec3(0., -.10, -.06), vec3(.97, 1.00, 1.06));        // затылок и бока
  float b = sdSup(p - vec3(0., -.02, .20), vec3(.90, 1.02, .88), 2.5);     // высокий крутой лоб
  return smin(a, b, .22);
}
const float MA = .31, MB = .20, MW = .092, MH = .075, MR = .034;
vec2 logoUV(vec3 p){ vec3 d = p - uLc; return vec2(d.x, dot(d, uLv)); }
float mShape(vec2 q){
  q /= uLogoScale;
  float d = sdSeg(q, vec2(-MA,-MB), vec2(-MA, MB));
  d = min(d, sdSeg(q, vec2(-MA, MB), vec2(0., -MB*.2)));
  d = min(d, sdSeg(q, vec2(0., -MB*.2), vec2(MA, MB)));
  d = min(d, sdSeg(q, vec2(MA, MB), vec2(MA,-MB)));
  return (d - MW) * uLogoScale;
}
float brimSurf(vec3 p, out float s){
  s = crownS(vec3(p.x, .08, p.z));
  float sm = smoothstep(0., .6, s);
  return -.17*max(s, 0.) - .21*p.x*p.x*sm + .012;
}
// контур козырька сверху: у купола — во всю его ширину, к носу плавно сужается; <0 внутри
float brimFoot(vec3 p){
  vec2 c = vec2(abs(p.x) / .90, max(p.z - .40, 0.) / 1.62);
  float fp = (pow(pow(c.x, 2.5) + pow(c.y, 2.5), .4) - 1.) * .90;
  return fp;
}
// x — расстояние, y — материал: 1 купол, 2 козырёк, 3 логотип, 4 пуговица
vec2 map(vec3 p){
  float cs = crownS(p);
  float crown = max(abs(cs + .018) - .018, -p.y);
  vec2 r = vec2(crown, 1.);
  // козырёк
  if (p.z <= .2) r.x = min(r.x, .40 - p.z);        // до козырька ещё далеко — шагаем не дальше этого
  else {
    float s; float ys = brimSurf(p, s);
    float fp = brimFoot(p);
    float foot = max(fp, .40 - p.z) + .014;
    float th = abs(p.y - ys) - .012;
    float d = (min(max(foot, th), 0.) + length(max(vec2(foot, th), 0.)) - .014) * .62;
    if (d < r.x) r = vec2(d, 2.);
  }
  // логотип
  if (p.z > .3 && cs >= .3) r.x = min(r.x, cs - .1);
  else if (p.z > .3) {
    vec2 w = vec2(mShape(logoUV(p)) + MR, abs(cs - MH*.5) - (MH*.5 - MR));
    float d = (min(max(w.x, w.y), 0.) + length(max(w, 0.)) - MR) * .85;
    if (d < r.x) r = vec2(d, 3.);
  }
  float b = sdEll(p - uBtn, vec3(.085, .042, .085));
  if (b < r.x) r = vec2(b, 4.);
  return r;
}
vec2 mapW(vec3 p){ return map(uRot * (p - uPos)); }
vec3 normalW(vec3 p){
  const vec2 e = vec2(.0012, -.0012);
  return normalize(e.xyy*mapW(p+e.xyy).x + e.yyx*mapW(p+e.yyx).x + e.yxy*mapW(p+e.yxy).x + e.xxx*mapW(p+e.xxx).x);
}
float shadow(vec3 ro, vec3 rd, float k){
  float res = 1., t = .02;
  for (int i = 0; i < 28; i++) { float h = mapW(ro + rd*t).x; res = min(res, k*h/t); t += clamp(h, .012, .2); if (res < .003 || t > 3.5) break; }
  return clamp(res, 0., 1.);
}
float ao(vec3 p, vec3 n){
  float o = 0., s = 1.;
  for (int i = 1; i <= 5; i++) { float h = .035*float(i); o += (h - mapW(p + n*h).x)*s; s *= .7; }
  return clamp(1. - 2.2*o, 0., 1.);
}
vec3 envCol(vec3 d){   // студия: мягкий верхний свет и две «софтбоксы»
  float up = d.y*.5 + .5;
  vec3 c = mix(vec3(.02, .025, .035), vec3(.55, .6, .7), pow(up, 1.6));
  c += vec3(2.2) * smoothstep(.86, .97, dot(d, normalize(vec3(-.5, .8, .45))));
  c += uRimCol * 1.6 * smoothstep(.8, .95, dot(d, normalize(vec3(.75, .35, -.55))));
  return c * uEnv;
}
float ggx(float nh, float a){ float a2 = a*a, d = nh*nh*(a2-1.)+1.; return a2/(PI*d*d); }

void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes) / uRes.y;
  vec3 f = normalize(uLook - uCam), rt = normalize(cross(f, vec3(0,1,0))), up = cross(rt, f);
  vec3 rd = normalize(f + (uv.x*rt + uv.y*up) * (2.*tan(radians(24.)*.5)));
  vec3 ro = uCam;
  // сфера вокруг кепки — лучи мимо неё не считаем
  vec3 oc = ro - (uPos + vec3(0., .25, .45)); float bq = dot(oc, rd), cq = dot(oc, oc) - 2.4*2.4, disc = bq*bq - cq;
  float t = -1.; vec2 hit = vec2(0.);
  if (disc > 0.) {
    float tt = max(-bq - sqrt(disc), 0.), tmax = -bq + sqrt(disc);
    for (int i = 0; i < 150; i++) { vec2 h = mapW(ro + rd*tt); if (h.x < .0006*tt) { t = tt; hit = h; break; } tt += h.x; if (tt > tmax) break; }
  }
  vec3 L1 = normalize(vec3(-.55, .85, .5)), L2 = normalize(vec3(.75, .35, -.55));
  if (t < 0.) {
    // тень на «полу»
    float gy = -.42, tg = (gy - ro.y) / rd.y; vec3 col = vec3(0.); float a = 0.;
    if (rd.y < 0. && tg > 0.) {
      vec3 gp = ro + rd*tg;
      float fade = 1. - smoothstep(1.5, 2.5, length(gp.xz - uPos.xz - vec2(0., .5)));
      if (fade > 0.) { float sh = shadow(gp + vec3(0., .02, 0.), normalize(vec3(-.2, 1., .15)), 3.2); a = (1. - sh) * .40 * fade; }
    }
    outC = vec4(col, a); return;
  }
  vec3 P = ro + rd*t, N = normalW(P), V = -rd;
  vec3 p = uRot * (P - uPos);                       // точка в осях кепки
  int m = int(hit.y + .5);
  vec3 alb = uFab; float rough = .78, spec = .035, sheen = 1., emis = 0., metal = 0.; vec3 emc = vec3(0.);
  float cs = crownS(p);
  if (m == 1 || m == 4) {
    if (m == 1 && cs < -.022) { alb = vec3(.012); sheen = 0.; }            // изнанка
    else {
      // швы шести клиньев сходятся к пуговице
      vec2 ax = p.xz - uBtn.xz; float az = atan(ax.x, ax.y), rr = length(ax);
      float fz = mod(az + PI/6. + PI*2., PI/3.), ds = min(fz, PI/3. - fz) * rr;
      float seam = smoothstep(.012, .004, ds);
      float st = smoothstep(.009, .004, abs(ds - .034)) * step(.38, fract(p.y*26.)) * step(.05, rr);
      float low = smoothstep(.008, .003, abs(p.y - .045)) * step(.4, fract(az*22.));
      alb = mix(alb, alb*.35, seam);
      alb = mix(alb, alb*2.2 + .012, max(st, low)*.8);
      for (int i = 0; i < 6; i++) { float de = length(p - uEye[i]); alb = mix(alb, vec3(.0), smoothstep(.024, .018, de)); alb = mix(alb, uFab*3. + .03, smoothstep(.011, .005, abs(de - .034))); }
      if (m == 4) alb = uFab * 1.15;
    }
  } else if (m == 2) {
    float s; float ys = brimSurf(p, s);
    vec2 c = vec2(p.x, p.z - .40); float fp = brimFoot(p);
    if (p.y < ys - .004) { alb = uUnder; }
    else {
      float rows = 0.;
      for (int i = 1; i <= 4; i++) rows = max(rows, smoothstep(.007, .003, abs(fp + .075*float(i) + .01)) * step(.4, fract(atan(c.x, c.y)*30.)));
      alb = mix(alb, alb*2.2 + .012, rows*.7);
    }
  } else if (m == 3) {
    float d2 = mShape(logoUV(p));
    float topf = smoothstep(-.004, -.06, d2);                 // середина штриха светлее, края темнее — «дутая» вышивка
    alb = mix(uLogoB, uLogoA, topf);
    rough = mix(.62, .3, uLogoGloss); spec = .04; sheen = 0.; emis = uLogoEm; emc = uLogoA;
  }
  // ткань: мелкое зерно плетения
  if (sheen > 0.) {
    float g = noise(p.xy*180. + p.z*97.) - .5 + .5*(noise(vec2(p.x + p.y, p.z - p.y)*90.) - .5);
    alb *= 1. + .35*g;
  }
  float occ = ao(P, N);
  float sh = shadow(P + N*.004, L1, 9.);
  float nl1 = max(dot(N, L1), 0.), nl2 = max(dot(N, L2), 0.), nv = max(dot(N, V), 1e-3);
  vec3 col = vec3(0.);
  // ключевой свет
  vec3 H = normalize(L1 + V); float a = rough*rough;
  float fr = spec + (1. - spec)*pow(1. - max(dot(H, V), 0.), 5.);
  col += (alb*(1. - metal)/PI*1. + ggx(max(dot(N, H), 0.), a)*fr*.25/max(nv, .25)) * nl1 * sh * uKey * 3.1;
  // контровой
  H = normalize(L2 + V);
  col += (alb*(1. - metal)/PI + ggx(max(dot(N, H), 0.), a)*fr*.25/max(nv, .25)) * nl2 * uRimCol * uRim * 2.2;
  // небо и отражение окружения
  vec3 amb = mix(vec3(.10, .11, .13), vec3(.42, .46, .55), N.y*.5 + .5) * uEnv;
  col += alb * amb * occ;
  vec3 R = reflect(-V, N); float fre = spec + (1. - spec)*pow(1. - nv, 5.);
  col += envCol(R) * fre * occ * (1. - rough) * (m == 3 ? .55 : .5);
  // бархатистый отлив ткани на скользящих углах
  col += uFabSheen * sheen * pow(1. - nv, 3.5) * (.35 + .65*occ) * (.5 + .5*N.y);
  col += emc * emis;
  // тон и гамма
  col = (col*(2.51*col + .03)) / (col*(2.43*col + .59) + .14);
  col = pow(clamp(col, 0., 1.), vec3(1./2.2));
  outC = vec4(col, 1.);
}`;

const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;

const glc = document.createElement("canvas"); glc.width = glc.height = SIZE * SS;
const gl = glc.getContext("webgl2", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.viewport(0, 0, glc.width, glc.height);
const U = (n) => gl.getUniformLocation(prog, n);

/* та же форма купола на JS — чтобы найти пуговицу и люверсы на поверхности */
const sdEll = (p, c, r) => { const q = [(p[0] - c[0]), (p[1] - c[1]), (p[2] - c[2])]; const k0 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]), k1 = Math.hypot(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2])); return k0 * (k0 - 1) / k1; };
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
const sdSup = (p, c, r, n) => (Math.pow(Math.pow(Math.abs((p[0] - c[0]) / r[0]), n) + Math.pow(Math.abs((p[1] - c[1]) / r[1]), n) + Math.pow(Math.abs((p[2] - c[2]) / r[2]), n), 1 / n) - 1) * Math.min(...r);
const crownS = (p) => smin(sdEll(p, [0, -.10, -.06], [.97, 1.00, 1.06]), sdSup(p, [0, -.02, .20], [.90, 1.02, .88], 2.5), .22);
function onCrown(o, d) { let lo = 0, hi = 3; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (crownS([o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m]) < 0) lo = m; else hi = m; } return [o[0] + d[0] * lo, o[1] + d[1] * lo, o[2] + d[2] * lo]; }
const BTN = onCrown([0, 0, .15], [0, 1, 0]).map((v, i) => v + (i === 1 ? .012 : 0));
// логотип: центр на лбу и ось «вверх» в касательной плоскости
const LC = onCrown([0, .50, 0], [0, 0, 1]);
const LN = (() => { const e = 1e-4, g = [0, 1, 2].map((i) => { const a = LC.slice(), b = LC.slice(); a[i] += e; b[i] -= e; return crownS(a) - crownS(b); }); const l = Math.hypot(...g); return g.map((v) => v / l); })();
const LV = (() => { const v = [0, LN[2], -LN[1]]; const l = Math.hypot(...v); return v.map((x) => x / l * (v[1] < 0 ? -1 : 1)); })();   // cross(n, x), смотрит вверх
const EYES = [0, 1, 2, 3, 4, 5].map((i) => { const az = (i + .5) * TAU / 6, el = 1.0; return onCrown([0, 0, .15], [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]); });

const out = document.createElement("canvas"); out.width = out.height = SIZE; document.body.append(out);
const ctx = out.getContext("2d"); ctx.imageSmoothingQuality = "high";

function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function mul3(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255].map((v) => Math.pow(v, 2.2));

const DEF = { camAz: .74, camEl: .30, camD: 8.0, look: [0, .24, .56], rot: [0, 0, 0], pos: [0, 0, 0],
  fab: 0x1c1c1f, sheen: 0x34363c, under: 0x141416, logoA: 0x5ba3ff, logoB: 0x1b4fc4, logoGloss: .6, logoEm: .0, logoScale: .93, key: 1, rim: 1, rimCol: 0xa9c8ff, env: 1, model: 0 };
function draw(o) {
  const s = { ...DEF, ...o };
  const cam = [Math.sin(s.camAz) * Math.cos(s.camEl) * s.camD, Math.sin(s.camEl) * s.camD + .3, Math.cos(s.camAz) * Math.cos(s.camEl) * s.camD];
  gl.uniform2f(U("uRes"), glc.width, glc.height);
  gl.uniform3fv(U("uCam"), cam); gl.uniform3fv(U("uLook"), s.look);
  // поворот кепки: Y, затем X и Z; в шейдер уходит обратный (транспонированный)
  const R = mul3(rotY(s.rot[1]), mul3(rotX(s.rot[0]), rotZ(s.rot[2])));
  gl.uniformMatrix3fv(U("uRot"), false, new Float32Array(R));   // столбцы = строки R → это R^T
  gl.uniform3fv(U("uPos"), s.pos); gl.uniform1f(U("uT"), s.t || 0); gl.uniform1i(U("uModel"), s.model);
  gl.uniform3fv(U("uLc"), LC); gl.uniform3fv(U("uLv"), LV);
  gl.uniform3fv(U("uBtn"), BTN); gl.uniform3fv(U("uEye"), new Float32Array(EYES.flat()));
  gl.uniform3fv(U("uFab"), hex(s.fab)); gl.uniform3fv(U("uFabSheen"), hex(s.sheen)); gl.uniform3fv(U("uUnder"), hex(s.under));
  gl.uniform3fv(U("uLogoA"), hex(s.logoA)); gl.uniform3fv(U("uLogoB"), hex(s.logoB));
  gl.uniform1f(U("uLogoGloss"), s.logoGloss); gl.uniform1f(U("uLogoEm"), s.logoEm); gl.uniform1f(U("uLogoScale"), s.logoScale);
  gl.uniform1f(U("uKey"), s.key); gl.uniform1f(U("uRim"), s.rim); gl.uniform1f(U("uEnv"), s.env); gl.uniform3fv(U("uRimCol"), hex(s.rimCol));
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
}
const QS = new URLSearchParams(location.search);
const MODELS = {
  dbg() { return { dur: 1, update(t) { return { camAz: Number(QS.get("az") || .74), camEl: Number(QS.get("el") || .3), camD: Number(QS.get("d") || 8), under: 0x803020, rot: [0, t, 0] }; } }; },
  base() { return { dur: 4, update(t) { return { rot: [0, .22 * Math.sin(t / 4 * TAU), 0] }; } }; },
};
let cur = null;
window.setup = (id) => { cur = MODELS[id](); return { dur: cur.dur }; };
window.frame = (t) => {
  const o = cur.update(t) || {};
  draw({ ...o, t });
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (cur.behind) cur.behind(ctx, t);
  ctx.drawImage(glc, 0, 0, SIZE, SIZE);
  if (cur.front) cur.front(ctx, t);
  return out.toDataURL("image/png");
};
window.ready = true;
