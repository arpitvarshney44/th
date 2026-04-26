const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const {
  sendOTP, verifyOTP, resendOTP, completeProfile, adminLogin,
} = require('../controllers/authController');

// Driver auth — mobile + OTP
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/complete-profile', protect, completeProfile);

// FCM token update — used by both driver and transporter apps
router.put('/fcm-token', protect, async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false, message: 'fcmToken is required.' });
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ success: true, message: 'FCM token updated.' });
  } catch (err) { next(err); }
});

// Admin auth
router.post('/admin/login', adminLogin);

module.exports = router;
