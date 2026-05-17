-- ══════════════════════════════════════════════════════════════════
-- Migration 004 · Vote budget enforcement per REGION (not per hub)
-- ══════════════════════════════════════════════════════════════════
-- Frontend merges sf+go → SF region and sh+ao → SH region into 3 tabs.
-- Vote budget MUST follow the user-visible region: 10 votes per region.
-- Previously: user could vote 10× in sf hub AND 10× in go hub = 20× in
-- the SF region (exploitable).
--
-- Approach: NEW table `user_region_budget(user_id, region, votes_used)`.
-- Old `user_hub_budget` stays for one release cycle (no DROP), backfilled
-- by summing per region. api/vote.js reads/writes the new table.
--
-- Region mapping:
--   sf, go → region 'sf'
--   sh, ao → region 'sh'
--   ny     → region 'ny'
-- ══════════════════════════════════════════════════════════════════

begin;

create table if not exists user_region_budget (
  user_id    text not null,
  region     text not null check (region in ('sf','ny','sh')),
  votes_used integer not null default 0 check (votes_used >= 0 and votes_used <= 10),
  updated_at timestamptz default now(),
  primary key (user_id, region)
);

create index if not exists urb_user_idx on user_region_budget(user_id);

-- Backfill from existing user_hub_budget rows (sum per region)
insert into user_region_budget (user_id, region, votes_used)
select
  user_id,
  case hub
    when 'go' then 'sf'
    when 'ao' then 'sh'
    else hub
  end as region,
  least(10, sum(votes_used))::integer as votes_used
from user_hub_budget
where hub in ('sf','ny','sh','go','ao')
group by user_id, region
on conflict (user_id, region) do update
  set votes_used = least(10, excluded.votes_used);

-- RLS policies (read/write own rows; same pattern as user_hub_budget)
alter table user_region_budget enable row level security;

create policy "urb_read_own"  on user_region_budget for select using (auth.uid()::text = user_id);
create policy "urb_write_own" on user_region_budget for all    using (auth.uid()::text = user_id);

commit;

-- ── Verification ──────────────────────────────────────────────
-- select region, count(*), sum(votes_used)
-- from user_region_budget
-- group by region;
