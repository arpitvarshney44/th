const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const authApi = require('../controllers/authController');

router.use(protect);
router.use(authorize('transporter'));

// GET /transporter/profile
router.get('/profile', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (err) { next(err); }
});

// PUT /transporter/profile
router.put('/profile', async (req, res, next) => {
  try {
    const allowed = ['name', 'companyName', 'gstNumber', 'email', 'profileImage'];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (err) { next(err); }
});

// POST /transporter/setup
router.post('/setup', async (req, res, next) => {
  try {
    const { name, companyName, gstNumber, email } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, companyName, gstNumber, email, role: 'transporter' },
      { new: true },
    ).select('-password');
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (err) { next(err); }
});

module.exports = router;
