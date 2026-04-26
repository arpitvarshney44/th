const Settings = require('../models/Settings');

// GET /settings/:key
exports.getSetting = async (req, res, next) => {
  try {
    const setting = await Settings.findOne({ key: req.params.key });
    if (!setting) return res.status(404).json({ success: false, message: 'Setting not found.' });
    res.json({ success: true, data: setting.value });
  } catch (err) { next(err); }
};

// GET /settings - Get multiple settings by keys
exports.getSettings = async (req, res, next) => {
  try {
    const { keys } = req.query;
    const query = keys ? { key: { $in: keys.split(',') } } : {};
    const settings = await Settings.find(query);
    
    // Format as { key: value }
    const formatted = {};
    settings.forEach(s => { formatted[s.key] = s.value; });
    
    res.json({ success: true, data: formatted });
  } catch (err) { next(err); }
};

// PUT /settings/:key (Admin only)
exports.updateSetting = async (req, res, next) => {
  try {
    const { value, description } = req.body;
    const setting = await Settings.findOneAndUpdate(
      { key: req.params.key },
      { value, description, updatedBy: req.user._id },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: setting });
  } catch (err) { next(err); }
};
