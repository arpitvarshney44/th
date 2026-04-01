const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  address: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String },
  coordinates: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
  },
}, { _id: false });

const loadSchema = new mongoose.Schema(
  {
    transporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pickupLocation: { type: locationSchema, required: true },
    dropLocation: { type: locationSchema, required: true },
    loadType: { type: String, required: true },
    weight: { type: Number, required: true }, // tonnes
    truckTypeRequired: {
      type: String,
      enum: ['mini_truck', 'pickup', 'tata_ace', 'open_body', 'closed_body', 'trailer', 'tanker', 'refrigerated', 'flatbed', 'container'],
      required: true,
    },
    offeredPrice: { type: Number, required: true },
    distance: { type: Number, default: 0 }, // km
    pickupDate: { type: String, required: true },
    pickupTime: { type: String, required: true },
    description: { type: String },
    status: {
      type: String,
      enum: ['draft', 'posted', 'bidding', 'assigned', 'in_transit', 'delivered', 'completed', 'cancelled'],
      default: 'posted',
    },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedTruck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck' },
    cancelReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

loadSchema.index({ 'pickupLocation.coordinates': '2dsphere' });
loadSchema.index({ transporter: 1 });
loadSchema.index({ status: 1 });
loadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Load', loadSchema);
