const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/tripController');

router.get('/:id/loading-memo', ctrl.getLoadingMemo);

router.use(protect);


// Driver actions
router.patch('/:id/start',          authorize('driver', 'fleet_owner'), ctrl.startTrip);
router.patch('/:id/location',       authorize('driver', 'fleet_owner'), ctrl.updateLocation);
router.patch('/:id/loading-proof',  authorize('driver', 'fleet_owner'), upload.array('proof', 5), ctrl.uploadLoadingProof);
router.patch('/:id/complete',       authorize('driver', 'fleet_owner'), upload.array('proof', 5), ctrl.completeTrip);

// Transporter approvals
router.patch('/:id/approve-loading',  authorize('transporter'), ctrl.approveLoading);
router.patch('/:id/approve-delivery', authorize('transporter'), ctrl.approveDelivery);

// Both
router.post('/:id/rate', ctrl.rateTrip);

// Transporter shipment views
router.get('/shipments/active',   authorize('transporter'), ctrl.getActiveShipments);
router.get('/shipments/history',  authorize('transporter'), ctrl.getShipmentHistory);
router.get('/shipments/:id',      ctrl.getShipmentById);

module.exports = router;
