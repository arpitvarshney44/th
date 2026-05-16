require('dotenv').config();
const connectDB = require('../src/config/db');
const Trip = require('../src/models/Trip');
const User = require('../src/models/User');
const Load = require('../src/models/Load');

async function main() {
  await connectDB();
  const trips = await Trip.find({})
    .populate('driver', 'name phone walletBalance bankAccount')
    .populate('load', 'pickupLocation dropLocation')
    .sort({ createdAt: -1 })
    .limit(20);

  console.log(`\nTotal recent trips: ${trips.length}\n`);
  for (const t of trips) {
    console.log(
      `${t._id}` +
      `  status=${t.status}` +
      `  payment=${t.paymentStatus}` +
      `  payoutStage=${t.payoutStage}` +
      `  loadingApproved=${!!t.loadingApprovedAt}` +
      `  deliveryApproved=${!!t.deliveryApprovedAt}` +
      `  driverEarnings=₹${t.driverEarnings}` +
      `  walletBal=₹${t.driver?.walletBalance ?? '?'}` +
      `  driver=${t.driver?.name || '—'}` +
      `  route=${t.load?.pickupLocation?.city}→${t.load?.dropLocation?.city}`
    );
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
