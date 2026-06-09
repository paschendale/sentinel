-- Ensures monthly partitions exist for the current month and the next 3 months.
-- Runs at apply-time using NOW(), so it always targets the actual deploy date.
-- IF NOT EXISTS makes this safe even when some partitions already exist.
DO $$
DECLARE
  i          INT;
  start_date DATE;
  end_date   DATE;
  y          INT;
  m          INT;
BEGIN
  FOR i IN 0..3 LOOP
    start_date := date_trunc('month', NOW() + (i || ' months')::INTERVAL)::DATE;
    end_date   := (start_date + INTERVAL '1 month')::DATE;
    y          := EXTRACT(YEAR  FROM start_date);
    m          := EXTRACT(MONTH FROM start_date);
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS test_runs_%s_%s
       PARTITION OF test_runs
       FOR VALUES FROM (%L) TO (%L)',
      y, lpad(m::TEXT, 2, '0'), start_date, end_date
    );
  END LOOP;
END;
$$;
