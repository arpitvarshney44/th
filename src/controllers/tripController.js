const Trip = require('../models/Trip');
const Load = require('../models/Load');
const User = require('../models/User');
const Rating = require('../models/Rating');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');

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
      title: 'Trip Started 🚛',
      body: 'Your driver has started the trip.',
      type: 'trip',
      data: { tripId: trip._id.toString() },
      fcmToken: transporter?.fcmToken,
    });

    res.json({ success: true, message: 'Trip started.' });
  } catch (err) { next(err); }
};

// PATCH /trips/:id/location
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    await Trip.findByIdAndUpdate(req.params.id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    await User.findByIdAndUpdate(req.user._id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });

    // Emit via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`trip_${req.params.id}`).emit('location_update', { lat, lng, tripId: req.params.id });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
};

// PATCH /trips/:id/complete
exports.completeTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id })
      .populate('transporter');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (!['started', 'in_transit'].includes(trip.status)) {
      return res.status(400).json({ success: false, message: 'Trip cannot be completed.' });
    }

    const deliveryProof = req.files?.map((f) => f.path) || [];
    const { deliveryNote } = req.body;

    await Trip.findByIdAndUpdate(trip._id, {
      status: 'delivered',
      deliveredTime: new Date(),
      deliveryProof,
      deliveryNote,
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'delivered' });

    // Credit driver wallet
    await walletService.credit(
      trip.driver,
      trip.driverEarnings,
      `Trip earnings - Load delivered`,
      'trip_earning',
      trip._id,
    );

    // Update driver stats
    await User.findByIdAndUpdate(trip.driver, { $inc: { totalTrips: 1 } });

    // Notify transporter
    await notificationService.sendNotification(trip.transporter._id, {
      title: 'Load Delivered! 📦',
      body: 'Your load has been delivered successfully.',
      type: 'trip',
      data: { tripId: trip._id.toString() },
      fcmToken: trip.transporter.fcmToken,
    });

    const updated = await Trip.findById(trip._id).populate('load').populate('driver', 'name phone rating');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

// GET /shipments/active (transporter)
exports.getActiveShipments = async (req, res, next) => {
  try {
    const trips = await Trip.find({
      transporter: req.user._id,
      status: { $in: ['accepted', 'started', 'in_transit'] },
    })
      .populate('load')
      .populate('driver', 'name phone rating profileImage')
      .populate('truck', 'registrationNumber type')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: trips });
  } catch (err) { next(err); }
};

// GET /shipments/history (transporter)
exports.getShipmentHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [shipments, total] = await Promise.all([
      Trip.find({ transporter: req.user._id, status: { $in: ['delivered', 'completed', 'cancelled'] } })
        .populate('load')
        .populate('driver', 'name phone rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Trip.countDocuments({ transporter: req.user._id, status: { $in: ['delivered', 'completed', 'cancelled'] } }),
    ]);

    res.json({ success: true, data: { shipments, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// GET /shipments/:id
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

// POST /trips/:id/rate
exports.rateTrip = async (req, res, next) => {
  try {
    const { score, comment, tags } = req.body;
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

    const toUser = req.user.role === 'driver' ? trip.transporter : trip.driver;

    const existing = await Rating.findOne({ trip: trip._id, fromUser: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already rated.' });

    await Rating.create({ trip: trip._id, fromUser: req.user._id, toUser, score, comment, tags });

    // Update user average rating
    const ratings = await Rating.find({ toUser });
    const avg = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
    await User.findByIdAndUpdate(toUser, { rating: Math.round(avg * 10) / 10, totalRatings: ratings.length });

    res.json({ success: true, message: 'Rating submitted.' });
  } catch (err) { next(err); }
};
