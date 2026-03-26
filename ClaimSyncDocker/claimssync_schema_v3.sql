-- =============================================================================
-- ClaimSync — PostgreSQL Schema DDL v3 (Azure-Compatible)
-- =============================================================================
-- Project      : ClaimSync (Kaaryaa GenAI Solutions)
-- Phase        : Phase 1 — P1-T04
-- Target DB    : claimssync-db (Azure PostgreSQL Flexible Server 16, UAE North)
-- Author       : Anbu / Kaaryaa GenAI Solutions
-- Date         : March 2026
--
-- Changes from v2:
--   v3-FIX-1: Removed pgcrypto + pg_trgm CREATE EXTENSION calls.
--             These must be allowlisted via Azure CLI BEFORE running this script:
--             az postgres flexible-server parameter set \
--               --resource-group rg-claimssync-uaenorth-prod \
--               --server-name claimssync-db \
--               --name azure.extensions --value PGCRYPTO,PG_TRGM
--             Then reconnect and run: CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm;
--             If extensions are not yet enabled, gen_random_uuid() (built-in PG13+)
--             is used as fallback for all UUID columns.
--             api_key uses replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')
--             which produces a 64-char hex string without pgcrypto.
--   v3-FIX-2: max_files_per_call made nullable (NULL = unknown/TBD for future providers).
--             Shafafiya default remains 1000 in seed data.
--   v3-FIX-3: All seed INSERTs use explicit search_path to avoid relation-not-found errors.
--   v3-FIX-4: Reseller + tenant seed wrapped in DO block to handle missing deps gracefully.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema + Search Path
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS claimssync;
SET search_path TO claimssync, public;

-- ---------------------------------------------------------------------------
-- Extensions (enable only if allowlisted via Azure CLI)
-- Run these manually AFTER running:
--   az postgres flexible-server parameter set \
--     --resource-group rg-claimssync-uaenorth-prod \
--     --server-name claimssync-db \
--     --name azure.extensions --value PGCRYPTO,PG_TRGM
-- ---------------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- Shared trigger: auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claimssync.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- =============================================================================
-- 1. SERVICE_PROVIDERS
-- =============================================================================
CREATE TABLE claimssync.service_providers (
    provider_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(30)     NOT NULL UNIQUE,
    name                VARCHAR(200)    NOT NULL,
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),
    region              VARCHAR(50)     NOT NULL DEFAULT 'UAE North',
    api_base_url        VARCHAR(500)    NOT NULL,
    api_spec_version    VARCHAR(20),
    api_protocol        VARCHAR(20)     NOT NULL DEFAULT 'SOAP'
                                        CHECK (api_protocol IN ('SOAP','REST','FHIR')),
    wsdl_url            VARCHAR(500),
    timeout_connect_s   INTEGER         NOT NULL DEFAULT 60,
    timeout_read_s      INTEGER         NOT NULL DEFAULT 120,
    rate_limit_sleep_s  INTEGER         NOT NULL DEFAULT 3,
    max_files_per_call  INTEGER,        -- v3-FIX-2: nullable — NULL = unknown for future providers
    auth_model          VARCHAR(30)     NOT NULL DEFAULT 'per_facility_credentials'
                                        CHECK (auth_model IN ('per_facility_credentials','oauth2','api_key')),
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    is_live             BOOLEAN         NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.service_providers                IS 'DOH / regulatory API providers: Shafafiya, DHA, HAAD, GCC expansion';
COMMENT ON COLUMN claimssync.service_providers.is_live        IS 'FALSE = schema supports it but engine not yet integrated (Phase 3+)';
COMMENT ON COLUMN claimssync.service_providers.max_files_per_call IS 'NULL = unknown/TBD. Shafafiya = 1000 (silently capped — use 2-hr interval windowing)';
COMMENT ON COLUMN claimssync.service_providers.rate_limit_sleep_s IS 'Courtesy sleep between interval API calls — DO NOT remove';

CREATE TRIGGER trg_service_providers_updated_at
    BEFORE UPDATE ON claimssync.service_providers
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

-- Seed
INSERT INTO claimssync.service_providers (
    code, name, country, emirate, region,
    api_base_url, api_spec_version, api_protocol, wsdl_url,
    timeout_connect_s, timeout_read_s, rate_limit_sleep_s, max_files_per_call,
    auth_model, is_active, is_live, notes
) VALUES
(
    'SHAFAFIYA', 'Abu Dhabi DOH — Shafafiya',
    'UAE', 'Abu Dhabi', 'UAE North',
    'https://shafafiya.doh.gov.ae/services/', 'SOAP-2024', 'SOAP',
    'https://shafafiya.doh.gov.ae/services/?wsdl',
    60, 120, 3, 1000,
    'per_facility_credentials', TRUE, TRUE,
    'Production since Sep 2024. 1000-file cap per call — handled by 2-hr interval windowing (v8b).'
),
(
    'DHA', 'Dubai Health Authority — Claims Portal',
    'UAE', 'Dubai', 'UAE North',
    'https://api.dha.gov.ae/claims/', NULL, 'REST', NULL,
    60, 120, 3, NULL,   -- max_files_per_call NULL = TBD
    'per_facility_credentials', FALSE, FALSE,
    'Phase 3 target. API spec TBD — confirm with DHA before building connector.'
),
(
    'MOH_UAE', 'UAE Ministry of Health — Federal',
    'UAE', NULL, 'UAE North',
    'https://api.mohap.gov.ae/', NULL, 'REST', NULL,
    60, 120, 3, NULL,
    'per_facility_credentials', FALSE, FALSE,
    'GCC expansion placeholder. Not yet scoped.'
);


-- =============================================================================
-- 2. RESELLERS
-- =============================================================================
CREATE TABLE claimssync.resellers (
    reseller_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_reseller_id  UUID            REFERENCES claimssync.resellers(reseller_id),
    level               VARCHAR(20)     NOT NULL
                                        CHECK (level IN ('master','sub','individual')),
    name                VARCHAR(200)    NOT NULL,
    short_code          VARCHAR(20)     NOT NULL UNIQUE,
    contact_name        VARCHAR(200),
    contact_email       VARCHAR(255)    NOT NULL,
    contact_phone       VARCHAR(30),
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),
    commission_pct      NUMERIC(5,2)    NOT NULL DEFAULT 0.00,
    agreement_signed_at DATE,
    agreement_ref       VARCHAR(100),
    authorized_providers VARCHAR(30)[]  NOT NULL DEFAULT ARRAY['SHAFAFIYA'],
    max_tenants         INTEGER,
    max_facilities      INTEGER,
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','active','suspended','terminated')),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.resellers              IS '3-level reseller hierarchy: master→sub→individual. NULL parent = direct Kaaryaa partner.';
COMMENT ON COLUMN claimssync.resellers.commission_pct IS 'Revenue share % paid to reseller per facility billing cycle';

CREATE OR REPLACE FUNCTION claimssync.check_reseller_hierarchy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    parent_level VARCHAR(20);
BEGIN
    IF NEW.level = 'master' AND NEW.parent_reseller_id IS NOT NULL THEN
        RAISE EXCEPTION 'Master reseller must have no parent';
    END IF;
    IF NEW.level IN ('sub','individual') AND NEW.parent_reseller_id IS NULL THEN
        RAISE EXCEPTION '% reseller must have a parent', NEW.level;
    END IF;
    IF NEW.level = 'sub' THEN
        SELECT level INTO parent_level FROM claimssync.resellers WHERE reseller_id = NEW.parent_reseller_id;
        IF parent_level <> 'master' THEN
            RAISE EXCEPTION 'Sub-reseller parent must be master, got: %', parent_level;
        END IF;
    END IF;
    IF NEW.level = 'individual' THEN
        SELECT level INTO parent_level FROM claimssync.resellers WHERE reseller_id = NEW.parent_reseller_id;
        IF parent_level NOT IN ('sub','master') THEN
            RAISE EXCEPTION 'Individual parent must be sub or master, got: %', parent_level;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resellers_hierarchy
    BEFORE INSERT OR UPDATE ON claimssync.resellers
    FOR EACH ROW EXECUTE FUNCTION claimssync.check_reseller_hierarchy();

CREATE TRIGGER trg_resellers_updated_at
    BEFORE UPDATE ON claimssync.resellers
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_resellers_parent ON claimssync.resellers(parent_reseller_id);
CREATE INDEX idx_resellers_level  ON claimssync.resellers(level);

INSERT INTO claimssync.resellers (
    level, name, short_code,
    contact_name, contact_email, country, emirate,
    commission_pct, status, authorized_providers, notes
) VALUES (
    'master', 'Saleem Channel Partner', 'SALEEM-UAE',
    'Saleem', 'saleem@placeholder.ae',
    'UAE', 'Abu Dhabi',
    20.00, 'active', ARRAY['SHAFAFIYA'],
    'First master reseller. On-site operator for MF2618/PF2576. Agreement to be formalized P4-T04.'
);


-- =============================================================================
-- 3. TENANTS
-- =============================================================================
CREATE TABLE claimssync.tenants (
    tenant_id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id         UUID            REFERENCES claimssync.resellers(reseller_id),
    name                VARCHAR(200)    NOT NULL,
    short_code          VARCHAR(20)     NOT NULL UNIQUE,
    legal_name          VARCHAR(300),
    contact_name        VARCHAR(200),
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(30),
    timezone            VARCHAR(50)     NOT NULL DEFAULT 'Asia/Dubai',
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),
    is_multi_sp_enabled BOOLEAN         NOT NULL DEFAULT FALSE,
    -- v3-FIX-1: replaced gen_random_bytes(32) with uuid-based hex (no pgcrypto needed)
    api_key             VARCHAR(64)     NOT NULL UNIQUE
                                        DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    status              VARCHAR(20)     NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','suspended','cancelled')),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.tenants                    IS 'Top-level ClaimSync customer. Brought in by reseller or Kaaryaa direct.';
COMMENT ON COLUMN claimssync.tenants.reseller_id        IS 'NULL = Kaaryaa direct sale (no commission)';
COMMENT ON COLUMN claimssync.tenants.is_multi_sp_enabled IS 'Phase 3 flag: when TRUE, facilities may span multiple service providers';
COMMENT ON COLUMN claimssync.tenants.api_key            IS 'Bearer token for Phase 3 dashboard API. 64-char hex, no pgcrypto needed.';

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON claimssync.tenants
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_tenants_reseller ON claimssync.tenants(reseller_id);

INSERT INTO claimssync.tenants (
    reseller_id, name, short_code, legal_name,
    contact_name, contact_email,
    country, emirate, is_multi_sp_enabled, status, notes
) VALUES (
    (SELECT reseller_id FROM claimssync.resellers WHERE short_code = 'SALEEM-UAE'),
    'Kaaryaa Test Facility Group', 'KAARYAA-T1',
    'Kaaryaa GenAI Solutions LLC',
    'Anbu', 'anbu@kaaryaa.com',
    'UAE', 'Abu Dhabi', FALSE, 'active',
    'Phase 1 seed tenant. Holds MF2618 and PF2576. Validated 12-Mar-2026.'
);


-- =============================================================================
-- 4. TENANT_FACILITIES
-- =============================================================================
CREATE TABLE claimssync.tenant_facilities (
    facility_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID            NOT NULL REFERENCES claimssync.tenants(tenant_id) ON DELETE CASCADE,
    service_provider_id     UUID            NOT NULL REFERENCES claimssync.service_providers(provider_id),
    facility_code           VARCHAR(20)     NOT NULL,
    facility_name           VARCHAR(200),
    payer_id                VARCHAR(50),
    local_base_path         VARCHAR(500),
    claims_subfolder        VARCHAR(100)    DEFAULT 'claims',
    resubmission_subfolder  VARCHAR(100)    DEFAULT 'resubmission',
    remittance_subfolder    VARCHAR(100)    DEFAULT 'remittance',
    blob_container          VARCHAR(100),
    lookback_days           INTEGER         NOT NULL DEFAULT 90,
    interval_hours          INTEGER         NOT NULL DEFAULT 2,
    api_sleep_seconds       INTEGER         NOT NULL DEFAULT 3,
    min_free_disk_mb        INTEGER         NOT NULL DEFAULT 50,
    kv_secret_prefix        VARCHAR(100),
    status                  VARCHAR(20)     NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active','inactive','suspended')),
    notes                   TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, facility_code)
);

COMMENT ON TABLE  claimssync.tenant_facilities                     IS 'One facility per row. Maps to legacy [client-config-N]. Credentials in Key Vault only.';
COMMENT ON COLUMN claimssync.tenant_facilities.api_sleep_seconds   IS 'Courtesy rate-limit sleep — DO NOT remove (design principle)';
COMMENT ON COLUMN claimssync.tenant_facilities.interval_hours      IS 'v8b: 2-hr windows bypass Shafafiya 1000-file cap';
COMMENT ON COLUMN claimssync.tenant_facilities.kv_secret_prefix    IS 'KV prefix e.g. facility-mf2618 → facility-mf2618-userid, -password, -caller-license';

CREATE TRIGGER trg_facilities_updated_at
    BEFORE UPDATE ON claimssync.tenant_facilities
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_facilities_tenant   ON claimssync.tenant_facilities(tenant_id);
CREATE INDEX idx_facilities_provider ON claimssync.tenant_facilities(service_provider_id);
CREATE INDEX idx_facilities_code     ON claimssync.tenant_facilities(facility_code);

INSERT INTO claimssync.tenant_facilities (
    tenant_id, service_provider_id,
    facility_code, facility_name,
    local_base_path, claims_subfolder, resubmission_subfolder, remittance_subfolder,
    blob_container, lookback_days, interval_hours, api_sleep_seconds, min_free_disk_mb,
    kv_secret_prefix, status, notes
) VALUES
(
    (SELECT tenant_id FROM claimssync.tenants WHERE short_code = 'KAARYAA-T1'),
    (SELECT provider_id FROM claimssync.service_providers WHERE code = 'SHAFAFIYA'),
    'MF2618', 'Mediclinic — Facility MF2618',
    'C:\Users\USER\Documents\MF2618', 'claims', 'resubmission', 'remittance',
    'claimssync-mf2618', 90, 2, 3, 50,
    'facility-mf2618', 'active',
    'Primary facility. Saleem on-prem. Production since Sep 2024. Phase 0 validated 12-Mar-2026.'
),
(
    (SELECT tenant_id FROM claimssync.tenants WHERE short_code = 'KAARYAA-T1'),
    (SELECT provider_id FROM claimssync.service_providers WHERE code = 'SHAFAFIYA'),
    'PF2576', 'Facility PF2576',
    'C:\Users\USER\Documents\PF2576', 'claims', 'resubmission', 'remittance',
    'claimssync-pf2576', 90, 2, 3, 50,
    'facility-pf2576', 'active',
    'Secondary facility. Deferred — KV secrets and Blob container not yet created.'
);


-- =============================================================================
-- 5. SUBSCRIPTION_PLANS
-- =============================================================================
CREATE TABLE claimssync.subscription_plans (
    plan_id                         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    service_provider_id             UUID            REFERENCES claimssync.service_providers(provider_id),
    code                            VARCHAR(30)     NOT NULL UNIQUE,
    name                            VARCHAR(100)    NOT NULL,
    description                     TEXT,
    price_aed_per_facility_month    NUMERIC(10,2)   NOT NULL,
    trial_days                      INTEGER         NOT NULL DEFAULT 30,
    min_facilities                  INTEGER         NOT NULL DEFAULT 1,
    max_facilities                  INTEGER,
    features                        JSONB           NOT NULL DEFAULT '{}',
    is_active                       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.subscription_plans                        IS 'Per-facility-per-month plan catalogue.';
COMMENT ON COLUMN claimssync.subscription_plans.price_aed_per_facility_month IS 'AED billed per active facility per calendar month';

CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON claimssync.subscription_plans
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

INSERT INTO claimssync.subscription_plans (
    service_provider_id, code, name, description,
    price_aed_per_facility_month, trial_days,
    min_facilities, max_facilities, features, is_active
) VALUES
(
    NULL, 'STARTER', 'Starter', 'Single facility, email support, 90-day history sync',
    499.00, 30, 1, 5,
    '{"history_days": 90, "support_level": "email", "dashboard_access": true, "api_access": false, "white_label": false}',
    TRUE
),
(
    NULL, 'PRO', 'Pro', 'Multi-facility, priority support, 180-day history, API access',
    999.00, 30, 1, NULL,
    '{"history_days": 180, "support_level": "priority_email", "dashboard_access": true, "api_access": true, "white_label": false}',
    TRUE
),
(
    NULL, 'ENTERPRISE', 'Enterprise', 'Unlimited facilities, SLA, white-label, dedicated support',
    0.00, 30, 1, NULL,
    '{"history_days": 365, "support_level": "sla", "dashboard_access": true, "api_access": true, "white_label": true}',
    FALSE
);


-- =============================================================================
-- 6. FACILITY_SUBSCRIPTIONS
-- =============================================================================
CREATE TABLE claimssync.facility_subscriptions (
    subscription_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID            NOT NULL REFERENCES claimssync.tenant_facilities(facility_id) ON DELETE CASCADE,
    plan_id             UUID            NOT NULL REFERENCES claimssync.subscription_plans(plan_id),
    trial_until         DATE,
    valid_from          DATE            NOT NULL DEFAULT CURRENT_DATE,
    valid_until         DATE,
    price_override_aed  NUMERIC(10,2),
    billing_cycle       VARCHAR(20)     NOT NULL DEFAULT 'monthly'
                                        CHECK (billing_cycle IN ('monthly','annual','custom')),
    payment_ref         VARCHAR(200),
    status              VARCHAR(20)     NOT NULL DEFAULT 'trial'
                                        CHECK (status IN ('trial','active','overdue','suspended','cancelled')),
    approved_by         VARCHAR(200),
    approved_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.facility_subscriptions             IS 'Active plan per facility — controls trial period, validity, billing.';
COMMENT ON COLUMN claimssync.facility_subscriptions.trial_until IS 'Set by Kaaryaa admin on onboarding approval.';

CREATE UNIQUE INDEX idx_facility_sub_one_active
    ON claimssync.facility_subscriptions(facility_id)
    WHERE status IN ('trial','active');

CREATE TRIGGER trg_facility_subs_updated_at
    BEFORE UPDATE ON claimssync.facility_subscriptions
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_facility_subs_facility ON claimssync.facility_subscriptions(facility_id);
CREATE INDEX idx_facility_subs_status   ON claimssync.facility_subscriptions(status);

INSERT INTO claimssync.facility_subscriptions (
    facility_id, plan_id, trial_until, valid_from,
    billing_cycle, status, approved_by, approved_at, notes
)
SELECT
    f.facility_id,
    (SELECT plan_id FROM claimssync.subscription_plans WHERE code = 'STARTER'),
    CURRENT_DATE + INTERVAL '30 days',
    CURRENT_DATE,
    'monthly', 'trial',
    'Anbu (Kaaryaa Admin)', NOW(),
    'Phase 1 seed — production facilities on ClaimSync SaaS trial'
FROM claimssync.tenant_facilities f
WHERE f.facility_code IN ('MF2618', 'PF2576');


-- =============================================================================
-- 7. ONBOARDING_REQUESTS
-- =============================================================================
CREATE TABLE claimssync.onboarding_requests (
    request_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id         UUID            NOT NULL REFERENCES claimssync.resellers(reseller_id),
    service_provider_id UUID            NOT NULL REFERENCES claimssync.service_providers(provider_id),
    tenant_name         VARCHAR(200)    NOT NULL,
    tenant_short_code   VARCHAR(20)     NOT NULL,
    tenant_emirate      VARCHAR(50),
    tenant_country      VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    contact_name        VARCHAR(200)    NOT NULL,
    contact_email       VARCHAR(255)    NOT NULL,
    contact_phone       VARCHAR(30),
    proposed_facilities JSONB           NOT NULL DEFAULT '[]',
    requested_plan_code VARCHAR(30),
    status              VARCHAR(20)     NOT NULL DEFAULT 'draft'
                                        CHECK (status IN ('draft','submitted','reviewing','approved','rejected','cancelled')),
    submitted_at        TIMESTAMPTZ,
    reseller_notes      TEXT,
    reviewed_by         VARCHAR(200),
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,
    approved_at         TIMESTAMPTZ,
    trial_days_granted  INTEGER         NOT NULL DEFAULT 30,
    tenant_id           UUID            REFERENCES claimssync.tenants(tenant_id),
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.onboarding_requests IS 'Reseller submits → Kaaryaa reviews → approves/rejects. Sole approver: Kaaryaa admin.';

CREATE OR REPLACE FUNCTION claimssync.check_onboarding_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at = NOW(); END IF;
    IF NEW.status IN ('reviewing','approved','rejected') AND NEW.reviewed_at IS NULL THEN NEW.reviewed_at = NOW(); END IF;
    IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN NEW.approved_at = NOW(); END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_onboarding_transition
    BEFORE UPDATE ON claimssync.onboarding_requests
    FOR EACH ROW EXECUTE FUNCTION claimssync.check_onboarding_transition();

CREATE TRIGGER trg_onboarding_updated_at
    BEFORE UPDATE ON claimssync.onboarding_requests
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_onboarding_reseller ON claimssync.onboarding_requests(reseller_id);
CREATE INDEX idx_onboarding_status   ON claimssync.onboarding_requests(status);
CREATE INDEX idx_onboarding_tenant   ON claimssync.onboarding_requests(tenant_id);


-- =============================================================================
-- 8. SYNC_SCHEDULES
-- =============================================================================
CREATE TABLE claimssync.sync_schedules (
    schedule_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id             UUID        NOT NULL REFERENCES claimssync.tenant_facilities(facility_id) ON DELETE CASCADE,
    cron_expression         VARCHAR(100) NOT NULL DEFAULT '0 6 * * *',
    timezone                VARCHAR(50) NOT NULL DEFAULT 'Asia/Dubai',
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    lookback_override_days  INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE claimssync.sync_schedules IS 'Cron schedules per facility — replaces Windows Task Scheduler in Phase 2.';

CREATE UNIQUE INDEX idx_schedules_one_active
    ON claimssync.sync_schedules(facility_id)
    WHERE is_active = TRUE;

CREATE TRIGGER trg_schedules_updated_at
    BEFORE UPDATE ON claimssync.sync_schedules
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();


-- =============================================================================
-- 9. SYNC_RUN_LOG
-- =============================================================================
CREATE TABLE claimssync.sync_run_log (
    run_id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id             UUID        NOT NULL REFERENCES claimssync.tenant_facilities(facility_id),
    schedule_id             UUID        REFERENCES claimssync.sync_schedules(schedule_id),
    trigger_type            VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                                        CHECK (trigger_type IN ('scheduled','manual','api')),
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at                TIMESTAMPTZ,
    duration_seconds        INTEGER GENERATED ALWAYS AS (
                                EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
                            ) STORED,
    search_from_date        DATE        NOT NULL,
    search_to_date          DATE        NOT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'running'
                                        CHECK (status IN ('running','success','partial','failed')),
    error_message           TEXT,
    intervals_total         INTEGER     NOT NULL DEFAULT 0,
    intervals_completed     INTEGER     NOT NULL DEFAULT 0,
    intervals_skipped       INTEGER     NOT NULL DEFAULT 0,
    files_found             INTEGER     NOT NULL DEFAULT 0,
    files_downloaded        INTEGER     NOT NULL DEFAULT 0,
    files_skipped_existing  INTEGER     NOT NULL DEFAULT 0,
    files_skipped_api_error INTEGER     NOT NULL DEFAULT 0,
    files_resubmission      INTEGER     NOT NULL DEFAULT 0,
    files_remittance        INTEGER     NOT NULL DEFAULT 0,
    engine_version          VARCHAR(20),
    host_name               VARCHAR(100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.sync_run_log               IS 'One row per sync run. Replaces downloadlog-*.csv written by legacy engine.';
COMMENT ON COLUMN claimssync.sync_run_log.host_name     IS 'DESKTOP-OEUQ9BU for Saleem on-prem; Azure container ID in Phase 2';
COMMENT ON COLUMN claimssync.sync_run_log.files_resubmission IS 'Track high resubmission rates (>80% flagged in Jun-Jul 2025 run)';

CREATE INDEX idx_run_log_facility ON claimssync.sync_run_log(facility_id);
CREATE INDEX idx_run_log_started  ON claimssync.sync_run_log(started_at DESC);
CREATE INDEX idx_run_log_status   ON claimssync.sync_run_log(status);


-- =============================================================================
-- 10. SYNC_RUN_INTERVALS
-- =============================================================================
CREATE TABLE claimssync.sync_run_intervals (
    interval_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID        NOT NULL REFERENCES claimssync.sync_run_log(run_id) ON DELETE CASCADE,
    interval_index      INTEGER     NOT NULL,
    interval_from       TIMESTAMPTZ NOT NULL,
    interval_to         TIMESTAMPTZ NOT NULL,
    api_called_at       TIMESTAMPTZ,
    api_result_code     VARCHAR(10),
    api_error_message   TEXT,
    api_response_file   VARCHAR(500),
    files_in_response   INTEGER     NOT NULL DEFAULT 0,
    files_downloaded    INTEGER     NOT NULL DEFAULT 0,
    files_skipped       INTEGER     NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','success','skipped','error')),
    duration_ms         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.sync_run_intervals             IS '2-hour interval audit. One row per interval per run (v8b architecture).';
COMMENT ON COLUMN claimssync.sync_run_intervals.api_result_code IS 'Shafafiya codes: 0=OK, -6=file not found, others TBD';

CREATE INDEX idx_intervals_run_id ON claimssync.sync_run_intervals(run_id);
CREATE INDEX idx_intervals_from   ON claimssync.sync_run_intervals(interval_from);


-- =============================================================================
-- 11. FILE_MANIFEST
-- =============================================================================
CREATE TABLE claimssync.file_manifest (
    manifest_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID        NOT NULL REFERENCES claimssync.tenant_facilities(facility_id),
    run_id              UUID        NOT NULL REFERENCES claimssync.sync_run_log(run_id),
    interval_id         UUID        REFERENCES claimssync.sync_run_intervals(interval_id),
    file_name           VARCHAR(500) NOT NULL,
    file_type           VARCHAR(20) NOT NULL DEFAULT 'claims'
                                    CHECK (file_type IN ('claims','resubmission','remittance','unknown')),
    file_size_bytes     BIGINT,
    shafafiya_txn_id    VARCHAR(100),
    local_path          VARCHAR(1000),
    blob_url            VARCHAR(2000),
    is_archived         BOOLEAN     NOT NULL DEFAULT FALSE,
    archived_path       VARCHAR(1000),
    is_duplicate        BOOLEAN     NOT NULL DEFAULT FALSE,
    first_seen_run_id   UUID        REFERENCES claimssync.sync_run_log(run_id),
    downloaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  claimssync.file_manifest              IS 'Per-file dedup + audit. Replaces os.path.exists() check in legacy engine.';
COMMENT ON COLUMN claimssync.file_manifest.is_duplicate IS 'TRUE if file_name already exists for this facility from a prior run';
COMMENT ON COLUMN claimssync.file_manifest.blob_url     IS 'Populated in Phase 2 when Blob StorageProvider is active';

CREATE INDEX idx_manifest_facility   ON claimssync.file_manifest(facility_id);
CREATE INDEX idx_manifest_run        ON claimssync.file_manifest(run_id);
CREATE INDEX idx_manifest_filename   ON claimssync.file_manifest(facility_id, file_name);
CREATE INDEX idx_manifest_downloaded ON claimssync.file_manifest(downloaded_at DESC);


-- =============================================================================
-- VERIFICATION QUERY — run after applying to confirm all 11 tables created
-- =============================================================================
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c
     WHERE c.table_schema = 'claimssync' AND c.table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'claimssync'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- =============================================================================
-- GRANTS (uncomment after creating app service principal in P1-T11)
-- =============================================================================
-- GRANT CONNECT ON DATABASE postgres TO claimssync_app;
-- GRANT USAGE  ON SCHEMA claimssync TO claimssync_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA claimssync TO claimssync_app;

-- =============================================================================
-- END OF SCHEMA DDL v3
-- claimssync_schema_v3.sql | Kaaryaa GenAI Solutions | March 2026
-- =============================================================================
