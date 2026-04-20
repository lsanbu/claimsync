-- =============================================================================
-- ClaimSync — Migration v3
-- Sprint: Token fix + Azure Communication Services prep
-- Date   : March 2026
-- Author : Anbu / Kaaryaa Intelligence LLP
--
-- Changes:
--   1. credential_tokens  — add status (4-state), sent_to_email, resend_count
--   2. credential_tokens  — change default expiry 72hr → 7 days
--   3. tenant_facilities  — add credential_token_status view column (computed)
--   4. onboarding_requests — add credential_link_sent_at for audit trail
-- =============================================================================

SET search_path TO claimssync, public;

-- -----------------------------------------------------------------------------
-- 1. credential_tokens — add status column
--    States:
--      valid   → token generated, not yet used, not expired
--      used    → credentials successfully submitted — terminal state
--      expired → past expires_at and never used (set by cron or on-read)
--      revoked → admin manually invalidated (e.g. resend issued new token)
-- -----------------------------------------------------------------------------
ALTER TABLE claimssync.credential_tokens
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'valid'
        CHECK (status IN ('valid', 'expired', 'used', 'revoked'));

-- -----------------------------------------------------------------------------
-- 2. credential_tokens — resend tracking columns
--    sent_to_email : email address the link was dispatched to (ACS audit)
--    resend_count  : how many times admin has regenerated this chain
--    resent_at     : when last resend happened
--    created_by    : admin who triggered the token (for audit log)
-- -----------------------------------------------------------------------------
ALTER TABLE claimssync.credential_tokens
    ADD COLUMN IF NOT EXISTS sent_to_email   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS resend_count    INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS resent_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by      VARCHAR(200) NOT NULL DEFAULT 'system';

-- -----------------------------------------------------------------------------
-- 3. credential_tokens — fix expiry default to 7 days
--    Note: only affects NEW tokens. Existing rows keep their expires_at value.
-- -----------------------------------------------------------------------------
ALTER TABLE claimssync.credential_tokens
    ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

-- -----------------------------------------------------------------------------
-- 4. onboarding_requests — track when credential email was sent
-- -----------------------------------------------------------------------------
ALTER TABLE claimssync.onboarding_requests
    ADD COLUMN IF NOT EXISTS credential_link_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS credential_link_sent_to VARCHAR(255);

-- -----------------------------------------------------------------------------
-- 5. Indexes for common query patterns
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cred_tokens_status
    ON claimssync.credential_tokens(status);

CREATE INDEX IF NOT EXISTS idx_cred_tokens_facility_status
    ON claimssync.credential_tokens(facility_id, status);

-- -----------------------------------------------------------------------------
-- 6. Auto-expire function — marks valid+overdue tokens as expired
--    Call this from the API on token lookup (lazy expiry) or schedule via pg_cron
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claimssync.expire_stale_tokens()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE claimssync.credential_tokens
    SET    status = 'expired'
    WHERE  status = 'valid'
      AND  expires_at < NOW();
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Backfill: mark any existing used tokens (has used_at) with status=used
--    Safe to run multiple times (idempotent).
-- -----------------------------------------------------------------------------
UPDATE claimssync.credential_tokens
SET    status = 'used'
WHERE  used_at IS NOT NULL
  AND  status  = 'valid';

-- Backfill expired tokens
UPDATE claimssync.credential_tokens
SET    status = 'expired'
WHERE  expires_at < NOW()
  AND  used_at   IS NULL
  AND  status    = 'valid';

-- -----------------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------------
SELECT
    status,
    COUNT(*) AS token_count
FROM claimssync.credential_tokens
GROUP BY status
ORDER BY status;
