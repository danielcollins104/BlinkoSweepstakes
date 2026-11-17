// ============================================================================
// PAYMENTS SERVICE — live deposits (Crypto, Cash App, NMI Card, Stripe)
// & live prize payouts (Crypto On-Chain, Cash App, Gift Cards +5%, Stripe)
// ============================================================================
import crypto from 'node:crypto';
import { SWEEPSTAKES_CONFIG, getCashtagHandle, calculateCustomPackage } from '../config/sweepstakesConfig.js';
import { ServerWallet } from '../engine/ServerWallet.js';
import {
  CRYPTO_ASSETS,
  getAsset,
  getReceivingAddress,
  usdToDisplayUnits,
  displayUnitsToString,
  parseDisplayUnits,
  displayToChainUnits,
  chainToDisplayUnits,
  PriceOracle,
} from './cryptoAssets.js';
import { CryptoVerifier } from './cryptoVerifier.js';
import { NmiGateway } from './nmiGateway.js';
import { StripeGateway } from './stripeGateway.js';
import { assertGeo, ageOn, minAgeFor } from '../compliance/compliance.js';

const DEPOSIT_TTL_MS = 60 * 60 * 1000;
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomRef(prefix, len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
}

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function assertScalar(val, label) {
  if (val !== undefined && val !== null && typeof val === 'object') {
    throw httpError(`Invalid ${label} parameter.`);
  }
}

export function normalizeCashtag(tag) {
  if (typeof tag !== 'string') return null;
  const t = tag.trim();
  const clean = t.startsWith('$') ? t.slice(1) : t;
  if (!/^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(clean)) return null;
  return `$${clean}`;
}

function maskDestination(dest) {
  const s = String(dest || '');
  if (s.length <= 10) return s.replace(/.(?=.{3})/g, '•');
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function normalizeOrigin(raw) {
  const t = String(raw || '').trim().replace(/\/+$/, '');
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export class PaymentsService {
  constructor(deps) {
    this.store = deps.store;
    this.wallet = deps.wallet;
    this.ledger = deps.ledger;
    this.auth = deps.auth;
    this.compliance = deps.compliance;
    this.env = deps.env || {};
    this.prices = deps.priceOracle || new PriceOracle({ fetchImpl: deps.fetchImpl });
    this.verifier = deps.verifier || new CryptoVerifier({ env: this.env, fetchImpl: deps.fetchImpl });
    this.nmi = deps.nmi || new NmiGateway({ env: this.env, fetchImpl: deps.fetchImpl });
    this.stripe = deps.stripe || new StripeGateway({ env: this.env, fetchImpl: deps.fetchImpl });
    this.cashtag = normalizeCashtag(getCashtagHandle(this.env)) || '$Jimboxx1953';
  }

  resolvePackage(packageId, customAmountUsd = null) {
    assertScalar(packageId, 'packageId');
    assertScalar(customAmountUsd, 'customAmountUsd');
    const all = [
      ...(SWEEPSTAKES_CONFIG.storePackages || []),
      ...(SWEEPSTAKES_CONFIG.highRollerPackages || []),
    ];
    const found = all.find((p) => p.id === packageId);
    if (found) {
      return {
        id: found.id,
        tierTitle: found.tierTitle,
        priceUsd: found.priceUsd,
        goldCoins: found.goldCoins,
        freeSweepsCoins: found.freeSweepsCoins,
      };
    }
    const amt = Number(customAmountUsd);
    if (String(packageId || '').startsWith('pkg_custom') || amt > 0) {
      if (!Number.isFinite(amt) || amt < 1) throw httpError('Custom amount must be at least $1.00');
      const c = calculateCustomPackage(amt);
      return {
        id: c.id,
        tierTitle: c.tierTitle,
        priceUsd: c.priceUsd,
        goldCoins: c.goldCoins,
        freeSweepsCoins: c.freeSweepsCoins,
        badge: c.badge,
        tagline: c.tagline,
        isCustom: true,
      };
    }
    throw httpError('Unknown coin package.');
  }

  _todayTotalUsd(collection, userId, statuses, amountField = 'amountUsd') {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return this.store
      .find(collection, { k2: userId, limit: 500 })
      .filter((d) => statuses.includes(d.status) && Date.parse(d.createdAt) >= since)
      .reduce((s, d) => s + (Number(d[amountField]) || 0), 0);
  }

  _assertDepositLimits(userId, amountUsd) {
    const c = this.compliance;
    if (amountUsd > c.maxSingleDepositUsd) {
      throw httpError(`Maximum single purchase is $${c.maxSingleDepositUsd.toLocaleString()}.`);
    }
    const today =
      this._todayTotalUsd('deposits', userId, ['credited']) +
      this._todayTotalUsd('orders', userId, ['confirmed']) +
      this._todayTotalUsd('card_charges', userId, ['approved']) +
      this._todayTotalUsd('stripe_sessions', userId, ['credited']);
    if (today + amountUsd > c.maxDailyDepositUsd) {
      throw httpError(`Daily purchase limit of $${c.maxDailyDepositUsd.toLocaleString()} reached.`);
    }
  }

  _requirePlayer(session) {
    if (!session || session.role === 'GUEST') {
      throw httpError('Please sign in or register an account first.', 401);
    }
    return session;
  }

  publicConfig(geoCheck) {
    return {
      geo: geoCheck,
      cashApp: { enabled: Boolean(this.cashtag) },
      card: this.nmi.publicConfig(),
      stripe: this.stripe.publicConfig(),
      crypto: {
        enabled: true,
        assets: Object.values(CRYPTO_ASSETS).map((a) => ({
          id: a.id,
          label: a.label,
          unit: a.unit,
          network: a.network,
          minConfirmations: a.minConfirmations,
        })),
      },
      redemption: {
        methods: ['giftcard', 'crypto', 'cashapp', 'stripe_bank'],
        minSC: SWEEPSTAKES_CONFIG.minRedemptionSC || 50,
        minGiftCardSC: SWEEPSTAKES_CONFIG.minGiftCardRedemptionSC || 25,
        giftCardBonusRate: SWEEPSTAKES_CONFIG.giftCardBonusRate || 0.05,
        requireKyc: this.compliance.requireKycForRedemption,
      },
    };
  }

  createOnrampLink(session, { packageId, customAmountUsd }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    const pkg = this.resolvePackage(packageId, customAmountUsd);
    this._assertDepositLimits(session.userId, pkg.priceUsd);
    const asset = getAsset('USDT_SOL');
    const walletAddress = getReceivingAddress(asset, this.env);
    if (!walletAddress) throw httpError('USDT receiving wallet is not configured.');
    return {
      provider: 'moonpay',
      url: `https://www.moonpay.com/buy/usdt?walletAddress=${encodeURIComponent(walletAddress)}&baseCurrencyAmount=${encodeURIComponent(pkg.priceUsd)}`,
      amountUsd: pkg.priceUsd,
      packageId: pkg.id,
    };
  }

  // ---------------------------------------------------------------------------
  // CRYPTO DEPOSITS
  // ---------------------------------------------------------------------------
  async createCryptoDeposit(session, { packageId, customAmountUsd, asset: assetId }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    assertScalar(assetId, 'asset');
    const asset = getAsset(assetId || 'USDT_SOL');
    const address = getReceivingAddress(asset, this.env);
    if (!address || !CryptoVerifier.isValidAddress(asset, address)) {
      throw httpError(`${asset.label} receiving wallet is not configured.`);
    }
    const pkg = this.resolvePackage(packageId, customAmountUsd);
    this._assertDepositLimits(session.userId, pkg.priceUsd);

    const priceQuote = await this.prices.getUsdPrice(asset.priceKey);
    const base = usdToDisplayUnits(pkg.priceUsd, priceQuote.price, asset);
    const step = 10n ** BigInt(String(asset.maxTag).length);
    const rounded = ((base + step - 1n) / step) * step;

    return this.store.transaction(() => {
      const open = new Set(
        this.store
          .find('deposits', { k1: 'awaiting_payment', limit: 1000 })
          .filter((d) => d.asset === asset.id && Date.parse(d.expiresAt) > Date.now() - DEPOSIT_TTL_MS)
          .map((d) => d.expectedUnits)
      );
      let units = null;
      for (let i = 0; i < 50; i++) {
        const tag = BigInt(1 + crypto.randomInt(asset.maxTag));
        const candidate = (rounded + tag).toString();
        if (!open.has(candidate)) {
          units = candidate;
          break;
        }
      }
      if (!units) throw httpError('Deposit queue busy — try again shortly.', 503);

      const now = Date.now();
      const deposit = {
        id: newId('dep'),
        userId: session.userId,
        asset: asset.id,
        network: asset.network,
        address,
        expectedUnits: units,
        amountDisplay: displayUnitsToString(BigInt(units), asset.displayDecimals),
        unit: asset.unit,
        priceUsd: priceQuote.price,
        priceSources: priceQuote.sources,
        amountUsd: pkg.priceUsd,
        packageId: pkg.id,
        goldCoins: pkg.goldCoins,
        freeSweepsCoins: pkg.freeSweepsCoins,
        status: 'awaiting_payment',
        txHash: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DEPOSIT_TTL_MS).toISOString(),
      };
      this.store.insert('deposits', deposit.id, deposit);
      return this._publicDeposit(deposit);
    });
  }

  _publicDeposit(d) {
    const asset = getAsset(d.asset);
    return {
      id: d.id,
      asset: d.asset,
      network: d.network,
      address: d.address,
      amount: d.amountDisplay,
      unit: d.unit,
      amountUsd: d.amountUsd,
      priceUsd: d.priceUsd,
      priceSources: d.priceSources || [],
      packageId: d.packageId,
      goldCoins: d.goldCoins,
      freeSweepsCoins: d.freeSweepsCoins,
      status: d.status,
      txHash: d.txHash,
      confirmations: d.confirmations || 0,
      requiredConfirmations: asset.minConfirmations,
      walletUri: PaymentsService.walletUri(asset, d.address, d.amountDisplay),
      explorerUrl: d.txHash ? `${asset.explorerTx}${d.txHash}` : null,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
      message: d.message || null,
    };
  }

  /**
   * Standards-compliant BIP-21 / EIP-681 / Solana Pay QR URI builder.
   * Uses exact integer chain units for ETH (wei) and ERC-20 (base units) to avoid wallet scientific-notation bugs.
   */
  static walletUri(asset, address, amount) {
    if (asset.chain === 'bitcoin') {
      return `bitcoin:${address}?amount=${amount}`;
    }
    if (asset.id === 'ETH') {
      const displayUnits = parseDisplayUnits(amount, asset.displayDecimals);
      const wei = displayToChainUnits(displayUnits, asset);
      return `ethereum:${address}@1?value=${wei.toString()}`;
    }
    if (asset.id === 'USDT_ERC20') {
      const displayUnits = parseDisplayUnits(amount, asset.displayDecimals);
      const rawUnits = displayToChainUnits(displayUnits, asset);
      return `ethereum:${asset.tokenContract}@1/transfer?address=${address}&uint256=${rawUnits.toString()}`;
    }
    if (asset.id === 'USDT_SOL') {
      return `solana:${address}?amount=${amount}&spl-token=${asset.tokenMint}&label=Blinko`;
    }
    return `solana:${address}?amount=${amount}&label=Blinko`;
  }

  getDepositForUser(session, depositId) {
    assertScalar(depositId, 'depositId');
    const d = this.store.get('deposits', String(depositId || ''));
    if (!d || (d.userId !== session.userId && session.role !== 'ADMIN')) {
      throw httpError('Deposit not found', 404);
    }
    return d;
  }

  async submitCryptoTx(session, { depositId, txHash }) {
    this._requirePlayer(session);
    assertScalar(depositId, 'depositId');
    assertScalar(txHash, 'txHash');
    const d = this.getDepositForUser(session, depositId);
    if (d.status === 'credited') {
      return { deposit: this._publicDeposit(d), credited: false, alreadyCredited: true };
    }
    if (['rejected', 'needs_review', 'expired'].includes(d.status)) {
      return { deposit: this._publicDeposit(d), credited: false };
    }
    const hash = String(txHash || d.txHash || '').trim();
    if (!hash) throw httpError('Paste the blockchain transaction hash from your wallet.');
    if (d.txHash && d.txHash !== hash) {
      throw httpError('A different transaction was already submitted for this deposit.');
    }

    if (d.lastCheckAt && Date.now() - Date.parse(d.lastCheckAt) < 8000) {
      return { deposit: this._publicDeposit(d), credited: false, throttled: true };
    }
    const asset = getAsset(d.asset);
    const claimKey = `tx:${asset.chain}:${hash.toLowerCase()}`;
    const existingClaim = this.store.get('claimed_tx', claimKey);
    if (existingClaim && existingClaim.refId !== d.id) {
      throw httpError('This transaction hash was already claimed on another deposit.');
    }

    const result = await this.verifier.verifyTransfer({ asset, txHash: hash, recipient: d.address });

    return this.store.transaction(() => {
      const cur = this.store.get('deposits', d.id);
      if (cur.status === 'credited') {
        return { deposit: this._publicDeposit(cur), credited: false, alreadyCredited: true };
      }
      const expiresMs = Date.parse(cur.expiresAt);
      const isQuoteExpired = Number.isFinite(expiresMs) && Date.now() > expiresMs;

      if (!result.found) {
        if (isQuoteExpired && !cur.txHash && !result.retryable) {
          cur.status = 'expired';
          cur.message = 'This 60-minute crypto quote expired before payment was detected. Generate a fresh quote.';
          this.store.put('deposits', cur.id, cur);
          return { deposit: this._publicDeposit(cur), credited: false };
        }
        cur.txHash = hash;
        cur.lastCheckAt = new Date().toISOString();
        cur.message = result.error || 'Transaction not found on-chain yet — wait a moment and re-check.';
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }

      cur.txHash = hash;
      cur.lastCheckAt = new Date().toISOString();

      if (result.success === false) {
        cur.status = 'rejected';
        cur.message = result.error || 'Transaction failed on-chain.';
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }

      const createdMs = Date.parse(cur.createdAt);
      if (result.blockTime && result.blockTime * 1000 < createdMs - 10 * 60 * 1000) {
        cur.status = 'needs_review';
        cur.message = 'Transaction pre-dates this deposit quote. Flagged for operator review.';
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }

      // Prevent spot-price lock option exploit on volatile assets if paid well after 60-minute window
      if (
        isQuoteExpired &&
        asset.priceKey !== 'USD' &&
        (!result.blockTime || result.blockTime * 1000 > expiresMs + 15 * 60 * 1000)
      ) {
        cur.status = 'needs_review';
        cur.message = 'Transfer arrived after the 60-minute spot-price lock expired. Flagged for operator review.';
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }

      const receivedDisplay = chainToDisplayUnits(result.amountRaw, asset);
      cur.receivedUnits = receivedDisplay.toString();
      cur.confirmations = result.confirmations;
      if ((receivedDisplay === 0n && result.pending) || result.pending) {
        if (receivedDisplay === 0n) {
          cur.status = 'awaiting_payment';
          cur.message = 'Transaction seen in mempool — waiting for block confirmation.';
          this.store.put('deposits', cur.id, cur);
          return { deposit: this._publicDeposit(cur), credited: false };
        }
      }

      const expected = BigInt(cur.expectedUnits);
      const minAcceptable = (expected * 998n) / 1000n;
      const maxAcceptable = (expected * 1050n) / 1000n;

      if (receivedDisplay < minAcceptable || receivedDisplay > maxAcceptable) {
        cur.status = 'needs_review';
        cur.message = `Received ${displayUnitsToString(receivedDisplay, asset.displayDecimals)} ${asset.unit}, expected ${cur.amountDisplay} ${asset.unit}. Flagged for operator review.`;
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }
      if (result.confirmations < asset.minConfirmations) {
        cur.status = 'confirming';
        cur.message = `Detected on-chain: ${result.confirmations}/${asset.minConfirmations} confirmations.`;
        this.store.put('deposits', cur.id, cur);
        return { deposit: this._publicDeposit(cur), credited: false };
      }

      const creditRes = this._creditDeposit(cur, claimKey, 'crypto');
      return { deposit: this._publicDeposit(cur), credited: true, balance: creditRes.account };
    });
  }

  _creditDeposit(dep, claimKey, kind, operator = null) {
    try {
      this.store.insert('claimed_tx', claimKey, {
        kind: 'crypto_deposit',
        refId: dep.id,
        userId: dep.userId,
        at: new Date().toISOString(),
      });
    } catch (err) {
      if (err.code === 'DUPLICATE') throw httpError('Transaction already credited.');
      throw err;
    }
    const creditRes = this.wallet.processPurchaseCreditSync(dep.userId, {
      goldCoinsToAdd: dep.goldCoins,
      freeSweepsCoinsToAdd: dep.freeSweepsCoins,
      packageId: dep.packageId,
      paymentRef: `${kind}:${dep.id}`,
    });
    dep.status = 'credited';
    dep.creditedAt = new Date().toISOString();
    dep.message = null;
    if (operator) dep.reviewedBy = operator;
    this.store.put('deposits', dep.id, dep);
    return creditRes;
  }

  adminResolveCryptoDeposit(adminSession, { depositId, action, note = '' }) {
    assertScalar(depositId, 'depositId');
    assertScalar(action, 'action');
    return this.store.transaction(() => {
      const d = this.store.get('deposits', depositId);
      if (!d) throw httpError('Deposit not found', 404);
      if (d.status === 'credited') return { deposit: d, alreadyCredited: true };
      if (action === 'credit') {
        if (!d.txHash) throw httpError('No transaction hash attached.');
        const asset = getAsset(d.asset);
        d.operatorNote = String(note || '').slice(0, 300);
        const creditRes = this._creditDeposit(
          d,
          `tx:${asset.chain}:${d.txHash.toLowerCase()}`,
          'crypto',
          adminSession.userId
        );
        return { deposit: d, balance: creditRes.account };
      }
      if (action === 'reject') {
        d.status = 'rejected';
        d.operatorNote = String(note || '').slice(0, 300);
        d.reviewedBy = adminSession.userId;
        this.store.put('deposits', d.id, d);
        return { deposit: d };
      }
      throw httpError('action must be credit or reject');
    });
  }

  // ---------------------------------------------------------------------------
  // CASH APP DEPOSITS
  // ---------------------------------------------------------------------------
  createCashAppOrder(session, { packageId, customAmountUsd, senderTag }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    assertScalar(senderTag, 'senderTag');
    const pkg = this.resolvePackage(packageId, customAmountUsd);
    this._assertDepositLimits(session.userId, pkg.priceUsd);
    const sender = senderTag ? normalizeCashtag(String(senderTag)) : null;
    if (senderTag && !sender) throw httpError('Enter a valid $Cashtag (letters, numbers, - or _).');
    const orderRef = randomRef('BLK');
    const amount = Number(pkg.priceUsd);
    const order = {
      id: newId('ord'),
      processorId: 'cashapp',
      userId: session.userId,
      userEmail: session.email || null,
      orderRef,
      packageId: pkg.id,
      amountUsd: amount,
      goldCoins: pkg.goldCoins,
      freeSweepsCoins: pkg.freeSweepsCoins,
      senderTag: sender,
      customerReceiptRef: null,
      payTo: this.cashtag,
      paymentLink: `https://cash.app/${this.cashtag}`,
      status: 'awaiting_payment',
      createdAt: new Date().toISOString(),
    };
    this.store.insert('orders', order.id, order);
    return order;
  }

  markCashAppOrderSent(session, { orderId, senderTag, receiptRef }) {
    this._requirePlayer(session);
    assertScalar(orderId, 'orderId');
    assertScalar(senderTag, 'senderTag');
    assertScalar(receiptRef, 'receiptRef');
    const o = this.store.get('orders', String(orderId || ''));
    if (!o || o.userId !== session.userId) throw httpError('Order not found', 404);
    if (!['awaiting_payment', 'awaiting_confirmation'].includes(o.status)) return o;
    const rawSender = senderTag !== undefined && senderTag !== '' ? String(senderTag) : o.senderTag;
    const sender = rawSender ? normalizeCashtag(rawSender) : null;
    if (!sender) throw httpError('Enter the $Cashtag you paid from so we can match your payment.');
    o.senderTag = sender;
    if (typeof receiptRef === 'string' && receiptRef.trim()) {
      o.customerReceiptRef = receiptRef.trim().slice(0, 160);
    }
    o.status = 'awaiting_confirmation';
    o.sentAt = o.sentAt || new Date().toISOString();
    this.store.put('orders', o.id, o);
    return o;
  }

  getOrderForUser(session, orderId) {
    this._requirePlayer(session);
    assertScalar(orderId, 'orderId');
    const o = this.store.get('orders', String(orderId || ''));
    if (!o || (o.userId !== session.userId && session.role !== 'ADMIN')) {
      throw httpError('Order not found', 404);
    }
    return {
      order: PaymentsService._publicOrder(o),
      balance: o.status === 'confirmed' ? this.wallet.getAccount(o.userId) : undefined,
    };
  }

  static _publicOrder(o) {
    return {
      id: o.id,
      processorId: o.processorId,
      orderRef: o.orderRef,
      packageId: o.packageId,
      amountUsd: o.amountUsd,
      goldCoins: o.goldCoins,
      freeSweepsCoins: o.freeSweepsCoins,
      senderTag: o.senderTag,
      customerReceiptRef: o.customerReceiptRef || null,
      payTo: o.payTo,
      paymentLink: o.paymentLink,
      status: o.status,
      createdAt: o.createdAt,
      sentAt: o.sentAt || null,
      confirmedAt: o.confirmedAt || null,
    };
  }

  publicOrder(o) {
    return PaymentsService._publicOrder(o);
  }

  listOrdersForUser(session, limit = 50) {
    return this.store.find('orders', { k2: session.userId, limit }).map(PaymentsService._publicOrder);
  }

  adminConfirmCashAppOrder(adminSession, { orderId, cashAppPaymentId, note = '' }) {
    assertScalar(orderId, 'orderId');
    assertScalar(cashAppPaymentId, 'cashAppPaymentId');
    const receipt = String(cashAppPaymentId || '').trim();
    if (receipt.length < 4) throw httpError('Enter the Cash App receipt/payment ID (4+ chars).');
    return this.store.transaction(() => {
      const o = this.store.get('orders', orderId);
      if (!o) throw httpError(`Order not found: ${orderId}`, 404);
      if (o.status === 'confirmed') return { order: o, alreadyConfirmed: true };
      if (o.status === 'rejected') throw httpError('Order was already rejected.');
      try {
        this.store.insert('claimed_tx', `cashapp_in:${receipt.toLowerCase()}`, {
          kind: 'cashapp_deposit',
          refId: o.id,
          userId: o.userId,
          at: new Date().toISOString(),
        });
      } catch (err) {
        if (err.code === 'DUPLICATE') throw httpError('That Cash App receipt ID was already used.');
        throw err;
      }
      const credit = this.wallet.processPurchaseCreditSync(o.userId, {
        goldCoinsToAdd: o.goldCoins,
        freeSweepsCoinsToAdd: o.freeSweepsCoins,
        packageId: o.packageId,
        paymentRef: `cashapp:${o.id}`,
      });
      Object.assign(o, {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmedBy: adminSession.userId,
        cashAppPaymentId: receipt,
        operatorNote: String(note || '').slice(0, 300),
        credit: { goldCoins: credit.goldCoins, sweepsCoins: credit.sweepsCoins },
      });
      this.store.put('orders', o.id, o);
      return { order: o, alreadyConfirmed: false, balance: credit.account };
    });
  }

  adminRejectOrder(adminSession, { orderId, note = '' }) {
    assertScalar(orderId, 'orderId');
    const o = this.store.get('orders', orderId);
    if (!o) throw httpError('Order not found', 404);
    if (o.status === 'confirmed') throw httpError('Order already confirmed.');
    Object.assign(o, {
      status: 'rejected',
      operatorNote: String(note || '').slice(0, 300),
      rejectedBy: adminSession.userId,
      rejectedAt: new Date().toISOString(),
    });
    this.store.put('orders', o.id, o);
    return o;
  }

  // ---------------------------------------------------------------------------
  // CARD DEPOSITS — NMI Collect.js
  // ---------------------------------------------------------------------------
  async chargeCard(session, { packageId, customAmountUsd, paymentToken, idempotencyKey, billing = {} }, geo, ip) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    if (!this.nmi.enabled) {
      throw httpError('NMI card gateway is not configured yet. Use Stripe, Crypto, or Cash App.', 503);
    }
    assertScalar(idempotencyKey, 'idempotencyKey');
    assertScalar(paymentToken, 'paymentToken');
    const key = String(idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw httpError('Missing valid idempotency key.');
    const pkg = this.resolvePackage(packageId, customAmountUsd);
    this._assertDepositLimits(session.userId, pkg.priceUsd);

    const chargeId = `chg_${crypto.createHash('sha256').update(`${session.userId}:${key}`).digest('hex').slice(0, 24)}`;
    const existing = this.store.get('card_charges', chargeId);
    if (existing) return { charge: PaymentsService._publicCharge(existing), duplicate: true };

    const charge = {
      id: chargeId,
      userId: session.userId,
      packageId: pkg.id,
      amountUsd: pkg.priceUsd,
      goldCoins: pkg.goldCoins,
      freeSweepsCoins: pkg.freeSweepsCoins,
      status: 'processing',
      createdAt: new Date().toISOString(),
    };
    this.store.insert('card_charges', chargeId, charge);

    const res = await this.nmi.sale({
      amountUsd: pkg.priceUsd,
      paymentToken,
      orderId: chargeId,
      billing: billing && typeof billing === 'object' ? billing : {},
      ipAddress: ip,
      email: session.email,
    });
    return this._applyCardResult(chargeId, res);
  }

  _applyCardResult(chargeId, res) {
    return this.store.transaction(() => {
      const c = this.store.get('card_charges', chargeId);
      if (c.status === 'approved') return { charge: PaymentsService._publicCharge(c) };
      c.gatewayTransactionId = res.transactionId || c.gatewayTransactionId || null;
      c.responseText = res.responseText || null;
      if (res.status === 'approved') {
        this.wallet.processPurchaseCreditSync(c.userId, {
          goldCoinsToAdd: c.goldCoins,
          freeSweepsCoinsToAdd: c.freeSweepsCoins,
          packageId: c.packageId,
          paymentRef: `card:${c.id}`,
        });
        c.status = 'approved';
        c.approvedAt = new Date().toISOString();
      } else if (['declined', 'error', 'not_found'].includes(res.status)) {
        c.status = 'declined';
      } else {
        c.status = 'unknown';
      }
      this.store.put('card_charges', c.id, c);
      return {
        charge: PaymentsService._publicCharge(c),
        balance: c.status === 'approved' ? this.wallet.getAccount(c.userId) : undefined,
      };
    });
  }

  static _publicCharge(c) {
    return {
      id: c.id,
      status: c.status,
      amountUsd: c.amountUsd,
      packageId: c.packageId,
      goldCoins: c.goldCoins,
      freeSweepsCoins: c.freeSweepsCoins,
      message:
        c.status === 'approved'
          ? 'Card approved.'
          : c.status === 'declined'
          ? `Card declined${c.responseText ? `: ${c.responseText}` : ''}.`
          : c.status === 'unknown'
          ? 'Pending gateway reconciliation.'
          : 'Processing…',
    };
  }

  async adminReconcileCard(adminSession, { chargeId }) {
    assertScalar(chargeId, 'chargeId');
    const c = this.store.get('card_charges', chargeId);
    if (!c) throw httpError('Charge not found', 404);
    if (!['unknown', 'processing'].includes(c.status)) return { charge: c };
    const q = await this.nmi.queryByOrderId(chargeId);
    return this._applyCardResult(chargeId, q);
  }

  // ---------------------------------------------------------------------------
  // CARD DEPOSITS — STRIPE CHECKOUT & WEBHOOKS
  // ---------------------------------------------------------------------------
  async createStripeCheckout(session, { packageId, customAmountUsd, isSecure = false }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    if (!this.stripe.enabled) {
      throw httpError('Stripe checkout is not configured yet.', 503);
    }
    const pkg = this.resolvePackage(packageId, customAmountUsd);
    this._assertDepositLimits(session.userId, pkg.priceUsd);
    const sessionRef = newId('str');
    const configuredOrigin =
      normalizeOrigin(this.env.PUBLIC_ORIGIN) ||
      normalizeOrigin(String(this.env.ALLOWED_ORIGINS || '').split(',')[0]);
    const baseOrigin =
      configuredOrigin ||
      (isSecure ? 'https://blinkosweepstakes.oopsiwon.com' : `http://localhost:${this.env.PORT || 3002}`);
    const stripeRes = await this.stripe.createCheckoutSession({
      sessionRef,
      packageTitle: pkg.tierTitle,
      amountUsd: pkg.priceUsd,
      goldCoins: pkg.goldCoins,
      freeSweepsCoins: pkg.freeSweepsCoins,
      customerEmail: session.email,
      successUrl: `${baseOrigin}/?stripe_session_id={CHECKOUT_SESSION_ID}&stripe_ref=${sessionRef}`,
      cancelUrl: `${baseOrigin}/?stripe_cancel=true`,
      userId: session.userId,
      packageId: pkg.id,
    });
    const rec = {
      id: sessionRef,
      stripeSessionId: stripeRes.id,
      userId: session.userId,
      packageId: pkg.id,
      amountUsd: pkg.priceUsd,
      goldCoins: pkg.goldCoins,
      freeSweepsCoins: pkg.freeSweepsCoins,
      checkoutUrl: stripeRes.url,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.store.insert('stripe_sessions', sessionRef, rec);
    return {
      sessionRef,
      stripeSessionId: stripeRes.id,
      checkoutUrl: stripeRes.url,
      amountUsd: pkg.priceUsd,
      goldCoins: pkg.goldCoins,
      freeSweepsCoins: pkg.freeSweepsCoins,
    };
  }

  _creditStripeSession(rec) {
    return this.store.transaction(() => {
      const cur = this.store.get('stripe_sessions', rec.id);
      if (!cur) throw httpError('Stripe session record not found', 404);
      if (cur.status === 'credited') {
        return { session: cur, alreadyCredited: true, balance: this.wallet.getAccount(cur.userId) };
      }
      this.store.insert('claimed_tx', `stripe:${cur.stripeSessionId}`, {
        kind: 'stripe_checkout',
        refId: cur.id,
        userId: cur.userId,
        at: new Date().toISOString(),
      });
      const credit = this.wallet.processPurchaseCreditSync(cur.userId, {
        goldCoinsToAdd: cur.goldCoins,
        freeSweepsCoinsToAdd: cur.freeSweepsCoins,
        packageId: cur.packageId,
        paymentRef: `stripe:${cur.id}`,
      });
      cur.status = 'credited';
      cur.creditedAt = new Date().toISOString();
      this.store.put('stripe_sessions', cur.id, cur);
      return { session: cur, alreadyCredited: false, balance: credit.account };
    });
  }

  async confirmStripeSession(session, { sessionRef, stripeSessionId }) {
    this._requirePlayer(session);
    assertScalar(sessionRef, 'sessionRef');
    assertScalar(stripeSessionId, 'stripeSessionId');
    const rec = sessionRef
      ? this.store.get('stripe_sessions', sessionRef)
      : this.store.find('stripe_sessions', { k2: session.userId, limit: 50 }).find((s) => s.stripeSessionId === stripeSessionId);
    if (!rec || rec.userId !== session.userId) throw httpError('Stripe session not found', 404);
    if (rec.status === 'credited') {
      return { credited: true, alreadyCredited: true, session: rec, balance: this.wallet.getAccount(rec.userId) };
    }
    const remote = await this.stripe.retrieveCheckoutSession(rec.stripeSessionId);
    if (remote.payment_status !== 'paid') {
      return { credited: false, status: remote.payment_status || 'unpaid', session: rec };
    }
    const res = this._creditStripeSession(rec);
    return { credited: true, ...res };
  }

  handleStripeWebhook(rawBody, signatureHeader) {
    const event = this.stripe.verifyWebhookSignature(rawBody, signatureHeader);
    const eventKey = event.id ? `stripe_evt:${event.id}` : null;
    if (eventKey && this.store.get('claimed_tx', eventKey)) {
      return { handled: true, duplicate: true, eventType: event.type };
    }

    const markEventProcessed = () => {
      if (eventKey) {
        this.store.insert('claimed_tx', eventKey, {
          kind: 'stripe_event',
          refId: event.id,
          userId: event.data?.object?.metadata?.userId || 'SYSTEM',
          at: new Date().toISOString(),
        });
      }
    };

    return this.store.transaction(() => {
      const obj = event.data?.object || {};
      const ref = obj.client_reference_id || obj.metadata?.sessionRef;

      if (
        (event.type === 'checkout.session.completed' && obj.payment_status === 'paid') ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        if (ref) {
          const rec = this.store.get('stripe_sessions', ref);
          if (rec) {
            const res = this._creditStripeSession(rec);
            markEventProcessed();
            return { handled: true, eventType: event.type, ...res };
          }
        }
        markEventProcessed();
        return { handled: true, eventType: event.type };
      }

      if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
        if (ref) {
          const rec = this.store.get('stripe_sessions', ref);
          if (rec && rec.status === 'pending') {
            rec.status = event.type.endsWith('expired') ? 'expired' : 'failed';
            rec.updatedAt = new Date().toISOString();
            this.store.put('stripe_sessions', rec.id, rec);
          }
        }
        markEventProcessed();
        return { handled: true, eventType: event.type };
      }

      if (event.type === 'payout.paid' || event.type === 'transfer.created') {
        const rdmId = obj.metadata?.redemptionId;
        if (rdmId) {
          const r = this.store.get('redemptions', rdmId);
          if (r && ['pending_review', 'approved'].includes(r.status)) {
            const claimKey = `payout_stripe:${String(obj.id).toLowerCase()}`;
            if (!this.store.get('claimed_tx', claimKey)) {
              this.store.insert('claimed_tx', claimKey, {
                kind: 'payout',
                refId: r.id,
                userId: r.userId,
                at: new Date().toISOString(),
              });
            }
            const balance = this.wallet.settleRedemptionSync(r.userId, r.amountCents, {
              redemptionId: r.id,
              method: r.method,
              receipt: obj.id,
              paidBy: 'stripe_webhook',
            });
            Object.assign(r, {
              status: 'paid',
              txHashOrReceipt: obj.id,
              paidAt: new Date().toISOString(),
              paidBy: 'stripe_webhook',
            });
            this.store.put('redemptions', r.id, r);
            markEventProcessed();
            return { handled: true, eventType: event.type, redemption: r, balance };
          }
        }
        markEventProcessed();
        return { handled: true, eventType: event.type };
      }

      if (event.type === 'payout.failed' || event.type === 'payout.canceled') {
        const rdmId = obj.metadata?.redemptionId;
        if (rdmId) {
          const r = this.store.get('redemptions', rdmId);
          if (r && ['pending_review', 'approved'].includes(r.status)) {
            const reason = obj.failure_message || 'Stripe payout failed or canceled';
            const balance = this.wallet.refundRedemptionSync(r.userId, r.amountCents, {
              redemptionId: r.id,
              reason,
              rejectedBy: 'stripe_webhook',
            });
            Object.assign(r, {
              status: 'rejected',
              rejectionReason: reason,
              rejectedAt: new Date().toISOString(),
              rejectedBy: 'stripe_webhook',
            });
            this.store.put('redemptions', r.id, r);
            markEventProcessed();
            return { handled: true, eventType: event.type, redemption: r, balance };
          }
        }
        markEventProcessed();
        return { handled: true, eventType: event.type };
      }

      if (event.type === 'charge.dispute.created' || event.type === 'charge.refunded') {
        this.ledger.append({
          userId: obj.metadata?.userId || 'SYSTEM',
          type: event.type === 'charge.dispute.created' ? 'STRIPE_DISPUTE_CREATED' : 'STRIPE_CHARGE_REFUNDED',
          currency: 'SYSTEM',
          amount: Number(obj.amount || 0) / 100,
          balanceBefore: 0,
          balanceAfter: 0,
          metadata: { stripeObjectId: obj.id || null, reason: obj.reason || null },
        });
        markEventProcessed();
        return { handled: true, eventType: event.type };
      }

      markEventProcessed();
      return { handled: true, eventType: event.type };
    });
  }

  // ---------------------------------------------------------------------------
  // KYC IDENTITY VERIFICATION
  // ---------------------------------------------------------------------------
  submitKyc(session, { legalName, dob, address = {}, phone }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    assertScalar(legalName, 'legalName');
    assertScalar(dob, 'dob');
    assertScalar(phone, 'phone');
    if (!address || typeof address !== 'object' || Array.isArray(address)) {
      throw httpError('Enter your full US residential address.');
    }
    const user = this.auth.getUserById(session.userId);
    if (!user) throw httpError('User not found', 404);
    if (user.kycStatus === 'verified') return { status: 'verified' };
    const name = String(legalName || '').trim().slice(0, 120);
    if (name.length < 3 || !name.includes(' ')) throw httpError('Enter your full legal first and last name.');
    const state = String(address.state || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) throw httpError('Enter your 2-letter US state code.');
    if (this.compliance.restrictedStates.includes(state)) {
      throw httpError(`Prize redemptions are not available in ${state}.`, 451);
    }
    if (
      !String(address.line1 || '').trim() ||
      !String(address.city || '').trim() ||
      !/^\d{5}(-\d{4})?$/.test(String(address.zip || '').trim())
    ) {
      throw httpError('Enter your full US residential address (street, city, ZIP).');
    }
    const age = ageOn(dob);
    if (!Number.isFinite(age)) throw httpError('Enter your date of birth as YYYY-MM-DD.');
    const minAge = minAgeFor(this.compliance, state);
    if (age < minAge) throw httpError(`You must be at least ${minAge} years old to redeem prizes.`, 403);

    const identityKey = crypto
      .createHash('sha256')
      .update(`${name.toLowerCase().replace(/\s+/g, ' ')}|${dob}`)
      .digest('hex');
    const dupes = this.store.find('kyc', { k2: identityKey, limit: 10 }).filter((k) => k.userId !== session.userId);
    if (dupes.some((d) => d.status === 'verified')) {
      throw httpError(
        'An account with this verified identity already exists. Sweepstakes rules permit one account per player.',
        409,
        'DUPLICATE_IDENTITY'
      );
    }
    const rec = {
      userId: session.userId,
      email: user.email,
      legalName: name,
      dob: String(dob),
      address: {
        line1: String(address.line1).trim().slice(0, 160),
        line2: String(address.line2 || '').trim().slice(0, 160),
        city: String(address.city).trim().slice(0, 80),
        state,
        zip: String(address.zip).trim(),
      },
      phone: phone ? String(phone).trim().slice(0, 32) : null,
      identityKey,
      duplicateOf: dupes.map((d) => d.userId),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      this.store.put('kyc', session.userId, rec);
      this.auth.updateUser(session.userId, { kycStatus: 'pending' });
    });
    return { status: 'pending', duplicateFlag: rec.duplicateOf.length > 0 };
  }

  getKycStatus(session) {
    const user = this.auth.getUserById(session.userId);
    const rec = this.store.get('kyc', session.userId);
    return { status: user?.kycStatus || 'none', note: rec?.decisionNote || null };
  }

  adminDecideKyc(adminSession, { userId, decision, note = '' }) {
    assertScalar(userId, 'userId');
    assertScalar(decision, 'decision');
    if (!['verified', 'rejected'].includes(decision)) throw httpError('decision must be verified or rejected');
    const rec = this.store.get('kyc', userId);
    if (!rec) throw httpError('No KYC submission for this user', 404);
    if (decision === 'verified' && rec.identityKey) {
      const existingVerified = this.store
        .find('kyc', { k2: rec.identityKey, limit: 10 })
        .some((k) => k.userId !== userId && k.status === 'verified');
      if (existingVerified) {
        throw httpError('Another account with this identity is already KYC verified.', 409);
      }
    }
    rec.status = decision;
    rec.decisionNote = String(note || '').slice(0, 300);
    rec.decidedBy = adminSession.userId;
    rec.decidedAt = new Date().toISOString();
    this.store.transaction(() => {
      this.store.put('kyc', userId, rec);
      this.auth.updateUser(userId, { kycStatus: decision });
      this.ledger.append({
        userId,
        type: 'KYC_DECISION',
        currency: 'SYSTEM',
        amount: 0,
        balanceBefore: 0,
        balanceAfter: 0,
        metadata: { decision, by: adminSession.userId },
      });
    });
    return rec;
  }

  // ---------------------------------------------------------------------------
  // PRIZE REDEMPTIONS / LIVE PAYOUTS
  // ---------------------------------------------------------------------------
  requestRedemption(session, { amountSC, method, destination, cryptoAsset, giftCardBrand }, geo) {
    this._requirePlayer(session);
    assertGeo(this.compliance, geo);
    assertScalar(amountSC, 'amountSC');
    assertScalar(method, 'method');
    assertScalar(destination, 'destination');
    assertScalar(cryptoAsset, 'cryptoAsset');
    assertScalar(giftCardBrand, 'giftCardBrand');

    const m = String(method || '').toLowerCase();
    const normalizedMethod =
      m === 'chime' || m === 'cashapp'
        ? 'cashapp'
        : m === 'crypto'
        ? 'crypto'
        : m === 'giftcard'
        ? 'giftcard'
        : m === 'stripe_bank' || m === 'stripe'
        ? 'stripe_bank'
        : null;
    if (!normalizedMethod) {
      throw httpError('Select a payout method: Gift Card (+5%), Crypto, Cash App, or Stripe Bank.');
    }

    const user = this.auth.getUserById(session.userId);
    if (this.compliance.requireKycForRedemption && user?.kycStatus !== 'verified') {
      throw httpError(
        user?.kycStatus === 'pending'
          ? 'Your identity verification is pending operator approval.'
          : 'Complete KYC identity verification before your first prize redemption.',
        403,
        'KYC_REQUIRED'
      );
    }

    let dest = String(destination || '').trim();
    let asset = null;
    let brand = null;

    if (normalizedMethod === 'crypto') {
      asset = getAsset(cryptoAsset || 'USDT_SOL');
      if (!CryptoVerifier.isValidAddress(asset, dest)) {
        throw httpError(`Enter a valid ${asset.network} receiving wallet address.`);
      }
    } else if (normalizedMethod === 'cashapp') {
      dest = normalizeCashtag(dest);
      if (!dest) throw httpError('Enter a valid $Cashtag.');
    } else if (normalizedMethod === 'giftcard') {
      const validBrands = new Set((SWEEPSTAKES_CONFIG.giftCardBrands || []).map((b) => b.id));
      brand = validBrands.has(String(giftCardBrand)) ? String(giftCardBrand) : 'visa_virtual';
      dest = dest || user?.email;
      if (!dest || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) {
        throw httpError('Enter a valid delivery email address for your digital gift card.');
      }
    } else if (normalizedMethod === 'stripe_bank') {
      if (dest.length < 4 || dest.length > 120) {
        throw httpError('Enter your Stripe Connect account ID (acct_...) or verified bank payout reference.');
      }
    }

    const baseUsd = ServerWallet.fromCents(ServerWallet.toCents(amountSC)) * (SWEEPSTAKES_CONFIG.scUsdRate || 1);
    const bonusMultiplier = normalizedMethod === 'giftcard' ? 1 + (SWEEPSTAKES_CONFIG.giftCardBonusRate || 0.05) : 1;
    const payoutUsd = Number((baseUsd * bonusMultiplier).toFixed(2));

    const today = this._todayTotalUsd('redemptions', session.userId, ['pending_review', 'approved', 'paid']);
    if (today + payoutUsd > this.compliance.maxDailyRedemptionUsd) {
      throw httpError(`Daily payout limit of $${this.compliance.maxDailyRedemptionUsd.toLocaleString()} reached.`);
    }

    return this.store.transaction(() => {
      const id = newId('rdm');
      const reserve = this.wallet.reserveRedemptionSync(session.userId, amountSC, {
        method: normalizedMethod,
        destinationMasked: maskDestination(dest),
        redemptionId: id,
      });
      const rdm = {
        id,
        userId: session.userId,
        userEmail: user?.email || null,
        method: normalizedMethod,
        cryptoAsset: asset?.id || null,
        network: asset?.network || null,
        giftCardBrand: brand,
        destination: dest,
        destinationMasked: maskDestination(dest),
        amountSC: reserve.amountRedeemedSC,
        amountCents: reserve.amountCents,
        amountUsd: payoutUsd,
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      };
      this.store.insert('redemptions', id, rdm);
      return { redemption: PaymentsService._publicRedemption(rdm), balance: reserve.account };
    });
  }

  static _publicRedemption(r) {
    return {
      id: r.id,
      method: r.method,
      cryptoAsset: r.cryptoAsset,
      giftCardBrand: r.giftCardBrand || null,
      destinationMasked: r.destinationMasked,
      amountSC: r.amountSC,
      amountUsd: r.amountUsd,
      status: r.status,
      createdAt: r.createdAt,
      paidAt: r.paidAt || null,
      receipt: r.status === 'paid' ? r.txHashOrReceipt : null,
      explorerUrl: r.explorerUrl || null,
      rejectionReason: r.status === 'rejected' ? r.rejectionReason || null : null,
    };
  }

  listRedemptionsForUser(session, limit = 50) {
    return this.store.find('redemptions', { k2: session.userId, limit }).map(PaymentsService._publicRedemption);
  }

  async adminQuoteRedemption(adminSession, { redemptionId }) {
    assertScalar(redemptionId, 'redemptionId');
    const r = this.store.get('redemptions', redemptionId);
    if (!r) throw httpError('Redemption not found', 404);
    if (!['pending_review', 'approved'].includes(r.status)) {
      throw httpError(`Redemption is already ${r.status}.`);
    }
    const instructions = { method: r.method, destination: r.destination, amountUsd: r.amountUsd };
    if (r.method === 'crypto') {
      const asset = getAsset(r.cryptoAsset);
      const { price } = await this.prices.getUsdPrice(asset.priceKey);
      const units = usdToDisplayUnits(r.amountUsd, price, asset);
      const amount = displayUnitsToString(units, asset.displayDecimals);
      r.quote = { units: units.toString(), amount, unit: asset.unit, priceUsd: price, quotedAt: new Date().toISOString() };
      Object.assign(instructions, {
        asset: asset.id,
        network: asset.network,
        amount,
        unit: asset.unit,
        priceUsd: price,
        walletUri: PaymentsService.walletUri(asset, r.destination, amount),
      });
    } else if (r.method === 'cashapp') {
      const amt = r.amountUsd % 1 === 0 ? String(r.amountUsd) : r.amountUsd.toFixed(2);
      Object.assign(instructions, {
        cashtag: r.destination,
        amountFormatted: `$${amt}`,
        cashAppLink: `https://cash.app/${r.destination}`,
        note: `Blinko Prize ${r.id}`,
      });
    } else if (r.method === 'giftcard') {
      Object.assign(instructions, {
        brand: r.giftCardBrand || 'visa_virtual',
        email: r.destination,
        bonusIncluded: '+5%',
      });
    } else if (r.method === 'stripe_bank') {
      Object.assign(instructions, {
        stripeEnabled: this.stripe.enabled,
        destination: r.destination,
      });
    }
    r.status = 'approved';
    r.approvedBy = adminSession.userId;
    r.approvedAt = r.approvedAt || new Date().toISOString();
    this.store.put('redemptions', r.id, r);
    return { redemption: r, instructions };
  }

  async adminMarkRedemptionPaid(adminSession, { redemptionId, txHash, receipt, note = '', executeLiveStripe = false }) {
    assertScalar(redemptionId, 'redemptionId');
    assertScalar(txHash, 'txHash');
    assertScalar(receipt, 'receipt');
    const r = this.store.get('redemptions', redemptionId);
    if (!r) throw httpError('Redemption not found', 404);
    if (r.status === 'paid') return { redemption: r, alreadyPaid: true };
    if (r.status !== 'approved') {
      throw httpError('Generate live payout quote / instructions before marking as paid.');
    }

    let claimKey;
    let proof = {};

    if (r.method === 'crypto') {
      const asset = getAsset(r.cryptoAsset);
      const hash = String(txHash || '').trim();
      if (!hash) throw httpError('Paste the outgoing blockchain transaction hash.');
      if (!r.quote) throw httpError('Missing payout quote — click Quote / Approve first.');
      const v = await this.verifier.verifyTransfer({ asset, txHash: hash, recipient: r.destination });
      if (!v.found || v.success === false) {
        throw httpError(v.error || 'Payout transaction not found on-chain yet.');
      }
      const sentDisplay = chainToDisplayUnits(v.amountRaw, asset);
      const quoted = BigInt(r.quote.units);
      if (sentDisplay * 100n < quoted * 98n) {
        throw httpError(
          `On-chain transfer sent ${displayUnitsToString(sentDisplay, asset.displayDecimals)} ${asset.unit}, below quoted ${r.quote.amount} ${asset.unit}.`
        );
      }
      claimKey = `payout:${asset.chain}:${hash.toLowerCase()}`;
      proof = { txHashOrReceipt: hash, explorerUrl: `${asset.explorerTx}${hash}` };
    } else if (r.method === 'stripe_bank') {
      let receiptId = String(receipt || '').trim();
      if (executeLiveStripe && this.stripe.enabled) {
        const stripeOut = await this.stripe.createPayoutOrTransfer({
          amountUsd: r.amountUsd,
          destination: r.destination,
          redemptionId: r.id,
        });
        receiptId = stripeOut.id;
      }
      if (receiptId.length < 4) throw httpError('Enter the Stripe transfer/payout ID or execute live Stripe payout.');
      claimKey = `payout_stripe:${receiptId.toLowerCase()}`;
      proof = { txHashOrReceipt: receiptId };
    } else {
      const rec = String(receipt || '').trim();
      if (rec.length < 4) throw httpError('Enter the payout receipt ID or digital gift card claim code (4+ chars).');
      claimKey = `payout_${r.method}:${rec.toLowerCase()}`;
      proof = { txHashOrReceipt: rec };
    }

    return this.store.transaction(() => {
      const cur = this.store.get('redemptions', r.id);
      if (cur.status === 'paid') return { redemption: cur, alreadyPaid: true };
      try {
        this.store.insert('claimed_tx', claimKey, {
          kind: 'payout',
          refId: cur.id,
          userId: cur.userId,
          at: new Date().toISOString(),
        });
      } catch (err) {
        if (err.code === 'DUPLICATE') throw httpError('That payout receipt/txHash was already used.');
        throw err;
      }
      const balance = this.wallet.settleRedemptionSync(cur.userId, cur.amountCents, {
        redemptionId: cur.id,
        method: cur.method,
        receipt: proof.txHashOrReceipt,
        paidBy: adminSession.userId,
      });
      Object.assign(cur, proof, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        paidBy: adminSession.userId,
        operatorNote: String(note || '').slice(0, 300),
      });
      this.store.put('redemptions', cur.id, cur);
      return { redemption: cur, alreadyPaid: false, balance };
    });
  }

  adminRejectRedemption(adminSession, { redemptionId, reason = 'Operator declined payout' }) {
    assertScalar(redemptionId, 'redemptionId');
    return this.store.transaction(() => {
      const r = this.store.get('redemptions', redemptionId);
      if (!r) throw httpError('Redemption not found', 404);
      if (r.status === 'paid') throw httpError('Cannot reject an already-paid redemption.');
      if (r.status === 'rejected') return { redemption: r, alreadyRejected: true };
      const balance = this.wallet.refundRedemptionSync(r.userId, r.amountCents, {
        redemptionId: r.id,
        reason: String(reason || '').slice(0, 300),
        rejectedBy: adminSession.userId,
      });
      r.status = 'rejected';
      r.rejectionReason = String(reason || '').slice(0, 300);
      r.rejectedAt = new Date().toISOString();
      r.rejectedBy = adminSession.userId;
      this.store.put('redemptions', r.id, r);
      return { redemption: r, balance };
    });
  }
}
