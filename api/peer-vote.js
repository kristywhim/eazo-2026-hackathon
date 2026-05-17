// POST /api/peer-vote
// Submit peer votes (互评). Each vote is for an APP. Up to 3 apps per voter.
//
// Body: { votedAppIds: uuid[] }   (1–3 app IDs)
//   Optional: { hub } for legacy validation. Region is resolved from voter's team.
//
// Response: { ok: true, region: string }
//
// Rules:
//   - Max 3 votes per voter (team), one per recipient app
//   - Cannot vote for ANY app belonging to your own team (self-vote check
//     is at the team level — protects against a team with multiple apps
//     splitting their own peer vote into self-votes)
//   - Each voter team can only submit peer votes ONCE (no updates)
//   - Voter and target apps must be in the same prize-pool region (sf+go, sh+ao)
//   - Window: opens after submission deadline; closes at voting deadline

const { getClient } = require('./_supabase');
const { requireAuth } = require('./_auth');
const {
  SUBMISSION_DEADLINES_DATE: SUBMISSION_DEADLINES,
  VOTING_DEADLINES_DATE: VOTING_DEADLINES,
} = require('./_deadlines');

const MAX_PEER_VOTES = 3;

function regionFor(hub) {
  return { sf:'sf', go:'sf', sh:'sh', ao:'sh', ny:'ny' }[hub];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getClient();

  // ── GET: check status ────────────────────────────────────────────
  if (req.method === 'GET') {
    let teamId;
    try {
      ({ teamId } = await requireAuth(req));
    } catch (e) {
      return res.status(401).json({ error: e.message });
    }

    const { data: myTeam } = await supabase
      .from('teams').select('id, hub').eq('eazo_team_id', teamId).maybeSingle();
    if (!myTeam) return res.json({ hasVoted: false, votedFor: [], teamDbId: null });

    const { data: votes } = await supabase
      .from('peer_votes')
      .select('voted_app_id, voted_team_id')
      .eq('voter_team_id', myTeam.id);

    return res.json({
      hasVoted: (votes?.length || 0) > 0,
      votedFor: (votes || []).map(v => v.voted_app_id || v.voted_team_id),
      region:   regionFor(myTeam.hub),
    });
  }

  // ── POST: cast votes ─────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let teamId;
  try {
    ({ teamId } = await requireAuth(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  // Accept new (votedAppIds) and legacy (votedTeamIds → resolve to first app per team)
  let { votedAppIds, votedTeamIds } = req.body || {};
  if (!votedAppIds && Array.isArray(votedTeamIds) && votedTeamIds.length) {
    const { data: legacyApps } = await supabase
      .from('apps')
      .select('id, team_id')
      .in('team_id', votedTeamIds);
    // pick the first app per team in input order
    const byTeam = {};
    (legacyApps || []).forEach(a => { if (!byTeam[a.team_id]) byTeam[a.team_id] = a.id; });
    votedAppIds = votedTeamIds.map(tid => byTeam[tid]).filter(Boolean);
  }

  if (!Array.isArray(votedAppIds) || votedAppIds.length === 0 || votedAppIds.length > MAX_PEER_VOTES) {
    return res.status(400).json({ error: `Must provide 1–${MAX_PEER_VOTES} appIds` });
  }

  // ── Voter ─────────────────────────────────────────────────────────
  const { data: voterTeam, error: voterErr } = await supabase
    .from('teams')
    .select('id, hub')
    .eq('eazo_team_id', teamId)
    .single();

  if (voterErr || !voterTeam) {
    return res.status(404).json({ error: 'Your team was not found. Are you registered?' });
  }

  const voterRegion = regionFor(voterTeam.hub);

  // ── Deadlines based on voter's hub ─────────────────────────────
  const now = Date.now();
  if (now < SUBMISSION_DEADLINES[voterTeam.hub].getTime()) {
    return res.status(425).json({ error: 'Peer voting has not opened yet — wait for submission deadline' });
  }
  if (now > VOTING_DEADLINES[voterTeam.hub].getTime()) {
    return res.status(410).json({ error: 'Peer voting has closed' });
  }

  // ── Already-voted lockout ───────────────────────────────────────
  const { data: existing } = await supabase
    .from('peer_votes')
    .select('id')
    .eq('voter_team_id', voterTeam.id)
    .limit(1);

  if (existing?.length > 0) {
    return res.status(409).json({ error: 'Your team has already submitted peer votes. Votes are final.' });
  }

  // ── Validate target apps ────────────────────────────────────────
  const { data: targetApps } = await supabase
    .from('apps')
    .select('id, team_id, hub')
    .in('id', votedAppIds);

  if ((targetApps?.length || 0) !== votedAppIds.length) {
    return res.status(400).json({ error: 'One or more appIds not found' });
  }

  for (const ta of targetApps) {
    if (ta.team_id === voterTeam.id) {
      return res.status(400).json({ error: 'Cannot vote for any app belonging to your own team' });
    }
    if (regionFor(ta.hub) !== voterRegion) {
      return res.status(400).json({ error: 'Cannot vote for apps in other prize-pool regions' });
    }
  }

  // ── Insert peer votes ───────────────────────────────────────────
  const rows = targetApps.map(ta => ({
    voter_team_id: voterTeam.id,
    voted_team_id: ta.team_id,   // legacy column populated for back-compat
    voted_app_id:  ta.id,
    hub:           ta.hub,
  }));

  const { error: insertErr } = await supabase.from('peer_votes').insert(rows);

  if (insertErr) {
    console.error('[peer-vote] insert error:', insertErr);
    return res.status(500).json({ error: insertErr.message });
  }

  return res.json({ ok: true, region: voterRegion });
};
