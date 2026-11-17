import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BLINKO_MULTIPLIERS, BLINKO_ROWS, BLINKO_RISKS } from '../server/config/gameConfig.js';
import { ApiRouter } from '../server/apiRouter.js';
import { openDefaultSqliteStore } from '../server/store/nodeSqlite.js';
import { PriceOracle, parseDisplayUnits, displayToChainUnits, getAsset } from '../server/payments/cryptoAssets.js';
import { CryptoVerifier } from '../server/payments/cryptoVerifier.js';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function nCk(n, k) {
  let num = 1n;
  let den = 1n;
  for (let i = 1; i <= k; i++) {
    num *= BigInt(n - (k - i));
    den *= BigInt(i);
  }
  return Number(num / den);
}

function extractCookie(res, name) {
  const raw = res.headers['Set-Cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  return hit.split(';')[0];
}

// 1. Binomial RTP verification across all 9 tables (~30.0%)
await test('Binomial RTP is calibrated at ~30.0% across all 9 tables', () => {
  for (const rows of BLINKO_ROWS) {
    const totalPaths = 2 ** rows;
    for (const risk of BLINKO_RISKS) {
      const mults = BLINKO_MULTIPLIERS[rows][risk];
      assert.equal(mults.length, rows + 1);
      let ev = 0;
      for (let k = 0; k <= rows; k++) {
        assert.equal(mults[k], mults[rows - k], `Symmetric multipliers for ${rows}R ${risk}`);
        ev += (nCk(rows, k) / totalPaths) * mults[k];
      }
      assert.ok(ev >= 0.298 && ev <= 0.302, `Expected EV in [0.298, 0.302], got ${ev.toFixed(4)} for ${rows}R ${risk}`);
    }
  }
});

// 2. Client-Side Source Audit: Zero sensitive logic, multipliers, RNG, or wallet addresses in src/
await test('Client-side src/ contains zero game math, RNG, wallet addresses, or secrets', () => {
  const srcDir = path.resolve(process.cwd(), 'src');
  const walk = (dir) => {
    let out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out = out.concat(walk(full));
      else if (/\.(js|jsx|ts|tsx)$/.test(ent.name)) out.push(full);
    }
    return out;
  };
  const files = walk(srcDir);
  assert.ok(files.length >= 10);
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(!code.includes('createHmac'), `No HMAC RNG on client: ${file}`);
    assert.ok(!code.includes('BLINKO_MULTIPLIERS'), `No multiplier table hardcoded on client: ${file}`);
    assert.ok(!code.includes('bc1qwhnp4ylpv2h2q5x0rr9zm3zpwfcw3rtdmz4q4q'), `No BTC wallet in client: ${file}`);
    assert.ok(!code.includes('0x6258e488F97617cc103838746955CB81a1d3E3af'), `No ETH wallet in client: ${file}`);
    assert.ok(!code.includes('Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f'), `No SOL wallet in client: ${file}`);
    assert.ok(!code.includes('Daniel-Collins-168'), `No Cashtag hardcoded in client: ${file}`);
    assert.ok(!code.includes('DC_ADMIN_SECRET ==='), `No admin secret comparison in client: ${file}`);
  }
});

// 3. Full End-to-End Security Boundaries + Red-Team Anti-Hack + All 5 Crypto Rails + Cash App Purchases
await test('Full Security Boundaries + Anti-Hack Red Team + All Crypto & Cash App Test Purchases', async () => {
  const tmpDb = path.join(os.tmpdir(), `blinko_test_${Date.now()}.sqlite`);
  const sqlStore = await openDefaultSqliteStore(tmpDb);

  const mockOracle = new PriceOracle({ allowFallback: false });
  mockOracle.cache.set('USD', { price: 1, at: Date.now(), sources: ['peg'] });
  mockOracle.cache.set('SOL', { price: 200, at: Date.now(), sources: ['coinbase', 'kraken'] });
  mockOracle.cache.set('ETH', { price: 3200, at: Date.now(), sources: ['coinbase', 'kraken'] });
  mockOracle.cache.set('BTC', { price: 96000, at: Date.now(), sources: ['coinbase', 'kraken'] });

  const mockVerifier = {
    async verifyTransfer({ asset, txHash }) {
      if (txHash === 'bad_tx') return { found: false, amountRaw: 0n, confirmations: 0 };
      if (txHash === 'reverted_tx') return { found: true, success: false, amountRaw: 0n, confirmations: 0, error: 'Transaction reverted' };
      const expectedUnits = this._nextAmountUnits ?? 0n;
      const blockTime = this._nextBlockTime ?? Math.floor(Date.now() / 1000);
      const confirmations = this._nextConfirmations ?? 32;
      return {
        found: true,
        success: true,
        amountRaw: displayToChainUnits(expectedUnits, asset),
        confirmations,
        blockTime,
      };
    },
  };

  let lastStripeBody = '';
  const mockStripeFetch = async (url, init) => {
    if (url.endsWith('/checkout/sessions') && init.method === 'POST') {
      lastStripeBody = String(init.body || '');
      return new Response(
        JSON.stringify({ id: 'cs_test_12345', url: 'https://checkout.stripe.com/pay/cs_test_12345' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/checkout/sessions/cs_test_12345')) {
      return new Response(
        JSON.stringify({ id: 'cs_test_12345', payment_status: 'paid' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.endsWith('/transfers')) {
      return new Response(JSON.stringify({ id: 'tr_live_98765' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: 'Unexpected URL' } }), { status: 404 });
  };

  // Verify weak placeholder DC_ADMIN_SECRET is rejected
  const weakRouter = new ApiRouter({
    env: { DC_ADMIN_SECRET: 'change-this-admin-secret' },
  });
  const weakAdminTry = await weakRouter.handleRequest(
    'POST',
    '/api/admin/login',
    { 'x-requested-with': 'BlinkoClient' },
    { adminKey: 'change-this-admin-secret' }
  );
  assert.equal(weakAdminTry.status, 400);

  const router = new ApiRouter({
    store: sqlStore,
    env: {
      DC_ADMIN_SECRET: 'test-operator-secret-strong',
      STRIPE_SECRET_KEY: 'sk_test_mock_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      PUBLIC_ORIGIN: 'https://blinkosweepstakes.oopsiwon.com',
      CASHTAG: '$Daniel-Collins-168',
    },
    priceOracle: mockOracle,
    verifier: mockVerifier,
    fetchImpl: mockStripeFetch,
  });

  const csrf = { 'x-requested-with': 'BlinkoClient' };

  // Unauthenticated /api/payments/config MUST NOT leak wallet addresses or $Cashtag
  const pubPay = await router.handleRequest('GET', '/api/payments/config', {});
  assert.equal(pubPay.status, 200);
  const pubJson = JSON.stringify(pubPay.body);
  assert.equal(pubPay.body.cashApp.cashtag, undefined);
  assert.ok(!pubJson.includes('Daniel-Collins'));
  assert.ok(!pubJson.includes('bc1qwhnp'));
  assert.ok(!pubJson.includes('Ejj7hyeP'));

  // /api/game/config & /api/game/custom-package return server-calculated bundles
  const gameCfg = await router.handleRequest('GET', '/api/game/config', {});
  assert.equal(gameCfg.status, 200);
  assert.ok(gameCfg.body.multipliers['16'].HIGH);
  assert.ok(gameCfg.body.storePackages.length >= 6);

  const customPkgRes = await router.handleRequest('GET', '/api/game/custom-package', {}, {}, {
    query: new URLSearchParams({ amountUsd: '100' }),
  });
  assert.equal(customPkgRes.status, 200);
  assert.equal(customPkgRes.body.package.priceUsd, 100);
  assert.equal(customPkgRes.body.package.freeSweepsCoins, 115);

  // Anti-Hack: CSRF header missing -> 403
  const csrfBlocked = await router.handleRequest('POST', '/api/auth/guest', {}, {});
  assert.equal(csrfBlocked.status, 403);

  // Anti-Hack: Cross-Origin POST with spoofed header -> 403
  const crossSiteBlocked = await router.handleRequest(
    'POST',
    '/api/auth/guest',
    { ...csrf, origin: 'https://evil-hacker.com', host: 'localhost:3002', 'sec-fetch-site': 'cross-site' },
    {}
  );
  assert.equal(crossSiteBlocked.status, 403);

  // Anti-Hack: Non-object JSON bodies (arrays/primitives) -> 400
  const arrayBodyBlocked = await router.handleRequest('POST', '/api/auth/guest', csrf, '["hack"]');
  assert.equal(arrayBodyBlocked.status, 400);

  // Guest session issued strictly via HttpOnly; SameSite=Strict cookie (no token in JSON body)
  const guestRes = await router.handleRequest('POST', '/api/auth/guest', csrf);
  assert.equal(guestRes.status, 200);
  assert.equal(guestRes.body.token, undefined);
  const guestCookie = extractCookie(guestRes, 'blk_session');
  assert.ok(guestCookie && guestRes.headers['Set-Cookie'][0].includes('HttpOnly'));
  assert.ok(guestRes.headers['Set-Cookie'][0].includes('SameSite=Strict'));
  assert.equal(guestRes.body.balance.goldCoins, 100000);
  assert.equal(guestRes.body.balance.sweepsCoins, 0);

  const guestScBlocked = await router.handleRequest(
    'POST',
    '/api/drop',
    { ...csrf, cookie: guestCookie },
    { currencyMode: 'SC', betPerBall: 1, rows: 12, risk: 'MEDIUM', ballCount: 1 }
  );
  assert.equal(guestScBlocked.status, 401);

  // Register player -> HttpOnly cookie + 100,000 GC + 10.00 SC (unplayed)
  const reg = await router.handleRequest(
    'POST',
    '/api/auth/register',
    csrf,
    { email: 'player@blinko.test', password: 'Password123!', name: 'CouchDriver' }
  );
  assert.equal(reg.status, 201);
  assert.equal(reg.body.token, undefined);
  const playerCookie = extractCookie(reg, 'blk_session');
  assert.ok(playerCookie);
  assert.equal(reg.body.balance.sweepsCoins, 10);
  assert.equal(reg.body.balance.unplayedSC, 10);
  assert.equal(reg.body.balance.redeemableSC, 0);

  // Anti-Hack: Duplicate email registration blocked
  const dupEmail = await router.handleRequest(
    'POST',
    '/api/auth/register',
    csrf,
    { email: 'PLAYER@blinko.test', password: 'Password123!', name: 'Clone' }
  );
  assert.equal(dupEmail.status, 400);

  // Anti-Hack: Sybil multi-account welcome-SC farming from public IP capped at 2 accounts
  const sybilIp = '203.0.113.77';
  const syb1 = await router.handleRequest('POST', '/api/auth/register', csrf, { email: 's1@test.com', password: 'Password123!' }, { ip: sybilIp });
  const syb2 = await router.handleRequest('POST', '/api/auth/register', csrf, { email: 's2@test.com', password: 'Password123!' }, { ip: sybilIp });
  const syb3 = await router.handleRequest('POST', '/api/auth/register', csrf, { email: 's3@test.com', password: 'Password123!' }, { ip: sybilIp });
  assert.equal(syb1.body.balance.sweepsCoins, 10);
  assert.equal(syb2.body.balance.sweepsCoins, 10);
  assert.equal(syb3.body.balance.sweepsCoins, 0, '3rd account from same IP gets 0 free welcome SC');

  // Anti-Hack: Object coercion / prototype tricks on /api/drop & /api/auth/login rejected cleanly
  const coercionDrop = await router.handleRequest(
    'POST',
    '/api/drop',
    { ...csrf, cookie: playerCookie },
    { currencyMode: 'SC', betPerBall: { toString: 123 }, rows: 12, risk: 'LOW', ballCount: 1 }
  );
  assert.equal(coercionDrop.status, 400);

  const negativeBet = await router.handleRequest(
    'POST',
    '/api/drop',
    { ...csrf, cookie: playerCookie },
    { currencyMode: 'SC', betPerBall: -50, rows: 12, risk: 'LOW', ballCount: 1 }
  );
  assert.equal(negativeBet.status, 400);

  // Anti-Hack: Client trying to inject fake winAmount / multiplier / nonce in /api/drop is ignored
  const drop = await router.handleRequest(
    'POST',
    '/api/drop',
    { ...csrf, cookie: playerCookie },
    {
      currencyMode: 'SC',
      betPerBall: 1,
      rows: 12,
      risk: 'LOW',
      ballCount: 10,
      clientSeed: 'myseed123',
      winAmount: 999999,
      multiplier: 300,
      nonce: 999,
    }
  );
  assert.equal(drop.status, 200);
  assert.equal(drop.body.provablyFair.nonce, 1, 'Server strictly controls monotonic nonce');
  assert.equal(drop.body.balls.length, 10);
  assert.equal(drop.body.balance.unplayedSC, 0);
  assert.ok(drop.body.totalWin < 100, 'Client-injected winAmount completely ignored');

  // Security: ACTIVE_DEMO oracle MUST be rejected!
  const activeDemoBlocked = await router.handleRequest(
    'POST',
    '/api/provably-fair/verify',
    csrf,
    { serverSeed: 'ACTIVE_DEMO', clientSeed: 'myseed123', nonce: drop.body.provablyFair.nonce }
  );
  assert.equal(activeDemoBlocked.status, 400);

  // Rotate user's own seed -> reveal previous seed -> verify prior drop deterministically
  const rotated = await router.handleRequest('POST', '/api/provably-fair/rotate', { ...csrf, cookie: playerCookie });
  assert.equal(rotated.status, 200);
  assert.match(rotated.body.revealedServerSeed, /^[0-9a-f]{64}$/);

  const verify = await router.handleRequest('POST', '/api/provably-fair/verify', csrf, {
    serverSeed: rotated.body.revealedServerSeed,
    clientSeed: 'myseed123',
    nonce: drop.body.provablyFair.nonce,
    rows: 12,
    risk: 'LOW',
    ballCount: 10,
    betPerBall: 1,
    currencyMode: 'SC',
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.totalPayout, drop.body.totalWin);

  // Claim Daily & AMOE once; second claim same day returns 409
  const daily1 = await router.handleRequest('POST', '/api/promotions/daily', { ...csrf, cookie: playerCookie });
  assert.equal(daily1.status, 200);
  const daily2 = await router.handleRequest('POST', '/api/promotions/daily', { ...csrf, cookie: playerCookie });
  assert.equal(daily2.status, 409);

  const amoe1 = await router.handleRequest('POST', '/api/promotions/amoe', { ...csrf, cookie: playerCookie });
  assert.equal(amoe1.status, 200);
  const amoe2 = await router.handleRequest('POST', '/api/promotions/amoe', { ...csrf, cookie: playerCookie });
  assert.equal(amoe2.status, 409);

  // =========================================================================
  // TEST PURCHASES: ALL 5 LIVE CRYPTO RAILS (USDT_SOL, SOL, USDT_ERC20, ETH, BTC)
  // =========================================================================
  const cryptoTestCases = [
    {
      asset: 'USDT_SOL',
      pkg: 'pkg_couch_starter',
      txHash: '5xValidSolanaSig1111111111111111111111111111111111111111111111111111',
      uriPrefix: 'solana:Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f?amount=',
    },
    {
      asset: 'SOL',
      pkg: 'pkg_embassy_viral',
      txHash: '3kValidSolanaSig2222222222222222222222222222222222222222222222222222',
      uriPrefix: 'solana:Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f?amount=',
    },
    {
      asset: 'USDT_ERC20',
      pkg: 'pkg_chipperty_popular',
      txHash: '0x' + 'a'.repeat(64),
      uriPrefix: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7@1/transfer?address=0x6258e488F97617cc103838746955CB81a1d3E3af&uint256=',
    },
    {
      asset: 'ETH',
      pkg: 'pkg_faa_margarita',
      txHash: '0x' + 'b'.repeat(64),
      uriPrefix: 'ethereum:0x6258e488F97617cc103838746955CB81a1d3E3af@1?value=',
    },
    {
      asset: 'BTC',
      pkg: 'pkg_polar_prophecy',
      txHash: 'c'.repeat(64),
      uriPrefix: 'bitcoin:bc1qwhnp4ylpv2h2q5x0rr9zm3zpwfcw3rtdmz4q4q?amount=',
    },
  ];

  for (const tc of cryptoTestCases) {
    const depCreate = await router.handleRequest(
      'POST',
      '/api/deposits/crypto',
      { ...csrf, cookie: playerCookie },
      { packageId: tc.pkg, asset: tc.asset }
    );
    assert.equal(depCreate.status, 201, `Crypto quote creation for ${tc.asset}`);
    const deposit = depCreate.body.deposit;
    assert.ok(deposit.walletUri.startsWith(tc.uriPrefix), `Valid wallet URI for ${tc.asset}: ${deposit.walletUri}`);
    if (tc.asset === 'ETH' || tc.asset === 'USDT_ERC20') {
      assert.ok(!deposit.walletUri.includes('.'), `Integer atomic units in EIP-681 URI: ${deposit.walletUri}`);
    }

    const assetObj = getAsset(tc.asset);
    mockVerifier._nextAmountUnits = parseDisplayUnits(deposit.amount, assetObj.displayDecimals);
    mockVerifier._nextConfirmations = assetObj.minConfirmations;
    mockVerifier._nextBlockTime = Math.floor(Date.now() / 1000);

    const depSubmit = await router.handleRequest(
      'POST',
      '/api/deposits/crypto/submit',
      { ...csrf, cookie: playerCookie },
      { depositId: deposit.id, txHash: tc.txHash }
    );
    assert.equal(depSubmit.status, 200);
    assert.equal(depSubmit.body.credited, true, `Auto-credited ${tc.asset} test purchase`);
  }

  // Anti-Hack: Replaying an already-claimed txHash on a new deposit MUST be blocked!
  const replayQuote = await router.handleRequest(
    'POST',
    '/api/deposits/crypto',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_couch_starter', asset: 'USDT_SOL' }
  );
  const replaySubmit = await router.handleRequest(
    'POST',
    '/api/deposits/crypto/submit',
    { ...csrf, cookie: playerCookie },
    { depositId: replayQuote.body.deposit.id, txHash: cryptoTestCases[0].txHash }
  );
  assert.equal(replaySubmit.status, 400, 'Replayed blockchain txHash blocked');

  // Anti-Hack: Underpayment (50% of expected amount) MUST NOT auto-credit -> needs_review
  const underpayQuote = await router.handleRequest(
    'POST',
    '/api/deposits/crypto',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_faa_margarita', asset: 'USDT_SOL' }
  );
  const fullUnits = parseDisplayUnits(underpayQuote.body.deposit.amount, 6);
  mockVerifier._nextAmountUnits = fullUnits / 2n;
  const underpaySubmit = await router.handleRequest(
    'POST',
    '/api/deposits/crypto/submit',
    { ...csrf, cookie: playerCookie },
    { depositId: underpayQuote.body.deposit.id, txHash: '7zUnderpaidTxSig333333333333333333333333333333333333333333333333333' }
  );
  assert.equal(underpaySubmit.body.credited, false);
  assert.equal(underpaySubmit.body.deposit.status, 'needs_review');

  // Anti-Hack: Expired volatile crypto quote (>60 mins old + late blockTime) MUST NOT auto-credit -> needs_review
  const expQuote = await router.handleRequest(
    'POST',
    '/api/deposits/crypto',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_embassy_viral', asset: 'BTC' }
  );
  const storedExp = sqlStore.get('deposits', expQuote.body.deposit.id);
  storedExp.expiresAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  sqlStore.put('deposits', storedExp.id, storedExp);
  mockVerifier._nextAmountUnits = parseDisplayUnits(expQuote.body.deposit.amount, 8);
  mockVerifier._nextConfirmations = 2;
  mockVerifier._nextBlockTime = Math.floor(Date.now() / 1000);
  const expSubmit = await router.handleRequest(
    'POST',
    '/api/deposits/crypto/submit',
    { ...csrf, cookie: playerCookie },
    { depositId: storedExp.id, txHash: 'e'.repeat(64) }
  );
  assert.equal(expSubmit.body.credited, false);
  assert.equal(expSubmit.body.deposit.status, 'needs_review', 'Late BTC transfer on expired quote flagged for review');

  // Admin Login -> HttpOnly; Path=/api/admin cookie (no token in JSON)
  const admLogin = await router.handleRequest('POST', '/api/admin/login', csrf, {
    adminKey: 'test-operator-secret-strong',
  });
  assert.equal(admLogin.status, 200);
  assert.equal(admLogin.body.token, undefined);
  const adminCookie = extractCookie(admLogin, 'blk_admin');
  assert.ok(adminCookie && admLogin.headers['Set-Cookie'][0].includes('Path=/api/admin'));

  // Player session cookie is ignored on /api/admin/ (401) and forged blk_admin with player token fails RBAC (403)
  const privEscNoAdmin = await router.handleRequest('GET', '/api/admin/summary', { cookie: playerCookie });
  assert.equal(privEscNoAdmin.status, 401);
  const forgedAdminCookie = playerCookie.replace(/^blk_session=/, 'blk_admin=');
  const privEscRbac = await router.handleRequest('GET', '/api/admin/summary', { cookie: forgedAdminCookie });
  assert.equal(privEscRbac.status, 403);

  // =========================================================================
  // TEST PURCHASE: CASH APP ($CASHTAG) LIVE FLOW + STATUS POLLING + REPLAY GUARD
  // =========================================================================
  const ordRes = await router.handleRequest(
    'POST',
    '/api/orders/cashapp',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_chipperty_popular', senderTag: '$PlayerTag26' }
  );
  assert.equal(ordRes.status, 201);
  assert.equal(ordRes.body.order.payTo, '$Daniel-Collins-168');
  assert.equal(ordRes.body.order.paymentLink, 'https://cash.app/$Daniel-Collins-168');
  const ordId = ordRes.body.order.id;

  const sentRes = await router.handleRequest(
    'POST',
    '/api/orders/cashapp/sent',
    { ...csrf, cookie: playerCookie },
    { orderId: ordId, senderTag: '$PlayerTag26', receiptRef: 'https://cash.app/payments/ca_live_9901' }
  );
  assert.equal(sentRes.status, 200);
  assert.equal(sentRes.body.order.status, 'awaiting_confirmation');
  assert.equal(sentRes.body.order.customerReceiptRef, 'https://cash.app/payments/ca_live_9901');

  const admConf = await router.handleRequest(
    'POST',
    '/api/admin/orders/confirm',
    { ...csrf, cookie: adminCookie },
    { orderId: ordId, cashAppPaymentId: 'CA-REC-9901' }
  );
  assert.equal(admConf.status, 200);
  assert.equal(admConf.body.order.status, 'confirmed');

  // Player status poll returns confirmed order + updated wallet balance
  const caPoll = await router.handleRequest(
    'GET',
    '/api/orders/cashapp/status',
    { cookie: playerCookie },
    {},
    { query: new URLSearchParams({ orderId: ordId }) }
  );
  assert.equal(caPoll.status, 200);
  assert.equal(caPoll.body.order.status, 'confirmed');
  assert.ok(caPoll.body.balance.sweepsCoins > 100);

  // Anti-Hack: Duplicate Cash App receipt ID replay on a second order MUST fail!
  const ord2 = await router.handleRequest(
    'POST',
    '/api/orders/cashapp',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_couch_starter', senderTag: '$PlayerTag26' }
  );
  const dupReceiptTry = await router.handleRequest(
    'POST',
    '/api/admin/orders/confirm',
    { ...csrf, cookie: adminCookie },
    { orderId: ord2.body.order.id, cashAppPaymentId: 'CA-REC-9901' }
  );
  assert.equal(dupReceiptTry.status, 400);

  // Stripe Checkout MUST ignore spoofed client origin and use configured PUBLIC_ORIGIN
  const strChk = await router.handleRequest(
    'POST',
    '/api/payments/stripe/checkout',
    { ...csrf, cookie: playerCookie },
    { packageId: 'pkg_embassy_viral', origin: 'https://evil-attacker.example' }
  );
  assert.equal(strChk.status, 201);
  assert.ok(!lastStripeBody.includes('evil-attacker.example'));
  assert.ok(lastStripeBody.includes(encodeURIComponent('https://blinkosweepstakes.oopsiwon.com')));

  const whPayload = JSON.stringify({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_12345',
        payment_status: 'paid',
        client_reference_id: strChk.body.sessionRef,
      },
    },
  });
  const signStripe = (payloadStr) => {
    const tsNow = Math.floor(Date.now() / 1000);
    const sigHex = crypto.createHmac('sha256', 'whsec_test_secret').update(`${tsNow}.${payloadStr}`).digest('hex');
    return `t=${tsNow},v1=${sigHex}`;
  };
  const whRes = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(whPayload) },
    whPayload
  );
  assert.equal(whRes.status, 200);
  assert.equal(whRes.body.handled, true);

  const whDup = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(whPayload) },
    whPayload
  );
  assert.equal(whDup.status, 200);
  assert.equal(whDup.body.duplicate, true);

  // Admin adjusts +1200 SC so player retains >= 200 SC after 1x playthrough at 30% RTP
  await router.handleRequest(
    'POST',
    '/api/admin/adjust-balance',
    { ...csrf, cookie: adminCookie },
    { targetUserId: reg.body.user.id, currency: 'SC', amount: 1200, reason: 'Test rollover setup' }
  );

  const balBeforePlay = await router.handleRequest('GET', '/api/balance', { cookie: playerCookie });
  const unplayed = balBeforePlay.body.balance.unplayedSC;
  if (unplayed > 0) {
    await new Promise((r) => setTimeout(r, 75));
    const betPer = Number((Math.ceil((unplayed / 10) * 100) / 100).toFixed(2));
    const playAll = await router.handleRequest(
      'POST',
      '/api/drop',
      { ...csrf, cookie: playerCookie },
      { currencyMode: 'SC', betPerBall: betPer, rows: 8, risk: 'LOW', ballCount: 10 }
    );
    assert.equal(playAll.status, 200, JSON.stringify(playAll.body));
  }

  // Redemption blocked until KYC verified
  const rdmBlocked = await router.handleRequest(
    'POST',
    '/api/redeem',
    { ...csrf, cookie: playerCookie },
    { amountSC: 50, method: 'crypto', cryptoAsset: 'USDT_SOL', destination: 'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f' }
  );
  assert.equal(rdmBlocked.status, 403);
  assert.equal(rdmBlocked.body.code, 'KYC_REQUIRED');

  // Restricted state blocked in KYC
  const kycRestricted = await router.handleRequest(
    'POST',
    '/api/kyc/submit',
    { ...csrf, cookie: playerCookie },
    { legalName: 'Jane Doe', dob: '1995-04-12', address: { line1: '1 Main', city: 'NY', state: 'NY', zip: '10001' } }
  );
  assert.equal(kycRestricted.status, 451);

  // Valid KYC submission + operator approval
  const kycOk = await router.handleRequest(
    'POST',
    '/api/kyc/submit',
    { ...csrf, cookie: playerCookie },
    { legalName: 'Jane Doe', dob: '1995-04-12', address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' } }
  );
  assert.equal(kycOk.status, 200);

  const kycApprove = await router.handleRequest(
    'POST',
    '/api/admin/kyc/decide',
    { ...csrf, cookie: adminCookie },
    { userId: reg.body.user.id, decision: 'verified' }
  );
  assert.equal(kycApprove.status, 200);

  // Anti-Hack: Second account attempting to submit KYC with Jane Doe's verified identity is blocked (409)
  const sybilCookie = extractCookie(syb1, 'blk_session');
  const dupKycBlocked = await router.handleRequest(
    'POST',
    '/api/kyc/submit',
    { ...csrf, cookie: sybilCookie },
    { legalName: 'Jane Doe', dob: '1995-04-12', address: { line1: '2 Main St', city: 'Austin', state: 'TX', zip: '78701' } }
  );
  assert.equal(dupKycBlocked.status, 409);
  assert.equal(dupKycBlocked.body.code, 'DUPLICATE_IDENTITY');

  // Live Crypto Payout
  const rdmReq = await router.handleRequest(
    'POST',
    '/api/redeem',
    { ...csrf, cookie: playerCookie },
    {
      amountSC: 50,
      method: 'crypto',
      cryptoAsset: 'USDT_SOL',
      destination: 'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f',
    }
  );
  assert.equal(rdmReq.status, 200, JSON.stringify(rdmReq.body));
  const rdmId = rdmReq.body.redemption.id;

  const quoteRes = await router.handleRequest(
    'POST',
    '/api/admin/redemptions/quote',
    { ...csrf, cookie: adminCookie },
    { redemptionId: rdmId }
  );
  assert.equal(quoteRes.status, 200);

  mockVerifier._nextAmountUnits = parseDisplayUnits(quoteRes.body.instructions.amount, 6);
  const paidRes = await router.handleRequest(
    'POST',
    '/api/admin/redemptions/mark-paid',
    { ...csrf, cookie: adminCookie },
    {
      redemptionId: rdmId,
      txHash: '4yPayoutSolanaTxSig11111111111111111111111111111111111111111111111111',
    }
  );
  assert.equal(paidRes.status, 200);
  assert.equal(paidRes.body.redemption.status, 'paid');

  // Live Cash App Payout
  const caRdmReq = await router.handleRequest(
    'POST',
    '/api/redeem',
    { ...csrf, cookie: playerCookie },
    { amountSC: 50, method: 'cashapp', destination: '$PlayerTag26' }
  );
  assert.equal(caRdmReq.status, 200);
  const caQuote = await router.handleRequest(
    'POST',
    '/api/admin/redemptions/quote',
    { ...csrf, cookie: adminCookie },
    { redemptionId: caRdmReq.body.redemption.id }
  );
  assert.equal(caQuote.body.instructions.cashAppLink, 'https://cash.app/$PlayerTag26');
  const caPaid = await router.handleRequest(
    'POST',
    '/api/admin/redemptions/mark-paid',
    { ...csrf, cookie: adminCookie },
    { redemptionId: caRdmReq.body.redemption.id, receipt: 'CA-OUT-7788' }
  );
  assert.equal(caPaid.status, 200);
  assert.equal(caPaid.body.redemption.status, 'paid');

  // Stripe payout.paid & payout.failed webhooks
  const strPayout1 = await router.handleRequest(
    'POST',
    '/api/redeem',
    { ...csrf, cookie: playerCookie },
    { amountSC: 50, method: 'stripe_bank', destination: 'acct_player_123' }
  );
  assert.equal(strPayout1.status, 200, JSON.stringify(strPayout1.body));
  const payoutPaidEvt = JSON.stringify({
    id: 'evt_payout_paid_1',
    type: 'payout.paid',
    data: { object: { id: 'po_live_1001', metadata: { redemptionId: strPayout1.body.redemption.id } } },
  });
  const payoutPaidWh = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(payoutPaidEvt) },
    payoutPaidEvt
  );
  assert.equal(payoutPaidWh.status, 200);
  assert.equal(payoutPaidWh.body.redemption.status, 'paid');

  const balBeforeFailRdm = payoutPaidWh.body.balance.sweepsCoins;
  const strPayout2 = await router.handleRequest(
    'POST',
    '/api/redeem',
    { ...csrf, cookie: playerCookie },
    { amountSC: 50, method: 'stripe_bank', destination: 'acct_player_123' }
  );
  assert.equal(strPayout2.status, 200, JSON.stringify(strPayout2.body));
  const payoutFailEvt = JSON.stringify({
    id: 'evt_payout_fail_1',
    type: 'payout.failed',
    data: {
      object: {
        id: 'po_live_1002',
        failure_message: 'Bank account closed',
        metadata: { redemptionId: strPayout2.body.redemption.id },
      },
    },
  });
  const payoutFailWh = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(payoutFailEvt) },
    payoutFailEvt
  );
  assert.equal(payoutFailWh.status, 200);
  assert.equal(payoutFailWh.body.redemption.status, 'rejected');
  assert.equal(payoutFailWh.body.balance.sweepsCoins, balBeforeFailRdm);

  // Verify CryptoVerifier Solana v0 ALT + Ethereum ERC20 + Bitcoin parser logic
  const unitVerifier = new CryptoVerifier({
    fetchImpl: async (url, init) => {
      if (url.includes('mempool.space/api/tx/')) {
        return new Response(
          JSON.stringify({
            vout: [{ scriptpubkey_address: 'bc1qwhnp4ylpv2h2q5x0rr9zm3zpwfcw3rtdmz4q4q', value: 125000 }],
            status: { confirmed: true, block_height: 870000, block_time: 1760000000 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('blocks/tip/height')) {
        return new Response('870002', { status: 200 });
      }
      const rpc = JSON.parse(init.body);
      if (rpc.method === 'getTransaction') {
        return new Response(
          JSON.stringify({
            result: {
              blockTime: 1760000000,
              transaction: { message: { accountKeys: ['Sender1111111111111111111111111111111111111'] } },
              meta: {
                err: null,
                loadedAddresses: { writable: ['Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f'], readonly: [] },
                preBalances: [2000000000, 1000000],
                postBalances: [1000000000, 501000000],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    },
  });
  const btcCheck = await unitVerifier.verifyTransfer({
    asset: getAsset('BTC'),
    txHash: 'd'.repeat(64),
    recipient: 'bc1qwhnp4ylpv2h2q5x0rr9zm3zpwfcw3rtdmz4q4q',
  });
  assert.equal(btcCheck.found, true);
  assert.equal(btcCheck.amountRaw, 125000n);
  assert.equal(btcCheck.confirmations, 3);

  const solAltCheck = await unitVerifier.verifyTransfer({
    asset: getAsset('SOL'),
    txHash: '5xBase58SigTest4444444444444444444444444444444444444444444444444444',
    recipient: 'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f',
  });
  assert.equal(solAltCheck.found, true);
  assert.equal(solAltCheck.amountRaw, 500000000n);

  // Verify SHA-256 Hash-Chained Audit Ledger integrity
  const ledgerCheck = await router.handleRequest('GET', '/api/admin/ledger', { cookie: adminCookie });
  assert.equal(ledgerCheck.status, 200);
  assert.equal(ledgerCheck.body.integrity.valid, true);
  assert.ok(ledgerCheck.body.integrity.chainLength > 15);

  try {
    fs.unlinkSync(tmpDb);
    fs.unlinkSync(`${tmpDb}-wal`);
    fs.unlinkSync(`${tmpDb}-shm`);
  } catch {}
});

console.log(`\nSuite summary: ${passed} passed.`);
