const User = require('../models/User');
const Truck = require('../models/Truck');
const Trip = require('../models/Trip');
const Transaction = require('../models/Transaction');
const { fileUrl } = require('../middleware/upload');

// GET /driver/profile
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const trucks = await Truck.find({ owner: req.user._id, isActive: true });
    res.json({ success: true, data: { ...user.toPublicJSON(), trucks } });
  } catch (err) { next(err); }
};

// PUT /driver/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const allowed = ['name', 'language', 'licenseNumber', 'licenseExpiry', 'aadharNumber', 'panNumber', 'role', 'phone'];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Handle bank account updates
    if (req.body.bankAccountNumber || req.body.bankAccountHolderName || req.body.bankIfscCode || req.body.bankName) {
      updates.bankAccount = {
        ...(req.user.bankAccount || {}),
        ...(req.body.bankAccountNumber && { accountNumber: req.body.bankAccountNumber }),
        ...(req.body.bankAccountHolderName && { accountHolderName: req.body.bankAccountHolderName }),
        ...(req.body.bankIfscCode && { ifscCode: req.body.bankIfscCode }),
        ...(req.body.bankName && { bankName: req.body.bankName }),
      };
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (err) { next(err); }
};

// PATCH /driver/availability
exports.updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    await User.findByIdAndUpdate(req.user._id, { isAvailable });
    res.json({ success: true, message: `Status updated to ${isAvailable ? 'available' : 'offline'}.` });
  } catch (err) { next(err); }
};

// PATCH /driver/location
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// POST /driver/trucks
exports.addTruck = async (req, res, next) => {
  try {
    const { registrationNumber, type, capacity, model, year } = req.body;
    const truck = await Truck.create({
      owner: req.user._id,
      registrationNumber,
      type,
      capacity,
      model,
      year,
    });
    res.status(201).json({ success: true, data: truck });
  } catch (err) { next(err); }
};

// GET /driver/trucks
exports.getTrucks = async (req, res, next) => {
  try {
    const trucks = await Truck.find({ owner: req.user._id, isActive: true });
    res.json({ success: true, data: trucks });
  } catch (err) { next(err); }
};

// POST /driver/documents
exports.uploadDocuments = async (req, res, next) => {
  try {
    const updates = {};
    if (req.files?.license) updates.licenseImage = fileUrl(req.files.license[0].path);
    if (req.files?.licenseBack) updates.licenseImageBack = fileUrl(req.files.licenseBack[0].path);
    if (req.files?.aadhar) updates.aadharImage = fileUrl(req.files.aadhar[0].path);
    if (req.files?.pan) updates.panImage = fileUrl(req.files.pan[0].path);
    if (req.files?.driverPhoto) updates.driverPhoto = fileUrl(req.files.driverPhoto[0].path);
    if (req.files?.profileImage) updates.profileImage = fileUrl(req.files.profileImage[0].path);
    if (req.files?.rc) {
      const truckId = req.body.truckId;
      if (truckId) await Truck.findByIdAndUpdate(truckId, { rcImage: fileUrl(req.files.rc[0].path) });
    }

    if (Object.keys(updates).length) {
      await User.findByIdAndUpdate(req.user._id, {
        ...updates,
        verificationStatus: 'under_review',
      });
    }

    res.json({ success: true, message: 'Documents uploaded. Under review.', data: updates });
  } catch (err) { next(err); }
};

// GET /driver/trips/history
exports.getTripHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [trips, total] = await Promise.all([
      Trip.find({ driver: req.user._id })
        .populate('load', 'pickupLocation dropLocation loadType weight offeredPrice distance pickupDate')
        .populate('transporter', 'name companyName rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Trip.countDocuments({ driver: req.user._id }),
    ]);

    res.json({ success: true, data: { trips, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// GET /driver/trips/active
exports.getActiveTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({
      driver: req.user._id,
      status: { $in: ['accepted', 'started', 'in_transit'] },
    })
      .populate('load')
      .populate('transporter', 'name companyName phone rating');

    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
};
