const mongoose = require('mongoose');

const truckSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: {
      type: String,
      enum: ['mini_truck', 'pickup', 'tata_ace', 'open_body', 'closed_body', 'trailer', 'tanker', 'refrigerated', 'flatbed', 'container'],
      required: true,
    },
    capacity: { type: Number, required: true }, // in tonnes
    model: { type: String, required: true },
    year: { type: Number },
    rcImage: { type: String },
    insuranceImage: { type: String },
    fitnessImage: { type: String },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },
    verificationNote: { type: String },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

truckSchema.index({ owner: 1 });
truckSchema.index({ registrationNumber: 1 });

module.exports = mongoose.model('Truck', truckSchema);
