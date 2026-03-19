const Notification = require('../models/Notification');
const logger = require('../config/logger');

// Send push notification via FCM
const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;
  if (!process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID === 'your_firebase_project_id') {
    logger.debug(`[FCM DEV] To: ${fcmToken?.slice(0, 20)}... | ${title}: ${body}`);
    return;
  }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    logger.error(`FCM push failed: ${err.message}`);
  }
};

exports.sendNotification = async (userId, { title, body, type, data = {}, fcmToken }) => {
  // Save to DB
  await Notification.create({ user: userId, title, body, type, data });

  // Send push if token provided
  if (fcmToken) await sendPush(fcmToken, title, body, data);
};

exports.sendToMultiple = async (users, payload) => {
  await Promise.allSettled(users.map((u) => exports.sendNotification(u._id, { ...payload, fcmToken: u.fcmToken })));
};
