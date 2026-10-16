// Texture decoders. All return { w, h, idx: Uint8Array } (palette indices) or { w, h, rgba }.
//  .MAP : u32 w, u32 h, w*h palette indices
//  .VQM : u32 w, u32 h, char cbk[12], u32 flags, then (w/4)*(h/4) u16 codes
//         code < 0x8000 -> 4x4 block from codebook, code & 0x8000 -> solid colour (low byte)
//  .CBK : u32 count, count * 16 bytes (4x4 palette-index blocks)
//  .ACT : 256 * RGB
const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const cstr = (d, o, n) => { let s = ''; for (let i = 0; i < n && d[o + i]; i++) s += String.fromCharCode(d[o + i]); return s; };

export function decodeMAP(d) {
  const w = rd32(d, 0), h = rd32(d, 4);
  return { w, h, idx: d.subarray(8, 8 + w * h) };
}

export function vqmCodebookName(d) { return cstr(d, 8, 12); }

export function decodeVQM(d, cbk) {
  const w = rd32(d, 0), h = rd32(d, 4);
  const idx = new Uint8Array(w * h);
  const bw = w >> 2, bh = h >> 2;
  let p = 24;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += 2) {
    const code = d[p] | (d[p + 1] << 8);
    if (code & 0x8000) {
      const c = code & 0xff;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) idx[(by * 4 + y) * w + bx * 4 + x] = c;
    } else {
      const cb = 4 + code * 16;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) idx[(by * 4 + y) * w + bx * 4 + x] = cbk[cb + y * 4 + x];
    }
  }
  return { w, h, idx };
}

export function paletteFromACT(d) {
  const pal = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) { pal[i * 4] = d[i * 3]; pal[i * 4 + 1] = d[i * 3 + 1]; pal[i * 4 + 2] = d[i * 3 + 2]; pal[i * 4 + 3] = 255; }
  return pal;
}

export function toRGBA(tex, pal, transparentIndex = -1) {
  const n = tex.w * tex.h, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = tex.idx[i] * 4;
    out[i * 4] = pal[c]; out[i * 4 + 1] = pal[c + 1]; out[i * 4 + 2] = pal[c + 2];
    out[i * 4 + 3] = tex.idx[i] === transparentIndex ? 0 : 255;
  }
  return { w: tex.w, h: tex.h, rgba: out };
}

// Resolve a texture name (".map" in game data) to decoded palette-index image.
export function loadTexture(vfs, name) {
  const base = name.replace(/\.[^.]*$/, '').toLowerCase();
  let d = vfs.get(base + '.vqm');
  if (d) {
    const cbk = vfs.get(vqmCodebookName(d));
    if (!cbk) return null;
    return decodeVQM(d, cbk);
  }
  d = vfs.get(base + '.map');
  if (d) return decodeMAP(d);
  return null;
}
