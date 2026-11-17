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
const MAX_API_BODY_BYTES = 262_144;

const STATIC_CSP =
  "default-src 'self'; script-src 'self' https://secure.nmi.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://secure.nmi.com; frame-src https://secure.nmi.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com";

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

function resolveSafeStaticAsset(rawPathname) {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(String(rawPathname || '/'));
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = path.resolve(DIST_DIR, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
    return path.join(DIST_DIR, 'index.html');
  }
  return candidate;
}

const server = http.createServer((req, res) => {
  let urlObj;
  try {
    urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Malformed request URL' }));
    return;
  }
  const pathname = urlObj.pathname;
  const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
  const forwardedProto = trustProxy ? String(req.headers['x-forwarded-proto'] || '').toLowerCase() : '';
  const isSecure = Boolean(req.socket?.encrypted || forwardedProto === 'https');
  const clientIp =
    (trustProxy && String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

  if (pathname.startsWith('/api/')) {
    let body = '';
    let byteLen = 0;
    let aborted = false;

    req.on('error', () => {
      aborted = true;
    });

    req.on('data', (chunk) => {
      if (aborted) return;
      byteLen += chunk.length;
      if (byteLen > MAX_API_BODY_BYTES) {
        aborted = true;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
        }
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', async () => {
      if (aborted) return;
      try {
        const response = await router.handleRequest(req.method, pathname, req.headers, body, {
          query: urlObj.searchParams,
          ip: clientIp,
          isSecure,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body !== null ? JSON.stringify(response.body) : undefined);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });
    return;
  }

  const filePath = resolveSafeStaticAsset(pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const secHeaders = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Permitted-Cross-Domain-Policies': 'none',
      'Content-Security-Policy': STATIC_CSP,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (isSecure) {
      secHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
    }
    res.writeHead(200, secHeaders);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found — Run npm run build first.');
  }
});

const BIND_HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, BIND_HOST, () => {
  console.log(`BLINKO: Headline Chaos 2026 Sweepstakes Server listening on http://localhost:${PORT}`);
});

export default server;
