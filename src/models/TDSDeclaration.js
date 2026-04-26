const mongoose = require('mongoose');

const tdsDeclarationSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    payerName: { type: String, required: true, trim: true },
    payerAddress: { type: String, required: true, trim: true },
    declarantName: { type: String, required: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    companyAddress: { type: String, required: true, trim: true },
    panNumber: { type: String, required: true, trim: true, uppercase: true },
    place: { type: String, required: true, trim: true },
    declarationDate: { type: Date, required: true },
    capacity: {
      type: String,
      enum: ['proprietor', 'partner', 'director'],
      required: true,
    },
  },
  { timestamps: true },
);

tdsDeclarationSchema.index({ driver: 1 });

module.exports = mongoose.model('TDSDeclaration', tdsDeclarationSchema);
