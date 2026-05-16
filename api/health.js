// GET /api/health — diagnostic endpoint, safe to call publicly
module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const svcKey = process.env.SUPABASE_SERVICE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';

  // Test a direct fetch to Supabase (bypass JS client)
  let fetchResult = 'not_tested';
  let fetchError = null;
  try {
    const r = await fetch(`${url}/rest/v1/teams?select=id&limit=1`, {
      headers: {
        'apikey': svcKey,
        'Authorization': `Bearer ${svcKey}`,
      },
    });
    fetchResult = `HTTP ${r.status}`;
  } catch (e) {
    fetchError = e.message;
  }

  res.json({
    env: {
      SUPABASE_URL:         url   ? `${url.slice(0,30)}... (len ${url.length})`   : 'NOT SET',
      SUPABASE_SERVICE_KEY: svcKey  ? `set (len ${svcKey.length})`  : 'NOT SET',
      SUPABASE_ANON_KEY:    anonKey ? `set (len ${anonKey.length})` : 'NOT SET',
      ADMIN_SECRET:         process.env.ADMIN_SECRET ? 'set' : 'NOT SET',
      NODE_ENV:             process.env.NODE_ENV,
      NODE_VERSION:         process.version,
    },
    directFetch: { result: fetchResult, error: fetchError },
  });
};
