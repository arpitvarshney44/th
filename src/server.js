require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const driverRoutes = require('./routes/driver');
const loadRoutes = require('./routes/loads');
const tripRoutes = require('./routes/trips');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});
require('./socket')(io);
app.set('io', io);
require('./services/realtime').init(io);

// Connect DB
connectDB();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({
  limit: '10mb',
  // Preserve raw body for Cashfree webhook signature verification
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/loads', loadRoutes);
app.use('/api/v1/trips', tripRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/notifications', require('./routes/notifications'));
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/payments', require('./routes/payments'));

// Transporter profile
app.use('/api/v1/transporter', require('./routes/transporter'));

// Platform Settings
app.use('/api/v1/settings', require('./routes/settings'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  logger.info(`🚀 TruxHire API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// Background reconciliation so a missed Cashfree webhook never leaves a payment
// or withdrawal (and therefore the wallet ledger) out of sync.
if (process.env.NODE_ENV !== 'test') {
  const paymentService = require('./services/paymentService');
  const payoutService = require('./services/payoutService');
  const RECONCILE_MS = 2 * 60 * 1000;
  setInterval(() => {
    paymentService.syncPendingPayments().catch((e) => logger.warn(`[Reconcile] payments: ${e.message}`));
    payoutService.settlePendingWithdrawals().catch((e) => logger.warn(`[Reconcile] payouts: ${e.message}`));
  }, RECONCILE_MS).unref();
}

module.exports = { app, server };
