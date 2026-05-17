/**
 * Centralised access to mutable platform settings.
 * Reads from the `Settings` collection first, falls back to env, then to defaults.
 *
 * Two values matter for the payment flow:
 *   - platform_commission   (number 0-100, percentage TruxHire keeps)
 *   - payout_loading_percent (number 0-100, what % of driver earnings is released at loading approval)
 *
 * Cached for 60s to avoid hammering Mongo on every trip.
 */
const Settings = require('../models/Settings');

const DEFAULTS = {
  platform_commission: Number(process.env.PLATFORM_COMMISSION || 10),
  payout_loading_percent: 90,
};

const cache = new Map();
const TTL_MS = 60 * 1000;

const readNumber = (raw, fallback) => {
  if (raw === null || raw === undefined) return fallback;
  const n = Number(typeof raw === 'object' ? (raw.value ?? raw.amount ?? raw.percent ?? raw) : raw);
  return Number.isFinite(n) ? n : fallback;
};

const get = async (key) => {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) return cached.value;

  let value = DEFAULTS[key];
  try {
    const doc = await Settings.findOne({ key });
    if (doc && doc.value !== undefined && doc.value !== null) {
      value = readNumber(doc.value, DEFAULTS[key]);
    }
  } catch (_) {}

  cache.set(key, { at: now, value });
  return value;
};

exports.invalidate = (key) => {
  if (key) cache.delete(key);
  else cache.clear();
};

/** Commission percent (e.g. 10 for 10%) */
exports.getCommissionPercent = async () => get('platform_commission');

/** Commission rate as decimal (e.g. 0.1) */
exports.getCommissionRate = async () => (await get('platform_commission')) / 100;

/** Loading split percent (default 90 — released on loading approval) */
exports.getLoadingSplitPercent = async () => get('payout_loading_percent');

/** Loading split as decimal */
exports.getLoadingSplitRate = async () => (await get('payout_loading_percent')) / 100;

/** Delivery split as decimal (always 1 - loading split) */
exports.getDeliverySplitRate = async () => 1 - (await get('payout_loading_percent')) / 100;

/**
 * Compute commission + driver earnings from agreed price.
 * Rounded to nearest rupee.
 */
exports.computeSplit = async (agreedPrice) => {
  const rate = await exports.getCommissionRate();
  const commission = Math.round(agreedPrice * rate);
  return {
    agreedPrice,
    commission,
    driverEarnings: agreedPrice - commission,
    commissionPercent: rate * 100,
  };
};

exports.DEFAULTS = DEFAULTS;
