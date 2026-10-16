// LZO1X / LZO1Y decompressor. 1Y differs only in M2 match encoding (2 offset bits, 0x400 window).
// Port of the reference lzo1x_decompress_safe state machine.
export function lzo1xDecompress(src, outLen, y = false) {
  const M2MAX = y ? 0x0400 : 0x0800;
  const out = new Uint8Array(outLen);
  let ip = 0, op = 0, t, mPos;
  const copyMatch = (dist, len) => {
    let m = op - dist;
    if (m < 0) throw new Error('lzo: lookbehind overrun');
    for (let i = 0; i < len; i++) out[op++] = out[m++];
  };
  const copyLit = (n) => { for (let i = 0; i < n; i++) out[op++] = src[ip++]; };

  let state = 0; // 0 = expecting literal run, after match: next stage
  t = src[ip];
  if (t > 17) {
    ip++; t -= 17;
    copyLit(t);
    if (t < 4) state = 2; else state = 1; // state1: first_literal_run; state2: match_next
  }
  for (;;) {
    if (state === 0) {
      t = src[ip++];
      if (t >= 16) { state = 3; }
      else {
        if (t === 0) {
          while (src[ip] === 0) { t += 255; ip++; }
          t += 15 + src[ip++];
        }
        copyLit(t + 3);
        state = 1;
        continue;
      }
    }
    if (state === 1) { // first literal run done
      t = src[ip++];
      if (t >= 16) { state = 3; }
      else {
        mPos = 1 + M2MAX + (t >> 2) + (src[ip++] << 2);
        copyMatch(mPos, 3);
        t = src[ip - 2] & 3;
        if (t === 0) { state = 0; continue; }
        copyLit(t); t = src[ip++]; state = 3;
      }
    }
    if (state === 2) { // match_next after short literal
      // t holds literal count (<4); next byte is a match
      t = src[ip++]; state = 3;
    }
    // state 3: decode match with instruction t
    for (;;) {
      let len, dist;
      if (t >= 64) {
        if (y) { dist = 1 + ((t >> 2) & 3) + (src[ip++] << 2); len = (t >> 4) - 3 + 2; }
        else { dist = 1 + ((t >> 2) & 7) + (src[ip++] << 3); len = (t >> 5) - 1 + 2; }
      } else if (t >= 32) {
        len = t & 31;
        if (len === 0) { while (src[ip] === 0) { len += 255; ip++; } len += 31 + src[ip++]; }
        len += 2;
        dist = 1 + ((src[ip] | (src[ip + 1] << 8)) >> 2); ip += 2;
      } else if (t >= 16) {
        dist = (t & 8) << 11;
        len = t & 7;
        if (len === 0) { while (src[ip] === 0) { len += 255; ip++; } len += 7 + src[ip++]; }
        len += 2;
        dist += (src[ip] | (src[ip + 1] << 8)) >> 2; ip += 2;
        if (dist === 0) return op === outLen ? out : out.subarray(0, op); // end of stream
        dist += 0x4000;
      } else {
        dist = 1 + (t >> 2) + (src[ip++] << 2);
        len = 2;
      }
      copyMatch(dist, len);
      t = src[ip - 2] & 3;
      if (t === 0) { state = 0; break; }
      copyLit(t);
      t = src[ip++];
    }
  }
}
