import React from 'react';
import { Gift, Mail, ShieldCheck, TrendingUp } from 'lucide-react';
import { MEME_CHARACTERS } from '../config/memeCast';

export default function LiveDropsSidebar({
  balance,
  user,
  recentDrops,
  onClaimDaily,
  onClaimAmoe,
  onOpenVerifyDrop,
  promoStatus,
}) {
  const isGuest = !user || user.role === 'GUEST';

  return (
    <aside className="feed-panel" aria-label="Bonuses and recent drops feed">
      <div className="promo-box">
        <h2 className="section-heading">FREE SWEEPSTAKES ENTRIES</h2>
        <div className="promo-buttons">
          <button type="button" className="btn-promo daily" onClick={onClaimDaily}>
            <Gift size={16} aria-hidden="true" />
            <div>
              <div className="promo-title">Claim Daily Bonus</div>
              <div className="promo-sub">
                +10,000 GC {isGuest ? '(Sign in for +1.00 SC)' : '+ 1.00 FREE SC'}
              </div>
            </div>
          </button>

          <button type="button" className="btn-promo amoe" onClick={onClaimAmoe}>
            <Mail size={16} aria-hidden="true" />
            <div>
              <div className="promo-title">Free AMOE Entry</div>
              <div className="promo-sub">No purchase necessary • +1.00 SC daily</div>
            </div>
          </button>
        </div>

        {promoStatus && (
          <p className={`promo-feedback ${promoStatus.type}`} role="status">
            {promoStatus.message}
          </p>
        )}

        <div className="playthrough-mini">
          <div className="playthrough-row">
            <span>Redeemable SC:</span>
            <strong>{Number(balance?.redeemableSC || 0).toFixed(2)} SC</strong>
          </div>
          <div className="playthrough-row muted">
            <span>Unplayed Bonus (1x rollover):</span>
            <span>{Number(balance?.unplayedSC || 0).toFixed(2)} SC</span>
          </div>
        </div>
      </div>

      <div className="drops-feed">
        <div className="feed-header">
          <h2 className="section-heading">
            <TrendingUp size={15} aria-hidden="true" /> RECENT NEWSROOM DROPS
          </h2>
          <span className="feed-count">{recentDrops.length}</span>
        </div>

        {recentDrops.length === 0 ? (
          <div className="empty-feed">
            Drop a puck to start making headlines. Press <kbd>Space</kbd> anytime!
          </div>
        ) : (
          <ul className="drop-list">
            {recentDrops.map((d) => {
              const char = MEME_CHARACTERS.find((c) => c.id === d.characterId) || MEME_CHARACTERS[0];
              const isHigh = d.maxMultiplier >= 2;
              return (
                <li key={d.dropId} className={`drop-item ${isHigh ? 'win-glow' : ''}`}>
                  <img src={char.image} alt={char.name} width={34} height={34} className="drop-thumb" />
                  <div className="drop-meta">
                    <div className="drop-top">
                      <strong>{char.shortName}</strong>
                      <span className={`mult-pill ${d.maxMultiplier >= 10 ? 'hot' : isHigh ? 'good' : ''}`}>
                        {d.maxMultiplier}x max
                      </span>
                    </div>
                    <div className="drop-bottom">
                      <span>
                        {d.ballCount}× {d.rows}R {d.risk}
                      </span>
                      <span className="drop-payout">
                        +{d.currencyMode === 'SC' ? Number(d.totalWin).toFixed(2) : Number(d.totalWin).toLocaleString()}{' '}
                        {d.currencyMode}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="verify-mini"
                    onClick={() => onOpenVerifyDrop(d)}
                    aria-label={`Verify provably fair drop nonce ${d.provablyFair?.nonce}`}
                    title="Verify Provably Fair"
                  >
                    <ShieldCheck size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
