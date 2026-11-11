-- Migration: 021_incidents
-- Stored incidents. Until now incidents were derived per request from the last 500 runs and
-- vanished with run retention. An incident opens when a test reaches Outage, collects every
-- test of its group (an `incident:<group>` tag) that is in trouble, keeps a timeline and a
-- report, and resolves when every linked test is Operational again. Incidents are internal
-- until a signed-in person publishes them. Additive only.

CREATE TABLE incidents (
  id           TEXT        PRIMARY KEY,
  title        TEXT        NOT NULL,
  -- worst state any linked test reached
  severity     TEXT        NOT NULL CHECK (severity IN ('down', 'degraded')),
  state        TEXT        NOT NULL DEFAULT 'investigating'
                           CHECK (state IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at   TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ,
  -- NULL = internal; set when a person publishes it on the status page
  published_at TIMESTAMPTZ,
  -- value of the `incident:<group>` tag that opened it; NULL for a single-test incident
  group_key    TEXT,
  -- snapshot filled at resolve, so the numbers outlive run retention
  duration_ms  BIGINT,
  failed_runs  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX incidents_open_group_idx ON incidents (group_key) WHERE resolved_at IS NULL;
CREATE INDEX incidents_started_idx ON incidents (started_at DESC);
CREATE INDEX incidents_published_idx ON incidents (published_at) WHERE published_at IS NOT NULL;

-- Tests affected by an incident. test_id goes NULL when the test is deleted; test_name stays.
CREATE TABLE incident_tests (
  id           TEXT        PRIMARY KEY,
  incident_id  TEXT        NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  test_id      TEXT        REFERENCES tests(id) ON DELETE SET NULL,
  test_name    TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  -- when the test was Operational again; NULL while it is still in trouble
  ended_at     TIMESTAMPTZ,
  worst_status TEXT        NOT NULL CHECK (worst_status IN ('down', 'degraded'))
);

CREATE UNIQUE INDEX incident_tests_incident_test_idx ON incident_tests (incident_id, test_id) WHERE test_id IS NOT NULL;
CREATE INDEX incident_tests_test_idx ON incident_tests (test_id) WHERE test_id IS NOT NULL;

-- Timeline. System entries are written by Sentinel; notes by people and agents.
CREATE TABLE incident_updates (
  id          TEXT        PRIMARY KEY,
  incident_id TEXT        NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind        TEXT        NOT NULL CHECK (kind IN ('system', 'note')),
  body        TEXT        NOT NULL,
  -- 'user:<name>', 'token:<label>' or 'system'
  author      TEXT        NOT NULL,
  -- shown on the status page once the incident is published
  public      BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX incident_updates_incident_idx ON incident_updates (incident_id, created_at);

-- The written report: five sections, each with an internal and a public version (Markdown).
CREATE TABLE incident_reports (
  incident_id         TEXT        PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  summary_internal    TEXT        NOT NULL DEFAULT '',
  summary_public      TEXT        NOT NULL DEFAULT '',
  impact_internal     TEXT        NOT NULL DEFAULT '',
  impact_public       TEXT        NOT NULL DEFAULT '',
  root_cause_internal TEXT        NOT NULL DEFAULT '',
  root_cause_public   TEXT        NOT NULL DEFAULT '',
  resolution_internal TEXT        NOT NULL DEFAULT '',
  resolution_public   TEXT        NOT NULL DEFAULT '',
  follow_ups_internal TEXT        NOT NULL DEFAULT '',
  follow_ups_public   TEXT        NOT NULL DEFAULT '',
  -- NULL = draft
  published_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_threads ADD COLUMN IF NOT EXISTS incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL;
ALTER TABLE notification_events  ADD COLUMN IF NOT EXISTS incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL;
