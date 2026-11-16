async function request(path, { method = 'GET', body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'BlinkoClient',
  };

  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
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
  // Public safe config
  getGameConfig: () => request('/api/game/config'),
  getPaymentsConfig: () => request('/api/payments/config'),

  // Auth (HttpOnly; SameSite=Strict cookie sessions managed by browser)
  me: () => request('/api/auth/me'),
  guest: () => request('/api/auth/guest', { method: 'POST' }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  // Game, Provably Fair & Promos
  getProvablyFair: () => request('/api/provably-fair'),
  rotateProvablyFair: () => request('/api/provably-fair/rotate', { method: 'POST' }),
  verifyProvablyFair: (payload) => request('/api/provably-fair/verify', { method: 'POST', body: payload }),
  drop: (payload) => request('/api/drop', { method: 'POST', body: payload }),
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

  createOnrampLink: (payload) => request('/api/payments/onramp', { method: 'POST', body: payload }),
  chargeNmiCard: (payload) => request('/api/payments/card/charge', { method: 'POST', body: payload }),
  createStripeCheckout: (payload) => request('/api/payments/stripe/checkout', { method: 'POST', body: payload }),
  confirmStripeSession: (payload) => request('/api/payments/stripe/confirm', { method: 'POST', body: payload }),

  // KYC & Payouts
  getKycStatus: () => request('/api/kyc/status'),
  submitKyc: (payload) => request('/api/kyc/submit', { method: 'POST', body: payload }),
  redeem: (payload) => request('/api/redeem', { method: 'POST', body: payload }),
  myRedemptions: () => request('/api/redemptions/mine'),

  // Admin Operator (HttpOnly; Path=/api/admin cookie)
  adminLogin: (adminKey) => request('/api/admin/login', { method: 'POST', body: { adminKey } }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminVerify: () => request('/api/admin/verify'),
  adminSummary: () => request('/api/admin/summary'),
  adminOrders: () => request('/api/admin/orders'),
  adminConfirmOrder: (payload) => request('/api/admin/orders/confirm', { method: 'POST', body: payload }),
  adminRejectOrder: (payload) => request('/api/admin/orders/reject', { method: 'POST', body: payload }),
  adminDeposits: () => request('/api/admin/deposits'),
  adminResolveDeposit: (payload) => request('/api/admin/deposits/resolve', { method: 'POST', body: payload }),
  adminRedemptions: () => request('/api/admin/redemptions'),
  adminQuoteRedemption: (payload) => request('/api/admin/redemptions/quote', { method: 'POST', body: payload }),
  adminMarkRedemptionPaid: (payload) => request('/api/admin/redemptions/mark-paid', { method: 'POST', body: payload }),
  adminRejectRedemption: (payload) => request('/api/admin/redemptions/reject', { method: 'POST', body: payload }),
  adminKycList: () => request('/api/admin/kyc'),
  adminDecideKyc: (payload) => request('/api/admin/kyc/decide', { method: 'POST', body: payload }),
  adminAdjustBalance: (payload) => request('/api/admin/adjust-balance', { method: 'POST', body: payload }),
  adminLedger: (limit = 100) => request(`/api/admin/ledger?limit=${limit}`),
  adminRotateSeed: () => request('/api/admin/provably-fair/rotate', { method: 'POST' }),
};
