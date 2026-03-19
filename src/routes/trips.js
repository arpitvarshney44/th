const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/tripController');

router.use(protect);

// Driver
router.patch('/:id/start', authorize('driver', 'fleet_owner'), ctrl.startTrip);
router.patch('/:id/location', authorize('driver', 'fleet_owner'), ctrl.updateLocation);
router.patch('/:id/complete', authorize('driver', 'fleet_owner'), upload.array('proof', 5), ctrl.completeTrip);

// Both
router.post('/:id/rate', ctrl.rateTrip);

// Transporter
router.get('/shipments/active', authorize('transporter'), ctrl.getActiveShipments);
router.get('/shipments/history', authorize('transporter'), ctrl.getShipmentHistory);
router.get('/shipments/:id', ctrl.getShipmentById);

module.exports = router;
