/**
 * Re-classifies any "completed" withdrawal whose referenceId starts with `mock_`
 * back to `pending` so the admin can retry / mark-paid / reject from the panel.
 *
 * Usage:
 *   node scripts/cleanupMockWithdrawals.js              # dry run
 *   node scripts/cleanupMockWithdrawals.js --apply
 */
require('dotenv').config();
const connectDB = require('../src/config/db');
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();

  // We want to flip back to `pending` only the ones that look like
  // sandbox/mock false-completions, NOT the ones that admin manually marked paid.
  const candidates = await Transaction.find({
    category: 'withdrawal',
    status: 'completed',
    'metadata.markedManuallyAt': { $exists: false }, // skip admin "Mark Paid"
    $or: [
      { referenceId: { $regex: '^mock_' } },
      { 'metadata.transferId': { $exists: false } },
      { 'metadata.payoutStatus': 'RECEIVED' },
    ],
  }).populate('user', 'name phone walletBalance');

  // Also exclude ones where referenceId looks like a real Cashfree cf_transfer_id
  // (numeric only, 6+ digits) — those were marked completed AFTER our pending fix.
  const txs = candidates.filter(t => {
    if (t.metadata?.markedManuallyAt) return false;
    if (t.metadata?.payoutStatus === 'RECEIVED') return true;       // still pending at provider
    if (!t.metadata?.transferId) return true;                        // never sent
    if (t.referenceId && /^mock_/.test(t.referenceId)) return true;  // sandbox mock
    return false;
  });

  console.log(`\nFound ${txs.length} mock-completed withdrawal(s):\n`);

  for (const t of txs) {
    console.log(
      `  ${t._id}  ${t.user?.name || '—'} (${t.user?.phone || '—'})  ` +
      `₹${t.amount.toLocaleString('en-IN')}  ref=${t.referenceId}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to flip these to `pending`.\n');
    process.exit(0);
  }

  if (txs.length === 0) {
    console.log('Nothing to do.\n');
    process.exit(0);
  }

  for (const t of txs) {
    await Transaction.findByIdAndUpdate(t._id, {
      status: 'pending',
      $unset: { referenceId: '' },
      metadata: {
        ...(t.metadata || {}),
        sandboxMockCleanup: true,
        cleanupAt: new Date(),
        previousReferenceId: t.referenceId,
      },
    });
    console.log(`  ✓ Reset ${t._id} to pending`);
  }

  console.log('\n✅ Done. Open admin panel → Withdrawals → Pending.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
