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
router.patch('/users/:id/block', ctrl.blockUser);
router.patch('/users/:id/unblock', ctrl.unblockUser);

// Verification
router.get('/verifications', ctrl.getPendingVerifications);
router.patch('/verifications/users/:id', ctrl.verifyUser);
router.patch('/verifications/trucks/:id', ctrl.verifyTruck);

// Loads & Trips
router.get('/loads', ctrl.getAllLoads);
router.get('/trips', ctrl.getAllTrips);

// Payments
router.get('/transactions', ctrl.getTransactions);

// Support
router.get('/tickets', ctrl.getTickets);
router.post('/tickets/:id/reply', ctrl.replyTicket);
router.patch('/tickets/:id/close', ctrl.closeTicket);

// Notifications
router.post('/notifications/broadcast', ctrl.broadcastNotification);

module.exports = router;
