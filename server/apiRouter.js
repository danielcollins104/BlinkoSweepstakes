import { BlinkoServer } from './BlinkoServer.js';
import { checkGeo, assertGeo } from './compliance/compliance.js';
import { SWEEPSTAKES_CONFIG } from '../src/config/sweepstakesConfig.js';
import { AuthService } from './auth/AuthService.js';

class RateLimiter {
  constructor() {
    this.windows = new Map();
  }
  hit(key, limit, windowMs) {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50000) this.windows.clear();
      return true;
    }
    w.count++;
    return w.count <= limit;
  }
}

const RATE_RULES = [
  { match: /^\/api\/(auth\/(login|register)|admin\/login)$/, limit: 20, windowMs: 60_000, by: 'ip' },
  { match: /^\/api\/(deposits|orders|payments|redeem|kyc)/, limit: 45, windowMs: 60_000, by: 'user' },
  { match: /^\/api\/drop$/, limit: 300, windowMs: 60_000, by: 'user' },
  { match: /^\/api\//, limit: 600, windowMs: 60_000, by: 'ip' },
];

export class ApiRouter {
  constructor(options = {}) {
    this.server = options.server || new BlinkoServer(options);
    this.payments = this.server.payments;
    this.limiter = new RateLimiter();
    this.allowedOrigins = String(options.env?.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  _cors(origin) {
    let allow = '*';
    if (this.allowedOrigins.length) {
      allow = this.allowedOrigins.includes(origin) ? origin : this.allowedOrigins[0];
    }
    return {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Idempotency-Key, Stripe-Signature',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
  }

  async handleRequest(method, path, headers = {}, body = {}, ctx = {}) {
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
    const cors = this._cors(h.origin || '');
    const reply = (status, payload) => ({ status, headers: cors, body: payload });
    if (method === 'OPTIONS') return { status: 204, headers: cors, body: null };

    const authHeader = h.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim() || null;
    const query = ctx.query instanceof URLSearchParams ? Object.fromEntries(ctx.query) : ctx.query || {};
    const geo = ctx.geo || {};
    const ip = ctx.ip || 'unknown';
    const rawBodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});

    // Stripe webhook receives raw string body + signature header
    if (path === '/api/payments/stripe/webhook' && method === 'POST') {
      try {
        const res = this.payments.handleStripeWebhook(rawBodyStr, h['stripe-signature']);
        return reply(200, { received: true, ...res });
      } catch (err) {
        return reply(400, { error: err.message });
      }
    }

    let b = {};
    try {
      b = typeof body === 'string' ? (body.length ? JSON.parse(body) : {}) : body || {};
    } catch {
      return reply(400, { error: 'Invalid JSON body' });
    }

    const S = this.server;
    const P = this.payments;
    const session = (role = null) => S.authService.validateSession(token, role);
    const player = () => {
      const s = session();
      if (s.role === 'GUEST') {
        const e = new Error('Please sign in or register an account first.');
        e.status = 401;
        throw e;
      }
      return s;
    };
    const admin = () => session('ADMIN');

    let userKey = ip;
    if (token) {
      try {
        userKey = S.authService.validateSession(token).userId;
      } catch {}
    }
    for (const rule of RATE_RULES) {
      if (rule.match.test(path)) {
        const key = `${rule.match.source}|${rule.by === 'user' ? userKey : ip}`;
        if (!this.limiter.hit(key, rule.limit, rule.windowMs)) {
          return reply(429, { error: 'Too many requests. Please slow down.' });
        }
        break;
      }
    }

    try {
      // PUBLIC
      if (path === '/api/health') {
        return reply(200, {
          status: 'healthy',
          game: 'BLINKO: Headline Chaos 2026',
          storage: S.store.kind,
          timestamp: new Date().toISOString(),
        });
      }

      if (path === '/api/payments/config' && method === 'GET') {
        return reply(200, { success: true, ...P.publicConfig(checkGeo(S.compliance, geo)) });
      }

      if (path === '/api/geo' && method === 'GET') {
        return reply(200, { success: true, ...checkGeo(S.compliance, geo) });
      }

      if (path === '/api/provably-fair' && method === 'GET') {
        return reply(200, { success: true, ...S.getProvablyFairCommitment() });
      }

      if (path === '/api/provably-fair/verify' && method === 'POST') {
        return reply(200, { success: true, ...S.verifyProvablyFairDrop(b) });
      }

      // AUTH
      if (path === '/api/auth/register' && method === 'POST') {
        const res = S.authService.registerUser({ email: b.email, password: b.password, name: b.name });
        const balance = S.wallet.getAccount(res.user.id);
        return reply(201, { success: true, ...res, balance });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const res = S.authService.loginUser(b.email, b.password);
        const balance = S.wallet.getAccount(res.user.id);
        return reply(200, { success: true, ...res, balance });
      }

      if (path === '/api/auth/guest' && method === 'POST') {
        const res = S.authService.createGuestSession();
        const balance = S.wallet.getAccount(res.user.id, { isGuest: true });
        return reply(200, { success: true, ...res, balance });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        S.authService.revokeSession(token);
        return reply(200, { success: true });
      }

      if (path === '/api/auth/me' && method === 'GET') {
        const s = session();
        const user =
          s.role === 'GUEST'
            ? { id: s.userId, role: 'GUEST', name: s.name, kycStatus: 'none' }
            : AuthService.publicUser(S.authService.getUserById(s.userId));
        return reply(200, {
          success: true,
          user,
          balance: S.wallet.getAccount(s.userId, { isGuest: s.role === 'GUEST' }),
        });
      }

      // WALLET & BLINKO GAME
      if (path === '/api/balance' && (method === 'GET' || method === 'POST')) {
        if (!token) return reply(401, { error: 'Authentication required' });
        return reply(200, { success: true, balance: S.getBalance(token) });
      }

      if (path === '/api/drop' && method === 'POST') {
        let activeToken = token;
        let guestIssued = null;
        if (!activeToken) {
          if (String(b.currencyMode || '').toUpperCase() === 'SC') {
            return reply(401, { error: 'Sign in or create a free account to play with Sweeps Coins.' });
          }
          guestIssued = S.authService.createGuestSession();
          activeToken = guestIssued.token;
        }
        const s = S.authService.validateSession(activeToken);
        if (String(b.currencyMode || '').toUpperCase() === 'SC') {
          if (s.role === 'GUEST') {
            return reply(401, { error: 'Sign in or create a free account to play with Sweeps Coins.' });
          }
          assertGeo(S.compliance, geo);
        }
        const result = S.handleDropRequest(activeToken, b);
        return reply(200, {
          success: true,
          ...result,
          token: guestIssued ? guestIssued.token : undefined,
        });
      }

      if (path === '/api/promotions/daily' && method === 'POST') {
        const s = session();
        const day = new Date().toISOString().slice(0, 10);
        const reward = SWEEPSTAKES_CONFIG.dailyReward || { goldCoins: 10000, sweepsCoins: 1.0 };
        const grantSC = s.role !== 'GUEST' && checkGeo(S.compliance, geo).allowed ? reward.sweepsCoins : 0;
        try {
          const balance = S.wallet.grantPromotion(s.userId, {
            goldCoins: reward.goldCoins,
            sweepsCoins: grantSC,
            reason: 'daily_login_bonus',
            promoKey: `daily:${s.userId}:${day}`,
          });
          return reply(200, {
            success: true,
            granted: { goldCoins: reward.goldCoins, sweepsCoins: grantSC },
            balance,
          });
        } catch (err) {
          if (err.code === 'DUPLICATE') {
            return reply(409, { error: 'Daily bonus already claimed today! Come back tomorrow.', nextClaimAt: `${day}T23:59:59Z` });
          }
          throw err;
        }
      }

      if (path === '/api/promotions/amoe' && method === 'POST') {
        const s = player();
        assertGeo(S.compliance, geo);
        const day = new Date().toISOString().slice(0, 10);
        const reward = SWEEPSTAKES_CONFIG.amoeReward || { goldCoins: 5000, sweepsCoins: 1.0 };
        try {
          const balance = S.wallet.grantPromotion(s.userId, {
            goldCoins: reward.goldCoins,
            sweepsCoins: reward.sweepsCoins,
            reason: 'amoe_free_entry',
            promoKey: `amoe:${s.userId}:${day}`,
          });
          return reply(200, {
            success: true,
            granted: { goldCoins: reward.goldCoins, sweepsCoins: reward.sweepsCoins },
            balance,
          });
        } catch (err) {
          if (err.code === 'DUPLICATE') {
            return reply(409, { error: 'Daily AMOE free sweepstakes entry already claimed today.' });
          }
          throw err;
        }
      }

      if (path === '/api/ledger/user' && (method === 'GET' || method === 'POST')) {
        if (!token) return reply(401, { error: 'Authentication required' });
        const limit = Math.min(200, Number(b.limit || query.limit) || 50);
        return reply(200, { success: true, history: S.getUserAuditHistory(token, limit) });
      }

      // CRYPTO DEPOSITS
      if (path === '/api/deposits/crypto' && method === 'POST') {
        const dep = await P.createCryptoDeposit(player(), b, geo);
        return reply(201, { success: true, deposit: dep });
      }

      if (path === '/api/deposits/crypto/submit' && method === 'POST') {
        const res = await P.submitCryptoTx(player(), { depositId: b.depositId, txHash: b.txHash });
        return reply(200, { success: true, ...res });
      }

      if (path === '/api/deposits/crypto/status' && (method === 'POST' || method === 'GET')) {
        const s = player();
        const id = b.depositId || query.depositId;
        const d = P.getDepositForUser(s, id);
        if (d.txHash && ['awaiting_payment', 'confirming'].includes(d.status)) {
          const res = await P.submitCryptoTx(s, { depositId: id, txHash: d.txHash });
          return reply(200, { success: true, ...res });
        }
        return reply(200, { success: true, deposit: P._publicDeposit(d) });
      }

      if (path === '/api/deposits/crypto/mine' && method === 'GET') {
        const s = player();
        const deps = S.store.find('deposits', { k2: s.userId, limit: 50 }).map((d) => P._publicDeposit(d));
        return reply(200, { success: true, deposits: deps });
      }

      // CASH APP DEPOSITS
      if ((path === '/api/orders/cashapp' || path === '/api/orders') && method === 'POST') {
        const order = P.createCashAppOrder(
          player(),
          {
            packageId: b.packageId,
            customAmountUsd: b.customAmountUsd ?? b.amountUsd ?? null,
            senderTag: b.senderTag,
          },
          geo
        );
        return reply(201, { success: true, order });
      }

      if (path === '/api/orders/cashapp/sent' && method === 'POST') {
        return reply(200, { success: true, order: P.markCashAppOrderSent(player(), b) });
      }

      if (path === '/api/orders/mine' && method === 'GET') {
        return reply(200, { success: true, orders: P.listOrdersForUser(player()) });
      }

      // CARD DEPOSITS (NMI + STRIPE)
      if (path === '/api/payments/card/charge' && method === 'POST') {
        const res = await P.chargeCard(
          player(),
          { ...b, idempotencyKey: b.idempotencyKey || h['idempotency-key'] },
          geo,
          ip
        );
        return reply(200, { success: res.charge.status === 'approved', ...res });
      }

      if (path === '/api/payments/stripe/checkout' && method === 'POST') {
        const res = await P.createStripeCheckout(player(), { ...b, origin: h.origin || b.origin }, geo);
        return reply(201, { success: true, ...res });
      }

      if (path === '/api/payments/stripe/confirm' && method === 'POST') {
        const res = await P.confirmStripeSession(player(), b);
        return reply(200, { success: true, ...res });
      }

      // KYC & PAYOUTS
      if (path === '/api/kyc/submit' && method === 'POST') {
        return reply(200, { success: true, ...P.submitKyc(player(), b, geo) });
      }

      if (path === '/api/kyc/status' && method === 'GET') {
        return reply(200, { success: true, ...P.getKycStatus(player()) });
      }

      if (path === '/api/redeem' && method === 'POST') {
        const res = P.requestRedemption(player(), b, geo);
        return reply(200, { success: true, ...res });
      }

      if (path === '/api/redemptions/mine' && method === 'GET') {
        return reply(200, { success: true, redemptions: P.listRedemptionsForUser(player()) });
      }

      // ADMIN OPERATOR CONSOLE
      if (path === '/api/admin/login' && method === 'POST') {
        return reply(200, { success: true, ...S.adminLogin(b.adminKey) });
      }

      if (path.startsWith('/api/admin/')) {
        if (!token) return reply(401, { error: 'Admin token required' });
        const a = admin();
        const status = query.status || b.status;
        const limit = Math.min(500, Number(query.limit || b.limit) || 200);

        switch (`${method} ${path}`) {
          case 'GET /api/admin/verify':
            return reply(200, {
              success: true,
              user: { id: a.userId, name: a.name, email: a.email, role: a.role },
              expiresAt: a.expiresAt,
            });

          case 'GET /api/admin/summary': {
            const count = (coll, st) => S.store.find(coll, { k1: st, limit: 1000 }).length;
            return reply(200, {
              success: true,
              pending: {
                cashAppOrders: count('orders', 'awaiting_confirmation') + count('orders', 'awaiting_payment'),
                cryptoReview: count('deposits', 'needs_review'),
                cardUnknown: count('card_charges', 'unknown'),
                redemptions: count('redemptions', 'pending_review') + count('redemptions', 'approved'),
                kyc: count('kyc', 'pending'),
              },
            });
          }

          case 'GET /api/admin/orders':
            return reply(200, { success: true, orders: S.store.find('orders', { k1: status || undefined, limit }) });
          case 'POST /api/admin/orders/confirm':
            return reply(200, { success: true, ...P.adminConfirmCashAppOrder(a, b) });
          case 'POST /api/admin/orders/reject':
            return reply(200, { success: true, order: P.adminRejectOrder(a, b) });

          case 'GET /api/admin/deposits':
            return reply(200, { success: true, deposits: S.store.find('deposits', { k1: status || undefined, limit }) });
          case 'POST /api/admin/deposits/resolve':
            return reply(200, { success: true, ...P.adminResolveCryptoDeposit(a, b) });

          case 'GET /api/admin/card-charges':
            return reply(200, { success: true, charges: S.store.find('card_charges', { k1: status || undefined, limit }) });
          case 'POST /api/admin/card-charges/reconcile':
            return reply(200, { success: true, ...(await P.adminReconcileCard(a, b)) });

          case 'GET /api/admin/redemptions':
            return reply(200, { success: true, redemptions: S.store.find('redemptions', { k1: status || undefined, limit }) });
          case 'POST /api/admin/redemptions/quote':
            return reply(200, { success: true, ...(await P.adminQuoteRedemption(a, b)) });
          case 'POST /api/admin/redemptions/mark-paid':
            return reply(200, { success: true, ...(await P.adminMarkRedemptionPaid(a, b)) });
          case 'POST /api/admin/redemptions/reject':
            return reply(200, { success: true, ...P.adminRejectRedemption(a, b) });

          case 'GET /api/admin/kyc':
            return reply(200, { success: true, submissions: S.store.find('kyc', { k1: status || undefined, limit }) });
          case 'POST /api/admin/kyc/decide':
            return reply(200, { success: true, kyc: P.adminDecideKyc(a, b) });

          case 'POST /api/admin/user': {
            const user = b.userId ? S.authService.getUserById(b.userId) : S.authService.getUserByEmail(b.email);
            if (!user) return reply(404, { error: 'User not found' });
            return reply(200, {
              success: true,
              user: AuthService.publicUser(user),
              balance: S.wallet.getAccount(user.id),
              kyc: S.store.get('kyc', user.id),
              ledger: S.ledger.getUserHistory(user.id, 50),
            });
          }

          case 'POST /api/admin/adjust-balance':
            return reply(200, { success: true, ...S.adminAdjustBalance(token, b) });

          case 'GET /api/admin/ledger':
            return reply(200, {
              success: true,
              chain: S.adminGetFullLedger(token, limit),
              integrity: S.verifyLedgerIntegrity(token),
            });

          case 'POST /api/admin/provably-fair/rotate':
            return reply(200, { success: true, ...S.rotateProvablyFairSeed() });

          default:
            return reply(404, { error: `Endpoint not found: ${path}` });
        }
      }

      return reply(404, { error: `Endpoint not found: ${path}` });
    } catch (err) {
      const msg = String(err?.message || 'Request failed');
      let status = err?.status || 400;
      if (!err?.status) {
        if (msg.startsWith('Unauthorized: Forbidden')) status = 403;
        else if (msg.startsWith('Unauthorized')) status = 401;
      }
      if (status >= 500) console.error(`[API ERROR] ${path}:`, msg);
      return reply(status, { error: msg, code: err?.code || undefined, timestamp: new Date().toISOString() });
    }
  }
}
