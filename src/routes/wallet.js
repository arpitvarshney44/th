const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/walletController');

router.use(protect);

router.get('/balance', ctrl.getBalance);
router.get('/transactions', ctrl.getTransactions);
router.post('/withdraw', authorize('driver', 'fleet_owner'), ctrl.withdrawFunds);
router.get('/transporter/payments', authorize('transporter'), ctrl.getTransporterPayments);

module.exports = router;
