const axios = require('axios');
const logger = require('../config/logger');

/**
 * Haversine formula — straight-line distance between two lat/lng points in km.
 * Used as fallback when Google Maps API key is not configured.
 */
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/**
 * Get road distance (km) between two coordinates using Google Maps Distance Matrix API.
 * Falls back to Haversine if API key is missing or request fails.
 *
 * @param {number} originLat
 * @param {number} originLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {Promise<number>} distance in km
 */
exports.getRoadDistance = async (originLat, originLng, destLat, destLng) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey || apiKey === 'your_google_maps_api_key') {
    const dist = haversineDistance(originLat, originLng, destLat, destLng);
    logger.warn(`[distanceService] No Google Maps API key — using Haversine fallback: ${dist} km`);
    return dist;
  }

  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: {
          origins: `${originLat},${originLng}`,
          destinations: `${destLat},${destLng}`,
          mode: 'driving',
          units: 'metric',
          key: apiKey,
        },
        timeout: 5000,
      },
    );

    const element = data?.rows?.[0]?.elements?.[0];

    if (element?.status === 'OK') {
      const meters = element.distance.value;
      return Math.round(meters / 1000);
    }

    logger.warn(`[distanceService] Google Maps returned status: ${element?.status} — falling back to Haversine`);
  } catch (err) {
    logger.error(`[distanceService] Google Maps API error: ${err.message} — falling back to Haversine`);
  }

  return haversineDistance(originLat, originLng, destLat, destLng);
};
