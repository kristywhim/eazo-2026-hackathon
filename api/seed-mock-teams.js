// POST /api/seed-mock-teams?secret=ADMIN_SECRET
// Inserts a realistic mock team set into the `teams` table for dry-runs
// and visual review before real Tally submissions arrive.
//
// Idempotent: keyed on `eazo_team_id` (using the synthetic ids below).
// Running it twice is safe — rows update in place, no duplicates created.
//
// Use this BEFORE submissions open. Once sync-teams pulls real data,
// these mock rows can be deleted with:
//   delete from teams where eazo_team_id like 'MOCK_%';
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ADMIN_SECRET (default: 'HACKATHON_ADMIN_2026')

const { getClient } = require('./_supabase');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'HACKATHON_ADMIN_2026';

const TRACKS = ['superparent','companion','lifeos','body','wildcard'];
const ICONS  = ['🚀','✨','🌱','🎯','🔥','💡','🪄','🌊','⚡','🎨'];
const ICON_BGS = ['#CCF0E3','#FAE6C2','#E1D6FF','#FFD6E0','#D6EAFF'];

function mkTeam(hub, ix, name, project, track, referrals = 0) {
  return {
    eazo_team_id:   `MOCK_${hub}_${String(ix).padStart(2,'0')}`,
    name,
    project_name:   project,
    project_desc:   null,
    hub,
    track,
    icon_emoji:     ICONS[ix % ICONS.length],
    icon_bg:        ICON_BGS[ix % ICON_BGS.length],
    thumb_url:      null,
    referral_count: referrals,
    // Stagger submitted_at by hub + index so ordering is interesting
    submitted_at:   new Date(Date.now() - (ix * 3600 * 1000)).toISOString(),
  };
}

const SEED = [
  // ── SF: 12 teams, 5 with referral counts above the 500 threshold ─────
  mkTeam('sf', 1, 'Team Meridian',    'Atlas',         'lifeos',      650),
  mkTeam('sf', 2, 'Team Wavelength',  'SolaceAI',      'companion',   720),
  mkTeam('sf', 3, 'Team Pulse',       'BodySync',      'body',        310),
  mkTeam('sf', 4, 'Team Nested',      'FamilyFlow',    'superparent', 260),
  mkTeam('sf', 5, 'Team Epoch',       'DayZero',       'lifeos',      580),
  mkTeam('sf', 6, 'FeelFirst',        'MoodSync',      'companion',   220),
  mkTeam('sf', 7, 'Team Kinetic',     'RecoverAI',     'body',        540),
  mkTeam('sf', 8, 'Team Drift',       'FocusBuddy',    'companion',   180),
  mkTeam('sf', 9, 'Cohort Labs',      'StudyCircle',   'lifeos',      420),
  mkTeam('sf',10, 'Kindred Code',     'KidNotebook',   'superparent', 510),
  mkTeam('sf',11, 'Loop Labs',        'PomodoroAI',    'wildcard',    140),
  mkTeam('sf',12, 'Wild Atlas',       'TrailMate',     'wildcard',     90),

  // ── NY: 10 teams ─────────────────────────────────────────────────────
  mkTeam('ny', 1, 'Team Fulton',    'FinCoach',     'lifeos',      610),
  mkTeam('ny', 2, 'Team Brooklyn',  'MindMap',      'companion',   240),
  mkTeam('ny', 3, 'Team Harlem',    'StreetSense',  'wildcard',    560),
  mkTeam('ny', 4, 'Team Tribeca',   'DadBot',       'superparent', 290),
  mkTeam('ny', 5, 'Team Chelsea',   'HabitNest',    'lifeos',      720),
  mkTeam('ny', 6, 'Team Soho',      'CalmRoom',     'companion',   180),
  mkTeam('ny', 7, 'Team Astoria',   'PantryPilot',  'lifeos',      130),
  mkTeam('ny', 8, 'Team Bowery',    'GymGoals',     'body',        450),
  mkTeam('ny', 9, 'Team Williamsburg','BabyBeat',   'superparent', 380),
  mkTeam('ny',10, 'Team Greenpoint','MoodJournal',  'companion',   210),

  // ── SH: 8 teams ──────────────────────────────────────────────────────
  mkTeam('sh', 1, '队伍·晨曦',  'DawnMind',  'lifeos',      540),
  mkTeam('sh', 2, '队伍·织梦',  'DreamWeave','companion',   210),
  mkTeam('sh', 3, '家家互联',    '亲子云',     'superparent', 620),
  mkTeam('sh', 4, '队伍·脉动',  'PulseLife', 'body',        380),
  mkTeam('sh', 5, '意向科技',    '思伴',       'companion',   170),
  mkTeam('sh', 6, '小路科技',    '路上',       'wildcard',     90),
  mkTeam('sh', 7, '叶舟设计',    '晨读',       'lifeos',      280),
  mkTeam('sh', 8, '万物互联',    '邻里',       'wildcard',    410),

  // ── GO (Global Online): 8 teams ──────────────────────────────────────
  mkTeam('go', 1, 'Remote Minds',  'AutoPilot',   'lifeos',      0),
  mkTeam('go', 2, 'FamCloud',      'KidCast',     'superparent', 0),
  mkTeam('go', 3, 'Quiet Ocean',   'ZenTimer',    'companion',   0),
  mkTeam('go', 4, 'Async Studio',  'StandupAI',   'wildcard',    0),
  mkTeam('go', 5, 'Open Forum',    'IdeaBoard',   'wildcard',    0),
  mkTeam('go', 6, 'Hearth Labs',   'KitchenCoach','body',        0),
  mkTeam('go', 7, 'Bright Loop',   'BrainRing',   'lifeos',      0),
  mkTeam('go', 8, 'Nightowl',      'SleepStory',  'companion',   0),

  // ── AO (Asia Online): 6 teams ────────────────────────────────────────
  mkTeam('ao', 1, '云端·星河',  '星语',       'companion',   0),
  mkTeam('ao', 2, '远程·共生',  '同行',       'lifeos',      0),
  mkTeam('ao', 3, '海外·一隅',  '家信',       'superparent', 0),
  mkTeam('ao', 4, 'AsiaSync',    'TalkBuddy',  'companion',   0),
  mkTeam('ao', 5, 'BodyTune',    '体感',       'body',        0),
  mkTeam('ao', 6, 'Open Asia',   '集',         'wildcard',    0),
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const supabase = getClient();
  const { error } = await supabase
    .from('teams')
    .upsert(SEED, { onConflict: 'eazo_team_id' });

  if (error) {
    console.error('[seed-mock-teams] upsert error:', error);
    return res.status(500).json({ error: error.message });
  }

  const byHub = SEED.reduce((acc, t) => {
    acc[t.hub] = (acc[t.hub] || 0) + 1;
    return acc;
  }, {});

  return res.json({ ok: true, seeded: SEED.length, byHub });
};
