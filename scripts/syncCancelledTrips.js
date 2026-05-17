/**
 * One-off cleanup: cascade-cancel any active trips whose underlying load
 * was already cancelled by admin (legacy from before cascading was added).
 *
 * Usage:
 *   node scripts/syncCancelledTrips.js              # dry run
 *   node scripts/syncCancelledTrips.js --apply
 */
require('dotenv').config();
const connectDB = require('../src/config/db');
const Trip = require('../src/models/Trip');
const Load = require('../src/models/Load');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();
  const ACTIVE = ['accepted', 'started', 'in_transit', 'delivered'];
  const cancelledLoadIds = await Load.find({ status: 'cancelled' }).distinct('_id');

  const trips = await Trip.find({
    status: { $in: ACTIVE },
    load: { $in: cancelledLoadIds },
  }).populate('load', 'pickupLocation dropLocation cancelReason cancelledBy');

  console.log(`\nTrips to cancel: ${trips.length}\n`);
  for (const t of trips) {
    console.log(`  ${t._id}  status=${t.status}  load=${t.load?._id} (${t.load?.pickupLocation?.city} → ${t.load?.dropLocation?.city})`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to mark them cancelled.\n');
    process.exit(0);
  }

  if (trips.length === 0) {
    console.log('Nothing to do.\n');
    process.exit(0);
  }

  for (const t of trips) {
    await Trip.findByIdAndUpdate(t._id, {
      status: 'cancelled',
      cancelReason: t.load?.cancelReason || 'Cancelled by admin (synced)',
      cancelledBy: t.load?.cancelledBy,
    });
    console.log(`  ✓ Cancelled trip ${t._id}`);
  }

  console.log('\n✅ Done.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
