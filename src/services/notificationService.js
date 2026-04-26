const Notification = require('../models/Notification');
const logger = require('../config/logger');

// Send push notification via FCM
const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return { status: 'no_token' };
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const path = require('path');
      const fs = require('fs');
      const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
      if (!fs.existsSync(serviceAccountPath)) {
        logger.error(`[FCM] Service account file not found`);
        return { status: 'failed', error: 'Service account not configured' };
      }
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      logger.info(`[FCM] Initialized with project: ${serviceAccount.project_id}`);
    }
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    logger.info(`[FCM] Push sent to ${fcmToken.slice(0, 20)}... | ${title}`);
    return { status: 'sent' };
  } catch (err) {
    logger.error(`[FCM] Push failed: ${err.message}`);
    return { status: 'failed', error: err.message };
  }
};

exports.sendNotification = async (userId, { title, body, type, data = {}, fcmToken, broadcastId, sentBy }) => {
  const pushResult = fcmToken ? await sendPush(fcmToken, title, body, data) : { status: 'no_token' };

  await Notification.create({
    user: userId, title, body, type, data,
    pushStatus: pushResult.status,
    pushError: pushResult.error,
    broadcastId,
    sentBy,
  });

  return pushResult;
};

exports.sendToMultiple = async (users, payload) => {
  const results = await Promise.allSettled(
    users.map((u) => exports.sendNotification(u._id, { ...payload, fcmToken: u.fcmToken }))
  );

  let sent = 0, failed = 0, noToken = 0;
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      if (r.value.status === 'sent') sent++;
      else if (r.value.status === 'failed') failed++;
      else noToken++;
    } else {
      failed++;
    }
  });

  return { total: users.length, sent, failed, noToken };
};

exports.sendToUser = async (userId, { title, body, type = 'system', data = {}, fcmToken, sentBy }) => {
  return exports.sendNotification(userId, { title, body, type, data, fcmToken, sentBy });
};
