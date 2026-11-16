// ============================================================================
// UI PRESENTATION CAST — MEME CHARACTERS, TICKER & REACTION LABELS ONLY
// ============================================================================
// All game math, multipliers, bet limits, store bundles, and wallet addresses
// live strictly on the server under server/config/.
// ============================================================================

export const MEME_CHARACTERS = [
  {
    id: 'polar_bear_2026',
    name: 'Prophecy Bear',
    shortName: 'NOV 2026 Bear',
    headline: '2023 AI Polar Bear Prophecy Officially Fulfilled in Nov 2026',
    quip: '"Remember November 2026 is coming..." *drops straight into 0x*',
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
    quip: 'Nacho-cheese structural integrity holding steady at 300x!',
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

export const BREAKING_NEWS_TICKER = [
  'BREAKING NOV 2026: "Remember November 2026" AI Polar Bear reportedly still singing Oliver Tree on loop near center 0x bucket...',
  'TRAFFIC ALERT: Two North Carolina legends pulled over commuting at 35 MPH on a floral living-room sectional sofa...',
  'WORLD NEWS: Embassy of Finland in Canberra accidentally achieves 10M global views by posting "Closed for staff training day"...',
  'WEATHER DESK: New Jersey drivers advised to yield to Great White Sharks swimming in left flooded lane on Surf City Ave...',
  'TRAVEL CHAOS: FAA orders historic nationwide ground stop; airport bar margarita stocks soar +420% in 45 minutes...',
  'ART BEAT: Mesa, Arizona mom unveils 7-foot "Lady Chipperty" statue built entirely out of Nacho Cheese Doritos...',
  'MARITIME REPORT: Smug sperm whale winks at coast guard after casually sinking billionaire megayacht with one tail slap...',
  'BRAINROT INDEX: "Sleepy Jerry" cat seen clapping politely with human hands every time a player hits 40x+ on High Risk...',
];

export function getBucketReaction(multiplier) {
  if (multiplier >= 100) return { label: 'MEGA VIRAL JACKPOT!', color: '#facc15', tier: 'jackpot' };
  if (multiplier >= 10) return { label: 'FRONT PAGE HEADLINE!', color: '#f97316', tier: 'big' };
  if (multiplier >= 2) return { label: 'TRENDING CLIP!', color: '#10b981', tier: 'nice' };
  if (multiplier >= 1) return { label: 'KEEP ROLLING', color: '#38bdf8', tier: 'even' };
  return { label: 'FAA GROUND STOP!', color: '#f43f5e', tier: 'oof' };
}
