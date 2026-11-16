import React, { useEffect, useState } from 'react';
import {
  X,
  Lock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  LogOut,
  RotateCw,
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { soundEngine } from '../audio/soundEngine';

export default function AdminConsoleModal({ isOpen, onClose, onBalanceMayHaveChanged }) {
  const [unlocked, setUnlocked] = useState(() => Boolean(apiClient.getAdminToken()));
  const [keyInput, setKeyInput] = useState('');
  const [tab, setTab] = useState('redemptions'); // 'redemptions' | 'kyc' | 'orders' | 'deposits' | 'tools'
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [summary, setSummary] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [kycList, setKycList] = useState([]);
  const [orders, setOrders] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [ledgerInfo, setLedgerInfo] = useState(null);
  const [quoteData, setQuoteData] = useState({});
  const [receiptInputs, setReceiptInputs] = useState({});

  const [adjForm, setAdjForm] = useState({ targetUserId: '', currency: 'SC', amount: '50', reason: '' });

  const refreshAll = async () => {
    try {
      const [sum, rdm, kyc, ord, dep] = await Promise.all([
        apiClient.adminSummary(),
        apiClient.adminRedemptions(),
        apiClient.adminKycList(),
        apiClient.adminOrders(),
        apiClient.adminDeposits(),
      ]);
      setSummary(sum.pending);
      setRedemptions(rdm.redemptions || []);
      setKycList(kyc.submissions || []);
      setOrders(ord.orders || []);
      setDeposits(dep.deposits || []);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        apiClient.setAdminToken(null);
        setUnlocked(false);
      }
      setToast({ type: 'error', message: err.message });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setToast(null);
    if (apiClient.getAdminToken()) {
      apiClient
        .adminVerify()
        .then(() => {
          setUnlocked(true);
          refreshAll();
        })
        .catch(() => {
          apiClient.setAdminToken(null);
          setUnlocked(false);
        });
    } else {
      setUnlocked(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setToast(null);
    try {
      await apiClient.adminLogin(keyInput.trim());
      setUnlocked(true);
      setKeyInput('');
      soundEngine.playBucketLand(10);
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    apiClient.setAdminToken(null);
    setUnlocked(false);
  };

  const handleKycDecision = async (userId, decision) => {
    setBusy(true);
    try {
      await apiClient.adminDecideKyc({ userId, decision });
      setToast({ type: 'success', message: `KYC ${decision} for ${userId}` });
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleQuoteRedemption = async (redemptionId) => {
    setBusy(true);
    try {
      const res = await apiClient.adminQuoteRedemption({ redemptionId });
      setQuoteData((prev) => ({ ...prev, [redemptionId]: res.instructions }));
      setToast({ type: 'success', message: `Approved & quoted ${redemptionId}` });
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async (r, executeLiveStripe = false) => {
    setBusy(true);
    try {
      const val = receiptInputs[r.id] || '';
      await apiClient.adminMarkRedemptionPaid({
        redemptionId: r.id,
        txHash: r.method === 'crypto' ? val : undefined,
        receipt: r.method !== 'crypto' ? val : undefined,
        executeLiveStripe,
      });
      setToast({ type: 'success', message: `Redemption ${r.id} marked PAID!` });
      onBalanceMayHaveChanged?.();
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRejectRedemption = async (redemptionId) => {
    setBusy(true);
    try {
      await apiClient.adminRejectRedemption({ redemptionId, reason: 'Declined by operator' });
      setToast({ type: 'info', message: `Redemption ${redemptionId} rejected & SC refunded.` });
      onBalanceMayHaveChanged?.();
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmOrder = async (orderId) => {
    setBusy(true);
    try {
      const receipt = receiptInputs[orderId] || '';
      await apiClient.adminConfirmOrder({ orderId, cashAppPaymentId: receipt });
      setToast({ type: 'success', message: `Cash App order ${orderId} confirmed & credited!` });
      onBalanceMayHaveChanged?.();
      await refreshAll();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyLedger = async () => {
    setBusy(true);
    try {
      const res = await apiClient.adminLedger(40);
      setLedgerInfo(res.integrity);
      setToast({
        type: res.integrity?.valid ? 'success' : 'error',
        message: res.integrity?.valid
          ? `Ledger verified: ${res.integrity.chainLength} cryptographic blocks intact.`
          : res.integrity?.error,
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRotateSeed = async () => {
    setBusy(true);
    try {
      const res = await apiClient.adminRotateSeed();
      setToast({
        type: 'success',
        message: `Server seed rotated! Revealed previous seed: ${res.revealedServerSeed.slice(0, 18)}…`,
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleAdjustBalance = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient.adminAdjustBalance({
        targetUserId: adjForm.targetUserId.trim(),
        currency: adjForm.currency,
        amount: Number(adjForm.amount),
        reason: adjForm.reason.trim(),
      });
      setToast({ type: 'success', message: 'Balance adjusted & signed to audit ledger.' });
      onBalanceMayHaveChanged?.();
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="admin-modal-title">
              <Lock size={18} className="inline-icon" aria-hidden="true" /> Operator Payout &amp; Compliance Console
            </h2>
            <p className="modal-sub">
              Approve KYC, execute live payouts, confirm Cash App receipts, and audit the Merkle ledger.
            </p>
          </div>
          <div className="inline-input">
            {unlocked && (
              <>
                <button type="button" className="icon-btn" onClick={refreshAll} aria-label="Refresh queues">
                  <RefreshCw size={16} aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" onClick={handleLogout} aria-label="Lock operator console">
                  <LogOut size={16} aria-hidden="true" />
                </button>
              </>
            )}
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close operator console">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        {toast && (
          <div className={`alert ${toast.type}`} role="status">
            {toast.message}
          </div>
        )}

        {!unlocked ? (
          <form onSubmit={handleLogin} className="stack-form">
            <div className="field">
              <label htmlFor="admin-secret-input">Operator Secret Key (DC_ADMIN_SECRET)</label>
              <input
                id="admin-secret-input"
                type="password"
                placeholder="Enter server DC_ADMIN_SECRET…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Authenticating…' : 'Unlock Operator Console'}
            </button>
          </form>
        ) : (
          <div className="admin-body">
            <div className="tab-pills">
              <button type="button" className={tab === 'redemptions' ? 'active' : ''} onClick={() => setTab('redemptions')}>
                Payouts ({summary?.redemptions || 0})
              </button>
              <button type="button" className={tab === 'kyc' ? 'active' : ''} onClick={() => setTab('kyc')}>
                KYC ({summary?.kyc || 0})
              </button>
              <button type="button" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
                Cash App ({summary?.cashAppOrders || 0})
              </button>
              <button type="button" className={tab === 'deposits' ? 'active' : ''} onClick={() => setTab('deposits')}>
                Crypto ({summary?.cryptoReview || 0})
              </button>
              <button type="button" className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>
                Ledger &amp; Tools
              </button>
            </div>

            {/* PAYOUT QUEUE */}
            {tab === 'redemptions' && (
              <div className="queue-list">
                {redemptions.length === 0 && <p className="modal-sub">No payout requests yet.</p>}
                {redemptions.map((r) => {
                  const instr = quoteData[r.id];
                  return (
                    <div key={r.id} className="queue-card">
                      <div className="queue-top">
                        <div>
                          <strong className="mono">{r.id}</strong> • {r.method.toUpperCase()} •{' '}
                          <strong>${Number(r.amountUsd).toFixed(2)} USD</strong> ({r.amountSC} SC)
                        </div>
                        <span className={`status-pill ${r.status}`}>{r.status}</span>
                      </div>
                      <div className="queue-meta mono">
                        Player: {r.userId} ({r.userEmail}) → Dest: {r.destination}
                      </div>

                      {instr && (
                        <div className="instr-box">
                          {instr.cashAppLink && (
                            <a href={instr.cashAppLink} target="_blank" rel="noreferrer" className="btn-secondary">
                              <ExternalLink size={14} /> Open Cash App Payout Link
                            </a>
                          )}
                          {instr.walletUri && (
                            <div className="mono">
                              Send <strong>{instr.amount} {instr.unit}</strong> →{' '}
                              <a href={instr.walletUri} target="_blank" rel="noreferrer">Open Wallet URI</a>
                            </div>
                          )}
                          {instr.bonusIncluded && <div>Gift Card Brand: {instr.brand} (+5% bonus included)</div>}
                        </div>
                      )}

                      {['pending_review', 'approved'].includes(r.status) && (
                        <div className="queue-actions">
                          <button type="button" className="btn-secondary" onClick={() => handleQuoteRedemption(r.id)} disabled={busy}>
                            1. Quote / Approve
                          </button>
                          <input
                            type="text"
                            placeholder={
                              r.method === 'crypto'
                                ? 'Outgoing txHash…'
                                : r.method === 'giftcard'
                                ? 'Gift Card code…'
                                : 'Receipt ID…'
                            }
                            aria-label={`Receipt or txHash for ${r.id}`}
                            value={receiptInputs[r.id] || ''}
                            onChange={(e) => setReceiptInputs({ ...receiptInputs, [r.id]: e.target.value })}
                          />
                          <button type="button" className="btn-primary" onClick={() => handleMarkPaid(r, false)} disabled={busy}>
                            2. Mark Paid
                          </button>
                          {r.method === 'stripe_bank' && instr?.stripeEnabled && (
                            <button type="button" className="btn-primary" onClick={() => handleMarkPaid(r, true)} disabled={busy}>
                              Execute Live Stripe Payout
                            </button>
                          )}
                          <button type="button" className="btn-danger" onClick={() => handleRejectRedemption(r.id)} disabled={busy}>
                            Reject &amp; Refund SC
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* KYC QUEUE */}
            {tab === 'kyc' && (
              <div className="queue-list">
                {kycList.length === 0 && <p className="modal-sub">No KYC submissions yet.</p>}
                {kycList.map((k) => (
                  <div key={k.userId} className="queue-card">
                    <div className="queue-top">
                      <strong>
                        {k.legalName} ({k.dob})
                      </strong>
                      <span className={`status-pill ${k.status}`}>{k.status}</span>
                    </div>
                    <div className="queue-meta">
                      User: <code>{k.userId}</code> • {k.address?.line1}, {k.address?.city}, {k.address?.state}{' '}
                      {k.address?.zip}
                    </div>
                    {k.status === 'pending' && (
                      <div className="queue-actions">
                        <button type="button" className="btn-primary" onClick={() => handleKycDecision(k.userId, 'verified')}>
                          <CheckCircle2 size={15} /> Verify Player
                        </button>
                        <button type="button" className="btn-danger" onClick={() => handleKycDecision(k.userId, 'rejected')}>
                          <XCircle size={15} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* CASH APP ORDERS */}
            {tab === 'orders' && (
              <div className="queue-list">
                {orders.length === 0 && <p className="modal-sub">No Cash App orders yet.</p>}
                {orders.map((o) => (
                  <div key={o.id} className="queue-card">
                    <div className="queue-top">
                      <strong>
                        {o.orderRef} — ${Number(o.amountUsd).toFixed(2)} ({o.senderTag || 'No tag'})
                      </strong>
                      <span className={`status-pill ${o.status}`}>{o.status}</span>
                    </div>
                    <div className="queue-meta mono">
                      User: {o.userId} • {o.goldCoins.toLocaleString()} GC + {o.freeSweepsCoins} SC
                    </div>
                    {['awaiting_payment', 'awaiting_confirmation'].includes(o.status) && (
                      <div className="queue-actions">
                        <input
                          type="text"
                          placeholder="Cash App Web Receipt ID…"
                          aria-label={`Receipt ID for ${o.orderRef}`}
                          value={receiptInputs[o.id] || ''}
                          onChange={(e) => setReceiptInputs({ ...receiptInputs, [o.id]: e.target.value })}
                        />
                        <button type="button" className="btn-primary" onClick={() => handleConfirmOrder(o.id)}>
                          Confirm &amp; Credit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* CRYPTO DEPOSITS */}
            {tab === 'deposits' && (
              <div className="queue-list">
                {deposits.length === 0 && <p className="modal-sub">No crypto deposits yet.</p>}
                {deposits.map((d) => (
                  <div key={d.id} className="queue-card">
                    <div className="queue-top">
                      <strong>
                        {d.id} — {d.amountDisplay} {d.unit} (${d.amountUsd})
                      </strong>
                      <span className={`status-pill ${d.status}`}>{d.status}</span>
                    </div>
                    <div className="queue-meta mono">
                      User: {d.userId} • Tx: {d.txHash || 'None submitted'}
                    </div>
                    {d.status === 'needs_review' && (
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => apiClient.adminResolveDeposit({ depositId: d.id, action: 'credit' }).then(refreshAll)}
                        >
                          Force Credit
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => apiClient.adminResolveDeposit({ depositId: d.id, action: 'reject' }).then(refreshAll)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* LEDGER & TOOLS */}
            {tab === 'tools' && (
              <div className="stack-form">
                <div className="inline-input">
                  <button type="button" className="btn-primary" onClick={handleVerifyLedger} disabled={busy}>
                    <ShieldCheck size={16} /> Verify SHA-256 Audit Ledger
                  </button>
                  <button type="button" className="btn-secondary" onClick={handleRotateSeed} disabled={busy}>
                    <RotateCw size={16} /> Rotate Provably Fair Server Seed
                  </button>
                </div>

                {ledgerInfo && (
                  <div className="alert success mono">
                    Valid: {String(ledgerInfo.valid)} • Chain Blocks: {ledgerInfo.chainLength} • Head:{' '}
                    {ledgerInfo.lastBlockHash?.slice(0, 20)}…
                  </div>
                )}

                <form onSubmit={handleAdjustBalance} className="card-option-box stack-form">
                  <h3>Admin Balance Adjustment</h3>
                  <div className="form-grid-2">
                    <div className="field">
                      <label htmlFor="adj-user-id">Target User ID</label>
                      <input
                        id="adj-user-id"
                        type="text"
                        placeholder="usr_..."
                        value={adjForm.targetUserId}
                        onChange={(e) => setAdjForm({ ...adjForm, targetUserId: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="adj-currency">Currency</label>
                      <select
                        id="adj-currency"
                        value={adjForm.currency}
                        onChange={(e) => setAdjForm({ ...adjForm, currency: e.target.value })}
                      >
                        <option value="SC">SC</option>
                        <option value="GC">GC</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="adj-amount">Delta Amount</label>
                      <input
                        id="adj-amount"
                        type="number"
                        step="0.01"
                        value={adjForm.amount}
                        onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="adj-reason">Audit Reason</label>
                      <input
                        id="adj-reason"
                        type="text"
                        placeholder="Manual promo or reconciliation"
                        value={adjForm.reason}
                        onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    Apply Logged Adjustment
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
