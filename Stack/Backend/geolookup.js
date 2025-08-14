const maxmind = require('maxmind');

// Load DB once at startup
let cityLookup;
(async () => {
  cityLookup = await maxmind.open('./GeoLite2-City.mmdb');
})();

async function geoLookup(ip) {
  if (!cityLookup) throw new Error("GeoIP DB not loaded yet");

  const geo = cityLookup.get(ip);
  if (!geo || !geo.location) return null;

  return {
    lat: geo.location.latitude,
    lon: geo.location.longitude,
    country: geo.country?.names?.en,
    city: geo.city?.names?.en
  };
}

module.exports = geoLookup;
