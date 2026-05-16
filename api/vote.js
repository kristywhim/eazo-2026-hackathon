// POST /api/vote
// Cast community votes. Requires auth token.
//
// Body: { hub: string, teamId: string, count: number }
// Response: { ok: true, remainingVotes: number }

const { getClient } = require('./_supabase');
const { requireAuth, validHub } = require('./_auth');

const MAX_VOTES = 10;

// Voting deadlines (UTC) — matches frontend config
const DEADLINES = {
  sf: new Date('2026-05-24T17:00:00Z'),
  go: new Date('2026-05-24T17:00:00Z'),
  ny: new Date('2026-05-25T01:00:00Z'),
  sh: new Date('2026-05-24T11:00:00Z'),
  ao: new Date('2026-05-24T11:00:00Z'),
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ─────────────────────────────────────────────────────────
  let userId;
  try {
    ({ userId } = await requireAuth(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const { hub, teamId, count = 1 } = req.body || {};

  if (!validHub(hub))    return res.status(400).json({ error: 'Invalid hub' });
  if (!teamId)           return res.status(400).json({ error: 'Missing teamId' });
  if (!Number.isInteger(count) || count < 1 || count > 10)
    return res.status(400).json({ error: 'count must be integer 1–10' });

  // ── Check deadline ───────────────────────────────────────────────
  if (Date.now() > DEADLINES[hub].getTime()) {
    return res.status(410).json({ error: 'Voting has closed for this hub' });
  }

  const supabase = getClient();

  // ── Check team exists in this hub ───────────────────────────────
  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('hub', hub)
    .single();

  if (teamErr || !team) return res.status(404).json({ error: 'Team not found in this hub' });

  // ── Check / update user hub budget ──────────────────────────────
  const { data: budget } = await supabase
    .from('user_hub_budget')
    .select('votes_used')
    .eq('user_id', userId)
    .eq('hub', hub)
    .single();

  const used = budget?.votes_used || 0;
  if (used + count > MAX_VOTES) {
    return res.status(409).json({
      error: `Not enough votes. You have ${MAX_VOTES - used} remaining in ${hub.toUpperCase()}.`,
      remainingVotes: MAX_VOTES - used,
    });
  }

  // ── Upsert community_votes row ───────────────────────────────────
  const { error: voteErr } = await supabase
    .from('community_votes')
    .upsert(
      {
        user_id:     userId,
        team_id:     teamId,
        hub,
        votes_count: (/* existing */ 0) + count,  // will be handled via on_conflict
        updated_at:  new Date().toISOString(),
      },
      {
        onConflict:  'user_id,team_id',
        ignoreDuplicates: false,
      }
    );

  // Simpler: use raw SQL upsert to increment existing count
  const { error: upsertErr } = await supabase.rpc('upsert_community_vote', {
    p_user_id:    userId,
    p_team_id:    teamId,
    p_hub:        hub,
    p_add_count:  count,
  });

  if (upsertErr) {
    // Fallback: manual check-and-insert
    const { data: existing } = await supabase
      .from('community_votes')
      .select('votes_count')
      .eq('user_id', userId)
      .eq('team_id', teamId)
      .single();

    const newCount = (existing?.votes_count || 0) + count;

    const { error: manualErr } = await supabase
      .from('community_votes')
      .upsert({ user_id: userId, team_id: teamId, hub, votes_count: newCount, updated_at: new Date().toISOString() });

    if (manualErr) {
      console.error('[vote] upsert error:', manualErr);
      return res.status(500).json({ error: manualErr.message });
    }
  }

  // ── Update budget ────────────────────────────────────────────────
  await supabase
    .from('user_hub_budget')
    .upsert({ user_id: userId, hub, votes_used: used + count });

  return res.json({ ok: true, remainingVotes: MAX_VOTES - used - count });
};
