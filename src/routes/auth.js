const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  sendOTP, verifyOTP, resendOTP, completeProfile, adminLogin,
} = require('../controllers/authController');

// Driver auth — mobile + OTP
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/complete-profile', protect, completeProfile);

// Admin auth
router.post('/admin/login', adminLogin);

module.exports = router;
