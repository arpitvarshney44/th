require('dotenv').config();
const connectDB = require('../src/config/db');
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');
const Trip = require('../src/models/Trip');

async function main() {
  await connectDB();
  const tripId = '69f47201f1e306239455762b';
  const txs = await Transaction.find({ trip: tripId }).populate('user', 'name walletBalance');
  console.log(`\nTransactions for trip ${tripId}: ${txs.length}\n`);
  for (const t of txs) {
    console.log(`  ${t._id}  user=${t.user?.name || '—'}  type=${t.type}  category=${t.category}  amount=₹${t.amount}  status=${t.status}  desc="${t.description}"  bal=${t.balanceBefore}→${t.balanceAfter}`);
  }
  const driver = await User.findById((await Trip.findById(tripId)).driver).select('name walletBalance');
  console.log(`\nDriver: ${driver.name}  walletBalance=₹${driver.walletBalance}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
