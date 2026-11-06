// 3D-кепка Mestario и 20 её NFT-моделей. Рендерится в браузере (three.js), кадры снимает tools/cap3d/render.js.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ParametricGeometry } from "three/addons/geometries/ParametricGeometry.js";

const SIZE = 240, SS = 2;                       // итоговый размер кадра и суперсэмплинг
const R = 1, SY = 1.06, SZ = 1.04;              // купол: радиус и сжатие
const TAU = Math.PI * 2;

/* ---------- детерминированный случай ---------- */
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- текстуры ---------- */
function canvasTex(w, h, draw, repeat, srgb) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const twill = () => canvasTex(256, 256, (g, w, h) => {      // саржевое плетение хлопка
  g.fillStyle = "#808080"; g.fillRect(0, 0, w, h);
  for (let i = -h; i < w; i += 6) { g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
    g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(i + 3, 0); g.lineTo(i + 3 + h, h); g.stroke(); }
  const r = rng(5); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() > .5 ? 255 : 0},${r() > .5 ? 255 : 0},${r() > .5 ? 255 : 0},.06)`; g.fillRect(r() * w, r() * h, 1, 1); }
}, [10, 5]);
const carbonTex = () => canvasTex(128, 128, (g, w, h) => {   // углеволокно 2×2
  const s = 32;
  for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
    const a = ((x + y) / s) % 2 === 0;
    const gr = g.createLinearGradient(x, y, a ? x + s : x, a ? y : y + s);
    gr.addColorStop(0, "#0b0c0f"); gr.addColorStop(.5, "#3a3f49"); gr.addColorStop(1, "#0b0c0f");
    g.fillStyle = gr; g.fillRect(x, y, s, s);
  }
}, [10, 5], true);
const knit = () => canvasTex(256, 256, (g, w, h) => {       // шерсть: меланж с петлями
  g.fillStyle = "#7a7a7a"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
    g.fillStyle = "rgba(255,255,255,.28)"; g.beginPath(); g.ellipse(x + 2, y + 4, 2, 3.6, -.5, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,.28)"; g.beginPath(); g.ellipse(x + 6, y + 4, 2, 3.6, .5, 0, TAU); g.fill();
  }
  const r = rng(9); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(255,255,255,${r() * .25})`; g.fillRect(r() * w, r() * h, 1, 1); }
}, [16, 8]);
const heather = () => canvasTex(256, 256, (g, w, h) => {
  const r = rng(12);
  g.fillStyle = "#26282d"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { const v = 40 + r() * 70 | 0; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
}, [8, 4], true);
const denim = () => canvasTex(512, 256, (g, w, h) => {      // варёный деним: синие нити и выбеленные разводы
  g.fillStyle = "#2c4a72"; g.fillRect(0, 0, w, h);
  for (let i = -h; i < w; i += 3) { g.strokeStyle = i % 6 ? "rgba(10,20,40,.35)" : "rgba(220,230,255,.18)"; g.lineWidth = 1; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h * .6, h); g.stroke(); }
  const r = rng(21);
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, rr = 8 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, "rgba(215,225,240,.55)"); gr.addColorStop(1, "rgba(215,225,240,0)");
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}, [3, 2], true);
const meshAlpha = () => canvasTex(128, 128, (g, w, h) => {  // сетка: белое — ткань, чёрное — дырка
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#000";
  for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { g.beginPath(); g.arc(x + ((y / 16) % 2 ? 8 : 0), y + 8, 5.2, 0, TAU); g.fill(); }
}, [18, 9]);
const glowTex = (inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") => canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(.35, inner.replace(/[\d.]+\)$/, ".45)")); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const flakeTex = () => canvasTex(64, 64, (g) => {
  g.translate(32, 32); g.strokeStyle = "#fff"; g.lineWidth = 3; g.lineCap = "round";
  for (let i = 0; i < 6; i++) { g.rotate(TAU / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26); g.moveTo(0, -14); g.lineTo(-7, -21); g.moveTo(0, -14); g.lineTo(7, -21); g.stroke(); }
});
const bubbleTex = () => canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 18, 32, 32, 30); gr.addColorStop(0, "rgba(180,220,255,.08)"); gr.addColorStop(.8, "rgba(190,230,255,.55)"); gr.addColorStop(1, "rgba(190,230,255,0)");
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
  g.fillStyle = "rgba(255,255,255,.95)"; g.beginPath(); g.ellipse(23, 21, 6, 4, -.6, 0, TAU); g.fill();
});
const shadowTex = () => canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(.6, "rgba(0,0,0,.18)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});

/* ---------- геометрия кепки ---------- */
// точка на куполе: перед выше и полнее, затылок ниже — как у бейсболки
function sp(az, el, r = R) {
  const c = Math.cos(az), hy = SY * (1 + .1 * c), fz = c > 0 ? SZ * (1 + .04 * Math.sin(el * 2)) : 1;
  return new THREE.Vector3(r * Math.cos(el) * Math.sin(az), r * Math.sin(el) * hy, r * Math.cos(el) * c * fz);
}
function crownGeo(a0, a1) {
  return new ParametricGeometry((u, v, t) => { const p = sp(a0 + (a1 - a0) * u, v * Math.PI / 2 * .999); t.copy(p); }, 96, 40);
}
function tubeAlong(points, radius, segs = 64) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segs, radius, 10, false); }
// строчка: короткие стежки вдоль кривой
function stitches(curvePts, mat, { len = .022, gap = .016, r = .0042 } = {}) {
  const curve = new THREE.CatmullRomCurve3(curvePts), L = curve.getLength(), n = Math.floor(L / (len + gap));
  const geo = new THREE.CapsuleGeometry(r, len, 2, 6), m = new THREE.InstancedMesh(geo, mat, n), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const u = (i + .5) / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
    q.setFromUnitVectors(up, tg); m.setMatrixAt(i, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  }
  return m;
}
// козырёк: верх, низ и кант; flat — прямой (скейт), long — длиннее
function visorGeo({ A = 1.25, L = 1.12, droop = .2, side = .24, thick = .045 } = {}, part = "top") {
  const I = (u) => sp(u * A, 0, R * 1.003), O = (u) => {
    const s = Math.sin(u * Math.PI / 2), c = Math.cos(u * Math.PI / 2), e = sp(A, 0);
    return new THREE.Vector3(e.x * s, 0, e.z + L * Math.pow(c, .8));
  };
  const P = (u, v, off = 0) => {
    const a = I(u), b = O(u), p = a.clone().lerp(b, v);
    const lf = Math.pow(Math.cos(u * Math.PI / 2), .8);   // длина козырька в этой точке: у краёв он сходит на нет
    p.y = (-droop * Math.pow(v, 1.5) - side * u * u * v) * (.25 + .75 * lf) * lf + off;
    return p;
  };
  if (part === "edge") {
    const pts = []; for (let i = 0; i <= 80; i++) pts.push(P(-1 + 2 * i / 80, 1, -thick / 2));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, thick / 2, 8, false);
  }
  const off = part === "top" ? 0 : -thick;
  const g = new ParametricGeometry((u, v, t) => t.copy(P(-1 + 2 * u, v, off)), 80, 24);
  if (part === "bottom") { const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = tmp; } g.computeVertexNormals(); }
  g.userData.P = P;
  return g;
}
// буква M как вышивка-«трубка», лежащая на лобовой панели
function mPath(size = .44, el0 = .48, lift = .02) {
  const w = size, h = size * .92;
  const pts2 = [[-.5, -.5], [-.5, -.1], [-.5, .5], [-.36, .5], [-.1, .14], [0, .02], [.1, .14], [.36, .5], [.5, .5], [.5, -.1], [.5, -.5]];
  return pts2.map(([x, y]) => sp(x * w / (R * .98), el0 + y * h / R, R + lift));
}
function logoMesh(mat, { size = .54, el0 = .42, r = .085 } = {}) {
  const pts = mPath(size, el0, r * .55), g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", .18);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 220, r, 20, false), mat));
  for (const p of [pts[0], pts[pts.length - 1]]) { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat); s.position.copy(p); g.add(s); }
  g.userData.curve = curve;
  return g;
}

/* ---------- материалы ---------- */
function fabric(color = 0x15161a, o = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: .82, sheen: .6, sheenRoughness: .6, sheenColor: new THREE.Color(0x3a3f4a), bumpMap: o.bump || twill(), bumpScale: o.bumpScale ?? 1.2, side: THREE.FrontSide, ...o.extra });
}
const logoMat = (o = {}) => new THREE.MeshPhysicalMaterial({ color: 0x2f74ff, roughness: .38, clearcoat: .8, clearcoatRoughness: .3, sheen: .5, sheenColor: new THREE.Color(0x8fbfff), emissive: 0x0a2470, emissiveIntensity: .35, ...o });

/* ---------- сборка кепки ---------- */
function buildCap(o = {}) {
  const cap = new THREE.Group(), parts = {};
  const fab = o.fabric || fabric(o.color), backFab = o.backFabric || fab;
  // купол: передние и боковые панели + задние
  const front = new THREE.Mesh(crownGeo(-2.2, 2.2), fab); cap.add(front); parts.front = front;
  const back = new THREE.Mesh(crownGeo(2.2, TAU - 2.2), backFab); cap.add(back); parts.back = back;
  const lining = new THREE.Mesh(crownGeo(0, TAU), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1, side: THREE.BackSide })); lining.scale.setScalar(.995); cap.add(lining);
  // швы между панелями и двойная строчка
  const seamMat = new THREE.MeshStandardMaterial({ color: o.seamColor || 0x08090b, roughness: .9 });
  const stitchMat = new THREE.MeshStandardMaterial({ color: o.stitchColor || 0x2a2e36, roughness: .7 });
  for (const az of [1.05, 2.1, Math.PI, TAU - 2.1, TAU - 1.05]) {
    const pts = []; for (let i = 0; i <= 30; i++) pts.push(sp(az, i / 30 * Math.PI / 2 * .985, R * 1.004));
    cap.add(new THREE.Mesh(tubeAlong(pts, .009), seamMat));
    for (const d of [-.035, .035]) { const sp2 = []; for (let i = 1; i <= 28; i++) sp2.push(sp(az + d / Math.max(.25, Math.cos(i / 30 * Math.PI / 2)), i / 30 * Math.PI / 2 * .96, R * 1.006)); cap.add(stitches(sp2, stitchMat)); }
  }
  // строчка по низу купола
  { const pts = []; for (let i = 0; i <= 120; i++) pts.push(sp(i / 120 * TAU, .05, R * 1.005)); cap.add(stitches(pts, stitchMat, { len: .026, gap: .02 })); }
  // люверсы на панелях
  if (!o.noEyelets) for (const az of [.6, 1.58, 2.62, TAU - .6, TAU - 1.58, TAU - 2.62]) {
    const p = sp(az, 1.04, R * 1.004), n = p.clone().normalize();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.028, .009, 8, 20), stitchMat); ring.position.copy(p); ring.lookAt(p.clone().add(n)); cap.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(.022, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.position.copy(p.clone().addScaledVector(n, .002)); hole.lookAt(p.clone().add(n)); cap.add(hole);
  }
  // пуговица на макушке
  const btn = new THREE.Mesh(new THREE.SphereGeometry(.085, 24, 16), o.buttonMat || fab); btn.scale.set(1, .45, 1); btn.position.set(0, SY * R + .005, 0); cap.add(btn);
  // козырёк
  const vo = o.visor || {}, vmat = o.visorMat || fab, under = o.underMat || new THREE.MeshPhysicalMaterial({ color: 0x1c1e23, roughness: .9, sheen: .3, bumpMap: fab.bumpMap, bumpScale: .6 });
  const vt = visorGeo(vo, "top"), visor = new THREE.Group();
  visor.add(new THREE.Mesh(vt, vmat), new THREE.Mesh(visorGeo(vo, "bottom"), under), new THREE.Mesh(visorGeo(vo, "edge"), vmat));
  const P = vt.userData.P;
  for (const v of [.3, .52, .74, .9]) { const pts = []; for (let i = 0; i <= 50; i++) pts.push(P(-.96 + 1.92 * i / 50, v, .004)); visor.add(stitches(pts, stitchMat, { len: .026, gap: .02, r: .0035 })); }
  cap.add(visor); parts.visor = visor; parts.visorP = P;
  // логотип
  if (o.logo !== false) { const lg = logoMesh(o.logoMat || logoMat(), o.logoOpts); cap.add(lg); parts.logo = lg; }
  parts.fab = fab;
  cap.userData = parts;
  return cap;
}

/* ---------- сцена ---------- */
const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE * SS;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const pmrem = new THREE.PMREMGenerator(renderer);
const ENV = pmrem.fromScene(new RoomEnvironment(), .04).texture;
const out = document.createElement("canvas"); out.width = out.height = SIZE;
const octx = out.getContext("2d");

function baseScene(o = {}) {
  const scene = new THREE.Scene();
  scene.environment = ENV; scene.environmentIntensity = o.env ?? .55;
  const key = new THREE.DirectionalLight(0xffffff, o.key ?? 2.4); key.position.set(-3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(o.rimColor ?? 0x9cc4ff, o.rim ?? 3.2); rim.position.set(4, 2.5, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, .5); fill.position.set(3, -1, 4); scene.add(fill);
  const cam = new THREE.PerspectiveCamera(24, 1, .1, 50);
  const az = o.camAz ?? .7, el = o.camEl ?? .3, d = o.camD ?? 6.8;
  cam.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + .3, Math.cos(az) * Math.cos(el) * d);
  cam.lookAt(0, o.lookY ?? .32, o.lookZ ?? .38);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, -.2, .5); scene.add(shadow);
  return { scene, cam, key, rim, shadow };
}
function sprite(tex, color = 0xffffff, size = .1, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false }));
  s.scale.setScalar(size); return s;
}
const ease = (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pulse = (t, c, w) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
const surfacePts = (n, seed, elMin = .15, elMax = 1.2, azMax = 2.4) => { const r = rng(seed), a = []; for (let i = 0; i < n; i++) a.push(sp((r() * 2 - 1) * azMax, elMin + r() * (elMax - elMin), R * 1.02)); return a; };

/* ---------- 20 моделей ---------- */
const MODELS = {
  dbg() { const D = window.DBG || {}; const { scene, cam } = baseScene({ camAz: D.az ?? 1.05, camEl: D.el ?? .32, camD: D.d ?? 7.6 }); const cap = buildCap(); scene.add(cap); return { scene, cam, dur: 1, update() {} }; },
  // 1. плавное покачивание и глянцевый блик по козырьку
  classic() {
    const { scene, cam } = baseScene({ camD: 7.6 });
    const vmat = fabric(0x15161a, { extra: { clearcoat: .35, clearcoatRoughness: .35 } });
    const cap = buildCap({ visorMat: vmat }); scene.add(cap);
    const pl = new THREE.PointLight(0xffffff, 0, .9, 1.4); scene.add(pl);
    return { scene, cam, dur: 6, update(t) {
      cap.rotation.y = -.15 + .55 * Math.sin(t / 6 * TAU);
      cap.updateMatrixWorld(true); const k = (t % 2) / 2, P = cap.userData.visorP, p = P(-1 + 2 * k, .6, .14).applyMatrix4(cap.matrixWorld);
      pl.position.copy(p); pl.intensity = 3.2 * Math.sin(Math.PI * k);
    } };
  },
  // 2. пульсирующее неоново-синее свечение по контуру козырька и логотипа — ритм «тук-тук»
  neon() {
    const { scene, cam } = baseScene({ rimColor: 0x4f8dff, rim: 4 });
    const lm = logoMat({ emissive: 0x2a6bff }); const cap = buildCap({ logoMat: lm }); scene.add(cap);
    const P = cap.userData.visorP, pts = []; for (let i = 0; i <= 80; i++) pts.push(P(-1 + 2 * i / 80, 1, .002));
    const nm = new THREE.MeshBasicMaterial({ color: 0x8fc4ff }); cap.add(new THREE.Mesh(tubeAlong(pts, .016, 160), nm));
    const glow = new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: .4, depthWrite: false });
    cap.add(new THREE.Mesh(tubeAlong(pts, .05, 160), glow));
    const lg = new THREE.Mesh(new THREE.TubeGeometry(cap.userData.logo.userData.curve, 200, .07, 12, false), glow.clone()); cap.add(lg);
    cap.rotation.y = -.15;
    return { scene, cam, dur: 1.6, update(t) {
      const b = .25 + .75 * Math.max(pulse(t, .2, .07), .8 * pulse(t, .55, .07));
      lm.emissiveIntensity = .5 + 1.4 * b; nm.color.setHSL(.6, 1, .55 + .25 * b); glow.opacity = .1 + .35 * b; lg.material.opacity = .04 + .12 * b;
      cap.position.y = .02 * Math.sin(t / 1.6 * TAU);
    } };
  },
  // 3. углеволокно; при наклоне проступают мерцающие синие искры
  carbon() {
    const { scene, cam } = baseScene({ env: .5 });
    const cf = new THREE.MeshPhysicalMaterial({ map: carbonTex(), roughness: .5, metalness: .1, clearcoat: .8, clearcoatRoughness: .12, envMapIntensity: .6 });
    const cap = buildCap({ fabric: cf, visorMat: cf, logoMat: logoMat({ metalness: .3, roughness: .2 }) }); scene.add(cap);
    const pts = surfacePts(26, 3), tex = glowTex("rgba(140,200,255,1)"), sps = pts.map((p) => { const s = sprite(tex, 0x9fd0ff, .1, 0); s.position.copy(p); cap.add(s); return s; });
    const r = rng(7), ph = pts.map(() => r());
    return { scene, cam, dur: 4, update(t) {
      const tilt = Math.sin(t / 4 * TAU); cap.rotation.set(.12 * tilt, -.2 + .35 * tilt, .05 * tilt);
      sps.forEach((s, i) => { const k = Math.max(0, Math.sin((t / 4 + ph[i]) * TAU * 2)) * clamp01(Math.abs(tilt) * 1.4); s.material.opacity = k; s.scale.setScalar(.03 + .06 * k); });
    } };
  },
  // 4. киберпанк: ремешки и пряжки, по ним бегут искры тока, логотип мигает
  cyber() {
    const { scene, cam } = baseScene({ rimColor: 0x7fb5ff });
    const lm = logoMat(); const cap = buildCap({ logoMat: lm }); scene.add(cap);
    const strapMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2027, roughness: .5, clearcoat: .6 }), metal = new THREE.MeshStandardMaterial({ color: 0xc9d2e0, metalness: 1, roughness: .22 });
    const straps = [];
    for (const az of [1.55, -1.55, 2.6]) {
      const pts = []; for (let i = 0; i <= 30; i++) pts.push(sp(az, i / 30 * 1.42, R * 1.03));
      const band = new ParametricGeometry((u, v, tg) => tg.copy(sp(az + (u - .5) * .2, v * 1.42, R * 1.022)), 6, 30); cap.add(new THREE.Mesh(band, strapMat));
      for (const d of [-.1, .1]) { const e = []; for (let i = 0; i <= 30; i++) e.push(sp(az + d, i / 30 * 1.42, R * 1.026)); cap.add(new THREE.Mesh(tubeAlong(e, .007), new THREE.MeshBasicMaterial({ color: 0x3d8bff }))); }
      const mid = sp(az, .62, R * 1.07), b = new THREE.Mesh(new THREE.BoxGeometry(.24, .16, .05), metal); b.position.copy(mid); b.lookAt(mid.clone().multiplyScalar(2)); cap.add(b);
      const hole = new THREE.Mesh(new THREE.BoxGeometry(.13, .06, .02), new THREE.MeshBasicMaterial({ color: 0x050608 })); hole.position.copy(sp(az, .62, R * 1.09)); hole.lookAt(mid.clone().multiplyScalar(2)); cap.add(hole);
      const led = new THREE.Mesh(new THREE.SphereGeometry(.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7fe9ff })); led.position.copy(sp(az, .9, R * 1.075)); cap.add(led);
      straps.push({ az, pts });
    }
    // молнии: ломаные вдоль ремешков
    const r = rng(4), bolts = [];
    for (let i = 0; i < 6; i++) {
      const s = straps[i % straps.length], geo = new THREE.BufferGeometry(), arr = new Float32Array(10 * 3);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true })); cap.add(line); bolts.push({ line, s, ph: r() });
    }
    cap.rotation.y = -.25;
    return { scene, cam, dur: 2.4, update(t) {
      const blink = (t > 1.5 && t < 1.58) || (t > 1.68 && t < 1.76);
      lm.emissiveIntensity = blink ? 1.9 : .55;
      bolts.forEach((b, i) => {
        const on = ((t * 5 + b.ph * 7) % 1) < .35; b.line.visible = on;
        if (!on) return;
        const rr = rng(Math.floor(t * 25) * 31 + i), a = b.line.geometry.attributes.position, k0 = rr() * .7;
        for (let j = 0; j < 10; j++) { const e = (k0 + j * .03) * 1.42, p = sp(b.s.az + (rr() - .5) * .12, e, R * (1.08 + rr() * .04)); a.setXYZ(j, p.x, p.y, p.z); }
        a.needsUpdate = true;
      });
    } };
  },
  // 5. матовая без бликов; фон вокруг темнеет, логотип вспыхивает
  stealth() {
    const { scene, cam, rim } = baseScene({ env: .25, rim: 1.4, rimColor: 0x8a93a6 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 1, bumpMap: twill(), bumpScale: .8 });
    const lm = logoMat({ clearcoat: 0, roughness: .8, color: 0x2a5fd0, emissiveIntensity: .2 });
    const cap = buildCap({ fabric: matte, visorMat: matte, underMat: matte, logoMat: lm, stitchColor: 0x15171b }); scene.add(cap);
    const dark = sprite(glowTex("rgba(0,0,0,1)"), 0xffffff, 4.4, .6); dark.position.set(0, .3, -.6); scene.add(dark);
    const flare = sprite(glowTex("rgba(150,200,255,1)"), 0xffffff, .9, 0); flare.position.copy(sp(0, .44, R * 1.2)); cap.add(flare);
    cap.rotation.y = -.15;
    return { scene, cam, dur: 4, update(t) {
      const f = pulse(t, 2.4, .12); dark.material.opacity = .45 + .4 * pulse(t, 2.2, .7);
      lm.emissiveIntensity = .2 + 2.2 * f; flare.material.opacity = .3 * f; flare.scale.setScalar(.4 + .3 * f);
    } };
  },
  // 6. золото: вокруг кружатся золотые пылинки, логотип переливается из синего в золото
  gold() {
    const { scene, cam } = baseScene({ rimColor: 0xffd27a });
    const lm = logoMat({ metalness: .2 }); const cap = buildCap({ logoMat: lm }); scene.add(cap);
    const blue = new THREE.Color(0x3f86ff), gold = new THREE.Color(0xf4c542);
    const tex = glowTex("rgba(255,215,110,1)"), r = rng(8), dust = [];
    for (let i = 0; i < 46; i++) { const s = sprite(tex, 0xffe08a, .03 + r() * .04, 1); scene.add(s); dust.push({ s, a: r() * TAU, rad: 1.5 + r() * .6, y: .1 + r() * 1.1, sp: .6 + r() * .6, ph: r() }); }
    cap.rotation.y = -.15;
    return { scene, cam, dur: 5, update(t) {
      const k = (Math.sin(t / 5 * TAU - Math.PI / 2) + 1) / 2;
      lm.color.copy(blue).lerp(gold, k); lm.metalness = .2 + .8 * k; lm.roughness = .32 - .14 * k; lm.emissive.set(0x0b2a80).lerp(new THREE.Color(0x4a3300), k);
      dust.forEach((d) => { const a = d.a + t / 5 * TAU * d.sp; d.s.position.set(Math.sin(a) * d.rad, d.y + .12 * Math.sin(a * 2), Math.cos(a) * d.rad * .8 + .3); const front = clamp01((d.s.position.z - .6) / .8) * clamp01(1 - Math.abs(d.s.position.x) / 1.1); d.s.material.opacity = (.3 + .4 * Math.abs(Math.sin((t + d.ph * 5) * 3))) * (1 - .85 * front); });
    } };
  },
  // 7. голографический логотип: цвета радуги (синий держится дольше), рядом искрят пиксели
  holo() {
    const { scene, cam } = baseScene();
    const lm = logoMat({ iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [200, 700], roughness: .15, metalness: .3 });
    const cap = buildCap({ logoMat: lm }); scene.add(cap);
    const curve = cap.userData.logo.userData.curve, r = rng(17), px = [], cols = [0x5ff2ff, 0xb98cff, 0x4f8dff, 0x7dffcb, 0xff9ef0];
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(.025, .025, .025), new THREE.MeshBasicMaterial({ color: cols[i % 5], transparent: true })); cap.add(m); px.push({ m, u: r(), d: new THREE.Vector3(r() - .5, r() * .8 - .2, r() * .9).normalize(), ph: r() }); }
    cap.rotation.y = -.15;
    return { scene, cam, dur: 4, update(t) {
      const h = ((t / 4) + .6 * Math.sin(t / 4 * TAU) * .25) % 1; lm.color.setHSL((.62 + Math.sin(t / 4 * TAU) * .5 + 1) % 1, .85, .58); lm.iridescenceThicknessRange = [200 + 300 * h, 700 + 300 * h];
      px.forEach((p) => { const k = ((t / 4) * 2 + p.ph) % 1, e = k < .6 ? 0 : (k - .6) / .4, base = curve.getPointAt(p.u);
        p.m.position.copy(base).addScaledVector(p.d, .04 + e * .16); p.m.material.opacity = k < .6 ? 0 : .8 * (1 - e); p.m.rotation.set(e * 2, e * 1.5, 0); });
    } };
  },
  // 8. сетчатая задняя часть «дышит» волнами на ветерке
  mesh() {
    const { scene, cam } = baseScene({ camAz: 1.6, camEl: .3 });
    const meshMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1d22, roughness: .7, alphaMap: meshAlpha(), alphaTest: .5, side: THREE.DoubleSide, sheen: .4 });
    const cap = buildCap({ backFabric: meshMat }); scene.add(cap);
    const back = cap.userData.back, pos = back.geometry.attributes.position, base = pos.array.slice();
    cap.rotation.y = -.55;
    return { scene, cam, dur: 3, update(t) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2], len = Math.hypot(x, y / SY, z / SZ) || 1;
        const w = 1 + .012 * Math.sin(t / 3 * TAU * 2 - y * 6 - x * 3) * Math.min(1, y * 3);
        pos.setXYZ(i, x * w, y * w, z * w);
      }
      pos.needsUpdate = true; back.geometry.computeVertexNormals();
      cap.rotation.z = .025 * Math.sin(t / 3 * TAU); cap.rotation.y = -.55 + .06 * Math.sin(t / 3 * TAU);
    } };
  },
  // 9. скейт: длинный прямой козырёк, невысокий прыжок с наклоном и мягкое приземление
  rider() {
    const { scene, cam, shadow } = baseScene({ camD: 8.4, lookY: .62 });
    const cap = buildCap({ visor: { L: 1.3, droop: .02, side: .015 } }); const piv = new THREE.Group(); piv.add(cap); cap.position.set(0, -.4, -.3); piv.position.set(0, .4, .3); scene.add(piv);
    return { scene, cam, dur: 3, update(t) {
      const k = t / 3; let y = 0, flip = 0, sq = 1;
      if (k > .2 && k < .62) { const u = (k - .2) / .42; y = .32 * Math.sin(Math.PI * u); flip = .22 * Math.sin(TAU * ease(u)); }
      if (k >= .62 && k < .72) sq = 1 - .04 * Math.sin(Math.PI * (k - .62) / .1);
      if (k > .12 && k <= .2) sq = 1 - .03 * Math.sin(Math.PI * (k - .12) / .08);
      piv.position.y = .4 + y; piv.rotation.set(0, -.2, 0); cap.rotation.set(flip * .0, 0, 0); piv.rotateX(0); piv.rotation.z = 0;
      piv.quaternion.setFromEuler(new THREE.Euler(0, -.2, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), flip));
      piv.scale.set(1 + (1 - sq) * .6, sq, 1 + (1 - sq) * .6);
      shadow.scale.setScalar(1 - .45 * y); shadow.material.opacity = 1 - .5 * y;
    } };
  },
  // 10. бархат: ткань переливается мягкими волнами
  velvet() {
    const { scene, cam } = baseScene({ env: .4, rimColor: 0xc9a6ff });
    const vel = new THREE.MeshPhysicalMaterial({ color: 0x14102a, roughness: .9, sheen: 1, sheenRoughness: .32, sheenColor: new THREE.Color(0x5a46b8), bumpMap: heather(), bumpScale: .4 });
    const cap = buildCap({ fabric: vel, visorMat: vel }); scene.add(cap);
    const l1 = new THREE.PointLight(0xb69cff, 0, 4, 1.5), l2 = new THREE.PointLight(0x7fb0ff, 0, 4, 1.5); scene.add(l1, l2);
    return { scene, cam, dur: 4, update(t) {
      const k = t / 4; cap.rotation.y = -.15 + .12 * Math.sin(k * TAU);
      l1.position.set(-1.8 + 3.6 * ((k * 2) % 1), 1.2, 1.6); l1.intensity = 8 * Math.sin(Math.PI * ((k * 2) % 1));
      l2.position.set(1.8 - 3.6 * ((k * 2 + .5) % 1), .5, 1.8); l2.intensity = 6 * Math.sin(Math.PI * ((k * 2 + .5) % 1));
    } };
  },
  // 11. кислотная вышивка: M «кипит» неоновой жидкостью изнутри наружу
  acid() {
    const { scene, cam } = baseScene({ rimColor: 0x29f0ff });
    const lm = logoMat({ color: 0x19e6ff, emissive: 0x00b4ff, emissiveIntensity: .5, roughness: .15, clearcoat: 1 });
    const cap = buildCap({ logo: false }); scene.add(cap);
    const curve = logoMesh(lm).userData.curve, geo = new THREE.TubeGeometry(curve, 220, .07, 20, false), pos = geo.attributes.position, base = pos.array.slice(), nrm = geo.attributes.normal.array.slice();
    const mesh = new THREE.Mesh(geo, lm); cap.add(mesh);
    for (const p of [curve.getPointAt(0), curve.getPointAt(1)]) { const s = new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 12), lm); s.position.copy(p); cap.add(s); }
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, .095, 12, false), new THREE.MeshBasicMaterial({ color: 0x19e6ff, transparent: true, opacity: .16, depthWrite: false })); cap.add(glow);
    const r = rng(2), bub = []; for (let i = 0; i < 30; i++) { const s = sprite(glowTex("rgba(200,255,255,1)"), 0xb8ffff, .05, 0); cap.add(s); bub.push({ s, u: r(), ph: r() }); }
    cap.rotation.y = -.15;
    return { scene, cam, dur: 2.4, update(t) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        const d = .006 * (Math.sin(x * 40 + t * 9) + Math.sin(y * 37 - t * 7) + Math.sin(z * 31 + t * 11)) / 3 + .01;
        pos.setXYZ(i, x + nrm[i * 3] * d, y + nrm[i * 3 + 1] * d, z + nrm[i * 3 + 2] * d);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      lm.emissiveIntensity = .5 + .18 * Math.sin(t / 2.4 * TAU * 2); glow.material.opacity = .12 + .05 * Math.sin(t / 2.4 * TAU * 2);
      bub.forEach((b) => { const k = (t / 2.4 * 2 + b.ph) % 1, p = curve.getPointAt(b.u); b.s.position.copy(p).add(p.clone().normalize().multiplyScalar(.05 + k * .25)); b.s.material.opacity = .7 * Math.sin(Math.PI * k); b.s.scale.setScalar(.025 + .03 * k); });
    } };
  },
  // 12. минимализм: крошечный логотип, спокойное парение в невесомости с синим ореолом
  mini() {
    const { scene, cam, shadow } = baseScene();
    const cap = buildCap({ logoOpts: { size: .15, el0: .42, r: .026 } }); scene.add(cap);
    const halo = sprite(glowTex("rgba(79,141,255,1)"), 0xffffff, 3.6, .35); halo.position.set(0, .45, -.3); scene.add(halo);
    return { scene, cam, dur: 4, update(t) {
      const k = Math.sin(t / 4 * TAU); cap.position.y = .16 + .1 * k; cap.rotation.set(.04 * k, -.15 + .05 * Math.sin(t / 4 * TAU + 1), .03 * k);
      halo.material.opacity = .28 + .12 * (k + 1) / 2; shadow.scale.setScalar(.9 - .12 * k); shadow.material.opacity = .7 - .15 * k;
    } };
  },
  // 13. варёный деним: потёртые разводы, по ткани бегут ретро-волны
  wash() {
    const { scene, cam } = baseScene({ env: .7 });
    const dt = denim(), dm = new THREE.MeshPhysicalMaterial({ map: dt, roughness: .92, sheen: .5, sheenColor: new THREE.Color(0x9fb8e0), bumpMap: twill(), bumpScale: 1 });
    const waveTex = canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < w; x++) { const y = h / 2 + Math.sin(x / w * TAU * 2) * h * .3; const gr = g.createLinearGradient(0, y - 6, 0, y + 6); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(.5, "rgba(210,225,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(x, y - 6, 1, 12); } }, [2, 3]);
    dm.emissiveMap = waveTex; dm.emissive = new THREE.Color(0x6f8fc0); dm.emissiveIntensity = .5;
    const cap = buildCap({ fabric: dm, visorMat: dm, stitchColor: 0xd9a54a, seamColor: 0x1c2f4d }); scene.add(cap);
    cap.rotation.y = -.15;
    return { scene, cam, dur: 3, update(t) { waveTex.offset.set(t / 3, t / 3 * .5); dt.offset.x = .02 * Math.sin(t / 3 * TAU); } };
  },
  // 14. титановые пластины по бокам: при вращении металлический блеск и холодные искры
  titan() {
    const { scene, cam } = baseScene({ env: .9 });
    const cap = buildCap(); scene.add(cap);
    const ti = new THREE.MeshPhysicalMaterial({ color: 0xaab3c2, metalness: 1, roughness: .24, clearcoat: .5, anisotropy: .6 });
    const riv = new THREE.MeshStandardMaterial({ color: 0x6b7484, metalness: 1, roughness: .35 });
    const plates = [];
    for (const s of [1, -1]) for (const [el, h] of [[.3, .32], [.72, .26]]) {
      const g = new ParametricGeometry((u, v, tg) => tg.copy(sp(s * (1.25 + u * .62), el + v * h, R * 1.025)), 16, 8);
      const m = new THREE.Mesh(g, ti); cap.add(m);
      for (const [u, v] of [[.08, .12], [.92, .12], [.08, .88], [.92, .88]]) { const r = new THREE.Mesh(new THREE.SphereGeometry(.024, 10, 8), riv); r.position.copy(sp(s * (1.25 + u * .62), el + v * h, R * 1.04)); cap.add(r); }
      plates.push(sp(s * 1.56, el + h / 2, R * 1.05));
    }
    const r = rng(14), sparks = [];
    for (let i = 0; i < 40; i++) { const s = sprite(glowTex("rgba(210,235,255,1)"), 0xdff0ff, .05, 0); cap.add(s); sparks.push({ s, p: plates[i % plates.length], d: new THREE.Vector3(r() - .5, r() * .6, r() - .5).normalize(), ph: r() }); }
    return { scene, cam, dur: 4, update(t) {
      cap.rotation.y = -.15 + .55 * Math.sin(t / 4 * TAU);
      const glint = Math.pow(Math.abs(Math.cos(t / 4 * TAU)), 6); ti.envMapIntensity = 1 + 2.5 * glint;
      sparks.forEach((s) => { const k = ((t / 4) * 2 + s.ph) % 1, on = k < .25; s.s.material.opacity = on ? (1 - k / .25) * (.4 + glint) : 0; s.s.position.copy(s.p).addScaledVector(s.d, k * .55); s.s.scale.setScalar(.06 * (1 - k)); });
    } };
  },
  // 15. глитч: изображение распадается на полосы и собирается (обработка кадра в 2D)
  glitch() {
    const { scene, cam } = baseScene();
    const cap = buildCap(); scene.add(cap); cap.rotation.y = -.15;
    return { scene, cam, dur: 2.6, post: "glitch", update(t) { cap.rotation.y = -.15 + .04 * Math.sin(t / 2.6 * TAU); } };
  },
  // 16. шерсть; вокруг падают снежинки, садятся на козырёк и тают
  winter() {
    const { scene, cam } = baseScene({ env: .5, rimColor: 0xd6e8ff });
    const wool = new THREE.MeshPhysicalMaterial({ color: 0x2b2d33, map: heather(), roughness: 1, sheen: 1, sheenRoughness: .8, sheenColor: new THREE.Color(0x8a8f99), bumpMap: knit(), bumpScale: 3 });
    const cap = buildCap({ fabric: wool, visorMat: wool }); scene.add(cap); cap.rotation.y = -.15;
    const tex = flakeTex(), r = rng(31), fl = [];
    for (let i = 0; i < 34; i++) {
      const land = i < 12, P = cap.userData.visorP;
      const target = land ? P(-.8 + r() * 1.6, .2 + r() * .7, .02) : null;
      const s = sprite(tex, 0xffffff, .05 + r() * .045, .85); scene.add(s);
      fl.push({ s, land, target, x: land ? target.x : (r() - .5) * 3.4, z: land ? target.z : (r() - .5) * 2 + .4, ph: r(), sz: s.scale.x, dur: 2 + r() * 1.5 });
    }
    return { scene, cam, dur: 6, update(t) {
      fl.forEach((f) => {
        const k = ((t / f.dur) + f.ph) % 1;
        if (f.land) { const fall = .75; if (k < fall) { const u = k / fall; f.s.position.set(f.target.x + .1 * Math.sin(u * 9), f.target.y + (1 - u) * 2.6, f.target.z); f.s.scale.setScalar(f.sz); f.s.material.opacity = .95; }
          else { const u = (k - fall) / (1 - fall); f.s.position.set(f.target.x, f.target.y, f.target.z); f.s.scale.setScalar(f.sz * (1 - u)); f.s.material.opacity = .95 * (1 - u); } }
        else { f.s.position.set(f.x + .15 * Math.sin(k * 10 + f.ph * 6), 2.4 - k * 3.2, f.z); f.s.material.rotation = k * 4; }
      });
    } };
  },
  // 17. светоотражающая: при смене угла вся кепка вспыхивает серебристо-синим
  reflex() {
    const { scene, cam } = baseScene({ env: 1.2, rimColor: 0xcfe2ff });
    const refl = new THREE.MeshPhysicalMaterial({ color: 0x8e98aa, metalness: .85, roughness: .28, clearcoat: 1, clearcoatRoughness: .1, bumpMap: twill(), bumpScale: .5, emissive: 0xcfe2ff, emissiveIntensity: 0 });
    const cap = buildCap({ fabric: refl, visorMat: refl }); scene.add(cap);
    return { scene, cam, dur: 4, update(t) {
      cap.rotation.y = -.15 + .7 * Math.sin(t / 4 * TAU);
      const f = Math.max(pulse(t, 1, .1), pulse(t, 3, .1)); refl.emissiveIntensity = .55 * f; refl.envMapIntensity = 1 + 1.3 * f; scene.environmentIntensity = 1.2 + .6 * f;
    } };
  },
  // 18. над кепкой появляется и исчезает цифровая корона, логотип сидит величественно
  crown() {
    const { scene, cam } = baseScene({ rimColor: 0xffe08a, camD: 7.8, lookY: .55 });
    const lm = logoMat({ emissiveIntensity: .9 }); const cap = buildCap({ logoMat: lm }); scene.add(cap); cap.rotation.y = -.15;
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xf2bd3c, metalness: 1, roughness: .2, clearcoat: 1, transparent: true });
    const gem = new THREE.MeshPhysicalMaterial({ color: 0x5ff2ff, emissive: 0x2a8bff, emissiveIntensity: 1, roughness: .05, transmission: .3, transparent: true });
    const crown = new THREE.Group(); crown.position.set(0, 1.42, .05);
    crown.add(new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 12, 48), gold)); crown.children[0].rotation.x = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .14, 48, 1, true), gold); band.position.y = .06; crown.add(band);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, sp2 = new THREE.Mesh(new THREE.ConeGeometry(.07, i % 2 ? .22 : .36, 4), gold); sp2.position.set(Math.sin(a) * .42, .22 + (i % 2 ? 0 : .07), Math.cos(a) * .42); crown.add(sp2);
      const g = new THREE.Mesh(new THREE.OctahedronGeometry(.045), gem); g.position.set(Math.sin(a) * .43, i % 2 ? .35 : .5, Math.cos(a) * .43); crown.add(g);
    }
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(.47, .47, .5, 16, 3, true)), new THREE.LineBasicMaterial({ color: 0x7fe9ff, transparent: true })); wire.position.y = .18; crown.add(wire);
    scene.add(crown);
    const shine = sprite(glowTex("rgba(255,224,140,1)"), 0xffffff, 1.6, 0); shine.position.copy(crown.position); scene.add(shine);
    return { scene, cam, dur: 4.4, update(t) {
      const k = t / 4.4, a = clamp01((k - .15) / .15) * (1 - clamp01((k - .72) / .14));
      crown.scale.setScalar(.6 + .4 * ease(clamp01((k - .15) / .2)) + .1 * clamp01((k - .72) / .14)); crown.rotation.y = k * TAU * .5;
      gold.opacity = a; gem.opacity = a; wire.material.opacity = a * (.5 + .5 * Math.sin(k * 60)); shine.material.opacity = .6 * a; crown.visible = a > .01;
      lm.emissiveIntensity = .8 + .5 * a;
    } };
  },
  // 19. глубокий океан: тёмно-синяя основа, вокруг плывут пузырьки, подводное течение
  ocean() {
    const { scene, cam } = baseScene({ env: .6, rimColor: 0x5fc8ff });
    const navy = fabric(0x0c1a3d, { extra: { sheenColor: new THREE.Color(0x2c5aa8) } });
    const cap = buildCap({ fabric: navy, visorMat: navy, seamColor: 0x081230, stitchColor: 0x1c3264 }); scene.add(cap);
    const caus = canvasTex(256, 256, (g, w, h) => { const r = rng(4); g.lineWidth = 1.2; for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(140,210,255,${.15 + r() * .35})`; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); for (let j = 0; j < 4; j++) g.quadraticCurveTo(x + (r() - .5) * 60, y + (r() - .5) * 60, x + (r() - .5) * 50, y + (r() - .5) * 50); g.stroke(); } }, [3, 2]);
    navy.emissiveMap = caus; navy.emissive = new THREE.Color(0x2a6fd0); navy.emissiveIntensity = .16;
    const tex = bubbleTex(), r = rng(19), bub = [];
    for (let i = 0; i < 36; i++) { const s = sprite(tex, 0xffffff, .04 + r() * .06, 1); scene.add(s); bub.push({ s, x: (r() - .5) * 3.4, z: (r() - .5) * 2 + .5, ph: r(), sp: .7 + r() * .6 }); }
    return { scene, cam, dur: 5, update(t) {
      const k = t / 5; cap.position.x = .05 * Math.sin(k * TAU); cap.rotation.set(.03 * Math.sin(k * TAU * 2), -.15 + .06 * Math.sin(k * TAU), .025 * Math.sin(k * TAU));
      caus.offset.set(k, k * .5);
      bub.forEach((b) => { const u = (k * b.sp + b.ph) % 1; b.s.position.set(b.x + .12 * Math.sin(u * 12 + b.ph * 6), -.4 + u * 2.9, b.z); b.s.material.opacity = .75 * Math.sin(Math.PI * u); });
    } };
  },
  // 20. FOUNDER 2026: голографическая надпись вокруг кепки и платиновое свечение
  founder() {
    const { scene, cam } = baseScene({ rimColor: 0xeef3ff, rim: 4.2, camD: 8.4, lookY: .5 });
    const lm = logoMat({ metalness: .4 }); const cap = buildCap({ logoMat: lm, stitchColor: 0xb8c0cc }); scene.add(cap); cap.rotation.y = -.15;
    const textTex = canvasTex(2048, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.font = "800 76px Arial, Helvetica, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
      for (let i = 0; i < 3; i++) { const x = w / 3 * (i + .5); const gr = g.createLinearGradient(x - 300, 0, x + 300, 0); gr.addColorStop(0, "#9aa6b8"); gr.addColorStop(.5, "#ffffff"); gr.addColorStop(1, "#cfe9ff"); g.fillStyle = gr; g.fillText("FOUNDER · 2026", x, h / 2); }
      g.fillStyle = "rgba(255,255,255,.12)"; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    }, null, true);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, .28, 96, 1, true), new THREE.MeshBasicMaterial({ map: textTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: .95 }));
    ring.position.set(0, 1.12, .2); scene.add(ring);
    const beam = sprite(glowTex("rgba(220,235,255,1)"), 0xffffff, 3.2, .25); beam.position.set(0, .7, -.4); scene.add(beam);
    const halo = new THREE.Mesh(crownGeo(0, TAU), new THREE.MeshBasicMaterial({ color: 0xe6eeff, transparent: true, opacity: .12, side: THREE.BackSide, depthWrite: false })); halo.scale.setScalar(1.08); cap.add(halo);
    return { scene, cam, dur: 6, update(t) {
      ring.rotation.y = -t / 6 * TAU; ring.material.opacity = .86 + .06 * Math.sin(t / 6 * TAU * 2);
      halo.material.opacity = .08 + .08 * (Math.sin(t / 6 * TAU * 3) + 1) / 2; beam.material.opacity = .2 + .1 * Math.sin(t / 6 * TAU * 2);
    } };
  },
};

/* ---------- кадры ---------- */
let cur = null;
window.setup = (id) => { cur = MODELS[id](); return { dur: cur.dur }; };
window.frame = (t) => {
  cur.update(t);
  cur.scene.updateMatrixWorld(true);
  renderer.render(cur.scene, cur.cam);
  octx.clearRect(0, 0, SIZE, SIZE);
  if (cur.post === "glitch") glitch2d(t / cur.dur); else octx.drawImage(canvas, 0, 0, SIZE, SIZE);
  return out.toDataURL("image/png");
};
// постоянный кибер-глич: полосы смещаются, RGB расходится, потом картинка собирается обратно
function glitch2d(k) {
  const bursts = [[.2, .035], [.62, .045]], on = bursts.some(([c, w]) => Math.abs(k - c) < w);
  if (!on) { octx.drawImage(canvas, 0, 0, SIZE, SIZE); return; }
  const r = rng(Math.floor(k * 300) + 7), S = SIZE * SS;
  let y = 0;
  while (y < SIZE) { const h = 4 + Math.floor(r() * 26), dx = (r() - .5) * 9 * (r() > .5 ? 1 : 0); octx.drawImage(canvas, 0, y * SS, S, h * SS, dx, y, SIZE, h); y += h; }
  octx.globalCompositeOperation = "source-atop"; octx.globalAlpha = .12;
  const tint = (col, dx) => { const c2 = document.createElement("canvas"); c2.width = c2.height = SIZE; const g2 = c2.getContext("2d"); g2.drawImage(canvas, 0, 0, SIZE, SIZE); g2.globalCompositeOperation = "source-in"; g2.fillStyle = col; g2.fillRect(0, 0, SIZE, SIZE); octx.drawImage(c2, dx, 0); };
  tint("#ff2a6d", -2); tint("#00f0ff", 2);
  octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1;
  for (let i = 0; i < 2; i++) { octx.fillStyle = ["#5ff", "#f5f", "#fff", "#4f8dff"][i]; octx.globalAlpha = .4; octx.fillRect(r() * 60, 40 + r() * 160, 40 + r() * 80, 1 + r() * 1.5); }
  octx.globalAlpha = 1;
}
window.ready = true;
