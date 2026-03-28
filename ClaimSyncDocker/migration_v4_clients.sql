-- =============================================================================
-- migration_v4_clients.sql — Client entity + facility linkage
-- ClaimSync | Kaaryaa GenAI Solutions | 27 March 2026
-- =============================================================================
-- Pre-requisites: claimssync_schema_v3.sql + migration_v3.sql applied
-- Run against: claimssync-db.postgres.database.azure.com / postgres / schema=claimssync
-- Safe to run multiple times (IF NOT EXISTS guards)
-- =============================================================================

SET search_path TO claimssync, public;

-- ---------------------------------------------------------------------------
-- 1. Create clients table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claimssync.clients (
    client_id       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id     UUID            NOT NULL REFERENCES claimssync.resellers(reseller_id),
    tenant_id       UUID            NOT NULL REFERENCES claimssync.tenants(tenant_id),
    client_code     VARCHAR(50)     NOT NULL UNIQUE,
    client_name     VARCHAR(200)    NOT NULL,
    legal_name      VARCHAR(300),
    contact_name    VARCHAR(200),
    contact_email   VARCHAR(200),
    contact_phone   VARCHAR(50),
    billing_email   VARCHAR(200),
    emirate         VARCHAR(50),
    country         VARCHAR(10)     NOT NULL DEFAULT 'UAE',
    plan            VARCHAR(20)     NOT NULL DEFAULT 'starter'
                                    CHECK (plan IN ('starter', 'pro', 'enterprise')),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'suspended', 'cancelled')),
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    CREATE TRIGGER trg_clients_updated_at
        BEFORE UPDATE ON claimssync.clients
        FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_reseller ON claimssync.clients(reseller_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant   ON claimssync.clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_status   ON claimssync.clients(status);

-- ---------------------------------------------------------------------------
-- 2. Create client_users table (empty until Phase 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claimssync.client_users (
    client_user_id  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID            NOT NULL REFERENCES claimssync.clients(client_id) ON DELETE CASCADE,
    email           VARCHAR(200)    NOT NULL,
    name            VARCHAR(200),
    password_hash   VARCHAR(200),
    role            VARCHAR(20)     NOT NULL DEFAULT 'viewer'
                                    CHECK (role IN ('viewer', 'admin')),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'suspended')),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, email)
);

DO $$ BEGIN
    CREATE TRIGGER trg_client_users_updated_at
        BEFORE UPDATE ON claimssync.client_users
        FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_users_client ON claimssync.client_users(client_id);
CREATE INDEX IF NOT EXISTS idx_client_users_email  ON claimssync.client_users(email);

-- ---------------------------------------------------------------------------
-- 3. Add client_id FK to tenant_facilities (nullable for backward compat)
-- ---------------------------------------------------------------------------
ALTER TABLE claimssync.tenant_facilities
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES claimssync.clients(client_id);

CREATE INDEX IF NOT EXISTS idx_facilities_client ON claimssync.tenant_facilities(client_id);

-- ---------------------------------------------------------------------------
-- 4. Add client_id to onboarding_requests (for new onboarding flow)
-- ---------------------------------------------------------------------------
ALTER TABLE claimssync.onboarding_requests
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES claimssync.clients(client_id);

-- ---------------------------------------------------------------------------
-- 5. Backfill: Auto-create 1:1 client per existing facility
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
    new_client_id UUID;
BEGIN
    FOR rec IN
        SELECT
            f.facility_id,
            f.facility_code,
            f.facility_name,
            f.tenant_id,
            t.reseller_id,
            t.contact_name,
            t.contact_email,
            t.emirate
        FROM claimssync.tenant_facilities f
        JOIN claimssync.tenants t ON t.tenant_id = f.tenant_id
        WHERE f.client_id IS NULL
    LOOP
        SELECT client_id INTO new_client_id
        FROM claimssync.clients
        WHERE client_code = rec.facility_code;

        IF new_client_id IS NULL THEN
            INSERT INTO claimssync.clients (
                reseller_id, tenant_id, client_code, client_name,
                contact_name, contact_email, emirate, plan, status
            ) VALUES (
                rec.reseller_id,
                rec.tenant_id,
                rec.facility_code,
                COALESCE(rec.facility_name, rec.facility_code),
                rec.contact_name,
                rec.contact_email,
                rec.emirate,
                'starter',
                'active'
            )
            RETURNING client_id INTO new_client_id;
        END IF;

        UPDATE claimssync.tenant_facilities
        SET client_id = new_client_id
        WHERE facility_id = rec.facility_id;
    END LOOP;
END;
$$;

-- =============================================================================
-- END OF MIGRATION v4 — client entity
-- =============================================================================
