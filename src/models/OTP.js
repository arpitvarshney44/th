const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    otp: { type: String, required: true },
    otpId: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    isUsed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ phone: 1 });

module.exports = mongoose.model('OTP', otpSchema);
