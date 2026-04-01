const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/driverController');

router.use(protect);
router.use(authorize('driver', 'fleet_owner'));

router.get('/profile', ctrl.getProfile);
router.put('/profile', ctrl.updateProfile);
router.patch('/availability', ctrl.updateAvailability);
router.patch('/location', ctrl.updateLocation);
router.get('/trucks', ctrl.getTrucks);
router.post('/trucks', ctrl.addTruck);
router.post('/documents', upload.fields([
  { name: 'license', maxCount: 1 },
  { name: 'licenseBack', maxCount: 1 },
  { name: 'aadhar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'driverPhoto', maxCount: 1 },
  { name: 'profileImage', maxCount: 1 },
  { name: 'rc', maxCount: 1 },
]), ctrl.uploadDocuments);
router.get('/trips/active', ctrl.getActiveTrip);
router.get('/trips/history', ctrl.getTripHistory);
router.get('/bids', ctrl.getMyBids);
router.get('/bids/:loadId', ctrl.getBidForLoad);
router.delete('/bids/:bidId', ctrl.withdrawBid);

module.exports = router;
