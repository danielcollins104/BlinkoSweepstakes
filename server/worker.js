import { DurableObject } from 'cloudflare:workers';
import { ApiRouter } from './apiRouter.js';
import { SqlStore, createDurableObjectDriver } from './store/Store.js';

/**
 * BlinkoCore Durable Object
 * Hosts single-writer SQLite state for accounts, SHA-256 ledger, provably fair seeds,
 * deposits, orders, KYC submissions, and prize redemptions on Cloudflare Workers.
 */
export class BlinkoCore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new SqlStore(createDurableObjectDriver(ctx.storage));
    this.router = new ApiRouter({ store: this.store, env: env || {} });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const body =
      request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
        ? await request.text()
        : '';

    const geo = {
      country: headers['x-cf-country'] || '',
      region: headers['x-cf-region'] || '',
    };
    const ip = headers['x-cf-ip'] || 'unknown';

    const response = await this.router.handleRequest(request.method, url.pathname, headers, body, {
      query: url.searchParams,
      geo,
      ip,
    });

    return new Response(response.body !== null ? JSON.stringify(response.body) : null, {
      status: response.status,
      headers: response.headers,
    });
  }
}

let fallbackRouter = null;
function getFallbackRouter(env) {
  if (!fallbackRouter) {
    fallbackRouter = new ApiRouter({ env: env || {} });
  }
  return fallbackRouter;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (env && env.BLINKO_CORE) {
        const id = env.BLINKO_CORE.idFromName('global');
        const stub = env.BLINKO_CORE.get(id);
        const headers = new Headers(request.headers);
        headers.set('x-cf-country', String(request.cf?.country || ''));
        headers.set('x-cf-region', String(request.cf?.regionCode || ''));
        headers.set('x-cf-ip', request.headers.get('cf-connecting-ip') || 'unknown');
        return stub.fetch(new Request(request, { headers }));
      }

      const router = getFallbackRouter(env);
      const headers = Object.fromEntries(request.headers.entries());
      const body =
        request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
          ? await request.text()
          : '';
      const response = await router.handleRequest(request.method, url.pathname, headers, body, {
        query: url.searchParams,
        geo: { country: request.cf?.country || '', region: request.cf?.regionCode || '' },
        ip: request.headers.get('cf-connecting-ip') || 'unknown',
      });
      return new Response(response.body !== null ? JSON.stringify(response.body) : null, {
        status: response.status,
        headers: response.headers,
      });
    }

    if (env && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(assetRes.headers);
      newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      newHeaders.set('X-Content-Type-Options', 'nosniff');
      newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
      newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: newHeaders,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
