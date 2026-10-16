import fs from 'fs';
import { ZFS } from '../src/zfs.js';
const z = new ZFS(fs.readFileSync(process.argv[2] || (process.env.I76_DIR || 'D:/Games/Interstate 76') + '/I76.ZFS'));
let ok = 0, bad = {}, byComp = {};
for (const e of z.entries.values()) {
  if (!e.comp) continue;
  try { const d = z.get(e.name); if (d.length !== e.rawSize) throw new Error(`len ${d.length}/${e.rawSize}`); ok++; byComp[e.comp] = (byComp[e.comp] || 0) + 1; }
  catch (err) { const k = e.comp + ':' + err.message.slice(0, 40); bad[k] = (bad[k] || []).concat(e.name); }
  z.cache.clear();
}
console.log('ok', ok, byComp);
for (const [k, v] of Object.entries(bad)) console.log('FAIL', k, v.length, v.slice(0, 5));
const g = z.get('a2fnsg1g.pak'); console.log(Buffer.from(g.subarray(0, 64)).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
console.log(Buffer.from(z.get('a2fnsg1g.pix')).toString('latin1'));
