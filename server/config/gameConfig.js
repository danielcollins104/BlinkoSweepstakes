// ============================================================================
// SERVER-AUTHORITATIVE BLINKO GAME CONFIG, MULTIPLIERS & BET LIMITS
// ============================================================================

export const BLINKO_ROWS = [8, 12, 16];
export const BLINKO_RISKS = ['LOW', 'MEDIUM', 'HIGH'];
export const BLINKO_BALL_COUNTS = [1, 3, 5, 10];

// Calibrated symmetric binomial multiplier tables (~30.0% theoretical RTP / ~70.0% house edge)
export const BLINKO_MULTIPLIERS = {
  8: {
    LOW: [2, 0.8, 0.4, 0.25, 0.14, 0.25, 0.4, 0.8, 2],
    MEDIUM: [5, 1.1, 0.4, 0.2, 0.06, 0.2, 0.4, 1.1, 5],
    HIGH: [9.6, 1.5, 0.4, 0.1, 0, 0.1, 0.4, 1.5, 9.6],
  },
  12: {
    LOW: [4, 1.2, 0.6, 0.4, 0.3, 0.3, 0.18, 0.3, 0.3, 0.4, 0.6, 1.2, 4],
    MEDIUM: [12, 3.5, 1.3, 0.6, 0.3, 0.2, 0.08, 0.2, 0.3, 0.6, 1.3, 3.5, 12],
    HIGH: [50, 8, 2.5, 0.6, 0.2, 0.09, 0, 0.09, 0.2, 0.6, 2.5, 8, 50],
  },
  16: {
    LOW: [8, 3, 1, 0.6, 0.45, 0.4, 0.3, 0.28, 0.18, 0.28, 0.3, 0.4, 0.45, 0.6, 1, 3, 8],
    MEDIUM: [40, 14, 3.5, 1.8, 0.9, 0.45, 0.25, 0.18, 0.07, 0.18, 0.25, 0.45, 0.9, 1.8, 3.5, 14, 40],
    HIGH: [300, 45, 9, 2.6, 1.1, 0.5, 0.12, 0.1, 0, 0.1, 0.12, 0.5, 1.1, 2.6, 9, 45, 300],
  },
};

export const BET_LIMITS = {
  GC: { min: 10, max: 1000000, step: 100, defaultBet: 500, presets: [100, 500, 2500, 10000] },
  SC: { min: 0.1, max: 500, step: 0.5, defaultBet: 1.0, presets: [0.25, 1.0, 5.0, 25.0] },
};

export const MEME_CHARACTER_IDS = [
  'polar_bear_2026',
  'lady_chipperty',
  'couch_commute',
  'nj_road_shark',
  'whale_vs_yacht',
  'faa_airport_bar',
  'finland_embassy',
  'sleepy_jerry',
];

export const BOARD_NEWS_BUMPERS = [
  {
    rowRatio: 0.32,
    colOffset: -0.25,
    characterId: 'finland_embassy',
    quips: ['CLOSED FOR TRAINING!', '10M VIEWS FOR NO REASON!', 'BRB TEAM BUILDING'],
  },
  {
    rowRatio: 0.56,
    colOffset: 0.35,
    characterId: 'couch_commute',
    quips: ['PULLED OVER ON I-40!', 'SOFA LANE MERGE!', 'RECLINER TURBO BOOST!'],
  },
  {
    rowRatio: 0.72,
    colOffset: -0.45,
    characterId: 'nj_road_shark',
    quips: ['EXIT 63 SHARK LANE!', 'E-ZPASS ACCEPTED!', 'FLOOD TIDE BOUNCE!'],
  },
];

export function publicBoardConfig() {
  return {
    rows: BLINKO_ROWS,
    risks: BLINKO_RISKS,
    ballCounts: BLINKO_BALL_COUNTS,
    multipliers: BLINKO_MULTIPLIERS,
    betLimits: BET_LIMITS,
    bumpers: BOARD_NEWS_BUMPERS,
  };
}
