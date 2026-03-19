const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  attachments: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const supportTicketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    category: {
      type: String,
      enum: ['payment', 'trip', 'verification', 'account', 'other'],
      required: true,
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
    },
    messages: [messageSchema],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

supportTicketSchema.index({ user: 1, status: 1 });
supportTicketSchema.index({ status: 1, priority: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
