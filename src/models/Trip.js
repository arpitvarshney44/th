const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema(
  {
    load: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    bid: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid' },
    agreedPrice: { type: Number, required: true },
    platformCommission: { type: Number, default: 0 },
    driverEarnings: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['accepted', 'started', 'in_transit', 'delivered', 'completed', 'cancelled', 'disputed'],
      default: 'accepted',
    },
    startTime: { type: Date },
    deliveredTime: { type: Date },
    completedTime: { type: Date },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    deliveryProof: [{ type: String }],
    deliveryNote: { type: String },
    deliveryApprovedAt: { type: Date },

    // Loading proof (driver uploads at pickup, transporter approves → 90% payout)
    loadingProof: [{ type: String }],
    loadingNote: { type: String },
    loadingApprovedAt: { type: Date },
    cancelReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'captured', 'held', 'partial_paid', 'completed', 'refunded', 'failed'],
      default: 'pending',
    },
    paymentReleasedAt: { type: Date },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    // Payout tracking
    payoutStage: {
      type: String,
      enum: ['none', 'loading_paid', 'delivery_paid'],
      default: 'none',
    },
    loadingPayoutAmount: { type: Number, default: 0 },
    deliveryPayoutAmount: { type: Number, default: 0 },
    loadingPayoutId: { type: String },
    deliveryPayoutId: { type: String },
    loadingPayoutAt: { type: Date },
    deliveryPayoutAt: { type: Date },

    // Driver Razorpay contact/fund account
    driverContactId: { type: String },
    driverFundAccountId: { type: String },

    // Admin-assigned contact for driver communication
    assignedContact: {
      name: { type: String },
      phone: { type: String },
      designation: { type: String },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

tripSchema.index({ driver: 1, status: 1 });
tripSchema.index({ transporter: 1, status: 1 });
tripSchema.index({ load: 1 });
tripSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Trip', tripSchema);
