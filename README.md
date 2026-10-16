# I'76 Map Viewer

Browser viewer for Interstate '76 missions, rendered from the original game data (no conversion step).

No game data is included: you need your own copy of Interstate '76 (e.g. the GOG release). Requires Node 18+.

```
node server.mjs 8076 "D:/Games/Interstate 76"
```
Arguments are port and game folder (or set `I76_DIR`). Open http://localhost:8076 and pick a mission (`#miss8/T01.MSN` deep-links).

Controls: drag orbit, right-drag pan, wheel zoom, WASD/QE fly (Shift = fast), F = back to spawn.

## Layout
- `src/lzo.js` LZO1X/LZO1Y decompressor (ZFS compression types 2 and 4)
- `src/zfs.js` `I76.ZFS` archive reader
- `src/vfs.js` archive + `.pak/.pix` member index
- `src/textures.js` `.VQM`+`.CBK`, `.MAP`, `.ACT` palettes (index 255 = transparent)
- `src/parsers.js` BWD2 chunks: mission (`WDEF/TDEF/RDEF/ODEF/LDEF`), `.TER`, `.GEO`, `.SDF`, vehicles (`.VCF/.VDF/.VTF/.TMT/.WDF/.GDF`)
- `web/main.js` three.js scene; the world root is mirrored on z (game data is left-handed)
- `tools/` node test scripts (game folder from `I76_DIR`) (`test-zfs.mjs`, `test-parse.mjs`, `dump-tex.mjs`, `peek.mjs`)

## Format notes
- Terrain: 128x128 u16 per zone, 5 m cells, height = (v & 0xFFF) * 409.5/4096 m. 80x80 ZMAP of zone indices (0xFF = empty).
- Surface texture tiles every (pixels/10) m. Roads: RSEG strips, textures by type (0 paved `r2ayr_51`, 1 dirt `r2dnr_37`, 2 river `r2wnr_39`).
- Lighting from palette slots 176 (sun), 247 (ambient), 239 (fog/background).
- Vehicles: VCF -> VDF damage-state 0 parts (position only, no per-part rotation), WDF wheels at VDF WLOC (left = mirrored), GDF weapon meshes at HLOC by mesh type (1 top, 2 side, 3 turret). Face textures `V..`: `BODY` -> VTF map 12, others -> panel `.TMT` list entry 0.
- Object/terrain layout follows Open76 (github.com/r1sc/Open76).

## Not yet
Turrets (class 12) have no SDF and show as markers; damaged states and first-person cockpits are not shown; 16-bit `.M16` textures are not decoded (8-bit VQM used everywhere); no LUM/TBL palette shading.
