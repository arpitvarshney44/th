const router = require('express').Router();
const { protectAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.use(protectAdmin);

// Dashboard
router.get('/dashboard', ctrl.getDashboardStats);
router.get('/analytics', ctrl.getAnalytics);

// Users
router.get('/users', ctrl.getUsers);
router.get('/users/:id', ctrl.getUserById);
router.put('/users/:id', ctrl.updateUser);
router.patch('/users/:id/block', ctrl.blockUser);
router.patch('/users/:id/unblock', ctrl.unblockUser);

// Verification
router.get('/verifications', ctrl.getPendingVerifications);
router.get('/verifications/trucks', ctrl.getPendingTrucks);
router.patch('/verifications/users/:id', ctrl.verifyUser);
router.patch('/verifications/trucks/:id', ctrl.verifyTruck);

// Loads & Trips
router.get('/loads', ctrl.getAllLoads);
router.get('/loads/:id', async (req, res, next) => {
  try {
    const Load = require('../models/Load');
    const load = await Load.findById(req.params.id).populate('transporter', 'name companyName phone email gstNumber');
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    res.json({ success: true, data: load });
  } catch (err) { next(err); }
});
router.get('/trips', ctrl.getAllTrips);
router.get('/trips/:id', async (req, res, next) => {
  try {
    const Trip = require('../models/Trip');
    const Truck = require('../models/Truck');
    const trip = await Trip.findById(req.params.id)
      .populate('load')
      .populate('driver', 'name phone licenseNumber licenseImage aadharImage panImage driverPhoto profileImage bankAccount')
      .populate('transporter', 'name companyName phone email gstNumber profileImage');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    const truck = trip.truck ? await Truck.findById(trip.truck) : null;
    res.json({ success: true, data: { ...trip.toObject(), truckDetails: truck } });
  } catch (err) { next(err); }
});

// Payments
router.get('/transactions', ctrl.getTransactions);
router.get('/trip-payments', ctrl.getTripPayments);

// Withdrawals
router.get('/withdrawals', ctrl.getWithdrawals);
router.post('/withdrawals/:id/retry', ctrl.retryWithdrawal);
router.post('/withdrawals/:id/refresh', ctrl.refreshWithdrawalStatus);
router.post('/withdrawals/:id/mark-paid', ctrl.markWithdrawalPaid);
router.post('/withdrawals/:id/reject', ctrl.rejectWithdrawal);

// Support
router.get('/tickets', ctrl.getTickets);
router.post('/tickets/:id/reply', ctrl.replyTicket);
router.patch('/tickets/:id/close', ctrl.closeTicket);

// Notifications
router.post('/notifications/broadcast', ctrl.broadcastNotification);

// Send to specific user
router.post('/notifications/send-to-user', async (req, res, next) => {
  try {
    const { userId, title, body } = req.body;
    if (!userId || !title || !body) {
      return res.status(400).json({ success: false, message: 'userId, title, and body are required.' });
    }
    const User = require('../models/User');
    const notificationService = require('../services/notificationService');
    const user = await User.findById(userId).select('_id fcmToken name');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const result = await notificationService.sendToUser(userId, {
      title, body, type: 'system', fcmToken: user.fcmToken, sentBy: req.user._id,
    });
    res.json({
      success: true,
      message: `Notification sent to ${user.name || 'user'}`,
      pushStatus: result.status,
    });
  } catch (err) { next(err); }
});

// Notification history
router.get('/notifications/history', async (req, res, next) => {
  try {
    const Notification = require('../models/Notification');
    const { page = 1, limit = 30, type } = req.query;
    const query = {};
    if (type) query.type = type;
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('user', 'name phone role')
        .populate('sentBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Notification.countDocuments(query),
    ]);
    res.json({ success: true, data: { notifications, total, page: Number(page) } });
  } catch (err) { next(err); }
});

// Notification delivery stats
router.get('/notifications/stats', async (req, res, next) => {
  try {
    const Notification = require('../models/Notification');
    const [total, sent, failed, noToken, read] = await Promise.all([
      Notification.countDocuments(),
      Notification.countDocuments({ pushStatus: 'sent' }),
      Notification.countDocuments({ pushStatus: 'failed' }),
      Notification.countDocuments({ pushStatus: 'no_token' }),
      Notification.countDocuments({ isRead: true }),
    ]);
    // Last 7 days daily breakdown
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const daily = await Notification.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$pushStatus', 'sent'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$pushStatus', 'failed'] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, data: { total, sent, failed, noToken, read, daily } });
  } catch (err) { next(err); }
});

// Search users for send-to-user
router.get('/notifications/search-users', async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });
    const users = await User.find({
      role: { $ne: 'admin' },
      $or: [
        { name: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
        { companyName: new RegExp(q, 'i') },
      ],
    }).select('_id name phone role companyName profileImage fcmToken').limit(10);
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// TDS Declarations
const TDSDeclaration = require('../models/TDSDeclaration');
router.get('/tds-declarations', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { declarantName: new RegExp(search, 'i') },
        { companyName: new RegExp(search, 'i') },
        { panNumber: new RegExp(search, 'i') },
      ];
    }
    const skip = (page - 1) * limit;
    const [declarations, total] = await Promise.all([
      TDSDeclaration.find(query)
        .populate('driver', 'name phone profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      TDSDeclaration.countDocuments(query),
    ]);
    res.json({ success: true, data: { declarations, total, page: Number(page) } });
  } catch (err) { next(err); }
});

// ─── CONTACT NUMBERS MANAGEMENT ───────────────────────────────────────────────
const ContactNumber = require('../models/ContactNumber');

// GET /admin/contacts
router.get('/contacts', async (req, res, next) => {
  try {
    const contacts = await ContactNumber.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: contacts });
  } catch (err) { next(err); }
});

// POST /admin/contacts
router.post('/contacts', async (req, res, next) => {
  try {
    const { name, phone, designation } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    const contact = await ContactNumber.create({ name, phone, designation, createdBy: req.user._id });
    res.status(201).json({ success: true, data: contact });
  } catch (err) { next(err); }
});

// PUT /admin/contacts/:id
router.put('/contacts/:id', async (req, res, next) => {
  try {
    const { name, phone, designation } = req.body;
    const contact = await ContactNumber.findByIdAndUpdate(req.params.id, { name, phone, designation }, { new: true });
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
});

// DELETE /admin/contacts/:id
router.delete('/contacts/:id', async (req, res, next) => {
  try {
    await ContactNumber.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Contact deleted.' });
  } catch (err) { next(err); }
});

// PATCH /admin/trips/:id/assign-contact — Assign a contact number to a trip
const Trip = require('../models/Trip');
router.patch('/trips/:id/assign-contact', async (req, res, next) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ success: false, message: 'contactId is required.' });

    const contact = await ContactNumber.findById(contactId);
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });

    const trip = await Trip.findByIdAndUpdate(req.params.id, {
      assignedContact: {
        name: contact.name,
        phone: contact.phone,
        designation: contact.designation,
      },
    }, { new: true });

    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
});

const upload = require('../middleware/upload');
router.get('/memo-settings', ctrl.getMemoSettings);
router.post('/memo-settings', upload.fields([
  { name: 'cheque', maxCount: 1 },
  { name: 'pan', maxCount: 1 }
]), ctrl.updateMemoSettings);

// ─── STAFF MANAGEMENT (super admin only) ──────────────────────────────────────
const bcrypt = require('bcryptjs');

// Middleware: only super admin can manage staff
const superOnly = (req, res, next) => {
  if (req.user.adminLevel !== 'super') {
    return res.status(403).json({ success: false, message: 'Only super admin can manage staff.' });
  }
  next();
};

// GET /admin/staff — list all admin staff
router.get('/staff', superOnly, async (req, res, next) => {
  try {
    const User = require('../models/User');
    const staff = await User.find({ role: 'admin' })
      .select('name email adminLevel isActive isBlocked createdAt lastLogin')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
});

// POST /admin/staff — create new staff member
router.post('/staff', superOnly, async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { name, email, password, adminLevel } = req.body;
    if (!name || !email || !password || !adminLevel) {
      return res.status(400).json({ success: false, message: 'name, email, password, and adminLevel are required.' });
    }
    if (!['trucker', 'shipper'].includes(adminLevel)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be trucker or shipper.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already exists.' });

    const user = await User.create({
      name, email, password, role: 'admin', adminLevel, isActive: true,
    });
    res.status(201).json({
      success: true,
      data: { id: user._id, name: user.name, email: user.email, adminLevel: user.adminLevel },
    });
  } catch (err) { next(err); }
});

// PUT /admin/staff/:id — update staff
router.put('/staff/:id', superOnly, async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { name, email, adminLevel, password } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (adminLevel) updates.adminLevel = adminLevel;
    if (password) updates.password = await bcrypt.hash(password, 12);
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
      .select('name email adminLevel isActive isBlocked');
    if (!user) return res.status(404).json({ success: false, message: 'Staff not found.' });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// DELETE /admin/staff/:id — deactivate staff
router.delete('/staff/:id', superOnly, async (req, res, next) => {
  try {
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.params.id, { isActive: false, isBlocked: true });
    res.json({ success: true, message: 'Staff deactivated.' });
  } catch (err) { next(err); }
});

// ─── LOAD EDITING (trucker + super) ───────────────────────────────────────────
const Load = require('../models/Load');

// GET /admin/drivers-with-trucks?search= — for assign-driver modal
router.get('/drivers-with-trucks', async (req, res, next) => {
  try {
    const User = require('../models/User');
    const Truck = require('../models/Truck');
    const Trip = require('../models/Trip');

    const { search = '', page = 1, limit = 20 } = req.query;
    const query = { role: { $in: ['driver', 'fleet_owner'] }, isBlocked: false };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const drivers = await User.find(query)
      .select('name phone rating totalTrips profileImage isAvailable verificationStatus')
      .sort({ rating: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const ACTIVE = ['accepted', 'started', 'in_transit', 'delivered'];
    // Treat trips whose underlying load is cancelled as "free" — truck is available again.
    const cancelledLoadIds = await Load.find({ status: 'cancelled' }).distinct('_id');

    const result = await Promise.all(drivers.map(async (d) => {
      const trucks = await Truck.find({ owner: d._id, verificationStatus: 'approved' })
        .select('registrationNumber type capacity model year');

      // For each truck, check if it's on an active trip
      const trucksWithStatus = await Promise.all(trucks.map(async (t) => {
        const activeTrip = await Trip.findOne({
          truck: t._id,
          status: { $in: ACTIVE },
          load: { $nin: cancelledLoadIds },
        })
          .select('status load')
          .populate('load', 'pickupLocation dropLocation');
        return {
          ...t.toObject(),
          isOnTrip: !!activeTrip,
          activeTrip: activeTrip ? {
            status: activeTrip.status,
            route: activeTrip.load
              ? `${activeTrip.load.pickupLocation?.city} → ${activeTrip.load.dropLocation?.city}`
              : null,
          } : null,
        };
      }));

      return { ...d.toObject(), trucks: trucksWithStatus };
    }));

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /admin/loads/:id/assign-driver — admin directly assigns a driver to a load
router.post('/loads/:id/assign-driver', async (req, res, next) => {
  try {
    if (!['super', 'manager'].includes(req.user.adminLevel)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const { driverId, truckId, agreedPrice } = req.body;
    if (!driverId || !truckId || !agreedPrice) {
      return res.status(400).json({ success: false, message: 'driverId, truckId and agreedPrice are required.' });
    }

    const User = require('../models/User');
    const Truck = require('../models/Truck');
    const Trip = require('../models/Trip');
    const platformSettings = require('../services/platformSettings');

    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    if (!['posted', 'bidding'].includes(load.status)) {
      return res.status(400).json({ success: false, message: `Cannot assign driver — load is already ${load.status}.` });
    }

    const driver = await User.findOne({ _id: driverId, role: { $in: ['driver', 'fleet_owner'] } });
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found.' });

    const truck = await Truck.findOne({ _id: truckId, owner: driverId });
    if (!truck) return res.status(404).json({ success: false, message: 'Truck not found or does not belong to this driver.' });

    // Check truck is not already on an active trip (skip cancelled-load trips)
    const ACTIVE = ['accepted', 'started', 'in_transit', 'delivered'];
    const cancelledLoadIds = await Load.find({ status: 'cancelled' }).distinct('_id');
    const truckBusy = await Trip.findOne({
      truck: truckId,
      status: { $in: ACTIVE },
      load: { $nin: cancelledLoadIds },
    });
    if (truckBusy) {
      return res.status(400).json({ success: false, message: 'This truck is currently on another active trip.' });
    }

    const split = await platformSettings.computeSplit(Number(agreedPrice));

    const trip = await Trip.create({
      load: load._id,
      driver: driverId,
      transporter: load.transporter,
      truck: truckId,
      agreedPrice: split.agreedPrice,
      platformCommission: split.commission,
      driverEarnings: split.driverEarnings,
      assignedByAdmin: req.user._id,
    });

    await Promise.all([
      Load.findByIdAndUpdate(load._id, {
        status: 'assigned',
        assignedDriver: driverId,
        assignedTruck: truckId,
      }),
    ]);

    const notificationService = require('../services/notificationService');
    await notificationService.sendNotification(driverId, {
      title: 'Load Assigned! 🚛',
      body: `You have been assigned a load from ${load.pickupLocation.city} to ${load.dropLocation.city}.`,
      type: 'trip',
      data: { tripId: trip._id.toString() },
      fcmToken: driver.fcmToken,
    });

    const populated = await Trip.findById(trip._id)
      .populate('load', 'pickupLocation dropLocation loadType weight offeredPrice')
      .populate('driver', 'name phone')
      .populate('truck', 'registrationNumber type');

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
});

// POST /admin/loads — create a load on behalf of a transporter
router.post('/loads', async (req, res, next) => {
  try {
    if (!['super', 'manager', 'trucker'].includes(req.user.adminLevel)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const User = require('../models/User');
    const {
      transporterId, pickupLocation, dropLocation, loadType, weight,
      truckTypeRequired, offeredPrice, pickupDate, pickupTime, description,
    } = req.body;

    if (!transporterId) {
      return res.status(400).json({ success: false, message: 'transporterId is required.' });
    }
    const transporter = await User.findOne({ _id: transporterId, role: 'transporter' });
    if (!transporter) {
      return res.status(404).json({ success: false, message: 'Transporter not found.' });
    }

    const { getRoadDistance } = require('../services/distanceService');
    const geocodeCity = async (city, state) => {
      if (!city) return null;
      try {
        const query = `${city}, ${state || ''}`.trim();
        const { data } = await require('axios').get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: { address: query, key: process.env.GOOGLE_MAPS_API_KEY },
        });
        const loc = data?.results?.[0]?.geometry?.location;
        return loc ? { lat: loc.lat, lng: loc.lng } : null;
      } catch { return null; }
    };

    let originLat = pickupLocation?.latitude || 0;
    let originLng = pickupLocation?.longitude || 0;
    let destLat = dropLocation?.latitude || 0;
    let destLng = dropLocation?.longitude || 0;

    if (originLat === 0 && originLng === 0) {
      const geo = await geocodeCity(pickupLocation?.city, pickupLocation?.state);
      if (geo) { originLat = geo.lat; originLng = geo.lng; }
    }
    if (destLat === 0 && destLng === 0) {
      const geo = await geocodeCity(dropLocation?.city, dropLocation?.state);
      if (geo) { destLat = geo.lat; destLng = geo.lng; }
    }

    const distance = await getRoadDistance(originLat, originLng, destLat, destLng);

    const load = await Load.create({
      transporter: transporterId,
      pickupLocation: {
        ...pickupLocation,
        latitude: originLat, longitude: originLng,
        coordinates: { type: 'Point', coordinates: [originLng, originLat] },
      },
      dropLocation: {
        ...dropLocation,
        latitude: destLat, longitude: destLng,
        coordinates: { type: 'Point', coordinates: [destLng, destLat] },
      },
      loadType, weight, truckTypeRequired, offeredPrice, distance,
      pickupDate, pickupTime, description: description || '',
      status: 'posted',
      postedByAdmin: req.user._id,
    });

    const populated = await Load.findById(load._id).populate('transporter', 'name companyName phone');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
});

// PATCH /admin/loads/:id/cancel — admin cancel a load (any status except completed)
router.patch('/loads/:id/cancel', async (req, res, next) => {
  try {
    if (!['super', 'manager'].includes(req.user.adminLevel)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const { reason } = req.body;
    const Bid = require('../models/Bid');
    const Trip = require('../models/Trip');
    const notificationService = require('../services/notificationService');
    const User = require('../models/User');

    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    if (['completed', 'cancelled'].includes(load.status)) {
      return res.status(400).json({ success: false, message: `Load is already ${load.status}.` });
    }

    const cancelReason = reason || 'Cancelled by admin';

    // 1. Mark load cancelled
    await Load.findByIdAndUpdate(load._id, {
      status: 'cancelled',
      cancelReason,
      cancelledBy: req.user._id,
    });

    // 2. Reject all pending bids
    await Bid.updateMany({ load: load._id, status: 'pending' }, { status: 'rejected' });

    // 3. Cascade-cancel any active trips on this load (admin's load cancel = full cancel)
    const ACTIVE = ['accepted', 'started', 'in_transit', 'delivered'];
    const activeTrips = await Trip.find({ load: load._id, status: { $in: ACTIVE } });
    if (activeTrips.length > 0) {
      await Trip.updateMany(
        { load: load._id, status: { $in: ACTIVE } },
        {
          status: 'cancelled',
          cancelReason,
          cancelledBy: req.user._id,
        },
      );
      // Notify driver(s) and transporter(s)
      for (const t of activeTrips) {
        try {
          const driver = await User.findById(t.driver).select('fcmToken');
          await notificationService.sendNotification(t.driver, {
            title: 'Trip Cancelled',
            body: `The load from ${load.pickupLocation?.city || ''} to ${load.dropLocation?.city || ''} was cancelled by admin.`,
            type: 'trip',
            data: { tripId: t._id.toString() },
            fcmToken: driver?.fcmToken,
          });
        } catch (_) {}
        try {
          const transporter = await User.findById(t.transporter).select('fcmToken');
          await notificationService.sendNotification(t.transporter, {
            title: 'Load Cancelled',
            body: `Your load from ${load.pickupLocation?.city || ''} to ${load.dropLocation?.city || ''} was cancelled by admin.`,
            type: 'load',
            data: { loadId: load._id.toString() },
            fcmToken: transporter?.fcmToken,
          });
        } catch (_) {}
      }
    }

    res.json({
      success: true,
      message: activeTrips.length > 0
        ? `Load cancelled. ${activeTrips.length} active trip(s) also cancelled.`
        : 'Load cancelled.',
    });
  } catch (err) { next(err); }
});

// PUT /admin/loads/:id — edit load details (not status)
router.put('/loads/:id', async (req, res, next) => {
  try {
    if (!['super', 'trucker'].includes(req.user.adminLevel)) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit loads.' });
    }
    const { pickupLocation, dropLocation, loadType, weight, truckTypeRequired, offeredPrice, pickupDate, pickupTime, description } = req.body;
    const updates = {};
    if (pickupLocation) updates.pickupLocation = pickupLocation;
    if (dropLocation) updates.dropLocation = dropLocation;
    if (loadType) updates.loadType = loadType;
    if (weight) updates.weight = weight;
    if (truckTypeRequired) updates.truckTypeRequired = truckTypeRequired;
    if (offeredPrice) updates.offeredPrice = offeredPrice;
    if (pickupDate) updates.pickupDate = pickupDate;
    if (pickupTime) updates.pickupTime = pickupTime;
    if (description !== undefined) updates.description = description;
    // Status cannot be changed by trucker
    const load = await Load.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate('transporter', 'name companyName phone');
    if (!load) return res.status(404).json({ success: false, message: 'Load not found.' });
    res.json({ success: true, data: load });
  } catch (err) { next(err); }
});

module.exports = router;
