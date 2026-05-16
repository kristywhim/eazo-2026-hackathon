// GET /api/detect-hub
// Returns which hub the user belongs to based on IP geolocation.
// Used by frontend WebView to auto-select the correct hub tab.
//
// Response: { hub: 'sf'|'ny'|'sh'|'go'|'ao', ip: string, country: string, restricted: bool }
//
// IP restriction rules:
//   - SH tab and Asia Online tab: only visible to China IPs (CN)
//   - All other hubs: visible to everyone
//
// ⚠️  PENDING: For production, use a real IP geo service.
//   Options: ipapi.co (free 30k/month), ip-api.com (free), MaxMind GeoIP2 (accurate)
//   Set IPGEO_KEY in env if your chosen service requires a key.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Get client IP (Vercel sets x-forwarded-for)
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '0.0.0.0';

    // Localhost / private IPs → default to SF
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return res.json({ hub: 'sf', ip, country: 'LOCAL', restricted: false });
    }

    // ── Geo lookup ──────────────────────────────────────────────────
    // Using ip-api.com (free, no key needed, 45 req/min limit)
    // TODO: switch to paid service for production reliability
    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,city,status`);
    const geo = await geoRes.json();

    if (geo.status !== 'success') {
      return res.json({ hub: 'sf', ip, country: 'UNKNOWN', restricted: false });
    }

    const country = geo.countryCode;  // 'CN', 'US', 'JP', etc.
    const isChinaIP = country === 'CN';

    // ── Hub assignment logic ────────────────────────────────────────
    // This is approximate — Eazo team should refine with actual registration data
    let hub = 'sf';      // default
    let restricted = false;

    if (isChinaIP) {
      hub = 'sh';        // China IPs default to Shanghai
      restricted = false; // can see SH + Asia Online
    } else if (country === 'US') {
      // NYC area → NY; everything else → SF / Global Online
      const nycCities = ['New York', 'Brooklyn', 'Queens', 'Bronx', 'Newark', 'Jersey City'];
      hub = nycCities.some(c => geo.city?.includes(c)) ? 'ny' : 'sf';
      restricted = true;  // can't see SH or Asia Online
    } else {
      // All other countries → Global Online
      hub = 'go';
      restricted = true;
    }

    return res.json({ hub, ip, country, restricted });
  } catch (err) {
    console.error('[detect-hub] error:', err);
    return res.status(500).json({ hub: 'sf', error: err.message });
  }
};
