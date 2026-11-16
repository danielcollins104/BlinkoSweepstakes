import React from 'react';
import { Radio } from 'lucide-react';
import { BREAKING_NEWS_TICKER } from '../config/blinkoConfig';

export default function BreakingNewsTicker({ liveFlash }) {
  const items = liveFlash ? [liveFlash, ...BREAKING_NEWS_TICKER] : BREAKING_NEWS_TICKER;
  const repeated = [...items, ...items];

  return (
    <div className="ticker-bar" role="region" aria-label="Breaking news live ticker">
      <div className="ticker-badge">
        <Radio size={14} aria-hidden="true" />
        <span>LIVE HEADLINE WIRE</span>
      </div>
      <div className="ticker-viewport">
        <div className="ticker-track">
          {repeated.map((text, idx) => (
            <span key={idx} className="ticker-item">
              <span className="ticker-dot" aria-hidden="true">•</span>
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
