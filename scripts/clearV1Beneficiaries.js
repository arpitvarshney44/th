/**
 * Clear cached cashfreeBeneficiaryId from all users so the v2 API
 * re-creates them fresh on next withdrawal/retry. v1 beneficiaries are
 * not accessible from v2 endpoints.
 *
 * Usage:
 *   node scripts/clearV1Beneficiaries.js              # dry run
 *   node scripts/clearV1Beneficiaries.js --apply
 */
require('dotenv').config();
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Trip = require('../src/models/Trip');

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();

  const users = await User.find({ cashfreeBeneficiaryId: { $exists: true, $ne: null } })
    .select('_id name phone cashfreeBeneficiaryId');
  const trips = await Trip.find({ driverBeneficiaryId: { $exists: true, $ne: null } })
    .select('_id driverBeneficiaryId');

  console.log(`\nUsers with cached beneficiary: ${users.length}`);
  users.forEach(u => console.log(`  ${u._id}  ${u.name || '—'} (${u.phone || '—'})  bene=${u.cashfreeBeneficiaryId}`));

  console.log(`\nTrips with cached beneficiary: ${trips.length}`);
  trips.forEach(t => console.log(`  ${t._id}  bene=${t.driverBeneficiaryId}`));

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to clear all cached beneficiary IDs.\n');
    process.exit(0);
  }

  const userRes = await User.updateMany(
    { cashfreeBeneficiaryId: { $exists: true, $ne: null } },
    { $unset: { cashfreeBeneficiaryId: '' } },
  );
  const tripRes = await Trip.updateMany(
    { driverBeneficiaryId: { $exists: true, $ne: null } },
    { $unset: { driverBeneficiaryId: '' } },
  );

  console.log(`\n✓ Cleared cashfreeBeneficiaryId on ${userRes.modifiedCount} user(s)`);
  console.log(`✓ Cleared driverBeneficiaryId on ${tripRes.modifiedCount} trip(s)`);
  console.log('\nNext withdrawal / admin Retry will recreate beneficiaries via v2.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
