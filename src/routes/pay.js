const router = require('express').Router();
const Trip = require('../models/Trip');
const User = require('../models/User');
const cashfreeService = require('../services/cashfreeService');
const paymentService = require('../services/paymentService');
const logger = require('../config/logger');

/**
 * Public hosted payment page (fallback when Cashfree Payment Links API is not enabled).
 *   GET /pay/:token        → opens Cashfree checkout for the trip
 *   GET /pay/:token/done   → return page; verifies with Cashfree and captures
 * :token is a signed 7-day JWT created by paymentService.payPageUrl(tripId).
 */
const SERVER = () => process.env.SERVER_URL || 'https://server.truxhire.tech';
const MODE = () => (process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body, extraHead = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${extraHead}
<style>body{font-family:Arial,sans-serif;background:#faf7f7;margin:0;padding:24px;color:#222}
.card{max-width:440px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 18px rgba(0,0,0,.08);text-align:center}
h2{color:#E53935;margin:0 0 6px}.amt{font-size:34px;font-weight:800;margin:14px 0}.muted{color:#777;font-size:13px}
.btn{display:inline-block;background:#E53935;color:#fff;border:0;border-radius:10px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none}
.ok{color:#2e7d32}.bad{color:#c62828}</style></head><body><div class="card"><h2>TRUXHIRE</h2>${body}</div></body></html>`;

const loadTrip = async (token) => {
  const tripId = paymentService.verifyPayToken(token);
  return Trip.findById(tripId).populate('load', 'pickupLocation dropLocation');
};

router.get('/:token', async (req, res) => {
  try {
    const trip = await loadTrip(req.params.token);
    if (!trip) return res.status(404).send(page('Not found', '<p>Shipment not found.</p>'));
    const route = `${esc(trip.load?.pickupLocation?.city)} → ${esc(trip.load?.dropLocation?.city)}`;

    if (!['pending', 'failed'].includes(trip.paymentStatus)) {
      return res.send(page('Paid', `<h3 class="ok">✅ Payment already received</h3><p class="muted">Shipment ${esc(trip.tripCode)} · ${route}</p>`));
    }

    // Reuse the trip's open Cashfree order if it is still ACTIVE for the same amount, else create a fresh one
    let order = trip.paymentOrderId ? await cashfreeService.getOrder(trip.paymentOrderId) : null;
    if (!order || order.order_status !== 'ACTIVE' || Number(order.order_amount) !== Number(trip.agreedPrice) || !order.payment_session_id) {
      const transporter = await User.findById(trip.transporter);
      const orderId = `trip_${trip._id}_${Date.now()}`;
      order = await cashfreeService.createOrder(trip.agreedPrice, orderId, {
        id: String(trip.transporter),
        name: transporter?.companyName || transporter?.name,
        email: transporter?.email,
        phone: transporter?.phone,
      }, {
        tripId: String(trip._id),
        note: `TruxHire shipment ${trip.tripCode}`,
        returnUrl: `${SERVER()}/pay/${req.params.token}/done?order_id={order_id}`,
      });
      await Trip.findByIdAndUpdate(trip._id, { paymentOrderId: order.order_id });
    }

    const head = '<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>';
    const body = `<p class="muted">Shipment ${esc(trip.tripCode)} · ${route}</p>
<div class="amt">₹${Number(trip.agreedPrice).toLocaleString('en-IN')}</div>
<button class="btn" id="pay">PAY NOW</button>
<p class="muted" style="margin-top:18px">UPI · Cards · NetBanking · Wallets<br>Secured by Cashfree Payments</p>
<script>
  var cf = Cashfree({ mode: ${JSON.stringify(MODE())} });
  function go(){ cf.checkout({ paymentSessionId: ${JSON.stringify(order.payment_session_id)}, redirectTarget: '_self' }); }
  document.getElementById('pay').addEventListener('click', go);
  window.addEventListener('load', function(){ setTimeout(go, 400); });
</script>`;
    res.send(page('Pay for shipment', body, head));
  } catch (err) {
    logger.error(`[PayPage] ${err.message}`);
    const expired = /expired|jwt/i.test(err.message);
    res.status(expired ? 410 : 500).send(page('Payment link', `<h3 class="bad">${expired ? 'This payment link has expired' : 'Could not open payment'}</h3><p class="muted">Please open the TruxHire app and tap “Open payment link” for a fresh one.</p>`));
  }
});

router.get('/:token/done', async (req, res) => {
  try {
    const trip = await loadTrip(req.params.token);
    if (!trip) return res.status(404).send(page('Not found', '<p>Shipment not found.</p>'));
    const orderId = req.query.order_id && String(req.query.order_id) === trip.paymentOrderId ? String(req.query.order_id) : trip.paymentOrderId;
    const pay = orderId ? await cashfreeService.verifyPayment(orderId).catch(() => null) : null;

    if (pay?.status === 'SUCCESS' && Number(pay.amount) >= Number(trip.agreedPrice)) {
      await paymentService.captureTripPayment(trip._id, { paymentId: pay.paymentId, orderId, amount: pay.amount, source: 'pay_page' });
      return res.send(page('Payment successful', `<h3 class="ok">✅ Payment successful</h3><div class="amt">₹${Number(trip.agreedPrice).toLocaleString('en-IN')}</div><p class="muted">Shipment ${esc(trip.tripCode)}. You can close this page and return to the TruxHire app.</p>`));
    }
    const pending = !pay || pay.status === 'PENDING';
    res.send(page('Payment status', pending
      ? `<h3>⏳ Payment processing</h3><p class="muted">We are confirming your payment. The app will update automatically.</p>`
      : `<h3 class="bad">Payment not completed</h3><a class="btn" href="/pay/${esc(req.params.token)}">TRY AGAIN</a>`));
  } catch (err) {
    res.status(500).send(page('Payment status', '<p>Could not verify the payment right now. The app will update automatically once confirmed.</p>'));
  }
});

module.exports = router;
