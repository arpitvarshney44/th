const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

exports.sendOTPEmail = async (email, otp) => {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your@gmail.com') {
    logger.warn(`[DEV MODE] Email OTP for ${email}: ${otp}`);
    return true;
  }

  try {
    await getTransporter().sendMail({
      from: `"TruxHire" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'TruxHire - Email Verification Code',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#1A1A1A;border-radius:12px;">
          <h2 style="color:#E53935;text-align:center;margin-bottom:10px;">TRUXHIRE</h2>
          <p style="color:#fff;text-align:center;font-size:16px;">Your verification code is:</p>
          <div style="background:#E53935;color:#fff;font-size:32px;font-weight:bold;text-align:center;padding:20px;border-radius:8px;letter-spacing:8px;margin:20px 0;">
            ${otp}
          </div>
          <p style="color:#999;text-align:center;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
    logger.info(`OTP email sent to ${email}`);
    return true;
  } catch (err) {
    logger.error(`Email send failed: ${err.message}`);
    return false;
  }
};

exports.sendPaymentLinkEmail = async (email, { amount, tripCode, url }) => {
  if (!email || !process.env.SMTP_USER || process.env.SMTP_USER === 'your@gmail.com') return false;
  try {
    await getTransporter().sendMail({
      from: `"TruxHire" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `TruxHire - Payment link for shipment ${tripCode}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;border:1px solid #eee;border-radius:12px;">
          <h2 style="color:#E53935;text-align:center;">TRUXHIRE</h2>
          <p>Loading is complete for shipment <b>${tripCode}</b>.</p>
          <p>Please pay <b>₹${Number(amount).toLocaleString('en-IN')}</b> using the secure link below (UPI / Card / NetBanking):</p>
          <p style="text-align:center;margin:28px 0;"><a href="${url}" style="background:#E53935;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">PAY NOW</a></p>
          <p style="color:#888;font-size:12px;">If the button does not work, open: ${url}</p>
        </div>`,
    });
    return true;
  } catch (err) {
    logger.error(`Payment link email failed: ${err.message}`);
    return false;
  }
};
