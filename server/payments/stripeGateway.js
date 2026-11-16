import crypto from 'node:crypto';

export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
  'transfer.created',
  'charge.dispute.created',
  'charge.refunded',
];

/**
 * Live Stripe REST API Client (zero external SDK dependency, uses native fetch).
 * Active automatically when STRIPE_SECRET_KEY is configured in environment.
 */
export class StripeGateway {
  constructor({ env = {}, fetchImpl } = {}) {
    this.secretKey = env.STRIPE_SECRET_KEY || null;
    this.publishableKey = env.STRIPE_PUBLISHABLE_KEY || null;
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET || null;
    this.apiBase = String(env.STRIPE_API_BASE || 'https://api.stripe.com/v1').replace(/\/+$/, '');
    this.fetch = fetchImpl || ((...a) => fetch(...a));
  }

  get enabled() {
    return Boolean(this.secretKey);
  }

  publicConfig() {
    return {
      enabled: this.enabled,
      publishableKey: this.enabled ? this.publishableKey : null,
      webhookConfigured: Boolean(this.webhookSecret),
      webhookEvents: STRIPE_WEBHOOK_EVENTS,
    };
  }

  static _encodeForm(obj, prefix = '') {
    const pairs = [];
    for (const [k, v] of Object.entries(obj || {})) {
      if (v === undefined || v === null || v === '') continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (typeof v === 'object' && !Array.isArray(v)) {
        pairs.push(StripeGateway._encodeForm(v, key));
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'object') pairs.push(StripeGateway._encodeForm(item, `${key}[${i}]`));
          else pairs.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        });
      } else {
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    }
    return pairs.filter(Boolean).join('&');
  }

  async _request(method, endpoint, params = null) {
    if (!this.enabled) throw new Error('Stripe is not configured on this server.');
    const headers = { Authorization: `Bearer ${this.secretKey}` };
    const init = { method, headers };
    let url = `${this.apiBase}${endpoint}`;
    if (params && method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = StripeGateway._encodeForm(params);
    }
    const res = await this.fetch(url, init);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Stripe API error (${res.status})`);
    }
    return data;
  }

  async createCheckoutSession({ sessionRef, packageTitle, amountUsd, goldCoins, freeSweepsCoins, customerEmail, successUrl, cancelUrl, userId, packageId }) {
    const unitAmountCents = Math.round(Number(amountUsd) * 100);
    return this._request('POST', '/checkout/sessions', {
      mode: 'payment',
      customer_email: customerEmail || undefined,
      client_reference_id: sessionRef,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmountCents,
            product_data: {
              name: `${packageTitle} (${Number(goldCoins).toLocaleString()} GC)`,
              description: `Includes ${Number(freeSweepsCoins).toFixed(2)} FREE promotional Sweeps Coins`,
            },
          },
        },
      ],
      metadata: {
        sessionRef,
        userId,
        packageId,
        goldCoins: String(goldCoins),
        freeSweepsCoins: String(freeSweepsCoins),
      },
    });
  }

  async retrieveCheckoutSession(stripeSessionId) {
    return this._request('GET', `/checkout/sessions/${encodeURIComponent(stripeSessionId)}`);
  }

  /**
   * Executes a live Stripe Connect Transfer (when destination acct_... is provided)
   * or a standard Stripe Payout (to platform/external bank).
   */
  async createPayoutOrTransfer({ amountUsd, destination, description, redemptionId }) {
    const amountCents = Math.round(Number(amountUsd) * 100);
    const dest = String(destination || '').trim();
    if (dest.startsWith('acct_')) {
      return this._request('POST', '/transfers', {
        amount: amountCents,
        currency: 'usd',
        destination: dest,
        description: description || `Blinko Prize Redemption ${redemptionId}`,
        metadata: { redemptionId },
      });
    }
    return this._request('POST', '/payouts', {
      amount: amountCents,
      currency: 'usd',
      description: description || `Blinko Prize Redemption ${redemptionId}`,
      metadata: { redemptionId, destination: dest },
    });
  }

  /**
   * Verifies Stripe-Signature header (`t=...,v1=...`) using HMAC-SHA256 in constant time.
   */
  verifyWebhookSignature(rawBody, signatureHeader, toleranceSeconds = 300) {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    const parts = String(signatureHeader || '')
      .split(',')
      .map((s) => s.trim().split('='));
    const ts = parts.find(([k]) => k === 't')?.[1];
    const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!ts || sigs.length === 0) throw new Error('Invalid Stripe-Signature header.');
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (toleranceSeconds > 0 && age > toleranceSeconds) {
      throw new Error('Stripe webhook timestamp outside tolerance.');
    }
    const signedPayload = `${ts}.${rawBody}`;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const match = sigs.some((s) => {
      const buf = Buffer.from(String(s), 'utf8');
      return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
    });
    if (!match) throw new Error('Stripe webhook signature verification failed.');
    return JSON.parse(rawBody);
  }
}
