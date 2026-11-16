const TOKEN_KEY = 'blinko_session_token_v1';
const ADMIN_TOKEN_KEY = 'blinko_admin_token_v1';

async function request(path, { method = 'GET', body, token, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const activeToken = token ?? (admin ? localStorage.getItem(ADMIN_TOKEN_KEY) : localStorage.getItem(TOKEN_KEY));
  if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const apiClient = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
  getAdminToken: () => localStorage.getItem(ADMIN_TOKEN_KEY),
  setAdminToken: (t) => (t ? localStorage.setItem(ADMIN_TOKEN_KEY, t) : localStorage.removeItem(ADMIN_TOKEN_KEY)),

  // Auth
  me: () => request('/api/auth/me'),
  guest: async () => {
    const res = await request('/api/auth/guest', { method: 'POST' });
    if (res.token) apiClient.setToken(res.token);
    return res;
  },
  register: async (payload) => {
    const res = await request('/api/auth/register', { method: 'POST', body: payload });
    if (res.token) apiClient.setToken(res.token);
    return res;
  },
  login: async (payload) => {
    const res = await request('/api/auth/login', { method: 'POST', body: payload });
    if (res.token) apiClient.setToken(res.token);
    return res;
  },
  logout: async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      apiClient.setToken(null);
    }
  },

  // Game & Promos
  getPaymentsConfig: () => request('/api/payments/config'),
  getProvablyFair: () => request('/api/provably-fair'),
  verifyProvablyFair: (payload) => request('/api/provably-fair/verify', { method: 'POST', body: payload }),
  drop: async (payload) => {
    const res = await request('/api/drop', { method: 'POST', body: payload });
    if (res.token) apiClient.setToken(res.token);
    return res;
  },
  claimDaily: () => request('/api/promotions/daily', { method: 'POST' }),
  claimAmoe: () => request('/api/promotions/amoe', { method: 'POST' }),
  getLedger: (limit = 50) => request(`/api/ledger/user?limit=${limit}`),

  // Deposits
  createCryptoDeposit: (payload) => request('/api/deposits/crypto', { method: 'POST', body: payload }),
  submitCryptoTx: (payload) => request('/api/deposits/crypto/submit', { method: 'POST', body: payload }),
  getCryptoStatus: (depositId) => request(`/api/deposits/crypto/status?depositId=${encodeURIComponent(depositId)}`),
  myCryptoDeposits: () => request('/api/deposits/crypto/mine'),

  createCashAppOrder: (payload) => request('/api/orders/cashapp', { method: 'POST', body: payload }),
  markCashAppSent: (payload) => request('/api/orders/cashapp/sent', { method: 'POST', body: payload }),
  myOrders: () => request('/api/orders/mine'),

  chargeNmiCard: (payload) => request('/api/payments/card/charge', { method: 'POST', body: payload }),
  createStripeCheckout: (payload) =>
    request('/api/payments/stripe/checkout', {
      method: 'POST',
      body: { ...payload, origin: window.location.origin },
    }),
  confirmStripeSession: (payload) => request('/api/payments/stripe/confirm', { method: 'POST', body: payload }),

  // KYC & Payouts
  getKycStatus: () => request('/api/kyc/status'),
  submitKyc: (payload) => request('/api/kyc/submit', { method: 'POST', body: payload }),
  redeem: (payload) => request('/api/redeem', { method: 'POST', body: payload }),
  myRedemptions: () => request('/api/redemptions/mine'),

  // Admin Operator
  adminLogin: async (adminKey) => {
    const res = await request('/api/admin/login', { method: 'POST', body: { adminKey }, token: '' });
    if (res.token) apiClient.setAdminToken(res.token);
    return res;
  },
  adminVerify: () => request('/api/admin/verify', { admin: true }),
  adminSummary: () => request('/api/admin/summary', { admin: true }),
  adminOrders: () => request('/api/admin/orders', { admin: true }),
  adminConfirmOrder: (payload) => request('/api/admin/orders/confirm', { method: 'POST', body: payload, admin: true }),
  adminRejectOrder: (payload) => request('/api/admin/orders/reject', { method: 'POST', body: payload, admin: true }),
  adminDeposits: () => request('/api/admin/deposits', { admin: true }),
  adminResolveDeposit: (payload) => request('/api/admin/deposits/resolve', { method: 'POST', body: payload, admin: true }),
  adminRedemptions: () => request('/api/admin/redemptions', { admin: true }),
  adminQuoteRedemption: (payload) => request('/api/admin/redemptions/quote', { method: 'POST', body: payload, admin: true }),
  adminMarkRedemptionPaid: (payload) =>
    request('/api/admin/redemptions/mark-paid', { method: 'POST', body: payload, admin: true }),
  adminRejectRedemption: (payload) =>
    request('/api/admin/redemptions/reject', { method: 'POST', body: payload, admin: true }),
  adminKycList: () => request('/api/admin/kyc', { admin: true }),
  adminDecideKyc: (payload) => request('/api/admin/kyc/decide', { method: 'POST', body: payload, admin: true }),
  adminAdjustBalance: (payload) => request('/api/admin/adjust-balance', { method: 'POST', body: payload, admin: true }),
  adminLedger: (limit = 100) => request(`/api/admin/ledger?limit=${limit}`, { admin: true }),
  adminRotateSeed: () => request('/api/admin/provably-fair/rotate', { method: 'POST', admin: true }),
};
