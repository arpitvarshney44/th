const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');

// ─── Config ───────────────────────────────────────────────────────────────────

const CASHFREE_ENV = process.env.CASHFREE_ENV || 'sandbox'; // 'sandbox' or 'production'

// Payment Gateway endpoints
const PG_BASE_URL = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

// Payouts endpoints
const PAYOUTS_BASE_URL = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/payout'
  : 'https://sandbox.cashfree.com/payout';

const PG_API_VERSION = '2023-08-01';

// Common headers for Payment Gateway
const pgHeaders = () => ({
  'x-client-id': process.env.CASHFREE_PG_APP_ID,
  'x-client-secret': process.env.CASHFREE_PG_SECRET_KEY,
  'x-api-version': PG_API_VERSION,
  'Content-Type': 'application/json',
});

// ─── PAYMENT GATEWAY ──────────────────────────────────────────────────────────

/**
 * Create a Cashfree order
 * @param {number} amount - in INR
 * @param {string} orderId - unique order ID
 * @param {object} customer - { id, name, email, phone }
 * @param {object} notes - optional metadata
 */
exports.createOrder = async (amount, orderId, customer, notes = {}) => {
  try {
    const payload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customer.id,
        customer_name: customer.name || 'Customer',
        customer_email: customer.email || 'noreply@truxhire.com',
        customer_phone: customer.phone,
      },
      order_note: notes.note || `Payment for trip ${notes.tripId || ''}`,
      order_meta: {
        notify_url: `${process.env.SERVER_URL || 'https://server.truxhire.tech'}/api/v1/payments/webhook`,
        ...(notes.returnUrl ? { return_url: notes.returnUrl } : {}),
      },
      order_tags: Object.fromEntries(Object.entries(notes).filter(([k]) => k !== 'returnUrl')),
    };

    const { data } = await axios.post(`${PG_BASE_URL}/orders`, payload, { headers: pgHeaders() });
    logger.info(`[Cashfree] Order created: ${data.order_id}`);
    return data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`[Cashfree] Create order failed: ${msg}`);
    throw new Error(msg);
  }
};

/** Fetch an order (order_status: ACTIVE | PAID | EXPIRED | TERMINATED …) */
exports.getOrder = async (orderId) => {
  try {
    const { data } = await axios.get(`${PG_BASE_URL}/orders/${encodeURIComponent(orderId)}`, { headers: pgHeaders() });
    return data;
  } catch (err) {
    logger.error(`[Cashfree] Get order failed: ${err.response?.data?.message || err.message}`);
    return null;
  }
};

/**
 * Verify a payment by fetching its status from Cashfree
 */
exports.verifyPayment = async (orderId) => {
  try {
    const { data } = await axios.get(`${PG_BASE_URL}/orders/${orderId}/payments`, { headers: pgHeaders() });
    // data is an array of payments — prefer a successful one if several attempts exist
    const list = Array.isArray(data) ? data : [];
    const payment = list.find((p) => p.payment_status === 'SUCCESS') || list[0] || null;
    if (!payment) return { status: 'PENDING' };
    return {
      status: payment.payment_status, // SUCCESS, FAILED, PENDING, USER_DROPPED
      paymentId: payment.cf_payment_id?.toString(),
      orderId: payment.order_id,
      amount: payment.payment_amount,
      method: payment.payment_method,
      time: payment.payment_completion_time,
      raw: payment,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`[Cashfree] Verify payment failed: ${msg}`);
    throw new Error(msg);
  }
};

/**
 * Create a hosted payment link (customer pays from any browser / UPI app).
 * Cashfree itself SMS/emails the link to the customer.
 * @param {object} p - { linkId, amount, purpose, customer: {name,email,phone}, expiryDays }
 */
exports.createPaymentLink = async ({ linkId, amount, purpose, customer, expiryDays = 7 }) => {
  try {
    const phone = String(customer.phone || '').replace(/\D/g, '').slice(-10);
    const payload = {
      link_id: linkId,
      link_amount: Math.round(amount * 100) / 100,
      link_currency: 'INR',
      link_purpose: String(purpose || 'TruxHire shipment payment').slice(0, 500),
      customer_details: {
        customer_name: customer.name || 'Customer',
        customer_phone: phone,
        ...(customer.email ? { customer_email: customer.email } : {}),
      },
      link_notify: { send_sms: !!phone, send_email: !!customer.email },
      link_auto_reminders: true,
      link_expiry_time: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
      link_meta: {
        notify_url: `${process.env.SERVER_URL || 'https://server.truxhire.tech'}/api/v1/payments/webhook`,
      },
    };
    const { data } = await axios.post(`${PG_BASE_URL}/links`, payload, { headers: pgHeaders() });
    logger.info(`[Cashfree] Payment link created: ${data.link_id}`);
    return { linkId: data.link_id, url: data.link_url, status: data.link_status, raw: data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`[Cashfree] Create payment link failed: ${msg}`);
    throw new Error(msg);
  }
};

/** Fetch a payment link (status: ACTIVE | PAID | PARTIALLY_PAID | EXPIRED | CANCELLED) */
exports.getPaymentLink = async (linkId) => {
  try {
    const { data } = await axios.get(`${PG_BASE_URL}/links/${encodeURIComponent(linkId)}`, { headers: pgHeaders() });
    return data;
  } catch (err) {
    logger.error(`[Cashfree] Get payment link failed: ${err.response?.data?.message || err.message}`);
    return null;
  }
};

/** Successful payments made against a payment link */
exports.getPaymentLinkPayments = async (linkId) => {
  try {
    const { data } = await axios.get(`${PG_BASE_URL}/links/${encodeURIComponent(linkId)}/orders`, {
      headers: pgHeaders(),
    });
    // Cashfree only accepts status=ALL|ACTIVE here, so filter PAID ourselves
    return (Array.isArray(data) ? data : []).filter((o) => o.order_status === 'PAID');
  } catch (err) {
    logger.error(`[Cashfree] Link orders failed: ${err.response?.data?.message || err.message}`);
    return [];
  }
};

/**
 * Verify webhook signature
 */
exports.verifyWebhookSignature = (rawBody, signature, timestamp) => {
  try {
    const secret = process.env.CASHFREE_PG_SECRET_KEY;
    if (!secret) return false;
    const data = timestamp + rawBody;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return expected === signature;
  } catch (err) {
    logger.error(`[Cashfree] Webhook verify failed: ${err.message}`);
    return false;
  }
};

// ─── PAYOUTS (v2) ────────────────────────────────────────────────────────────
// v2 me alag auth nahi — same x-client-id / x-client-secret headers (PG-style).
// Reference: https://www.cashfree.com/docs/api-reference/payouts/v2/

const PAYOUTS_API_VERSION = '2024-01-01';

const payoutHeaders = () => ({
  'x-client-id': process.env.CASHFREE_PAYOUT_CLIENT_ID,
  'x-client-secret': process.env.CASHFREE_PAYOUT_CLIENT_SECRET,
  'x-api-version': PAYOUTS_API_VERSION,
  'Content-Type': 'application/json',
});

/**
 * Add a beneficiary (driver bank account) to Cashfree Payouts v2.
 * Endpoint: POST /payout/beneficiary
 */
exports.addBeneficiary = async (driverId, driver) => {
  if (!process.env.CASHFREE_PAYOUT_CLIENT_ID || !process.env.CASHFREE_PAYOUT_CLIENT_SECRET) {
    throw new Error('Cashfree Payouts credentials missing.');
  }
  // beneficiary_id constraints: alphanumeric, underscore, pipe, dot — no hyphen.
  const beneId = `bene_${driverId}_${Date.now()}`;

  const payload = {
    beneficiary_id: beneId,
    beneficiary_name: (driver.bankAccount?.accountHolderName || driver.name || 'Driver').slice(0, 100),
    beneficiary_instrument_details: {
      bank_account_number: driver.bankAccount?.accountNumber,
      bank_ifsc: driver.bankAccount?.ifscCode,
    },
    beneficiary_contact_details: {
      beneficiary_email: driver.email || 'noreply@truxhire.com',
      beneficiary_phone: String(driver.phone || '').slice(-10),
      beneficiary_country_code: '+91',
      beneficiary_address: 'India',
      beneficiary_city: 'Bangalore',
      beneficiary_state: 'Karnataka',
      beneficiary_postal_code: '560001',
    },
  };

  try {
    const { data } = await axios.post(`${PAYOUTS_BASE_URL}/beneficiary`, payload, {
      headers: payoutHeaders(),
    });
    if (!data?.beneficiary_id) {
      throw new Error(data?.message || 'Failed to add beneficiary');
    }
    logger.info(`[Cashfree Payouts] Beneficiary added: ${data.beneficiary_id} (status: ${data.beneficiary_status || 'unknown'})`);
    return { id: data.beneficiary_id, raw: data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    const code = err.response?.status;
    let hint = '';
    if (code === 401 || code === 403 || /ip|whitelist/i.test(msg || '')) {
      hint = ' — Server IP must be whitelisted in Cashfree dashboard (Developers → Two-Factor Authentication).';
    }
    logger.error(`[Cashfree Payouts] Add beneficiary failed: ${msg}${hint}`);
    throw new Error(`${msg}${hint}`);
  }
};

/**
 * Create a payout transfer to a beneficiary (Standard Transfer v2).
 * Endpoint: POST /payout/transfers
 */
exports.createPayout = async (beneId, amount, transferId, remarks = 'Trip payout') => {
  // Cashfree v2: transfer_id allows alphanumeric + underscore, max 40 chars.
  const safeTransferId = String(transferId).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (safeTransferId.length < 4) {
    throw new Error('Invalid transferId — must be at least 4 chars');
  }

  const payload = {
    transfer_id: safeTransferId,
    transfer_amount: Math.round(amount * 100) / 100,
    transfer_currency: 'INR',
    transfer_mode: 'imps',
    transfer_remarks: String(remarks).replace(/[^A-Za-z0-9 ]/g, ' ').slice(0, 70),
    beneficiary_details: { beneficiary_id: beneId },
  };

  try {
    const { data } = await axios.post(`${PAYOUTS_BASE_URL}/transfers`, payload, {
      headers: payoutHeaders(),
    });
    const cfId = data?.cf_transfer_id;
    const status = data?.status;
    if (!cfId && !['RECEIVED', 'SUCCESS', 'COMPLETED', 'PROCESSING'].includes(status)) {
      throw new Error(data?.status_description || data?.message || 'Payout failed');
    }
    logger.info(`[Cashfree Payouts] Payout created: ${safeTransferId} for ₹${amount} (cf_id: ${cfId}, status: ${status})`);
    return {
      id: cfId ? String(cfId) : safeTransferId,
      transferId: safeTransferId,
      status: status || 'processing',
      amount,
      raw: data,
    };
  } catch (err) {
    const msg = err.response?.data?.status_description || err.response?.data?.message || err.message;
    const code = err.response?.status;
    let hint = '';
    if (code === 401 || code === 403 || /ip|whitelist/i.test(msg || '')) {
      hint = ' — Server IP must be whitelisted in Cashfree dashboard (Developers → Two-Factor Authentication).';
    }
    logger.error(`[Cashfree Payouts] Create payout failed: ${msg}${hint}`);
    throw new Error(`${msg}${hint}`);
  }
};

/**
 * Get payout/transfer status (v2).
 * Endpoint: GET /payout/transfers?transfer_id=...
 */
exports.getPayoutStatus = async (transferId) => {
  try {
    const { data } = await axios.get(`${PAYOUTS_BASE_URL}/transfers`, {
      headers: payoutHeaders(),
      params: { transfer_id: transferId },
    });
    return data;
  } catch (err) {
    logger.error(`[Cashfree Payouts] Status check failed: ${err.message}`);
    return null;
  }
};

/**
 * Normalise a Cashfree payout status into 'success' | 'failed' | 'pending' | null (unknown).
 */
exports.classifyPayoutStatus = (status) => {
  const st = String(status || '').toUpperCase();
  if (['SUCCESS', 'COMPLETED', 'TRANSFER_SUCCESS'].includes(st)) return 'success';
  if (['FAILED', 'REVERSED', 'REJECTED', 'CANCELLED', 'TRANSFER_FAILED', 'TRANSFER_REVERSED', 'TRANSFER_REJECTED'].includes(st)) return 'failed';
  if (['RECEIVED', 'PENDING', 'PROCESSING', 'APPROVAL_PENDING', 'INITIATED', 'SENT_TO_BENEFICIARY', 'ON_HOLD'].includes(st)) return 'pending';
  return null;
};
