/**
 * TruxHire - Admin Credential Creation Script
 * Usage: node scripts/createAdmin.js
 * Or with custom values: ADMIN_EMAIL=custom@email.com ADMIN_PASSWORD=MyPass123 node scripts/createAdmin.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/truxhire';

const adminData = {
  name: process.env.ADMIN_NAME || 'Super Admin',
  email: process.env.ADMIN_EMAIL || 'admin@truxhire.in',
  password: process.env.ADMIN_PASSWORD || 'Admin@123456',
  phone: process.env.ADMIN_PHONE || '9999999999',
  role: 'admin',
  adminLevel: 'super',
  isVerified: true,
  isActive: true,
};

async function createAdmin() {
  console.log('\n🚀 TruxHire Admin Setup Script');
  console.log('================================\n');

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Dynamically load model (avoid circular deps)
    const userSchema = new mongoose.Schema({
      phone: { type: String, required: true, unique: true },
      name: String,
      email: { type: String, lowercase: true },
      password: String,
      role: { type: String, enum: ['driver', 'fleet_owner', 'transporter', 'admin'] },
      adminLevel: { type: String, enum: ['super', 'manager', 'support'] },
      isVerified: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      isBlocked: { type: Boolean, default: false },
      rating: { type: Number, default: 0 },
      totalRatings: { type: Number, default: 0 },
      language: { type: String, default: 'en' },
    }, { timestamps: true });

    const User = mongoose.models.User || mongoose.model('User', userSchema);

    // Check if admin already exists
    const existing = await User.findOne({ $or: [{ email: adminData.email }, { phone: adminData.phone }] });

    if (existing) {
      console.log('⚠️  Admin already exists:');
      console.log(`   Email: ${existing.email}`);
      console.log(`   Phone: ${existing.phone}`);
      console.log(`   Role:  ${existing.role} (${existing.adminLevel})`);
      console.log('\n   To reset password, delete the existing admin and re-run this script.\n');
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminData.password, 12);

    const admin = await User.create({
      ...adminData,
      password: hashedPassword,
    });

    console.log('✅ Admin created successfully!\n');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│           ADMIN CREDENTIALS              │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│  Name     : ${adminData.name.padEnd(28)}│`);
    console.log(`│  Email    : ${adminData.email.padEnd(28)}│`);
    console.log(`│  Password : ${adminData.password.padEnd(28)}│`);
    console.log(`│  Phone    : ${adminData.phone.padEnd(28)}│`);
    console.log(`│  Level    : ${adminData.adminLevel.padEnd(28)}│`);
    console.log(`│  ID       : ${admin._id.toString().slice(0, 24).padEnd(28)}│`);
    console.log('└─────────────────────────────────────────┘');
    console.log('\n⚠️  IMPORTANT: Change the password after first login!\n');
    console.log('📌 Admin Panel Login URL: http://localhost:3000/login\n');

  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
    if (err.code === 11000) {
      console.error('   Duplicate key — admin with this email/phone already exists.');
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

createAdmin();
