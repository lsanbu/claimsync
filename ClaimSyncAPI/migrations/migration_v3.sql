-- migration_v3.sql — Sprint 1+2: Credential token states + ACS email support
-- Run against: claimssync-db.postgres.database.azure.com / postgres / schema=claimssync
-- Version: 2.3
-- Date: 2026-03-24

-- 1. Credential token states + metadata
ALTER TABLE claimssync.credential_tokens
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid','expired','used','revoked')),
  ADD COLUMN IF NOT EXISTS sent_to_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS resend_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(200) NOT NULL DEFAULT 'system',
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

-- 2. Onboarding request email tracking
ALTER TABLE claimssync.onboarding_requests
  ADD COLUMN IF NOT EXISTS credential_link_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credential_link_sent_to VARCHAR(255);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_cred_tokens_status ON claimssync.credential_tokens(status);
CREATE INDEX IF NOT EXISTS idx_cred_tokens_facility_status ON claimssync.credential_tokens(facility_id, status);

-- 4. Backfill existing rows
UPDATE claimssync.credential_tokens SET status = 'used'    WHERE used_at IS NOT NULL AND status = 'valid';
UPDATE claimssync.credential_tokens SET status = 'expired' WHERE expires_at < NOW() AND used_at IS NULL AND status = 'valid';
