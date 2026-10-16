// node tools/dump-tex.mjs palette.act out_dir name1 name2 ...
import fs from 'fs';
import { VFS } from '../src/vfs.js';
import { loadTexture, paletteFromACT, toRGBA } from '../src/textures.js';
import { writePNG } from './png.mjs';
const [, , act, out, ...names] = process.argv;
const v = new VFS(fs.readFileSync((process.env.I76_DIR || 'D:/Games/Interstate 76') + '/I76.ZFS'));
const pal = paletteFromACT(v.get(act));
fs.mkdirSync(out, { recursive: true });
for (const n of names) {
  const t = loadTexture(v, n);
  if (!t) { console.log('missing', n); continue; }
  const im = toRGBA(t, pal);
  writePNG(`${out}/${n.replace(/\.[^.]*$/, '')}.png`, im.w, im.h, im.rgba);
  console.log(n, t.w, t.h);
}
