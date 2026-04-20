-- migration_v5_run_progress.sql
-- Engine :3.17 — adds live "currently processing" interval columns to sync_run_log.
-- Written by db_run_logger.update_progress() after each interval finishes so the
-- dashboard can show "Currently: 12 Apr 2026 22:00 → 24:00" alongside the
-- intervals_completed / intervals_total counters.
--
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- Run BEFORE deploying engine :3.17 (otherwise update_progress writes will fail
-- with "column does not exist" — wrapped in try/except so silent, but no live
-- interval data lands in the row until the migration is applied).

ALTER TABLE claimssync.sync_run_log
    ADD COLUMN IF NOT EXISTS current_interval_from VARCHAR(50),
    ADD COLUMN IF NOT EXISTS current_interval_to   VARCHAR(50);

COMMENT ON COLUMN claimssync.sync_run_log.current_interval_from IS
    'Live: wstart of the interval being processed right now. NULL after end_run. '
    'Format: ''YYYY-MM-DD HH:MM''. Engine :3.17+';
COMMENT ON COLUMN claimssync.sync_run_log.current_interval_to IS
    'Live: wend of the interval being processed right now. NULL after end_run. '
    'Format: ''YYYY-MM-DD HH:MM''. Engine :3.17+';
