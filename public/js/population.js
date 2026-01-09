// Population distribution by latitude bands
// Source: Derived from WorldPop, UN Population data, and demographic studies
// Data represents approximate % of world population living at or above each latitude
// World population reference: ~8 billion (2024)

// Format: latitude -> { percentNorth: X, percentSouth: Y }
// percentNorth = % of world population living NORTH of this latitude
// percentSouth = % of world population living SOUTH of this latitude

const POPULATION_BY_LATITUDE = {
  // Arctic regions
  85: { percentNorth: 0.00, percentSouth: 100.00 },
  80: { percentNorth: 0.00, percentSouth: 100.00 },
  75: { percentNorth: 0.00, percentSouth: 100.00 },
  70: { percentNorth: 0.01, percentSouth: 99.99 },
  68: { percentNorth: 0.02, percentSouth: 99.98 },
  66: { percentNorth: 0.05, percentSouth: 99.95 }, // Arctic Circle
  65: { percentNorth: 0.08, percentSouth: 99.92 },
  64: { percentNorth: 0.12, percentSouth: 99.88 }, // Reykjavik
  63: { percentNorth: 0.18, percentSouth: 99.82 },
  62: { percentNorth: 0.25, percentSouth: 99.75 },
  61: { percentNorth: 0.35, percentSouth: 99.65 },
  60: { percentNorth: 0.50, percentSouth: 99.50 }, // Helsinki, St. Petersburg
  59: { percentNorth: 0.70, percentSouth: 99.30 }, // Stockholm, Oslo
  58: { percentNorth: 0.95, percentSouth: 99.05 },
  57: { percentNorth: 1.25, percentSouth: 98.75 },
  56: { percentNorth: 1.60, percentSouth: 98.40 }, // Moscow
  55: { percentNorth: 2.10, percentSouth: 97.90 }, // Copenhagen, Edinburgh
  54: { percentNorth: 2.70, percentSouth: 97.30 },
  53: { percentNorth: 3.40, percentSouth: 96.60 }, // Manchester, Hamburg
  52: { percentNorth: 4.20, percentSouth: 95.80 }, // Berlin, Amsterdam
  51: { percentNorth: 5.20, percentSouth: 94.80 }, // London, Brussels
  50: { percentNorth: 6.30, percentSouth: 93.70 }, // Prague, Krakow
  49: { percentNorth: 7.50, percentSouth: 92.50 }, // Paris, Vancouver
  48: { percentNorth: 8.80, percentSouth: 91.20 }, // Vienna, Munich
  47: { percentNorth: 10.20, percentSouth: 89.80 },
  46: { percentNorth: 11.70, percentSouth: 88.30 },
  45: { percentNorth: 13.30, percentSouth: 86.70 }, // Milan, Montreal
  44: { percentNorth: 15.00, percentSouth: 85.00 },
  43: { percentNorth: 16.80, percentSouth: 83.20 }, // Toronto
  42: { percentNorth: 18.70, percentSouth: 81.30 }, // Rome, Boston
  41: { percentNorth: 20.80, percentSouth: 79.20 }, // Madrid, Istanbul
  40: { percentNorth: 23.00, percentSouth: 77.00 }, // Beijing, NYC
  39: { percentNorth: 25.50, percentSouth: 74.50 },
  38: { percentNorth: 28.20, percentSouth: 71.80 }, // Seoul, San Francisco
  37: { percentNorth: 31.00, percentSouth: 69.00 }, // Tokyo
  36: { percentNorth: 34.00, percentSouth: 66.00 }, // Las Vegas, Tehran
  35: { percentNorth: 37.20, percentSouth: 62.80 }, // Los Angeles, Tokyo area
  34: { percentNorth: 40.50, percentSouth: 59.50 }, // Osaka
  33: { percentNorth: 44.00, percentSouth: 56.00 },
  32: { percentNorth: 47.50, percentSouth: 52.50 }, // Tel Aviv
  31: { percentNorth: 51.00, percentSouth: 49.00 }, // Shanghai, Cairo
  30: { percentNorth: 54.50, percentSouth: 45.50 }, // Cairo, New Orleans
  29: { percentNorth: 58.00, percentSouth: 42.00 }, // Houston
  28: { percentNorth: 61.20, percentSouth: 38.80 }, // Delhi (just north)
  27: { percentNorth: 64.00, percentSouth: 36.00 },
  26: { percentNorth: 66.50, percentSouth: 33.50 }, // Miami
  25: { percentNorth: 68.80, percentSouth: 31.20 }, // Taipei
  24: { percentNorth: 70.80, percentSouth: 29.20 }, // Dhaka area
  23: { percentNorth: 72.60, percentSouth: 27.40 }, // Havana, Hong Kong
  22: { percentNorth: 74.20, percentSouth: 25.80 }, // Kolkata
  21: { percentNorth: 75.60, percentSouth: 24.40 },
  20: { percentNorth: 76.90, percentSouth: 23.10 }, // Mexico City, Mumbai
  19: { percentNorth: 78.10, percentSouth: 21.90 },
  18: { percentNorth: 79.20, percentSouth: 20.80 },
  17: { percentNorth: 80.20, percentSouth: 19.80 },
  16: { percentNorth: 81.10, percentSouth: 18.90 },
  15: { percentNorth: 81.90, percentSouth: 18.10 }, // Manila, Khartoum
  14: { percentNorth: 82.60, percentSouth: 17.40 },
  13: { percentNorth: 83.30, percentSouth: 16.70 }, // Bangkok, Chennai
  12: { percentNorth: 83.90, percentSouth: 16.10 }, // Bangalore
  11: { percentNorth: 84.50, percentSouth: 15.50 },
  10: { percentNorth: 85.00, percentSouth: 15.00 }, // Caracas, Ho Chi Minh
  9: { percentNorth: 85.50, percentSouth: 14.50 },
  8: { percentNorth: 86.00, percentSouth: 14.00 }, // Addis Ababa
  7: { percentNorth: 86.50, percentSouth: 13.50 },
  6: { percentNorth: 86.95, percentSouth: 13.05 }, // Lagos, Colombo
  5: { percentNorth: 87.35, percentSouth: 12.65 },
  4: { percentNorth: 87.70, percentSouth: 12.30 }, // Bogota
  3: { percentNorth: 88.00, percentSouth: 12.00 },
  2: { percentNorth: 88.25, percentSouth: 11.75 },
  1: { percentNorth: 88.50, percentSouth: 11.50 }, // Singapore
  0: { percentNorth: 88.70, percentSouth: 11.30 }, // Equator - Quito

  // Southern Hemisphere
  "-1": { percentNorth: 88.90, percentSouth: 11.10 },
  "-2": { percentNorth: 89.10, percentSouth: 10.90 },
  "-3": { percentNorth: 89.30, percentSouth: 10.70 },
  "-4": { percentNorth: 89.50, percentSouth: 10.50 }, // Kinshasa
  "-5": { percentNorth: 89.70, percentSouth: 10.30 },
  "-6": { percentNorth: 89.85, percentSouth: 10.15 }, // Jakarta
  "-7": { percentNorth: 90.00, percentSouth: 10.00 }, // Dar es Salaam
  "-8": { percentNorth: 90.15, percentSouth: 9.85 }, // Luanda
  "-9": { percentNorth: 90.30, percentSouth: 9.70 },
  "-10": { percentNorth: 90.45, percentSouth: 9.55 },
  "-11": { percentNorth: 90.60, percentSouth: 9.40 },
  "-12": { percentNorth: 90.75, percentSouth: 9.25 }, // Lima
  "-13": { percentNorth: 90.90, percentSouth: 9.10 },
  "-14": { percentNorth: 91.05, percentSouth: 8.95 },
  "-15": { percentNorth: 91.20, percentSouth: 8.80 }, // Lusaka
  "-16": { percentNorth: 91.35, percentSouth: 8.65 }, // La Paz
  "-17": { percentNorth: 91.50, percentSouth: 8.50 },
  "-18": { percentNorth: 91.65, percentSouth: 8.35 },
  "-19": { percentNorth: 91.80, percentSouth: 8.20 }, // Belo Horizonte
  "-20": { percentNorth: 91.95, percentSouth: 8.05 },
  "-21": { percentNorth: 92.10, percentSouth: 7.90 },
  "-22": { percentNorth: 92.25, percentSouth: 7.75 }, // Sao Paulo, Rio
  "-23": { percentNorth: 92.45, percentSouth: 7.55 },
  "-24": { percentNorth: 92.65, percentSouth: 7.35 },
  "-25": { percentNorth: 92.90, percentSouth: 7.10 }, // Pretoria
  "-26": { percentNorth: 93.15, percentSouth: 6.85 }, // Johannesburg
  "-27": { percentNorth: 93.40, percentSouth: 6.60 }, // Brisbane
  "-28": { percentNorth: 93.65, percentSouth: 6.35 },
  "-29": { percentNorth: 93.90, percentSouth: 6.10 }, // Durban
  "-30": { percentNorth: 94.15, percentSouth: 5.85 }, // Porto Alegre
  "-31": { percentNorth: 94.40, percentSouth: 5.60 },
  "-32": { percentNorth: 94.65, percentSouth: 5.35 },
  "-33": { percentNorth: 94.90, percentSouth: 5.10 }, // Sydney, Santiago, Cape Town
  "-34": { percentNorth: 95.20, percentSouth: 4.80 }, // Buenos Aires
  "-35": { percentNorth: 95.50, percentSouth: 4.50 },
  "-36": { percentNorth: 95.80, percentSouth: 4.20 },
  "-37": { percentNorth: 96.10, percentSouth: 3.90 }, // Melbourne
  "-38": { percentNorth: 96.40, percentSouth: 3.60 },
  "-39": { percentNorth: 96.65, percentSouth: 3.35 },
  "-40": { percentNorth: 96.90, percentSouth: 3.10 },
  "-41": { percentNorth: 97.10, percentSouth: 2.90 }, // Wellington
  "-42": { percentNorth: 97.30, percentSouth: 2.70 },
  "-43": { percentNorth: 97.50, percentSouth: 2.50 }, // Christchurch
  "-44": { percentNorth: 97.65, percentSouth: 2.35 },
  "-45": { percentNorth: 97.80, percentSouth: 2.20 },
  "-46": { percentNorth: 97.90, percentSouth: 2.10 },
  "-47": { percentNorth: 98.00, percentSouth: 2.00 },
  "-48": { percentNorth: 98.10, percentSouth: 1.90 },
  "-49": { percentNorth: 98.20, percentSouth: 1.80 },
  "-50": { percentNorth: 98.30, percentSouth: 1.70 },
  "-51": { percentNorth: 98.40, percentSouth: 1.60 },
  "-52": { percentNorth: 98.50, percentSouth: 1.50 },
  "-53": { percentNorth: 98.60, percentSouth: 1.40 }, // Punta Arenas
  "-54": { percentNorth: 98.70, percentSouth: 1.30 },
  "-55": { percentNorth: 98.80, percentSouth: 1.20 }, // Ushuaia
  "-56": { percentNorth: 98.90, percentSouth: 1.10 },
  "-57": { percentNorth: 98.95, percentSouth: 1.05 },
  "-58": { percentNorth: 99.00, percentSouth: 1.00 },
  "-59": { percentNorth: 99.05, percentSouth: 0.95 },
  "-60": { percentNorth: 99.10, percentSouth: 0.90 },
  "-65": { percentNorth: 99.50, percentSouth: 0.50 },
  "-70": { percentNorth: 99.90, percentSouth: 0.10 },
  "-75": { percentNorth: 99.99, percentSouth: 0.01 },
  "-80": { percentNorth: 100.00, percentSouth: 0.00 },
  "-85": { percentNorth: 100.00, percentSouth: 0.00 },
  "-90": { percentNorth: 100.00, percentSouth: 0.00 }
};

// Helper function to get population stats for any latitude
function getPopulationStats(lat) {
  const roundedLat = Math.round(lat);

  // Find the closest latitude we have data for
  const latitudes = Object.keys(POPULATION_BY_LATITUDE).map(Number).sort((a, b) => a - b);

  let closestLat = latitudes[0];
  let minDiff = Math.abs(roundedLat - closestLat);

  for (const l of latitudes) {
    const diff = Math.abs(roundedLat - l);
    if (diff < minDiff) {
      minDiff = diff;
      closestLat = l;
    }
  }

  return POPULATION_BY_LATITUDE[closestLat];
}

// Format population number nicely
function formatPopulation(pop) {
  if (pop >= 1000000000) {
    return (pop / 1000000000).toFixed(1) + 'B';
  }
  if (pop >= 1000000) {
    return (pop / 1000000).toFixed(1) + 'M';
  }
  if (pop >= 1000) {
    return (pop / 1000).toFixed(0) + 'K';
  }
  return pop.toString();
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { POPULATION_BY_LATITUDE, getPopulationStats, formatPopulation };
}
