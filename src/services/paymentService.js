const Trip = require('../models/Trip');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const cashfreeService = require('./cashfreeService');
const notificationService = require('./notificationService');
const emailService = require('./emailService');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const SERVER = () => process.env.SERVER_URL || 'https://server.truxhire.tech';

/** Public, signed, 7-day pay-page URL for a trip (works with just the PG keys). */
exports.payPageUrl = (tripId) => {
  const token = jwt.sign({ t: String(tripId), p: 'pay' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  return `${SERVER()}/pay/${token}`;
};
exports.verifyPayToken = (token) => {
  const d = jwt.verify(token, process.env.JWT_SECRET);
  if (d.p !== 'pay') throw new Error('bad token');
  return d.t;
};

/**
 * Mark a trip as paid by the transporter. Idempotent: the first caller
 * (verify API, webhook or link poller) wins the atomic pending→captured flip
 * and writes the ledger row; every later caller is a no-op.
 *
 * @returns {Promise<boolean>} true when this call captured the payment
 */
exports.captureTripPayment = async (tripId, { paymentId, orderId, amount, source }) => {
  const trip = await Trip.findOneAndUpdate(
    { _id: tripId, paymentStatus: { $in: ['pending', 'failed'] } },
    {
      paymentStatus: 'captured',
      paymentTransactionId: paymentId ? String(paymentId) : undefined,
      ...(orderId ? { paymentOrderId: orderId } : {}),
    },
    { new: true },
  ).populate('load', 'pickupLocation dropLocation');
  if (!trip) return false;

  const payer = await User.findById(trip.transporter).select('walletBalance');
  const wallet = payer?.walletBalance || 0;
  try {
    await Transaction.create({
      user: trip.transporter,
      type: 'debit',
      amount: amount || trip.agreedPrice,
      description: `Payment for shipment - ${trip.load?.pickupLocation?.city} to ${trip.load?.dropLocation?.city}`,
      category: 'trip_payment',
      status: 'completed',
      trip: trip._id,
      referenceId: paymentId ? String(paymentId) : `order_${orderId}`,
      // Paid through the gateway, so the transporter's wallet is untouched
      balanceBefore: wallet,
      balanceAfter: wallet,
      metadata: { source, orderId },
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // duplicate = already ledgered
  }

  const driver = await User.findById(trip.driver).select('fcmToken');
  await notificationService.sendNotification(trip.driver, {
    title: 'Payment Received! 💰',
    body: `₹${trip.agreedPrice.toLocaleString('en-IN')} payment confirmed for your trip.`,
    type: 'payment',
    data: { tripId: trip._id.toString() },
    fcmToken: driver?.fcmToken,
  });
  logger.info(`[Payment] Trip ${trip._id} captured via ${source} (payment ${paymentId || '-'})`);
  return true;
};

/**
 * Create a Cashfree payment link for the trip and push it to the transporter
 * (Cashfree also SMS/emails it). Safe to call repeatedly — an existing active
 * link is reused.
 */
exports.sendPaymentLink = async (tripId, { force = false } = {}) => {
  const trip = await Trip.findById(tripId).populate('load', 'pickupLocation dropLocation');
  if (!trip) throw new Error('Trip not found');
  if (trip.paymentStatus !== 'pending' && trip.paymentStatus !== 'failed') {
    return { skipped: 'already_paid', trip };
  }

  const transporter = await User.findById(trip.transporter);
  if (!transporter) throw new Error('Transporter not found');

  // Default: in-app payment only. Tell the transporter payment is due; the push opens the
  // shipment, where the in-app Cashfree checkout (PAY button) is. External links are opt-in
  // via PAYMENT_LINKS=true.
  if (process.env.PAYMENT_LINKS !== 'true') {
    if (!trip.paymentLinkSentAt || force) {
      await Trip.findByIdAndUpdate(trip._id, { paymentLinkSentAt: new Date() });
      await notificationService.sendNotification(trip.transporter, {
        title: 'Loading Complete — Payment Due 💳',
        body: `Please pay ₹${trip.agreedPrice.toLocaleString('en-IN')} for shipment ${trip.tripCode} in the app.`,
        type: 'payment',
        data: { tripId: trip._id.toString(), action: 'pay_now' },
        fcmToken: transporter.fcmToken,
      });
    }
    return { inApp: true, trip };
  }

  let url = trip.paymentLinkUrl;
  let linkId = trip.paymentLinkId;

  // Hosted-pay-page links are stateless/signed — reuse until the token expires
  if (url && !linkId && !force) {
    try { exports.verifyPayToken(url.split('/pay/')[1]); return { linkId: null, url, trip }; } catch { url = null; }
  }

  // Reuse the existing Cashfree link while it is still payable
  if (linkId && !force) {
    const existing = await cashfreeService.getPaymentLink(linkId);
    if (existing?.link_status === 'PAID') {
      await exports.syncTripPayment(trip._id);
      return { skipped: 'already_paid', trip };
    }
    if (existing?.link_status !== 'ACTIVE') { linkId = null; url = null; }
  } else if (force) { linkId = null; url = null; }

  if (!linkId) {
    const route = `${trip.load?.pickupLocation?.city} to ${trip.load?.dropLocation?.city}`;
    try {
      const link = await cashfreeService.createPaymentLink({
        linkId: `trip_${trip._id}_${Date.now().toString(36)}`.slice(0, 50),
        amount: trip.agreedPrice,
        purpose: `TruxHire shipment ${trip.tripCode} (${route})`,
        customer: {
          name: transporter.companyName || transporter.name,
          email: transporter.email,
          phone: transporter.phone,
        },
      });
      linkId = link.linkId;
      url = link.url;
    } catch (err) {
      // Payment Links API not enabled on the Cashfree account (or down) →
      // fall back to our own hosted pay page that uses the normal PG order checkout.
      logger.warn(`[PaymentLink] Cashfree link unavailable (${err.message}) — using hosted pay page`);
      linkId = null;
      url = exports.payPageUrl(trip._id);
      // No Cashfree SMS/email in this mode, so email the link ourselves
      emailService.sendPaymentLinkEmail(transporter.email, { amount: trip.agreedPrice, tripCode: trip.tripCode, url }).catch(() => {});
    }
    await Trip.findByIdAndUpdate(trip._id, {
      ...(linkId ? { paymentLinkId: linkId } : { $unset: { paymentLinkId: 1 } }),
      paymentLinkUrl: url, paymentLinkSentAt: new Date(),
    });
  }

  await notificationService.sendNotification(trip.transporter, {
    title: 'Loading Complete — Payment Link 💳',
    body: `Pay ₹${trip.agreedPrice.toLocaleString('en-IN')} for shipment ${trip.tripCode}: ${url}`,
    type: 'payment',
    data: { tripId: trip._id.toString(), paymentLink: url, action: 'pay_now' },
    fcmToken: transporter.fcmToken,
  });
  return { linkId, url, trip };
};

/**
 * Pull the real state from Cashfree (link orders + order payments) and capture
 * the trip if a successful payment exists. Used by the poller and by the
 * transporter's "refresh" action so a missed webhook never leaves the ledger stale.
 */
exports.syncTripPayment = async (tripId) => {
  const trip = await Trip.findById(tripId);
  if (!trip || !['pending', 'failed'].includes(trip.paymentStatus)) return false;

  if (trip.paymentLinkId) {
    const orders = await cashfreeService.getPaymentLinkPayments(trip.paymentLinkId);
    for (const o of orders) {
      const pay = await cashfreeService.verifyPayment(o.order_id).catch(() => null);
      if (pay?.status === 'SUCCESS' && Number(pay.amount) >= trip.agreedPrice) {
        return exports.captureTripPayment(trip._id, {
          paymentId: pay.paymentId, orderId: o.order_id, amount: pay.amount, source: 'payment_link',
        });
      }
    }
  }
  if (trip.paymentOrderId) {
    const pay = await cashfreeService.verifyPayment(trip.paymentOrderId).catch(() => null);
    if (pay?.status === 'SUCCESS' && Number(pay.amount) >= trip.agreedPrice) {
      return exports.captureTripPayment(trip._id, {
        paymentId: pay.paymentId, orderId: trip.paymentOrderId, amount: pay.amount, source: 'order_sync',
      });
    }
  }
  return false;
};

/** Poll every unpaid trip that already has a payment link / order. */
exports.syncPendingPayments = async () => {
  const trips = await Trip.find({
    paymentStatus: { $in: ['pending', 'failed'] },
    status: { $ne: 'cancelled' },
    $or: [{ paymentLinkId: { $exists: true, $ne: null } }, { paymentOrderId: { $exists: true, $ne: null } }],
  }).select('_id').limit(100);
  for (const t of trips) {
    try { await exports.syncTripPayment(t._id); } catch (e) { logger.warn(`[Payment sync] ${t._id}: ${e.message}`); }
  }
};
