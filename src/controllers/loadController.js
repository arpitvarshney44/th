const Load = require('../models/Load');
const Bid = require('../models/Bid');
const Trip = require('../models/Trip');
const User = require('../models/User');
const Truck = require('../models/Truck');
const notificationService = require('../services/notificationService');
const walletService = require('../services/walletService');

// ─── DRIVER ENDPOINTS ─────────────────────────────────────────────────────────

// GET /loads/nearby
exports.getNearbyLoads = async (req, res, next) => {
  try {
    const { lat, lng, radius = 100 } = req.query;
    const query = { status: 'posted' };

    if (lat && lng) {
      query['pickupLocation.coordinates'] = {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: radius * 1000,
        },
      };
    }

    const loads = await Load.find(query)
      .populate('transporter', 'name companyName rating profileImage')
      .sort({ createdAt: -1 })
      .limit(20);

    const formatted = loads.map(formatLoad);
    res.json({ success: true, data: formatted });
  } catch (err) { next(err); }
};

// GET /loads/recommended
exports.getRecommendedLoads = async (req, res, next) => {
  try {
    const driver = req.user;
    const trucks = await Truck.find({ owner: driver._id, isActive: true });
    const truckTypes = trucks.map((t) => t.type);

    const query = { status: 'posted' };
    if (truckTypes.length) query.truckTypeRequired = { $in: truckTypes };

    const loads = await Load.find(query)
      .populate('transporter', 'name companyName rating profileImage')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ success: true, data: loads.map(formatLoad) });
  } catch (err) { next(err); }
};

// GET /loads
exports.getAllLoads = async (req, res, next) => {
  try {
    const { pickupCity, dropCity, truckType, minWeight, maxWeight, maxDistance, page = 1, limit = 20 } = req.query;
    const query = { status: 'posted' };

    if (pickupCity) query['pickupLocation.city'] = new RegExp(pickupCity, 'i');
    if (dropCity) query['dropLocation.city'] = new RegExp(dropCity, 'i');
    if (truckType) query.truckTypeRequired = truckType;
    if (minWeight || maxWeight) {
      query.weight = {};
      if (minWeight) query.weight.$gte = Number(minWeight);
      if (maxWeight) query.weight.$lte = Number(maxWeight);
    }
    if (maxDistance) query.distance = { $lte: Number(maxDistance) };

    const skip = (page - 1) * limit;
    const [loads, total] = await Promise.all([
      Load.find(query)
        .populate('transporter', 'name companyName rating profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Load.countDocuments(query),
    ]);

    res.json({ success: true, data: { loads: loads.map(formatLoad), total, page: Number(page) } });
  } catch (err) { next(err); }
};

// GET /loads/:id
exports.getLoadById = async (req, res, next) => {
  try {
    const load = await Load.findById(req.params.id)
      .populate('transporter', 'name companyName rating profileImage phone');
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    res.json({ success: true, data: formatLoad(load) });
  } catch (err) { next(err); }
};

// POST /loads/:id/accept
exports.acceptLoad = async (req, res, next) => {
  try {
    const { truckId } = req.body;
    const load = await Load.findById(req.params.id).populate('transporter');
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    if (load.status !== 'posted') return res.status(400).json({ success: false, message: 'Load is no longer available.' });

    const truck = await Truck.findOne({ _id: truckId, owner: req.user._id });
    if (!truck) return res.status(400).json({ success: false, message: 'Truck not found.' });

    // Create trip
    const commission = Math.round(load.offeredPrice * (Number(process.env.PLATFORM_COMMISSION || 10) / 100));
    const trip = await Trip.create({
      load: load._id,
      driver: req.user._id,
      transporter: load.transporter._id,
      truck: truck._id,
      agreedPrice: load.offeredPrice,
      platformCommission: commission,
      driverEarnings: load.offeredPrice - commission,
    });

    await Load.findByIdAndUpdate(load._id, {
      status: 'assigned',
      assignedDriver: req.user._id,
      assignedTruck: truck._id,
    });

    // Notify transporter
    await notificationService.sendNotification(load.transporter._id, {
      title: 'Load Accepted!',
      body: `${req.user.name || 'A driver'} has accepted your load from ${load.pickupLocation.city} to ${load.dropLocation.city}.`,
      type: 'trip',
      data: { tripId: trip._id.toString(), loadId: load._id.toString() },
      fcmToken: load.transporter.fcmToken,
    });

    const populated = await Trip.findById(trip._id).populate('load').populate('transporter', 'name companyName phone rating');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// POST /loads/:id/bid
exports.placeBid = async (req, res, next) => {
  try {
    const { truckId, bidAmount } = req.body;
    const load = await Load.findById(req.params.id);
    if (!load || load.status !== 'posted') {
      return res.status(400).json({ success: false, message: 'Load not available for bidding.' });
    }

    const existing = await Bid.findOne({ load: load._id, driver: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'You already placed a bid.' });

    const bid = await Bid.create({
      load: load._id,
      driver: req.user._id,
      truck: truckId,
      amount: bidAmount,
    });

    await Load.findByIdAndUpdate(load._id, { status: 'bidding' });

    const transporter = await User.findById(load.transporter);
    await notificationService.sendNotification(load.transporter, {
      title: 'New Bid Received!',
      body: `A driver bid ₹${bidAmount.toLocaleString('en-IN')} on your load.`,
      type: 'bid',
      data: { loadId: load._id.toString(), bidId: bid._id.toString() },
      fcmToken: transporter?.fcmToken,
    });

    const populated = await Bid.findById(bid._id).populate('driver', 'name rating totalTrips').populate('truck');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ─── TRANSPORTER ENDPOINTS ────────────────────────────────────────────────────

// POST /loads
exports.postLoad = async (req, res, next) => {
  try {
    const { pickupLocation, dropLocation, loadType, weight, truckTypeRequired, offeredPrice, pickupDate, pickupTime, description } = req.body;

    // Calculate rough distance (simplified)
    const distance = Math.floor(Math.random() * 800 + 50); // TODO: integrate Google Maps Distance API

    const load = await Load.create({
      transporter: req.user._id,
      pickupLocation: {
        ...pickupLocation,
        coordinates: { type: 'Point', coordinates: [pickupLocation.longitude || 0, pickupLocation.latitude || 0] },
      },
      dropLocation: {
        ...dropLocation,
        coordinates: { type: 'Point', coordinates: [dropLocation.longitude || 0, dropLocation.latitude || 0] },
      },
      loadType,
      weight,
      truckTypeRequired,
      offeredPrice,
      distance,
      pickupDate,
      pickupTime,
      description,
    });

    res.status(201).json({ success: true, data: formatLoad(load) });
  } catch (err) { next(err); }
};

// GET /loads/mine
exports.getMyLoads = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { transporter: req.user._id };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [loads, total] = await Promise.all([
      Load.find(query)
        .populate('assignedDriver', 'name phone rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Load.countDocuments(query),
    ]);

    // Attach bids count
    const loadsWithBids = await Promise.all(
      loads.map(async (l) => {
        const bids = await Bid.find({ load: l._id, status: 'pending' })
          .populate('driver', 'name rating totalTrips phone')
          .populate('truck', 'registrationNumber type capacity');
        return { ...l.toObject(), bids };
      }),
    );

    res.json({ success: true, data: { loads: loadsWithBids, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// GET /loads/:id/bids
exports.getLoadBids = async (req, res, next) => {
  try {
    const load = await Load.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });

    const bids = await Bid.find({ load: load._id, status: 'pending' })
      .populate('driver', 'name rating totalTrips phone profileImage')
      .populate('truck', 'registrationNumber type capacity model');

    res.json({ success: true, data: bids });
  } catch (err) { next(err); }
};

// POST /loads/:id/bids/:bidId/accept
exports.acceptBid = async (req, res, next) => {
  try {
    const { bidId } = req.params;
    const load = await Load.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });

    const bid = await Bid.findById(bidId).populate('driver').populate('truck');
    if (!bid || bid.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Bid not available.' });
    }

    const commission = Math.round(bid.amount * (Number(process.env.PLATFORM_COMMISSION || 10) / 100));
    const trip = await Trip.create({
      load: load._id,
      driver: bid.driver._id,
      transporter: req.user._id,
      truck: bid.truck._id,
      bid: bid._id,
      agreedPrice: bid.amount,
      platformCommission: commission,
      driverEarnings: bid.amount - commission,
    });

    await Promise.all([
      Bid.findByIdAndUpdate(bidId, { status: 'accepted' }),
      Bid.updateMany({ load: load._id, _id: { $ne: bidId } }, { status: 'rejected' }),
      Load.findByIdAndUpdate(load._id, { status: 'assigned', assignedDriver: bid.driver._id, assignedTruck: bid.truck._id }),
    ]);

    await notificationService.sendNotification(bid.driver._id, {
      title: 'Bid Accepted! 🎉',
      body: `Your bid of ₹${bid.amount.toLocaleString('en-IN')} was accepted. Get ready for the trip!`,
      type: 'bid',
      data: { tripId: trip._id.toString() },
      fcmToken: bid.driver.fcmToken,
    });

    const populated = await Trip.findById(trip._id).populate('load').populate('driver', 'name phone rating');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// POST /loads/:id/bids/:bidId/reject
exports.rejectBid = async (req, res, next) => {
  try {
    await Bid.findByIdAndUpdate(req.params.bidId, { status: 'rejected' });
    res.json({ success: true, message: 'Bid rejected.' });
  } catch (err) { next(err); }
};

// PATCH /loads/:id/cancel
exports.cancelLoad = async (req, res, next) => {
  try {
    const load = await Load.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    if (!['posted', 'bidding'].includes(load.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel this load.' });
    }
    await Load.findByIdAndUpdate(load._id, { status: 'cancelled', cancelledBy: req.user._id });
    await Bid.updateMany({ load: load._id }, { status: 'rejected' });
    res.json({ success: true, message: 'Load cancelled.' });
  } catch (err) { next(err); }
};

// ─── Helper ───────────────────────────────────────────────────────────────────
const formatLoad = (load) => {
  const obj = load.toObject ? load.toObject() : load;
  const t = obj.transporter;
  return {
    ...obj,
    id: obj._id || obj.id,
    transporterId: t?._id || obj.transporter,
    transporterName: t?.companyName || t?.name || 'Unknown',
    transporterRating: t?.rating || 0,
    transporterImage: t?.profileImage,
  };
};
