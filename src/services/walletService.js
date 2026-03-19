const User = require('../models/User');
const Transaction = require('../models/Transaction');

exports.credit = async (userId, amount, description, category, tripId = null, referenceId = null) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const balanceBefore = user.walletBalance;
  const balanceAfter = balanceBefore + amount;

  await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount } });

  const tx = await Transaction.create({
    user: userId,
    type: 'credit',
    amount,
    description,
    category,
    status: 'completed',
    trip: tripId,
    referenceId,
    balanceBefore,
    balanceAfter,
  });

  return tx;
};

exports.debit = async (userId, amount, description, category, tripId = null) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.walletBalance < amount) throw new Error('Insufficient wallet balance');

  const balanceBefore = user.walletBalance;
  const balanceAfter = balanceBefore - amount;

  await User.findByIdAndUpdate(userId, { $inc: { walletBalance: -amount } });

  const tx = await Transaction.create({
    user: userId,
    type: 'debit',
    amount,
    description,
    category,
    status: 'completed',
    trip: tripId,
    balanceBefore,
    balanceAfter,
  });

  return tx;
};
