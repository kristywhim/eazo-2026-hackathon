-- ══════════════════════════════════════════════════════════════════
-- Migration 001 · Judge rubric: 3 TBD criteria → 5 named criteria
-- ══════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor IF you've already deployed schema.sql
-- with the old `criterion_1/2/3` columns. Fresh deploys can skip this —
-- just run the updated schema.sql instead.
--
-- Source of truth: Eazo Judge Guide 2026 — 5 dimensions × 10 pts = 50 pts.
--   01 · Product Completeness  → completeness
--   02 · Innovation            → innovation
--   03 · Technical Execution   → technical
--   04 · Design & Experience   → design
--   05 · Commercial Potential  → commercial
-- ══════════════════════════════════════════════════════════════════

begin;

-- 1. Add the 5 new columns (nullable; existing rows untouched)
alter table judge_scores
  add column if not exists completeness numeric(4,1) check (completeness between 0 and 10),
  add column if not exists innovation   numeric(4,1) check (innovation   between 0 and 10),
  add column if not exists technical    numeric(4,1) check (technical    between 0 and 10),
  add column if not exists design       numeric(4,1) check (design       between 0 and 10),
  add column if not exists commercial   numeric(4,1) check (commercial   between 0 and 10);

-- 2. Best-effort backfill from old columns (only useful if production had real data;
--    safe to run even if data is mock — copies value-or-null).
--    Mapping is a guess — the old columns were marked TBD.
update judge_scores
set
  completeness = coalesce(completeness, criterion_1),
  innovation   = coalesce(innovation,   criterion_2),
  technical    = coalesce(technical,    criterion_3)
where criterion_1 is not null or criterion_2 is not null or criterion_3 is not null;

-- 3. Drop the dependent view FIRST so we can drop the old columns it references.
--    (We'll recreate the view at the end with the new column names.)
drop view if exists v_judge_score_totals;

-- 4. Drop the old columns
alter table judge_scores
  drop column if exists criterion_1,
  drop column if exists criterion_2,
  drop column if exists criterion_3;

-- 5. Recreate the aggregate view using the new column names
create view v_judge_score_totals as
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

commit;

-- ── Verification queries (optional, run after commit) ──────────────
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'judge_scores'
-- order by ordinal_position;
--
-- select * from v_judge_score_totals limit 5;
