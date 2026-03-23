const jwt = require('jsonwebtoken');
const User = require('../models/User');
const otpService = require('../services/otpService');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });

// POST /auth/send-otp  — send SMS OTP to mobile number
exports.sendOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }

    const result = await otpService.sendOTP(phone, 'sms');
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

// POST /auth/verify-otp  — verify SMS OTP, login or flag new user
exports.verifyOTP = async (req, res, next) => {
  try {
    const { phone, otp, otpId, appType } = req.body; // Add appType
    if (!phone || !otp || !otpId) {
      return res.status(400).json({ success: false, message: 'phone, otp, and otpId are required.' });
    }

    const result = await otpService.verifyOTP(phone, otp, otpId);
    if (!result.valid) return res.status(400).json({ success: false, message: result.message });

    // Find user (exclude admins)
    let user = await User.findOne({ phone, role: { $ne: 'admin' } });
    const isNewUser = !user;

    if (!user) {
      // Create user with correct role based on appType
      const role = appType === 'transporter' ? 'transporter' : 'driver';
      user = await User.create({ phone, role });
    } else if (appType === 'transporter' && user.role !== 'transporter') {
      // If an existing driver logs into transporter app, update role or handle it
      // For now, we'll allow it and maybe update role or just let them login if business logic allows.
      // Easiest is to update the role or add a secondary role, but schema has single role.
      // Assuming they can switch, or we just trust the existing role. 
      // Let's ensure role is Transporter if they are using Transporter app and they are new to it.
      if(user.role === 'driver' && user.companyName === undefined) {
         user.role = 'transporter';
         await user.save();
      }
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account has been blocked.' });
    }

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    const token = signToken(user._id);
    res.json({
      success: true,
      token,
      user: user.toPublicJSON(),
      isNewUser,
    });
  } catch (err) { next(err); }
};


// POST /auth/resend-otp  — resend SMS OTP
exports.resendOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Valid mobile number is required.' });
    }

    const result = await otpService.sendOTP(phone, 'sms');
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

// POST /auth/complete-profile  — new user fills profile after OTP verify
exports.completeProfile = async (req, res, next) => {
  try {
    const {
      name, licenseNumber, aadharNumber, panNumber,
      bankAccountNumber, bankAccountHolderName, bankIfscCode, bankName,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    user.name = name.trim();
    if (licenseNumber) user.licenseNumber = licenseNumber.trim();
    if (aadharNumber) user.aadharNumber = aadharNumber;
    if (panNumber) user.panNumber = panNumber.toUpperCase();
    if (bankAccountNumber || bankAccountHolderName || bankIfscCode || bankName) {
      user.bankAccount = {
        accountNumber: bankAccountNumber || undefined,
        accountHolderName: bankAccountHolderName || undefined,
        ifscCode: bankIfscCode ? bankIfscCode.toUpperCase() : undefined,
        bankName: bankName || undefined,
      };
    }

    await user.save();

    res.json({
      success: true,
      user: user.toPublicJSON(),
      message: 'Profile completed successfully.',
    });
  } catch (err) { next(err); }
};

// POST /admin/auth/login  — admin email+password login (unchanged)
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required.' });
    }

    const admin = await User.findOne({ email, role: 'admin' }).select('+password');
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    if (admin.isBlocked || !admin.isActive) {
      return res.status(403).json({ success: false, message: 'Admin account is inactive.' });
    }

    await User.findByIdAndUpdate(admin._id, { lastLogin: new Date() });

    const token = jwt.sign(
      { id: admin._id },
      process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET,
      { expiresIn: '1d' },
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        adminLevel: admin.adminLevel,
      },
    });
  } catch (err) { next(err); }
};
