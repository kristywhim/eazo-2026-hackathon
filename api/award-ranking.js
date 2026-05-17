// GET /api/award-ranking?hub=sf|ny|sh
// GET /api/award-ranking?hub=all   ← default
//
// Returns the final award ranking per prize-pool region. Used by the
// Finalist Dashboard at the award ceremony — the host opens the page when
// voting closes and sees who wins per region.
//
// composite = 0.50*V_norm + 0.40*J_norm + 0.10*P_norm
// Each V/J/P is min-max normalized within the prize hub.
//
// In the app-centric model:
//   - Finalists are still TEAMS (one Demo slot per team, no matter how many
//     apps qualified).
//   - For composite: team.V = MAX(votes across team's apps), team.P =
//     MAX(peer_votes across team's apps), team.J = AVG(judge_total across
//     the team's JUDGED apps).
//   - Source views: v_team_max_votes, v_team_max_peer, v_team_judge_avg
//     (defined in migration 005).
//
// All computation is server-side in JS. No new SQL needed beyond those views.

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];
const PRIZE_LABELS = {
  sf: 'SF · Bay Area + Global Online',
  ny: 'NY · New York',
  sh: 'SH · Shanghai + Asia Online',
};

async function calculateForRegion(supabase, prize_hub) {
  // 1. Finalists for this prize_hub (team-level)
  const { data: finalists, error: finalistsErr } = await supabase
    .from('finalists')
    .select(`
      team_id, source_hub, qualification_method, rank_in_method, overall_rank,
      teams ( name, project_name, track, hub, icon_emoji, icon_bg )
    `)
    .eq('prize_hub', prize_hub);

  if (finalistsErr) {
    console.error('[award-ranking] finalists error:', finalistsErr);
    return { error: finalistsErr.message, teams: [] };
  }
  if (!finalists || finalists.length === 0) {
    return { teams: [], note: 'No finalists yet — run calculate_finalists() after peer voting closes.' };
  }

  const teamIds = finalists.map(f => f.team_id);

  // 2. Team-level aggregates from the new app-derived views
  const [vRes, pRes, jRes] = await Promise.all([
    supabase.from('v_team_max_votes').select('team_id, team_max_votes').in('team_id', teamIds),
    supabase.from('v_team_max_peer').select('team_id, team_max_peer').in('team_id', teamIds),
    supabase.from('v_team_judge_avg').select('team_id, team_judge_avg').in('team_id', teamIds),
  ]);

  const V = {}, P = {}, J = {};
  (vRes.data || []).forEach(r => { V[r.team_id] = Number(r.team_max_votes)  || 0; });
  (pRes.data || []).forEach(r => { P[r.team_id] = Number(r.team_max_peer)   || 0; });
  (jRes.data || []).forEach(r => { J[r.team_id] = Number(r.team_judge_avg)  || 0; });

  // 3. Base records
  const base = finalists.map(f => ({
    teamId:               f.team_id,
    teamName:             f.teams?.name        || '(unknown)',
    projectName:          f.teams?.project_name|| '',
    track:                f.teams?.track       || 'wildcard',
    sourceHub:            f.source_hub,
    qualificationMethod:  f.qualification_method,
    iconEmoji:            f.teams?.icon_emoji  || '🚀',
    iconBg:               f.teams?.icon_bg     || '#CCF0E3',
    V: V[f.team_id] || 0,
    J: J[f.team_id] || 0,
    P: P[f.team_id] || 0,
    judged: (J[f.team_id] || 0) > 0,
  }));

  // 4. Min-max normalize within region
  const minMax = arr => {
    if (!arr.length) return [0, 0];
    let mn = arr[0], mx = arr[0];
    for (const x of arr) { if (x < mn) mn = x; if (x > mx) mx = x; }
    return [mn, mx];
  };
  const norm01 = (v, mn, mx) => (mx === mn ? 0.5 : (v - mn) / (mx - mn));

  const [vMin, vMax] = minMax(base.map(b => b.V));
  const [jMin, jMax] = minMax(base.map(b => b.J));
  const [pMin, pMax] = minMax(base.map(b => b.P));

  const withComposite = base.map(b => {
    const vN = norm01(b.V, vMin, vMax);
    const jN = norm01(b.J, jMin, jMax);
    const pN = norm01(b.P, pMin, pMax);
    const c  = 0.50 * vN + 0.40 * jN + 0.10 * pN;
    return {
      ...b,
      vNorm: Math.round(vN * 10000) / 10000,
      jNorm: Math.round(jN * 10000) / 10000,
      pNorm: Math.round(pN * 10000) / 10000,
      composite: Math.round(c * 10000) / 10000,
    };
  });

  withComposite.sort((a, b) =>
    b.composite - a.composite || b.J - a.J || b.V - a.V
  );

  return {
    teams: withComposite.map((t, i) => ({ ...t, awardRank: i + 1 })),
    judgesParticipated: base.some(b => b.judged),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const hub = (req.query.hub || 'all').toLowerCase();
  const supabase = getClient();

  if (hub === 'all') {
    const [sf, ny, sh] = await Promise.all(
      PRIZE_HUBS.map(h => calculateForRegion(supabase, h))
    );
    return res.json({
      calculatedAt: new Date().toISOString(),
      regions: {
        sf: { label: PRIZE_LABELS.sf, ...sf },
        ny: { label: PRIZE_LABELS.ny, ...ny },
        sh: { label: PRIZE_LABELS.sh, ...sh },
      },
    });
  }

  if (!PRIZE_HUBS.includes(hub)) {
    return res.status(400).json({ error: `hub must be sf, ny, sh, or all` });
  }

  const result = await calculateForRegion(supabase, hub);
  return res.json({
    calculatedAt: new Date().toISOString(),
    hub,
    label: PRIZE_LABELS[hub],
    ...result,
  });
};
