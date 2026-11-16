import React, { useEffect, useRef, useState } from 'react';
import { MEME_CHARACTERS, getBucketReaction } from '../config/memeCast';
import { soundEngine } from '../audio/soundEngine';

const MAX_ACTIVE_BALLS = 30;
const MAX_PARTICLES = 160;
const SEGMENT_MS = 105; // crisp physics hop per peg row

function getBucketColor(mult) {
  if (mult === 0) return { bg: '#334155', border: '#64748b', text: '#cbd5e1' };
  if (mult >= 100) return { bg: '#facc15', border: '#fef08a', text: '#090d16' };
  if (mult >= 10) return { bg: '#f97316', border: '#fed7aa', text: '#090d16' };
  if (mult >= 2) return { bg: '#10b981', border: '#a7f3d0', text: '#052e16' };
  if (mult >= 1) return { bg: '#0ea5e9', border: '#bae6fd', text: '#082f49' };
  return { bg: '#e11d48', border: '#fda4af', text: '#ffffff' };
}

export default function BlinkoBoardCanvas({
  rows = 12,
  risk = 'MEDIUM',
  multipliers = {},
  bumpers = [],
  dropQueue = [],
  onBallLanded,
  onClearQueue,
}) {
  const canvasRef = useRef(null);
  const spritesRef = useRef({});
  const stateRef = useRef({
    balls: [],
    pegFlashes: new Map(),
    bucketHits: new Map(),
    particles: [],
    bubbles: [],
    rafId: null,
  });
  const [banner, setBanner] = useState(null);
  const bannerTimerRef = useRef(null);

  // Preload all 8 meme images once without blocking first paint
  useEffect(() => {
    MEME_CHARACTERS.forEach((char) => {
      if (spritesRef.current[char.id]) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = char.image;
      spritesRef.current[char.id] = img;
    });
  }, []);

  // Enqueue incoming server-resolved balls
  useEffect(() => {
    if (!dropQueue || dropQueue.length === 0) return;
    const st = stateRef.current;
    const now = performance.now();

    dropQueue.forEach((item, idx) => {
      if (st.balls.length >= MAX_ACTIVE_BALLS) {
        // Resolve oldest immediately to keep pool bounded & leak-free
        const dropped = st.balls.shift();
        if (dropped && !dropped.settled) {
          dropped.settled = true;
          onBallLanded?.(dropped.meta);
        }
      }
      st.balls.push({
        id: item.uid,
        path: item.path,
        rows: item.rows,
        bucketIndex: item.bucketIndex,
        multiplier: item.multiplier,
        character: MEME_CHARACTERS.find((c) => c.id === item.characterId) || MEME_CHARACTERS[0],
        startTime: now + idx * 85,
        lastRowTick: -1,
        angle: 0,
        spinSpeed: (idx % 2 === 0 ? 1 : -1) * 0.14,
        trail: [],
        settled: false,
        meta: item,
      });
    });

    onClearQueue?.();
  }, [dropQueue, onBallLanded, onClearQueue]);

  // Main animation loop with clean teardown
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const st = stateRef.current;

    const getBoardGeometry = (width, height) => {
      const topPad = 48;
      const bottomPad = 68;
      const usableH = height - topPad - bottomPad;
      const rowHeight = usableH / rows;
      const maxCols = rows + 2;
      const colSpacing = Math.min((width - 56) / maxCols, rowHeight * 1.18);
      const centerX = width / 2;
      const pegRadius = Math.max(3.2, Math.min(6, colSpacing * 0.14));
      const ballRadius = Math.max(8, Math.min(17, colSpacing * 0.36));

      const offsetToX = (offset) => centerX + offset * colSpacing;
      const rowToY = (r) => topPad + r * rowHeight;

      return { topPad, bottomPad, rowHeight, colSpacing, centerX, pegRadius, ballRadius, offsetToX, rowToY };
    };

    // Precompute 3 funny bumper pegs for current row count from server config
    const bumperCoords = (bumpers || []).map((b) => {
      const r = Math.max(2, Math.min(rows - 2, Math.round(rows * b.rowRatio)));
      const colFloat = r / 2 + b.colOffset * (r * 0.45);
      const c = Math.max(0, Math.min(r, Math.round(colFloat)));
      return {
        row: r,
        col: c,
        offset: c - r / 2,
        character: MEME_CHARACTERS.find((ch) => ch.id === b.characterId) || MEME_CHARACTERS[0],
        quips: b.quips,
      };
    });

    const renderFrame = (now) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(320, Math.round(rect.width * dpr));
      const targetH = Math.max(360, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const w = rect.width || 680;
      const h = rect.height || 540;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Subtle news-studio radial glow
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.35, 30, w / 2, h * 0.5, w * 0.72);
      bgGrad.addColorStop(0, 'rgba(30, 41, 59, 0.75)');
      bgGrad.addColorStop(1, 'rgba(7, 11, 20, 0.96)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      const geom = getBoardGeometry(w, h);

      // Draw pegs
      for (let r = 0; r < rows; r++) {
        const y = geom.rowToY(r);
        for (let c = -1; c <= r + 1; c++) {
          const offset = c - r / 2;
          const x = geom.offsetToX(offset);
          const key = `${r}:${c}`;
          const flashAt = st.pegFlashes.get(key) || 0;
          const flashAge = now - flashAt;
          const isFlashing = flashAge >= 0 && flashAge < 280;

          const bumper = bumperCoords.find((b) => b.row === r && b.col === c);

          if (isFlashing) {
            const p = 1 - flashAge / 280;
            ctx.beginPath();
            ctx.arc(x, y, geom.pegRadius + 10 * p, 0, Math.PI * 2);
            ctx.strokeStyle = bumper
              ? `rgba(250, 204, 21, ${0.85 * p})`
              : `rgba(34, 211, 238, ${0.75 * p})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          if (bumper) {
            const br = geom.pegRadius * 2.35;
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, br, 0, Math.PI * 2);
            ctx.fillStyle = bumper.character.ringColor;
            ctx.fill();
            ctx.clip();
            const sprite = spritesRef.current[bumper.character.id];
            if (sprite && sprite.complete && sprite.naturalWidth > 0) {
              ctx.drawImage(sprite, x - br, y - br, br * 2, br * 2);
            } else {
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(x - br, y - br, br * 2, br * 2);
              ctx.font = `${Math.round(br * 1.1)}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(bumper.character.emoji, x, y);
            }
            ctx.restore();
            ctx.beginPath();
            ctx.arc(x, y, br, 0, Math.PI * 2);
            ctx.strokeStyle = isFlashing ? '#facc15' : '#ffffff';
            ctx.lineWidth = isFlashing ? 2.5 : 1.5;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, geom.pegRadius, 0, Math.PI * 2);
            ctx.fillStyle = isFlashing ? '#22d3ee' : '#cbd5e1';
            ctx.fill();
          }
        }
      }

      // Draw bottom multiplier buckets from server config
      const mults = multipliers?.[rows]?.[risk] || [];
      const bucketY = geom.rowToY(rows) + 4;
      const bucketW = Math.max(16, geom.colSpacing * 0.88);
      const bucketH = Math.min(38, geom.bottomPad - 16);

      mults.forEach((m, bIdx) => {
        const offset = bIdx - rows / 2;
        const bx = geom.offsetToX(offset) - bucketW / 2;
        const hitAt = st.bucketHits.get(bIdx) || 0;
        const hitAge = now - hitAt;
        const dip = hitAge >= 0 && hitAge < 220 ? Math.sin((hitAge / 220) * Math.PI) * 6 : 0;
        const palette = getBucketColor(m);

        ctx.save();
        ctx.fillStyle = palette.bg;
        ctx.strokeStyle = hitAge < 260 ? '#ffffff' : palette.border;
        ctx.lineWidth = hitAge < 260 ? 2.2 : 1;
        ctx.beginPath();
        ctx.roundRect(bx, bucketY + dip, bucketW, bucketH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = palette.text;
        ctx.font = `800 ${rows >= 16 ? (m >= 100 ? 9 : 10) : 11}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = m >= 100 ? `${m}x` : `${m}x`;
        ctx.fillText(label, bx + bucketW / 2, bucketY + dip + bucketH / 2, Math.max(12, bucketW - 4));
        ctx.restore();
      });

      // Update & draw dropping meme balls
      const nextBalls = [];
      for (const ball of st.balls) {
        const elapsed = now - ball.startTime;
        if (elapsed < 0) {
          nextBalls.push(ball);
          continue;
        }

        const totalDuration = ball.rows * SEGMENT_MS;
        const progressRows = Math.min(ball.rows, elapsed / SEGMENT_MS);
        const segIdx = Math.min(ball.rows - 1, Math.floor(progressRows));
        const u = Math.min(1, progressRows - segIdx);

        // Trigger peg hit sound & flash when entering each new row
        if (segIdx > ball.lastRowTick && elapsed < totalDuration + 40) {
          ball.lastRowTick = segIdx;
          let curCol = 0;
          for (let r = 0; r < segIdx; r++) curCol += ball.path[r];
          st.pegFlashes.set(`${segIdx}:${curCol}`, now);

          const hitBumper = bumperCoords.find((b) => b.row === segIdx && Math.abs(b.col - curCol) <= 1);
          if (hitBumper) {
            st.pegFlashes.set(`${hitBumper.row}:${hitBumper.col}`, now);
            soundEngine.playPegBounce(segIdx / ball.rows, true);
            const quip = hitBumper.quips[(segIdx + ball.bucketIndex) % hitBumper.quips.length];
            st.bubbles.push({
              x: geom.offsetToX(hitBumper.offset),
              y: geom.rowToY(hitBumper.row) - 24,
              text: quip,
              born: now,
              color: hitBumper.character.ringColor,
            });
          } else {
            soundEngine.playPegBounce(segIdx / ball.rows, false);
          }
        }

        // Calculate continuous x,y position across parabolic hops
        let stepsBefore = 0;
        for (let r = 0; r < segIdx; r++) stepsBefore += ball.path[r];
        const stepsAfter = stepsBefore + (progressRows >= ball.rows ? 0 : ball.path[segIdx]);

        const offsetA = stepsBefore - segIdx / 2;
        const offsetB =
          progressRows >= ball.rows ? ball.bucketIndex - ball.rows / 2 : stepsAfter - (segIdx + 1) / 2;

        const xA = geom.offsetToX(offsetA);
        const yA = geom.rowToY(segIdx) - geom.pegRadius - geom.ballRadius * 0.4;
        const xB = geom.offsetToX(offsetB);
        const yB =
          progressRows >= ball.rows
            ? bucketY + 4
            : geom.rowToY(segIdx + 1) - geom.pegRadius - geom.ballRadius * 0.4;

        const easeX = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const x = progressRows >= ball.rows ? xB : xA + (xB - xA) * easeX;
        const bounceArc = progressRows >= ball.rows ? 0 : Math.sin(u * Math.PI) * (geom.rowHeight * 0.28);
        const y = progressRows >= ball.rows ? yB : yA + (yB - yA) * (u * u) - bounceArc;

        ball.angle += ball.spinSpeed;
        ball.trail.push({ x, y });
        if (ball.trail.length > 7) ball.trail.shift();

        // Draw neon speed trail
        for (let t = 0; t < ball.trail.length - 1; t++) {
          const pt = ball.trail[t];
          const alpha = ((t + 1) / ball.trail.length) * 0.35;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, geom.ballRadius * (0.4 + t * 0.06), 0, Math.PI * 2);
          ctx.fillStyle = ball.character.glowColor.replace(/[\d.]+\)$/, `${alpha})`);
          ctx.fill();
        }

        // Draw circular meme puck
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ball.angle);
        ctx.beginPath();
        ctx.arc(0, 0, geom.ballRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.clip();

        const sprite = spritesRef.current[ball.character.id];
        if (sprite && sprite.complete && sprite.naturalWidth > 0) {
          ctx.drawImage(sprite, -geom.ballRadius, -geom.ballRadius, geom.ballRadius * 2, geom.ballRadius * 2);
        } else {
          ctx.font = `${Math.round(geom.ballRadius * 1.25)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ball.character.emoji, 0, 1);
        }
        ctx.restore();

        // Crisp neon outer rim
        ctx.beginPath();
        ctx.arc(x, y, geom.ballRadius, 0, Math.PI * 2);
        ctx.strokeStyle = ball.character.ringColor;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        if (elapsed >= totalDuration) {
          if (!ball.settled) {
            ball.settled = true;
            st.bucketHits.set(ball.bucketIndex, now);
            soundEngine.playBucketLand(ball.multiplier);
            onBallLanded?.(ball.meta);

            // Spawn celebration confetti particles on >= 2x hits
            if (ball.multiplier >= 2 && st.particles.length < MAX_PARTICLES) {
              const burstCount = ball.multiplier >= 25 ? 28 : 12;
              const palette = ['#facc15', '#ec4899', '#22d3ee', '#10b981', '#ffffff'];
              for (let p = 0; p < burstCount; p++) {
                const ang = -Math.PI * Math.random();
                const spd = 2 + Math.random() * 4.5;
                st.particles.push({
                  x: xB,
                  y: bucketY,
                  vx: Math.cos(ang) * spd,
                  vy: Math.sin(ang) * spd - 1.5,
                  size: 3 + Math.random() * 4,
                  color: palette[p % palette.length],
                  born: now,
                });
              }
            }

            if (ball.multiplier >= 10) {
              const react = getBucketReaction(ball.multiplier);
              setBanner({
                title: react.label,
                mult: `${ball.multiplier}x`,
                winText: `${ball.meta.payout} ${ball.meta.currencyMode}`,
                charName: ball.character.name,
                color: react.color,
              });
              if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
              bannerTimerRef.current = setTimeout(() => setBanner(null), 2400);
            }
          }
        } else {
          nextBalls.push(ball);
        }
      }
      st.balls = nextBalls;

      // Update & draw confetti particles
      const aliveParticles = [];
      for (const p of st.particles) {
        const age = now - p.born;
        if (age > 900) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.16;
        ctx.globalAlpha = 1 - age / 900;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
        ctx.globalAlpha = 1;
        aliveParticles.push(p);
      }
      st.particles = aliveParticles;

      // Draw funny comic quip speech bubbles on bumper hits
      const aliveBubbles = [];
      for (const b of st.bubbles) {
        const age = now - b.born;
        if (age > 1350) continue;
        const alpha = age < 950 ? 1 : 1 - (age - 950) / 400;
        const lift = (age / 1350) * 18;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '700 11px system-ui, sans-serif';
        const tw = ctx.measureText(b.text).width + 18;
        const bx = Math.max(12, Math.min(w - tw - 12, b.x - tw / 2));
        const by = Math.max(14, b.y - lift);
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, 24, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.text, bx + tw / 2, by + 12);
        ctx.restore();
        aliveBubbles.push(b);
      }
      st.bubbles = aliveBubbles;

      ctx.restore();
      st.rafId = requestAnimationFrame(renderFrame);
    };

    st.rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (st.rafId) cancelAnimationFrame(st.rafId);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      st.balls = [];
      st.particles = [];
      st.bubbles = [];
    };
  }, [rows, risk, multipliers, bumpers, onBallLanded]);

  return (
    <section className="board-stage" aria-label="Blinko game board">
      <div className="board-header-strip">
        <span className="board-pill">
          <strong>{rows} ROWS</strong> • <strong>{risk} VOLATILITY</strong>
        </span>
        <span className="board-pill subtle">
          3 LIVE MEME BUMPERS ON BOARD
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="blinko-canvas"
        aria-label="Interactive Blinko Plinko board canvas"
      />

      {banner && (
        <div className="jackpot-banner" style={{ borderColor: banner.color }} role="status" aria-live="polite">
          <span className="jackpot-mult" style={{ color: banner.color }}>
            {banner.mult}
          </span>
          <div>
            <div className="jackpot-title">{banner.title}</div>
            <div className="jackpot-sub">
              {banner.charName} won <strong>+{banner.winText}</strong>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
