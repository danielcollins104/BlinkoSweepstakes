import crypto from 'node:crypto';

/**
 * Player Authentication & Admin RBAC (store-backed).
 * - PBKDF2-HMAC-SHA512 password hashing
 * - SHA-256 hashed 256-bit bearer tokens
 * - Roles: PLAYER, GUEST, ADMIN
 */
export class AuthService {
  constructor(store, ledger, options = {}) {
    this.store = store;
    this.ledger = ledger;
    this.adminSecret =
      options.adminSecret || (typeof process !== 'undefined' && process.env?.DC_ADMIN_SECRET) || null;
    this.failedAttempts = new Map();
    this._lastPurge = 0;
  }

  static timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
  }

  static hashPassword(password) {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  static verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, originalHash] = stored.split(':');
    const computedHash = crypto.pbkdf2Sync(String(password || ''), salt, 100000, 64, 'sha512').toString('hex');
    return this.timingSafeEqual(computedHash, originalHash);
  }

  static tokenKey(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  _checkBruteForce(identifier) {
    const record = this.failedAttempts.get(identifier);
    if (record?.lockedUntil && Date.now() < record.lockedUntil) {
      const waitMins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
      throw new Error(`Account temporarily locked due to failed attempts. Try again in ${waitMins} minute(s).`);
    }
  }

  _recordFailedAttempt(identifier) {
    const record = this.failedAttempts.get(identifier) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= 5) record.lockedUntil = Date.now() + 15 * 60 * 1000;
    this.failedAttempts.set(identifier, record);
  }

  _clearFailedAttempts(identifier) {
    this.failedAttempts.delete(identifier);
  }

  getUserByEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return null;
    return this.store.find('users', { k1: clean, limit: 1 })[0] || null;
  }

  getUserById(userId) {
    return this.store.get('users', userId);
  }

  updateUser(userId, patch) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found');
    const next = { ...user, ...patch, id: user.id, email: user.email, passwordHash: user.passwordHash };
    this.store.put('users', userId, next);
    return next;
  }

  static publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      kycStatus: user.kycStatus || 'none',
      createdAt: user.createdAt,
    };
  }

  registerUser({ email, password, name, phone = null }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('Valid email required.');
    if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters long.');
    if (this.getUserByEmail(cleanEmail)) throw new Error('An account with this email already exists.');

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const user = {
      id: userId,
      email: cleanEmail,
      name: String(name || cleanEmail.split('@')[0]).slice(0, 80),
      phone,
      passwordHash: AuthService.hashPassword(String(password)),
      role: 'PLAYER',
      kycStatus: 'none',
      createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      this.store.insert('users', userId, user);
      this.ledger.append({
        userId,
        type: 'ACCOUNT_CREATED',
        currency: 'SYSTEM',
        amount: 0,
        balanceBefore: 0,
        balanceAfter: 0,
        metadata: { role: user.role },
      });
    });
    return this.createSession(user);
  }

  loginUser(email, password) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    this._checkBruteForce(cleanEmail);
    const user = this.getUserByEmail(cleanEmail);
    if (!user || !AuthService.verifyPassword(password, user.passwordHash)) {
      this._recordFailedAttempt(cleanEmail);
      throw new Error('Invalid email or password.');
    }
    if (user.disabled) throw new Error('This account has been disabled.');
    this._clearFailedAttempts(cleanEmail);
    return this.createSession(user);
  }

  authenticateAdmin(adminKey) {
    if (!this.adminSecret) {
      throw new Error('Admin access is disabled: DC_ADMIN_SECRET is not configured on the server.');
    }
    const lockId = '__admin_console__';
    this._checkBruteForce(lockId);
    if (!adminKey || !AuthService.timingSafeEqual(String(adminKey), this.adminSecret)) {
      this._recordFailedAttempt(lockId);
      throw new Error(adminKey ? 'Unauthorized: Invalid operator key.' : 'Operator key required.');
    }
    this._clearFailedAttempts(lockId);
    const adminUser = { id: 'admin_master_01', name: 'Blinko Network Operator', role: 'ADMIN', email: 'operator@blinkonews.local' };
    this.ledger.append({
      userId: adminUser.id,
      type: 'ADMIN_LOGIN',
      currency: 'SYSTEM',
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      metadata: { timestamp: new Date().toISOString() },
    });
    return this.createSession(adminUser, 4 * 60 * 60 * 1000);
  }

  createGuestSession() {
    const guest = {
      id: `usr_guest_${crypto.randomBytes(8).toString('hex')}`,
      role: 'GUEST',
      name: 'Guest Viewer',
      email: null,
    };
    return this.createSession(guest, 7 * 24 * 60 * 60 * 1000);
  }

  createSession(user, ttlMs = 24 * 60 * 60 * 1000) {
    const token = `blk_sess_${crypto.randomBytes(32).toString('hex')}`;
    const session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      expiresAt: Date.now() + ttlMs,
    };
    this.store.put('sessions', AuthService.tokenKey(token), session);
    this._maybePurge();
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, kycStatus: user.kycStatus || 'none' },
      token,
      expiresAt: session.expiresAt,
    };
  }

  _maybePurge() {
    if (Date.now() - this._lastPurge < 60 * 60 * 1000) return;
    this._lastPurge = Date.now();
    try {
      this.store.purgeExpiredSessions(Date.now());
    } catch {}
  }

  validateSession(token, requiredRole = null) {
    if (!token) throw new Error('Unauthorized: Authorization token missing');
    const key = AuthService.tokenKey(token);
    const session = this.store.get('sessions', key);
    if (!session) throw new Error('Unauthorized: Session invalid or expired');
    if (Date.now() > session.expiresAt) {
      this.store.delete('sessions', key);
      throw new Error('Unauthorized: Session expired. Please sign in again.');
    }
    if (requiredRole && session.role !== requiredRole && session.role !== 'ADMIN') {
      throw new Error('Unauthorized: Forbidden');
    }
    return { ...session, token };
  }

  revokeSession(token) {
    if (token) this.store.delete('sessions', AuthService.tokenKey(token));
  }
}
