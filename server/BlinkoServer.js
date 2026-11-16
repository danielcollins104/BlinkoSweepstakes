import { AuditLedger } from './ledger/AuditLedger.js';
import { ServerWallet } from './engine/ServerWallet.js';
import { BlinkoDropService } from './engine/BlinkoDropService.js';
import { AuthService } from './auth/AuthService.js';
import { PaymentsService } from './payments/PaymentsService.js';
import { MemoryStore } from './store/Store.js';
import { loadComplianceConfig } from './compliance/compliance.js';

export class BlinkoServer {
  constructor(options = {}) {
    const env = options.env || (typeof process !== 'undefined' ? process.env : {});
    const secretOpts = { requireSecrets: Boolean(options.requireSecrets) };
    this.env = env;
    this.store = options.store || new MemoryStore();
    this.ledger = new AuditLedger(this.store, {
      ledgerSecret: options.ledgerSecret || env.DC_LEDGER_SECRET,
      ...secretOpts,
    });
    this.wallet = new ServerWallet(this.store, this.ledger, {
      initialAccounts: options.initialAccounts || {},
      welcomeGC: options.welcomeGC,
      welcomeSC: options.welcomeSC,
    });
    this.dropService = new BlinkoDropService(this.wallet, this.ledger, this.store);
    this.authService = new AuthService(this.store, this.ledger, {
      adminSecret: options.adminSecret || env.DC_ADMIN_SECRET,
    });
    this.compliance = loadComplianceConfig(env, { geoEnforce: options.geoEnforce ?? false });
    this.payments = new PaymentsService({
      store: this.store,
      wallet: this.wallet,
      ledger: this.ledger,
      auth: this.authService,
      compliance: this.compliance,
      env,
      fetchImpl: options.fetchImpl,
      priceOracle: options.priceOracle,
      verifier: options.verifier,
      nmi: options.nmi,
      stripe: options.stripe,
    });
  }

  _authenticate(token, requiredRole = null) {
    return this.authService.validateSession(token, requiredRole);
  }

  getProvablyFairCommitment(authToken) {
    const session = this._authenticate(authToken);
    return this.dropService.getUserCommitment(session.userId);
  }

  rotateProvablyFairSeed(authToken) {
    const session = this._authenticate(authToken);
    return this.dropService.rotateUserSeed(session.userId);
  }

  verifyProvablyFairDrop(params) {
    return this.dropService.verifyDropOutcome(params);
  }

  handleDropRequest(authToken, params = {}) {
    const session = this._authenticate(authToken);
    return this.dropService.executeDrop({ ...params, userId: session.userId });
  }

  getBalance(authToken) {
    const session = this._authenticate(authToken);
    return this.wallet.getAccount(session.userId, { isGuest: session.role === 'GUEST' });
  }

  getUserAuditHistory(authToken, limit = 50) {
    const session = this._authenticate(authToken);
    return this.ledger.getUserHistory(session.userId, limit);
  }

  verifyLedgerIntegrity(authToken) {
    this._authenticate(authToken, 'ADMIN');
    return this.ledger.verifyIntegrity();
  }

  adminLogin(adminSecretKey) {
    return this.authService.authenticateAdmin(adminSecretKey);
  }

  adminAdjustBalance(adminToken, { targetUserId, currency, amount, reason }) {
    const admin = this._authenticate(adminToken, 'ADMIN');
    const amt = Number(amount);
    if (!targetUserId) throw new Error('targetUserId is required');
    if (!['GC', 'SC'].includes(currency)) throw new Error('currency must be GC or SC');
    if (!Number.isFinite(amt) || amt === 0) throw new Error('Adjustment amount cannot be zero');
    if (!reason || String(reason).length < 4) throw new Error('A clear reason is required.');
    const res = this.wallet.adminAdjustSync(targetUserId, currency, amt, {
      adminId: admin.userId,
      adminName: admin.name,
      reason: String(reason),
      timestamp: new Date().toISOString(),
    });
    return { success: true, targetUserId, currency, ...res };
  }

  adminGetFullLedger(adminToken, limit = 100) {
    this._authenticate(adminToken, 'ADMIN');
    return this.ledger.getTail(limit);
  }
}
