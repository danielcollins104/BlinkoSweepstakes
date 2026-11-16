import React from 'react';
import {
  Coins,
  Gem,
  ShoppingBag,
  Banknote,
  ShieldCheck,
  Volume2,
  VolumeX,
  User,
  Lock,
  Scale,
  LogOut,
} from 'lucide-react';

export default function HeaderBar({
  currencyMode,
  onSelectCurrency,
  balance,
  user,
  muted,
  onToggleMute,
  onOpenCashier,
  onOpenAuth,
  onOpenFair,
  onOpenRules,
  onOpenAdmin,
  onLogout,
}) {
  const isGuest = !user || user.role === 'GUEST';
  const gc = Number(balance?.goldCoins || 0).toLocaleString();
  const sc = Number(balance?.sweepsCoins || 0).toFixed(2);

  return (
    <header className="top-header">
      <div className="brand-group">
        <div className="brand-logo" aria-hidden="true">
          📺
        </div>
        <div>
          <h1 className="brand-title">
            BLINKO <span className="brand-accent">HEADLINE CHAOS &apos;26</span>
          </h1>
          <p className="brand-subtitle">US SWEEPSTAKES SOCIAL CASINO • GC &amp; SC</p>
        </div>
      </div>

      <div className="wallet-bar" role="group" aria-label="Currency selector and balances">
        <button
          type="button"
          className={`currency-pill ${currencyMode === 'GC' ? 'active-gc' : ''}`}
          onClick={() => onSelectCurrency('GC')}
          aria-pressed={currencyMode === 'GC'}
          aria-label={`Play with Gold Coins, current balance ${gc} GC`}
        >
          <Coins size={18} className="icon-gc" aria-hidden="true" />
          <div className="pill-meta">
            <span className="pill-label">GOLD COINS (FUN)</span>
            <span className="pill-value">{gc} GC</span>
          </div>
        </button>

        <button
          type="button"
          className={`currency-pill ${currencyMode === 'SC' ? 'active-sc' : ''}`}
          onClick={() => onSelectCurrency('SC')}
          aria-pressed={currencyMode === 'SC'}
          aria-label={`Play with Sweeps Coins, current balance ${sc} SC`}
        >
          <Gem size={18} className="icon-sc" aria-hidden="true" />
          <div className="pill-meta">
            <span className="pill-label">SWEEPS COINS (PRIZES)</span>
            <span className="pill-value">{sc} SC</span>
          </div>
        </button>
      </div>

      <nav className="header-actions" aria-label="Cashier and utility actions">
        <button
          type="button"
          className="btn-buy"
          onClick={() => onOpenCashier('store')}
        >
          <ShoppingBag size={16} aria-hidden="true" />
          <span>Buy Coins</span>
        </button>

        <button
          type="button"
          className="btn-redeem"
          onClick={() => onOpenCashier('redeem')}
        >
          <Banknote size={16} aria-hidden="true" />
          <span>Redeem</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenFair}
          aria-label="Provably fair verifier"
          title="Provably Fair Verifier"
        >
          <ShieldCheck size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenRules}
          aria-label="Sweepstakes rules and AMOE"
          title="Official Sweepstakes Rules"
        >
          <Scale size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
          title={muted ? 'Unmute audio' : 'Mute audio'}
        >
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>

        {isGuest ? (
          <button type="button" className="btn-auth" onClick={onOpenAuth}>
            <User size={16} aria-hidden="true" />
            <span>Sign In / Free 10 SC</span>
          </button>
        ) : (
          <div className="user-chip">
            <span className="user-name" title={user.email}>
              {user.name || user.email}
            </span>
            <button
              type="button"
              className="icon-btn small"
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        <button
          type="button"
          className="icon-btn admin-trigger"
          onClick={onOpenAdmin}
          aria-label="Open operator payout console"
          title="Operator Payout Console (Ctrl+Shift+A)"
        >
          <Lock size={16} aria-hidden="true" />
        </button>
      </nav>
    </header>
  );
}
