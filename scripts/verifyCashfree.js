/**
 * Cashfree live-setup check — run ON THE VPS from the Backend folder:
 *
 *   node scripts/verifyCashfree.js                 # safe: no money moves
 *   node scripts/verifyCashfree.js --payout=1      # also sends a REAL ₹1 payout to YOUR bank account
 *
 * For --payout set your own bank details first (not stored anywhere):
 *   TEST_NAME="Your Name" TEST_ACCOUNT=1234567890 TEST_IFSC=HDFC0001234 TEST_PHONE=9999999999 \
 *   node scripts/verifyCashfree.js --payout=1
 *
 * Checks: env, PG auth (creates an unpaid ₹1 order + a ₹1 payment link, cancels the link),
 * Payouts auth + IP whitelist, and optionally a real payout.
 */
require('dotenv').config();
const axios = require('axios');
const cf = require('../src/services/cashfreeService');

const ok = (c, m) => console.log(`${c ? '✅ PASS' : '❌ FAIL'}  ${m}`);
const info = (m) => console.log(`        ${m}`);
const ENV = process.env.CASHFREE_ENV || 'sandbox';
const PG = ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const PO = ENV === 'production' ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout';
const pgH = { 'x-client-id': process.env.CASHFREE_PG_APP_ID, 'x-client-secret': process.env.CASHFREE_PG_SECRET_KEY, 'x-api-version': '2023-08-01' };
const poH = { 'x-client-id': process.env.CASHFREE_PAYOUT_CLIENT_ID, 'x-client-secret': process.env.CASHFREE_PAYOUT_CLIENT_SECRET, 'x-api-version': '2024-01-01' };
const payoutArg = process.argv.find((a) => a.startsWith('--payout='));

(async () => {
  console.log(`\nCashfree check — env: ${ENV}\n`);

  // 1. env
  ok(ENV === 'production', `CASHFREE_ENV=${ENV} (must be "production" for live)`);
  ok(/^https:\/\//.test(process.env.SERVER_URL || ''), `SERVER_URL=${process.env.SERVER_URL} (must be public https)`);
  for (const k of ['CASHFREE_PG_APP_ID', 'CASHFREE_PG_SECRET_KEY', 'CASHFREE_PAYOUT_CLIENT_ID', 'CASHFREE_PAYOUT_CLIENT_SECRET']) {
    ok(!!process.env[k], `${k} present${process.env[k] ? ` (${process.env[k].length} chars)` : ''}`);
  }
  if (ENV === 'production' && /^TEST/i.test(process.env.CASHFREE_PG_APP_ID || '')) ok(false, 'PG App ID looks like a TEST key');

  // 2. PG auth: unpaid ₹1 order
  try {
    const { data } = await axios.post(`${PG}/orders`, {
      order_id: `verify_${Date.now()}`, order_amount: 1, order_currency: 'INR',
      customer_details: { customer_id: 'verify', customer_phone: '9999999999' },
    }, { headers: pgH });
    ok(!!data.payment_session_id, `PG auth OK — created unpaid test order ${data.order_id}`);
  } catch (e) { ok(false, `PG create order failed: ${e.response?.data?.message || e.message}`); }

  // 3. Payment link create → cancel (no SMS/email sent)
  try {
    const linkId = `verify_${Date.now().toString(36)}`;
    const { data } = await axios.post(`${PG}/links`, {
      link_id: linkId, link_amount: 1, link_currency: 'INR', link_purpose: 'TruxHire setup check',
      customer_details: { customer_phone: '9999999999' }, link_notify: { send_sms: false, send_email: false },
    }, { headers: pgH });
    ok(!!data.link_url, `Payment Links OK — ${data.link_url}`);
    await axios.post(`${PG}/links/${linkId}/cancel`, {}, { headers: pgH }).then(() => info('(test link cancelled)')).catch(() => {});
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    if (/not enabled|not approved/i.test(msg)) {
      console.log('⚠️  WARN  Cashfree Payment Links API not enabled on this account — the app automatically uses its own hosted pay page (/pay/…) instead.');
      info('Optional: ask care@cashfree.com to enable "link_creation_api" to also get Cashfree SMS/email links.');
    } else ok(false, `Payment link failed: ${msg}`);
  }

  // 4. Payouts auth + IP whitelist (read-only probe)
  try {
    await axios.get(`${PO}/transfers`, { headers: poH, params: { transfer_id: 'verify_probe_does_not_exist' } });
    ok(true, 'Payouts auth OK');
  } catch (e) {
    const code = e.response?.status; const msg = e.response?.data?.message || e.response?.data?.status_description || e.message;
    if (code === 404 || /not.?found|does not exist/i.test(msg)) ok(true, `Payouts auth + IP whitelist OK (probe → "${msg}")`);
    else if (code === 403 || code === 401 || /ip|whitelist/i.test(msg)) {
      ok(false, `Payouts blocked (${code}): ${msg}`);
      axios.get('https://api.ipify.org').then((r) => info(`This server's outbound IP is ${r.data} — it must be Active in Payouts → Developers → Two-Factor Authentication`)).catch(() => {});
    } else ok(false, `Payouts probe error (${code}): ${msg}`);
  }

  // 5. Optional real payout (₹ amount you pass)
  if (payoutArg) {
    const amount = Number(payoutArg.split('=')[1]) || 1;
    const { TEST_NAME, TEST_ACCOUNT, TEST_IFSC, TEST_PHONE } = process.env;
    if (!TEST_NAME || !TEST_ACCOUNT || !TEST_IFSC) { ok(false, 'Set TEST_NAME, TEST_ACCOUNT, TEST_IFSC (and TEST_PHONE) to run --payout'); return; }
    console.log(`\nSending REAL ₹${amount} payout to ${TEST_NAME} (••••${TEST_ACCOUNT.slice(-4)})...`);
    try {
      const bene = await cf.addBeneficiary(`verify${Date.now()}`, { name: TEST_NAME, phone: TEST_PHONE || '9999999999', bankAccount: { accountNumber: TEST_ACCOUNT, ifscCode: TEST_IFSC, accountHolderName: TEST_NAME } });
      ok(true, `Beneficiary added: ${bene.id}`);
      const transferId = `verify_${Date.now()}`;
      const p = await cf.createPayout(bene.id, amount, transferId, 'TruxHire setup check');
      ok(true, `Payout submitted: ${p.transferId} status=${p.status}`);
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const s = await cf.getPayoutStatus(transferId);
        const st = String(s?.status || '').toUpperCase();
        info(`status: ${st || 'unknown'}${s?.transfer_utr ? ` UTR ${s.transfer_utr}` : ''}`);
        if (['SUCCESS', 'FAILED', 'REVERSED', 'REJECTED'].includes(st)) break;
      }
      info('Also watch Payouts → Transfers → All in the dashboard, and the webhook log: pm2 logs | grep "Payouts Webhook"');
    } catch (e) { ok(false, `Payout test failed: ${e.message}`); }
  } else {
    console.log('\n(No money moved. Add --payout=1 with your own bank details to test a real ₹1 payout.)');
  }
  console.log('');
})();
