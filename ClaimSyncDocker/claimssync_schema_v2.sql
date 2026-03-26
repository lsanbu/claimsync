-- =============================================================================
-- ClaimSync — PostgreSQL Schema DDL  (v2 — Scalable Multi-SP / Reseller)
-- =============================================================================
-- Project      : ClaimSync (Kaaryaa GenAI Solutions)
-- Phase        : Phase 1 — P1-T04 (revised)
-- Target DB    : claimssync-db (Azure PostgreSQL Flexible Server, UAE North)
-- PostgreSQL   : 16
-- Author       : Anbu / Kaaryaa GenAI Solutions
-- Date         : March 2026
--
-- Architecture Decisions (ADR-001):
--   1. Multi-SP       : service_provider_id on tenant_facilities from day one.
--                       Gated by tenant.is_multi_sp_enabled (Phase 3 activation).
--   2. Reseller       : 3-level hierarchy (master → sub → individual).
--                       Self-referential with enforced depth via level enum.
--   3. Pricing        : Per facility per month. Catalogue in subscription_plans.
--                       Active plan tracked in facility_subscriptions.
--   4. Onboarding     : State machine (draft→submitted→reviewing→approved/rejected).
--                       Kaaryaa admin is sole approver.
--   5. ADHICS v2      : PII columns annotated. Credentials in Key Vault only.
--                       Data residency: UAE North. Schema never stores passwords.
--
-- Tables (11):
--   Infrastructure
--     1.  service_providers       — Shafafiya, DHA, HAAD, future GCC
--     2.  resellers               — 3-level hierarchy, self-referential
--   Core Business
--     3.  tenants                 — clinic group / hospital / TPA
--     4.  tenant_facilities       — facility per tenant + service_provider link
--   Commercial
--     5.  subscription_plans      — plan catalogue (Starter / Pro / Enterprise)
--     6.  facility_subscriptions  — active plan per facility, trial/validity dates
--   Workflow
--     7.  onboarding_requests     — full reseller→Kaaryaa approval workflow
--   Sync Engine
--     8.  sync_schedules          — cron per facility
--     9.  sync_run_log            — one row per run
--     10. sync_run_intervals      — one row per 2-hr interval within a run
--     11. file_manifest           — per-file dedup + audit trail
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema + Search Path
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS claimssync;
SET search_path TO claimssync, public;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

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

-- ---------------------------------------------------------------------------
-- Helper macro (comment only — apply to each table below)
-- CREATE TRIGGER trg_<table>_updated_at
--     BEFORE UPDATE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();
-- ---------------------------------------------------------------------------


-- =============================================================================
-- 1. SERVICE_PROVIDERS
--    Represents each DOH / regulatory authority API endpoint.
--    Current: Shafafiya (Abu Dhabi DOH)
--    Planned: DHA (Dubai Health Authority), HAAD legacy, MOH (federal),
--             Saudi CCHI, Bahrain NHRA (GCC expansion)
-- =============================================================================
CREATE TABLE service_providers (
    provider_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(30)     NOT NULL UNIQUE,   -- 'SHAFAFIYA', 'DHA', 'HAAD', 'MOH'
    name                VARCHAR(200)    NOT NULL,          -- 'Abu Dhabi DOH — Shafafiya'
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),                       -- 'Abu Dhabi', 'Dubai', NULL for federal
    region              VARCHAR(50)     NOT NULL DEFAULT 'UAE North',

    -- API connectivity
    api_base_url        VARCHAR(500)    NOT NULL,
    api_spec_version    VARCHAR(20),                       -- e.g. 'v1', 'v2', 'SOAP-2024'
    api_protocol        VARCHAR(20)     NOT NULL DEFAULT 'SOAP'
                                        CHECK (api_protocol IN ('SOAP','REST','FHIR')),
    wsdl_url            VARCHAR(500),                      -- for SOAP providers
    timeout_connect_s   INTEGER         NOT NULL DEFAULT 60,
    timeout_read_s      INTEGER         NOT NULL DEFAULT 120,
    rate_limit_sleep_s  INTEGER         NOT NULL DEFAULT 3,    -- courtesy sleep between calls
    max_files_per_call  INTEGER         NOT NULL DEFAULT 1000, -- Shafafiya cap = 1000

    -- Auth model hint (actual creds in Key Vault per facility)
    auth_model          VARCHAR(30)     NOT NULL DEFAULT 'per_facility_credentials'
                                        CHECK (auth_model IN ('per_facility_credentials','oauth2','api_key')),

    -- Status
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    is_live             BOOLEAN         NOT NULL DEFAULT FALSE,  -- FALSE = designed, not yet integrated
    notes               TEXT,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  service_providers                  IS 'DOH / regulatory API providers: Shafafiya, DHA, HAAD, GCC expansion';
COMMENT ON COLUMN service_providers.is_live          IS 'FALSE = schema supports it but engine integration not yet built (Phase 3+)';
COMMENT ON COLUMN service_providers.rate_limit_sleep_s IS 'Courtesy sleep between interval API calls — per-provider, DO NOT remove';
COMMENT ON COLUMN service_providers.max_files_per_call IS 'Shafafiya silently caps at 1000; engine splits date range into intervals to compensate';

CREATE TRIGGER trg_service_providers_updated_at
    BEFORE UPDATE ON service_providers
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

-- Seed: Shafafiya (the only live provider at Phase 1)
INSERT INTO service_providers (
    code, name, country, emirate, region,
    api_base_url, api_spec_version, api_protocol,
    wsdl_url, timeout_connect_s, timeout_read_s,
    rate_limit_sleep_s, max_files_per_call,
    auth_model, is_active, is_live, notes
) VALUES (
    'SHAFAFIYA',
    'Abu Dhabi DOH — Shafafiya',
    'UAE', 'Abu Dhabi', 'UAE North',
    'https://shafafiya.doh.gov.ae/services/',  -- replace with actual endpoint
    'SOAP-2024', 'SOAP',
    'https://shafafiya.doh.gov.ae/services/?wsdl',
    60, 120, 3, 1000,
    'per_facility_credentials',
    TRUE, TRUE,
    'Production since Sep 2024. 1000-file cap per API call handled by 2-hr interval windowing (v8b).'
),
(
    'DHA',
    'Dubai Health Authority — Claims Portal',
    'UAE', 'Dubai', 'UAE North',
    'https://api.dha.gov.ae/claims/',  -- placeholder — verify before Phase 3
    NULL, 'REST',
    NULL, 60, 120, 3, NULL,
    'per_facility_credentials',
    FALSE, FALSE,
    'Phase 3 target. API spec TBD — confirm with DHA before building connector.'
),
(
    'MOH_UAE',
    'UAE Ministry of Health — Federal',
    'UAE', NULL, 'UAE North',
    'https://api.mohap.gov.ae/',  -- placeholder
    NULL, 'REST',
    NULL, 60, 120, 3, NULL,
    'per_facility_credentials',
    FALSE, FALSE,
    'GCC expansion placeholder. Not yet scoped.'
);


-- =============================================================================
-- 2. RESELLERS
--    3-level hierarchy: Master Reseller → Sub-Reseller → Individual
--    Self-referential via parent_reseller_id.
--    Kaaryaa itself is the implicit root (parent_reseller_id IS NULL = Kaaryaa direct).
--
--    Level enforcement:
--      level='master'     → parent_reseller_id IS NULL (reports directly to Kaaryaa)
--      level='sub'        → parent must be a 'master'
--      level='individual' → parent must be a 'sub' or 'master'
-- =============================================================================
CREATE TABLE resellers (
    reseller_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_reseller_id  UUID            REFERENCES resellers(reseller_id),  -- NULL = direct Kaaryaa partner
    level               VARCHAR(20)     NOT NULL
                                        CHECK (level IN ('master','sub','individual')),
    name                VARCHAR(200)    NOT NULL,
    short_code          VARCHAR(20)     NOT NULL UNIQUE,

    -- Contact (ADHICS: PII)
    contact_name        VARCHAR(200),
    contact_email       VARCHAR(255)    NOT NULL,   -- ADHICS PII
    contact_phone       VARCHAR(30),                -- ADHICS PII
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),

    -- Commercial
    commission_pct      NUMERIC(5,2)    NOT NULL DEFAULT 0.00,  -- % of facility revenue
    agreement_signed_at DATE,
    agreement_ref       VARCHAR(100),

    -- Capabilities: which service providers this reseller is authorized to sell
    -- Stored as array of provider codes for simplicity; join to service_providers for details
    authorized_providers VARCHAR(30)[]  NOT NULL DEFAULT ARRAY['SHAFAFIYA'],

    -- Limits
    max_tenants         INTEGER,                    -- NULL = unlimited
    max_facilities      INTEGER,                    -- NULL = unlimited

    status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','active','suspended','terminated')),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  resellers                     IS '3-level reseller hierarchy: master→sub→individual. NULL parent = direct Kaaryaa partner';
COMMENT ON COLUMN resellers.commission_pct      IS 'Revenue share % paid to this reseller on each facility billing cycle';
COMMENT ON COLUMN resellers.authorized_providers IS 'Array of service_providers.code values this reseller can sell';

-- Enforce hierarchy rules
CREATE OR REPLACE FUNCTION claimssync.check_reseller_hierarchy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    parent_level VARCHAR(20);
BEGIN
    -- master must have no parent
    IF NEW.level = 'master' AND NEW.parent_reseller_id IS NOT NULL THEN
        RAISE EXCEPTION 'Master reseller must have no parent (reports directly to Kaaryaa)';
    END IF;

    -- sub and individual must have a parent
    IF NEW.level IN ('sub','individual') AND NEW.parent_reseller_id IS NULL THEN
        RAISE EXCEPTION '% reseller must have a parent reseller', NEW.level;
    END IF;

    -- sub's parent must be master
    IF NEW.level = 'sub' THEN
        SELECT level INTO parent_level FROM claimssync.resellers WHERE reseller_id = NEW.parent_reseller_id;
        IF parent_level <> 'master' THEN
            RAISE EXCEPTION 'Sub-reseller parent must be a master reseller, got: %', parent_level;
        END IF;
    END IF;

    -- individual's parent must be sub or master
    IF NEW.level = 'individual' THEN
        SELECT level INTO parent_level FROM claimssync.resellers WHERE reseller_id = NEW.parent_reseller_id;
        IF parent_level NOT IN ('sub','master') THEN
            RAISE EXCEPTION 'Individual reseller parent must be sub or master, got: %', parent_level;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resellers_hierarchy
    BEFORE INSERT OR UPDATE ON resellers
    FOR EACH ROW EXECUTE FUNCTION claimssync.check_reseller_hierarchy();

CREATE TRIGGER trg_resellers_updated_at
    BEFORE UPDATE ON resellers
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_resellers_parent ON resellers(parent_reseller_id);
CREATE INDEX idx_resellers_level  ON resellers(level);

-- Seed: Saleem as first master reseller
INSERT INTO resellers (
    level, name, short_code,
    contact_name, contact_email, country, emirate,
    commission_pct, status, authorized_providers,
    notes
) VALUES (
    'master', 'Saleem Channel Partner', 'SALEEM-UAE',
    'Saleem', 'saleem@placeholder.ae',   -- update with real email
    'UAE', 'Abu Dhabi',
    20.00, 'active', ARRAY['SHAFAFIYA'],
    'First master reseller. On-site operator for MF2618 and PF2576. Agreement to be formalized in P4-T04.'
);


-- =============================================================================
-- 3. TENANTS
--    Top-level organisation. Each tenant = one Kaaryaa customer.
--    Brought in by a reseller (or Kaaryaa direct if reseller_id IS NULL).
-- =============================================================================
CREATE TABLE tenants (
    tenant_id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id         UUID            REFERENCES resellers(reseller_id),  -- NULL = Kaaryaa direct
    name                VARCHAR(200)    NOT NULL,
    short_code          VARCHAR(20)     NOT NULL UNIQUE,
    legal_name          VARCHAR(300),                      -- for invoicing

    -- ADHICS PII: contact
    contact_name        VARCHAR(200),
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(30),
    timezone            VARCHAR(50)     NOT NULL DEFAULT 'Asia/Dubai',
    country             VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    emirate             VARCHAR(50),

    -- Multi-SP gate: FALSE in Phase 1-2, flipped TRUE per tenant in Phase 3
    -- when they have facilities across >1 service provider
    is_multi_sp_enabled BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Auth
    api_key             VARCHAR(64)     NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),

    status              VARCHAR(20)     NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','suspended','cancelled')),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  tenants                       IS 'Top-level ClaimSync customer. Brought in by a reseller or Kaaryaa direct.';
COMMENT ON COLUMN tenants.reseller_id           IS 'NULL = Kaaryaa direct sale (no reseller commission applies)';
COMMENT ON COLUMN tenants.is_multi_sp_enabled   IS 'Phase 3 flag: when TRUE, facilities may span multiple service providers';
COMMENT ON COLUMN tenants.api_key               IS 'Bearer token for Phase 3 dashboard API';

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_tenants_reseller ON tenants(reseller_id);

-- Seed: Kaaryaa's own tenant (MF2618, PF2576)
INSERT INTO tenants (
    reseller_id, name, short_code, legal_name,
    contact_name, contact_email,
    country, emirate, is_multi_sp_enabled, status, notes
) VALUES (
    (SELECT reseller_id FROM claimssync.resellers WHERE short_code = 'SALEEM-UAE'),
    'Kaaryaa Test Facility Group', 'KAARYAA-T1',
    'Kaaryaa GenAI Solutions LLC',
    'Anbu', 'anbu@kaaryaa.com',
    'UAE', 'Abu Dhabi', FALSE, 'active',
    'Phase 1 seed tenant. Holds MF2618 and PF2576 facilities for Saleem on-prem run.'
);


-- =============================================================================
-- 4. TENANT_FACILITIES
--    One row per DOH-registered facility under a tenant.
--    Maps to legacy [client-config-N] INI blocks.
--    service_provider_id links to the correct API engine.
--    CREDENTIALS NEVER STORED HERE — Key Vault only.
--    KV naming: facility-{facility_id}-userid
--               facility-{facility_id}-password
--               facility-{facility_id}-caller-license
-- =============================================================================
CREATE TABLE tenant_facilities (
    facility_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID            NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    service_provider_id     UUID            NOT NULL REFERENCES service_providers(provider_id),

    -- Identity
    facility_code           VARCHAR(20)     NOT NULL,   -- e.g. 'MF2618', 'PF2576'
    facility_name           VARCHAR(200),
    payer_id                VARCHAR(50),

    -- Local paths (Phase 0/1 on-prem; set to NULL when Blob active in Phase 2)
    local_base_path         VARCHAR(500),
    claims_subfolder        VARCHAR(100)    DEFAULT 'claims',
    resubmission_subfolder  VARCHAR(100)    DEFAULT 'resubmission',
    remittance_subfolder    VARCHAR(100)    DEFAULT 'remittance',

    -- Blob Storage (Phase 2+)
    blob_container          VARCHAR(100),              -- 'claimssync-mf2618'

    -- Sync config (overrides if set, else engine uses service_provider defaults)
    lookback_days           INTEGER         NOT NULL DEFAULT 90,
    interval_hours          INTEGER         NOT NULL DEFAULT 2,    -- 2-hr window (v8b)
    api_sleep_seconds       INTEGER         NOT NULL DEFAULT 3,    -- DO NOT remove — rate-limit courtesy
    min_free_disk_mb        INTEGER         NOT NULL DEFAULT 50,

    -- Key Vault reference (secret name prefix, not the secret itself)
    kv_secret_prefix        VARCHAR(100),  -- e.g. 'facility-mf2618'

    status                  VARCHAR(20)     NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active','inactive','suspended')),
    notes                   TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, facility_code)
);

COMMENT ON TABLE  tenant_facilities                      IS 'One facility per row. Maps to legacy [client-config-N]. Credentials in Key Vault only.';
COMMENT ON COLUMN tenant_facilities.service_provider_id  IS 'Links to service_providers: Shafafiya for Abu Dhabi, DHA for Dubai etc.';
COMMENT ON COLUMN tenant_facilities.api_sleep_seconds    IS 'Intentional courtesy rate-limit sleep — DO NOT remove (design principle)';
COMMENT ON COLUMN tenant_facilities.interval_hours       IS 'v8b design: 2-hr windows bypass Shafafiya 1000-file cap per call';
COMMENT ON COLUMN tenant_facilities.local_base_path      IS 'Phase 0/1 only. Set NULL once Blob StorageProvider active in Phase 2.';
COMMENT ON COLUMN tenant_facilities.kv_secret_prefix     IS 'Key Vault secret prefix e.g. facility-mf2618 → facility-mf2618-userid, -password, -caller-license';

CREATE TRIGGER trg_facilities_updated_at
    BEFORE UPDATE ON tenant_facilities
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_facilities_tenant   ON tenant_facilities(tenant_id);
CREATE INDEX idx_facilities_provider ON tenant_facilities(service_provider_id);
CREATE INDEX idx_facilities_code     ON tenant_facilities(facility_code);

-- Seed: MF2618 and PF2576
INSERT INTO tenant_facilities (
    tenant_id, service_provider_id,
    facility_code, facility_name,
    local_base_path,
    claims_subfolder, resubmission_subfolder, remittance_subfolder,
    blob_container,
    lookback_days, interval_hours, api_sleep_seconds, min_free_disk_mb,
    kv_secret_prefix, status, notes
) VALUES
(
    (SELECT tenant_id FROM claimssync.tenants WHERE short_code = 'KAARYAA-T1'),
    (SELECT provider_id FROM claimssync.service_providers WHERE code = 'SHAFAFIYA'),
    'MF2618', 'Mediclinic — Facility MF2618',
    'C:\Users\USER\Documents\MF2618',
    'claims', 'resubmission', 'remittance',
    'claimssync-mf2618',
    90, 2, 3, 50,
    'facility-mf2618', 'active',
    'Primary facility. Saleem on-prem. Production since Sep 2024. Phase 0 validated 12-Mar-2026.'
),
(
    (SELECT tenant_id FROM claimssync.tenants WHERE short_code = 'KAARYAA-T1'),
    (SELECT provider_id FROM claimssync.service_providers WHERE code = 'SHAFAFIYA'),
    'PF2576', 'Facility PF2576',
    'C:\Users\USER\Documents\PF2576',
    'claims', 'resubmission', 'remittance',
    'claimssync-pf2576',
    90, 2, 3, 50,
    'facility-pf2576', 'active',
    'Secondary facility. Saleem on-prem. Parallel verification run with MF2618.'
);


-- =============================================================================
-- 5. SUBSCRIPTION_PLANS
--    Plan catalogue. Per-facility-per-month pricing model.
--    Linked to a specific service_provider (pricing may differ by region/authority).
--    NULL service_provider_id = applies to all providers.
-- =============================================================================
CREATE TABLE subscription_plans (
    plan_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    service_provider_id UUID            REFERENCES service_providers(provider_id),  -- NULL = universal
    code                VARCHAR(30)     NOT NULL UNIQUE,   -- 'STARTER', 'PRO', 'ENTERPRISE'
    name                VARCHAR(100)    NOT NULL,
    description         TEXT,

    -- Pricing
    price_aed_per_facility_month  NUMERIC(10,2) NOT NULL,
    trial_days          INTEGER         NOT NULL DEFAULT 30,
    min_facilities      INTEGER         NOT NULL DEFAULT 1,
    max_facilities      INTEGER,                           -- NULL = unlimited

    -- Features
    features            JSONB           NOT NULL DEFAULT '{}',
    -- Example:
    -- {
    --   "history_days": 90,
    --   "support_level": "email",
    --   "dashboard_access": true,
    --   "api_access": false,
    --   "white_label": false
    -- }

    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  subscription_plans                           IS 'Per-facility-per-month plan catalogue. NULL provider = universal plan.';
COMMENT ON COLUMN subscription_plans.price_aed_per_facility_month IS 'AED amount billed per active facility per calendar month';
COMMENT ON COLUMN subscription_plans.features                  IS 'JSONB feature flags — extensible without schema change';

CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

-- Seed: current pricing model
INSERT INTO subscription_plans (
    service_provider_id, code, name, description,
    price_aed_per_facility_month, trial_days,
    min_facilities, max_facilities, features, is_active
) VALUES
(
    NULL,  -- universal
    'STARTER', 'Starter', 'Single facility, email support, 90-day history sync',
    499.00, 30, 1, 5,
    '{"history_days": 90, "support_level": "email", "dashboard_access": true, "api_access": false, "white_label": false}',
    TRUE
),
(
    NULL,
    'PRO', 'Pro', 'Multi-facility, priority support, 180-day history, API access',
    999.00, 30, 1, NULL,
    '{"history_days": 180, "support_level": "priority_email", "dashboard_access": true, "api_access": true, "white_label": false}',
    TRUE
),
(
    NULL,
    'ENTERPRISE', 'Enterprise', 'Unlimited facilities, SLA, white-label, dedicated support',
    0.00,  -- custom pricing — override in facility_subscriptions
    30, 1, NULL,
    '{"history_days": 365, "support_level": "sla", "dashboard_access": true, "api_access": true, "white_label": true}',
    FALSE  -- not yet active — enable before Phase 4
);


-- =============================================================================
-- 6. FACILITY_SUBSCRIPTIONS
--    Active subscription per facility.
--    Tracks trial period, validity dates, billing status.
--    One active subscription per facility (enforced by partial unique index).
-- =============================================================================
CREATE TABLE facility_subscriptions (
    subscription_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID            NOT NULL REFERENCES tenant_facilities(facility_id) ON DELETE CASCADE,
    plan_id             UUID            NOT NULL REFERENCES subscription_plans(plan_id),

    -- Validity
    trial_until         DATE,                          -- NULL = not on trial
    valid_from          DATE            NOT NULL DEFAULT CURRENT_DATE,
    valid_until         DATE,                          -- NULL = rolling monthly

    -- Billing
    price_override_aed  NUMERIC(10,2),                 -- NULL = use plan price
    billing_cycle       VARCHAR(20)     NOT NULL DEFAULT 'monthly'
                                        CHECK (billing_cycle IN ('monthly','annual','custom')),
    payment_ref         VARCHAR(200),                  -- invoice / payment gateway ref

    -- Status
    status              VARCHAR(20)     NOT NULL DEFAULT 'trial'
                                        CHECK (status IN ('trial','active','overdue','suspended','cancelled')),

    -- Audit
    approved_by         VARCHAR(200),                  -- Kaaryaa admin who approved
    approved_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  facility_subscriptions               IS 'Active plan per facility. Controls trial period, validity, billing.';
COMMENT ON COLUMN facility_subscriptions.trial_until   IS 'Set by Kaaryaa admin on onboarding approval. NULL = not on trial.';
COMMENT ON COLUMN facility_subscriptions.price_override_aed IS 'Kaaryaa can override plan price for negotiated deals (Enterprise etc.)';
COMMENT ON COLUMN facility_subscriptions.approved_by   IS 'Kaaryaa admin name/email who approved this subscription';

-- One active subscription per facility
CREATE UNIQUE INDEX idx_facility_sub_one_active
    ON facility_subscriptions(facility_id)
    WHERE status IN ('trial','active');

CREATE TRIGGER trg_facility_subs_updated_at
    BEFORE UPDATE ON facility_subscriptions
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_facility_subs_facility ON facility_subscriptions(facility_id);
CREATE INDEX idx_facility_subs_status   ON facility_subscriptions(status);
CREATE INDEX idx_facility_subs_valid    ON facility_subscriptions(valid_until);

-- Seed: MF2618 and PF2576 on Starter trial
INSERT INTO facility_subscriptions (
    facility_id, plan_id,
    trial_until, valid_from, valid_until,
    billing_cycle, status, approved_by, approved_at, notes
)
SELECT
    f.facility_id,
    (SELECT plan_id FROM claimssync.subscription_plans WHERE code = 'STARTER'),
    CURRENT_DATE + INTERVAL '30 days',
    CURRENT_DATE, NULL,
    'monthly', 'trial',
    'Anbu (Kaaryaa Admin)', NOW(),
    'Phase 1 seed — production facilities migrated to ClaimSync SaaS trial'
FROM claimssync.tenant_facilities f
WHERE f.facility_code IN ('MF2618', 'PF2576');


-- =============================================================================
-- 7. ONBOARDING_REQUESTS
--    Full reseller→Kaaryaa approval workflow.
--    State machine:
--      draft → submitted → reviewing → approved
--                                    → rejected
--                       → cancelled (reseller withdraws before approval)
--
--    On approval: Kaaryaa admin manually creates tenant + facility + subscription.
--    Phase 3: automate tenant/facility creation on approval event.
-- =============================================================================
CREATE TABLE onboarding_requests (
    request_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id         UUID            NOT NULL REFERENCES resellers(reseller_id),
    service_provider_id UUID            NOT NULL REFERENCES service_providers(provider_id),

    -- Proposed tenant details
    tenant_name         VARCHAR(200)    NOT NULL,
    tenant_short_code   VARCHAR(20)     NOT NULL,
    tenant_emirate      VARCHAR(50),
    tenant_country      VARCHAR(10)     NOT NULL DEFAULT 'UAE',

    -- ADHICS PII: proposed contact
    contact_name        VARCHAR(200)    NOT NULL,
    contact_email       VARCHAR(255)    NOT NULL,
    contact_phone       VARCHAR(30),

    -- Proposed facilities (JSONB array — reseller fills in during onboarding)
    -- Schema per entry:
    -- { "facility_code": "MF2618", "facility_name": "...", "payer_id": "...",
    --   "plan_code": "STARTER", "lookback_days": 90 }
    proposed_facilities JSONB           NOT NULL DEFAULT '[]',

    -- Requested plan
    requested_plan_code VARCHAR(30),

    -- Workflow state
    status              VARCHAR(20)     NOT NULL DEFAULT 'draft'
                                        CHECK (status IN ('draft','submitted','reviewing','approved','rejected','cancelled')),

    -- Reseller submission
    submitted_at        TIMESTAMPTZ,
    reseller_notes      TEXT,

    -- Kaaryaa review
    reviewed_by         VARCHAR(200),   -- Kaaryaa admin name/email
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,

    -- Approval output
    approved_at         TIMESTAMPTZ,
    trial_days_granted  INTEGER         NOT NULL DEFAULT 30,
    tenant_id           UUID            REFERENCES tenants(tenant_id),  -- set on approval
    rejection_reason    TEXT,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  onboarding_requests                    IS 'Reseller submits → Kaaryaa reviews → approves/rejects. Sole approver: Kaaryaa admin.';
COMMENT ON COLUMN onboarding_requests.proposed_facilities IS 'JSONB array of facility details proposed by reseller. Kaaryaa validates before approval.';
COMMENT ON COLUMN onboarding_requests.tenant_id           IS 'Populated on approval — links to created tenant record';
COMMENT ON COLUMN onboarding_requests.trial_days_granted  IS 'Kaaryaa sets this on approval. Drives facility_subscriptions.trial_until date.';

-- State transition guard
CREATE OR REPLACE FUNCTION claimssync.check_onboarding_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- submitted_at must be set when moving to 'submitted'
    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
        NEW.submitted_at = NOW();
    END IF;
    -- reviewed_at must be set when moving to 'reviewing', 'approved', 'rejected'
    IF NEW.status IN ('reviewing','approved','rejected') AND NEW.reviewed_at IS NULL THEN
        NEW.reviewed_at = NOW();
    END IF;
    -- approved_at
    IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
        NEW.approved_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_onboarding_transition
    BEFORE UPDATE ON onboarding_requests
    FOR EACH ROW EXECUTE FUNCTION claimssync.check_onboarding_transition();

CREATE TRIGGER trg_onboarding_updated_at
    BEFORE UPDATE ON onboarding_requests
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_onboarding_reseller ON onboarding_requests(reseller_id);
CREATE INDEX idx_onboarding_status   ON onboarding_requests(status);
CREATE INDEX idx_onboarding_tenant   ON onboarding_requests(tenant_id);


-- =============================================================================
-- 8. SYNC_SCHEDULES
--    Cron schedule per facility. Replaces Windows Task Scheduler in Phase 2+.
-- =============================================================================
CREATE TABLE sync_schedules (
    schedule_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID            NOT NULL REFERENCES tenant_facilities(facility_id) ON DELETE CASCADE,
    cron_expression     VARCHAR(100)    NOT NULL DEFAULT '0 6 * * *',
    timezone            VARCHAR(50)     NOT NULL DEFAULT 'Asia/Dubai',
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    lookback_override_days INTEGER,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sync_schedules IS 'Cron schedules per facility — replaces Windows Task Scheduler in Phase 2';

CREATE UNIQUE INDEX idx_schedules_one_active
    ON sync_schedules(facility_id)
    WHERE is_active = TRUE;

CREATE TRIGGER trg_schedules_updated_at
    BEFORE UPDATE ON sync_schedules
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();


-- =============================================================================
-- 9. SYNC_RUN_LOG
--    One row per sync execution per facility.
-- =============================================================================
CREATE TABLE sync_run_log (
    run_id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id             UUID        NOT NULL REFERENCES tenant_facilities(facility_id),
    schedule_id             UUID        REFERENCES sync_schedules(schedule_id),
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

COMMENT ON TABLE  sync_run_log                  IS 'One row per sync run. Replaces downloadlog-*.csv written by legacy engine.';
COMMENT ON COLUMN sync_run_log.files_resubmission IS 'Track high resubmission rates (>80% flagged in Jun-Jul 2025 production run)';
COMMENT ON COLUMN sync_run_log.host_name        IS 'DESKTOP-OEUQ9BU for Saleem on-prem; Azure container ID in Phase 2';

CREATE INDEX idx_run_log_facility   ON sync_run_log(facility_id);
CREATE INDEX idx_run_log_started    ON sync_run_log(started_at DESC);
CREATE INDEX idx_run_log_status     ON sync_run_log(status);


-- =============================================================================
-- 10. SYNC_RUN_INTERVALS
--     One row per 2-hour interval window within a run.
-- =============================================================================
CREATE TABLE sync_run_intervals (
    interval_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID        NOT NULL REFERENCES sync_run_log(run_id) ON DELETE CASCADE,
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

COMMENT ON TABLE  sync_run_intervals             IS '2-hour interval audit. One row per interval per run (v8b architecture).';
COMMENT ON COLUMN sync_run_intervals.api_result_code IS 'Shafafiya result codes: 0=OK, -6=file not found, others TBD';

CREATE INDEX idx_intervals_run_id ON sync_run_intervals(run_id);
CREATE INDEX idx_intervals_from   ON sync_run_intervals(interval_from);


-- =============================================================================
-- 11. FILE_MANIFEST
--     One row per downloaded file. Dedup anchor + full audit trail.
-- =============================================================================
CREATE TABLE file_manifest (
    manifest_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID        NOT NULL REFERENCES tenant_facilities(facility_id),
    run_id              UUID        NOT NULL REFERENCES sync_run_log(run_id),
    interval_id         UUID        REFERENCES sync_run_intervals(interval_id),
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
    first_seen_run_id   UUID        REFERENCES sync_run_log(run_id),
    downloaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  file_manifest              IS 'Per-file dedup + audit. Replaces os.path.exists() check in legacy engine.';
COMMENT ON COLUMN file_manifest.is_duplicate IS 'TRUE if file_name already exists for this facility from a prior run';
COMMENT ON COLUMN file_manifest.blob_url     IS 'Populated in Phase 2 when Blob StorageProvider is active';

CREATE INDEX idx_manifest_facility   ON file_manifest(facility_id);
CREATE INDEX idx_manifest_run        ON file_manifest(run_id);
CREATE INDEX idx_manifest_filename   ON file_manifest(facility_id, file_name);
CREATE INDEX idx_manifest_downloaded ON file_manifest(downloaded_at DESC);


-- =============================================================================
-- GRANTS (uncomment after creating app service principal in P1-T11)
-- =============================================================================
-- GRANT CONNECT ON DATABASE claimssync TO claimssync_app;
-- GRANT USAGE  ON SCHEMA claimssync TO claimssync_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA claimssync TO claimssync_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA claimssync TO claimssync_app;

-- =============================================================================
-- END OF SCHEMA DDL v2
-- claimssync_schema_v2.sql | Kaaryaa GenAI Solutions | March 2026
-- =============================================================================
