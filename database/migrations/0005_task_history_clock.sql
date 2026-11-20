-- =====================================================================
-- AbsenInn · Migration 0005 — ordering of task history (Phase 5)
-- History rows written by the trigger inside one transaction all got the
-- same now() (= transaction start), so their order was ambiguous.
-- clock_timestamp() gives each row its real insertion time.
-- Safe to re-run.
-- =====================================================================
alter table public.task_history alter column created_at set default clock_timestamp();
