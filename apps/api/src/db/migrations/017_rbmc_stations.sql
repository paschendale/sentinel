-- Migration: 017_rbmc_stations
-- RBMC branch: one row per IBGE RBMC GNSS station, sourced from the RBMCPoint
-- shapefile (SG_RBMC column). Each station is linked to the monitoring test that
-- checks the RBMC-IP NTRIP sourcetable for its mountpoints. Stations that
-- disappear from the shapefile are flagged (in_shapefile = false), never deleted.

CREATE TABLE rbmc_stations (
  code             TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4}$'),
  test_id          TEXT NULL REFERENCES tests(id) ON DELETE SET NULL,
  station_id       TEXT,
  uf               TEXT,
  geocodigo        TEXT,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  alt_geom         TEXT,
  name             TEXT,
  in_shapefile     BOOLEAN NOT NULL DEFAULT TRUE,
  template_version INT,
  synced_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX rbmc_stations_test_id_idx ON rbmc_stations (test_id) WHERE test_id IS NOT NULL;
