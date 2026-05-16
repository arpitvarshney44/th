/**
 * One-off reconciliation script.
 *
 * For every Trip where `payoutStage` says the driver should already have been
 * credited (loading_paid / delivery_paid) but the matching Transaction record
 * is missing, this script will credit the driver's wallet and create the
 * Transaction. It is idempotent — running it twice will not double-credit.
 *
 * Usage:
 *   node scripts/reconcileWalletCredits.js              # dry run, prints plan
 *   node scripts/reconcileWalletCredits.js --apply      # actually credit
 *   node scripts/reconcileWalletCredits.js --tripId=ID  # only that one trip
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Trip = require('../src/models/Trip');
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');
const Load = require('../src/models/Load');
const walletService = require('../src/services/walletService');

const APPLY = process.argv.includes('--apply');
const tripIdArg = process.argv.find(a => a.startsWith('--tripId='))?.split('=')[1];

const fmtAmount = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

async function findExistingCredit(driverId, tripId, type) {
  // Match the description prefix that the new credit flow writes.
  const prefix = type === 'loading' ? 'Loading (90%)' : 'Delivery (10%)';
  return Transaction.findOne({
    user: driverId,
    trip: tripId,
    type: 'credit',
    category: 'trip_earning',
    description: { $regex: `^${prefix}` },
  });
}

async function reconcileTrip(trip) {
  const issues = [];
  const driverId = trip.driver?._id || trip.driver;

  if (!driverId) {
    return { trip, issues: ['no driver'] };
  }

  // Determine which stages the transporter has actually approved
  const loadingApproved = !!trip.loadingApprovedAt || ['loading_paid', 'delivery_paid'].includes(trip.payoutStage);
  const deliveryApproved = !!trip.deliveryApprovedAt || trip.payoutStage === 'delivery_paid';

  // ── 90% (loading) check ──
  if (loadingApproved) {
    const expectedLoading = trip.loadingPayoutAmount || Math.round((trip.driverEarnings || 0) * 0.9);
    if (expectedLoading > 0) {
      const existing = await findExistingCredit(driverId, trip._id, 'loading');
      if (!existing) {
        issues.push({ stage: 'loading', amount: expectedLoading });
      }
    }
  }

  // ── 10% (delivery) check ──
  if (deliveryApproved) {
    const expectedDelivery = trip.deliveryPayoutAmount || Math.round((trip.driverEarnings || 0) * 0.1);
    if (expectedDelivery > 0) {
      const existing = await findExistingCredit(driverId, trip._id, 'delivery');
      if (!existing) {
        issues.push({ stage: 'delivery', amount: expectedDelivery });
      }
    }
  }

  return { trip, issues };
}

async function applyFix(trip, issue) {
  const driverId = trip.driver?._id || trip.driver;
  const stageLabel = issue.stage === 'loading' ? 'Loading (90%)' : 'Delivery (10%)';
  await walletService.credit(
    driverId,
    issue.amount,
    `${stageLabel} earnings credited to wallet (reconciliation)`,
    'trip_earning',
    trip._id,
  );

  // Patch trip record so it matches the credit
  const update = {};
  if (issue.stage === 'loading') {
    if (!trip.loadingPayoutAmount) update.loadingPayoutAmount = issue.amount;
    if (!trip.loadingPayoutAt)     update.loadingPayoutAt = trip.loadingApprovedAt || new Date();
    if (trip.payoutStage === 'none') update.payoutStage = 'loading_paid';
  } else {
    if (!trip.deliveryPayoutAmount) update.deliveryPayoutAmount = issue.amount;
    if (!trip.deliveryPayoutAt)     update.deliveryPayoutAt = trip.deliveryApprovedAt || new Date();
    if (trip.payoutStage !== 'delivery_paid') update.payoutStage = 'delivery_paid';
  }
  if (Object.keys(update).length > 0) {
    await Trip.findByIdAndUpdate(trip._id, update);
  }
}

async function main() {
  await connectDB();

  const query = {
    $or: [
      { payoutStage: { $in: ['loading_paid', 'delivery_paid'] } },
      { loadingApprovedAt: { $exists: true, $ne: null } },
      { deliveryApprovedAt: { $exists: true, $ne: null } },
    ],
  };
  if (tripIdArg) {
    delete query.$or;
    query._id = tripIdArg;
  }

  const trips = await Trip.find(query)
    .populate('driver', 'name phone walletBalance')
    .populate('load', 'pickupLocation dropLocation');

  console.log(`\n🔍 Inspecting ${trips.length} trip(s) with active payout stage…\n`);

  let pendingFixes = 0;
  let totalToCredit = 0;
  const allFixes = [];

  for (const trip of trips) {
    const { issues } = await reconcileTrip(trip);
    if (!issues.length) {
      console.log(`✅ ${trip._id}  (${trip.driver?.name || '—'}) — already reconciled`);
      continue;
    }
    pendingFixes += issues.length;
    for (const issue of issues) {
      totalToCredit += issue.amount;
      console.log(
        `⚠️  ${trip._id}  driver=${trip.driver?.name || '—'} (${trip.driver?.phone || '—'})  → ` +
        `MISSING ${issue.stage} credit of ${fmtAmount(issue.amount)}  ` +
        `[load: ${trip.load?.pickupLocation?.city || '?'} → ${trip.load?.dropLocation?.city || '?'}]`,
      );
      allFixes.push({ trip, issue });
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`Trips inspected: ${trips.length}`);
  console.log(`Missing credits: ${pendingFixes}`);
  console.log(`Total to credit: ${fmtAmount(totalToCredit)}`);
  console.log(`────────────────────────────────────────\n`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to actually credit the wallets.\n');
    process.exit(0);
  }

  if (pendingFixes === 0) {
    console.log('Nothing to do.\n');
    process.exit(0);
  }

  console.log('🛠  Applying fixes…\n');
  for (const { trip, issue } of allFixes) {
    try {
      await applyFix(trip, issue);
      console.log(`   ✓ Credited ${fmtAmount(issue.amount)} to ${trip.driver?.name || trip.driver}  (trip ${trip._id})`);
    } catch (err) {
      console.error(`   ✗ Failed for trip ${trip._id}: ${err.message}`);
    }
  }

  console.log('\n✅ Reconciliation complete.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
