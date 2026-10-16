// Local static server: viewer files from this folder, game data under /game/ (read-only).
// node server.mjs [port] [gameDir]
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.argv[2] || process.env.PORT || 8076);
const GAME = path.resolve(process.argv[3] || process.env.I76_DIR || path.join(ROOT, '..', '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function listMissions() {
  const out = [];
  for (const dir of ['miss8', 'miss16']) {
    const p = path.join(GAME, dir);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p)) if (/\.(msn|lvl|cbt|rac)$/i.test(f)) out.push(`${dir}/${f}`);
  }
  return out;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/api/shot' && req.method === 'POST') { // debug: page posts a PNG data URL, saved under out/shots
    const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '_');
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      fs.mkdirSync(path.join(ROOT, 'out', 'shots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'out', 'shots', name + '.png'), Buffer.from(body.split(',')[1] || '', 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (url === '/api/missions') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listMissions())); }
  let file;
  if (url.startsWith('/game/')) {
    file = path.join(GAME, url.slice(6));
    if (!file.startsWith(GAME)) { res.writeHead(403); return res.end(); }
    // case-insensitive fallback (game files are mixed case)
    if (!fs.existsSync(file)) {
      const dir = path.dirname(file), base = path.basename(file).toLowerCase();
      const hit = fs.existsSync(dir) && fs.readdirSync(dir).find(f => f.toLowerCase() === base);
      if (hit) file = path.join(dir, hit);
    }
  } else {
    file = path.join(ROOT, url === '/' ? 'web/index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`I76 viewer on http://localhost:${PORT}  (game: ${GAME})`));
