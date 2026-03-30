ALTER TABLE test_state
  ADD COLUMN public_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (public_status IN ('up', 'degraded', 'down', 'unknown'));
