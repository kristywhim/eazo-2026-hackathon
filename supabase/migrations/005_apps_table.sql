-- ══════════════════════════════════════════════════════════════════
-- Migration 005 · apps table + relational refactor
-- ══════════════════════════════════════════════════════════════════
-- Per organizer clarification:
--   "A team can submit multiple apps. Any one app >200 votes qualifies
--    the team for Special Award; same logic for A class >500."
--
-- Current schema treats team=project as 1:1 (teams.project_name as scalar).
-- This migration introduces a separate `apps` table (1:N with teams) and
-- moves all per-vote / per-score targeting from team_id → app_id.
--
-- Strategy: NON-DESTRUCTIVE — old columns kept for one cycle so the existing
-- frontends + APIs keep working during refactor. Once everything migrates,
-- a later migration can DROP the legacy team_id columns.
--
-- Aggregations:
--   team.V = MAX(votes_count) across team's apps   (best app represents team)
--   team.P = MAX(peer_votes)  across team's apps
--   team.J = AVG(judge_total) across team's APPs that were judged
--
-- Special Award: team has any app with votes > 200 AND team not in finalists.
-- ══════════════════════════════════════════════════════════════════

begin;

-- ── 1. apps table ──────────────────────────────────────────────────
create table if not exists apps (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  eazo_app_id     text unique,                       -- Eazo creator_apps.app_id (nullable; team may not yet have an Eazo app)
  name            text not null,                     -- app/project title
  description     text,
  app_url         text,                              -- public URL on Eazo Creator (deep link from detail modal)
  cover_url       text,
  track           text check (track in ('superparent','companion','lifeos','body','wildcard')),
  hub             text not null check (hub in ('sf','ny','sh','go','ao')),  -- denormalized from team for fast filtering
  icon_emoji      text default '🚀',
  icon_bg         text default '#CCF0E3',
  submitted_at    timestamptz default now(),
  created_at      timestamptz default now()
);

create index if not exists apps_team_idx on apps(team_id);
create index if not exists apps_hub_idx  on apps(hub);

-- ── 2. Migrate existing 1:1 teams → 1 app per team ─────────────────
insert into apps (team_id, name, description, hub, track, icon_emoji, icon_bg, submitted_at)
select id, project_name, project_desc, hub, track, icon_emoji, icon_bg, submitted_at
from teams
where not exists (select 1 from apps a where a.team_id = teams.id);

-- ── 3. Add app_id to vote/score tables (nullable for back-compat) ──
alter table community_votes add column if not exists app_id uuid references apps(id) on delete cascade;
alter table peer_votes      add column if not exists voted_app_id uuid references apps(id) on delete cascade;
alter table judge_scores    add column if not exists app_id uuid references apps(id) on delete cascade;

-- Backfill: for each existing row, point at the team's FIRST app
update community_votes cv
   set app_id = (select id from apps a where a.team_id = cv.team_id order by a.created_at asc limit 1)
 where cv.app_id is null;

update peer_votes pv
   set voted_app_id = (select id from apps a where a.team_id = pv.voted_team_id order by a.created_at asc limit 1)
 where pv.voted_app_id is null;

update judge_scores js
   set app_id = (select id from apps a where a.team_id = js.team_id order by a.created_at asc limit 1)
 where js.app_id is null;

create index if not exists cv_app_idx on community_votes(app_id);
create index if not exists pv_app_idx on peer_votes(voted_app_id);
create index if not exists js_app_idx on judge_scores(app_id);

-- ── 4. Per-app totals views ────────────────────────────────────────
drop view if exists v_app_vote_totals  cascade;
drop view if exists v_app_peer_totals  cascade;
drop view if exists v_team_max_votes   cascade;
drop view if exists v_team_max_peer    cascade;
drop view if exists v_special_award_candidates cascade;
drop view if exists v_app_judge_totals cascade;
drop view if exists v_team_judge_avg   cascade;

create view v_app_vote_totals as
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

create view v_app_peer_totals as
select
  a.id        as app_id,
  a.team_id,
  a.hub,
  count(pv.id)::integer as peer_votes
from apps a
left join peer_votes pv on pv.voted_app_id = a.id
group by a.id;

create view v_app_judge_totals as
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

-- Team-level aggregates (MAX V / MAX P / AVG J across team's apps)
create view v_team_max_votes as
select team_id, max(votes)::integer as team_max_votes
from v_app_vote_totals
group by team_id;

create view v_team_max_peer as
select team_id, max(peer_votes)::integer as team_max_peer
from v_app_peer_totals
group by team_id;

create view v_team_judge_avg as
select team_id, round(avg(judge_total_avg), 2) as team_judge_avg
from v_app_judge_totals
where judge_count > 0
group by team_id;

-- Special Award candidates: team has ANY app with > 200 votes AND team NOT in finalists
create view v_special_award_candidates as
select
  t.id                  as team_id,
  t.eazo_team_id,
  t.name                as team_name,
  t.hub,
  t.track,
  v.team_max_votes      as best_app_votes,
  -- include the name of the qualifying (top) app for display
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

-- Grant public read on the special-award view (used by /api/special-awards)
grant select on v_special_award_candidates to anon, authenticated;

commit;

-- ── Verification ──────────────────────────────────────────────────
-- 1. Every team has at least one app
-- select t.id, t.name, count(a.id) as app_count
-- from teams t left join apps a on a.team_id = t.id
-- group by t.id having count(a.id) = 0;
--
-- 2. Vote/peer/judge rows all have app_id populated
-- select count(*) from community_votes where app_id is null;
-- select count(*) from peer_votes where voted_app_id is null;
-- select count(*) from judge_scores where app_id is null;
--
-- 3. Special-award view returns reasonable rows after vote data is seeded
-- select * from v_special_award_candidates;
