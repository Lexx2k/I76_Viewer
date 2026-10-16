// Parse every vehicle referenced by any mission and check all geometry/textures resolve.
import fs from 'fs';
import { VFS } from '../src/vfs.js';
import { parseMission, parseVcf, parseVdf, parseVtf, parseWdf, parseGdf, parseGeo } from '../src/parsers.js';
const GAME = (process.env.I76_DIR || 'D:/Games/Interstate 76');
const v = new VFS(fs.readFileSync(`${GAME}/I76.ZFS`));
const labels = new Set();
for (const f of fs.readdirSync(`${GAME}/miss8`).filter(f => /\.msn$/i.test(f))) {
  try { for (const o of parseMission(new Uint8Array(fs.readFileSync(`${GAME}/miss8/${f}`)), () => null).objects) if (o.classId === 1 || o.classId === 12) labels.add(o.label.toLowerCase()); } catch {}
}
const bad = []; let ok = 0; const texMiss = new Set(), vtex = new Set();
for (const l of labels) {
  if (l === 'spawn' || l === 'regen') continue;
  const d = v.get(l + '.vcf'); if (!d) { bad.push(l + ': no vcf'); continue; }
  try {
    const vcf = parseVcf(d); const vdf = parseVdf(v.get(vcf.vdf)); const vtf = parseVtf(v.get(vcf.vtf), n => v.get(n));
    const parts = [...vdf.states[0]];
    for (const w of [vcf.wdfFront, vcf.wdfMid, vcf.wdfBack]) if (w && w.toUpperCase() !== 'NULL') parts.push(...parseWdf(v.get(w)).parts);
    for (const w of vcf.weapons) { const g = v.get(w.gdf); if (g) { const gd = parseGdf(g); parts.push(...gd.top, ...gd.side, ...gd.turret); } }
    for (const p of parts) {
      if (p.name === 'NULL') continue;
      const g = v.get(p.name + '.geo'); if (!g) { texMiss.add('geo ' + p.name); continue; }
      for (const f of parseGeo(g).faces) if (f.tex && f.tex[0] === 'V') vtex.add(f.tex);
    }
    ok++;
    if (ok <= 3) console.log(l, vcf.variant, vcf.vdf, vcf.vtf, vdf.name, 'parts', vdf.states[0].length, 'tmts', Object.keys(vtf.tmts).slice(0, 4), 'maps', vtf.maps.slice(10), 'weapons', vcf.weapons.map(w => w.mount + ':' + w.gdf).join(' '), 'hlocs', vdf.hlocs.length);
  } catch (e) { bad.push(l + ': ' + e.message); }
}
console.log('vehicles ok', ok, 'of', labels.size, '\nbad', bad, '\nmissing', [...texMiss].slice(0, 20));
console.log('V-textures sample', [...vtex].slice(0, 30).join(' | '));
