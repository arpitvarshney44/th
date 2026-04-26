const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: ['load', 'bid', 'trip', 'payment', 'verification', 'system'],
      required: true,
    },
    isRead: { type: Boolean, default: false },
    data: { type: mongoose.Schema.Types.Mixed },
    // Push delivery tracking
    pushStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'no_token'],
      default: 'pending',
    },
    pushError: { type: String },
    // Broadcast grouping
    broadcastId: { type: String },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ broadcastId: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
