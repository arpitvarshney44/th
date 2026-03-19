const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema(
  {
    load: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
      default: 'pending',
    },
    note: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

bidSchema.index({ load: 1, driver: 1 }, { unique: true });
bidSchema.index({ load: 1, status: 1 });

module.exports = mongoose.model('Bid', bidSchema);
