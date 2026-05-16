// GET /api/projects?hub=sf[&userId=xxx]
// Returns projects for a hub + how many votes the user has cast in that hub.
//
// Response:
// {
//   projects: Project[],
//   voteMap: { [teamId]: votesGiven },   // empty if no userId
//   remainingVotes: number               // 10 - votes used; -1 if no userId
// }
//
// ⚠️  PENDING from Eazo team: team data source
//   Option A: Eazo REST API  — GET https://api.eazo.com/hackathon/teams?hub=sf
//   Option B: Google Sheet   — SHEET_ID + service account key
//   Option C: Eazo pushes to our `teams` table via webhook

const { getClient } = require('./_supabase');
const { requireAuth, validHub } = require('./_auth');

const MAX_VOTES = 10;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const hub = req.query.hub;
  const q   = (req.query.q || '').trim().toLowerCase(); // optional search query
  if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub' });

  const supabase = getClient();

  // ── Fetch teams for hub ──────────────────────────────────────────
  const { data: allTeams, error } = await supabase
    .from('teams')
    .select('id, eazo_team_id, name, project_name, project_desc, hub, track, icon_emoji, icon_bg, thumb_url, submitted_at')
    .eq('hub', hub)
    .order('submitted_at', { ascending: false });

  // ── Apply search filter (team name OR project name) ──────────────
  const teams = q
    ? (allTeams || []).filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.project_name?.toLowerCase().includes(q)
      )
    : (allTeams || []);

  if (error) {
    console.error('[projects] teams fetch error:', error);
    return res.status(500).json({ error: error.message });
  }

  // ── Fetch vote counts (all users, for public display) ────────────
  const teamIds = teams.map(t => t.id);
  let voteTotals = {};

  if (teamIds.length) {
    const { data: totals } = await supabase
      .from('community_votes')
      .select('team_id, votes_count')
      .in('team_id', teamIds);

    (totals || []).forEach(row => {
      voteTotals[row.team_id] = (voteTotals[row.team_id] || 0) + row.votes_count;
    });
  }

  // ── Fetch this user's vote map (if auth token provided) ──────────
  let voteMap = {};
  let remainingVotes = -1;

  const authHeader = req.headers['authorization'];
  if (authHeader) {
    try {
      const { userId } = await requireAuth(req);

      const { data: userVotes } = await supabase
        .from('community_votes')
        .select('team_id, votes_count')
        .eq('user_id', userId)
        .eq('hub', hub);

      (userVotes || []).forEach(v => { voteMap[v.team_id] = v.votes_count; });

      const used = Object.values(voteMap).reduce((s, n) => s + n, 0);
      remainingVotes = Math.max(0, MAX_VOTES - used);
    } catch (_) {
      // Auth failed — still return public data, just no personal vote map
    }
  }

  // ── Merge vote totals into projects ─────────────────────────────
  const projects = teams.map(t => ({
    ...t,
    votes: voteTotals[t.id] || 0,
  }));

  return res.json({ projects, voteMap, remainingVotes });
};
