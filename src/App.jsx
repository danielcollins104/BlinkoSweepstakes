import React, { useCallback, useEffect, useRef, useState } from 'react';
import BreakingNewsTicker from './components/BreakingNewsTicker';
import HeaderBar from './components/HeaderBar';
import BlinkoBoardCanvas from './components/BlinkoBoardCanvas';
import GameControls from './components/GameControls';
import LiveDropsSidebar from './components/LiveDropsSidebar';
import AuthModal from './components/AuthModal';
import CashierModal from './components/CashierModal';
import ProvablyFairModal from './components/ProvablyFairModal';
import SweepstakesRulesModal from './components/SweepstakesRulesModal';
import AdminConsoleModal from './components/AdminConsoleModal';
import { BET_LIMITS, MEME_CHARACTERS } from './config/blinkoConfig';
import { apiClient } from './services/apiClient';
import { soundEngine } from './audio/soundEngine';

function makeRandomClientSeed() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function App() {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState({ goldCoins: 100000, sweepsCoins: 0, unplayedSC: 0, redeemableSC: 0 });
  const [currencyMode, setCurrencyMode] = useState('GC');
  const [betPerBall, setBetPerBall] = useState(BET_LIMITS.GC.defaultBet);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState('MEDIUM');
  const [ballCount, setBallCount] = useState(1);
  const [characterId, setCharacterId] = useState('polar_bear_2026');
  const [clientSeed, setClientSeed] = useState(makeRandomClientSeed);
  const [autoDrop, setAutoDrop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  const [dropQueue, setDropQueue] = useState([]);
  const [recentDrops, setRecentDrops] = useState([]);
  const [liveFlash, setLiveFlash] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [promoStatus, setPromoStatus] = useState(null);

  // Modals
  const [showAuth, setShowAuth] = useState(false);
  const [cashierTab, setCashierTab] = useState(null); // null | 'store' | 'redeem' | 'history'
  const [showFair, setShowFair] = useState(false);
  const [fairPrefill, setFairPrefill] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showAdmin, setShowAdmin] = useState(() => window.location.hash === '#admin');

  // Visual balance sync refs so payouts tick up as pucks hit buckets
  const authoritativeBalanceRef = useRef(null);
  const inFlightBallsRef = useRef(0);
  const pendingBatchesRef = useRef(new Map());

  const syncServerBalance = useCallback(async () => {
    try {
      const res = await apiClient.me();
      setUser(res.user);
      setBalance(res.balance);
      authoritativeBalanceRef.current = res.balance;
    } catch {}
  }, []);

  // Bootstrap session + check Stripe Checkout return params
  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        let meRes = null;
        if (apiClient.getToken()) {
          try {
            meRes = await apiClient.me();
          } catch {
            apiClient.setToken(null);
          }
        }
        if (!meRes) {
          meRes = await apiClient.guest();
        }
        if (!active) return;
        setUser(meRes.user);
        setBalance(meRes.balance);
        authoritativeBalanceRef.current = meRes.balance;

        // Default registered players to SC if they have SC, or keep GC ready
        const params = new URLSearchParams(window.location.search);
        const stripeSessionId = params.get('stripe_session_id');
        const stripeRef = params.get('stripe_ref');
        if (stripeSessionId && meRes.user?.role !== 'GUEST') {
          try {
            const conf = await apiClient.confirmStripeSession({
              stripeSessionId,
              sessionRef: stripeRef || undefined,
            });
            if (active && conf.balance) {
              setBalance(conf.balance);
              authoritativeBalanceRef.current = conf.balance;
              setLiveFlash('LIVE CARD DEPOSIT CREDITED! Bonus Sweeps Coins unlocked!');
              window.history.replaceState({}, '', window.location.pathname + window.location.hash);
            }
          } catch {}
        }
      } catch (err) {
        if (active) setBannerError(err.message || 'Unable to connect to Blinko server.');
      }
    };
    init();
    return () => {
      active = false;
      soundEngine.dispose();
    };
  }, []);

  const handleSelectCurrency = (mode) => {
    if (mode === 'SC' && (!user || user.role === 'GUEST')) {
      setShowAuth(true);
      return;
    }
    setCurrencyMode(mode);
    setBetPerBall(BET_LIMITS[mode].defaultBet);
    setBannerError('');
    soundEngine.playButtonClick(mode === 'SC' ? 660 : 520);
  };

  const handleDrop = useCallback(async () => {
    if (busy) return;
    if (currencyMode === 'SC' && (!user || user.role === 'GUEST')) {
      setAutoDrop(false);
      setShowAuth(true);
      return;
    }
    setBusy(true);
    setBannerError('');

    const chosenChar =
      characterId === 'chaos'
        ? MEME_CHARACTERS[Math.floor(Math.random() * MEME_CHARACTERS.length)].id
        : characterId;

    try {
      const res = await apiClient.drop({
        currencyMode,
        betPerBall,
        rows,
        risk,
        ballCount,
        characterId: chosenChar,
        clientSeed,
      });

      soundEngine.playDropLaunch();
      authoritativeBalanceRef.current = res.balance;
      inFlightBallsRef.current += res.balls.length;
      pendingBatchesRef.current.set(res.dropId, { remaining: res.balls.length, dropRecord: res });

      // Immediately debit bet visually from displayed balance so suspense builds until buckets hit
      setBalance((prev) => ({
        ...prev,
        goldCoins:
          currencyMode === 'GC'
            ? Math.max(0, Number(prev.goldCoins || 0) - Number(res.totalBet))
            : prev.goldCoins,
        sweepsCoins:
          currencyMode === 'SC'
            ? Math.max(0, Number((Number(prev.sweepsCoins || 0) - Number(res.totalBet)).toFixed(2)))
            : prev.sweepsCoins,
      }));

      const queued = res.balls.map((b, idx) => ({
        uid: `${res.dropId}_${idx}`,
        dropId: res.dropId,
        path: b.path,
        rows: res.rows,
        bucketIndex: b.bucketIndex,
        multiplier: b.multiplier,
        payout: b.payout,
        currencyMode: res.currencyMode,
        characterId:
          characterId === 'chaos'
            ? MEME_CHARACTERS[(idx + res.provablyFair.nonce) % MEME_CHARACTERS.length].id
            : chosenChar,
      }));
      setDropQueue(queued);
    } catch (err) {
      setAutoDrop(false);
      setBannerError(err.message);
      soundEngine.playButtonClick(190);
    } finally {
      setBusy(false);
    }
  }, [busy, currencyMode, user, betPerBall, rows, risk, ballCount, characterId, clientSeed]);

  const handleBallLanded = useCallback((meta) => {
    inFlightBallsRef.current = Math.max(0, inFlightBallsRef.current - 1);

    if (inFlightBallsRef.current === 0 && authoritativeBalanceRef.current) {
      setBalance(authoritativeBalanceRef.current);
    } else if (meta.payout > 0) {
      setBalance((prev) => ({
        ...prev,
        goldCoins:
          meta.currencyMode === 'GC'
            ? Number(prev.goldCoins || 0) + Math.round(meta.payout)
            : prev.goldCoins,
        sweepsCoins:
          meta.currencyMode === 'SC'
            ? Number((Number(prev.sweepsCoins || 0) + Number(meta.payout)).toFixed(2))
            : prev.sweepsCoins,
      }));
    }

    const batch = pendingBatchesRef.current.get(meta.dropId);
    if (batch) {
      batch.remaining -= 1;
      if (batch.remaining <= 0) {
        pendingBatchesRef.current.delete(meta.dropId);
        const rec = batch.dropRecord;
        setRecentDrops((prev) => [rec, ...prev].slice(0, 25));
        if (rec.maxMultiplier >= 10) {
          const ch = MEME_CHARACTERS.find((c) => c.id === rec.characterId);
          setLiveFlash(
            `HOT WIRE: ${ch?.name || 'Meme Puck'} just nailed ${rec.maxMultiplier}x (+${rec.totalWin} ${rec.currencyMode})!`
          );
        }
      }
    }
  }, []);

  const clearQueue = useCallback(() => setDropQueue([]), []);

  // Auto-Drop loop
  useEffect(() => {
    if (!autoDrop) return undefined;
    const id = setInterval(() => {
      handleDrop();
    }, Math.max(480, ballCount * 110 + 380));
    return () => clearInterval(id);
  }, [autoDrop, ballCount, handleDrop]);

  // Global keyboard shortcuts (Space to drop, Ctrl+Shift+A for admin)
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowAdmin((v) => !v);
        return;
      }
      if (e.code === 'Space') {
        const anyModalOpen = showAuth || Boolean(cashierTab) || showFair || showRules || showAdmin;
        if (anyModalOpen) return;
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (['input', 'textarea', 'select', 'button', 'a'].includes(tag)) return;
        e.preventDefault();
        handleDrop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAuth, cashierTab, showFair, showRules, showAdmin, handleDrop]);

  const handleAuthSuccess = (res) => {
    setUser(res.user);
    setBalance(res.balance);
    authoritativeBalanceRef.current = res.balance;
    setCurrencyMode('SC');
    setBetPerBall(BET_LIMITS.SC.defaultBet);
    setLiveFlash(`WELCOME ${res.user.name.toUpperCase()}! 10.00 FREE SC & 100,000 GC CREDITED!`);
  };

  const handleLogout = async () => {
    setAutoDrop(false);
    await apiClient.logout();
    const g = await apiClient.guest();
    setUser(g.user);
    setBalance(g.balance);
    authoritativeBalanceRef.current = g.balance;
    setCurrencyMode('GC');
    setBetPerBall(BET_LIMITS.GC.defaultBet);
  };

  const handleClaimDaily = async () => {
    setPromoStatus(null);
    try {
      const res = await apiClient.claimDaily();
      setBalance(res.balance);
      authoritativeBalanceRef.current = res.balance;
      soundEngine.playBucketLand(5);
      setPromoStatus({
        type: 'success',
        message: `Claimed +${res.granted.goldCoins.toLocaleString()} GC${
          res.granted.sweepsCoins > 0 ? ` + ${res.granted.sweepsCoins.toFixed(2)} FREE SC!` : '!'
        }`,
      });
    } catch (err) {
      setPromoStatus({ type: 'error', message: err.message });
    }
  };

  const handleClaimAmoe = async () => {
    if (!user || user.role === 'GUEST') {
      setShowAuth(true);
      return;
    }
    setPromoStatus(null);
    try {
      const res = await apiClient.claimAmoe();
      setBalance(res.balance);
      authoritativeBalanceRef.current = res.balance;
      soundEngine.playBucketLand(5);
      setPromoStatus({
        type: 'success',
        message: `AMOE Entry Credited: +${res.granted.goldCoins.toLocaleString()} GC + ${res.granted.sweepsCoins.toFixed(2)} FREE SC!`,
      });
    } catch (err) {
      setPromoStatus({ type: 'error', message: err.message });
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  return (
    <div className="app-shell">
      <BreakingNewsTicker liveFlash={liveFlash} />

      <HeaderBar
        currencyMode={currencyMode}
        onSelectCurrency={handleSelectCurrency}
        balance={balance}
        user={user}
        muted={muted}
        onToggleMute={handleToggleMute}
        onOpenCashier={(tab) => setCashierTab(tab)}
        onOpenAuth={() => setShowAuth(true)}
        onOpenFair={() => {
          setFairPrefill(null);
          setShowFair(true);
        }}
        onOpenRules={() => setShowRules(true)}
        onOpenAdmin={() => setShowAdmin(true)}
        onLogout={handleLogout}
      />

      {bannerError && (
        <div className="global-toast error" role="alert">
          <span>{bannerError}</span>
          <button type="button" onClick={() => setBannerError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <main className="arena-grid">
        <GameControls
          currencyMode={currencyMode}
          betPerBall={betPerBall}
          onChangeBet={setBetPerBall}
          rows={rows}
          onChangeRows={setRows}
          risk={risk}
          onChangeRisk={setRisk}
          ballCount={ballCount}
          onChangeBallCount={setBallCount}
          characterId={characterId}
          onChangeCharacter={setCharacterId}
          autoDrop={autoDrop}
          onToggleAutoDrop={() => setAutoDrop((v) => !v)}
          onDrop={handleDrop}
          busy={busy}
          balance={balance}
        />

        <BlinkoBoardCanvas
          rows={rows}
          risk={risk}
          dropQueue={dropQueue}
          onBallLanded={handleBallLanded}
          onClearQueue={clearQueue}
        />

        <LiveDropsSidebar
          balance={balance}
          user={user}
          recentDrops={recentDrops}
          onClaimDaily={handleClaimDaily}
          onClaimAmoe={handleClaimAmoe}
          onOpenVerifyDrop={(d) => {
            setFairPrefill(d);
            setShowFair(true);
          }}
          promoStatus={promoStatus}
        />
      </main>

      <AuthModal
        isOpen={showAuth}
        onClose={() => setShowAuth(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      <CashierModal
        isOpen={Boolean(cashierTab)}
        onClose={() => setCashierTab(null)}
        initialTab={cashierTab || 'store'}
        balance={balance}
        user={user}
        onBalanceUpdate={(b) => {
          setBalance(b);
          authoritativeBalanceRef.current = b;
        }}
        onRequireAuth={() => {
          setCashierTab(null);
          setShowAuth(true);
        }}
      />

      <ProvablyFairModal
        isOpen={showFair}
        onClose={() => setShowFair(false)}
        clientSeed={clientSeed}
        onChangeClientSeed={setClientSeed}
        prefillDrop={fairPrefill}
      />

      <SweepstakesRulesModal isOpen={showRules} onClose={() => setShowRules(false)} />

      <AdminConsoleModal
        isOpen={showAdmin}
        onClose={() => setShowAdmin(false)}
        onBalanceMayHaveChanged={syncServerBalance}
      />
    </div>
  );
}
