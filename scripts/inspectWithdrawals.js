require('dotenv').config();
const connectDB = require('../src/config/db');
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');

async function main() {
  await connectDB();
  const txs = await Transaction.find({ category: 'withdrawal' })
    .populate('user', 'name phone')
    .sort({ createdAt: -1 });

  console.log(`\nTotal withdrawals: ${txs.length}\n`);
  for (const t of txs) {
    console.log(
      `${t._id}  ${t.user?.name || '—'}  ₹${t.amount}  status=${t.status}  ` +
      `ref=${t.referenceId || '—'}  ` +
      `transferId=${t.metadata?.transferId || '—'}  ` +
      `payoutStatus=${t.metadata?.payoutStatus || '—'}  ` +
      `created=${t.createdAt.toISOString()}`,
    );
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
