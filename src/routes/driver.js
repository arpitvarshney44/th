const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/driverController');
const TDSDeclaration = require('../models/TDSDeclaration');

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

// TDS Declaration
router.get('/tds-declaration', async (req, res, next) => {
  try {
    const declaration = await TDSDeclaration.findOne({ driver: req.user._id });
    res.json({ success: true, data: declaration });
  } catch (err) { next(err); }
});

router.post('/tds-declaration', async (req, res, next) => {
  try {
    const { payerName, payerAddress, declarantName, companyName, companyAddress, panNumber, place, declarationDate, capacity } = req.body;
    if (!payerName || !payerAddress || !declarantName || !companyName || !companyAddress || !panNumber || !place || !capacity) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    const existing = await TDSDeclaration.findOne({ driver: req.user._id });
    if (existing) {
      return res.status(400).json({ success: false, message: 'TDS declaration already submitted.' });
    }
    const declaration = await TDSDeclaration.create({
      driver: req.user._id,
      payerName, payerAddress, declarantName, companyName, companyAddress,
      panNumber: panNumber.toUpperCase(), place,
      declarationDate: declarationDate || new Date(),
      capacity,
    });
    res.json({ success: true, data: declaration, message: 'TDS declaration submitted successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
