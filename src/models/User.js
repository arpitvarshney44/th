const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true, sparse: true, trim: true },
    email: { type: String, lowercase: true, trim: true, sparse: true }, // admin only
    password: { type: String, select: false }, // admin only
    name: { type: String, trim: true },
    role: {
      type: String,
      enum: ['driver', 'fleet_owner', 'transporter', 'admin'],
      required: true,
    },
    profileImage: { type: String },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalRatings: { type: Number, default: 0 },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    fcmToken: { type: String },
    lastLogin: { type: Date },

    // Driver / Fleet Owner specific
    licenseNumber: { type: String },
    licenseExpiry: { type: Date },
    licenseImage: { type: String },
    licenseImageBack: { type: String },
    aadharNumber: { type: String },
    aadharImage: { type: String },
    panNumber: { type: String },
    panImage: { type: String },
    driverPhoto: { type: String },
    isAvailable: { type: Boolean, default: true },
    totalTrips: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },

    // Bank Account Details
    bankAccount: {
      accountNumber: { type: String },
      accountHolderName: { type: String },
      ifscCode: { type: String },
      bankName: { type: String },
    },

    // Transporter specific
    companyName: { type: String },
    gstNumber: { type: String, sparse: true },
    totalShipments: { type: Number, default: 0 },

    // Admin specific
    adminLevel: { type: String, enum: ['super', 'manager', 'support'], default: 'support' },

    // Verification status
    verificationStatus: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },
    verificationNote: { type: String },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

userSchema.index({ currentLocation: '2dsphere' });
userSchema.index({ phone: 1, unique: true, sparse: true });
userSchema.index({ email: 1, sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1, isBlocked: 1 });
userSchema.index({ gstNumber: 1, sparse: true, unique: true });

// Hash password before save (admin only)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj.password;
  delete obj.aadharNumber;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
