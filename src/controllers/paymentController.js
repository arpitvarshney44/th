const Trip = require('../models/Trip');
const User = require('../models/User');
const cashfreeService = require('../services/cashfreeService');
const walletService = require('../services/walletService');
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
    if (trip.paymentStatus !== 'pending') {
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

    // Fetch payment status from Cashfree
    const payment = await cashfreeService.verifyPayment(orderId);
    if (payment.status !== 'SUCCESS') {
      return res.status(400).json({ success: false, message: `Payment ${payment.status?.toLowerCase()}.` });
    }

    const trip = await Trip.findById(tripId).populate('load').populate('driver');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

    // Update trip with payment info
    await Trip.findByIdAndUpdate(trip._id, {
      paymentOrderId: orderId,
      paymentTransactionId: payment.paymentId,
      paymentStatus: 'captured',
    });

    // Record as transporter transaction
    const Transaction = require('../models/Transaction');
    await Transaction.create({
      user: trip.transporter,
      type: 'debit',
      amount: trip.agreedPrice,
      description: `Payment for shipment - ${trip.load.pickupLocation.city} to ${trip.load.dropLocation.city}`,
      category: 'trip_payment',
      status: 'completed',
      trip: trip._id,
      referenceId: payment.paymentId,
      balanceBefore: 0,
      balanceAfter: 0,
    }).catch(() => {});

    // Notify driver
    await notificationService.sendNotification(trip.driver._id, {
      title: 'Payment Received! 💰',
      body: `₹${trip.agreedPrice.toLocaleString('en-IN')} payment confirmed for your trip.`,
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: trip.driver.fcmToken,
    });

    res.json({ success: true, message: 'Payment verified successfully.', data: { paymentId: payment.paymentId } });
  } catch (err) { next(err); }
};

// ─── Payout to Driver (called internally) ─────────────────────────────────────
// At trip approval stages we ONLY credit the driver's in-app wallet.
// The actual bank transfer happens later when the driver requests a withdrawal.
const processDriverPayout = async (trip, percentage, stage) => {
  const amount = Math.round(trip.driverEarnings * percentage);
  const stageLabel = stage === 'loading_paid' ? 'Loading (90%)' : 'Delivery (10%)';

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
    const result = await processDriverPayout(trip, 0.9, 'loading_paid');

    await Trip.findByIdAndUpdate(tripId, {
      payoutStage: 'loading_paid',
      loadingPayoutAmount: result.amount,
      loadingPayoutId: result.id,
      loadingPayoutAt: new Date(),
    });

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Wallet Credited! 💰',
      body: `₹${result.amount.toLocaleString('en-IN')} (90%) added to your wallet. You can withdraw anytime.`,
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
    const result = await processDriverPayout(trip, 0.1, 'delivery_paid');

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
    await notificationService.sendNotification(trip.driver, {
      title: 'Wallet Credited! 🎉',
      body: `₹${result.amount.toLocaleString('en-IN')} (10%) added to your wallet. Trip complete!`,
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
      .select('agreedPrice platformCommission driverEarnings paymentStatus payoutStage loadingPayoutAmount deliveryPayoutAmount loadingPayoutAt deliveryPayoutAt paymentTransactionId paymentOrderId');

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

      const trip = await Trip.findOne({ paymentOrderId: order.order_id });
      if (trip && trip.paymentStatus === 'pending') {
        await Trip.findByIdAndUpdate(trip._id, {
          paymentStatus: 'captured',
          paymentTransactionId: payment?.cf_payment_id?.toString(),
        });
        logger.info(`Webhook: Payment captured for trip ${trip._id}`);
      }
    } else if (type === 'PAYMENT_FAILED_WEBHOOK') {
      const order = data?.order;
      if (!order?.order_id) return res.status(200).json({ ok: true });
      const trip = await Trip.findOne({ paymentOrderId: order.order_id });
      if (trip) {
        await Trip.findByIdAndUpdate(trip._id, { paymentStatus: 'failed' });
        logger.info(`Webhook: Payment failed for trip ${trip._id}`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(`[Cashfree Webhook] Error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
};
