import crypto from 'node:crypto';

const INSECURE_PLACEHOLDER_SECRETS = new Set([
  'change-this-admin-secret',
  'changeme',
  'admin',
  'password',
  'secret',
]);

function asPlainString(val, maxLen = 512) {
  if (val === undefined || val === null) return '';
  if (typeof val !== 'string') throw new Error('Invalid input format.');
  return val.slice(0, maxLen);
}

/**
 * Player Authentication & Admin RBAC (store-backed).
 * - PBKDF2-HMAC-SHA512 password hashing (100,000 iterations, 256-bit salt)
 * - SHA-256 hashed 256-bit CSPRNG session tokens
 * - Atomic email uniqueness via claimed_tx primary key constraint
 * - Roles: PLAYER, GUEST, ADMIN
 */
export class AuthService {
  constructor(store, ledger, options = {}) {
    this.store = store;
    this.ledger = ledger;
    const rawAdminSecret = String(
      options.adminSecret || (typeof process !== 'undefined' && process.env?.DC_ADMIN_SECRET) || ''
    ).trim();
    this.adminSecret =
      rawAdminSecret && !INSECURE_PLACEHOLDER_SECRETS.has(rawAdminSecret.toLowerCase()) && rawAdminSecret.length >= 12
        ? rawAdminSecret
        : null;
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
    if (typeof password !== 'string' || !stored || typeof stored !== 'string' || !stored.includes(':')) {
      return false;
    }
    const [salt, originalHash] = stored.split(':');
    const computedHash = crypto.pbkdf2Sync(password.slice(0, 256), salt, 100000, 64, 'sha512').toString('hex');
    return this.timingSafeEqual(computedHash, originalHash);
  }

  static tokenKey(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  _pruneFailedAttempts() {
    if (this.failedAttempts.size <= 10000) return;
    const now = Date.now();
    for (const [k, rec] of this.failedAttempts.entries()) {
      if (!rec.lockedUntil || rec.lockedUntil < now) {
        this.failedAttempts.delete(k);
      }
    }
    if (this.failedAttempts.size > 10000) this.failedAttempts.clear();
  }

  _checkBruteForce(identifier) {
    const record = this.failedAttempts.get(identifier);
    if (record?.lockedUntil && Date.now() < record.lockedUntil) {
      const waitMins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
      throw new Error(`Account temporarily locked due to failed attempts. Try again in ${waitMins} minute(s).`);
    }
  }

  _recordFailedAttempt(identifier) {
    this._pruneFailedAttempts();
    const record = this.failedAttempts.get(identifier) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= 5) record.lockedUntil = Date.now() + 15 * 60 * 1000;
    this.failedAttempts.set(identifier, record);
  }

  _clearFailedAttempts(identifier) {
    this.failedAttempts.delete(identifier);
  }

  getUserByEmail(email) {
    if (typeof email !== 'string') return null;
    const clean = email.trim().toLowerCase();
    if (!clean) return null;
    return this.store.find('users', { k1: clean, limit: 1 })[0] || null;
  }

  getUserById(userId) {
    if (typeof userId !== 'string' || !userId) return null;
    return this.store.get('users', userId);
  }

  countRecentIpRegistrations(ip, windowMs = 24 * 60 * 60 * 1000) {
    if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return 0;
    const cutoff = Date.now() - windowMs;
    return this.store
      .find('users', { k2: 'PLAYER', limit: 300 })
      .filter((u) => u.registrationIp === ip && Date.parse(u.createdAt) >= cutoff).length;
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

  registerUser({ email, password, name, phone = null, ip = null }) {
    const cleanEmail = asPlainString(email, 180).trim().toLowerCase();
    const rawPassword = asPlainString(password, 256);
    const rawName = name === undefined || name === null ? '' : asPlainString(name, 80).trim();
    const rawPhone = phone === undefined || phone === null ? null : asPlainString(phone, 32).trim();

    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      throw new Error('Valid email required.');
    }
    if (rawPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    if (this.getUserByEmail(cleanEmail)) {
      throw new Error('An account with this email already exists.');
    }

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const user = {
      id: userId,
      email: cleanEmail,
      name: (rawName || cleanEmail.split('@')[0]).slice(0, 80),
      phone: rawPhone,
      passwordHash: AuthService.hashPassword(rawPassword),
      role: 'PLAYER',
      kycStatus: 'none',
      registrationIp: ip && typeof ip === 'string' ? ip : null,
      createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      try {
        this.store.insert('claimed_tx', `email:${cleanEmail}`, {
          kind: 'user_email',
          refId: userId,
          userId,
          at: user.createdAt,
        });
      } catch (err) {
        if (err.code === 'DUPLICATE') {
          throw new Error('An account with this email already exists.');
        }
        throw err;
      }
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
    const cleanEmail = asPlainString(email, 180).trim().toLowerCase();
    const rawPassword = asPlainString(password, 256);
    if (!cleanEmail) throw new Error('Invalid email or password.');
    this._checkBruteForce(cleanEmail);
    const user = this.getUserByEmail(cleanEmail);
    if (!user || !AuthService.verifyPassword(rawPassword, user.passwordHash)) {
      this._recordFailedAttempt(cleanEmail);
      throw new Error('Invalid email or password.');
    }
    if (user.disabled) throw new Error('This account has been disabled.');
    this._clearFailedAttempts(cleanEmail);
    return this.createSession(user);
  }

  authenticateAdmin(adminKey) {
    if (!this.adminSecret) {
      throw new Error('Admin access is disabled: configure a strong DC_ADMIN_SECRET (12+ chars) on the server.');
    }
    const lockId = '__admin_console__';
    this._checkBruteForce(lockId);
    const provided = typeof adminKey === 'string' ? adminKey : '';
    if (!provided || !AuthService.timingSafeEqual(provided, this.adminSecret)) {
      this._recordFailedAttempt(lockId);
      throw new Error(provided ? 'Unauthorized: Invalid operator key.' : 'Operator key required.');
    }
    this._clearFailedAttempts(lockId);
    const adminUser = {
      id: 'admin_master_01',
      name: 'Blinko Network Operator',
      role: 'ADMIN',
      email: 'operator@blinkonews.local',
    };
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
    if (!token || typeof token !== 'string') throw new Error('Unauthorized: Authorization token missing');
    const key = AuthService.tokenKey(token);
    const session = this.store.get('sessions', key);
    if (!session) throw new Error('Unauthorized: Session invalid or expired');
    if (Date.now() > session.expiresAt) {
      this.store.delete('sessions', key);
      throw new Error('Unauthorized: Session expired. Please sign in again.');
    }
    if (session.role === 'PLAYER') {
      const user = this.store.get('users', session.userId);
      if (user?.disabled) {
        this.store.delete('sessions', key);
        const err = new Error('This account has been disabled.');
        err.status = 403;
        throw err;
      }
    }
    if (requiredRole && session.role !== requiredRole && session.role !== 'ADMIN') {
      throw new Error('Unauthorized: Forbidden');
    }
    return { ...session, token };
  }

  revokeSession(token) {
    if (token && typeof token === 'string') {
      this.store.delete('sessions', AuthService.tokenKey(token));
    }
  }
}
