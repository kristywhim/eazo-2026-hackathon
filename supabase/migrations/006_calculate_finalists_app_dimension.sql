-- ══════════════════════════════════════════════════════════════════
-- Migration 006 · calculate_finalists — rank by APP, dedup by TEAM
-- ══════════════════════════════════════════════════════════════════
-- After 005 introduced the apps table, qualification math changes:
--
--   A class: rank APPS by community votes (desc, > 500), walk down list,
--            pick each app's TEAM (skip duplicates), stop at top N teams.
--   B class: same but rank by peer_votes (offline hubs only, > 200 ref
--            preserved per organizer); apps owned by teams whose best app
--            has > 200 community votes (the >200 threshold per organizer
--            still requires that the team's max app passed 200 votes).
--   C/D class: rank ONLINE-hub apps by 0.50*V_norm + 0.10*P_norm (normalized
--            within online pool), dedup by team, top 10.
--
-- Finalists is still team-keyed (one Demo slot per team regardless of how
-- many of their apps qualify).
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

  -- ── A: rank apps by votes desc; dedup by team; > 500 threshold ─────
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
    from apps_in_region
    group by team_id, hub
  ),
  ranked as (
    select team_id, hub, best_votes,
           row_number() over (order by best_votes desc) as rn
    from team_best
  )
  select team_id, p_prize_hub, hub, 'referral', rn::int, now()
  from ranked
  where rn <= v_referral_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── B: rank apps by peer_votes desc; dedup by team ────────────────
  -- (offline only; > 200 referral threshold preserved per organizer wish —
  --  but now interpreted as team_max_votes > 200, i.e. team has at least one
  --  app with > 200 community votes)
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
    and vmv.team_max_votes > 200   -- organizer-required referral threshold (now team-best votes)
  ),
  team_best_peer as (
    select team_id, hub, max(peer_votes) as best_peer
    from apps_offline
    group by team_id, hub
  ),
  ranked as (
    select team_id, hub, best_peer,
           row_number() over (order by best_peer desc) as rn
    from team_best_peer
  )
  select team_id, p_prize_hub, hub, 'peer', rn::int, now()
  from ranked
  where rn <= v_peer_slots
  on conflict (team_id, prize_hub) do nothing;

  -- ── C/D: online — V·50% + P·10% normalized within online pool ─────
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
      select
        o.team_id,
        case when r.v_max = r.v_min then 0.5
             else (o.v - r.v_min) / nullif(r.v_max - r.v_min, 0) end as v_norm,
        case when r.p_max = r.p_min then 0.5
             else (o.p - r.p_min) / nullif(r.p_max - r.p_min, 0) end as p_norm
      from online_apps o cross join ranges r
    ),
    team_best as (
      select team_id, max(0.50 * v_norm + 0.10 * p_norm) as composite
      from scored
      group by team_id
    ),
    ranked as (
      select team_id, composite, row_number() over (order by composite desc) as rn
      from team_best
    )
    select team_id, p_prize_hub,
           (case p_prize_hub when 'sf' then 'go' else 'ao' end),
           'online', rn::int, now()
    from ranked
    where rn <= 10
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

commit;
