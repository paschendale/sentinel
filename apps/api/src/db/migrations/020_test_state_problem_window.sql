-- Problem window on test_state, so dashboards can show "failing for 5h" and
-- "recovered 50m ago, was down for 26h" and sort tests into sections.
--
--   problem_started_at  first run of the current (or most recent) streak of non-passing state
--   problem_ended_at    first passing run after that streak; NULL while the streak is ongoing
--   problem_worst       worst public state reached during that streak: 'down' or 'degraded'
--   last_problem_at     most recent run that did not pass (warn, fail or timeout)
--
-- Maintained by the per-run upsert in result-buffer.ts. Backfilled here from the last 7 days
-- of test_runs; the backfilled problem_worst is approximate (a streak with at least
-- failure_threshold failing runs counts as 'down').
ALTER TABLE test_state
  ADD COLUMN problem_started_at TIMESTAMPTZ,
  ADD COLUMN problem_ended_at   TIMESTAMPTZ,
  ADD COLUMN problem_worst      TEXT CHECK (problem_worst IN ('down', 'degraded')),
  ADD COLUMN last_problem_at    TIMESTAMPTZ;

WITH recent AS (
  SELECT test_id, finished_at, status
  FROM test_runs
  WHERE finished_at >= NOW() - INTERVAL '7 days'
),
last_problem AS (
  SELECT test_id, MAX(finished_at) AS at
  FROM recent
  WHERE status <> 'success'
  GROUP BY test_id
),
bounds AS (
  SELECT
    ts.test_id,
    ts.public_status,
    t.failure_threshold,
    lp.at AS last_problem_at,
    -- passing run right before the most recent problem streak
    (SELECT MAX(r.finished_at) FROM recent r
      WHERE r.test_id = ts.test_id AND r.status = 'success' AND r.finished_at < lp.at) AS prev_success_at,
    -- first passing run after the most recent problem (NULL while it is ongoing)
    (SELECT MIN(r.finished_at) FROM recent r
      WHERE r.test_id = ts.test_id AND r.status = 'success' AND r.finished_at > lp.at) AS ended_at
  FROM test_state ts
  JOIN tests t ON t.id = ts.test_id
  JOIN last_problem lp ON lp.test_id = ts.test_id
),
streaks AS (
  SELECT
    b.*,
    (SELECT MIN(r.finished_at) FROM recent r
      WHERE r.test_id = b.test_id AND r.status <> 'success'
        AND r.finished_at > COALESCE(b.prev_success_at, '-infinity'::timestamptz)) AS started_at,
    (SELECT COUNT(*) FROM recent r
      WHERE r.test_id = b.test_id AND r.status IN ('fail', 'timeout')
        AND r.finished_at > COALESCE(b.prev_success_at, '-infinity'::timestamptz)
        AND r.finished_at <= b.last_problem_at) AS failing_runs
  FROM bounds b
)
UPDATE test_state ts
SET
  last_problem_at    = s.last_problem_at,
  problem_started_at = s.started_at,
  problem_ended_at   = CASE WHEN ts.public_status IN ('down', 'degraded') THEN NULL ELSE s.ended_at END,
  problem_worst      = CASE
                         WHEN ts.public_status = 'down' THEN 'down'
                         WHEN s.failing_runs >= s.failure_threshold THEN 'down'
                         ELSE 'degraded'
                       END
FROM streaks s
WHERE s.test_id = ts.test_id;
