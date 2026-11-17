// Minimal static file server for local development: `npm start`.
// Data bundles are served as plain gzip files; the browser inflates them itself.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The published site lives in docs/ (GitHub Pages serves that folder).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.gz': 'application/gzip',
  '.bin': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
};
const port = Number(process.env.PORT || 5180);

http
  .createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
    // Only files inside docs/ (a bare prefix test would also allow a sibling folder such as docs-old/).
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  })
  // This computer only: a development server should not be reachable from the rest of the network.
  .listen(port, '127.0.0.1', () => console.log(`Ask Asheville is running at http://localhost:${port}`));
