// Tiny dependency-free static file server for development: `node tools/serve.mjs [port]` (default 8080, or $PORT).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('bad request'); return; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.resolve(ROOT, '.' + urlPath);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  if (file.split(path.sep).includes('node_modules') || file.split(path.sep).includes('.git')) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => console.log(`Nachtglut dev server: http://localhost:${PORT}/  (root ${ROOT})`));
