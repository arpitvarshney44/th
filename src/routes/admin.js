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
