// ============================================================================
// BLINKO: HEADLINE CHAOS 2026 — GAME CONFIG, MULTIPLIERS & CURRENT EVENTS LORE
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

// 8 Hilarious Real Autumn / November 2026 Current-Event Meme Puck Characters
export const MEME_CHARACTERS = [
  {
    id: 'polar_bear_2026',
    name: 'Prophecy Bear',
    shortName: 'NOV 2026 Bear',
    headline: '2023 AI Polar Bear Prophecy Officially Fulfilled in Nov 2026',
    quip: '"Remember November 2026 is coming..." *drops straight into 0.2x*',
    image: '/assets/memes/polar_bear_2026.jpg',
    emoji: '🐻‍❄️',
    ringColor: '#ec4899',
    glowColor: 'rgba(236, 72, 153, 0.65)',
  },
  {
    id: 'lady_chipperty',
    name: 'Lady Chipperty',
    shortName: '7-Ft Dorito',
    headline: 'Arizona Mom Builds 7-Foot "Lady Chipperty" Out of Pure Doritos',
    quip: 'Nacho-cheese structural integrity holding steady at 1,000x!',
    image: '/assets/memes/lady_chipperty.jpg',
    emoji: '🧀',
    ringColor: '#f97316',
    glowColor: 'rgba(249, 115, 22, 0.65)',
  },
  {
    id: 'couch_commute',
    name: 'Highway Sofa',
    shortName: 'NC Couch Car',
    headline: 'NC Police Pull Over Two Men Driving a Motorized Living-Room Couch',
    quip: 'Officer, this sectional has cruise control AND cupholders.',
    image: '/assets/memes/couch_commute.jpg',
    emoji: '🛋️',
    ringColor: '#22d3ee',
    glowColor: 'rgba(34, 211, 238, 0.65)',
  },
  {
    id: 'nj_road_shark',
    name: 'NJ Road Shark',
    shortName: 'Flood Shark',
    headline: 'Surf City Floods Turn New Jersey Boulevard Into Shark Swim Lane',
    quip: 'Pay the Garden State Parkway toll or get nibbled!',
    image: '/assets/memes/nj_road_shark.jpg',
    emoji: '🦈',
    ringColor: '#3b82f6',
    glowColor: 'rgba(59, 130, 246, 0.65)',
  },
  {
    id: 'whale_vs_yacht',
    name: 'Captain Whale',
    shortName: 'Yacht Sinker',
    headline: 'Cheeky Sperm Whale Bonks & Sinks Billionaire Megayacht',
    quip: 'Right of way belongs to whoever weighs 45 tons, buddy.',
    image: '/assets/memes/whale_vs_yacht.jpg',
    emoji: '🐳',
    ringColor: '#0ea5e9',
    glowColor: 'rgba(14, 165, 233, 0.65)',
  },
  {
    id: 'faa_airport_bar',
    name: 'Gate B12 Survivor',
    shortName: 'FAA Margarita',
    headline: 'Historic FAA Nationwide Ground Stop Strands Flyers at Airport Bars',
    quip: 'Flight delayed 9 hours. Third Chili’s margarita unlocked.',
    image: '/assets/memes/faa_airport_bar.jpg',
    emoji: '🍹',
    ringColor: '#eab308',
    glowColor: 'rgba(234, 179, 8, 0.65)',
  },
  {
    id: 'finland_embassy',
    name: 'Finland Embassy',
    shortName: '10M Views Memo',
    headline: 'Finland Embassy "Closed for Staff Training" Post Goes Mega-Viral',
    quip: 'We literally just wanted to do a PowerPoint in peace.',
    image: '/assets/memes/finland_embassy.jpg',
    emoji: '🇫🇮',
    ringColor: '#a855f7',
    glowColor: 'rgba(168, 85, 247, 0.65)',
  },
  {
    id: 'sleepy_jerry',
    name: 'Sleepy Jerry',
    shortName: 'Clapping Cat',
    headline: 'Sleepy Jerry the Human-Hand Clapping Cat Peaks AI Brainrot Charts',
    quip: '*polite sleepy human-hand applause at 3 AM*',
    image: '/assets/memes/sleepy_jerry.jpg',
    emoji: '🐱',
    ringColor: '#10b981',
    glowColor: 'rgba(16, 185, 129, 0.65)',
  },
];

// Special Viral News Bumpers placed on the peg board (visual comedy landmarks)
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

export const BREAKING_NEWS_TICKER = [
  'BREAKING NOV 2026: "Remember November 2026" AI Polar Bear reportedly still singing Oliver Tree on loop near center 0.2x bucket...',
  'TRAFFIC ALERT: Two North Carolina legends pulled over commuting at 35 MPH on a floral living-room sectional sofa...',
  'WORLD NEWS: Embassy of Finland in Canberra accidentally achieves 10M global views by posting "Closed for staff training day"...',
  'WEATHER DESK: New Jersey drivers advised to yield to Great White Sharks swimming in left flooded lane on Surf City Ave...',
  'TRAVEL CHAOS: FAA orders historic nationwide ground stop; airport bar margarita stocks soar +420% in 45 minutes...',
  'ART BEAT: Mesa, Arizona mom unveils 7-foot "Lady Chipperty" statue built entirely out of Nacho Cheese Doritos...',
  'MARITIME REPORT: Smug sperm whale winks at coast guard after casually sinking billionaire megayacht with one tail slap...',
  'BRAINROT INDEX: "Sleepy Jerry" cat seen clapping politely with human hands every time a player hits 100x+ on High Risk...',
];

export function getBucketReaction(multiplier) {
  if (multiplier >= 100) return { label: 'MEGA VIRAL JACKPOT!', color: '#facc15', tier: 'jackpot' };
  if (multiplier >= 10) return { label: 'FRONT PAGE HEADLINE!', color: '#f97316', tier: 'big' };
  if (multiplier >= 2) return { label: 'TRENDING CLIP!', color: '#10b981', tier: 'nice' };
  if (multiplier >= 1) return { label: 'KEEP ROLLING', color: '#38bdf8', tier: 'even' };
  return { label: 'FAA GROUND STOP!', color: '#f43f5e', tier: 'oof' };
}
