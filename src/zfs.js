// I76.ZFS archive reader. Directory: header + linked blocks of 100 x 36-byte entries.
// Entry: name[16], offset u32, index u32, size u32, crc u32, flags u32
// flags: low byte = compression (0 raw, 2 LZO1X, 4 LZO1Y), upper 24 bits = unpacked size.
import { lzo1xDecompress } from './lzo.js';

export class ZFS {
  constructor(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    const per = dv.getUint32(12, true), total = dv.getUint32(16, true);
    let off = dv.getUint32(24, true);
    this.entries = new Map();
    const seen = new Set();
    while (off && !seen.has(off) && off < this.u8.length && this.entries.size < total) {
      seen.add(off);
      const next = dv.getUint32(off, true);
      for (let i = 0; i < per; i++) {
        const p = off + 4 + i * 36;
        let name = '';
        for (let k = 0; k < 16 && this.u8[p + k]; k++) name += String.fromCharCode(this.u8[p + k]);
        if (!name) continue;
        const fl = dv.getUint32(p + 32, true);
        this.entries.set(name.toLowerCase(), {
          name, offset: dv.getUint32(p + 16, true), size: dv.getUint32(p + 24, true),
          comp: fl & 0xff, rawSize: fl >>> 8,
        });
      }
      off = next;
    }
    this.cache = new Map();
  }
  has(name) { return this.entries.has(name.toLowerCase()); }
  get(name) {
    const key = name.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    const e = this.entries.get(key);
    if (!e) return null;
    const src = this.u8.subarray(e.offset, e.offset + e.size);
    let data;
    if (e.comp === 0) data = src;
    else if (e.comp === 2) data = lzo1xDecompress(src, e.rawSize);
    else if (e.comp === 4) data = lzo1xDecompress(src, e.rawSize, true);
    else throw new Error(`zfs: unknown compression ${e.comp} for ${e.name}`);
    this.cache.set(key, data);
    return data;
  }
  list(re) { return [...this.entries.values()].filter(e => !re || re.test(e.name)); }
}
