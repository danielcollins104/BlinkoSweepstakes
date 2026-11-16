import React from 'react';
import { X, Scale } from 'lucide-react';
import { DEFAULT_RESTRICTED_STATES } from '../config/sweepstakesRulesClient';

export default function SweepstakesRulesModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card medium"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="rules-modal-title">
              <Scale size={20} className="inline-icon" aria-hidden="true" /> Official Sweepstakes Rules (GC / SC)
            </h2>
            <p className="modal-sub">NO PURCHASE NECESSARY TO ENTER OR WIN PRIZES.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close sweepstakes rules">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="rules-body">
          <h3>1. Dual-Currency Social Sweepstakes Model</h3>
          <p>
            <strong>Gold Coins (GC)</strong> are social entertainment tokens used exclusively for fun play. Gold Coins have
            zero monetary value and can never be redeemed for cash or prizes.
          </p>
          <p>
            <strong>Sweeps Coins (SC)</strong> are promotional sweepstakes entries. Sweeps Coins are NEVER sold directly;
            they are awarded strictly as a free promotional bonus alongside Gold Coin purchases, registration welcome
            grants (10.00 SC), daily login bonuses (1.00 SC), and the free Alternative Method of Entry (AMOE).
          </p>

          <h3>2. 1× Promotional Playthrough &amp; Prize Redemption</h3>
          <p>
            Each 1.00 redeemable SC equals <strong>$1.00 USD</strong> in prize value. Bonus SC must be played through
            <strong> 1×</strong> in SC mode before becoming eligible for prize redemption. Minimum redemption is{' '}
            <strong>25.00 SC</strong> for Instant Digital Gift Cards (with a <strong>+5% bonus</strong>) or{' '}
            <strong>50.00 SC</strong> for On-Chain Crypto, Cash App ($Cashtag), or Stripe Bank payouts.
          </p>

          <h3>3. Eligibility &amp; Restricted Jurisdictions</h3>
          <p>
            Open to legal US residents age 18+ (or 21+ where required by state law). Void where prohibited by law,
            including: <strong>{DEFAULT_RESTRICTED_STATES.join(', ')}</strong>. Identity verification (KYC) is required
            prior to first prize payout.
          </p>

          <h3>4. Free Alternative Method of Entry (AMOE)</h3>
          <p>
            Registered players can claim a free daily <strong>+1.00 SC + 5,000 GC</strong> entry directly inside the
            Newsroom sidebar with zero purchase required.
          </p>
        </div>
      </div>
    </div>
  );
}
