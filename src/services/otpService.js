const { v4: uuidv4 } = require('uuid');
const OTP = require('../models/OTP');
const logger = require('../config/logger');
const { sendOTPEmail } = require('./emailService');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Send OTP via SMS (Twilio with DLT support)
const sendViaSMS = async (phone, otp) => {
  if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'your_twilio_account_sid') {
    logger.warn(`[DEV MODE] OTP for ${phone}: ${otp}`);
    return true;
  }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const msgOptions = {
      body: `Your TruxHire OTP is: ${otp}. Valid for 10 minutes. Do not share with anyone.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `+91${phone}`,
    };

    // DLT registration for Indian SMS compliance
    if (process.env.DLT_ENTITY_ID) {
      msgOptions.messagingServiceSid = undefined; // use from number
    }

    await twilio.messages.create(msgOptions);
    return true;
  } catch (err) {
    logger.error(`SMS send failed: ${err.message}`);
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

  return { otpId, message: 'OTP sent successfully.' };
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
