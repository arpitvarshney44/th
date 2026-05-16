const User = require('../models/User');
const Transaction = require('../models/Transaction');
const walletService = require('../services/walletService');
const cashfreeService = require('../services/cashfreeService');
const logger = require('../config/logger');

// GET /wallet/balance
exports.getBalance = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('walletBalance');
    res.json({ success: true, data: { balance: user.walletBalance } });
  } catch (err) { next(err); }
};

// GET /wallet/transactions
exports.getTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Transaction.countDocuments({ user: req.user._id }),
    ]);

    res.json({ success: true, data: { transactions, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// POST /wallet/withdraw
exports.withdrawFunds = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal is ₹100.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.walletBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }

    const bank = user.bankAccount;
    if (!bank?.accountNumber || !bank?.ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'Add your bank account in Profile → Payout Accounts before withdrawing.',
      });
    }

    // 1️⃣ Debit wallet first (atomic) so the user can't double-withdraw on retries.
    //     Transaction is created with status `pending` until the payout actually succeeds.
    const debitTx = await walletService.debitPending(
      req.user._id, amount, 'Withdrawal to bank account', 'withdrawal',
    );

    // 2️⃣ Try Cashfree beneficiary + payout. On any failure we DO NOT refund.
    //     The transaction stays as `pending` and the admin handles it from the panel.
    let beneId = user.cashfreeBeneficiaryId;
    if (!beneId) {
      try {
        const bene = await cashfreeService.addBeneficiary(user._id, user);
        beneId = bene.id;
        await User.findByIdAndUpdate(user._id, { cashfreeBeneficiaryId: beneId });
      } catch (err) {
        await Transaction.findByIdAndUpdate(debitTx._id, {
          metadata: { failureReason: err.message, stage: 'beneficiary' },
        });
        logger.error(`[Withdraw] Beneficiary creation failed for ${user._id}: ${err.message}`);
        return res.json({
          success: true,
          message: 'Withdrawal request received. Our team will process it shortly.',
          data: { txId: debitTx._id, amount, status: 'pending' },
        });
      }
    }

    // 3️⃣ Trigger the actual transfer via Cashfree Payouts.
    // Cashfree v2: transfer_id max 40 chars, alphanumeric + underscore only.
    // Use the last 12 chars of user id + timestamp tail to stay well under 40.
    const userTail = String(user._id).slice(-12);
    const transferId = `wd_${userTail}_${Date.now().toString().slice(-10)}`;
    try {
      const payout = await cashfreeService.createPayout(
        beneId, amount, transferId, 'TruxHire wallet withdrawal',
      );

      // IMPORTANT — Cashfree v2 returns `RECEIVED` (queued) immediately.
      // We keep the tx as `pending` and let the webhook / admin refresh
      // flip it to `completed` once the bank actually credits (UTR available).
      const remoteStatus = String(payout.status || '').toUpperCase();
      const finalStates = ['SUCCESS', 'COMPLETED'];
      const isFinal = finalStates.includes(remoteStatus);

      await Transaction.findByIdAndUpdate(debitTx._id, {
        status: isFinal ? 'completed' : 'pending',
        referenceId: payout.id,
        metadata: {
          transferId,
          beneficiaryId: beneId,
          payoutStatus: remoteStatus || 'RECEIVED',
          cfTransferId: payout.id,
        },
      });

      return res.json({
        success: true,
        message: isFinal
          ? `₹${amount.toLocaleString('en-IN')} credited to your bank account.`
          : `₹${amount.toLocaleString('en-IN')} withdrawal submitted. Funds typically reach your bank within a few minutes.`,
        data: { transferId, referenceId: payout.id, amount, status: isFinal ? 'completed' : 'pending' },
      });
    } catch (err) {
      await Transaction.findByIdAndUpdate(debitTx._id, {
        metadata: { failureReason: err.message, stage: 'payout', transferId, beneficiaryId: beneId },
      });
      logger.error(`[Withdraw] Payout failed for ${user._id}: ${err.message}`);
      return res.json({
        success: true,
        message: 'Withdrawal request received. Our team will process it shortly.',
        data: { txId: debitTx._id, amount, status: 'pending' },
      });
    }
  } catch (err) { next(err); }
};

// GET /transporter/payments
exports.getTransporterPayments = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [transactions, total, totalSpent] = await Promise.all([
      Transaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Transaction.countDocuments({ user: req.user._id }),
      Transaction.aggregate([
        { $match: { user: req.user._id, type: 'debit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        total,
        totalSpent: totalSpent[0]?.total || 0,
        page: Number(page),
      },
    });
  } catch (err) { next(err); }
};

// ─── Cashfree Payouts Webhook ────────────────────────────────────────────────
// Cashfree sends transfer status updates here. We use it to auto-flip
// pending withdrawals to `completed` (or `failed`) without admin action.
//
// Typical event types: TRANSFER_SUCCESS, TRANSFER_FAILED, TRANSFER_REVERSED
exports.handlePayoutsWebhook = async (req, res) => {
  try {
    const event = req.body || {};
    const transfer = event?.data?.transfer || event?.transfer || event?.data || {};
    const transferId = transfer.transfer_id || transfer.transferId;
    const status = (transfer.status || event.type || '').toUpperCase();
    const utr = transfer.transfer_utr || transfer.utr || null;
    const cfTransferId = transfer.cf_transfer_id || transfer.cfTransferId || null;

    if (!transferId) {
      return res.status(200).json({ ok: true, ignored: 'no transfer_id' });
    }

    // Find the withdrawal whose metadata.transferId matches
    const tx = await Transaction.findOne({
      category: 'withdrawal',
      'metadata.transferId': transferId,
    });
    if (!tx) {
      logger.warn(`[Cashfree Payouts Webhook] No withdrawal tx found for transferId=${transferId}`);
      return res.status(200).json({ ok: true, ignored: 'tx not found' });
    }

    // Map Cashfree status → our status
    const SUCCESS = ['SUCCESS', 'COMPLETED', 'TRANSFER_SUCCESS'];
    const FAILURE = ['FAILED', 'REVERSED', 'REJECTED', 'TRANSFER_FAILED', 'TRANSFER_REVERSED'];

    if (SUCCESS.includes(status) && tx.status !== 'completed') {
      await Transaction.findByIdAndUpdate(tx._id, {
        status: 'completed',
        referenceId: utr || cfTransferId || tx.referenceId,
        metadata: { ...(tx.metadata || {}), webhookStatus: status, utr, cfTransferId, webhookAt: new Date() },
      });
      logger.info(`[Cashfree Payouts Webhook] ${transferId} → completed (UTR: ${utr || '—'})`);
    } else if (FAILURE.includes(status) && tx.status !== 'failed' && tx.status !== 'completed') {
      // Mark as failed and refund the wallet
      const refundTx = await walletService.credit(
        tx.user, tx.amount,
        `Withdrawal refund - bank rejected by ${utr ? `UTR ${utr}` : 'provider'}`,
        'refund',
        null,
        tx._id.toString(),
      );
      await Transaction.findByIdAndUpdate(tx._id, {
        status: 'failed',
        metadata: {
          ...(tx.metadata || {}),
          webhookStatus: status,
          webhookAt: new Date(),
          refundTxId: refundTx._id.toString(),
          refundedAt: new Date(),
        },
      });
      logger.info(`[Cashfree Payouts Webhook] ${transferId} → failed, refunded ₹${tx.amount}`);
    } else {
      // Intermediate status (e.g. PROCESSING) — just log
      logger.info(`[Cashfree Payouts Webhook] ${transferId} status=${status} (no state change)`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(`[Cashfree Payouts Webhook] ${err.message}`);
    return res.status(500).json({ ok: false, message: err.message });
  }
};
