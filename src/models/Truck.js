const mongoose = require('mongoose');

const truckSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: {
      type: String,
      enum: [
        // Open Body
        '17_feet_open',
        '20_feet_open',
        '22_feet_open',
        '24_feet_open',
        '10_whl_open',
        '12_whl_open',
        '14_whl_open',
        '16_whl_open',
        '18_whl_open',
        // Closed Container
        '32_feet_sxl',
        '32_feet_sxl_high_cube',
        '32_feet_mxl',
        '32_feet_mxl_high_cube',
        '32_feet_txl',
        '20_feet_closed',
        '22_feet_closed',
        '24_feet_closed',
        // Flat Bed
        '40_feet_flat_bed',
        '40_feet_semi_bed',
      ],
      required: true,
    },
    capacity: { type: Number, required: true }, // in tonnes
    length: { type: String, trim: true }, // e.g., '17ft', '20ft', '32ft'
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
