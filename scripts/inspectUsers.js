require('dotenv').config();
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

async function main() {
  await connectDB();
  const users = await User.find({ role: { $in: ['driver', 'transporter'] } })
    .select('phone role name companyName gstNumber bankAccount licenseNumber email isVerified verificationStatus');
  console.log(`\nUsers: ${users.length}\n`);
  for (const u of users) {
    console.log(`${u.role}  ${u.phone}  name=${u.name || '—'}  company=${u.companyName || '—'}  gst=${u.gstNumber || '—'}  license=${u.licenseNumber || '—'}  bankAcc=${u.bankAccount?.accountNumber || '—'}  isVerified=${u.isVerified}  verifStatus=${u.verificationStatus}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
