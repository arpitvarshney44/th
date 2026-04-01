const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/paymentController');

// Webhook (no auth - Razorpay calls this)
router.post('/webhook', ctrl.handleWebhook);

// Authenticated routes
router.use(protect);

// Transporter creates order & verifies payment
router.post('/create-order', authorize('transporter'), ctrl.createOrder);
router.post('/verify', authorize('transporter'), ctrl.verifyPayment);

// Both can view payment details
router.get('/trip/:tripId', ctrl.getTripPaymentDetails);

module.exports = router;
