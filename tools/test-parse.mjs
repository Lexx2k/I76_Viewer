// Parse every mission + every referenced SDF/GEO/texture; report what is missing.
import fs from 'fs';
import { VFS } from '../src/vfs.js';
import { parseMission, parseSdf, parseGeo } from '../src/parsers.js';
import { loadTexture } from '../src/textures.js';
const GAME = (process.env.I76_DIR || 'D:/Games/Interstate 76');
const v = new VFS(fs.readFileSync(`${GAME}/I76.ZFS`));
const loose = n => { for (const d of ['miss8', 'miss16', '.', 'ADDON']) { const p = `${GAME}/${d}/${n}`; if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p)); } return v.get(n); };
const miss = { sdf: new Set(), geo: new Set(), tex: new Set(), err: [] };
let geoOk = 0, texOk = 0;
const only = process.argv[2];
for (const f of fs.readdirSync(`${GAME}/miss8`).filter(f => /\.msn$/i.test(f) && (!only || f.toLowerCase().startsWith(only)))) {
  try {
    const m = parseMission(new Uint8Array(fs.readFileSync(`${GAME}/miss8/${f}`)), loose);
    const cls = {}; for (const o of m.objects) cls[o.classId] = (cls[o.classId] || 0) + 1;
    console.log(f, m.terrainFile, 'patches', m.patches.length, 'objs', m.objects.length, JSON.stringify(cls), 'roads', m.roads.length, [...new Set(m.roads.map(r => r.type))].join('/'), 'strings', m.strings.length, 'pal', m.palette, 'surf', m.surface, 'sky', m.sky);
    const labels = new Set([...m.objects.filter(o => o.classId !== 1 && o.classId !== 9).map(o => o.label), ...m.strings.map(s => s.label)]);
    for (const l of labels) {
      const sd = v.get(l + '.sdf'); if (!sd) { miss.sdf.add(l); continue; }
      for (const p of parseSdf(sd).parts) {
        const g = v.get(p.name + '.geo'); if (!g) { if (p.name.toLowerCase() !== 'null') miss.geo.add(p.name); continue; }
        const geo = parseGeo(g); geoOk++;
        for (const fc of geo.faces) if (fc.tex) { if (loadTexture(v, fc.tex)) texOk++; else miss.tex.add(fc.tex); }
      }
    }
  } catch (e) { miss.err.push(f + ': ' + e.stack.split('\n').slice(0, 2).join(' ')); }
}
console.log('geo ok', geoOk, 'tex refs ok', texOk);
console.log('missing sdf', [...miss.sdf].slice(0, 20), miss.sdf.size);
console.log('missing geo', [...miss.geo].slice(0, 20), miss.geo.size);
console.log('missing tex', [...miss.tex].slice(0, 20), miss.tex.size);
console.log(miss.err.join('\n'));
