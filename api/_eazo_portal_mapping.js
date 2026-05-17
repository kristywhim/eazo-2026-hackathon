// ══════════════════════════════════════════════════════════════════
// Eazo portal ↔ our system region/hub naming bridge
// ══════════════════════════════════════════════════════════════════
// When Eazo's portal endpoint `GET /api/v1/hackathon/apps` goes live, the
// response uses their 3-region enum: `new_york` / `asia` / `global`.
// Our internal model is 5 hubs (sf/ny/sh/go/ao) collapsed into 3 prize
// pools (sf/ny/sh) for the UI.
//
// This module is the single place to translate between the two systems.
// Currently UNUSED at runtime — sync-teams.js still reads our Tally sheet
// directly. Switch to portal consumption by importing these helpers in
// sync-teams (or a new sync-portal.js) when Eazo's portal is up.
//
// Reference: `_reference/hackathon-api.md` §4 (region enum + IP defaults)
//            `_reference/prize-logic-v4.html` (赛区绑定原则)
// ══════════════════════════════════════════════════════════════════

// Eazo region enum → our 5-hub list (a portal region can map to multiple hubs)
const EAZO_REGION_TO_OUR_HUBS = {
  new_york: ['ny'],
  asia:     ['sh', 'ao'],   // SH offline + Asian Online
  global:   ['sf', 'go'],   // SF Bay Area offline + Global Online
};

// Eazo region enum → our prize-pool region (3 → 3 direct mapping)
const EAZO_REGION_TO_OUR_REGION = {
  new_york: 'ny',
  asia:     'sh',
  global:   'sf',
};

// Reverse: our region → Eazo region enum
const OUR_REGION_TO_EAZO_REGION = {
  ny: 'new_york',
  sh: 'asia',
  sf: 'global',
};

// Per-team source-hub disambiguation when consuming Eazo portal.
// Eazo returns `region` (3-tuple) but we need to know if a team is OFFLINE or
// ONLINE within that region (for finalist bucket calculation). The portal's
// raw response includes the original sheet text in the `region` field of each
// item (e.g. "San Francisco" vs "Global Online"). Use this to split.
const SHEET_TEXT_TO_OUR_HUB = {
  'san francisco':   'sf',
  'global online':   'go',
  'shanghai offline':'sh',
  'shanghai':        'sh',
  'asian online':    'ao',
  'asia online':     'ao',
  'new york offline':'ny',
  'new york':        'ny',
};

function classifyHubFromSheetText(rawText) {
  if (!rawText) return null;
  const t = String(rawText).toLowerCase().trim();
  for (const [needle, hub] of Object.entries(SHEET_TEXT_TO_OUR_HUB)) {
    if (t.includes(needle)) return hub;
  }
  return null;
}

module.exports = {
  EAZO_REGION_TO_OUR_HUBS,
  EAZO_REGION_TO_OUR_REGION,
  OUR_REGION_TO_EAZO_REGION,
  SHEET_TEXT_TO_OUR_HUB,
  classifyHubFromSheetText,
};
