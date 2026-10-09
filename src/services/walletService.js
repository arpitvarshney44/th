const User = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * Wallet ledger helpers.
 *
 * Every balance change is a single atomic `findOneAndUpdate` that returns the
 * post-update balance, so `balanceBefore` / `balanceAfter` written to the
 * ledger always match what is really in `User.walletBalance` — even with
 * concurrent webhook + API calls.
 */

const applyDelta = async (userId, delta) => {
  const filter = { _id: userId };
  // Never let a debit take the wallet below zero
  if (delta < 0) filter.walletBalance = { $gte: -delta };
  const updated = await User.findOneAndUpdate(
    filter,
    { $inc: { walletBalance: delta } },
    { new: true, select: 'walletBalance' },
  );
  if (!updated) {
    const exists = await User.exists({ _id: userId });
    if (!exists) throw new Error('User not found');
    throw new Error('Insufficient wallet balance');
  }
  return updated.walletBalance;
};

const record = async (userId, type, amount, balanceAfter, { description, category, status, tripId, referenceId, metadata }) => {
  const balanceBefore = type === 'credit' ? balanceAfter - amount : balanceAfter + amount;
  return Transaction.create({
    user: userId,
    type,
    amount,
    description,
    category,
    status,
    trip: tripId,
    referenceId,
    metadata,
    balanceBefore,
    balanceAfter,
  });
};

exports.credit = async (userId, amount, description, category, tripId = null, referenceId = null) => {
  if (!(amount > 0)) throw new Error('Invalid credit amount');
  const balanceAfter = await applyDelta(userId, amount);
  return record(userId, 'credit', amount, balanceAfter, {
    description, category, status: 'completed', tripId, referenceId,
  });
};

exports.debit = async (userId, amount, description, category, tripId = null) => {
  if (!(amount > 0)) throw new Error('Invalid debit amount');
  const balanceAfter = await applyDelta(userId, -amount);
  return record(userId, 'debit', amount, balanceAfter, {
    description, category, status: 'completed', tripId,
  });
};

/**
 * Debit the wallet but record the transaction as `pending`.
 * Used for withdrawals where the actual bank transfer is async — the wallet is
 * locked immediately, but the transaction is only marked `completed` once the
 * payout provider confirms success (or `failed` after a refund).
 */
exports.debitPending = async (userId, amount, description, category, tripId = null) => {
  if (!(amount > 0)) throw new Error('Invalid debit amount');
  const balanceAfter = await applyDelta(userId, -amount);
  return record(userId, 'debit', amount, balanceAfter, {
    description, category, status: 'pending', tripId,
  });
};

/**
 * Refund a withdrawal exactly once. Atomically flips the withdrawal from
 * pending → failed first; only the caller that wins that flip credits the wallet.
 * Returns the refund transaction, or null if it was already settled.
 */
exports.refundWithdrawal = async (withdrawalId, description, metadataPatch = {}) => {
  const tx = await Transaction.findOneAndUpdate(
    { _id: withdrawalId, category: 'withdrawal', status: 'pending' },
    { status: 'failed' },
    { new: true },
  );
  if (!tx) return null;
  try {
    const refundTx = await exports.credit(tx.user, tx.amount, description, 'refund', null, tx._id.toString());
    await Transaction.findByIdAndUpdate(tx._id, {
      metadata: {
        ...(tx.metadata || {}),
        ...metadataPatch,
        refundTxId: refundTx._id.toString(),
        refundedAt: new Date(),
      },
    });
    return refundTx;
  } catch (err) {
    // Credit failed — put the withdrawal back to pending so nothing is lost
    await Transaction.findByIdAndUpdate(withdrawalId, { status: 'pending' });
    throw err;
  }
};

/**
 * Wallet vs ledger check for one user (or all when userId omitted).
 * Expected balance = completed credits − all debits (a failed withdrawal debit is
 * offset by its refund credit) for wallet-affecting categories. Returns [{ userId, wallet, ledger, diff }].
 */
exports.reconcile = async (userId = null) => {
  const match = userId ? { user: new (require('mongoose').Types.ObjectId)(userId) } : {};
  const rows = await Transaction.aggregate([
    { $match: { ...match, category: { $ne: 'trip_payment' } } },
    {
      $group: {
        _id: '$user',
        ledger: {
          $sum: {
            $cond: [
              { $eq: ['$type', 'credit'] },
              { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] },
              { $multiply: ['$amount', -1] },
            ],
          },
        },
      },
    },
  ]);
  const users = await User.find({ _id: { $in: rows.map(r => r._id) } }).select('walletBalance');
  const bal = new Map(users.map(u => [String(u._id), u.walletBalance || 0]));
  return rows
    .map(r => ({ userId: r._id, wallet: bal.get(String(r._id)) || 0, ledger: r.ledger, diff: (bal.get(String(r._id)) || 0) - r.ledger }))
    .filter(r => r.diff !== 0);
};
