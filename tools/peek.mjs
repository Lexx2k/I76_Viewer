// node tools/peek.mjs name [bytes]  -> hexdump of a ZFS entry (or loose file path)
import fs from 'fs';
import { ZFS } from '../src/zfs.js';
const [, , name, n = '128', off = '0'] = process.argv;
let d;
if (fs.existsSync(name)) d = new Uint8Array(fs.readFileSync(name));
else { const z = new ZFS(fs.readFileSync((process.env.I76_DIR || 'D:/Games/Interstate 76') + '/I76.ZFS')); d = z.get(name); if (!d) { console.log('missing', name); process.exit(); } const e = z.entries.get(name.toLowerCase()); console.log(e.name, 'comp', e.comp, 'size', d.length); }
const o = +off, len = Math.min(+n, d.length - o);
for (let i = 0; i < len; i += 16) {
  const row = d.subarray(o + i, o + Math.min(i + 16, len));
  console.log((o + i).toString(16).padStart(6, '0'), Buffer.from(row).toString('hex').match(/../g).join(' ').padEnd(48), Buffer.from(row).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
}
