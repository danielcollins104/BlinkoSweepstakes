import { SWEEPSTAKES_CONFIG } from '../config/sweepstakesConfig.js';

/**
 * Server-Authoritative Atomic Dual-Currency Wallet (GC & Integer-Cent SC).
 * - SC stored in integer cents (scCents, unplayedCents, pendingCents, redeemedCents)
 *   to eliminate floating-point drift on redeemable prize balances.
 */
export class ServerWallet {
  static toCents(amount) {
    if (typeof amount !== 'number' && typeof amount !== 'string') {
      throw new Error('Invalid amount format');
    }
    const n = Number(amount);
    if (!Number.isFinite(n)) throw new Error('Invalid amount');
    return Math.round(n * 100);
  }

  static fromCents(cents) {
    return Number((Math.round(cents) / 100).toFixed(2));
  }

  constructor(store, ledger, options = {}) {
    this.store = store;
    this.ledger = ledger;
    this.welcomeGC = options.welcomeGC ?? SWEEPSTAKES_CONFIG.defaultGoldCoins ?? 100000;
    this.welcomeSC = options.welcomeSC ?? SWEEPSTAKES_CONFIG.defaultSweepsCoins ?? 10;

    Object.entries(options.initialAccounts || {}).forEach(([id, acc]) => {
      if (this.store.get('accounts', id)) return;
      const sc = ServerWallet.toCents(acc.sweepsCoins ?? this.welcomeSC);
      this.store.put('accounts', id, {
        userId: id,
        goldCoins: Math.round(acc.goldCoins ?? this.welcomeGC),
        scCents: sc,
        unplayedCents: ServerWallet.toCents(acc.unplayedSC ?? acc.sweepsCoins ?? this.welcomeSC),
        pendingCents: 0,
        redeemedCents: ServerWallet.toCents(acc.redeemedSC ?? 0),
        nonce: acc.nonce ?? 0,
        isGuest: Boolean(acc.isGuest),
        createdAt: new Date().toISOString(),
      });
    });
  }

  getAccount(userId, { isGuest = false, allowWelcomeSC = true } = {}) {
    return ServerWallet.view(this._load(userId, { isGuest, allowWelcomeSC }));
  }

  static view(acc) {
    return {
      userId: acc.userId,
      goldCoins: acc.goldCoins,
      sweepsCoins: ServerWallet.fromCents(acc.scCents),
      unplayedSC: ServerWallet.fromCents(Math.min(acc.unplayedCents, acc.scCents)),
      redeemableSC: ServerWallet.fromCents(Math.max(0, acc.scCents - acc.unplayedCents)),
      pendingRedemptionSC: ServerWallet.fromCents(acc.pendingCents),
      redeemedSC: ServerWallet.fromCents(acc.redeemedCents),
      nonce: acc.nonce,
      isGuest: Boolean(acc.isGuest),
    };
  }

  _load(userId, { isGuest = false, allowWelcomeSC = true } = {}) {
    if (!userId || typeof userId !== 'string') throw new Error('userId required');
    let acc = this.store.get('accounts', userId);
    if (!acc) {
      const welcomeSC = isGuest || !allowWelcomeSC ? 0 : ServerWallet.toCents(this.welcomeSC);
      acc = {
        userId,
        goldCoins: this.welcomeGC,
        scCents: welcomeSC,
        unplayedCents: welcomeSC,
        pendingCents: 0,
        redeemedCents: 0,
        nonce: 0,
        isGuest: Boolean(isGuest),
        createdAt: new Date().toISOString(),
      };
      this.store.transaction(() => {
        this.store.put('accounts', userId, acc);
        if (welcomeSC > 0) {
          this.ledger.append({
            userId,
            type: 'WELCOME_SC_GRANT',
            currency: 'SC',
            amount: ServerWallet.fromCents(welcomeSC),
            balanceBefore: 0,
            balanceAfter: ServerWallet.fromCents(welcomeSC),
            metadata: { amountCents: welcomeSC, note: 'Free welcome promotional SC (1x playthrough)' },
          });
        }
      });
    }
    return acc;
  }

  _save(acc) {
    if (acc.goldCoins < 0 || acc.scCents < 0 || acc.pendingCents < 0 || acc.unplayedCents < 0) {
      throw new Error('Wallet invariant violated: negative balance');
    }
    if (!Number.isSafeInteger(acc.goldCoins) || !Number.isSafeInteger(acc.scCents)) {
      throw new Error('Wallet invariant violated: non-integer balance');
    }
    this.store.put('accounts', acc.userId, acc);
  }

  /**
   * Atomic drop settlement: bet debit + win credit + ledger rows in ONE transaction.
   * For SC drops, betAmount decrements unplayedCents (1x rollover requirement), while wins are immediately redeemable.
   */
  settleDrop(userId, currency, betAmount, resolve) {
    if (!(betAmount > 0)) throw new Error('Bet amount must be positive');
    const isSC = currency === 'SC';
    return this.store.transaction(() => {
      const acc = this._load(userId);
      if (isSC && acc.isGuest) throw new Error('Sweeps Coins play requires a registered account.');
      const betUnits = isSC ? ServerWallet.toCents(betAmount) : Math.round(Number(betAmount));
      if (!Number.isSafeInteger(betUnits) || betUnits <= 0) {
        throw new Error('Invalid bet amount');
      }
      const before = isSC ? acc.scCents : acc.goldCoins;
      if (before < betUnits) {
        throw new Error(
          `Insufficient ${currency}: need ${isSC ? ServerWallet.fromCents(betUnits).toFixed(2) : betUnits}, have ${
            isSC ? ServerWallet.fromCents(before).toFixed(2) : before
          }`
        );
      }
      acc.nonce += 1;
      const nonce = acc.nonce;
      if (isSC) {
        acc.scCents -= betUnits;
        acc.unplayedCents = Math.max(0, acc.unplayedCents - betUnits);
      } else {
        acc.goldCoins -= betUnits;
      }
      const afterBet = isSC ? acc.scCents : acc.goldCoins;
      const betTx = this.ledger.append({
        userId,
        type: 'BET',
        currency,
        amount: isSC ? -ServerWallet.fromCents(betUnits) : -betUnits,
        balanceBefore: isSC ? ServerWallet.fromCents(before) : before,
        balanceAfter: isSC ? ServerWallet.fromCents(afterBet) : afterBet,
        metadata: { nonce, ...(isSC ? { amountCents: -betUnits } : {}) },
      });

      const { winAmount = 0, metadata = {} } = resolve(nonce, betTx.id) || {};
      const winUnits = isSC ? ServerWallet.toCents(winAmount) : Math.round(Number(winAmount));
      if (!Number.isSafeInteger(winUnits) || winUnits < 0) throw new Error('Win amount cannot be negative');
      let winTx = null;
      if (winUnits > 0) {
        if (isSC) acc.scCents += winUnits;
        else acc.goldCoins += winUnits;
        const afterWin = isSC ? acc.scCents : acc.goldCoins;
        winTx = this.ledger.append({
          userId,
          type: 'WIN',
          currency,
          amount: isSC ? ServerWallet.fromCents(winUnits) : winUnits,
          balanceBefore: isSC ? ServerWallet.fromCents(afterBet) : afterBet,
          balanceAfter: isSC ? ServerWallet.fromCents(afterWin) : afterWin,
          metadata: { ...metadata, dropId: betTx.id, ...(isSC ? { winCents: winUnits } : {}) },
        });
      }
      this._save(acc);
      return {
        nonce,
        dropId: betTx.id,
        winTransactionId: winTx?.id || null,
        balanceBefore: isSC ? ServerWallet.fromCents(before) : before,
        balanceAfter: isSC ? ServerWallet.fromCents(acc.scCents) : acc.goldCoins,
        winAmount: isSC ? ServerWallet.fromCents(winUnits) : winUnits,
        account: ServerWallet.view(acc),
      };
    });
  }

  processPurchaseCreditSync(userId, { goldCoinsToAdd, freeSweepsCoinsToAdd, packageId, paymentRef }) {
    if (!paymentRef) throw new Error('paymentRef is required for purchase credit');
    return this.store.transaction(() => {
      this.store.insert('claimed_tx', `credit:${paymentRef}`, {
        kind: 'purchase_credit',
        refId: paymentRef,
        userId,
        at: new Date().toISOString(),
      });
      const acc = this._load(userId);
      const gcAdd = Math.max(0, Math.round(Number(goldCoinsToAdd) || 0));
      const scAdd = Math.max(0, ServerWallet.toCents(freeSweepsCoinsToAdd || 0));
      const gcBefore = acc.goldCoins;
      const scBefore = acc.scCents;
      acc.goldCoins += gcAdd;
      acc.scCents += scAdd;
      acc.unplayedCents += scAdd;
      this._save(acc);
      const txGC = this.ledger.append({
        userId,
        type: 'PURCHASE_GC',
        currency: 'GC',
        amount: gcAdd,
        balanceBefore: gcBefore,
        balanceAfter: acc.goldCoins,
        metadata: { packageId, paymentRef },
      });
      const txSC = this.ledger.append({
        userId,
        type: 'PROMOTIONAL_SC_GRANT',
        currency: 'SC',
        amount: ServerWallet.fromCents(scAdd),
        balanceBefore: ServerWallet.fromCents(scBefore),
        balanceAfter: ServerWallet.fromCents(acc.scCents),
        metadata: { packageId, paymentRef, amountCents: scAdd, note: 'Free promotional SC with GC bundle' },
      });
      return {
        success: true,
        goldCoins: acc.goldCoins,
        sweepsCoins: ServerWallet.fromCents(acc.scCents),
        transactions: [txGC.id, txSC.id],
        account: ServerWallet.view(acc),
      };
    });
  }

  grantPromotion(userId, { goldCoins = 0, sweepsCoins = 0, reason = 'promotion', promoKey = null }) {
    return this.store.transaction(() => {
      if (promoKey) {
        this.store.insert('claimed_tx', `promo:${promoKey}`, {
          kind: 'promo',
          refId: promoKey,
          userId,
          at: new Date().toISOString(),
        });
      }
      const acc = this._load(userId);
      const gc = Math.max(0, Math.round(Number(goldCoins) || 0));
      const sc = acc.isGuest ? 0 : Math.max(0, ServerWallet.toCents(sweepsCoins));
      const scBefore = acc.scCents;
      const gcBefore = acc.goldCoins;
      acc.goldCoins += gc;
      acc.scCents += sc;
      acc.unplayedCents += sc;
      this._save(acc);
      if (gc > 0) {
        this.ledger.append({
          userId,
          type: 'PROMOTION_GRANT',
          currency: 'GC',
          amount: gc,
          balanceBefore: gcBefore,
          balanceAfter: acc.goldCoins,
          metadata: { reason, promoKey },
        });
      }
      if (sc > 0) {
        this.ledger.append({
          userId,
          type: 'PROMOTION_GRANT',
          currency: 'SC',
          amount: ServerWallet.fromCents(sc),
          balanceBefore: ServerWallet.fromCents(scBefore),
          balanceAfter: ServerWallet.fromCents(acc.scCents),
          metadata: { reason, scCents: sc, promoKey },
        });
      }
      return ServerWallet.view(acc);
    });
  }

  reserveRedemptionSync(userId, amountSC, payoutDetails = {}) {
    const method = payoutDetails?.method;
    const methodCfg = (SWEEPSTAKES_CONFIG.redemptionMethods || []).find((m) => m.id === method);
    const minSC = methodCfg?.minSC ?? SWEEPSTAKES_CONFIG.minRedemptionSC ?? 50;
    const reqCents = ServerWallet.toCents(amountSC);
    if (!(reqCents > 0)) throw new Error('Redemption amount must be positive.');
    if (reqCents < ServerWallet.toCents(minSC)) {
      throw new Error(`Minimum prize redemption for ${methodCfg?.shortLabel || method} is ${minSC.toFixed(2)} SC.`);
    }
    return this.store.transaction(() => {
      const acc = this._load(userId);
      if (acc.isGuest) throw new Error('Prize redemption requires a registered, KYC-verified account.');
      if (acc.scCents < reqCents) {
        throw new Error(`Insufficient Sweeps Coins: requested ${ServerWallet.fromCents(reqCents)} SC.`);
      }
      const eligible = Math.max(0, acc.scCents - acc.unplayedCents);
      if (eligible < reqCents) {
        throw new Error(
          `1x playthrough not yet met. Eligible redeemable: ${ServerWallet.fromCents(eligible).toFixed(2)} SC (${ServerWallet.fromCents(acc.unplayedCents).toFixed(2)} SC remaining to play through).`
        );
      }
      const before = acc.scCents;
      acc.scCents -= reqCents;
      acc.pendingCents += reqCents;
      this._save(acc);
      const tx = this.ledger.append({
        userId,
        type: 'REDEMPTION_REQUEST',
        currency: 'SC',
        amount: -ServerWallet.fromCents(reqCents),
        balanceBefore: ServerWallet.fromCents(before),
        balanceAfter: ServerWallet.fromCents(acc.scCents),
        metadata: {
          payoutMethod: method,
          destinationMasked: payoutDetails?.destinationMasked,
          amountCents: -reqCents,
          redemptionId: payoutDetails?.redemptionId,
        },
      });
      return {
        success: true,
        amountRedeemedSC: ServerWallet.fromCents(reqCents),
        amountCents: reqCents,
        remainingSC: ServerWallet.fromCents(acc.scCents),
        redemptionId: payoutDetails?.redemptionId || tx.id,
        transactionId: tx.id,
        account: ServerWallet.view(acc),
      };
    });
  }

  settleRedemptionSync(userId, amountCents, metadata = {}) {
    return this.store.transaction(() => {
      const acc = this._load(userId);
      if (acc.pendingCents < amountCents) throw new Error('Pending redemption balance mismatch');
      acc.pendingCents -= amountCents;
      acc.redeemedCents += amountCents;
      this._save(acc);
      this.ledger.append({
        userId,
        type: 'REDEMPTION_PAID',
        currency: 'SC',
        amount: 0,
        balanceBefore: ServerWallet.fromCents(acc.scCents),
        balanceAfter: ServerWallet.fromCents(acc.scCents),
        metadata: { ...metadata, amountCents },
      });
      return ServerWallet.view(acc);
    });
  }

  refundRedemptionSync(userId, amountCents, metadata = {}) {
    return this.store.transaction(() => {
      const acc = this._load(userId);
      if (acc.pendingCents < amountCents) throw new Error('Pending redemption balance mismatch');
      const before = acc.scCents;
      acc.pendingCents -= amountCents;
      acc.scCents += amountCents;
      this._save(acc);
      this.ledger.append({
        userId,
        type: 'REDEMPTION_REFUNDED',
        currency: 'SC',
        amount: ServerWallet.fromCents(amountCents),
        balanceBefore: ServerWallet.fromCents(before),
        balanceAfter: ServerWallet.fromCents(acc.scCents),
        metadata: { ...metadata, amountCents },
      });
      return ServerWallet.view(acc);
    });
  }

  adminAdjustSync(userId, currency, amount, metadata = {}) {
    const isSC = currency === 'SC';
    return this.store.transaction(() => {
      const acc = this._load(userId);
      const units = isSC ? ServerWallet.toCents(amount) : Math.round(Number(amount));
      if (!Number.isSafeInteger(units)) throw new Error('Invalid adjustment amount');
      const before = isSC ? acc.scCents : acc.goldCoins;
      const after = before + units;
      if (after < 0) {
        throw new Error('Adjustment would cause negative balance.');
      }
      if (isSC) {
        acc.scCents = after;
        if (units > 0) acc.unplayedCents += units;
        acc.unplayedCents = Math.min(acc.unplayedCents, acc.scCents);
      } else {
        acc.goldCoins = after;
      }
      this._save(acc);
      const tx = this.ledger.append({
        userId,
        type: 'ADMIN_ADJUSTMENT',
        currency,
        amount: isSC ? ServerWallet.fromCents(units) : units,
        balanceBefore: isSC ? ServerWallet.fromCents(before) : before,
        balanceAfter: isSC ? ServerWallet.fromCents(after) : after,
        metadata,
      });
      return {
        balanceBefore: isSC ? ServerWallet.fromCents(before) : before,
        balanceAfter: isSC ? ServerWallet.fromCents(after) : after,
        transactionId: tx.id,
        account: ServerWallet.view(acc),
      };
    });
  }
}
