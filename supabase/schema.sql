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
-- 2. COMMUNITY VOTES  (comm vote WebView — public voting)
--    Max 10 votes per user per hub; can stack on one team or spread
-- ══════════════════════════════════════════════════════════════════
create table if not exists community_votes (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,                      -- from Eazo auth token
  team_id      uuid not null references teams(id) on delete cascade,
  hub          text not null,
  votes_count  integer not null default 1 check (votes_count > 0 and votes_count <= 10),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint uq_comm_vote unique (user_id, team_id)  -- one row per user/team; update votes_count to add more
);

create index if not exists cv_team_hub_idx on community_votes(team_id, hub);
create index if not exists cv_user_hub_idx on community_votes(user_id, hub);

-- Per-user, per-hub budget tracker (max 10 votes per hub)
create table if not exists user_hub_budget (
  user_id    text not null,
  hub        text not null,
  votes_used integer not null default 0 check (votes_used >= 0 and votes_used <= 10),
  primary key (user_id, hub)
);

-- ══════════════════════════════════════════════════════════════════
-- 3. PEER VOTES  (互评 — participants vote for other teams)
--    Max 3 votes per team; 1 per recipient; can't vote for own team
-- ══════════════════════════════════════════════════════════════════
create table if not exists peer_votes (
  id             uuid primary key default gen_random_uuid(),
  voter_team_id  uuid not null references teams(id) on delete cascade,
  voted_team_id  uuid not null references teams(id) on delete cascade,
  hub            text not null,
  created_at     timestamptz default now(),
  constraint uq_peer_vote  unique (voter_team_id, voted_team_id),
  constraint no_self_vote  check  (voter_team_id != voted_team_id)
);

create index if not exists pv_voted_hub_idx on peer_votes(voted_team_id, hub);
create index if not exists pv_voter_idx     on peer_votes(voter_team_id);

-- ══════════════════════════════════════════════════════════════════
-- 4. JUDGE SCORES
--    Criteria TBD — 3 placeholder fields, each 0–10
-- ══════════════════════════════════════════════════════════════════
create table if not exists judge_scores (
  id            uuid primary key default gen_random_uuid(),
  judge_id      text not null,                     -- judge code (e.g. "JUDGE_SF_01")
  team_id       uuid not null references teams(id) on delete cascade,
  hub           text not null,
  criterion_1   numeric(4,1) check (criterion_1 between 0 and 10),  -- TBD
  criterion_2   numeric(4,1) check (criterion_2 between 0 and 10),  -- TBD
  criterion_3   numeric(4,1) check (criterion_3 between 0 and 10),  -- TBD
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint uq_judge_team unique (judge_id, team_id)
);

create index if not exists js_hub_idx on judge_scores(hub);

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

-- Judge score totals per team (average across all judges)
create or replace view v_judge_score_totals as
select
  team_id,
  hub,
  round(avg(coalesce(criterion_1,0) + coalesce(criterion_2,0) + coalesce(criterion_3,0)), 2) as judge_total_avg,
  count(distinct judge_id) as judge_count
from judge_scores
group by team_id, hub;

-- ══════════════════════════════════════════════════════════════════
-- 7. FINALIST CALCULATION FUNCTION
--    Call: select calculate_finalists('sf');
-- ══════════════════════════════════════════════════════════════════
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
  -- NY gets 15 per bucket; SF and SH get 10
  if p_prize_hub = 'ny' then
    v_referral_slots := 15;
    v_peer_slots     := 15;
  else
    v_referral_slots := 10;
    v_peer_slots     := 10;
  end if;

  -- Delete previous calculation for this hub
  delete from finalists where prize_hub = p_prize_hub;

  -- ── A: Referral top N (threshold >500) ─────────────────────────
  insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
  select
    t.id,
    p_prize_hub,
    t.hub,
    'referral',
    row_number() over (order by t.referral_count desc, t.submitted_at asc)::int,
    now()
  from teams t
  where
    t.hub = any(
      case p_prize_hub
        when 'sf' then array['sf','go']
        when 'sh' then array['sh','ao']
        when 'ny' then array['ny']
      end
    )
    and t.referral_count > 500
  order by t.referral_count desc, t.submitted_at asc
  limit v_referral_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── B: Peer vote top N (offline hubs only) ─────────────────────
  insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
  select
    t.id,
    p_prize_hub,
    t.hub,
    'peer',
    row_number() over (order by coalesce(pv_count,0) desc, t.submitted_at asc)::int,
    now()
  from teams t
  left join (
    select voted_team_id, count(*) as pv_count
    from peer_votes
    group by voted_team_id
  ) pv on pv.voted_team_id = t.id
  where
    t.hub = any(
      case p_prize_hub
        when 'sf' then array['sf']  -- offline SF only for peer bucket
        when 'sh' then array['sh']
        when 'ny' then array['ny']
      end
    )
    and t.referral_count > 200           -- B-class threshold
  order by coalesce(pv_count,0) desc, t.submitted_at asc
  limit v_peer_slots
  on conflict (team_id, prize_hub) do nothing;  -- skip if already in via referral (dedup)

  -- ── C/D: Online top 10 (by community votes; no judge scores yet) ─
  if p_prize_hub in ('sf','sh') then
    insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
    select
      t.id,
      p_prize_hub,
      t.hub,
      'online',
      row_number() over (order by coalesce(cv_sum,0) desc, t.submitted_at asc)::int,
      now()
    from teams t
    left join (
      select team_id, sum(votes_count) as cv_sum
      from community_votes
      group by team_id
    ) cv on cv.team_id = t.id
    where
      t.hub = (case p_prize_hub when 'sf' then 'go' else 'ao' end)
    order by coalesce(cv_sum,0) desc, t.submitted_at asc
    limit 10
    on conflict (team_id, prize_hub) do nothing;
  end if;

  -- ── Assign overall_rank (by qualification_method priority, then peer votes) ─
  with ranked as (
    select
      f.id,
      row_number() over (
        order by
          case f.qualification_method when 'referral' then 1 when 'peer' then 2 else 3 end,
          f.rank_in_method
      ) as rn
    from finalists f
    where f.prize_hub = p_prize_hub
  )
  update finalists f2
  set overall_rank = r.rn
  from ranked r
  where f2.id = r.id;

  -- Return the result
  return query
    select
      f.team_id, t.name, t.project_name,
      f.source_hub, f.qualification_method,
      f.rank_in_method,
      coalesce(cv.cv_sum, 0) as community_votes,
      coalesce(pv.pv_count, 0) as peer_votes
    from finalists f
    join teams t on t.id = f.team_id
    left join (select team_id, sum(votes_count) as cv_sum from community_votes group by team_id) cv on cv.team_id = f.team_id
    left join (select voted_team_id, count(*) as pv_count from peer_votes group by voted_team_id) pv on pv.voted_team_id = f.team_id
    where f.prize_hub = p_prize_hub
    order by f.overall_rank;
end;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════

alter table teams           enable row level security;
alter table community_votes enable row level security;
alter table user_hub_budget enable row level security;
alter table peer_votes      enable row level security;
alter table judge_scores    enable row level security;
alter table finalists       enable row level security;

-- Teams: readable by all (public leaderboard data)
create policy "teams_read_all"    on teams for select using (true);
create policy "teams_insert_service" on teams for insert with check (true);  -- service role only in practice
create policy "teams_update_service" on teams for update using (true);

-- Community votes: users can read/write their own rows
create policy "cv_read_own"   on community_votes for select using (auth.uid()::text = user_id);
create policy "cv_insert_own" on community_votes for insert with check (auth.uid()::text = user_id);
create policy "cv_update_own" on community_votes for update using (auth.uid()::text = user_id);

-- Budget: users can read/write their own
create policy "budget_read_own"   on user_hub_budget for select using (auth.uid()::text = user_id);
create policy "budget_write_own"  on user_hub_budget for all    using (auth.uid()::text = user_id);

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
