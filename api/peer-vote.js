// POST /api/peer-vote
// Submit peer votes (互评). Requires auth token with teamId.
//
// Body: { hub: string, votedTeamIds: string[] }  (1–3 team IDs)
// Response: { ok: true }
//
// Rules:
//   - Max 3 votes per team, one per recipient
//   - Cannot vote for own team
//   - Each team can only submit peer votes ONCE (no updates)
//   - Opens after submission deadline; closes at voting deadline

const { getClient } = require('./_supabase');
const { requireAuth, validHub } = require('./_auth');

// Peer vote window: opens after submission deadline
const SUBMISSION_DEADLINES = {
  sf: new Date('2026-05-24T04:00:00Z'),  // TODO: confirm with Eazo — D1 21:00 PT
  go: new Date('2026-05-24T04:00:00Z'),
  ny: new Date('2026-05-25T00:00:00Z'),  // TODO: confirm
  sh: new Date('2026-05-23T23:00:00Z'),  // D2 07:00 CST
  ao: new Date('2026-05-23T23:00:00Z'),
};

const VOTING_DEADLINES = {
  sf: new Date('2026-05-24T17:00:00Z'),
  go: new Date('2026-05-24T17:00:00Z'),
  ny: new Date('2026-05-25T01:00:00Z'),
  sh: new Date('2026-05-24T11:00:00Z'),
  ao: new Date('2026-05-24T11:00:00Z'),
};

const MAX_PEER_VOTES = 3;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getClient();

  // ── GET: check status ────────────────────────────────────────────
  if (req.method === 'GET') {
    let userId, teamId;
    try {
      ({ userId, teamId } = await requireAuth(req));
    } catch (e) {
      return res.status(401).json({ error: e.message });
    }
    const hub = req.query.hub;
    if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub' });

    // Get team's own Supabase UUID from eazo_team_id
    const { data: myTeam } = await supabase
      .from('teams').select('id').eq('eazo_team_id', teamId).single();

    if (!myTeam) return res.json({ hasVoted: false, votedFor: [], teamDbId: null });

    const { data: votes } = await supabase
      .from('peer_votes')
      .select('voted_team_id')
      .eq('voter_team_id', myTeam.id);

    return res.json({
      hasVoted: (votes?.length || 0) > 0,
      votedFor: (votes || []).map(v => v.voted_team_id),
    });
  }

  // ── POST: cast votes ─────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let userId, teamId;
  try {
    ({ userId, teamId } = await requireAuth(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const { hub, votedTeamIds } = req.body || {};

  if (!validHub(hub)) return res.status(400).json({ error: 'Invalid hub' });
  if (!Array.isArray(votedTeamIds) || votedTeamIds.length === 0 || votedTeamIds.length > MAX_PEER_VOTES) {
    return res.status(400).json({ error: `Must provide 1–${MAX_PEER_VOTES} team IDs` });
  }

  const now = Date.now();
  if (now < SUBMISSION_DEADLINES[hub].getTime()) {
    return res.status(425).json({ error: 'Peer voting has not opened yet — wait for submission deadline' });
  }
  if (now > VOTING_DEADLINES[hub].getTime()) {
    return res.status(410).json({ error: 'Peer voting has closed' });
  }

  // ── Resolve voter's Supabase UUID ────────────────────────────────
  const { data: voterTeam, error: voterErr } = await supabase
    .from('teams')
    .select('id, hub')
    .eq('eazo_team_id', teamId)
    .single();

  if (voterErr || !voterTeam) {
    return res.status(404).json({ error: 'Your team was not found. Are you registered?' });
  }

  if (voterTeam.hub !== hub) {
    return res.status(403).json({ error: 'You can only vote for teams in your own hub' });
  }

  // ── Check: has already voted ─────────────────────────────────────
  const { data: existing } = await supabase
    .from('peer_votes')
    .select('id')
    .eq('voter_team_id', voterTeam.id)
    .limit(1);

  if (existing?.length > 0) {
    return res.status(409).json({ error: 'Your team has already submitted peer votes. Votes are final.' });
  }

  // ── Validate recipient teams ─────────────────────────────────────
  const { data: recipientTeams } = await supabase
    .from('teams')
    .select('id, hub')
    .in('id', votedTeamIds);

  for (const rt of recipientTeams || []) {
    if (rt.id === voterTeam.id) {
      return res.status(400).json({ error: 'Cannot vote for your own team' });
    }
    if (rt.hub !== hub) {
      return res.status(400).json({ error: 'Cannot vote for teams from other hubs' });
    }
  }

  if ((recipientTeams?.length || 0) !== votedTeamIds.length) {
    return res.status(400).json({ error: 'One or more team IDs not found' });
  }

  // ── Insert peer votes ────────────────────────────────────────────
  const rows = votedTeamIds.map(vid => ({
    voter_team_id: voterTeam.id,
    voted_team_id: vid,
    hub,
  }));

  const { error: insertErr } = await supabase.from('peer_votes').insert(rows);

  if (insertErr) {
    console.error('[peer-vote] insert error:', insertErr);
    return res.status(500).json({ error: insertErr.message });
  }

  return res.json({ ok: true });
};
