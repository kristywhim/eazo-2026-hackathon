// GET /api/leaderboard?hub=sf | ?region=sf
// Returns the live leaderboard for OnAir display, ranked at the APP level.
// (One team may have multiple apps; each app is its own row in the leaderboard.)
// Public endpoint — no auth required.
//
// Response: { hub|region, apps: App[], updatedAt }
// App: { rank, appId, teamId, teamName, appName, track, hub, votes }

const { getClient } = require('./_supabase');
const { validHub } = require('./_auth');

const REGION_HUBS = {
  sf: ['sf', 'go'],
  sh: ['sh', 'ao'],
  ny: ['ny'],
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const region = req.query.region;
  const hub    = req.query.hub;

  let hubsToQuery;
  if (region) {
    if (!REGION_HUBS[region]) return res.status(400).json({ error: 'Invalid region' });
    hubsToQuery = REGION_HUBS[region];
  } else {
    if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub' });
    hubsToQuery = [hub];
  }

  const supabase = getClient();

  // Use the per-app vote totals view, joined with team info
  const { data, error } = await supabase
    .from('v_app_vote_totals')
    .select(`
      app_id, team_id, app_name, hub, track, votes,
      teams ( id, name )
    `)
    .in('hub', hubsToQuery)
    .order('votes', { ascending: false });

  if (error) {
    console.error('[leaderboard] error:', error);
    return res.status(500).json({ error: error.message });
  }

  const apps = (data || []).map((row, i) => ({
    rank:     i + 1,
    appId:    row.app_id,
    teamId:   row.team_id,
    teamName: row.teams?.name,
    appName:  row.app_name,
    track:    row.track,
    hub:      row.hub,
    votes:    row.votes,
  }));

  const result = { apps, updatedAt: new Date().toISOString() };
  if (region) result.region = region;
  else        result.hub    = hub;
  return res.json(result);
};
