const logger = require('../config/logger');

/**
 * Real-time layer. Every change to the core collections is pushed over
 * Socket.IO so the apps / admin panel update with no manual refresh.
 *
 * Clients listen to a single event, `realtime`, with payload:
 *   { entity: 'trip'|'load'|'bid'|'wallet'|'notification'|'user', id, tripId?, status?, ts }
 * and simply refetch what their screen shows (debounced client-side).
 *
 * Rooms (joined in socket/index.js): user_<id>, role_<role>, admins
 */
let io = null;

exports.init = (server) => { io = server; };

const emit = (rooms, payload) => {
  if (!io) return;
  const msg = { ...payload, ts: Date.now() };
  [...new Set(rooms.filter(Boolean))].forEach((r) => io.to(r).emit('realtime', msg));
};
exports.emit = emit;

const u = (id) => (id ? `user_${id._id || id}` : null);

/** Mongoose plugin: emit after every save / findOneAndUpdate on the model. */
exports.plugin = (entity, resolve) => (schema) => {
  const fire = async (doc) => {
    if (!doc || !io) return;
    try {
      const { rooms, extra } = await resolve(doc);
      emit([...rooms, 'admins'], { entity, id: String(doc._id), ...extra });
    } catch (err) {
      logger.debug(`[realtime] ${entity}: ${err.message}`);
    }
  };
  schema.post('save', fire);
  schema.post('findOneAndUpdate', fire);
  // updateMany/updateOne give no document — nudge everyone interested in this entity
  if (['trip', 'load', 'bid'].includes(entity)) {
    schema.post(['updateMany', 'updateOne'], function () {
      if (io) emit(['role_driver', 'role_transporter', 'admins'], { entity });
    });
  }
  schema.post('insertMany', (docs) => (docs || []).forEach(fire));
};
