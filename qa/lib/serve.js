// Minimal static file server so the game can be loaded over http:// (the MP3 assets are not
// fetched on file://). Serves one directory on an ephemeral localhost port.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve(root) {
  const log = [];
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, path.normalize(rel));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      log.push({ url: rel, status: err ? 404 : 200 });
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.unref();
    resolve({ origin: `http://127.0.0.1:${server.address().port}`, log });
  }));
}

module.exports = { serve };
