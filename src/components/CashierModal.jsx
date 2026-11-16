import React, { useEffect, useState } from 'react';
import {
  X,
  ShoppingBag,
  Banknote,
  History,
  Bitcoin,
  DollarSign,
  CreditCard,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { soundEngine } from '../audio/soundEngine';
import QrCodeImage from './QrCodeImage';

export default function CashierModal({
  isOpen,
  onClose,
  initialTab = 'store',
  gameConfig,
  balance,
  user,
  onBalanceUpdate,
  onRequireAuth,
}) {
  const storePackages = gameConfig?.storePackages || [];
  const highRollerPackages = gameConfig?.highRollerPackages || [];
  const redemptionMethods = gameConfig?.redemptionMethods || [];
  const giftCardBrands = gameConfig?.giftCardBrands || [];

  const [tab, setTab] = useState(initialTab);
  const [step, setStep] = useState(1); // 1 = select package, 2 = live payment rail
  const [tierView, setTierView] = useState('standard'); // 'standard' | 'highroller'
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [customAmount, setCustomAmount] = useState('25');
  const [rail, setRail] = useState('crypto'); // 'crypto' | 'cashapp' | 'card'
  const [config, setConfig] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Crypto deposit state
  const [cryptoAsset, setCryptoAsset] = useState('USDT_SOL');
  const [activeDeposit, setActiveDeposit] = useState(null);
  const [txHashInput, setTxHashInput] = useState('');

  // Cash App deposit state
  const [senderTag, setSenderTag] = useState('');
  const [activeOrder, setActiveOrder] = useState(null);

  // Card / Stripe state
  const [nmiToken, setNmiToken] = useState('');

  // KYC & Redeem state
  const [kycStatus, setKycStatus] = useState({ status: user?.kycStatus || 'none', note: null });
  const [kycForm, setKycForm] = useState({
    legalName: '',
    dob: '',
    line1: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });
  const [redeemMethod, setRedeemMethod] = useState('giftcard');
  const [redeemCryptoAsset, setRedeemCryptoAsset] = useState('USDT_SOL');
  const [giftCardBrand, setGiftCardBrand] = useState('visa_virtual');
  const [redeemDest, setRedeemDest] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('50');
  const [redemptions, setRedemptions] = useState([]);

  // History state
  const [historyData, setHistoryData] = useState({ orders: [], deposits: [], ledger: [] });

  const isGuest = !user || user.role === 'GUEST';

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    setStep(1);
    setFeedback(null);
    setActiveDeposit(null);
    setActiveOrder(null);
    setTxHashInput('');

    apiClient.getPaymentsConfig().then(setConfig).catch(() => {});
    if (!isGuest) {
      apiClient.getKycStatus().then(setKycStatus).catch(() => {});
      apiClient.myRedemptions().then((r) => setRedemptions(r.redemptions || [])).catch(() => {});
    }
  }, [isOpen, initialTab, isGuest]);

  useEffect(() => {
    if (!isOpen || isGuest || tab !== 'history') return;
    Promise.all([
      apiClient.myOrders().catch(() => ({ orders: [] })),
      apiClient.myCryptoDeposits().catch(() => ({ deposits: [] })),
      apiClient.getLedger(40).catch(() => ({ history: [] })),
    ]).then(([o, d, l]) => {
      setHistoryData({ orders: o.orders || [], deposits: d.deposits || [], ledger: l.history || [] });
    });
  }, [isOpen, isGuest, tab]);

  if (!isOpen) return null;

  const activePkg =
    selectedPkg ||
    storePackages[2] ||
    storePackages[0] || { id: 'pkg_custom', tierTitle: 'Custom Bundle', priceUsd: 25, isCustom: true };

  const copyText = (key, text) => {
    navigator.clipboard?.writeText(String(text)).catch(() => {});
    setCopiedKey(key);
    soundEngine.playButtonClick(660);
    setTimeout(() => setCopiedKey(''), 1800);
  };

  const selectPackage = (pkg) => {
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    setSelectedPkg(pkg);
    setStep(2);
    setActiveDeposit(null);
    setActiveOrder(null);
    setFeedback(null);
    soundEngine.playButtonClick(580);
  };

  const selectCustomPackage = () => {
    const raw = Number(customAmount);
    const num = Number(Math.max(1, Math.min(50000, Number.isFinite(raw) ? raw : 25)).toFixed(2));
    selectPackage({
      id: `pkg_custom_${num}`,
      tierTitle: `Custom Headline Bundle ($${num.toFixed(2)})`,
      priceUsd: num,
      isCustom: true,
    });
  };

  const handleGenerateCryptoQuote = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = activePkg.isCustom
        ? { packageId: activePkg.id, customAmountUsd: activePkg.priceUsd, asset: cryptoAsset }
        : { packageId: activePkg.id, asset: cryptoAsset };
      const res = await apiClient.createCryptoDeposit(payload);
      setActiveDeposit(res.deposit);
      soundEngine.playButtonClick(640);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCryptoTx = async (e) => {
    e.preventDefault();
    if (!activeDeposit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiClient.submitCryptoTx({ depositId: activeDeposit.id, txHash: txHashInput.trim() });
      setActiveDeposit(res.deposit);
      if (res.credited && res.balance) {
        onBalanceUpdate?.(res.balance);
        soundEngine.playBucketLand(25);
        setFeedback({
          type: 'success',
          message: `Verified on-chain! Credited ${Number(res.deposit.goldCoins).toLocaleString()} GC + ${Number(
            res.deposit.freeSweepsCoins
          ).toFixed(2)} FREE SC.`,
        });
      } else {
        setFeedback({
          type: res.deposit?.status === 'rejected' ? 'error' : 'info',
          message: res.deposit?.message || 'Checked on-chain status.',
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCashAppOrder = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = activePkg.isCustom
        ? { packageId: activePkg.id, customAmountUsd: activePkg.priceUsd, senderTag: senderTag.trim() || undefined }
        : { packageId: activePkg.id, senderTag: senderTag.trim() || undefined };
      const res = await apiClient.createCashAppOrder(payload);
      setActiveOrder(res.order);
      soundEngine.playButtonClick(620);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkCashAppSent = async () => {
    if (!activeOrder) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiClient.markCashAppSent({ orderId: activeOrder.id, senderTag: senderTag.trim() });
      setActiveOrder(res.order);
      soundEngine.playBucketLand(5);
      setFeedback({
        type: 'success',
        message: `Order ${res.order.orderRef} submitted! Once our operator verifies receipt, your GC & FREE SC will credit automatically.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleStripeCheckout = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = activePkg.isCustom
        ? { packageId: activePkg.id, customAmountUsd: activePkg.priceUsd }
        : { packageId: activePkg.id };
      const res = await apiClient.createStripeCheckout(payload);
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenOnramp = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = activePkg.isCustom
        ? { packageId: activePkg.id, customAmountUsd: activePkg.priceUsd }
        : { packageId: activePkg.id };
      const res = await apiClient.createOnrampLink(payload);
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleNmiCharge = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const idem = `nmi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const res = await apiClient.chargeNmiCard({
        packageId: activePkg.id,
        customAmountUsd: activePkg.isCustom ? activePkg.priceUsd : undefined,
        paymentToken: nmiToken.trim(),
        idempotencyKey: idem,
      });
      if (res.balance) onBalanceUpdate?.(res.balance);
      setFeedback({ type: res.success ? 'success' : 'error', message: res.charge?.message || 'Processed' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleKycSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiClient.submitKyc({
        legalName: kycForm.legalName,
        dob: kycForm.dob,
        phone: kycForm.phone,
        address: {
          line1: kycForm.line1,
          city: kycForm.city,
          state: kycForm.state,
          zip: kycForm.zip,
        },
      });
      setKycStatus({ status: res.status, note: null });
      soundEngine.playBucketLand(3);
      setFeedback({
        type: 'success',
        message: 'Identity submitted! An operator will verify your KYC shortly.',
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRedeemSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiClient.redeem({
        amountSC: Number(redeemAmount),
        method: redeemMethod,
        cryptoAsset: redeemMethod === 'crypto' ? redeemCryptoAsset : undefined,
        giftCardBrand: redeemMethod === 'giftcard' ? giftCardBrand : undefined,
        destination: redeemDest.trim() || (redeemMethod === 'giftcard' ? user?.email : ''),
      });
      if (res.balance) onBalanceUpdate?.(res.balance);
      setRedemptions((prev) => [res.redemption, ...prev]);
      soundEngine.playBucketLand(15);
      setFeedback({
        type: 'success',
        message: `Payout request ${res.redemption.id} ($${res.redemption.amountUsd.toFixed(2)}) queued for live settlement!`,
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const totalSc = Number(balance?.sweepsCoins || 0);
  const unplayedSc = Number(balance?.unplayedSC || 0);
  const redeemableSc = Number(balance?.redeemableSC || 0);
  const playthroughPct = totalSc > 0 ? Math.min(100, Math.round((redeemableSc / totalSc) * 100)) : 100;

  const activeMethodObj = redemptionMethods.find((m) => m.id === redeemMethod);
  const packagesList = tierView === 'standard' ? storePackages : highRollerPackages;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cashier-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="cashier-modal-title">Newsroom Cashier &amp; Live Prize Payouts</h2>
            <p className="modal-sub">
              Buy Gold Coins (receive FREE bonus Sweeps Coins) or redeem played-through SC for live cash &amp; crypto.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close cashier">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="tab-pills">
          <button type="button" className={tab === 'store' ? 'active' : ''} onClick={() => setTab('store')}>
            <ShoppingBag size={15} aria-hidden="true" /> Buy Coin Bundles
          </button>
          <button type="button" className={tab === 'redeem' ? 'active' : ''} onClick={() => setTab('redeem')}>
            <Banknote size={15} aria-hidden="true" /> Redeem Prizes ({redeemableSc.toFixed(2)} SC)
          </button>
          <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            <History size={15} aria-hidden="true" /> Orders &amp; Ledger
          </button>
        </div>

        {feedback && (
          <div className={`alert ${feedback.type}`} role="status">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{feedback.message}</span>
          </div>
        )}

        {/* TAB 1: COIN STORE & LIVE PAYMENT RAILS */}
        {tab === 'store' && step === 1 && (
          <div className="store-body">
            <div className="store-toolbar">
              <div className="segmented-group compact">
                <button type="button" className={tierView === 'standard' ? 'active' : ''} onClick={() => setTierView('standard')}>
                  Headline Bundles
                </button>
                <button type="button" className={tierView === 'highroller' ? 'active' : ''} onClick={() => setTierView('highroller')}>
                  VIP Anchor Suites
                </button>
              </div>

              <div className="custom-pkg-bar">
                <label htmlFor="custom-usd-amt">Custom USD ($):</label>
                <input
                  id="custom-usd-amt"
                  type="number"
                  min="1"
                  max="50000"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={selectCustomPackage}>
                  Build ${Number(customAmount || 25).toFixed(2)}
                </button>
              </div>
            </div>

            <div className="pkg-grid">
              {packagesList.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`pkg-card ${pkg.popular ? 'popular' : ''}`}
                  style={{ '--pkg-accent': pkg.accent }}
                >
                  <span className="pkg-badge">{pkg.badge}</span>
                  <h3>{pkg.tierTitle}</h3>
                  <p className="pkg-joke">{pkg.headlineJoke}</p>
                  <div className="pkg-rewards">
                    <div className="gc-amt">{pkg.goldCoins.toLocaleString()} GC</div>
                    <div className="sc-bonus">+ {pkg.freeSweepsCoins.toFixed(2)} FREE SC</div>
                  </div>
                  <button type="button" className="btn-primary full" onClick={() => selectPackage(pkg)}>
                    <span>Buy ${pkg.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'store' && step === 2 && (
          <div className="checkout-body">
            <div className="checkout-top">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                <ArrowLeft size={15} aria-hidden="true" /> Change Bundle
              </button>
              <div className="selected-summary">
                <strong>{activePkg.tierTitle}</strong> —{' '}
                <span>${activePkg.priceUsd.toFixed(2)} USD</span>
                {!activePkg.isCustom && (
                  <>
                    {' '}
                    ({activePkg.goldCoins.toLocaleString()} GC +{' '}
                    <strong>{activePkg.freeSweepsCoins.toFixed(2)} FREE SC</strong>)
                  </>
                )}
              </div>
            </div>

            <div className="rail-tabs">
              <button type="button" className={rail === 'crypto' ? 'active' : ''} onClick={() => setRail('crypto')}>
                <Bitcoin size={15} aria-hidden="true" /> On-Chain Crypto (Auto-Verify)
              </button>
              <button type="button" className={rail === 'cashapp' ? 'active' : ''} onClick={() => setRail('cashapp')}>
                <DollarSign size={15} aria-hidden="true" /> Cash App P2P
              </button>
              <button type="button" className={rail === 'card' ? 'active' : ''} onClick={() => setRail('card')}>
                <CreditCard size={15} aria-hidden="true" /> Card / Stripe / On-Ramp
              </button>
            </div>

            {/* CRYPTO DEPOSIT RAIL */}
            {rail === 'crypto' && (
              <div className="rail-panel">
                <div className="field">
                  <label htmlFor="crypto-asset-select">Select Blockchain Network &amp; Asset</label>
                  <select
                    id="crypto-asset-select"
                    value={cryptoAsset}
                    onChange={(e) => {
                      setCryptoAsset(e.target.value);
                      setActiveDeposit(null);
                    }}
                  >
                    <option value="USDT_SOL">USDT (Solana SPL • 0% Fee)</option>
                    <option value="SOL">Solana (SOL Mainnet)</option>
                    <option value="USDT_ERC20">USDT (Ethereum ERC-20)</option>
                    <option value="ETH">Ethereum (ETH Mainnet)</option>
                    <option value="BTC">Bitcoin (BTC Native SegWit)</option>
                  </select>
                </div>

                {!activeDeposit ? (
                  <button type="button" className="btn-primary" onClick={handleGenerateCryptoQuote} disabled={busy}>
                    {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                    <span>Lock Live Crypto Quote &amp; Generate QR</span>
                  </button>
                ) : (
                  <div className="quote-card">
                    <div className="qr-col">
                      <QrCodeImage value={activeDeposit.walletUri} alt="Crypto deposit QR code" size={172} />
                      <a href={activeDeposit.walletUri} className="btn-secondary full" target="_blank" rel="noreferrer">
                        <ExternalLink size={14} aria-hidden="true" /> Open Wallet App
                      </a>
                    </div>

                    <div className="quote-details">
                      <div className="detail-row">
                        <span>Send EXACT Tagged Amount:</span>
                        <div className="copy-val">
                          <strong className="mono">
                            {activeDeposit.amount} {activeDeposit.unit}
                          </strong>
                          <button
                            type="button"
                            className="icon-btn small"
                            onClick={() => copyText('amt', activeDeposit.amount)}
                            aria-label="Copy exact amount"
                          >
                            {copiedKey === 'amt' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>

                      <div className="detail-row">
                        <span>To {activeDeposit.network} Address:</span>
                        <div className="copy-val">
                          <code className="mono addr-code">{activeDeposit.address}</code>
                          <button
                            type="button"
                            className="icon-btn small"
                            onClick={() => copyText('addr', activeDeposit.address)}
                            aria-label="Copy wallet address"
                          >
                            {copiedKey === 'addr' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>

                      <div className="quote-meta">
                        Spot Oracle: ${Number(activeDeposit.priceUsd).toLocaleString()} ({activeDeposit.priceSources?.join(', ')}) •
                        Required confirmations: {activeDeposit.requiredConfirmations}
                      </div>

                      <form onSubmit={handleVerifyCryptoTx} className="tx-verify-form">
                        <label htmlFor="crypto-tx-hash">Paste Transaction Hash / Signature After Sending</label>
                        <div className="inline-input">
                          <input
                            id="crypto-tx-hash"
                            type="text"
                            placeholder="Paste txHash / Solana signature…"
                            value={txHashInput}
                            onChange={(e) => setTxHashInput(e.target.value)}
                            className="mono"
                            required
                          />
                          <button type="submit" className="btn-primary" disabled={busy}>
                            {busy ? 'Checking Chain…' : 'Verify On-Chain & Credit'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CASH APP RAIL */}
            {rail === 'cashapp' && (
              <div className="rail-panel">
                <div className="field">
                  <label htmlFor="cashapp-sender-tag">Your Cash App $Cashtag (for instant matching)</label>
                  <input
                    id="cashapp-sender-tag"
                    type="text"
                    placeholder="$YourCashtag"
                    value={senderTag}
                    onChange={(e) => setSenderTag(e.target.value)}
                  />
                </div>

                {!activeOrder ? (
                  <button type="button" className="btn-primary" onClick={handleCreateCashAppOrder} disabled={busy}>
                    <DollarSign size={16} aria-hidden="true" />
                    <span>Generate Cash App Order &amp; QR</span>
                  </button>
                ) : (
                  <div className="quote-card">
                    <div className="qr-col">
                      <QrCodeImage value={activeOrder.paymentLink} alt="Cash App payment QR code" size={172} />
                      <a
                        href={activeOrder.paymentLink}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary full"
                      >
                        <ExternalLink size={14} aria-hidden="true" /> Open Cash App (${activeOrder.amountUsd})
                      </a>
                    </div>

                    <div className="quote-details">
                      <div className="detail-row">
                        <span>Pay To Cashtag:</span>
                        <strong>{activeOrder.payTo}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Include Exact Memo / Note:</span>
                        <div className="copy-val">
                          <strong className="mono">{activeOrder.orderRef}</strong>
                          <button
                            type="button"
                            className="icon-btn small"
                            onClick={() => copyText('ref', activeOrder.orderRef)}
                            aria-label="Copy Cash App note code"
                          >
                            {copiedKey === 'ref' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                      <p className="modal-sub">
                        Status: <strong>{activeOrder.status}</strong>. After completing the payment in Cash App, click below:
                      </p>
                      {activeOrder.status === 'awaiting_payment' && (
                        <button type="button" className="btn-primary" onClick={handleMarkCashAppSent} disabled={busy}>
                          I&apos;ve Sent ${activeOrder.amountUsd} on Cash App
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CARD / STRIPE / NMI / ON-RAMP RAIL */}
            {rail === 'card' && (
              <div className="rail-panel stack-form">
                <div className="card-option-box">
                  <h3>Option A: Live Stripe Checkout (Visa / Mastercard / Apple Pay)</h3>
                  {config?.stripe?.enabled ? (
                    <button type="button" className="btn-primary" onClick={handleStripeCheckout} disabled={busy}>
                      <CreditCard size={16} aria-hidden="true" />
                      <span>Pay ${activePkg.priceUsd.toFixed(2)} via Stripe Checkout</span>
                    </button>
                  ) : (
                    <p className="modal-sub">Stripe Checkout is not configured on the server yet.</p>
                  )}
                </div>

                {config?.card?.enabled && (
                  <form onSubmit={handleNmiCharge} className="card-option-box stack-form">
                    <h3>Option B: Direct NMI Tokenized Card Sale</h3>
                    <div className="field">
                      <label htmlFor="nmi-token-input">Collect.js Payment Token</label>
                      <input
                        id="nmi-token-input"
                        type="text"
                        placeholder="Paste tokenized card token…"
                        value={nmiToken}
                        onChange={(e) => setNmiToken(e.target.value)}
                        required
                      />
                    </div>
                    <button type="submit" className="btn-primary" disabled={busy}>
                      Charge ${activePkg.priceUsd.toFixed(2)} via NMI
                    </button>
                  </form>
                )}

                <div className="card-option-box">
                  <h3>Option C: Instant Card-to-USDT On-Ramp</h3>
                  <p className="modal-sub">
                    Buy USDT directly to your player deposit wallet with Apple Pay, Google Pay, or debit card via MoonPay:
                  </p>
                  <button type="button" className="btn-secondary" onClick={handleOpenOnramp} disabled={busy}>
                    <ExternalLink size={15} aria-hidden="true" /> Buy ${activePkg.priceUsd.toFixed(2)} USDT on MoonPay
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REDEEM PRIZES / PAYOUTS */}
        {tab === 'redeem' && (
          <div className="redeem-body">
            {isGuest ? (
              <div className="alert info">
                <span>Sign in or create a free account to verify your identity and redeem Sweeps Coins for real prizes.</span>
                <button type="button" className="btn-primary" onClick={onRequireAuth}>
                  Sign In / Register
                </button>
              </div>
            ) : (
              <>
                <div className="sc-summary-bar">
                  <div>
                    <span className="muted-lbl">Total Balance</span>
                    <strong>{totalSc.toFixed(2)} SC</strong>
                  </div>
                  <div>
                    <span className="muted-lbl">Redeemable (1× Played)</span>
                    <strong className="sc-green">{redeemableSc.toFixed(2)} SC</strong>
                  </div>
                  <div>
                    <span className="muted-lbl">Unplayed Bonus</span>
                    <strong>{unplayedSc.toFixed(2)} SC</strong>
                  </div>
                  <div>
                    <span className="muted-lbl">Pending Payouts</span>
                    <strong>{Number(balance?.pendingRedemptionSC || 0).toFixed(2)} SC</strong>
                  </div>
                </div>

                <div className="rollover-track" aria-label={`Playthrough progress ${playthroughPct}%`}>
                  <div className="rollover-fill" style={{ width: `${playthroughPct}%` }} />
                </div>

                {kycStatus.status !== 'verified' && (
                  <div className="kyc-box">
                    <div className="kyc-head">
                      <ShieldCheck size={18} aria-hidden="true" />
                      <h3>
                        Identity Verification (KYC Status: <span className="upper">{kycStatus.status}</span>)
                      </h3>
                    </div>
                    {kycStatus.status === 'pending' ? (
                      <p className="modal-sub">Your KYC submission is awaiting operator approval.</p>
                    ) : (
                      <form onSubmit={handleKycSubmit} className="stack-form">
                        <div className="form-grid-2">
                          <div className="field">
                            <label htmlFor="kyc-name">Full Legal Name</label>
                            <input
                              id="kyc-name"
                              type="text"
                              placeholder="First Last"
                              value={kycForm.legalName}
                              onChange={(e) => setKycForm({ ...kycForm, legalName: e.target.value })}
                              required
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="kyc-dob">Date of Birth (18+)</label>
                            <input
                              id="kyc-dob"
                              type="date"
                              value={kycForm.dob}
                              onChange={(e) => setKycForm({ ...kycForm, dob: e.target.value })}
                              required
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="kyc-line1">Street Address</label>
                            <input
                              id="kyc-line1"
                              type="text"
                              placeholder="123 Main St"
                              value={kycForm.line1}
                              onChange={(e) => setKycForm({ ...kycForm, line1: e.target.value })}
                              required
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="kyc-city">City</label>
                            <input
                              id="kyc-city"
                              type="text"
                              placeholder="Austin"
                              value={kycForm.city}
                              onChange={(e) => setKycForm({ ...kycForm, city: e.target.value })}
                              required
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="kyc-state">State (2 Letters)</label>
                            <input
                              id="kyc-state"
                              type="text"
                              maxLength={2}
                              placeholder="TX"
                              value={kycForm.state}
                              onChange={(e) => setKycForm({ ...kycForm, state: e.target.value.toUpperCase() })}
                              required
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="kyc-zip">ZIP Code</label>
                            <input
                              id="kyc-zip"
                              type="text"
                              placeholder="78701"
                              value={kycForm.zip}
                              onChange={(e) => setKycForm({ ...kycForm, zip: e.target.value })}
                              required
                            />
                          </div>
                        </div>
                        <button type="submit" className="btn-primary" disabled={busy}>
                          Submit KYC for Verification
                        </button>
                      </form>
                    )}
                  </div>
                )}

                <form onSubmit={handleRedeemSubmit} className="redeem-form stack-form">
                  <h3>Request Live Prize Payout</h3>
                  <div className="method-grid">
                    {redemptionMethods.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`method-btn ${redeemMethod === m.id ? 'active' : ''}`}
                        onClick={() => setRedeemMethod(m.id)}
                      >
                        <strong>{m.shortLabel}</strong>
                        <span>{m.badge}</span>
                      </button>
                    ))}
                  </div>

                  <div className="form-grid-2">
                    {redeemMethod === 'crypto' && (
                      <div className="field">
                        <label htmlFor="rdm-crypto-asset">Crypto Payout Network</label>
                        <select
                          id="rdm-crypto-asset"
                          value={redeemCryptoAsset}
                          onChange={(e) => setRedeemCryptoAsset(e.target.value)}
                        >
                          <option value="USDT_SOL">USDT (Solana SPL)</option>
                          <option value="SOL">Solana (SOL)</option>
                          <option value="USDT_ERC20">USDT (ERC-20)</option>
                          <option value="ETH">Ethereum (ETH)</option>
                          <option value="BTC">Bitcoin (BTC)</option>
                        </select>
                      </div>
                    )}

                    {redeemMethod === 'giftcard' && (
                      <div className="field">
                        <label htmlFor="rdm-gc-brand">Digital Gift Card Brand (+5% Bonus)</label>
                        <select
                          id="rdm-gc-brand"
                          value={giftCardBrand}
                          onChange={(e) => setGiftCardBrand(e.target.value)}
                        >
                          {giftCardBrands.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} (+5%)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="field">
                      <label htmlFor="rdm-amount">
                        Amount SC (Min {activeMethodObj?.minSC || 50} SC)
                      </label>
                      <div className="inline-input">
                        <input
                          id="rdm-amount"
                          type="number"
                          step="0.01"
                          min={activeMethodObj?.minSC || 50}
                          value={redeemAmount}
                          onChange={(e) => setRedeemAmount(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setRedeemAmount(redeemableSc.toFixed(2))}
                        >
                          MAX
                        </button>
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor="rdm-dest">
                        {redeemMethod === 'crypto'
                          ? 'Your Receiving Wallet Address'
                          : redeemMethod === 'cashapp'
                          ? 'Your $Cashtag'
                          : redeemMethod === 'giftcard'
                          ? 'Delivery Email Address'
                          : 'Stripe Connect ID (acct_...) or Bank Ref'}
                      </label>
                      <input
                        id="rdm-dest"
                        type="text"
                        placeholder={
                          redeemMethod === 'crypto'
                            ? 'Wallet address…'
                            : redeemMethod === 'cashapp'
                            ? '$YourCashtag'
                            : redeemMethod === 'giftcard'
                            ? user?.email || 'you@example.com'
                            : 'acct_...'
                        }
                        value={redeemDest}
                        onChange={(e) => setRedeemDest(e.target.value)}
                        required={redeemMethod !== 'giftcard'}
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn-primary" disabled={busy || kycStatus.status !== 'verified'}>
                    {kycStatus.status === 'verified'
                      ? `Request $${(
                          Number(redeemAmount || 0) * (1 + (activeMethodObj?.bonusRate || 0))
                        ).toFixed(2)} Payout`
                      : 'Complete KYC Above to Unlock Payouts'}
                  </button>
                </form>

                {redemptions.length > 0 && (
                  <div className="table-wrap">
                    <h3>Your Prize Payout Queue</h3>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Method</th>
                          <th>USD Value</th>
                          <th>Destination</th>
                          <th>Status / Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {redemptions.map((r) => (
                          <tr key={r.id}>
                            <td className="mono">{r.id.slice(0, 14)}</td>
                            <td>{r.method}</td>
                            <td>${Number(r.amountUsd).toFixed(2)}</td>
                            <td className="mono">{r.destinationMasked}</td>
                            <td>
                              <span className={`status-pill ${r.status}`}>{r.status}</span>
                              {r.receipt && <code className="mono small-code"> {r.receipt}</code>}
                              {r.explorerUrl && (
                                <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="ext-link">
                                  Explorer ↗
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 3: HISTORY & AUDIT LEDGER */}
        {tab === 'history' && (
          <div className="history-body">
            {isGuest ? (
              <p className="modal-sub">Sign in to inspect your personal cryptographic audit ledger and payment orders.</p>
            ) : (
              <div className="table-wrap">
                <h3>SHA-256 Hash-Chained Account Ledger</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Currency</th>
                      <th>Delta</th>
                      <th>Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.ledger.map((row) => (
                      <tr key={row.id}>
                        <td>{row.index}</td>
                        <td>{row.type}</td>
                        <td>{row.currency}</td>
                        <td className={row.amount >= 0 ? 'sc-green' : 'neg'}>
                          {row.amount >= 0 ? `+${row.amount}` : row.amount}
                        </td>
                        <td>{row.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
