import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BLINKO_MULTIPLIERS, BLINKO_ROWS, BLINKO_RISKS } from '../src/config/blinkoConfig.js';
import { ApiRouter } from '../server/apiRouter.js';
import { openDefaultSqliteStore } from '../server/store/nodeSqlite.js';
import { PriceOracle, getAsset, displayToChainUnits, usdToDisplayUnits } from '../server/payments/cryptoAssets.js';

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

// 2. End-to-end API, Provably Fair, Dual-Currency, Playthrough, Crypto, CashApp, Stripe & KYC/Payout tests
await test('Full Sweepstakes Flow + Live Payment Rails + SQLite Persistence', async () => {
  const tmpDb = path.join(os.tmpdir(), `blinko_test_${Date.now()}.sqlite`);
  const sqlStore = await openDefaultSqliteStore(tmpDb);

  const mockOracle = new PriceOracle({ allowFallback: false });
  mockOracle.cache.set('USD', { price: 1, at: Date.now(), sources: ['peg'] });
  mockOracle.cache.set('SOL', { price: 200, at: Date.now(), sources: ['mock'] });

  const mockVerifier = {
    async verifyTransfer({ asset, txHash, recipient }) {
      if (txHash === 'bad_tx') return { found: false, amountRaw: 0n, confirmations: 0 };
      const expectedUnits = this._nextAmountUnits || 0n;
      return {
        found: true,
        success: true,
        amountRaw: displayToChainUnits(expectedUnits, asset),
        confirmations: 32,
        blockTime: Math.floor(Date.now() / 1000),
      };
    },
  };

  const mockStripeFetch = async (url, init) => {
    if (url.endsWith('/checkout/sessions') && init.method === 'POST') {
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

  const router = new ApiRouter({
    store: sqlStore,
    env: {
      DC_ADMIN_SECRET: 'test-operator-secret',
      STRIPE_SECRET_KEY: 'sk_test_mock_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    },
    priceOracle: mockOracle,
    verifier: mockVerifier,
    fetchImpl: mockStripeFetch,
  });

  // Guest cannot play SC
  const guestRes = await router.handleRequest('POST', '/api/auth/guest', {});
  assert.equal(guestRes.status, 200);
  const guestToken = guestRes.body.token;
  assert.equal(guestRes.body.balance.goldCoins, 100000);
  assert.equal(guestRes.body.balance.sweepsCoins, 0);

  const guestScBlocked = await router.handleRequest(
    'POST',
    '/api/drop',
    { authorization: `Bearer ${guestToken}` },
    { currencyMode: 'SC', betPerBall: 1, rows: 12, risk: 'MEDIUM', ballCount: 1 }
  );
  assert.equal(guestScBlocked.status, 401);

  // Register player -> gets 100,000 GC + 10.00 SC (unplayed)
  const reg = await router.handleRequest(
    'POST',
    '/api/auth/register',
    {},
    { email: 'player@blinko.test', password: 'Password123!', name: 'CouchDriver' }
  );
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  assert.equal(reg.body.balance.sweepsCoins, 10);
  assert.equal(reg.body.balance.unplayedSC, 10);
  assert.equal(reg.body.balance.redeemableSC, 0);

  // Drop 10 SC (10 balls x 1 SC) -> completes 1x playthrough on initial 10 SC!
  const drop = await router.handleRequest(
    'POST',
    '/api/drop',
    { authorization: `Bearer ${token}` },
    { currencyMode: 'SC', betPerBall: 1, rows: 12, risk: 'LOW', ballCount: 10, clientSeed: 'myseed123' }
  );
  assert.equal(drop.status, 200);
  assert.equal(drop.body.balls.length, 10);
  assert.equal(drop.body.balance.unplayedSC, 0);

  // Verify drop deterministically via ACTIVE_DEMO
  const verify = await router.handleRequest(
    'POST',
    '/api/provably-fair/verify',
    {},
    {
      serverSeed: 'ACTIVE_DEMO',
      clientSeed: 'myseed123',
      nonce: drop.body.provablyFair.nonce,
      rows: 12,
      risk: 'LOW',
      ballCount: 10,
      betPerBall: 1,
      currencyMode: 'SC',
    }
  );
  assert.equal(verify.status, 200);
  assert.equal(verify.body.totalPayout, drop.body.totalWin);

  // Claim Daily & AMOE once; second claim same day returns 409
  const daily1 = await router.handleRequest('POST', '/api/promotions/daily', { authorization: `Bearer ${token}` });
  assert.equal(daily1.status, 200);
  const daily2 = await router.handleRequest('POST', '/api/promotions/daily', { authorization: `Bearer ${token}` });
  assert.equal(daily2.status, 409);

  const amoe1 = await router.handleRequest('POST', '/api/promotions/amoe', { authorization: `Bearer ${token}` });
  assert.equal(amoe1.status, 200);
  const amoe2 = await router.handleRequest('POST', '/api/promotions/amoe', { authorization: `Bearer ${token}` });
  assert.equal(amoe2.status, 409);

  // Live Crypto deposit quote -> on-chain verify -> credit -> duplicate tx rejected
  const depCreate = await router.handleRequest(
    'POST',
    '/api/deposits/crypto',
    { authorization: `Bearer ${token}` },
    { packageId: 'pkg_faa_margarita', asset: 'USDT_SOL' }
  );
  assert.equal(depCreate.status, 201);
  const deposit = depCreate.body.deposit;
  mockVerifier._nextAmountUnits = BigInt(Math.round(Number(deposit.amount) * 1e6));

  const depSubmit = await router.handleRequest(
    'POST',
    '/api/deposits/crypto/submit',
    { authorization: `Bearer ${token}` },
    { depositId: deposit.id, txHash: '5xValidSolanaSig1111111111111111111111111111111111111111111111111111' }
  );
  assert.equal(depSubmit.status, 200);
  assert.equal(depSubmit.body.credited, true);

  // Admin Login
  const admLogin = await router.handleRequest('POST', '/api/admin/login', {}, { adminKey: 'test-operator-secret' });
  assert.equal(admLogin.status, 200);
  const adminToken = admLogin.body.token;

  // Cash App order -> player sent -> admin confirms -> duplicate receipt rejected
  const ordRes = await router.handleRequest(
    'POST',
    '/api/orders/cashapp',
    { authorization: `Bearer ${token}` },
    { packageId: 'pkg_couch_starter', senderTag: '$PlayerTag' }
  );
  assert.equal(ordRes.status, 201);
  const ordId = ordRes.body.order.id;

  await router.handleRequest(
    'POST',
    '/api/orders/cashapp/sent',
    { authorization: `Bearer ${token}` },
    { orderId: ordId, senderTag: '$PlayerTag' }
  );

  const admConf = await router.handleRequest(
    'POST',
    '/api/admin/orders/confirm',
    { authorization: `Bearer ${adminToken}` },
    { orderId: ordId, cashAppPaymentId: 'CA-REC-9901' }
  );
  assert.equal(admConf.status, 200);
  assert.equal(admConf.body.order.status, 'confirmed');

  // Stripe Checkout + Signed Webhook verification & credit
  const strChk = await router.handleRequest(
    'POST',
    '/api/payments/stripe/checkout',
    { authorization: `Bearer ${token}`, origin: 'http://localhost:3002' },
    { packageId: 'pkg_embassy_viral' }
  );
  assert.equal(strChk.status, 201);
  assert.equal(strChk.body.stripeSessionId, 'cs_test_12345');

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

  // Duplicate Stripe event idempotency check
  const whDup = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(whPayload) },
    whPayload
  );
  assert.equal(whDup.status, 200);
  assert.equal(whDup.body.duplicate, true);

  // Admin adjusts +1200 SC so player retains >= 150 SC after 1x playthrough at 30% RTP
  await router.handleRequest(
    'POST',
    '/api/admin/adjust-balance',
    { authorization: `Bearer ${adminToken}` },
    { targetUserId: reg.body.user.id, currency: 'SC', amount: 1200, reason: 'Test rollover setup' }
  );

  // Play through all unplayed SC via single drop
  const balBeforePlay = await router.handleRequest('GET', '/api/balance', { authorization: `Bearer ${token}` });
  const unplayed = balBeforePlay.body.balance.unplayedSC;
  if (unplayed > 0) {
    await new Promise((r) => setTimeout(r, 75));
    const betPer = Number((Math.ceil((unplayed / 10) * 100) / 100).toFixed(2));
    const playAll = await router.handleRequest(
      'POST',
      '/api/drop',
      { authorization: `Bearer ${token}` },
      { currencyMode: 'SC', betPerBall: betPer, rows: 8, risk: 'LOW', ballCount: 10 }
    );
    assert.equal(playAll.status, 200, JSON.stringify(playAll.body));
  }

  // Redemption blocked until KYC verified
  const rdmBlocked = await router.handleRequest(
    'POST',
    '/api/redeem',
    { authorization: `Bearer ${token}` },
    { amountSC: 50, method: 'crypto', cryptoAsset: 'USDT_SOL', destination: 'Ejj7hyePNeC9yHQKuEnRvjSiSdJ7sZfNsdmm3YZxFS1f' }
  );
  assert.equal(rdmBlocked.status, 403);
  assert.equal(rdmBlocked.body.code, 'KYC_REQUIRED');

  // Restricted state blocked in KYC
  const kycRestricted = await router.handleRequest(
    'POST',
    '/api/kyc/submit',
    { authorization: `Bearer ${token}` },
    { legalName: 'Jane Doe', dob: '1995-04-12', address: { line1: '1 Main', city: 'NY', state: 'NY', zip: '10001' } }
  );
  assert.equal(kycRestricted.status, 451);

  // Valid KYC submission + operator approval
  const kycOk = await router.handleRequest(
    'POST',
    '/api/kyc/submit',
    { authorization: `Bearer ${token}` },
    { legalName: 'Jane Doe', dob: '1995-04-12', address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' } }
  );
  assert.equal(kycOk.status, 200);

  const kycApprove = await router.handleRequest(
    'POST',
    '/api/admin/kyc/decide',
    { authorization: `Bearer ${adminToken}` },
    { userId: reg.body.user.id, decision: 'verified' }
  );
  assert.equal(kycApprove.status, 200);

  // Live Crypto Payout: player requests -> operator quotes -> verifier checks outgoing txHash -> settled!
  const rdmReq = await router.handleRequest(
    'POST',
    '/api/redeem',
    { authorization: `Bearer ${token}` },
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
    { authorization: `Bearer ${adminToken}` },
    { redemptionId: rdmId }
  );
  assert.equal(quoteRes.status, 200);

  mockVerifier._nextAmountUnits = BigInt(Math.round(Number(quoteRes.body.instructions.amount) * 1e6));
  const paidRes = await router.handleRequest(
    'POST',
    '/api/admin/redemptions/mark-paid',
    { authorization: `Bearer ${adminToken}` },
    {
      redemptionId: rdmId,
      txHash: '4yPayoutSolanaTxSig11111111111111111111111111111111111111111111111111',
    }
  );
  assert.equal(paidRes.status, 200);
  assert.equal(paidRes.body.redemption.status, 'paid');

  // Stripe payout.paid webhook settles pending stripe_bank redemption automatically
  const strPayout1 = await router.handleRequest(
    'POST',
    '/api/redeem',
    { authorization: `Bearer ${token}` },
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

  // Stripe payout.failed webhook refunds SC back to player redeemable balance
  const balBeforeFailRdm = payoutPaidWh.body.balance.sweepsCoins;
  const strPayout2 = await router.handleRequest(
    'POST',
    '/api/redeem',
    { authorization: `Bearer ${token}` },
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

  // Stripe charge.dispute.created webhook appends to audit ledger cleanly
  const disputeEvt = JSON.stringify({
    id: 'evt_dispute_1',
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_1001', amount: 1999, reason: 'fraudulent', metadata: { userId: reg.body.user.id } } },
  });
  const disputeWh = await router.handleRequest(
    'POST',
    '/api/payments/stripe/webhook',
    { 'stripe-signature': signStripe(disputeEvt) },
    disputeEvt
  );
  assert.equal(disputeWh.status, 200);

  // Verify Merkle Audit Ledger integrity
  const ledgerCheck = await router.handleRequest('GET', '/api/admin/ledger', { authorization: `Bearer ${adminToken}` });
  assert.equal(ledgerCheck.status, 200);
  assert.equal(ledgerCheck.body.integrity.valid, true);
  assert.ok(ledgerCheck.body.integrity.chainLength > 5);

  // Seed rotation & tamper detection check
  const rotRes = await router.handleRequest('POST', '/api/admin/provably-fair/rotate', { authorization: `Bearer ${adminToken}` });
  assert.equal(rotRes.status, 200);
  assert.ok(rotRes.body.revealedServerSeed);

  // Cleanup tmp sqlite file
  try {
    fs.unlinkSync(tmpDb);
    fs.unlinkSync(`${tmpDb}-wal`);
    fs.unlinkSync(`${tmpDb}-shm`);
  } catch {}
});

console.log(`\nSuite summary: ${passed} passed.`);
