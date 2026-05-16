const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const OTP = require('../models/OTP');
const logger = require('../config/logger');
const { sendOTPEmail } = require('./emailService');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit

// Send OTP via SMS using Renflair (https://sms.renflair.in/)
// Endpoint: GET /V1.php?API=<key>&PHONE=<10-digit>&OTP=<digits>
// DLT-approved template: "<OTP> is your verification code for <domain>"
const sendViaSMS = async (phone, otp) => {
  const apiKey = process.env.RENFLAIR_SMS_API_KEY;
  if (!apiKey) {
    logger.warn(`[DEV MODE] OTP for ${phone}: ${otp} (RENFLAIR_SMS_API_KEY not configured)`);
    return true;
  }

  // Strip non-digits, keep last 10 (Indian mobile)
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10) {
    logger.error(`[Renflair SMS] Invalid phone: ${phone}`);
    throw new Error('Invalid phone number for SMS');
  }

  try {
    const { data } = await axios.get('https://sms.renflair.in/V1.php', {
      params: { API: apiKey, PHONE: cleanPhone, OTP: otp },
      timeout: 15000,
    });
    logger.info(`[Renflair SMS] OTP sent to ${cleanPhone} → ${typeof data === 'object' ? JSON.stringify(data) : data}`);
    return true;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`[Renflair SMS] Send failed for ${cleanPhone}: ${msg}`);
    // Fallback so dev/staging can still test login if provider is flaky
    logger.warn(`[FALLBACK] OTP for ${cleanPhone}: ${otp}`);
    return false;
  }
};

exports.sendOTP = async (identifier, channel = 'sms') => {
  // Delete existing OTPs for this identifier
  await OTP.deleteMany({ phone: identifier });

  const otp = generateOTP();
  const otpId = uuidv4();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await OTP.create({ phone: identifier, otp, otpId, expiresAt });

  if (channel === 'email') {
    await sendOTPEmail(identifier, otp);
  } else {
    await sendViaSMS(identifier, otp);
  }

  // Only return the OTP value to the client when no real SMS provider is
  // configured (dev mode). In production this MUST stay server-side only.
  const includeOtpInResponse = !process.env.RENFLAIR_SMS_API_KEY;

  return {
    otpId,
    message: 'OTP sent successfully.',
    ...(includeOtpInResponse ? { otp } : {}),
  };
};

exports.verifyOTP = async (identifier, otp, otpId) => {
  const record = await OTP.findOne({ phone: identifier, otpId, isUsed: false });

  if (!record) return { valid: false, message: 'Invalid OTP session.' };
  if (record.expiresAt < new Date()) return { valid: false, message: 'OTP has expired.' };
  if (record.attempts >= 5) return { valid: false, message: 'Too many attempts. Request a new OTP.' };

  if (record.otp !== otp) {
    await OTP.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    return { valid: false, message: 'Incorrect OTP.' };
  }

  await OTP.updateOne({ _id: record._id }, { isUsed: true });
  return { valid: true };
};
