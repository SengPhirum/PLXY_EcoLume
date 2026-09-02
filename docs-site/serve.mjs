/**
 * Minimal preview server for the built documentation site.
 *
 *   npm --prefix docs-site run serve   # http://localhost:4321
 *
 * Web Serial needs a secure context, and localhost counts as one, so the
 * browser installer can be tested end to end from here.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const port = Number(process.env.PORT ?? 4321);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = path.join(root, path.normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) { response.writeHead(403).end('Forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<h1>404</h1><p>Not found. Run <code>npm --prefix docs-site run build</code> first.</p>');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}).listen(port, () => console.log(`EcoLume docs preview on http://localhost:${port}`));
