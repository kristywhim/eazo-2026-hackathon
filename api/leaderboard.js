// GET /api/leaderboard?hub=sf
// Returns ranked leaderboard for OnAir display.
// Public endpoint — no auth required.
//
// Response: { hub, teams: Team[], updatedAt }
// Team: { rank, id, name, projectName, track, votes, prevRank, minsAgo }

const { getClient } = require('./_supabase');
const { validHub } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5'); // 10s CDN cache
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const hub = req.query.hub;
  if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub' });

  const supabase = getClient();

  // Use the view that aggregates community votes
  const { data, error } = await supabase
    .from('v_community_vote_totals')
    .select('team_id, team_name, project_name, hub, track, referral_count, community_votes')
    .eq('hub', hub)
    .order('community_votes', { ascending: false });

  if (error) {
    console.error('[leaderboard] error:', error);
    return res.status(500).json({ error: error.message });
  }

  const teams = (data || []).map((t, i) => ({
    rank:        i + 1,
    id:          t.team_id,
    name:        t.team_name,
    projectName: t.project_name,
    track:       t.track,
    votes:       t.community_votes,
  }));

  return res.json({
    hub,
    teams,
    updatedAt: new Date().toISOString(),
  });
};
