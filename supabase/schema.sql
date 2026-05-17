-- ══════════════════════════════════════════════════════════════════
-- EAZO Global Hackathon 2026 · Supabase Schema
-- Run this in Supabase SQL Editor (Database → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════

-- ── Enable UUID extension ──────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════════
-- 1. TEAMS  (synced from Eazo API / Google Sheet)
-- ══════════════════════════════════════════════════════════════════
create table if not exists teams (
  id               uuid primary key default gen_random_uuid(),
  eazo_team_id     text unique not null,          -- Eazo platform team identifier
  name             text not null,                  -- team display name
  project_name     text not null,
  project_desc     text,
  hub              text not null check (hub in ('sf','ny','sh','go','ao')),
  track            text not null check (track in ('superparent','companion','lifeos','body','wildcard')),
  icon_emoji       text    default '🚀',
  icon_bg          text    default '#CCF0E3',
  thumb_url        text,
  referral_count   integer default 0,             -- populated from Eazo referral system
  submitted_at     timestamptz default now(),
  created_at       timestamptz default now()
);

create index if not exists teams_hub_idx on teams(hub);

-- ══════════════════════════════════════════════════════════════════
-- 1b. APPS  (1:N with teams — a team may submit multiple apps to the
--     hackathon; each app is the unit voted on / scored independently)
--     Threshold logic (>500 / >200) is per app; finalists are per team.
-- ══════════════════════════════════════════════════════════════════
create table if not exists apps (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  eazo_app_id     text unique,                       -- creator_apps.app_id from Eazo (nullable)
  name            text not null,
  description     text,
  app_url         text,
  cover_url       text,
  track           text check (track in ('superparent','companion','lifeos','body','wildcard')),
  hub             text not null check (hub in ('sf','ny','sh','go','ao')),
  icon_emoji      text default '🚀',
  icon_bg         text default '#CCF0E3',
  submitted_at    timestamptz default now(),
  created_at      timestamptz default now()
);
create index if not exists apps_team_idx on apps(team_id);
create index if not exists apps_hub_idx  on apps(hub);

-- ══════════════════════════════════════════════════════════════════
-- 2. COMMUNITY VOTES  (comm vote WebView — public voting)
--    Per-app vote tally; max 10 votes per user per PRIZE-POOL REGION
-- ══════════════════════════════════════════════════════════════════
create table if not exists community_votes (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,                      -- from Eazo auth token
  team_id      uuid not null references teams(id) on delete cascade,
  app_id       uuid references apps(id) on delete cascade,  -- per-app target (1:1-migrated rows backfilled)
  hub          text not null,
  votes_count  integer not null default 1 check (votes_count > 0 and votes_count <= 10),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint uq_comm_vote unique (user_id, team_id)
);

create index if not exists cv_team_hub_idx on community_votes(team_id, hub);
create index if not exists cv_user_hub_idx on community_votes(user_id, hub);
create index if not exists cv_app_idx     on community_votes(app_id);

-- Legacy per-hub budget (kept for back-compat / historic data; no longer used by /api/vote)
create table if not exists user_hub_budget (
  user_id    text not null,
  hub        text not null,
  votes_used integer not null default 0 check (votes_used >= 0 and votes_used <= 10),
  primary key (user_id, hub)
);

-- Per-user per-REGION budget tracker (10 votes per prize-pool region).
-- This is the source of truth for /api/vote budget enforcement.
create table if not exists user_region_budget (
  user_id    text not null,
  region     text not null check (region in ('sf','ny','sh')),
  votes_used integer not null default 0 check (votes_used >= 0 and votes_used <= 10),
  updated_at timestamptz default now(),
  primary key (user_id, region)
);
create index if not exists urb_user_idx on user_region_budget(user_id);

-- ══════════════════════════════════════════════════════════════════
-- 3. PEER VOTES  (互评 — participants vote for other teams)
--    Max 3 votes per team; 1 per recipient; can't vote for own team
-- ══════════════════════════════════════════════════════════════════
create table if not exists peer_votes (
  id             uuid primary key default gen_random_uuid(),
  voter_team_id  uuid not null references teams(id) on delete cascade,
  voted_team_id  uuid not null references teams(id) on delete cascade,
  voted_app_id   uuid references apps(id) on delete cascade,  -- per-app target
  hub            text not null,
  created_at     timestamptz default now(),
  constraint uq_peer_vote  unique (voter_team_id, voted_team_id),
  constraint no_self_vote  check  (voter_team_id != voted_team_id)
);

create index if not exists pv_voted_hub_idx on peer_votes(voted_team_id, hub);
create index if not exists pv_voter_idx     on peer_votes(voter_team_id);
create index if not exists pv_app_idx       on peer_votes(voted_app_id);

-- ══════════════════════════════════════════════════════════════════
-- 4. JUDGE SCORES
--    Per Eazo Judge Guide 2026: 5 dimensions × 10 pts each = 50 pts total.
--    Each judge scores independently; regional score = average across judges.
-- ══════════════════════════════════════════════════════════════════
create table if not exists judge_scores (
  id            uuid primary key default gen_random_uuid(),
  judge_id      text not null,                     -- judge code (e.g. "JUDGE_SF_01")
  team_id       uuid not null references teams(id) on delete cascade,
  app_id        uuid references apps(id) on delete cascade,  -- per-app score
  hub           text not null,
  completeness  numeric(4,1) check (completeness between 0 and 10),  -- 01 · Product Completeness
  innovation    numeric(4,1) check (innovation   between 0 and 10),  -- 02 · Innovation
  technical     numeric(4,1) check (technical    between 0 and 10),  -- 03 · Technical Execution
  design        numeric(4,1) check (design       between 0 and 10),  -- 04 · Design & Experience
  commercial    numeric(4,1) check (commercial   between 0 and 10),  -- 05 · Commercial Potential
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint uq_judge_team unique (judge_id, team_id)
);

create index if not exists js_hub_idx on judge_scores(hub);
create index if not exists js_app_idx on judge_scores(app_id);

-- ══════════════════════════════════════════════════════════════════
-- 5. FINALISTS  (calculated once per hub after voting closes)
-- ══════════════════════════════════════════════════════════════════
create table if not exists finalists (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references teams(id) on delete cascade,
  prize_hub            text not null check (prize_hub in ('sf','ny','sh')),  -- which prize pool (go→sf, ao→sh)
  source_hub           text not null,              -- team's actual hub (sf/ny/sh/go/ao)
  qualification_method text not null check (qualification_method in ('referral','peer','online')),
  rank_in_method       integer not null,           -- rank within their qualification bucket
  overall_rank         integer,                    -- final overall rank (set after dedup)
  composite_score      numeric(8,4),               -- S = V*0.50 + J*0.40 + P*0.10 (post-demo)
  calculated_at        timestamptz default now(),
  announced            boolean default false,
  constraint uq_finalist unique (team_id, prize_hub)
);

create index if not exists fin_prize_hub_idx on finalists(prize_hub, overall_rank);

-- ══════════════════════════════════════════════════════════════════
-- 6. VIEWS  (live aggregates — used by API and OnAir)
-- ══════════════════════════════════════════════════════════════════

-- Community vote totals per team
create or replace view v_community_vote_totals as
select
  t.id           as team_id,
  t.eazo_team_id,
  t.name         as team_name,
  t.project_name,
  t.hub,
  t.track,
  t.referral_count,
  coalesce(sum(cv.votes_count), 0)::integer as community_votes
from teams t
left join community_votes cv on cv.team_id = t.id
group by t.id;

-- Peer vote totals per team
create or replace view v_peer_vote_totals as
select
  t.id           as team_id,
  t.hub,
  count(pv.id)::integer as peer_votes_received
from teams t
left join peer_votes pv on pv.voted_team_id = t.id
group by t.id;

-- ── App-level aggregates (used by leaderboard, special awards, calculate_finalists)
create or replace view v_app_vote_totals as
select
  a.id        as app_id,
  a.team_id,
  a.name      as app_name,
  a.hub,
  a.track,
  coalesce(sum(cv.votes_count), 0)::integer as votes
from apps a
left join community_votes cv on cv.app_id = a.id
group by a.id;

create or replace view v_app_peer_totals as
select
  a.id        as app_id,
  a.team_id,
  a.hub,
  count(pv.id)::integer as peer_votes
from apps a
left join peer_votes pv on pv.voted_app_id = a.id
group by a.id;

create or replace view v_app_judge_totals as
select
  a.id        as app_id,
  a.team_id,
  a.hub,
  round(avg(
    coalesce(js.completeness,0) + coalesce(js.innovation,0) + coalesce(js.technical,0) +
    coalesce(js.design,0)       + coalesce(js.commercial,0)
  ), 2) as judge_total_avg,
  count(distinct js.judge_id) as judge_count
from apps a
left join judge_scores js on js.app_id = a.id
group by a.id;

-- ── Team-level aggregates (MAX V/P across team's apps; AVG J across judged apps)
create or replace view v_team_max_votes as
select team_id, max(votes)::integer as team_max_votes
from v_app_vote_totals group by team_id;

create or replace view v_team_max_peer as
select team_id, max(peer_votes)::integer as team_max_peer
from v_app_peer_totals group by team_id;

create or replace view v_team_judge_avg as
select team_id, round(avg(judge_total_avg), 2) as team_judge_avg
from v_app_judge_totals
where judge_count > 0
group by team_id;

-- ── Special Award candidates: team has ANY app > 200 votes AND team NOT in finalists
create or replace view v_special_award_candidates as
select
  t.id                  as team_id,
  t.eazo_team_id,
  t.name                as team_name,
  t.hub,
  t.track,
  v.team_max_votes      as best_app_votes,
  (
    select avt.app_name
    from v_app_vote_totals avt
    where avt.team_id = t.id
    order by avt.votes desc
    limit 1
  ) as top_app_name
from teams t
join v_team_max_votes v on v.team_id = t.id
where v.team_max_votes > 200
  and not exists (select 1 from finalists f where f.team_id = t.id);

-- Judge score totals per team (legacy — kept for compat; new code uses v_team_judge_avg)
create or replace view v_judge_score_totals as
select
  team_id,
  hub,
  round(avg(
    coalesce(completeness,0) + coalesce(innovation,0) + coalesce(technical,0) +
    coalesce(design,0)       + coalesce(commercial,0)
  ), 2) as judge_total_avg,
  round(avg(coalesce(completeness,0)), 2) as completeness_avg,
  round(avg(coalesce(innovation,0)),   2) as innovation_avg,
  round(avg(coalesce(technical,0)),    2) as technical_avg,
  round(avg(coalesce(design,0)),       2) as design_avg,
  round(avg(coalesce(commercial,0)),   2) as commercial_avg,
  count(distinct judge_id) as judge_count
from judge_scores
group by team_id, hub;

-- ══════════════════════════════════════════════════════════════════
-- 7. FINALIST CALCULATION FUNCTION
--    Call: select calculate_finalists('sf');
-- ══════════════════════════════════════════════════════════════════
-- App-dimension ranking, team-dimension dedup (per migrations 005 + 006).
-- A: top apps by community votes (>500) → unique teams in top N
-- B: top apps by peer votes (offline only) → unique teams in top N;
--    organizer-required >200 threshold = team's BEST app has >200 votes
-- C/D: online apps ranked by 0.50*V_norm + 0.10*P_norm → unique teams
create or replace function calculate_finalists(p_prize_hub text)
returns table(
  team_id uuid, team_name text, project_name text,
  source_hub text, qualification_method text,
  rank_in_method int, community_votes bigint, peer_votes bigint
)
language plpgsql as $$
declare
  v_referral_slots int;
  v_peer_slots     int;
begin
  if p_prize_hub = 'ny' then
    v_referral_slots := 15;
    v_peer_slots     := 15;
  else
    v_referral_slots := 10;
    v_peer_slots     := 10;
  end if;

  delete from finalists where prize_hub = p_prize_hub;

  -- ── A: rank apps by votes desc, dedup by team, > 500 threshold ─
  insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
  with apps_in_region as (
    select av.team_id, t.hub, av.votes
    from v_app_vote_totals av
    join teams t on t.id = av.team_id
    where t.hub = any(
      case p_prize_hub
        when 'sf' then array['sf','go']
        when 'sh' then array['sh','ao']
        when 'ny' then array['ny']
      end
    )
    and av.votes > 500
  ),
  team_best as (
    select team_id, hub, max(votes) as best_votes
    from apps_in_region group by team_id, hub
  ),
  ranked as (
    select team_id, hub, best_votes, row_number() over (order by best_votes desc) as rn
    from team_best
  )
  select team_id, p_prize_hub, hub, 'referral', rn::int, now()
  from ranked where rn <= v_referral_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── B: rank apps by peer_votes desc (offline), dedup by team; team_max_votes > 200 ─
  insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
  with apps_offline as (
    select ap.team_id, t.hub, ap.peer_votes
    from v_app_peer_totals ap
    join teams t on t.id = ap.team_id
    join v_team_max_votes vmv on vmv.team_id = t.id
    where t.hub = any(
      case p_prize_hub
        when 'sf' then array['sf']
        when 'sh' then array['sh']
        when 'ny' then array['ny']
      end
    )
    and vmv.team_max_votes > 200
  ),
  team_best_peer as (
    select team_id, hub, max(peer_votes) as best_peer
    from apps_offline group by team_id, hub
  ),
  ranked as (
    select team_id, hub, best_peer, row_number() over (order by best_peer desc) as rn
    from team_best_peer
  )
  select team_id, p_prize_hub, hub, 'peer', rn::int, now()
  from ranked where rn <= v_peer_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── C/D: online apps — 0.50*V_norm + 0.10*P_norm, dedup by team, top 10
  if p_prize_hub in ('sf','sh') then
    insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
    with online_apps as (
      select av.team_id, av.votes::numeric as v, coalesce(ap.peer_votes,0)::numeric as p
      from v_app_vote_totals av
      left join v_app_peer_totals ap on ap.app_id = av.app_id
      join teams t on t.id = av.team_id
      where t.hub = (case p_prize_hub when 'sf' then 'go' else 'ao' end)
    ),
    ranges as (
      select min(v) as v_min, max(v) as v_max, min(p) as p_min, max(p) as p_max
      from online_apps
    ),
    scored as (
      select o.team_id,
        case when r.v_max = r.v_min then 0.5 else (o.v - r.v_min) / nullif(r.v_max - r.v_min, 0) end as v_norm,
        case when r.p_max = r.p_min then 0.5 else (o.p - r.p_min) / nullif(r.p_max - r.p_min, 0) end as p_norm
      from online_apps o cross join ranges r
    ),
    team_best as (
      select team_id, max(0.50 * v_norm + 0.10 * p_norm) as composite
      from scored group by team_id
    ),
    ranked as (
      select team_id, composite, row_number() over (order by composite desc) as rn
      from team_best
    )
    select team_id, p_prize_hub,
           (case p_prize_hub when 'sf' then 'go' else 'ao' end),
           'online', rn::int, now()
    from ranked where rn <= 10
    on conflict (team_id, prize_hub) do nothing;
  end if;

  -- overall_rank: referral > peer > online, then rank_in_method
  with ranked as (
    select f.id, row_number() over (
      order by case f.qualification_method when 'referral' then 1 when 'peer' then 2 else 3 end,
               f.rank_in_method
    ) as rn
    from finalists f where f.prize_hub = p_prize_hub
  )
  update finalists f2 set overall_rank = r.rn
  from ranked r where f2.id = r.id;

  return query
    select f.team_id, t.name, t.project_name,
           f.source_hub, f.qualification_method, f.rank_in_method,
           coalesce(vmv.team_max_votes, 0)::bigint as community_votes,
           coalesce(vmp.team_max_peer,  0)::bigint as peer_votes
    from finalists f
    join teams t on t.id = f.team_id
    left join v_team_max_votes vmv on vmv.team_id = f.team_id
    left join v_team_max_peer  vmp on vmp.team_id = f.team_id
    where f.prize_hub = p_prize_hub
    order by f.overall_rank;
end;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════

alter table teams              enable row level security;
alter table apps               enable row level security;
alter table community_votes    enable row level security;
alter table user_hub_budget    enable row level security;
alter table user_region_budget enable row level security;
alter table peer_votes         enable row level security;
alter table judge_scores       enable row level security;
alter table finalists          enable row level security;

-- Teams: readable by all (public leaderboard data)
create policy "teams_read_all"    on teams for select using (true);
create policy "teams_insert_service" on teams for insert with check (true);  -- service role only in practice
create policy "teams_update_service" on teams for update using (true);

-- Community votes: users can read/write their own rows
create policy "cv_read_own"   on community_votes for select using (auth.uid()::text = user_id);
create policy "cv_insert_own" on community_votes for insert with check (auth.uid()::text = user_id);
create policy "cv_update_own" on community_votes for update using (auth.uid()::text = user_id);

-- Apps: readable by all (public — used by /vote /peer-vote /onair / leaderboard)
create policy "apps_read_all"      on apps for select using (true);
create policy "apps_write_service" on apps for all    using (true);  -- service role only in practice

-- Budget: users can read/write their own (per-hub legacy + per-region current)
create policy "budget_read_own"   on user_hub_budget    for select using (auth.uid()::text = user_id);
create policy "budget_write_own"  on user_hub_budget    for all    using (auth.uid()::text = user_id);
create policy "urb_read_own"      on user_region_budget for select using (auth.uid()::text = user_id);
create policy "urb_write_own"     on user_region_budget for all    using (auth.uid()::text = user_id);

-- Peer votes: teams can read/write their own votes
create policy "pv_read_all"    on peer_votes for select using (true);
create policy "pv_insert_own"  on peer_votes for insert with check (true);  -- validated in API

-- Judge scores: service role only (judge page uses API, not direct Supabase)
create policy "js_service_only" on judge_scores for all using (false);  -- blocked from anon; service role bypasses RLS

-- Finalists: public read
create policy "fin_read_all"    on finalists for select using (true);
create policy "fin_service_write" on finalists for all using (false);  -- service role only

-- ══════════════════════════════════════════════════════════════════
-- 9. REALTIME  (enable for OnAir live board)
-- ══════════════════════════════════════════════════════════════════
-- In Supabase Dashboard: Database → Replication → enable for:
--   community_votes, peer_votes, finalists
-- (Can't enable via SQL, must be done in dashboard)

-- ══════════════════════════════════════════════════════════════════
-- 10. SEED: JUDGE CODES  (simple lookup table)
-- ══════════════════════════════════════════════════════════════════
create table if not exists judge_codes (
  code  text primary key,
  hub   text not null,
  label text                  -- e.g. "Judge 1 · SF"
);

-- Add judge codes here — update as needed
insert into judge_codes (code, hub, label) values
  ('JUDGE_SF_01', 'sf', 'Judge 1 · SF'),
  ('JUDGE_SF_02', 'sf', 'Judge 2 · SF'),
  ('JUDGE_SF_03', 'sf', 'Judge 3 · SF'),
  ('JUDGE_NY_01', 'ny', 'Judge 1 · NY'),
  ('JUDGE_NY_02', 'ny', 'Judge 2 · NY'),
  ('JUDGE_NY_03', 'ny', 'Judge 3 · NY'),
  ('JUDGE_SH_01', 'sh', 'Judge 1 · SH'),
  ('JUDGE_SH_02', 'sh', 'Judge 2 · SH'),
  ('JUDGE_SH_03', 'sh', 'Judge 3 · SH')
on conflict (code) do nothing;

-- Master override code (all hubs — use for testing)
insert into judge_codes (code, hub, label) values ('JUDGE2026', 'sf', 'Master Judge Code')
on conflict (code) do nothing;
