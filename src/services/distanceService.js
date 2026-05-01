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

  // Use Google Maps if key is available
  if (apiKey && apiKey !== 'your_google_maps_api_key' && apiKey.trim() !== '') {
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
      logger.warn(`[distanceService] Google Maps returned status: ${element?.status} — trying OSRM fallback`);
    } catch (err) {
      logger.error(`[distanceService] Google Maps API error: ${err.message} — trying OSRM fallback`);
    }
  }

  // Use OSRM as a completely free road distance calculation fallback
  try {
    const { data } = await axios.get(
      `http://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`,
      { timeout: 5000 }
    );

    if (data?.routes?.[0]?.distance) {
      const meters = data.routes[0].distance;
      const dist = Math.round(meters / 1000);
      logger.info(`[distanceService] OSRM calculated road distance: ${dist} km`);
      return dist;
    }
    logger.warn(`[distanceService] OSRM returned no distance — using Haversine`);
  } catch (err) {
    logger.error(`[distanceService] OSRM API error: ${err.message} — falling back to Haversine`);
  }

  // Fallback to straight-line Haversine
  const dist = haversineDistance(originLat, originLng, destLat, destLng);
  logger.info(`[distanceService] Fallback to Haversine: ${dist} km`);
  return dist;
};
