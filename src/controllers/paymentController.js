const Trip = require('../models/Trip');
const User = require('../models/User');
const cashfreeService = require('../services/cashfreeService');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');
const platformSettings = require('../services/platformSettings');
const notificationService = require('../services/notificationService');
const logger = require('../config/logger');

// ─── Transporter: Create Payment Order ────────────────────────────────────────

// POST /payments/create-order
exports.createOrder = async (req, res, next) => {
  try {
    const { tripId } = req.body;
    const trip = await Trip.findOne({ _id: tripId, transporter: req.user._id })
      .populate('load')
      .populate('transporter', 'name phone email companyName');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (!['pending', 'failed'].includes(trip.paymentStatus)) {
      return res.status(400).json({ success: false, message: 'Payment already processed.' });
    }

    const amount = trip.agreedPrice;
    const orderId = `trip_${trip._id}_${Date.now()}`;

    const order = await cashfreeService.createOrder(amount, orderId, {
      id: req.user._id.toString(),
      name: trip.transporter.companyName || trip.transporter.name,
      email: trip.transporter.email,
      phone: trip.transporter.phone,
    }, {
      tripId: trip._id.toString(),
      loadId: trip.load._id.toString(),
      note: `Payment for trip from ${trip.load.pickupLocation.city} to ${trip.load.dropLocation.city}`,
    });

    await Trip.findByIdAndUpdate(trip._id, { paymentOrderId: order.order_id });

    res.json({
      success: true,
      data: {
        orderId: order.order_id,
        paymentSessionId: order.payment_session_id,
        amount: order.order_amount,
        currency: order.order_currency,
        tripId: trip._id,
        appId: process.env.CASHFREE_PG_APP_ID,
        env: process.env.CASHFREE_ENV || 'sandbox',
      },
    });
  } catch (err) { next(err); }
};

// ─── Transporter: Verify Payment ──────────────────────────────────────────────

// POST /payments/verify
exports.verifyPayment = async (req, res, next) => {
  try {
    const { orderId, tripId } = req.body;
    if (!orderId || !tripId) {
      return res.status(400).json({ success: false, message: 'orderId and tripId are required.' });
    }

    // Only the transporter that owns the trip, and only for the order we created for it
    const trip = await Trip.findOne({ _id: tripId, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.paymentOrderId !== orderId) {
      return res.status(400).json({ success: false, message: 'Order does not belong to this trip.' });
    }

    // Always trust Cashfree, never the client
    const payment = await cashfreeService.verifyPayment(orderId);
    if (payment.status !== 'SUCCESS') {
      return res.status(400).json({ success: false, message: `Payment ${payment.status?.toLowerCase()}.` });
    }
    if (Number(payment.amount) < Number(trip.agreedPrice)) {
      return res.status(400).json({ success: false, message: 'Paid amount does not match the shipment amount.' });
    }

    await paymentService.captureTripPayment(trip._id, {
      paymentId: payment.paymentId, orderId, amount: payment.amount, source: 'verify_api',
    });

    res.json({ success: true, message: 'Payment verified successfully.', data: { paymentId: payment.paymentId } });
  } catch (err) { next(err); }
};

// POST /payments/trip/:tripId/payment-link  (transporter: get / resend the link)
exports.getPaymentLink = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    const result = await paymentService.sendPaymentLink(trip._id);
    if (result.skipped) return res.json({ success: true, message: 'Payment already completed.', data: { paid: true } });
    res.json({ success: true, data: { url: result.url, linkId: result.linkId } });
  } catch (err) { next(err); }
};

// POST /payments/trip/:tripId/sync  (transporter: "I paid, refresh")
exports.syncPayment = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    await paymentService.syncTripPayment(trip._id);
    const fresh = await Trip.findById(trip._id).select('paymentStatus');
    res.json({ success: true, data: { paymentStatus: fresh.paymentStatus } });
  } catch (err) { next(err); }
};

// ─── Payout to Driver (called internally) ─────────────────────────────────────
// At trip approval stages we ONLY credit the driver's in-app wallet.
// The actual bank transfer happens later when the driver requests a withdrawal.
const processDriverPayout = async (trip, percentage, stage) => {
  const amount = Math.round(trip.driverEarnings * percentage);
  const pct = Math.round(percentage * 100);
  const stageLabel = stage === 'loading_paid' ? `Loading (${pct}%)` : `Delivery (${pct}%)`;

  const tx = await walletService.credit(
    trip.driver,
    amount,
    `${stageLabel} earnings credited to wallet`,
    'trip_earning',
    trip._id,
  );

  return {
    id: tx?._id?.toString() || `wallet_${Date.now()}`,
    status: 'wallet_credited',
    amount,
  };
};

// ─── Trip Start → 90% Payout ─────────────────────────────────────────────────

exports.processLoadingPayout = async (tripId) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error('Trip not found');
  if (trip.payoutStage !== 'none') {
    logger.info(`Trip ${tripId} already has payout stage: ${trip.payoutStage}`);
    return null;
  }
  // Note: We intentionally do NOT block on transporter payment status.
  // The driver gets 90% credited to wallet as soon as transporter approves loading.
  // Transporter can settle the actual payment to TruxHire whenever they want.

  try {
    const loadingRate = await platformSettings.getLoadingSplitRate();
    const result = await processDriverPayout(trip, loadingRate, 'loading_paid');

    await Trip.findByIdAndUpdate(tripId, {
      payoutStage: 'loading_paid',
      loadingPayoutAmount: result.amount,
      loadingPayoutId: result.id,
      loadingPayoutAt: new Date(),
    });

    const driver = await User.findById(trip.driver);
    const pct = Math.round(loadingRate * 100);
    await notificationService.sendNotification(trip.driver, {
      title: 'Wallet Credited! 💰',
      body: `₹${result.amount.toLocaleString('en-IN')} (${pct}%) added to your wallet. You can withdraw anytime.`,
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    logger.info(`Loading credit of ₹${result.amount} added to wallet for trip ${tripId}`);
    return result;
  } catch (err) {
    logger.error(`Loading payout failed for trip ${tripId}:`, err);
    throw err;
  }
};

// ─── Trip Complete → 10% Payout ───────────────────────────────────────────────

exports.processDeliveryPayout = async (tripId) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error('Trip not found');
  if (trip.payoutStage !== 'loading_paid') {
    logger.info(`Trip ${tripId} not in loading_paid stage, current: ${trip.payoutStage}`);
    return null;
  }

  try {
    const deliveryRate = await platformSettings.getDeliverySplitRate();
    const result = await processDriverPayout(trip, deliveryRate, 'delivery_paid');

    const update = {
      payoutStage: 'delivery_paid',
      deliveryPayoutAmount: result.amount,
      deliveryPayoutId: result.id,
      deliveryPayoutAt: new Date(),
      paymentReleasedAt: new Date(),
    };
    // Only mark payment 'completed' if transporter has already paid.
    // If the transporter hasn't paid yet, leave paymentStatus untouched
    // so admins/finance can chase the payment separately.
    if (trip.paymentStatus === 'captured') {
      update.paymentStatus = 'completed';
    }
    await Trip.findByIdAndUpdate(tripId, update);

    const driver = await User.findById(trip.driver);
    const deliveryPct = Math.round(deliveryRate * 100);
    await notificationService.sendNotification(trip.driver, {
      title: 'Wallet Credited! 🎉',
      body: `₹${result.amount.toLocaleString('en-IN')} (${deliveryPct}%) added to your wallet. Trip complete!`,
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    logger.info(`Delivery credit of ₹${result.amount} added to wallet for trip ${tripId}`);
    return result;
  } catch (err) {
    logger.error(`Delivery payout failed for trip ${tripId}:`, err);
    throw err;
  }
};

// ─── Get Trip Payment Details ────────────────────────────────────────────────

exports.getTripPaymentDetails = async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.tripId)
      .populate('load', 'pickupLocation dropLocation')
      .select('tripCode paymentLinkUrl agreedPrice platformCommission driverEarnings paymentStatus payoutStage loadingPayoutAmount deliveryPayoutAmount loadingPayoutAt deliveryPayoutAt paymentTransactionId paymentOrderId');

    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
};

// ─── Cashfree Webhook ─────────────────────────────────────────────────────────

exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (process.env.CASHFREE_PG_SECRET_KEY) {
      const isValid = cashfreeService.verifyWebhookSignature(rawBody, signature, timestamp);
      if (!isValid) {
        logger.warn('[Cashfree Webhook] Invalid signature');
        return res.status(400).json({ message: 'Invalid signature' });
      }
    }

    const { type, data } = req.body;
    logger.info(`[Cashfree Webhook] Received: ${type}`);

    if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const payment = data?.payment;
      const order = data?.order;
      if (!order?.order_id) return res.status(200).json({ ok: true });

      // Match in-app orders by order id, payment-link orders by link id
      const linkId = data?.link_id || order?.order_tags?.link_id || order?.link_id;
      const trip = await Trip.findOne({
        $or: [{ paymentOrderId: order.order_id }, ...(linkId ? [{ paymentLinkId: linkId }] : [])],
      });
      if (trip) {
        await paymentService.captureTripPayment(trip._id, {
          paymentId: payment?.cf_payment_id, orderId: order.order_id,
          amount: payment?.payment_amount, source: 'webhook',
        });
      }
    } else if (type === 'PAYMENT_LINK_EVENT' || type === 'PAYMENT_LINK_PAID_WEBHOOK') {
      const linkId = data?.link_id;
      const trip = linkId && await Trip.findOne({ paymentLinkId: linkId });
      if (trip) await paymentService.syncTripPayment(trip._id);
    } else if (type === 'PAYMENT_FAILED_WEBHOOK') {
      const order = data?.order;
      if (!order?.order_id) return res.status(200).json({ ok: true });
      // Only flag failed while still pending — never downgrade a captured payment
      await Trip.findOneAndUpdate(
        { paymentOrderId: order.order_id, paymentStatus: 'pending' },
        { paymentStatus: 'failed' },
      );
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(`[Cashfree Webhook] Error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
};
