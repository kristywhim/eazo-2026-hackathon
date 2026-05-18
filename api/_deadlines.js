// ══════════════════════════════════════════════════════════════════
// Canonical hackathon deadlines · single source of truth
// ══════════════════════════════════════════════════════════════════
// Per the organizer-provided image (_reference/1778987515256.jpg).
// If the organizers ever change these, edit ONLY this file. Backend
// modules import these; frontend HTML pages fetch them at runtime via
// `GET /api/deadlines`.
//
//   🇨🇳 SH (+AO):  submission 5/24 07:00 CST = 5/23 23:00 UTC
//                  voting     5/24 19:30 CST = 5/24 11:30 UTC
//   🇺🇸 SF (+GO):  submission 5/23 21:00 PT  = 5/24 04:00 UTC
//                  voting     5/24 10:00 PT  = 5/24 17:00 UTC
//   🗽 NY:         submission 5/24 17:00 ET  = 5/24 21:00 UTC
//                  voting     5/24 21:00 ET  = 5/25 01:00 UTC
//
// Online hubs (go/ao) share their offline parent's deadlines (per
// prize-pool binding in prize-logic-v4).
// ══════════════════════════════════════════════════════════════════

const SUBMISSION_DEADLINES = {
  sf: '2026-05-24T04:00:00Z',  // 5/23 21:00 PT
  go: '2026-05-24T04:00:00Z',  // ↑ same window
  ny: '2026-05-24T21:30:00Z',  // 5/24 17:30 ET  (was T00:00 on 5/25 — wrong by 3h)
  sh: '2026-05-23T23:00:00Z',  // 5/24 07:00 CST
  ao: '2026-05-23T23:00:00Z',  // ↑ same window
};

const VOTING_DEADLINES = {
  sf: '2026-05-24T17:00:00Z',  // 5/24 10:00 AM PT
  go: '2026-05-24T17:00:00Z',  // ↑ same window
  ny: '2026-05-25T00:00:00Z',  // 5/24 20:00 ET
  sh: '2026-05-24T11:30:00Z',  // 5/24 19:30 CST  (was T11:00 — off by 30 min)
  ao: '2026-05-24T11:30:00Z',  // ↑ same window
};

// Helper: ISO string → Date
function toDateMap(strMap) {
  const out = {};
  for (const k of Object.keys(strMap)) out[k] = new Date(strMap[k]);
  return out;
}

module.exports = {
  SUBMISSION_DEADLINES,         // ISO strings (good for JSON over the wire)
  VOTING_DEADLINES,
  SUBMISSION_DEADLINES_DATE: toDateMap(SUBMISSION_DEADLINES),  // Date objects (good for comparisons)
  VOTING_DEADLINES_DATE:     toDateMap(VOTING_DEADLINES),
};
