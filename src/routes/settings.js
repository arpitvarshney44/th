const router = require('express').Router();
const settingsController = require('../controllers/settingsController');
const { protectAdmin } = require('../middleware/auth');

// Public access for apps to get social links, etc.
router.get('/', settingsController.getSettings);
router.get('/:key', settingsController.getSetting);

// Admin only to update
router.put('/:key', protectAdmin, settingsController.updateSetting);

module.exports = router;
