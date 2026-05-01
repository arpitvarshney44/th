const mongoose = require('mongoose');

const contactNumberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },         // e.g. "Office Support", "Dispatch Desk"
    phone: { type: String, required: true },         // e.g. "9876543210"
    designation: { type: String, default: '' },      // e.g. "Operations Manager"
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

contactNumberSchema.index({ isActive: 1 });

module.exports = mongoose.model('ContactNumber', contactNumberSchema);
