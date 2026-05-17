-- ══════════════════════════════════════════════════════════════════
-- Migration 003 · Fix C/D online qualification formula
-- ══════════════════════════════════════════════════════════════════
-- Per prize-logic-v4: online (C/D class) qualification uses
--   composite = 0.50 * V_norm + 0.10 * P_norm  (min-max normalized within online pool)
-- Previous version sorted by community votes (V) alone, ignoring peer votes (P).
--
-- This migration ONLY rewrites the calculate_finalists function (CREATE OR
-- REPLACE — idempotent). No schema changes. The peer-bucket >200 referral
-- filter is INTENTIONALLY preserved per user requirement (organizers want it).
-- ══════════════════════════════════════════════════════════════════

begin;

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

  -- ── A: Referral top N (>500 threshold) ─────────────────────────
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

  -- ── B: Peer-vote top N (offline only, with >200 referral filter per organizer requirement) ─
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
        when 'sf' then array['sf']
        when 'sh' then array['sh']
        when 'ny' then array['ny']
      end
    )
    and t.referral_count > 200
  order by coalesce(pv_count,0) desc, t.submitted_at asc
  limit v_peer_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── C/D: Online top 10 (FIXED: uses V·50% + P·10% normalized within online pool) ─
  if p_prize_hub in ('sf','sh') then
    insert into finalists (team_id, prize_hub, source_hub, qualification_method, rank_in_method, calculated_at)
    with online_pool as (
      select
        t.id,
        t.submitted_at,
        coalesce(cv.cv_sum, 0)::numeric  as v,
        coalesce(pv.pv_count, 0)::numeric as p
      from teams t
      left join (select team_id, sum(votes_count) as cv_sum from community_votes group by team_id) cv on cv.team_id = t.id
      left join (select voted_team_id, count(*) as pv_count from peer_votes group by voted_team_id) pv on pv.voted_team_id = t.id
      where t.hub = (case p_prize_hub when 'sf' then 'go' else 'ao' end)
    ),
    ranges as (
      select
        min(v) as v_min, max(v) as v_max,
        min(p) as p_min, max(p) as p_max
      from online_pool
    ),
    scored as (
      select
        o.id,
        o.submitted_at,
        case when r.v_max = r.v_min then 0.5
             else (o.v - r.v_min) / nullif(r.v_max - r.v_min, 0) end as v_norm,
        case when r.p_max = r.p_min then 0.5
             else (o.p - r.p_min) / nullif(r.p_max - r.p_min, 0) end as p_norm
      from online_pool o cross join ranges r
    )
    select
      s.id,
      p_prize_hub,
      (case p_prize_hub when 'sf' then 'go' else 'ao' end),
      'online',
      row_number() over (order by (0.50 * s.v_norm + 0.10 * s.p_norm) desc, s.submitted_at asc)::int,
      now()
    from scored s
    order by (0.50 * s.v_norm + 0.10 * s.p_norm) desc, s.submitted_at asc
    limit 10
    on conflict (team_id, prize_hub) do nothing;
  end if;

  -- ── overall_rank: referral > peer > online ─────────────────────
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

commit;
