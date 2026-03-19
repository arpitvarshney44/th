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
    deliveryProof: [{ type: String }], // image URLs
    deliveryNote: { type: String },
    cancelReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'held', 'released', 'refunded'],
      default: 'pending',
    },
    paymentReleasedAt: { type: Date },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

tripSchema.index({ driver: 1, status: 1 });
tripSchema.index({ transporter: 1, status: 1 });
tripSchema.index({ load: 1 });
tripSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Trip', tripSchema);
