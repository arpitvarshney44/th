const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const upload = require('../middleware/upload');
const { fileUrl } = require('../middleware/upload');

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

// POST /transporter/setup — JSON only, logo uploaded separately via /upload-logo
router.post('/setup', async (req, res, next) => {
  try {
    const { name, companyName, gstNumber, email } = req.body;
    const updates = { name, companyName, gstNumber, email, role: 'transporter' };
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (err) { next(err); }
});

// PUT /transporter/upload-logo
router.put('/upload-logo', upload.single('logo'), async (req, res, next) => {
  try {
    console.log('[upload-logo] req.file:', req.file);
    console.log('[upload-logo] req.body:', req.body);
    console.log('[upload-logo] content-type:', req.headers['content-type']);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const profileImage = fileUrl(req.file.path);
    const user = await User.findByIdAndUpdate(req.user._id, { profileImage }, { new: true }).select('-password');
    res.json({ success: true, data: { profileImage: user.profileImage } });
  } catch (err) { next(err); }
});

module.exports = router;
