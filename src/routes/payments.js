const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/paymentController');

// Webhook (no auth - Cashfree calls this)
router.post('/webhook', ctrl.handleWebhook);

// Authenticated routes
router.use(protect);

// Transporter creates order & verifies payment
router.post('/create-order', authorize('transporter'), ctrl.createOrder);
router.post('/verify', authorize('transporter'), ctrl.verifyPayment);
router.post('/trip/:tripId/payment-link', authorize('transporter'), ctrl.getPaymentLink);
router.post('/trip/:tripId/sync', authorize('transporter'), ctrl.syncPayment);

// Both can view payment details
router.get('/trip/:tripId', ctrl.getTripPaymentDetails);

module.exports = router;
