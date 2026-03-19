const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip' },
    category: {
      type: String,
      enum: ['trip_earning', 'trip_payment', 'withdrawal', 'refund', 'commission', 'bonus'],
      required: true,
    },
    referenceId: { type: String }, // Razorpay payment ID etc.
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ trip: 1 });
transactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
