// Virtual filesystem: loose ZFS entries + members of .pak archives (indexed by their .pix lists).
// .pix: "count\r\nNAME offset size\r\n..." ; .pak: concatenated member data.
import { ZFS } from './zfs.js';

export class VFS {
  constructor(zfsBuf) {
    this.zfs = new ZFS(zfsBuf);
    this.pakIndex = new Map(); // member name -> {pak, offset, size}
    for (const e of this.zfs.list(/\.pix$/i)) {
      const txt = new TextDecoder('latin1').decode(this.zfs.get(e.name));
      const pak = e.name.replace(/\.pix$/i, '.pak');
      for (const line of txt.split(/\r?\n/).slice(1)) {
        const m = line.trim().split(/\s+/);
        if (m.length < 3) continue;
        const key = m[0].toLowerCase();
        if (!this.pakIndex.has(key)) this.pakIndex.set(key, { pak, offset: +m[1], size: +m[2] });
      }
    }
  }
  has(name) { const k = name.toLowerCase(); return this.zfs.has(k) || this.pakIndex.has(k); }
  get(name) {
    const k = name.toLowerCase();
    const d = this.zfs.get(k);
    if (d) return d;
    const p = this.pakIndex.get(k);
    if (!p) return null;
    const pak = this.zfs.get(p.pak);
    return pak ? pak.subarray(p.offset, p.offset + p.size) : null;
  }
  // first existing name among candidates
  find(...names) { for (const n of names) if (n && this.has(n)) return n; return null; }
}
