const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../config/logger');

module.exports = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || user.isBlocked) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    logger.debug(`Socket connected: ${userId}`);

    // Join personal room
    socket.join(`user_${userId}`);

    // Join trip room for live tracking
    socket.on('join_trip', (tripId) => {
      socket.join(`trip_${tripId}`);
      logger.debug(`User ${userId} joined trip room: ${tripId}`);
    });

    socket.on('leave_trip', (tripId) => {
      socket.leave(`trip_${tripId}`);
    });

    // Driver sends location update
    socket.on('driver_location', async ({ tripId, lat, lng }) => {
      try {
        await User.findByIdAndUpdate(userId, {
          currentLocation: { type: 'Point', coordinates: [lng, lat] },
        });
        // Broadcast to trip room (transporter watching)
        socket.to(`trip_${tripId}`).emit('location_update', { lat, lng, tripId, timestamp: Date.now() });
      } catch (err) {
        logger.error(`Location update error: ${err.message}`);
      }
    });

    // Bid notification
    socket.on('new_bid', ({ transporterId, bidData }) => {
      io.to(`user_${transporterId}`).emit('bid_received', bidData);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${userId}`);
    });
  });
};
