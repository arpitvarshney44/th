const User = require('../models/User');
const Transaction = require('../models/Transaction');
const walletService = require('../services/walletService');

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
    const { amount, bankAccountId } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal is ₹100.' });
    }

    const user = await User.findById(req.user._id);
    if (user.walletBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }

    await walletService.debit(req.user._id, amount, 'Withdrawal to bank account', 'withdrawal');

    // TODO: Initiate actual bank transfer via Razorpay Payout API
    res.json({ success: true, message: `₹${amount} withdrawal initiated. Will be credited in 1-2 business days.` });
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
