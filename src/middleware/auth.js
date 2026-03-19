const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
exports.protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ success: false, message: 'User not found.' });
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account has been blocked.' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account is inactive.' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// Verify Admin JWT token
exports.protectAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    if (user.isBlocked || !user.isActive) {
      return res.status(403).json({ success: false, message: 'Admin account is inactive.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
  }
};

// Role-based access
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Role '${req.user.role}' is not authorized for this action.`,
    });
  }
  next();
};
