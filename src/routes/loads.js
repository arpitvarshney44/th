const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/loadController');

router.use(protect);

// Static routes MUST come before /:id param routes
router.get('/nearby', authorize('driver', 'fleet_owner'), ctrl.getNearbyLoads);
router.get('/recommended', authorize('driver', 'fleet_owner'), ctrl.getRecommendedLoads);
router.get('/mine', authorize('transporter'), ctrl.getMyLoads);
router.get('/', ctrl.getAllLoads);
router.post('/', authorize('transporter'), ctrl.postLoad);

// Param routes
router.get('/:id', ctrl.getLoadById);
router.post('/:id/accept', authorize('driver', 'fleet_owner'), ctrl.acceptLoad);
router.post('/:id/bid', authorize('driver', 'fleet_owner'), ctrl.placeBid);
router.get('/:id/bids', authorize('transporter'), ctrl.getLoadBids);
router.post('/:id/bids/:bidId/accept', authorize('transporter'), ctrl.acceptBid);
router.post('/:id/bids/:bidId/reject', authorize('transporter'), ctrl.rejectBid);
router.patch('/:id/cancel', authorize('transporter'), ctrl.cancelLoad);

module.exports = router;
