const Trip = require('../models/Trip');
const Load = require('../models/Load');
const User = require('../models/User');
const razorpayService = require('../services/razorpayService');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const logger = require('../config/logger');

// ─── Transporter: Create Payment Order ────────────────────────────────────────

// POST /payments/create-order
exports.createOrder = async (req, res, next) => {
  try {
    const { tripId } = req.body;
    const trip = await Trip.findOne({ _id: tripId, transporter: req.user._id })
      .populate('load');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.paymentStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'Payment already processed.' });
    }

    const amount = trip.agreedPrice;
    const receipt = `trip_${trip._id}`;
    const notes = {
      tripId: trip._id.toString(),
      loadId: trip.load._id.toString(),
      transporterId: req.user._id.toString(),
    };

    const order = await razorpayService.createOrder(amount, 'INR', receipt, notes);

    await Trip.findByIdAndUpdate(trip._id, { razorpayOrderId: order.id });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        tripId: trip._id,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) { next(err); }
};

// ─── Transporter: Verify Payment ──────────────────────────────────────────────

// POST /payments/verify
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, tripId } = req.body;

    // Verify Razorpay signature
    const isValid = razorpayService.verifyPaymentSignature(
      razorpay_order_id, razorpay_payment_id, razorpay_signature
    );
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    const trip = await Trip.findById(tripId).populate('load').populate('driver');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

    // Update trip with payment info
    await Trip.findByIdAndUpdate(trip._id, {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      paymentStatus: 'captured',
    });

    // Debit transporter wallet (record the payment)
    await walletService.debit(
      trip.transporter,
      trip.agreedPrice,
      `Payment for load ${trip.load.pickupLocation.city} → ${trip.load.dropLocation.city}`,
      'trip_payment',
      trip._id,
    ).catch(() => {
      // If wallet debit fails (insufficient balance), that's ok - payment was via Razorpay
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
      referenceId: razorpay_payment_id,
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

    res.json({ success: true, message: 'Payment verified successfully.', data: { paymentId: razorpay_payment_id } });
  } catch (err) { next(err); }
};

// ─── Payout to Driver (called internally) ─────────────────────────────────────

const processDriverPayout = async (trip, percentage, stage) => {
  const driver = await User.findById(trip.driver);
  if (!driver) throw new Error('Driver not found');

  const amount = Math.round(trip.driverEarnings * percentage);

  await walletService.credit(
    driver._id,
    amount,
    `${stage === 'loading_paid' ? 'Loading' : 'Delivery'} payout (${Math.round(percentage * 100)}%)`,
    'trip_earning',
    trip._id,
  );

  return { id: `wallet_${Date.now()}`, status: 'wallet_credited', amount };
};


// ─── Trip Start → 90% Payout ─────────────────────────────────────────────────

exports.processLoadingPayout = async (tripId) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error('Trip not found');
  if (trip.payoutStage !== 'none') {
    logger.info(`Trip ${tripId} already has payout stage: ${trip.payoutStage}`);
    return null;
  }
  if (trip.paymentStatus !== 'captured') {
    logger.info(`Trip ${tripId} payment not captured yet, skipping payout`);
    return null;
  }

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
      title: 'Payout Released! 💸',
      body: `₹${result.amount.toLocaleString('en-IN')} (90%) has been released for loading.`,
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    logger.info(`Loading payout of ₹${result.amount} processed for trip ${tripId}`);
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

    await Trip.findByIdAndUpdate(tripId, {
      payoutStage: 'delivery_paid',
      paymentStatus: 'completed',
      deliveryPayoutAmount: result.amount,
      deliveryPayoutId: result.id,
      deliveryPayoutAt: new Date(),
      paymentReleasedAt: new Date(),
    });

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Final Payout! 🎉',
      body: `₹${result.amount.toLocaleString('en-IN')} (10%) released. Full payment complete!`,
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    logger.info(`Delivery payout of ₹${result.amount} processed for trip ${tripId}`);
    return result;
  } catch (err) {
    logger.error(`Delivery payout failed for trip ${tripId}:`, err);
    throw err;
  }
};

// ─── GET /payments/trip/:tripId ───────────────────────────────────────────────

exports.getTripPaymentDetails = async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.tripId)
      .populate('load', 'pickupLocation dropLocation')
      .select('agreedPrice platformCommission driverEarnings paymentStatus payoutStage loadingPayoutAmount deliveryPayoutAmount loadingPayoutAt deliveryPayoutAt razorpayPaymentId');

    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
};

// ─── Razorpay Webhook ─────────────────────────────────────────────────────────

exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      const isValid = razorpayService.verifyWebhookSignature(body, signature);
      if (!isValid) return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload;

    switch (event) {
      case 'payment.captured': {
        const payment = payload.payment.entity;
        const orderId = payment.order_id;
        const trip = await Trip.findOne({ razorpayOrderId: orderId });
        if (trip && trip.paymentStatus === 'pending') {
          await Trip.findByIdAndUpdate(trip._id, {
            paymentStatus: 'captured',
            razorpayPaymentId: payment.id,
          });
          logger.info(`Webhook: Payment captured for trip ${trip._id}`);
        }
        break;
      }
      case 'payment.failed': {
        const payment = payload.payment.entity;
        const orderId = payment.order_id;
        const trip = await Trip.findOne({ razorpayOrderId: orderId });
        if (trip) {
          await Trip.findByIdAndUpdate(trip._id, { paymentStatus: 'failed' });
          logger.info(`Webhook: Payment failed for trip ${trip._id}`);
        }
        break;
      }
      case 'payout.processed':
      case 'payout.reversed': {
        logger.info(`Webhook: Payout event ${event}`, payload);
        break;
      }
      default:
        logger.info(`Webhook: Unhandled event ${event}`);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Webhook error:', err);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};
