// GET /api/special-awards?region=sf|ny|sh|all   (default 'all')
//
// Returns "Special Award" candidate teams per prize-pool region.
//
// Per organizer rule (B-class 特别奖):
//   A team qualifies for the Special Award if:
//     - At least one of its apps has > 200 community votes, AND
//     - The team is NOT in the Demo finalists list.
//
// Backed by view `v_special_award_candidates` (migration 005).
// Public read — the Finalist Dashboard uses this to render a side panel
// at the award ceremony so the host knows who to call up for $1000 stipends.

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];
const REGION_HUBS = {
  sf: ['sf', 'go'],
  sh: ['sh', 'ao'],
  ny: ['ny'],
};
const PRIZE_LABELS = {
  sf: 'SF · Bay Area + Global Online',
  ny: 'NY · New York',
  sh: 'SH · Shanghai + Asia Online',
};

async function loadRegion(supabase, region) {
  const hubs = REGION_HUBS[region];
  const { data, error } = await supabase
    .from('v_special_award_candidates')
    .select('team_id, eazo_team_id, team_name, hub, track, best_app_votes, top_app_name')
    .in('hub', hubs)
    .order('best_app_votes', { ascending: false });

  if (error) {
    console.error(`[special-awards] ${region} error:`, error);
    return { error: error.message, teams: [] };
  }

  return {
    teams: (data || []).map(t => ({
      teamId:        t.team_id,
      eazoTeamId:    t.eazo_team_id,
      teamName:      t.team_name,
      sourceHub:     t.hub,
      track:         t.track,
      bestAppVotes:  t.best_app_votes,
      topAppName:    t.top_app_name,
    })),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const region = (req.query.region || 'all').toLowerCase();
  const supabase = getClient();

  if (region === 'all') {
    const [sf, ny, sh] = await Promise.all(
      PRIZE_HUBS.map(r => loadRegion(supabase, r))
    );
    return res.json({
      generatedAt: new Date().toISOString(),
      regions: {
        sf: { label: PRIZE_LABELS.sf, ...sf },
        ny: { label: PRIZE_LABELS.ny, ...ny },
        sh: { label: PRIZE_LABELS.sh, ...sh },
      },
    });
  }

  if (!PRIZE_HUBS.includes(region)) {
    return res.status(400).json({ error: 'region must be sf, ny, sh, or all' });
  }

  const result = await loadRegion(supabase, region);
  return res.json({
    generatedAt: new Date().toISOString(),
    region,
    label: PRIZE_LABELS[region],
    ...result,
  });
};
