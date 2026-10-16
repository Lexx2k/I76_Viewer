// Parsers for BWD2 chunked files (.msn/.sdf), terrain (.ter), meshes (.geo).
// Layouts follow the Open76 reimplementation (github.com/r1sc/Open76) and were checked against game data.
// Coordinates are kept in the game's native left-handed space (x right, y up, z forward).

export class Reader {
  constructor(u8, off = 0, len = u8.length - off) {
    this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.start = off; this.end = off + len; this.pos = off;
  }
  u8_() { return this.u8[this.pos++]; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  v3() { return [this.f32(), this.f32(), this.f32()]; }
  bytes(n) { const b = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  cstr(n) { let s = ''; for (let i = 0; i < n; i++) { const c = this.u8[this.pos + i]; if (!c) break; s += String.fromCharCode(c); } this.pos += n; return s; }
}

// BWD2: sequence of tags { char name[4], u32 totalLen(incl. 8 byte header), data }
export function bwd2Tags(u8, off = 0, len = u8.length - off) {
  const tags = []; let p = off; const end = off + len;
  while (p + 8 <= end) {
    let name = ''; for (let i = 0; i < 4 && u8[p + i]; i++) name += String.fromCharCode(u8[p + i]);
    const total = new DataView(u8.buffer, u8.byteOffset).getUint32(p + 4, true);
    if (total < 8) break;
    tags.push({ name, pos: p + 8, len: total - 8 });
    p += total;
  }
  return tags;
}
const findTag = (tags, name, from = 0) => { for (let i = from; i < tags.length; i++) if (tags[i].name === name) return i; return -1; };

// 8-char object label: high bits of each char encode an instance id
function readLabel(r) {
  const raw = r.bytes(8); let id = 0, s = '';
  for (let i = 0; i < 8; i++) { const v = raw[i]; id = v > 0x7f ? ((id << 1) | 1) : ((id << 1) & 0xfe); const c = v & 0x7f; if (c) s += String.fromCharCode(c); }
  return { label: s, id };
}

export const ClassId = { Car: 1, Struct1: 2, Struct2: 3, Sign: 4, Special: 9, Ramp: 11, Intersection: 80 };

export function parseMission(u8, readFile) {
  const top = bwd2Tags(u8);
  const m = { objects: [], roads: [], strings: [], zmap: null, patches: [] };
  // WDEF/WRLD
  const wdef = top[findTag(top, 'WDEF')];
  const wt = bwd2Tags(u8, wdef.pos, wdef.len); const wrld = wt[findTag(wt, 'WRLD')];
  { const r = new Reader(u8, wrld.pos, wrld.len); r.pos += 30;
    m.name = new Reader(u8, wrld.pos).cstr(16);
    for (const k of ['palette', 'luma', 'xlucency', 'objective', 'sky', 'scrounge', 'surface', 'levelMap', 'hzd']) m[k] = r.cstr(13); }
  // TDEF: ZMAP + ZONE -> .ter
  const tdef = top[findTag(top, 'TDEF')];
  const tt = bwd2Tags(u8, tdef.pos, tdef.len);
  { const z = tt[findTag(tt, 'ZMAP')]; const r = new Reader(u8, z.pos);
    m.numPatches = r.u8_(); m.zmap = u8.slice(r.pos, r.pos + 6400);
    const zone = tt[findTag(tt, 'ZONE')]; const zr = new Reader(u8, zone.pos); zr.u8_(); m.terrainFile = zr.cstr(13); }
  const ter = readFile(m.terrainFile);
  if (ter) {
    const tv = new DataView(ter.buffer, ter.byteOffset, ter.byteLength);
    for (let i = 0; i < m.numPatches; i++) {
      const h = new Uint16Array(128 * 128), flags = new Uint8Array(128 * 128);
      for (let k = 0; k < 128 * 128; k++) { const v = tv.getUint16((i * 16384 + k) * 2, true); h[k] = v & 0xfff; flags[k] = v >> 12; }
      m.patches.push({ h, flags }); // row-major [z][x]
    }
  }
  // RDEF roads
  const ri = findTag(top, 'RDEF');
  if (ri >= 0) {
    const rt = bwd2Tags(u8, top[ri].pos, top[ri].len);
    for (const t of rt) {
      if (t.name !== 'RSEG') continue;
      const r = new Reader(u8, t.pos, t.len);
      const type = r.u32(), n = r.u32(); const segs = [];
      for (let i = 0; i < n; i++) segs.push({ left: r.v3(), right: r.v3() });
      m.roads.push({ type, segs });
    }
  }
  // ODEF objects
  const oi = findTag(top, 'ODEF');
  if (oi >= 0) {
    for (const t of bwd2Tags(u8, top[oi].pos, top[oi].len)) {
      if (t.name !== 'OBJ') continue;
      const r = new Reader(u8, t.pos, t.len);
      const { label, id } = readLabel(r);
      const right = r.v3(), up = r.v3(), forward = r.v3(), pos = r.v3();
      r.pos += 36; const classId = r.u32(), flags = r.u16(), team = r.u16();
      m.objects.push({ label, id, right, up, forward, pos, classId, flags, team, isPlayer: flags === 16 });
    }
  }
  // LDEF string objects (fences, poles...) placed along a polyline
  const li = findTag(top, 'LDEF');
  if (li >= 0) {
    for (const t of bwd2Tags(u8, top[li].pos, top[li].len)) {
      if (t.name !== 'OBJ') continue;
      const r = new Reader(u8, t.pos, t.len);
      const label = r.cstr(8); r.pos += 84; const classId = r.u32(); r.u32(); const n = r.u32();
      const pts = []; for (let i = 0; i < n; i++) pts.push(r.v3());
      m.strings.push({ label, classId, pts });
    }
  }
  return m;
}

export function parseGeo(u8) {
  const r = new Reader(u8);
  const magic = r.cstr(4); r.u32();
  const name = r.cstr(16); const nv = r.u32(), nf = r.u32(); r.u32();
  const verts = new Float32Array(nv * 3), normals = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) verts[i] = r.f32();
  for (let i = 0; i < nv * 3; i++) normals[i] = r.f32();
  const faces = [];
  for (let i = 0; i < nf; i++) {
    const index = r.u32(), n = r.u32();
    const color = [r.u8_(), r.u8_(), r.u8_()];
    const plane = [r.f32(), r.f32(), r.f32(), r.f32()];
    r.u32(); const f1 = r.u8_(), f2 = r.u8_(), f3 = r.u8_();
    const tex = r.cstr(13); r.u32(); r.u32();
    const refs = [];
    for (let v = 0; v < n; v++) refs.push({ v: r.u32(), n: r.u32(), u: r.f32(), t: r.f32() });
    faces.push({ index, color, plane, f1, f2, f3, tex: tex || null, refs });
  }
  return { magic, name, verts, normals, faces };
}

export function parseSdf(u8) {
  const top = bwd2Tags(u8);
  const sdf = { parts: [] };
  const c = top[findTag(top, 'SDFC')];
  if (c) { const r = new Reader(u8, c.pos); sdf.name = r.cstr(16); r.u32(); sdf.size = r.v3(); r.u32(); r.u32(); sdf.health = r.u32(); sdf.xdf = r.cstr(13); }
  const g = top[findTag(top, 'SGEO')];
  if (g) {
    const r = new Reader(u8, g.pos, g.len);
    const n = r.u32();
    for (let i = 0; i < n; i++) {
      const name = r.cstr(8); const right = r.v3(), up = r.v3(), forward = r.v3(), pos = r.v3();
      const parent = r.cstr(8); r.pos += 56;
      sdf.parts.push({ name, right, up, forward, pos, parent });
    }
  }
  return sdf;
}

// ---------- vehicles ----------
// Part record shared by VDF/WDF/GDF: name[8], right, up, forward, position, parent[8] (+ trailing bytes)
function readPart(r) {
  const name = r.cstr(8); const right = r.v3(), up = r.v3(), forward = r.v3(), pos = r.v3();
  return { name, right, up, forward, pos, parent: r.cstr(8) };
}
const tagsOf = u8 => { const t = bwd2Tags(u8); return { t, get: n => t[findTag(t, n)], all: n => t.filter(x => x.name === n) }; };

// .VCF vehicle config: variant, VDF (geometry/layout), VTF (paint), wheel defs, weapons
export function parseVcf(u8) {
  const T = tagsOf(u8); const c = T.get('VCFC'); const r = new Reader(u8, c.pos, c.len);
  const v = { variant: r.cstr(16), vdf: r.cstr(13), vtf: r.cstr(13) };
  r.u32(); r.u32(); r.u32();
  v.wdfFront = r.cstr(13); v.wdfMid = r.cstr(13); v.wdfBack = r.cstr(13);
  v.weapons = T.all('WEPN').map(w => { const wr = new Reader(u8, w.pos, w.len); return { mount: wr.i32(), gdf: wr.cstr(13) }; });
  return v;
}

// .VDF vehicle definition: part hierarchy per damage state, wheel and hardpoint locations
export function parseVdf(u8) {
  const T = tagsOf(u8); const vd = {};
  { const c = T.get('VDFC'); const r = new Reader(u8, c.pos, c.len); vd.name = r.cstr(20); vd.type = r.u32(); vd.size = r.u32(); }
  { const g = T.get('VGEO'); const r = new Reader(u8, g.pos, g.len); const n = r.u32();
    vd.states = [];
    for (let s = 0; s < 4; s++) { const parts = []; for (let i = 0; i < n; i++) { parts.push(readPart(r)); r.pos += 36; } vd.states.push(parts); } }
  { const w = T.get('WLOC'); const r = new Reader(u8, w.pos, w.len); vd.wheels = [];
    for (let i = 0; i < 6; i++) { r.u32(); const right = r.v3(), up = r.v3(), forward = r.v3(), pos = r.v3(); r.f32(); vd.wheels.push({ right, up, forward, pos }); } }
  vd.hlocs = T.all('HLOC').map(h => { const r = new Reader(u8, h.pos, h.len);
    return { label: r.cstr(16), index: r.u32(), facing: r.u32(), meshType: r.u32(), right: r.v3(), up: r.v3(), forward: r.v3(), pos: r.v3() }; });
  return vd;
}

// .VTF paint scheme: 78 .TMT names (texture lists per body panel) + 13 map names (index 12 = body)
export function parseVtf(u8, readFile) {
  const T = tagsOf(u8); const c = T.get('VTFC'); const r = new Reader(u8, c.pos, c.len);
  const vtf = { vdf: r.cstr(13), paint: r.cstr(16), tmts: {}, maps: [] };
  const tmtNames = []; for (let i = 0; i < 78; i++) tmtNames.push(r.cstr(13));
  for (let i = 0; i < 13; i++) vtf.maps.push(r.cstr(13).replace(/\.map$/i, ''));
  for (const n of tmtNames) {
    if (!n || n.toUpperCase() === 'NULL') continue;
    const d = readFile(n); if (!d) continue;
    const tr = new Reader(d, 64); const names = [];
    while (tr.pos + 8 <= d.length) names.push(tr.cstr(8));
    vtf.tmts[n.slice(3).toUpperCase()] = names; // "1CP1FTFT.TMT" -> "1FTFT.TMT"
  }
  return vtf;
}

// .WDF wheel definition
export function parseWdf(u8) {
  const T = tagsOf(u8); const c = T.get('WDFC'); const r = new Reader(u8, c.pos, c.len);
  const w = { name: r.cstr(20), parts: [] };
  const g = T.get('WGEO'); const gr = new Reader(u8, g.pos, g.len); const n = gr.u32();
  for (let i = 0; i < n; i++) { w.parts.push(readPart(gr)); gr.pos += 36; }
  w.radius = new DataView(u8.buffer, u8.byteOffset).getFloat32(gr.pos - 16, true);
  return w;
}

// .GDF weapon definition: only the mesh slots (top / side / turret / inside), by 4th letter of the part name
export function parseGdf(u8) {
  const T = tagsOf(u8); const gd = { top: [], side: [], turret: [], inside: [] };
  const c = T.get('GDFC'); if (c) gd.name = new Reader(u8, c.pos).cstr(16);
  const g = T.get('GGEO'); if (!g) return gd;
  const r = new Reader(u8, g.pos, g.len); const n = r.i32();
  for (let i = 0; i < 4 * n; i++) {
    const start = r.pos; const name = new Reader(u8, start).cstr(8);
    if (name !== 'NULL' && name) {
      const p = readPart(r);
      const slot = { P: 'top', S: 'side', T: 'turret', I: 'inside' }[name[3]];
      if (slot) gd[slot].push(p);
    }
    r.pos = start + 100 + 200; // 100-byte part record + 2 lower LODs
  }
  return gd;
}
