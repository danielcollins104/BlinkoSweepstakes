import crypto from 'node:crypto';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export function resolveSecret(name, provided, { requireSecrets = false } = {}) {
  const fromEnv = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = String(provided || fromEnv || '').trim() || null;
  if (value) return value;
  if (requireSecrets) {
    throw new Error(`${name} is not configured.`);
  }
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Cryptographic Append-Only Audit Ledger (store-backed).
 * Every entry commits to the SHA-256 hash of the prior entry and carries an HMAC-SHA256 signature.
 */
export class AuditLedger {
  constructor(store, options = {}) {
    if (!store) throw new Error('AuditLedger requires a store');
    this.store = store;
    const secretMeta = store.get('meta', 'ledger_secret');
    const resolved =
      String(
        options.ledgerSecret ||
          (typeof process !== 'undefined' ? process.env?.DC_LEDGER_SECRET : '') ||
          secretMeta?.value ||
          ''
      ).trim() || null;
    if (resolved) {
      this.ledgerSecret = resolved;
    } else {
      this.ledgerSecret = resolveSecret('DC_LEDGER_SECRET', null, options);
      store.put('meta', 'ledger_secret', { value: this.ledgerSecret });
    }
    this._initGenesisBlock();
  }

  _initGenesisBlock() {
    if (this.store.ledgerCount() > 0) return;
    const genesis = {
      index: 0,
      id: 'blk_ledger_genesis_0000',
      userId: 'SYSTEM',
      type: 'GENESIS',
      currency: 'SYSTEM',
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      timestamp: new Date().toISOString(),
      prevHash: GENESIS_PREV_HASH,
      metadata: { system: 'BLINKO: Headline Chaos 2026 Sweepstakes Ledger' },
    };
    genesis.entryHash = this._computeHash(genesis);
    genesis.signature = this._signHash(genesis.entryHash);
    this.store.ledgerAppend(genesis);
  }

  _computeHash(entry) {
    const payload = `${entry.index}|${entry.prevHash}|${entry.id}|${entry.userId}|${entry.type}|${entry.currency}|${entry.amount}|${entry.balanceAfter}|${entry.timestamp}|${JSON.stringify(entry.metadata || {})}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  _signHash(hash) {
    return crypto.createHmac('sha256', this.ledgerSecret).update(hash).digest('hex');
  }

  append({ userId, type, currency, amount, balanceBefore, balanceAfter, metadata = {} }) {
    if (!userId) throw new Error('Ledger entry requires userId');
    if (!type) throw new Error('Ledger entry requires type');
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new Error('Ledger entry requires numeric amount');
    }
    const last = this.store.ledgerLast();
    const entry = {
      index: last ? last.index + 1 : 0,
      id: `tx_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      userId,
      type,
      currency,
      amount,
      balanceBefore,
      balanceAfter,
      timestamp: new Date().toISOString(),
      prevHash: last ? last.entryHash : GENESIS_PREV_HASH,
      metadata,
    };
    entry.entryHash = this._computeHash(entry);
    entry.signature = this._signHash(entry.entryHash);
    this.store.ledgerAppend(entry);
    return entry;
  }

  verifyIntegrity() {
    let prev = null;
    let from = 0;
    let count = 0;
    for (;;) {
      const page = this.store.ledgerPage(from, 500);
      if (page.length === 0) break;
      for (const cur of page) {
        count++;
        if (prev && cur.prevHash !== prev.entryHash) {
          return { valid: false, brokenIndex: cur.index, error: `Hash chain broken at block ${cur.index}` };
        }
        if (cur.entryHash !== this._computeHash(cur)) {
          return { valid: false, brokenIndex: cur.index, error: `Tampering detected at block ${cur.index}` };
        }
        if (cur.signature !== this._signHash(cur.entryHash)) {
          return { valid: false, brokenIndex: cur.index, error: `Invalid cryptographic signature at block ${cur.index}` };
        }
        prev = cur;
      }
      from = page[page.length - 1].index + 1;
    }
    return { valid: true, chainLength: count, lastBlockHash: prev?.entryHash || null, error: null };
  }

  getUserHistory(userId, limit = 50) {
    return this.store.ledgerForUser(userId, limit);
  }

  getTail(limit = 100) {
    return this.store.ledgerTail(limit);
  }

  get length() {
    return this.store.ledgerCount();
  }
}
