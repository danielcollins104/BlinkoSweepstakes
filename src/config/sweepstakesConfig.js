// ============================================================================
// SWEEPSTAKES CASINO DUAL-CURRENCY ECONOMY MODEL (GC / SC)
// ============================================================================
// 1. Gold Coins (GC):
//    - Social fun-play currency only. Cannot be redeemed for cash or prizes.
//    - Purchased in packages or granted via Welcome / Daily Login / AMOE bonuses.
//
// 2. Sweeps Coins (SC):
//    - Promotional sweepstakes currency (1.00 SC = $1.00 USD prize value).
//    - NEVER sold directly. Always awarded as FREE promotional bonus entries
//      alongside Gold Coin purchases, Registration Welcome Grant, Daily Login,
//      or Alternative Method of Entry (AMOE).
//    - Subject to 1x playthrough requirement before becoming redeemable.
// ============================================================================

export const CASHTAG_HANDLE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CASHTAG) ||
  '$Daniel-Collins-168';

export const CRYPTO_WALLET_ADDRESSES = {
  BTC:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CRYPTO_WALLET_BTC) ||
    'bc1qwhnp4ylpv2h2q5x0rr9zm3zpwfcw3rtdmz4q4q',
  ETH:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CRYPTO_WALLET_ETH) ||
    '0x6258e488F97617cc103838746955CB81a1d3E3af',
  SOL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CRYPTO_WALLET_SOL) ||
    'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f',
  USDT_SOL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CRYPTO_WALLET_USDT_SOL) ||
    'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f',
  USDT_ERC20:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CRYPTO_WALLET_USDT_ERC20) ||
    '0x6258e488F97617cc103838746955CB81a1d3E3af',
};

export function getCashAppPaymentLink(priceUsd, orderRef = '', handle = CASHTAG_HANDLE) {
  const cleanHandle = String(handle || CASHTAG_HANDLE).startsWith('$')
    ? String(handle || CASHTAG_HANDLE)
    : `$${handle}`;
  const num = Number(priceUsd) || 0;
  const formatted = num % 1 === 0 ? num.toString() : num.toFixed(2);
  const base = `https://cash.app/${cleanHandle}/${formatted}`;
  return orderRef ? `${base}?note=${encodeURIComponent(orderRef)}` : base;
}

export const SWEEPSTAKES_CONFIG = {
  brandName: 'BLINKO: Headline Chaos 2026',
  cashtagHandle: CASHTAG_HANDLE,

  // Starting bankroll for registered players (guests receive GC only)
  defaultGoldCoins: 100000,
  defaultSweepsCoins: 10.0,
  minRedemptionSC: 50.0,
  minGiftCardRedemptionSC: 25.0,
  giftCardBonusRate: 0.05,
  playthroughRequirementMultiplier: 1.0,
  scUsdRate: 1.0,

  dailyReward: {
    goldCoins: 10000,
    sweepsCoins: 1.0,
    cooldownHours: 24,
  },

  amoeReward: {
    goldCoins: 5000,
    sweepsCoins: 1.0,
    cooldownHours: 24,
  },

  redemptionMethods: [
    {
      id: 'giftcard',
      label: 'Instant Digital Gift Card (+5% Bonus)',
      shortLabel: 'Gift Card (+5%)',
      minSC: 25.0,
      bonusRate: 0.05,
      eta: '5-15 Mins via Email',
      badge: '+5% EXTRA • $25 MIN',
    },
    {
      id: 'crypto',
      label: 'On-Chain Crypto Payout (USDT / SOL / ETH / BTC)',
      shortLabel: 'Crypto On-Chain',
      minSC: 50.0,
      bonusRate: 0,
      eta: 'Live On-Chain Settlement (0% Fee)',
      badge: 'FASTEST • 0% FEE',
    },
    {
      id: 'cashapp',
      label: 'Cash App ($Cashtag) Instant P2P',
      shortLabel: 'Cash App P2P',
      minSC: 50.0,
      bonusRate: 0,
      eta: 'Same-Day Direct Transfer',
      badge: 'DIRECT $CASHTAG',
    },
    {
      id: 'stripe_bank',
      label: 'Stripe Express Bank / Debit Payout',
      shortLabel: 'Stripe Bank',
      minSC: 50.0,
      bonusRate: 0,
      eta: 'Instant / 1-2 Business Days',
      badge: 'STRIPE CONNECT',
    },
  ],

  giftCardBrands: [
    { id: 'visa_virtual', name: 'Visa Virtual Prepaid Card', icon: '💳', bonusPct: 5 },
    { id: 'amazon', name: 'Amazon.com eGift Card', icon: '📦', bonusPct: 5 },
    { id: 'apple', name: 'Apple Gift Card', icon: '🍎', bonusPct: 5 },
    { id: 'doordash', name: 'DoorDash Airport Rescue Card', icon: '🍔', bonusPct: 5 },
  ],

  storePackages: [
    {
      id: 'pkg_couch_starter',
      tierTitle: 'Motorized Couch Commute Pack',
      headlineJoke: 'Cheaper than a North Carolina traffic ticket',
      priceUsd: 4.99,
      originalPriceUsd: 9.99,
      goldCoins: 15000,
      freeSweepsCoins: 5.0,
      badge: 'STARTER • 50% OFF',
      tagline: '15,000 GC + FREE 5.00 SC Bonus',
      accent: '#06b6d4',
    },
    {
      id: 'pkg_embassy_viral',
      tierTitle: 'Finland Embassy "Training Day" Bundle',
      headlineJoke: 'Closed for training, open for 10M views',
      priceUsd: 9.99,
      originalPriceUsd: 16.99,
      goldCoins: 35000,
      freeSweepsCoins: 10.5,
      badge: '+5% FREE SC',
      tagline: '35,000 GC + FREE 10.50 SC Bonus',
      accent: '#3b82f6',
    },
    {
      id: 'pkg_chipperty_popular',
      tierTitle: '7-Foot Lady Chipperty Nacho Vault',
      headlineJoke: 'Enough tortilla crunch to feed Mesa, AZ',
      priceUsd: 19.99,
      originalPriceUsd: 34.99,
      goldCoins: 85000,
      freeSweepsCoins: 22.0,
      popular: true,
      badge: 'MOST VIRAL • +10% SC',
      tagline: '85,000 GC + FREE 22.00 SC Bonus',
      accent: '#f59e0b',
    },
    {
      id: 'pkg_faa_margarita',
      tierTitle: 'FAA Ground Stop Airport Bar Tab',
      headlineJoke: 'Stranded at Gate B12? Drop 10 pucks.',
      priceUsd: 49.99,
      originalPriceUsd: 79.99,
      goldCoins: 250000,
      freeSweepsCoins: 55.0,
      badge: 'CASHOUT READY • +10% SC',
      tagline: '250,000 GC + FREE 55.00 SC Bonus',
      accent: '#ec4899',
    },
    {
      id: 'pkg_polar_prophecy',
      tierTitle: 'Remember Nov 2026 Prophecy Crate',
      headlineJoke: 'The AI polar bear foresaw this bankroll',
      priceUsd: 99.99,
      originalPriceUsd: 149.99,
      goldCoins: 600000,
      freeSweepsCoins: 115.0,
      badge: 'PROPHECY VIP • +15% SC',
      tagline: '600,000 GC + FREE 115.00 SC Bonus',
      accent: '#8b5cf6',
    },
    {
      id: 'pkg_whale_yacht',
      tierTitle: 'Yacht-Sinking Sperm Whale Hoard',
      headlineJoke: 'Cheeky wink. Billionaire hull insurance voided.',
      priceUsd: 249.99,
      originalPriceUsd: 375.0,
      goldCoins: 1750000,
      freeSweepsCoins: 295.0,
      badge: 'APEX WHALE • +18% SC',
      tagline: '1,750,000 GC + FREE 295.00 SC Bonus',
      accent: '#10b981',
    },
  ],

  highRollerPackages: [
    {
      id: 'pkg_hr_1000',
      tierTitle: 'Sleepy Jerry Applause Suite',
      headlineJoke: 'Polite human-hand cat claps for big ballers',
      priceUsd: 1000.0,
      originalPriceUsd: 1350.0,
      goldCoins: 8000000,
      freeSweepsCoins: 1180.0,
      badge: 'VIP STUDIO • +18% SC',
      tagline: '8,000,000 GC + FREE 1,180.00 SC',
      accent: '#f59e0b',
    },
    {
      id: 'pkg_hr_5000',
      tierTitle: 'Turnpike Road Shark Syndicate',
      headlineJoke: 'Jersey floodwater VIP lane clearance',
      priceUsd: 5000.0,
      originalPriceUsd: 6500.0,
      goldCoins: 50000000,
      freeSweepsCoins: 6000.0,
      popular: true,
      badge: 'SYNDICATE • +20% SC',
      tagline: '50,000,000 GC + FREE 6,000.00 SC',
      accent: '#06b6d4',
    },
    {
      id: 'pkg_hr_10000',
      tierTitle: 'Prime Time Election Bluenami Vault',
      headlineJoke: '24/7 cable news pundit scream multiplier',
      priceUsd: 10000.0,
      originalPriceUsd: 13500.0,
      goldCoins: 120000000,
      freeSweepsCoins: 12500.0,
      badge: 'ANCHOR DESK • +25% SC',
      tagline: '120,000,000 GC + FREE 12,500.00 SC',
      accent: '#ec4899',
    },
  ],
};

export function calculateCustomPackage(amountUsd) {
  const raw = Number(amountUsd);
  const num = Number(Math.max(1, Math.min(50000, Number.isFinite(raw) ? raw : 25)).toFixed(2));
  let bonusRate = 0;
  if (num >= 10000) bonusRate = 0.25;
  else if (num >= 5000) bonusRate = 0.20;
  else if (num >= 200) bonusRate = 0.18;
  else if (num >= 100) bonusRate = 0.15;
  else if (num >= 20) bonusRate = 0.10;
  else if (num >= 10) bonusRate = 0.05;

  const freeSweepsCoins = Number((num * (1 + bonusRate)).toFixed(2));
  const gcPerDollar = num >= 100 ? 6000 : num >= 20 ? 4250 : num >= 10 ? 3500 : 3000;
  const goldCoins = Math.round(num * gcPerDollar);
  const bonusPct = Math.round(bonusRate * 100);

  return {
    id: `pkg_custom_${num}`,
    tierTitle: `Custom Headline Bundle ($${num.toFixed(2)})`,
    headlineJoke: 'Build your own breaking-news bankroll',
    priceUsd: num,
    goldCoins,
    freeSweepsCoins,
    badge: bonusPct > 0 ? `CUSTOM • +${bonusPct}% SC` : 'CUSTOM BUNDLE',
    tagline: `${goldCoins.toLocaleString()} GC + FREE ${freeSweepsCoins.toFixed(2)} SC`,
    isCustom: true,
    accent: '#22d3ee',
  };
}
