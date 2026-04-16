require('dotenv').config();
require('../src/models/User');
require('../src/models/Load');
require('../src/models/Truck');
require('../src/models/Bid');
require('../src/models/Trip');
require('../src/models/Transaction');
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Trip = mongoose.model('Trip');
  const Transaction = mongoose.model('Transaction');
  const User = mongoose.model('User');
  const Load = mongoose.model('Load');

  const [trips, txns, users, loads] = await Promise.all([
    Trip.countDocuments(), Transaction.countDocuments(),
    User.countDocuments(), Load.countDocuments(),
  ]);
  console.log('COUNTS - Users:', users, '| Loads:', loads, '| Trips:', trips, '| Txns:', txns);

  const tripStatuses = await Trip.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const paymentStatuses = await Trip.aggregate([{ $group: { _id: '$paymentStatus', count: { $sum: 1 } } }]);
  const payoutStages = await Trip.aggregate([{ $group: { _id: '$payoutStage', count: { $sum: 1 } } }]);
  const txCategories = await Transaction.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);

  console.log('TRIP STATUS:', tripStatuses.map(s => s._id + ':' + s.count).join(', '));
  console.log('PAYMENT STATUS:', paymentStatuses.map(s => s._id + ':' + s.count).join(', '));
  console.log('PAYOUT STAGE:', payoutStages.map(s => s._id + ':' + s.count).join(', '));
  console.log('TX CATEGORIES:', txCategories.map(s => s._id + ':' + s.count).join(', ') || 'none');

  // Check trip details
  const trip = await Trip.findOne()
    .populate('driver', 'name phone')
    .populate('transporter', 'name companyName')
    .populate('load', 'pickupLocation dropLocation offeredPrice')
    .lean();
  if (trip) {
    console.log('\nTRIP DETAIL:');
    console.log('  Status:', trip.status, '| Payment:', trip.paymentStatus, '| Payout:', trip.payoutStage);
    console.log('  Price:', trip.agreedPrice, '| Earnings:', trip.driverEarnings);
    console.log('  Loading proof:', trip.loadingProof?.length || 0, 'photos');
    console.log('  Delivery proof:', trip.deliveryProof?.length || 0, 'photos');
    console.log('  Driver:', trip.driver?.name, '| Transporter:', trip.transporter?.companyName || trip.transporter?.name);
    console.log('  Route:', trip.load?.pickupLocation?.city, '->', trip.load?.dropLocation?.city);
  }

  await mongoose.disconnect();
  process.exit(0);
}).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
