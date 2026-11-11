-- Migration: 022_uptime_warn_count
-- Warned runs (status 'warn') are neither successes nor failures. uptime_daily counted them
-- nowhere, so a day of warnings read as "no data". Count them on their own; older rows keep 0.
ALTER TABLE uptime_daily ADD COLUMN IF NOT EXISTS warn_count INTEGER NOT NULL DEFAULT 0;
