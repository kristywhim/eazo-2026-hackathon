// GET /api/projects?hub=sf | ?region=sf
// Returns APPS (not teams — one team can submit multiple apps).
// `region=sf` merges sf+go hubs; `region=sh` merges sh+ao; ny standalone.
//
// Response:
// {
//   apps: App[],                         // each app card; one team may have multiple entries
//   voteMap: { [appId]: votesGiven },    // per-app vote tally for the auth'd user
//   remainingVotes: number,              // 10 - votes used in this REGION (across all apps); -1 if no auth
//   appliedHub or appliedRegion: string
// }
//
// App shape:
//   { id, eazo_app_id, team_id, team_name, name, description, app_url,
//     cover_url, track, hub, icon_emoji, icon_bg, submitted_at, votes }

const { getClient } = require('./_supabase');
const { requireAuth, validHub } = require('./_auth');

const MAX_VOTES = 10;

const REGION_HUBS = {
  sf: ['sf', 'go'],
  sh: ['sh', 'ao'],
  ny: ['ny'],
};
const VALID_REGIONS = Object.keys(REGION_HUBS);

function regionFor(hub) {
  return { sf:'sf', go:'sf', sh:'sh', ao:'sh', ny:'ny' }[hub];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const region = req.query.region;
  const hub    = req.query.hub;

  let hubsToQuery, scopeRegion;
  if (region) {
    if (!VALID_REGIONS.includes(region)) return res.status(400).json({ error: 'Invalid region (sf, ny, or sh)' });
    hubsToQuery = REGION_HUBS[region];
    scopeRegion = region;
  } else {
    if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub (or use ?region=...)' });
    hubsToQuery = [hub];
    scopeRegion = regionFor(hub);
  }

  const supabase = getClient();

  // ── Fetch apps in scope, with team info joined ──────────────────
  const { data: apps, error } = await supabase
    .from('apps')
    .select(`
      id, eazo_app_id, name, description, app_url, cover_url,
      track, hub, icon_emoji, icon_bg, submitted_at,
      teams ( id, name, eazo_team_id )
    `)
    .in('hub', hubsToQuery)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('[projects] apps fetch error:', error);
    return res.status(500).json({ error: error.message });
  }

  // ── Per-app community vote totals (public — for sorting / display) ─
  const appIds = (apps || []).map(a => a.id);
  let voteTotals = {};
  if (appIds.length) {
    const { data: totals } = await supabase
      .from('community_votes')
      .select('app_id, votes_count')
      .in('app_id', appIds);
    (totals || []).forEach(r => {
      voteTotals[r.app_id] = (voteTotals[r.app_id] || 0) + (r.votes_count || 0);
    });
  }

  // ── Per-user vote map + region budget ────────────────────────────
  let voteMap = {};
  let remainingVotes = -1;

  const authHeader = req.headers['authorization'];
  if (authHeader) {
    try {
      const { userId } = await requireAuth(req);

      // User's votes within this region (per-app tally)
      if (appIds.length) {
        const { data: userVotes } = await supabase
          .from('community_votes')
          .select('app_id, votes_count')
          .eq('user_id', userId)
          .in('app_id', appIds);
        (userVotes || []).forEach(v => {
          voteMap[v.app_id] = (voteMap[v.app_id] || 0) + (v.votes_count || 0);
        });
      }

      // Region budget (10 per region) — sourced from user_region_budget
      const { data: budget } = await supabase
        .from('user_region_budget')
        .select('votes_used')
        .eq('user_id', userId)
        .eq('region', scopeRegion)
        .maybeSingle();
      remainingVotes = Math.max(0, MAX_VOTES - (budget?.votes_used || 0));
    } catch (_) { /* anon access */ }
  }

  // ── Shape response ───────────────────────────────────────────────
  const shaped = (apps || []).map(a => ({
    id:           a.id,
    eazo_app_id:  a.eazo_app_id,
    team_id:      a.teams?.id,
    team_name:    a.teams?.name,
    eazo_team_id: a.teams?.eazo_team_id,
    name:         a.name,
    description:  a.description,
    app_url:      a.app_url,
    cover_url:    a.cover_url,
    track:        a.track,
    hub:          a.hub,
    icon_emoji:   a.icon_emoji,
    icon_bg:      a.icon_bg,
    submitted_at: a.submitted_at,
    votes:        voteTotals[a.id] || 0,
  }));

  const result = { apps: shaped, voteMap, remainingVotes };
  if (region) result.appliedRegion = region;
  else        result.appliedHub    = hub;
  return res.json(result);
};
