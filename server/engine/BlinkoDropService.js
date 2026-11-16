import crypto from 'node:crypto';
import {
  BLINKO_ROWS,
  BLINKO_RISKS,
  BLINKO_BALL_COUNTS,
  BLINKO_MULTIPLIERS,
  BET_LIMITS,
  MEME_CHARACTERS,
  BOARD_NEWS_BUMPERS,
} from '../../src/config/blinkoConfig.js';
import { ServerWallet } from './ServerWallet.js';

export function hashSeed(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

export function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Unbiased provably fair bit-path generator using HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${ballIndex}`).
 * For rows <= 16, 32 digest bytes provide 256 unbiased cryptographic bits.
 */
export function deriveBallPath(serverSeed, clientSeed, nonce, ballIndex, rows) {
  const hmac = crypto
    .createHmac('sha256', String(serverSeed))
    .update(`${String(clientSeed)}:${Number(nonce)}:${Number(ballIndex)}`)
    .digest();
  const path = [];
  for (let r = 0; r < rows; r++) {
    const byteIdx = Math.floor(r / 8);
    const bitIdx = r % 8;
    const bit = (hmac[byteIdx] >> bitIdx) & 1;
    path.push(bit); // 0 = bounce left, 1 = bounce right
  }
  return path;
}

export class BlinkoDropService {
  constructor(wallet, ledger, store, options = {}) {
    this.wallet = wallet;
    this.ledger = ledger;
    this.store = store;
    const savedSeed = store?.get('meta', 'blinko_server_seed');
    this.serverSeed = options.serverSeed || savedSeed?.seed || generateServerSeed();
    if (store && !savedSeed) {
      store.put('meta', 'blinko_server_seed', { seed: this.serverSeed, updatedAt: new Date().toISOString() });
    }
    this.previousServerSeed = savedSeed?.previousServerSeed || null;
    this.previousServerSeedHash = savedSeed?.previousServerSeedHash || null;
    this.lastDropTimestamps = new Map();
  }

  getPublicCommitment() {
    return {
      serverSeedHash: hashSeed(this.serverSeed),
      algorithm: 'HMAC-SHA256',
      previousServerSeed: this.previousServerSeed,
      previousServerSeedHash: this.previousServerSeedHash,
    };
  }

  rotateServerSeed() {
    const revealedServerSeed = this.serverSeed;
    const revealedServerSeedHash = hashSeed(revealedServerSeed);
    this.previousServerSeed = revealedServerSeed;
    this.previousServerSeedHash = revealedServerSeedHash;
    this.serverSeed = generateServerSeed();
    if (this.store) {
      this.store.put('meta', 'blinko_server_seed', {
        seed: this.serverSeed,
        previousServerSeed: this.previousServerSeed,
        previousServerSeedHash: this.previousServerSeedHash,
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      revealedServerSeed,
      revealedServerSeedHash,
      newServerSeedHash: hashSeed(this.serverSeed),
      algorithm: 'HMAC-SHA256',
      rotatedAt: new Date().toISOString(),
    };
  }

  _simulateBall({ serverSeed, clientSeed, nonce, ballIndex, rows, risk, betPerBall, isSC }) {
    const path = deriveBallPath(serverSeed, clientSeed, nonce, ballIndex, rows);
    const bucketIndex = path.reduce((acc, b) => acc + b, 0);
    const table = BLINKO_MULTIPLIERS[rows]?.[risk];
    if (!table) throw new Error('Invalid rows or risk configuration.');
    const multiplier = table[bucketIndex];
    const payout = isSC
      ? ServerWallet.fromCents(Math.round(ServerWallet.toCents(betPerBall) * multiplier))
      : Math.round(betPerBall * multiplier);

    // Check if the ball passes near any of the 3 funny current-event news bumpers
    const bumperHits = [];
    let colPos = 0;
    for (let r = 0; r < rows; r++) {
      colPos += path[r];
      const relRow = (r + 1) / (rows + 1);
      for (const b of BOARD_NEWS_BUMPERS) {
        if (Math.abs(relRow - b.rowRatio) < 0.08) {
          const targetCol = Math.round((r + 1) * (0.5 + b.colOffset * 0.45));
          if (Math.abs(colPos - targetCol) <= 1) {
            const quip = b.quips[(nonce + ballIndex + r) % b.quips.length];
            bumperHits.push({ row: r, characterId: b.characterId, quip });
          }
        }
      }
    }

    return {
      ballIndex,
      path,
      bucketIndex,
      multiplier,
      payout,
      bumperHits,
    };
  }

  verifyDropOutcome({ serverSeed, clientSeed, nonce, rows = 12, risk = 'MEDIUM', ballCount = 1, betPerBall = 1, currencyMode = 'SC' }) {
    if (!serverSeed || !clientSeed || typeof Number(nonce) !== 'number' || !Number.isFinite(Number(nonce))) {
      throw new Error('serverSeed, clientSeed, and numeric nonce are required.');
    }
    const r = Number(rows);
    const rsk = String(risk || 'MEDIUM').toUpperCase();
    const count = Number(ballCount);
    if (!BLINKO_ROWS.includes(r)) throw new Error(`Rows must be one of: ${BLINKO_ROWS.join(', ')}`);
    if (!BLINKO_RISKS.includes(rsk)) throw new Error(`Risk must be one of: ${BLINKO_RISKS.join(', ')}`);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('ballCount must be 1-10');

    const seedToUse = serverSeed === 'ACTIVE_DEMO' ? this.serverSeed : String(serverSeed);
    const isSC = currencyMode === 'SC';
    const balls = [];
    let totalPayoutCentsOrGc = 0;

    for (let i = 0; i < count; i++) {
      const b = this._simulateBall({
        serverSeed: seedToUse,
        clientSeed,
        nonce: Number(nonce),
        ballIndex: i,
        rows: r,
        risk: rsk,
        betPerBall: Number(betPerBall),
        isSC,
      });
      balls.push(b);
      totalPayoutCentsOrGc += isSC ? ServerWallet.toCents(b.payout) : b.payout;
    }

    return {
      verified: true,
      serverSeedHash: hashSeed(seedToUse),
      clientSeed: String(clientSeed),
      nonce: Number(nonce),
      rows: r,
      risk: rsk,
      ballCount: count,
      balls,
      totalPayout: isSC ? ServerWallet.fromCents(totalPayoutCentsOrGc) : totalPayoutCentsOrGc,
      algorithm: 'HMAC-SHA256',
    };
  }

  executeDrop({
    userId,
    currencyMode = 'GC',
    betPerBall,
    rows = 12,
    risk = 'MEDIUM',
    ballCount = 1,
    characterId = 'polar_bear_2026',
    clientSeed,
  }) {
    if (!userId) throw new Error('Authentication required.');
    const now = Date.now();
    const last = this.lastDropTimestamps.get(userId) || 0;
    if (now - last < 50) {
      throw new Error('Drop cooldown active. Let the pucks breathe!');
    }
    this.lastDropTimestamps.set(userId, now);

    const mode = String(currencyMode || 'GC').toUpperCase();
    if (mode !== 'GC' && mode !== 'SC') throw new Error('currencyMode must be GC or SC.');

    const r = Number(rows);
    if (!BLINKO_ROWS.includes(r)) throw new Error(`Rows must be ${BLINKO_ROWS.join(', ')}.`);

    const rsk = String(risk || 'MEDIUM').toUpperCase();
    if (!BLINKO_RISKS.includes(rsk)) throw new Error(`Risk must be ${BLINKO_RISKS.join(', ')}.`);

    const count = Number(ballCount);
    if (!BLINKO_BALL_COUNTS.includes(count)) throw new Error(`ballCount must be ${BLINKO_BALL_COUNTS.join(', ')}.`);

    const isSC = mode === 'SC';
    const limits = BET_LIMITS[mode];
    const normalizedBet = isSC
      ? ServerWallet.fromCents(ServerWallet.toCents(betPerBall ?? limits.defaultBet))
      : Math.round(Number(betPerBall ?? limits.defaultBet));

    if (!Number.isFinite(normalizedBet) || normalizedBet < limits.min || normalizedBet > limits.max) {
      throw new Error(`Bet per ball for ${mode} must be between ${limits.min} and ${limits.max}.`);
    }

    const totalBet = isSC
      ? ServerWallet.fromCents(ServerWallet.toCents(normalizedBet) * count)
      : normalizedBet * count;

    const cSeed = clientSeed ? String(clientSeed).slice(0, 64) : crypto.randomBytes(12).toString('hex');
    const charValid = MEME_CHARACTERS.find((c) => c.id === characterId) || MEME_CHARACTERS[0];

    let dropOutcome = null;
    const settlement = this.wallet.settleDrop(userId, mode, totalBet, (nonce) => {
      const balls = [];
      let totalWinUnits = 0;
      let maxMultiplier = 0;
      for (let i = 0; i < count; i++) {
        const b = this._simulateBall({
          serverSeed: this.serverSeed,
          clientSeed: cSeed,
          nonce,
          ballIndex: i,
          rows: r,
          risk: rsk,
          betPerBall: normalizedBet,
          isSC,
        });
        balls.push(b);
        totalWinUnits += isSC ? ServerWallet.toCents(b.payout) : b.payout;
        if (b.multiplier > maxMultiplier) maxMultiplier = b.multiplier;
      }
      const winAmount = isSC ? ServerWallet.fromCents(totalWinUnits) : totalWinUnits;
      dropOutcome = {
        balls,
        maxMultiplier,
        winAmount,
      };
      return {
        winAmount,
        metadata: {
          game: 'BLINKO_HEADLINE_CHAOS_2026',
          rows: r,
          risk: rsk,
          ballCount: count,
          betPerBall: normalizedBet,
          characterId: charValid.id,
          maxMultiplier,
          buckets: balls.map((b) => b.bucketIndex),
          clientSeed: cSeed,
        },
      };
    });

    return {
      dropId: settlement.dropId,
      currencyMode: mode,
      rows: r,
      risk: rsk,
      ballCount: count,
      betPerBall: normalizedBet,
      totalBet,
      totalWin: settlement.winAmount,
      maxMultiplier: dropOutcome.maxMultiplier,
      characterId: charValid.id,
      balls: dropOutcome.balls,
      balance: settlement.account,
      provablyFair: {
        serverSeedHash: hashSeed(this.serverSeed),
        clientSeed: cSeed,
        nonce: settlement.nonce,
        algorithm: 'HMAC-SHA256',
      },
    };
  }
}
