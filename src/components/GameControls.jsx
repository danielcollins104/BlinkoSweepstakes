import React from 'react';
import { Shuffle, Zap, Play, Pause } from 'lucide-react';
import { MEME_CHARACTERS } from '../config/memeCast';

export default function GameControls({
  gameConfig,
  currencyMode,
  betPerBall,
  onChangeBet,
  rows,
  onChangeRows,
  risk,
  onChangeRisk,
  ballCount,
  onChangeBallCount,
  characterId,
  onChangeCharacter,
  autoDrop,
  onToggleAutoDrop,
  onDrop,
  busy,
  balance,
}) {
  const rowsList = gameConfig?.rows || [8, 12, 16];
  const risksList = gameConfig?.risks || ['LOW', 'MEDIUM', 'HIGH'];
  const ballCountsList = gameConfig?.ballCounts || [1, 3, 5, 10];
  const limits = gameConfig?.betLimits?.[currencyMode] || {
    min: currencyMode === 'SC' ? 0.1 : 10,
    max: currencyMode === 'SC' ? 500 : 1000000,
    presets: [],
  };

  const available = currencyMode === 'SC' ? Number(balance?.sweepsCoins || 0) : Number(balance?.goldCoins || 0);
  const totalBet = currencyMode === 'SC' ? Number((betPerBall * ballCount).toFixed(2)) : Math.round(betPerBall * ballCount);
  const activeChar = MEME_CHARACTERS.find((c) => c.id === characterId);

  const adjustBet = (factor) => {
    const raw = betPerBall * factor;
    const clamped = Math.max(limits.min, Math.min(limits.max, raw));
    onChangeBet(currencyMode === 'SC' ? Number(clamped.toFixed(2)) : Math.round(clamped));
  };

  const setMaxBet = () => {
    const perBall = available / ballCount;
    const clamped = Math.max(limits.min, Math.min(limits.max, perBall));
    onChangeBet(currencyMode === 'SC' ? Number((Math.floor(clamped * 100) / 100).toFixed(2)) : Math.floor(clamped));
  };

  return (
    <aside className="controls-panel" aria-label="Blinko bet and meme controls">
      <div className="panel-section">
        <div className="label-row">
          <label htmlFor="blinko-bet-input" className="control-label">
            Bet Per Puck ({currencyMode})
          </label>
          <span className="total-bet-readout">
            Total: <strong>{currencyMode === 'SC' ? `${totalBet.toFixed(2)} SC` : `${totalBet.toLocaleString()} GC`}</strong>
          </span>
        </div>

        <div className="bet-input-wrap">
          <input
            id="blinko-bet-input"
            type="number"
            min={limits.min}
            max={limits.max}
            step={currencyMode === 'SC' ? '0.10' : '10'}
            value={betPerBall}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) {
                onChangeBet(currencyMode === 'SC' ? Number(val.toFixed(2)) : Math.round(val));
              }
            }}
          />
          <div className="bet-mod-btns">
            <button type="button" onClick={() => adjustBet(0.5)} aria-label="Halve bet">
              ½
            </button>
            <button type="button" onClick={() => adjustBet(2)} aria-label="Double bet">
              2×
            </button>
            <button type="button" onClick={setMaxBet} aria-label="Set maximum affordable bet">
              MAX
            </button>
          </div>
        </div>

        <div className="preset-chips">
          {(limits.presets || []).map((p) => (
            <button
              key={p}
              type="button"
              className={`chip-btn ${Math.abs(betPerBall - p) < 0.001 ? 'active' : ''}`}
              onClick={() => onChangeBet(p)}
            >
              {currencyMode === 'SC' ? `${p.toFixed(2)} SC` : `${p.toLocaleString()} GC`}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-grid-2">
        <div className="panel-section">
          <span className="control-label" id="risk-group-label">
            News Volatility
          </span>
          <div className="segmented-group" role="group" aria-labelledby="risk-group-label">
            {risksList.map((r) => (
              <button
                key={r}
                type="button"
                className={risk === r ? 'active' : ''}
                onClick={() => onChangeRisk(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-section">
          <span className="control-label" id="rows-group-label">
            Peg Rows
          </span>
          <div className="segmented-group" role="group" aria-labelledby="rows-group-label">
            {rowsList.map((r) => (
              <button
                key={r}
                type="button"
                className={rows === r ? 'active' : ''}
                onClick={() => onChangeRows(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel-section">
        <span className="control-label" id="balls-group-label">
          Simultaneous Pucks
        </span>
        <div className="segmented-group" role="group" aria-labelledby="balls-group-label">
          {ballCountsList.map((cnt) => (
            <button
              key={cnt}
              type="button"
              className={ballCount === cnt ? 'active' : ''}
              onClick={() => onChangeBallCount(cnt)}
            >
              {cnt} {cnt === 1 ? 'Puck' : 'Pucks'}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="label-row">
          <span className="control-label">2026 Current-Event Puck Cast</span>
          <button
            type="button"
            className={`chaos-btn ${characterId === 'chaos' ? 'active' : ''}`}
            onClick={() => onChangeCharacter('chaos')}
          >
            <Shuffle size={13} aria-hidden="true" />
            <span>Chaos Mix</span>
          </button>
        </div>

        <div className="meme-grid" role="group" aria-label="Select funny 2026 meme puck">
          {MEME_CHARACTERS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`meme-card ${characterId === ch.id ? 'selected' : ''}`}
              style={{ '--ring': ch.ringColor }}
              onClick={() => onChangeCharacter(ch.id)}
              title={ch.headline}
              aria-pressed={characterId === ch.id}
            >
              <img src={ch.image} alt={ch.name} width={44} height={44} loading="lazy" />
              <span className="meme-short">{ch.shortName}</span>
            </button>
          ))}
        </div>

        <p className="meme-headline-caption">
          {activeChar ? (
            <>
              <strong>{activeChar.name}:</strong> {activeChar.headline}
            </>
          ) : (
            <>
              <strong>Chaos Mix:</strong> Every dropped puck randomly selects one of all 8 viral Nov 2026 news legends!
            </>
          )}
        </p>
      </div>

      <div className="drop-actions">
        <button
          type="button"
          className={`btn-drop ${currencyMode === 'SC' ? 'mode-sc' : 'mode-gc'}`}
          onClick={onDrop}
          disabled={busy}
        >
          <Zap size={20} aria-hidden="true" />
          <span>
            DROP {ballCount > 1 ? `${ballCount} PUCKS` : 'PUCK'} ({currencyMode})
          </span>
          <kbd>Space</kbd>
        </button>

        <button
          type="button"
          className={`btn-auto ${autoDrop ? 'running' : ''}`}
          onClick={onToggleAutoDrop}
          aria-pressed={autoDrop}
        >
          {autoDrop ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span>{autoDrop ? 'Stop Auto' : 'Auto-Drop'}</span>
        </button>
      </div>
    </aside>
  );
}
