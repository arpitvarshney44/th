const Trip = require('../models/Trip');
const Load = require('../models/Load');
const User = require('../models/User');
const Rating = require('../models/Rating');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const paymentController = require('./paymentController');
const logger = require('../config/logger');

// ─── DRIVER: Start trip (just marks started, no payout yet) ──────────────────
// PATCH /trips/:id/start
exports.startTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'accepted') return res.status(400).json({ success: false, message: 'Trip cannot be started.' });

    await Trip.findByIdAndUpdate(trip._id, { status: 'started', startTime: new Date() });
    await Load.findByIdAndUpdate(trip.load, { status: 'in_transit' });

    const transporter = await User.findById(trip.transporter);
    await notificationService.sendNotification(trip.transporter, {
      title: 'Driver En Route 🚛',
      body: 'Your driver has started heading to the pickup location.',
      type: 'trip',
      data: { tripId: trip._id.toString() },
      fcmToken: transporter?.fcmToken,
    });

    res.json({ success: true, message: 'Trip started.' });
  } catch (err) { next(err); }
};

// ─── DRIVER: Upload loading proof ─────────────────────────────────────────────
// PATCH /trips/:id/loading-proof
exports.uploadLoadingProof = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (!['started', 'accepted'].includes(trip.status)) {
      return res.status(400).json({ success: false, message: 'Cannot upload loading proof at this stage.' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'At least one photo is required.' });
    }

    const loadingProof = req.files.map(f => f.path);
    const { loadingNote } = req.body;

    await Trip.findByIdAndUpdate(trip._id, {
      status: 'in_transit',
      loadingProof,
      loadingNote: loadingNote || '',
    });

    // Notify transporter to approve loading
    const transporter = await User.findById(trip.transporter);
    await notificationService.sendNotification(trip.transporter, {
      title: 'Loading Complete — Approval Needed 📦',
      body: 'Driver has uploaded loading proof. Please review and approve to release 90% payment.',
      type: 'payment',
      data: { tripId: trip._id.toString(), action: 'approve_loading' },
      fcmToken: transporter?.fcmToken,
    });

    res.json({ success: true, message: 'Loading proof uploaded. Awaiting transporter approval.' });
  } catch (err) { next(err); }
};

// ─── TRANSPORTER: Approve loading → release 90% ───────────────────────────────
// PATCH /trips/:id/approve-loading
exports.approveLoading = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'in_transit') {
      return res.status(400).json({ success: false, message: 'Loading proof not yet submitted.' });
    }
    if (trip.payoutStage !== 'none') {
      return res.status(400).json({ success: false, message: 'Loading already approved.' });
    }

    await Trip.findByIdAndUpdate(trip._id, { loadingApprovedAt: new Date() });

    // Release 90% payout
    try {
      await paymentController.processLoadingPayout(trip._id);
    } catch (err) {
      logger.error('Loading payout failed:', err.message);
      return res.status(500).json({ success: false, message: 'Payout processing failed. Please try again.' });
    }

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Loading Approved! 💸',
      body: '90% of your payment has been released. Continue to delivery.',
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    res.json({ success: true, message: 'Loading approved. 90% payout initiated.' });
  } catch (err) { next(err); }
};

// ─── DRIVER: Upload delivery proof ────────────────────────────────────────────
// PATCH /trips/:id/complete  (existing endpoint, renamed semantically)
exports.completeTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id })
      .populate('transporter');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'in_transit') {
      return res.status(400).json({ success: false, message: 'Trip is not in transit.' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'At least one delivery photo is required.' });
    }

    const deliveryProof = req.files.map(f => f.path);
    const { deliveryNote } = req.body;

    await Trip.findByIdAndUpdate(trip._id, {
      status: 'delivered',
      deliveredTime: new Date(),
      deliveryProof,
      deliveryNote: deliveryNote || '',
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'delivered' });

    // Notify transporter to approve delivery
    await notificationService.sendNotification(trip.transporter._id, {
      title: 'Delivery Done — Approval Needed ✅',
      body: 'Driver has uploaded delivery proof. Please review and approve to release final 10% payment.',
      type: 'payment',
      data: { tripId: trip._id.toString(), action: 'approve_delivery' },
      fcmToken: trip.transporter.fcmToken,
    });

    res.json({ success: true, message: 'Delivery proof uploaded. Awaiting transporter approval.' });
  } catch (err) { next(err); }
};

// ─── TRANSPORTER: Approve delivery → release 10% ─────────────────────────────
// PATCH /trips/:id/approve-delivery
exports.approveDelivery = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Delivery proof not yet submitted.' });
    }
    if (trip.payoutStage === 'delivery_paid') {
      return res.status(400).json({ success: false, message: 'Delivery already approved.' });
    }

    await Trip.findByIdAndUpdate(trip._id, {
      deliveryApprovedAt: new Date(),
      status: 'completed',
      completedTime: new Date(),
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'completed' });
    await User.findByIdAndUpdate(trip.driver, { $inc: { totalTrips: 1 } });

    // Release 10% payout
    try {
      await paymentController.processDeliveryPayout(trip._id);
    } catch (err) {
      logger.error('Delivery payout failed:', err.message);
      // Fallback: credit to wallet
      if (trip.payoutStage !== 'delivery_paid') {
        const deliveryAmount = Math.round(trip.driverEarnings * 0.1);
        await walletService.credit(
          trip.driver,
          deliveryAmount,
          'Delivery payout (10%) - wallet fallback',
          'trip_earning',
          trip._id,
        );
      }
    }

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Trip Complete! 🎉',
      body: 'Final 10% payment has been released. Great job!',
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    res.json({ success: true, message: 'Delivery approved. Final payout initiated.' });
  } catch (err) { next(err); }
};

// ─── PATCH /trips/:id/location ────────────────────────────────────────────────
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    await Trip.findByIdAndUpdate(req.params.id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    await User.findByIdAndUpdate(req.user._id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    const io = req.app.get('io');
    if (io) io.to(`trip_${req.params.id}`).emit('location_update', { lat, lng, tripId: req.params.id });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── GET /shipments/active (transporter) ─────────────────────────────────────
exports.getActiveShipments = async (req, res, next) => {
  try {
    const trips = await Trip.find({
      transporter: req.user._id,
      status: { $in: ['accepted', 'started', 'in_transit', 'delivered'] },
    })
      .populate('load')
      .populate('driver', 'name phone rating profileImage')
      .populate('truck', 'registrationNumber type')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: trips });
  } catch (err) { next(err); }
};

// ─── GET /shipments/history (transporter) ────────────────────────────────────
exports.getShipmentHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const [shipments, total] = await Promise.all([
      Trip.find({ transporter: req.user._id, status: { $in: ['completed', 'cancelled'] } })
        .populate('load').populate('driver', 'name phone rating')
        .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Trip.countDocuments({ transporter: req.user._id, status: { $in: ['completed', 'cancelled'] } }),
    ]);
    res.json({ success: true, data: { shipments, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// ─── GET /shipments/:id ───────────────────────────────────────────────────────
exports.getShipmentById = async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('load')
      .populate('driver', 'name phone rating profileImage')
      .populate('truck', 'registrationNumber type capacity model');
    if (!trip) return res.status(404).json({ success: false, message: 'Shipment not found.' });
    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
};

// ─── POST /trips/:id/rate ─────────────────────────────────────────────────────
exports.rateTrip = async (req, res, next) => {
  try {
    const { score, comment, tags } = req.body;
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    const toUser = req.user.role === 'driver' ? trip.transporter : trip.driver;
    const existing = await Rating.findOne({ trip: trip._id, fromUser: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already rated.' });
    await Rating.create({ trip: trip._id, fromUser: req.user._id, toUser, score, comment, tags });
    const ratings = await Rating.find({ toUser });
    const avg = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
    await User.findByIdAndUpdate(toUser, { rating: Math.round(avg * 10) / 10, totalRatings: ratings.length });
    res.json({ success: true, message: 'Rating submitted.' });
  } catch (err) { next(err); }
};
