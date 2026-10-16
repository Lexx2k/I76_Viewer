import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VFS } from '../src/vfs.js';
import { parseMission, parseSdf, parseGeo, parseVcf, parseVdf, parseVtf, parseWdf, parseGdf, ClassId } from '../src/parsers.js';
import { loadTexture, paletteFromACT } from '../src/textures.js';

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(0.4, 1, 0.25);
const ambient = new THREE.AmbientLight(0xffffff, 1.4);
scene.add(sun, ambient);

// Game data is left-handed (x right, y up, z forward). Mirror z on the root so it renders correctly in three.js.
let world = null;
const layers = { objects: null, roads: null, cars: null, terrain: null };

// ---------- data ----------
let vfs = null, palette = null, curMission = null, curPath = '';
const texCache = new Map(), matCache = new Map(), geoCache = new Map();

function makeTexture(name) {
  const key = name.toLowerCase();
  if (texCache.has(key)) return texCache.get(key);
  const t = loadTexture(vfs, name);
  let tex = null;
  if (t) {
    const n = t.w * t.h, rgba = new Uint8Array(n * 4); let alpha = false;
    for (let i = 0; i < n; i++) {
      const c = t.idx[i];
      if (c === 255) { alpha = true; continue; } // index 255 = transparent
      rgba[i * 4] = palette[c * 4]; rgba[i * 4 + 1] = palette[c * 4 + 1]; rgba[i * 4 + 2] = palette[c * 4 + 2]; rgba[i * 4 + 3] = 255;
    }
    tex = new THREE.DataTexture(rgba, t.w, t.h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
    tex.userData.alpha = alpha;
  }
  texCache.set(key, tex);
  return tex;
}

function texMaterial(name) {
  const key = 'tex:' + name.toLowerCase();
  if (!matCache.has(key)) {
    const tex = makeTexture(name);
    const m = tex
      ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: tex.userData.alpha ? 0.5 : 0, side: tex.userData.alpha ? THREE.DoubleSide : THREE.FrontSide })
      : new THREE.MeshLambertMaterial({ color: 0xff00ff });
    m.name = name;
    matCache.set(key, m);
  }
  return matCache.get(key);
}
function colorMaterial(c) {
  const key = `col:${c.join(',')}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace) }));
  return matCache.get(key);
}

// GEO -> BufferGeometry with one group per material. Faces are convex polygons, fanned like the engine does.
// resolveTex (optional) maps a face texture name to the real one (vehicle paint schemes); cacheTag keeps variants apart.
function buildGeo(name, resolveTex = null, cacheTag = '') {
  const key = name.toLowerCase() + (cacheTag ? '|' + cacheTag : '');
  if (geoCache.has(key)) return geoCache.get(key);
  const raw = vfs.get(name + '.geo');
  if (!raw) { geoCache.set(key, null); return null; }
  const g = parseGeo(raw);
  const groups = new Map();
  for (const f of g.faces) {
    const tn = f.tex && resolveTex ? resolveTex(f.tex) : f.tex;
    const mat = tn ? texMaterial(tn) : colorMaterial(f.color);
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat).push(f);
  }
  const pos = [], nrm = [], uv = [], idx = [], mats = [];
  const geom = new THREE.BufferGeometry();
  for (const [mat, faces] of groups) {
    const start = idx.length;
    for (const f of faces) {
      const base = pos.length / 3;
      for (const r of f.refs) {
        pos.push(g.verts[r.v * 3], g.verts[r.v * 3 + 1], g.verts[r.v * 3 + 2]);
        nrm.push(-g.normals[r.v * 3], -g.normals[r.v * 3 + 1], -g.normals[r.v * 3 + 2]);
        uv.push(r.u, r.t);
      }
      for (let t = 1; t < f.refs.length - 1; t++) idx.push(base + t, base, base + t + 1);
    }
    geom.addGroup(start, idx.length - start, mats.length);
    mats.push(mat);
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeBoundingSphere();
  const entry = { geom, mats };
  geoCache.set(key, entry);
  return entry;
}

const sdfCache = new Map();
function buildSdf(label) {
  const key = label.toLowerCase();
  if (!sdfCache.has(key)) { const d = vfs.get(label + '.sdf'); sdfCache.set(key, d ? parseSdf(d) : null); }
  const sdf = sdfCache.get(key);
  if (!sdf) return null;
  const root = new THREE.Group();
  const parts = { WORLD: root };
  for (const p of sdf.parts) {
    const parent = parts[p.parent] || root;
    const node = new THREE.Group();
    node.position.set(...p.pos);
    const e = p.name.toLowerCase() === 'null' ? null : buildGeo(p.name);
    if (e) node.add(new THREE.Mesh(e.geom, e.mats));
    parent.add(node);
    parts[p.name] = node;
  }
  return root;
}

// ---------- vehicles (.vcf -> .vdf parts + .vtf paint + .wdf wheels + .gdf weapons) ----------
const BANNED_PARTS = ['51CMP3', '51SPC3', '51SYS3', '51WEP3', '51RTC1']; // cockpit/system placeholders
const parsed = new Map();
function cachedParse(name, fn) {
  const k = name.toLowerCase();
  if (!parsed.has(k)) { const d = vfs.get(name); let v = null; if (d) try { v = fn(d); } catch (e) { console.warn(name, e); } parsed.set(k, v); }
  return parsed.get(k);
}
function basisQuat(up, fwd) {
  const u = new THREE.Vector3(...up), f = new THREE.Vector3(...fwd), r = new THREE.Vector3().crossVectors(u, f);
  if (r.lengthSq() < 1e-6) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r.normalize(), u.normalize(), f.normalize()));
}
// Attach a part list under parent; parents named in the list are resolved through dict, unknown ones fall back to parent.
function addParts(parts, parent, dict, resolveTex, tag) {
  const pending = [];
  const place = (p, final) => {
    if (!p || !p.name || p.name.toUpperCase() === 'NULL' || BANNED_PARTS.some(b => p.name.toUpperCase().endsWith(b))) return;
    let par = p.parent === 'WORLD' ? parent : dict[p.parent];
    if (!par) { if (!final) { pending.push(p); return; } par = parent; }
    const node = new THREE.Group(); node.position.set(...p.pos); // engine ignores per-part rotation
    const e = buildGeo(p.name, resolveTex, tag);
    if (e) node.add(new THREE.Mesh(e.geom, e.mats));
    par.add(node); dict[p.name] = node;
  };
  for (const p of parts) place(p, false);
  for (const p of pending) place(p, true);
}
function buildVehicle(label) {
  const vcf = cachedParse(label + '.vcf', parseVcf);
  if (!vcf) return null;
  const vdf = cachedParse(vcf.vdf, parseVdf);
  const vtf = cachedParse(vcf.vtf, d => parseVtf(d, n => vfs.get(n)));
  if (!vdf) return null;
  // Face textures named "V..." are paint-scheme slots: "V1 BO DY" -> body map, others via the panel's .TMT list.
  const resolveTex = t => {
    const base = t.replace(/.[^.]*$/, '');
    if (!vtf || base[0] !== 'V') return t;
    if (base.replace(/ /g, '').endsWith('BODY')) return vtf.maps[12] || t;
    const key = base.slice(1).replace(/ /g, '').replace('LF', 'LT') + '.TMT';
    const list = vtf.tmts[key.toUpperCase()];
    return list && list[0] ? list[0] : t;
  };
  const tag = vcf.vtf.toLowerCase();
  const root = new THREE.Group(), dict = {};
  addParts(vdf.states[0], root, dict, resolveTex, tag);
  [[vcf.wdfFront, 0], [vcf.wdfMid, 2], [vcf.wdfBack, 4]].forEach(([w, i]) => {
    if (!w || w.toUpperCase() === 'NULL') return;
    const wdf = cachedParse(w, parseWdf); if (!wdf) return;
    for (const side of [0, 1]) {
      const loc = vdf.wheels[i + side]; if (!loc) continue;
      const wheel = new THREE.Group(); wheel.position.set(...loc.pos);
      const mesh = new THREE.Group(); if (side === 1) mesh.scale.x = -1; // left wheels are the mirrored right wheel
      wheel.add(mesh); addParts(wdf.parts, mesh, {}, resolveTex, tag); root.add(wheel);
    }
  });
  for (const w of vcf.weapons) {
    const h = vdf.hlocs[w.mount]; if (!h) continue;
    const gdf = cachedParse(w.gdf, parseGdf); if (!gdf) continue;
    const parts = { 1: gdf.top, 2: gdf.side, 3: gdf.turret }[h.meshType];
    if (!parts || !parts.length) continue;
    const mount = new THREE.Group(); mount.position.set(...h.pos); mount.quaternion.copy(basisQuat(h.up, h.forward));
    addParts(parts, mount, {}, resolveTex, tag); root.add(mount);
  }
  root.userData.vehicle = `${vdf.name} (${vcf.variant})`;
  return root;
}

// ---------- terrain ----------
const H_SCALE = 409.5 / 4096; // 12-bit height -> metres
function buildTerrain(m) {
  const grp = new THREE.Group();
  const zmap = m.zmap;
  const patchAt = (x, z) => (x < 0 || z < 0 || x > 79 || z > 79 || zmap[z * 80 + x] === 255) ? null : m.patches[zmap[z * 80 + x]];
  // global height sampler in metres (x,z world)
  m.heightAt = (wx, wz) => {
    const gx = wx / 5, gz = wz / 5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const s = (x, z) => { const p = patchAt(Math.floor(x / 128), Math.floor(z / 128)); return p ? p.h[(z & 127) * 128 + (x & 127)] * H_SCALE : 0; };
    return (s(x0, z0) * (1 - fx) + s(x0 + 1, z0) * fx) * (1 - fz) + (s(x0, z0 + 1) * (1 - fx) + s(x0 + 1, z0 + 1) * fx) * fz;
  };
  const surf = makeTexture(m.surface);
  const tile = surf ? surf.image.width / 10 : 12.8; // engine tiles the surface texture every (pixels/10) metres
  const mat = surf ? new THREE.MeshLambertMaterial({ map: surf }) : new THREE.MeshLambertMaterial({ color: 0x887755 });
  layers.terrainMat = mat;
  let minX = 80, minZ = 80, maxX = 0, maxZ = 0;
  const N = 129;
  const index = [];
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    index.push(a, c, b, d, b, c);
  }
  for (let pz = 0; pz < 80; pz++) for (let px = 0; px < 80; px++) {
    const p = patchAt(px, pz);
    if (!p) continue;
    minX = Math.min(minX, px); minZ = Math.min(minZ, pz); maxX = Math.max(maxX, px); maxZ = Math.max(maxZ, pz);
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      // edges borrow from the neighbouring patch (right / bottom), missing neighbours are height 0
      let src = p, ii = i, jj = j;
      if (i === 128 || j === 128) { src = patchAt(px + (i === 128 ? 1 : 0), pz + (j === 128 ? 1 : 0)); ii = i & 127; jj = j & 127; }
      const h = src ? src.h[jj * 128 + ii] * H_SCALE : 0;
      const wx = px * 640 + i * 5, wz = pz * 640 + j * 5, k = j * N + i;
      pos[k * 3] = wx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = wz;
      uv[k * 2] = wx / tile; uv[k * 2 + 1] = wz / tile;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(index);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.label = `terrain patch ${px},${pz}`;
    grp.add(mesh);
  }
  m.middle = [(minX + maxX + 1) / 2 * 640, (minZ + maxZ + 1) / 2 * 640];
  // zones outside the ZMAP are flat at height 0 in the engine; show them as one large plane
  const span = 80 * 640, pg = new THREE.PlaneGeometry(span, span, 1, 1);
  pg.rotateX(-Math.PI / 2); pg.translate(span / 2, -0.05, span / 2);
  const puv = pg.attributes.uv; for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * span / tile, puv.getY(i) * span / tile);
  const ground = new THREE.Mesh(pg, mat); ground.userData.ground = true;
  grp.add(ground);
  return grp;
}

// ---------- roads ----------
const ROAD_TEX = { 0: 'r2ayr_51', 1: 'r2dnr_37', 2: 'r2wnr_39', 3072: 'r2ayr_51' };
function buildRoads(m) {
  const grp = new THREE.Group();
  for (const road of m.roads) {
    const n = road.segs.length; if (n < 2) continue;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    road.segs.forEach((s, i) => {
      for (const [k, v] of [[0, s.left], [1, s.right]]) {
        const o = (i * 2 + k) * 3;
        pos[o] = v[0]; pos[o + 1] = m.heightAt(v[0], v[2]) + 0.1; pos[o + 2] = v[2];
        uv[(i * 2 + k) * 2] = k; uv[(i * 2 + k) * 2 + 1] = i;
      }
    });
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a + 2, a + 1, a, a + 2, a + 3, a + 1); }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx); geom.computeVertexNormals();
    const base = texMaterial(ROAD_TEX[road.type] || 'r2ayr_51');
    const mat = base.clone(); mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.label = `road (type ${road.type}, ${n} segments)`;
    grp.add(mesh);
  }
  return grp;
}

// ---------- objects ----------
const CLASS_NAME = { 1: 'vehicle', 2: 'structure', 3: 'structure', 4: 'sign', 8: 'scenery', 9: 'special', 11: 'ramp', 12: 'turret', 80: 'intersection', 82: 'scenery', 83: 'scenery' };
function placeBasis(obj, o) {
  const up = new THREE.Vector3(...o.up), fwd = new THREE.Vector3(...o.forward);
  const right = new THREE.Vector3().crossVectors(up, fwd);
  if (right.lengthSq() < 1e-6) return;
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right.normalize(), up.normalize(), fwd.normalize()));
}
function buildObjects(m) {
  const objs = new THREE.Group(), cars = new THREE.Group();
  const markerGeo = new THREE.ConeGeometry(1.6, 5, 4); markerGeo.rotateX(Math.PI / 2); markerGeo.translate(0, 2, 0);
  const teamCols = [0x55aaff, 0xff5544, 0x66dd66, 0xffcc33, 0xcc66ff];
  let missing = 0;
  for (const o of m.objects) {
    if (o.classId === ClassId.Special) continue;
    const kind = CLASS_NAME[o.classId] || `class ${o.classId}`;
    let node = null;
    if (o.classId === ClassId.Car || o.classId === 12) {
      const lbl = o.label.toLowerCase();
      if (o.isPlayer || lbl === 'spawn') m.spawn = o.pos;
      // training mission hardcodes the player's car (Open76 does the same)
      const vname = curPath.toLowerCase().endsWith('a01.msn') && lbl === 'vppirna1' ? 'vppa01' : lbl;
      const real = lbl === 'spawn' || lbl === 'regen' ? null : (buildVehicle(vname) || buildSdf(o.label));
      if (real) {
        real.position.set(...o.pos); placeBasis(real, o);
        real.userData.label = `${o.isPlayer ? 'PLAYER ' : ''}${real.userData.vehicle || kind + ': ' + o.label}${o.team ? ' · team ' + o.team : ''}`;
        cars.add(real);
        continue;
      }
      const col = o.isPlayer ? 0xffffff : lbl === 'spawn' || lbl === 'regen' ? 0xffaa00 : teamCols[o.team % teamCols.length];
      node = new THREE.Mesh(markerGeo, new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
      node.position.set(...o.pos); placeBasis(node, o);
      node.userData.label = `${o.isPlayer ? 'PLAYER ' : ''}${kind}: ${o.label}${o.team ? ' (team ' + o.team + ')' : ''}`;
      if (o.isPlayer || lbl === 'spawn') m.spawn = o.pos;
      cars.add(node);
      continue;
    }
    node = buildSdf(o.label);
    if (!node) { missing++; continue; }
    node.position.set(...o.pos); placeBasis(node, o);
    node.userData.label = `${kind}: ${o.label}`;
    objs.add(node);
  }
  for (const s of m.strings) {
    s.pts.forEach((p, i) => {
      const node = buildSdf(s.label); if (!node) return;
      node.position.set(...p);
      const q = i < s.pts.length - 1 ? s.pts[i + 1] : s.pts[i - 1];
      if (q) { let yaw = Math.atan2(q[0] - p[0], q[2] - p[2]); if (i === s.pts.length - 1) yaw += Math.PI; node.rotation.y = yaw; }
      node.userData.label = `string object: ${s.label}`;
      objs.add(node);
    });
  }
  return { objs, cars, missing };
}

// ---------- sky ----------
function buildSky(m) {
  const tex = makeTexture(m.sky);
  const geo = new THREE.SphereGeometry(9000, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  let mat;
  if (tex) {
    const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3); t.needsUpdate = true;
    mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false });
  } else mat = new THREE.MeshBasicMaterial({ color: 0x8899aa, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(geo, mat); sky.renderOrder = -1;
  return sky;
}

// ---------- mission loading ----------
const fetchBin = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return new Uint8Array(await r.arrayBuffer()); };
const palColor = i => new THREE.Color().setRGB(palette[i * 4] / 255, palette[i * 4 + 1] / 255, palette[i * 4 + 2] / 255, THREE.SRGBColorSpace);

async function loadMission(path) {
  status(`Loading ${path}…`);
  const t0 = performance.now();
  const dir = path.split('/')[0];
  const msn = await fetchBin(`/game/${path}`);
  // first pass discovers the terrain file name, then fetch it and parse for real
  let terName = null;
  try { parseMission(msn, n => { terName = n; return null; }); } catch (e) { /* terrain-less pass may fail late */ }
  const terLoose = terName ? await fetchBin(`/game/${dir}/${terName}`).catch(() => null) : null;
  const m = parseMission(msn, n => terLoose || vfs.get(n));
  curMission = m; curPath = path;
  // palette: 8-bit textures need the 8-bit palette (strip _16 if the 8-bit one exists)
  const palName = vfs.find(m.palette.replace(/_16(\.act)$/i, '$1'), m.palette);
  palette = paletteFromACT(vfs.get(palName));
  texCache.clear(); matCache.clear(); geoCache.clear(); sdfCache.clear(); parsed.clear();

  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  world = new THREE.Group(); world.scale.z = -1;
  layers.terrain = buildTerrain(m);
  layers.roads = buildRoads(m);
  const { objs, cars, missing } = buildObjects(m);
  layers.objects = objs; layers.cars = cars;
  world.add(layers.terrain, layers.roads, layers.objects, layers.cars);
  world.position.set(-m.middle[0], 0, m.middle[1]);
  scene.add(world);
  if (layers.sky) scene.remove(layers.sky);
  layers.sky = buildSky(m); scene.add(layers.sky);

  // engine lighting conventions (palette slots): 176 light, 239 fog/background, 247 ambient
  sun.color = palColor(176); ambient.color = palColor(247);
  scene.background = palColor(239);
  scene.fog = $('tFog').checked ? new THREE.Fog(palColor(239), 600, 4000) : null;
  applyToggles();
  focusSpawn();
  const nObj = layers.objects.children.length;
  $('info').textContent = `${m.terrainFile} · ${m.patches.length} terrain zones\n${nObj} objects · ${m.roads.length} roads · ${cars.children.length} vehicles\npalette ${palName} · surface ${m.surface} · sky ${m.sky}` + (missing ? `\n${missing} objects without .sdf` : '');
  status(`Loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  location.hash = path;
}

function toWorld(p) { return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(world.matrixWorld); }
function focusSpawn() {
  world.updateMatrixWorld(true);
  const m = curMission;
  const p = m.spawn ? toWorld(m.spawn) : new THREE.Vector3(0, m.heightAt(m.middle[0], m.middle[1]), 0);
  controls.target.copy(p);
  camera.position.copy(p).add(new THREE.Vector3(60, 45, 90));
  controls.update();
}

function applyToggles() {
  if (!world) return;
  layers.objects.visible = $('tObjects').checked;
  layers.roads.visible = $('tRoads').checked;
  layers.cars.visible = $('tCars').checked;
  if (layers.terrainMat) layers.terrainMat.wireframe = $('tWire').checked;
  if (palette) scene.fog = $('tFog').checked ? new THREE.Fog(palColor(239), 600, 4000) : null;
}
for (const id of ['tObjects', 'tRoads', 'tCars', 'tFog', 'tWire']) $(id).addEventListener('change', applyToggles);

// ---------- fly keys ----------
const keys = new Set();
addEventListener('keydown', e => { if (e.target.tagName === 'SELECT') return; keys.add(e.key.toLowerCase()); if (e.key.toLowerCase() === 'f' && curMission) focusSpawn(); });
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const clock = new THREE.Clock();
function fly(dt) {
  if (!keys.size) return;
  const sp = (keys.has('shift') ? 400 : 80) * dt;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const mv = new THREE.Vector3();
  if (keys.has('w')) mv.add(fwd); if (keys.has('s')) mv.sub(fwd);
  if (keys.has('d')) mv.add(right); if (keys.has('a')) mv.sub(right);
  if (keys.has('e')) mv.y += 1; if (keys.has('q')) mv.y -= 1;
  mv.multiplyScalar(sp); camera.position.add(mv); controls.target.add(mv);
}

// ---------- hover labels ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let hoverPending = false, lastEvt = null;
renderer.domElement.addEventListener('pointermove', e => { lastEvt = e; hoverPending = true; });
function hover() {
  if (!hoverPending || !world) return; hoverPending = false;
  const e = lastEvt; mouse.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = [layers.objects, layers.cars, layers.roads].filter(l => l.visible);
  const hit = ray.intersectObjects(targets, true)[0];
  const el = $('hover');
  if (!hit) { el.style.display = 'none'; return; }
  let o = hit.object; while (o && !o.userData.label) o = o.parent;
  if (!o) { el.style.display = 'none'; return; }
  el.textContent = o.userData.label; el.style.display = 'block';
  el.style.left = e.clientX + 14 + 'px'; el.style.top = e.clientY + 10 + 'px';
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  fly(dt); controls.update(); hover();
  if (layers.sky) layers.sky.position.set(camera.position.x, 0, camera.position.z);
  renderer.render(scene, camera);
});

// debug handle: viewer.shot(name, w, h) renders one frame at that size and saves it via the server
async function shot(name = 'shot', w = 1280, h = 800) {
  const ow = innerWidth, oh = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  controls.update(); renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setSize(ow, oh); camera.aspect = ow / oh; camera.updateProjectionMatrix();
  await fetch('/api/shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
  return name;
}
window.viewer = { THREE, scene, camera, controls, layers, shot, loadMission: p => loadMission(p), get mission() { return curMission; }, get world() { return world; } };

// ---------- boot ----------
(async () => {
  try {
    status('Loading I76.ZFS (55 MB)…');
    vfs = new VFS(await fetchBin('/game/I76.ZFS'));
    const list = await (await fetch('/api/missions')).json();
    const sel = $('mission');
    for (const p of list) { const o = document.createElement('option'); o.value = o.textContent = p; sel.appendChild(o); }
    sel.addEventListener('change', () => loadMission(sel.value).catch(err => { console.error(err); status('Error: ' + err.message); }));
    const start = decodeURIComponent(location.hash.slice(1)) || list.find(p => /miss8\/A01/i.test(p)) || list[0];
    sel.value = start;
    await loadMission(start);
  } catch (err) { console.error(err); status('Error: ' + err.message); }
})();
