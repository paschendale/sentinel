-- Migration: 015_secrets
-- Global, write-only secret store, retrievable in test code as ctx.secrets.NAME.
-- value_blob is version-tagged (see apps/api/src/crypto/secret-cipher.ts): AES-256-GCM
-- encrypted if SECRETS_ENCRYPTION_KEY was set at write time, plaintext otherwise.
-- Never returned by any API response after creation — only name/timestamps are read back.
-- Single-tenant: no per-test scoping, every test sees every secret via ctx.secrets.

CREATE TABLE secrets (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
  value_blob      BYTEA       NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
