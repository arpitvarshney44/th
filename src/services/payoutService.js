const Transaction = require('../models/Transaction');
const walletService = require('./walletService');
const cashfreeService = require('./cashfreeService');
const logger = require('../config/logger');

const unwrap = (remote) => remote?.data && typeof remote.data === 'object' && !Array.isArray(remote.data) ? remote.data : remote;

/**
 * Reconcile ONE pending withdrawal against Cashfree (source of truth).
 * - success  → completed (UTR saved)
 * - failed   → failed + wallet refunded exactly once
 * - pending  → untouched
 * Returns { outcome: 'completed'|'refunded'|'pending'|'unknown', status, utr }.
 */
exports.settleWithdrawal = async (txId) => {
  const tx = await Transaction.findById(txId);
  if (!tx || tx.category !== 'withdrawal') return { outcome: 'unknown' };
  if (tx.status !== 'pending') return { outcome: tx.status === 'completed' ? 'completed' : 'refunded', status: tx.status };

  const transferId = tx.metadata?.transferId;
  if (!transferId) return { outcome: 'unknown', reason: 'no transferId' };

  const remote = unwrap(await cashfreeService.getPayoutStatus(transferId));
  if (!remote) return { outcome: 'unknown', reason: 'cashfree unreachable' };

  const status = String(remote.status || '').toUpperCase();
  const utr = remote.transfer_utr || remote.utr || null;
  const cfTransferId = remote.cf_transfer_id ? String(remote.cf_transfer_id) : null;
  const kind = cashfreeService.classifyPayoutStatus(status);

  if (kind === 'success') {
    const done = await Transaction.findOneAndUpdate(
      { _id: tx._id, status: 'pending' },
      {
        status: 'completed',
        referenceId: utr || cfTransferId || tx.referenceId,
        metadata: { ...(tx.metadata || {}), payoutStatus: status, utr, cfTransferId, settledAt: new Date() },
      },
    );
    if (done) logger.info(`[Payout] ${transferId} completed (UTR ${utr || '-'})`);
    return { outcome: 'completed', status, utr };
  }
  if (kind === 'failed') {
    const refund = await walletService.refundWithdrawal(
      tx._id,
      `Withdrawal refund - ${status.toLowerCase()} by bank/provider`,
      { payoutStatus: status, settledAt: new Date() },
    );
    if (refund) logger.info(`[Payout] ${transferId} ${status} → refunded ₹${tx.amount}`);
    return { outcome: 'refunded', status };
  }
  return { outcome: 'pending', status };
};

/** Settle every pending withdrawal that has been handed to Cashfree. */
exports.settlePendingWithdrawals = async () => {
  const pending = await Transaction.find({
    category: 'withdrawal', status: 'pending', 'metadata.transferId': { $exists: true },
  }).select('_id').limit(100);
  for (const t of pending) {
    try { await exports.settleWithdrawal(t._id); } catch (e) { logger.warn(`[Payout sync] ${t._id}: ${e.message}`); }
  }
};
