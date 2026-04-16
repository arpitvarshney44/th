const User = require('../models/User');
const Truck = require('../models/Truck');
const Load = require('../models/Load');
const Trip = require('../models/Trip');
const Transaction = require('../models/Transaction');
const SupportTicket = require('../models/SupportTicket');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalDrivers, totalTransporters, totalLoads, totalTrips,
      activeTrips, pendingVerifications, todayTrips, monthTrips,
      revenueData, pendingTickets,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: ['driver', 'fleet_owner'] }, isActive: true }),
      User.countDocuments({ role: 'transporter', isActive: true }),
      Load.countDocuments(),
      Trip.countDocuments(),
      Trip.countDocuments({ status: { $in: ['accepted', 'started', 'in_transit'] } }),
      User.countDocuments({ verificationStatus: 'under_review' }),
      Trip.countDocuments({ createdAt: { $gte: today } }),
      Trip.countDocuments({ createdAt: { $gte: thisMonth } }),
      Transaction.aggregate([
        { $match: { category: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, month: {
          $sum: { $cond: [{ $gte: ['$createdAt', thisMonth] }, '$amount', 0] }
        }}}
      ]),
      SupportTicket.countDocuments({ status: 'open' }),
    ]);

    res.json({
      success: true,
      data: {
        users: { drivers: totalDrivers, transporters: totalTransporters },
        loads: { total: totalLoads },
        trips: { total: totalTrips, active: activeTrips, today: todayTrips, thisMonth: monthTrips },
        revenue: { total: revenueData[0]?.total || 0, thisMonth: revenueData[0]?.month || 0 },
        pendingVerifications,
        pendingTickets,
      },
    });
  } catch (err) { next(err); }
};

// ─── USER MANAGEMENT ─────────────────────────────────────────────────────────

exports.getUsers = async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (status === 'blocked') query.isBlocked = true;
    else if (status === 'active') query.isActive = true, query.isBlocked = false;
    if (search) query.$or = [
      { name: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
      { companyName: new RegExp(search, 'i') },
    ];

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(query),
    ]);
    res.json({ success: true, data: { users, total, page: Number(page) } });
  } catch (err) { next(err); }
};

exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const trucks = await Truck.find({ owner: user._id });
    const tripCount = await Trip.countDocuments({ $or: [{ driver: user._id }, { transporter: user._id }] });
    res.json({ success: true, data: { ...user.toObject(), trucks, tripCount } });
  } catch (err) { next(err); }
};

exports.blockUser = async (req, res, next) => {
  try {
    const { reason } = req.body;
    await User.findByIdAndUpdate(req.params.id, { isBlocked: true, blockReason: reason });
    res.json({ success: true, message: 'User blocked.' });
  } catch (err) { next(err); }
};

exports.unblockUser = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: false, blockReason: null });
    res.json({ success: true, message: 'User unblocked.' });
  } catch (err) { next(err); }
};

// ─── VERIFICATION ─────────────────────────────────────────────────────────────

exports.getPendingVerifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find({ verificationStatus: 'under_review' })
        .select('-password').sort({ createdAt: 1 }).skip(skip).limit(Number(limit)),
      User.countDocuments({ verificationStatus: 'under_review' }),
    ]);
    res.json({ success: true, data: { users, total, page: Number(page) } });
  } catch (err) { next(err); }
};

exports.verifyUser = async (req, res, next) => {
  try {
    const { action, note } = req.body; // action: 'approve' | 'reject'
    const status = action === 'approve' ? 'approved' : 'rejected';
    const user = await User.findByIdAndUpdate(req.params.id, {
      verificationStatus: status,
      isVerified: action === 'approve',
      verificationNote: note,
      verifiedAt: new Date(),
      verifiedBy: req.user._id,
    }, { new: true });

    await notificationService.sendNotification(user._id, {
      title: action === 'approve' ? 'Account Verified! ✅' : 'Verification Rejected',
      body: action === 'approve'
        ? 'Your account has been verified. You can now accept loads.'
        : `Verification rejected: ${note || 'Please re-upload documents.'}`,
      type: 'verification',
      data: { status },
      fcmToken: user.fcmToken,
    });

    res.json({ success: true, message: `User ${status}.` });
  } catch (err) { next(err); }
};

exports.verifyTruck = async (req, res, next) => {
  try {
    const { action, note } = req.body;
    const truck = await Truck.findByIdAndUpdate(req.params.id, {
      verificationStatus: action === 'approve' ? 'approved' : 'rejected',
      isVerified: action === 'approve',
      verificationNote: note,
      verifiedAt: new Date(),
      verifiedBy: req.user._id,
    }, { new: true }).populate('owner', 'name phone fcmToken');

    // Notify driver
    if (truck?.owner) {
      await notificationService.sendNotification(truck.owner._id, {
        title: action === 'approve' ? 'Truck Verified! 🚛' : 'Truck Verification Rejected',
        body: action === 'approve'
          ? `Your truck ${truck.registrationNumber} has been verified.`
          : `Truck ${truck.registrationNumber} rejected: ${note || 'Please re-upload documents.'}`,
        type: 'verification',
        data: { truckId: truck._id.toString() },
        fcmToken: truck.owner.fcmToken,
      });
    }

    res.json({ success: true, message: `Truck ${action === 'approve' ? 'approved' : 'rejected'}.` });
  } catch (err) { next(err); }
};

exports.getPendingTrucks = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const [trucks, total] = await Promise.all([
      Truck.find({ verificationStatus: 'pending' })
        .populate('owner', 'name phone')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(Number(limit)),
      Truck.countDocuments({ verificationStatus: 'pending' }),
    ]);
    res.json({ success: true, data: { trucks, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// ─── LOAD & TRIP MANAGEMENT ───────────────────────────────────────────────────

exports.getAllLoads = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    const skip = (page - 1) * limit;
    const [loads, total] = await Promise.all([
      Load.find(query).populate('transporter', 'name companyName phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Load.countDocuments(query),
    ]);
    res.json({ success: true, data: { loads, total, page: Number(page) } });
  } catch (err) { next(err); }
};

exports.getAllTrips = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    const skip = (page - 1) * limit;
    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate('load', 'pickupLocation dropLocation offeredPrice')
        .populate('driver', 'name phone')
        .populate('transporter', 'name companyName phone')
        .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Trip.countDocuments(query),
    ]);
    res.json({ success: true, data: { trips, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────

exports.getTransactions = async (req, res, next) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const query = category ? { category } : {};
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find(query).populate('user', 'name phone companyName').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Transaction.countDocuments(query),
    ]);
    res.json({ success: true, data: { transactions, total, page: Number(page) } });
  } catch (err) { next(err); }
};

exports.getTripPayments = async (req, res, next) => {
  try {
    const { paymentStatus, payoutStage, page = 1, limit = 20 } = req.query;
    const query = {};
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (payoutStage) query.payoutStage = payoutStage;
    const skip = (page - 1) * limit;
    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate('load', 'pickupLocation dropLocation')
        .populate('driver', 'name phone')
        .populate('transporter', 'name companyName phone')
        .select('agreedPrice platformCommission driverEarnings paymentStatus payoutStage loadingPayoutAmount deliveryPayoutAmount loadingPayoutAt deliveryPayoutAt status createdAt')
        .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Trip.countDocuments(query),
    ]);
    res.json({ success: true, data: { trips, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// ─── SUPPORT TICKETS ──────────────────────────────────────────────────────────

exports.getTickets = async (req, res, next) => {
  try {
    const { status, priority, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      SupportTicket.find(query).populate('user', 'name phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      SupportTicket.countDocuments(query),
    ]);
    res.json({ success: true, data: { tickets, total, page: Number(page) } });
  } catch (err) { next(err); }
};

exports.replyTicket = async (req, res, next) => {
  try {
    const { message } = req.body;
    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      {
        $push: { messages: { sender: req.user._id, message } },
        status: 'in_progress',
        assignedTo: req.user._id,
      },
      { new: true },
    ).populate('user', 'name phone fcmToken');

    await notificationService.sendNotification(ticket.user._id, {
      title: 'Support Reply',
      body: 'Admin replied to your support ticket.',
      type: 'system',
      data: { ticketId: ticket._id.toString() },
      fcmToken: ticket.user.fcmToken,
    });

    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
};

exports.closeTicket = async (req, res, next) => {
  try {
    await SupportTicket.findByIdAndUpdate(req.params.id, { status: 'resolved', resolvedAt: new Date() });
    res.json({ success: true, message: 'Ticket resolved.' });
  } catch (err) { next(err); }
};

// ─── BROADCAST NOTIFICATION ───────────────────────────────────────────────────

exports.broadcastNotification = async (req, res, next) => {
  try {
    const { title, body, role, type = 'system' } = req.body;
    const query = { isActive: true, isBlocked: false };
    if (role) query.role = role;
    const users = await User.find(query).select('_id fcmToken');
    await notificationService.sendToMultiple(users, { title, body, type });
    res.json({ success: true, message: `Notification sent to ${users.length} users.` });
  } catch (err) { next(err); }
};

// ─── ANALYTICS ────────────────────────────────────────────────────────────────

exports.getAnalytics = async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [dailyTrips, cityActivity, truckTypeStats, revenueByDay] = await Promise.all([
      Trip.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Load.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: '$pickupLocation.city', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
      ]),
      Load.aggregate([
        { $group: { _id: '$truckTypeRequired', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Transaction.aggregate([
        { $match: { category: 'commission', status: 'completed', createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({ success: true, data: { dailyTrips, cityActivity, truckTypeStats, revenueByDay } });
  } catch (err) { next(err); }
};
