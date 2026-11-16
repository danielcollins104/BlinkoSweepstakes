// ============================================================================
// NMI CARD GATEWAY (server-side) — PCI SAQ-A Collect.js tokenization
// ============================================================================
export class NmiGateway {
  constructor({ env = {}, fetchImpl } = {}) {
    this.securityKey = env.NMI_SECURITY_KEY || null;
    this.tokenizationKey = env.NMI_TOKENIZATION_KEY || null;
    this.apiBase = String(env.NMI_API_BASE || 'https://secure.nmi.com').replace(/\/+$/, '');
    this.fetch = fetchImpl || ((...a) => fetch(...a));
  }

  get enabled() {
    return Boolean(this.securityKey && this.tokenizationKey);
  }

  publicConfig() {
    return {
      enabled: this.enabled,
      tokenizationKey: this.enabled ? this.tokenizationKey : null,
      collectJsUrl: `${this.apiBase}/token/Collect.js`,
    };
  }

  static _form(obj) {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  async sale({ amountUsd, paymentToken, orderId, billing = {}, ipAddress, email }) {
    if (!this.enabled) throw new Error('NMI card payments are not configured yet.');
    if (!paymentToken) throw new Error('Missing card payment token.');
    const body = NmiGateway._form({
      security_key: this.securityKey,
      type: 'sale',
      amount: Number(amountUsd).toFixed(2),
      currency: 'USD',
      payment_token: paymentToken,
      orderid: orderId,
      order_description: 'Blinko Gold Coin Package',
      first_name: billing.firstName,
      last_name: billing.lastName,
      address1: billing.address1,
      city: billing.city,
      state: billing.state,
      zip: billing.zip,
      country: billing.country || 'US',
      email,
      ipaddress: ipAddress,
    });
    let text;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await this.fetch(`${this.apiBase}/api/transact.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: controller.signal,
        });
        text = await res.text();
        if (!res.ok) return { status: 'unknown', responseText: `Gateway HTTP ${res.status}` };
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      return { status: 'unknown', responseText: `Gateway unreachable: ${err.message}` };
    }
    const p = new URLSearchParams(text);
    const code = p.get('response');
    const out = {
      transactionId: p.get('transactionid') || null,
      authCode: p.get('authcode') || null,
      responseText: p.get('responsetext') || '',
      responseCode: p.get('response_code') || null,
      avs: p.get('avsresponse') || null,
      cvv: p.get('cvvresponse') || null,
    };
    if (code === '1') return { status: 'approved', ...out };
    if (code === '2') return { status: 'declined', ...out };
    if (code === '3') return { status: 'error', ...out };
    return { status: 'unknown', ...out };
  }

  async queryByOrderId(orderId) {
    if (!this.enabled) throw new Error('NMI card payments are not configured yet.');
    const res = await this.fetch(`${this.apiBase}/api/query.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: NmiGateway._form({ security_key: this.securityKey, order_id: orderId }),
    });
    const xml = await res.text();
    const txBlocks = xml.match(/<transaction>[\s\S]*?<\/transaction>/g) || [];
    for (const block of txBlocks) {
      const get = (tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || null;
      const condition = get('condition');
      const transactionId = get('transaction_id');
      const saleOk = /<action>[\s\S]*?<action_type>sale<\/action_type>[\s\S]*?<success>1<\/success>[\s\S]*?<\/action>/.test(block);
      if (saleOk && condition !== 'failed' && condition !== 'canceled') {
        return { status: 'approved', transactionId, condition };
      }
    }
    return { status: txBlocks.length ? 'declined' : 'not_found' };
  }
}
