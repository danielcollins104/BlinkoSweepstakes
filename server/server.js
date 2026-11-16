import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiRouter } from './apiRouter.js';
import { openDefaultSqliteStore } from './store/nodeSqlite.js';
import { loadEnvLocal } from './vitePluginBlinko.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

loadEnvLocal(ROOT_DIR);

const PORT = Number(process.env.PORT || 3002);
const store = await openDefaultSqliteStore(process.env.SQLITE_PATH || path.join(ROOT_DIR, 'data/blinko.sqlite'));
const router = new ApiRouter({ store, env: process.env });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      const isSecure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
      const response = await router.handleRequest(req.method, pathname, req.headers, body, {
        query: urlObj.searchParams,
        ip: req.socket?.remoteAddress || '127.0.0.1',
        isSecure,
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body !== null ? JSON.stringify(response.body) : undefined);
    });
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com",
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found — Run npm.cmd run build first.');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLINKO: Headline Chaos 2026 Sweepstakes Server listening on http://localhost:${PORT}`);
});

export default server;
