import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, RefreshCw, CheckCircle2, RotateCw } from 'lucide-react';
import { apiClient } from '../services/apiClient';

export default function ProvablyFairModal({
  isOpen,
  onClose,
  clientSeed,
  onChangeClientSeed,
  prefillDrop,
}) {
  const [commitment, setCommitment] = useState(null);
  const [serverSeed, setServerSeed] = useState('');
  const [verifyClientSeed, setVerifyClientSeed] = useState(clientSeed || '');
  const [nonce, setNonce] = useState('1');
  const [rows, setRows] = useState('12');
  const [risk, setRisk] = useState('MEDIUM');
  const [ballCount, setBallCount] = useState('1');
  const [betPerBall, setBetPerBall] = useState('1');
  const [currencyMode, setCurrencyMode] = useState('SC');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    apiClient
      .getProvablyFair()
      .then((c) => {
        setCommitment(c);
        if (c?.previousServerSeed) {
          setServerSeed((prev) => prev || c.previousServerSeed);
        }
      })
      .catch(() => {});

    if (prefillDrop) {
      setVerifyClientSeed(prefillDrop.provablyFair?.clientSeed || clientSeed || '');
      setNonce(String(prefillDrop.provablyFair?.nonce || 1));
      setRows(String(prefillDrop.rows || 12));
      setRisk(String(prefillDrop.risk || 'MEDIUM'));
      setBallCount(String(prefillDrop.ballCount || 1));
      setBetPerBall(String(prefillDrop.betPerBall || 1));
      setCurrencyMode(String(prefillDrop.currencyMode || 'SC'));
    } else {
      setVerifyClientSeed(clientSeed || '');
    }
    setResult(null);
    setError('');
  }, [isOpen, prefillDrop, clientSeed]);

  if (!isOpen) return null;

  const handleRotateSeed = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rotateProvablyFair();
      setCommitment({
        serverSeedHash: res.newServerSeedHash,
        previousServerSeed: res.revealedServerSeed,
        previousServerSeedHash: res.revealedServerSeedHash,
        algorithm: res.algorithm,
      });
      setServerSeed(res.revealedServerSeed);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await apiClient.verifyProvablyFair({
        serverSeed: serverSeed.trim(),
        clientSeed: verifyClientSeed.trim(),
        nonce: Number(nonce),
        rows: Number(rows),
        risk,
        ballCount: Number(ballCount),
        betPerBall: Number(betPerBall),
        currencyMode,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const regenerateClientSeed = () => {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    onChangeClientSeed?.(hex);
    setVerifyClientSeed(hex);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card medium"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fair-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="fair-modal-title">
              <ShieldCheck size={20} className="inline-icon" aria-hidden="true" /> Provably Fair HMAC-SHA256
            </h2>
            <p className="modal-sub">
              Per-account server seeds commit via SHA-256 before drops. Rotate your seed anytime to reveal and verify prior drops.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close provably fair dialog">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="commitment-box">
          <div className="field">
            <label htmlFor="active-server-hash">Your Active Server Seed SHA-256 Commitment</label>
            <div className="inline-input">
              <input
                id="active-server-hash"
                type="text"
                readOnly
                value={commitment?.serverSeedHash || 'Loading…'}
                className="mono"
              />
              <button type="button" className="btn-secondary" onClick={handleRotateSeed} disabled={busy}>
                <RotateCw size={14} aria-hidden="true" /> Rotate &amp; Reveal
              </button>
            </div>
          </div>

          {commitment?.previousServerSeed && (
            <div className="field">
              <label htmlFor="prev-server-seed">Last Revealed Server Seed (for prior drops)</label>
              <input id="prev-server-seed" type="text" readOnly value={commitment.previousServerSeed} className="mono" />
            </div>
          )}

          <div className="field">
            <label htmlFor="active-client-seed">Your Active Client Seed</label>
            <div className="inline-input">
              <input
                id="active-client-seed"
                type="text"
                value={clientSeed}
                onChange={(e) => onChangeClientSeed?.(e.target.value)}
                className="mono"
              />
              <button type="button" className="btn-secondary" onClick={regenerateClientSeed}>
                <RefreshCw size={14} aria-hidden="true" /> New Seed
              </button>
            </div>
          </div>
        </div>

        <form onSubmit={handleVerify} className="stack-form">
          <h3>Verify Past Drop Outcome</h3>
          <div className="form-grid-2">
            <div className="field">
              <label htmlFor="vf-server-seed">Revealed Server Seed (64-hex)</label>
              <input
                id="vf-server-seed"
                type="text"
                placeholder="Click Rotate & Reveal above to get seed…"
                value={serverSeed}
                onChange={(e) => setServerSeed(e.target.value)}
                className="mono"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="vf-client-seed">Client Seed</label>
              <input
                id="vf-client-seed"
                type="text"
                value={verifyClientSeed}
                onChange={(e) => setVerifyClientSeed(e.target.value)}
                className="mono"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="vf-nonce">Account Nonce</label>
              <input id="vf-nonce" type="number" value={nonce} onChange={(e) => setNonce(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="vf-rows">Rows</label>
              <select id="vf-rows" value={rows} onChange={(e) => setRows(e.target.value)}>
                <option value="8">8 Rows</option>
                <option value="12">12 Rows</option>
                <option value="16">16 Rows</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="vf-risk">Volatility</label>
              <select id="vf-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="vf-balls">Ball Count</label>
              <input id="vf-balls" type="number" min="1" max="10" value={ballCount} onChange={(e) => setBallCount(e.target.value)} />
            </div>
          </div>

          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Computing HMAC-SHA256…' : 'Verify Cryptographic Outcome'}
          </button>

          {result && (
            <div className="alert success verify-result" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>Verified Fair!</strong> Total Payout: <strong>{result.totalPayout}</strong>
                <div className="tiny-list">
                  {result.balls.map((b) => (
                    <span key={b.ballIndex} className="tag-badge">
                      Puck #{b.ballIndex + 1}: Bucket {b.bucketIndex} ({b.multiplier}x)
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
