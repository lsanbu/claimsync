# ClaimSync — Client Entity Architecture Design

> **Version:** 1.0
> **Date:** 27 Mar 2026
> **Author:** Anbu / Kaaryaa Intelligence LLP (via Claude Code)
> **Status:** IMPLEMENTED — Phase 4 Sprint 1 deployed 27 Mar 2026 (API :3.0 / Dashboard :2.19)

---

## 1. Current Schema Summary

### Entity Hierarchy (as-is)

```
kaaryaa_admins (Anbu — super admin)
  └── resellers (Saleem — master, 3-level hierarchy)
        └── tenants (KAARYAA-T1)
              ├── tenant_facilities (MF2618 — Mediclinic)
              ├── tenant_facilities (MF5360)
              └── tenant_facilities (PF2576 — inactive)
```

### Table Definitions (relevant subset)

#### claimssync.tenants
| Column | Type | Notes |
|---|---|---|
| tenant_id | uuid PK | gen_random_uuid() |
| reseller_id | uuid FK → resellers | NULL = Kaaryaa direct sale |
| name | varchar(200) | e.g. "Kaaryaa Test Facility Group" |
| short_code | varchar(20) UNIQUE | e.g. "KAARYAA-T1" |
| legal_name | varchar(300) | |
| contact_name | varchar(200) | |
| contact_email | varchar(255) | |
| contact_phone | varchar(30) | |
| timezone | varchar(50) | Default 'Asia/Dubai' |
| country | varchar(10) | Default 'UAE' |
| emirate | varchar(50) | |
| is_multi_sp_enabled | boolean | Phase 3 flag |
| api_key | varchar(64) UNIQUE | Bearer token for dashboard API |
| status | varchar(20) | active\|suspended\|cancelled |
| notes | text | |
| created_at / updated_at | timestamptz | auto-managed |

#### claimssync.tenant_facilities
| Column | Type | Notes |
|---|---|---|
| facility_id | uuid PK | |
| tenant_id | uuid FK → tenants | NOT NULL, ON DELETE CASCADE |
| service_provider_id | uuid FK → service_providers | NOT NULL |
| facility_code | varchar(20) | e.g. "MF2618" |
| facility_name | varchar(200) | |
| payer_id | varchar(50) | |
| local_base_path | varchar(500) | Legacy Saleem PC path |
| claims_subfolder | varchar(100) | Default 'claims' |
| resubmission_subfolder | varchar(100) | Default 'resubmission' |
| remittance_subfolder | varchar(100) | Default 'remittance' |
| blob_container | varchar(100) | e.g. "claimssync-mf2618" |
| lookback_days | integer | Default 90 |
| interval_hours | integer | Default 2 |
| api_sleep_seconds | integer | Default 3 |
| min_free_disk_mb | integer | Default 50 |
| kv_secret_prefix | varchar(100) | e.g. "facility-mf2618" |
| status | varchar(20) | active\|inactive\|suspended |
| credentials_provided | boolean | Added in migration_v1 |
| notes | text | |
| created_at / updated_at | timestamptz | |
| UNIQUE | (tenant_id, facility_code) | |

#### claimssync.resellers
| Column | Type | Notes |
|---|---|---|
| reseller_id | uuid PK | |
| parent_reseller_id | uuid FK → self | NULL for master |
| level | varchar(20) | master\|sub\|individual |
| name | varchar(200) | |
| short_code | varchar(20) UNIQUE | e.g. "SALEEM-UAE" |
| contact_name | varchar(200) | |
| contact_email | varchar(255) | |
| contact_phone | varchar(30) | |
| country | varchar(10) | Default 'UAE' |
| emirate | varchar(50) | |
| commission_pct | numeric(5,2) | Revenue share % |
| agreement_signed_at | date | |
| agreement_ref | varchar(100) | |
| authorized_providers | varchar(30)[] | Default ARRAY['SHAFAFIYA'] |
| max_tenants | integer | |
| max_facilities | integer | |
| status | varchar(20) | pending\|active\|suspended\|terminated |
| notes | text | |
| created_at / updated_at | timestamptz | |

**Hierarchy enforcement:** Trigger `check_reseller_hierarchy()` validates parent-child level rules.

#### claimssync.onboarding_requests
| Column | Type | Notes |
|---|---|---|
| request_id | uuid PK | |
| reseller_id | uuid FK → resellers | NOT NULL |
| service_provider_id | uuid FK → service_providers | NOT NULL |
| tenant_name | varchar(200) | |
| tenant_short_code | varchar(20) | |
| tenant_emirate | varchar(50) | |
| tenant_country | varchar(10) | Default 'UAE' |
| contact_name | varchar(200) | |
| contact_email | varchar(255) | |
| contact_phone | varchar(30) | |
| proposed_facilities | jsonb | Default '[]' |
| requested_plan_code | varchar(30) | |
| status | varchar(20) | draft\|submitted\|reviewing\|approved\|rejected\|cancelled |
| submitted_at | timestamptz | |
| reseller_notes | text | |
| reviewed_by | varchar(200) | |
| reviewed_at | timestamptz | |
| review_notes | text | |
| approved_at | timestamptz | |
| trial_days_granted | integer | Default 30 |
| tenant_id | uuid FK → tenants | Set on approval |
| rejection_reason | text | |
| credential_link_sent_at | timestamptz | Added in migration_v3 |
| credential_link_sent_to | varchar(255) | Added in migration_v3 |
| credential_token | varchar(64) | Added in migration_v1 |
| created_at / updated_at | timestamptz | |

#### claimssync.credential_tokens
| Column | Type | Notes |
|---|---|---|
| token_id | uuid PK | |
| facility_id | uuid FK → tenant_facilities | NOT NULL, ON DELETE CASCADE |
| request_id | uuid FK → onboarding_requests | |
| token | varchar(64) UNIQUE | |
| expires_at | timestamptz | Default now() + 7 days |
| used_at | timestamptz | |
| status | varchar(20) | valid\|expired\|used\|revoked (migration_v3) |
| sent_to_email | varchar(255) | migration_v3 |
| resend_count | integer | Default 0, migration_v3 |
| resent_at | timestamptz | migration_v3 |
| created_by | varchar(200) | Default 'system', migration_v3 |
| created_at | timestamptz | |

### Gap Analysis

The current schema has **no client/customer grouping entity** between reseller and facility. The `tenants` table serves as the technical grouping (engine uses `CLAIMSSYNC_TENANT`), but it conflates infrastructure isolation with business relationships:

- **Tenant** = engine execution scope (KAARYAA-T1 runs all facilities)
- **Client** = business customer (Mediclinic Group, who may have 3 facilities)

These are different concerns. A healthcare group (Mediclinic) with 3 facilities should be:
- **One client** for billing, contacts, and portal access
- **Multiple facilities** under that client for sync operations
- All within the **same tenant** for engine execution

The `onboarding_requests` table has `tenant_name`/`tenant_short_code` — these conceptually map to the client, not the tenant.

---

## 2. Proposed Table: claimssync.clients

```sql
CREATE TABLE claimssync.clients (
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

COMMENT ON TABLE  claimssync.clients IS 'Business customer entity — billing unit between reseller and facility. One client may have 1..N facilities.';
COMMENT ON COLUMN claimssync.clients.client_code IS 'Human-readable unique code e.g. MEDICLINIC-GROUP, MF2618 (for 1:1 cases)';
COMMENT ON COLUMN claimssync.clients.tenant_id IS 'Technical tenant for engine execution — all facilities under this client run in this tenant';
COMMENT ON COLUMN claimssync.clients.billing_email IS 'Group invoice destination — may differ from contact_email';
COMMENT ON COLUMN claimssync.clients.plan IS 'Billing plan tier — drives feature gates and pricing';

CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON claimssync.clients
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_clients_reseller ON claimssync.clients(reseller_id);
CREATE INDEX idx_clients_tenant   ON claimssync.clients(tenant_id);
CREATE INDEX idx_clients_status   ON claimssync.clients(status);
```

### Design Decisions

1. **`reseller_id` NOT NULL** — every client must come through a reseller. Kaaryaa direct sales use a Kaaryaa-internal reseller record.
2. **`tenant_id` NOT NULL** — every client maps to a tenant for engine execution. This preserves the engine's `CLAIMSSYNC_TENANT` model unchanged.
3. **`plan` on client, not facility** — billing is at the client level. The existing `facility_subscriptions` table can remain for per-facility overrides, but the default plan comes from the client.
4. **`client_code` UNIQUE** — supports both 1:1 (code = facility_code) and 1:N (code = group name).

---

## 3. Proposed Table: claimssync.client_users

```sql
CREATE TABLE claimssync.client_users (
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

COMMENT ON TABLE  claimssync.client_users IS 'Client staff portal access — Phase 5 facility self-service. Viewer sees dashboards; admin manages credentials.';
COMMENT ON COLUMN claimssync.client_users.role IS 'viewer = read-only facility dashboards; admin = manage credentials + trigger adhoc runs';

CREATE TRIGGER trg_client_users_updated_at
    BEFORE UPDATE ON claimssync.client_users
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

CREATE INDEX idx_client_users_client ON claimssync.client_users(client_id);
CREATE INDEX idx_client_users_email  ON claimssync.client_users(email);
```

### Design Decisions

1. **`password_hash`** — included for future Phase 5 login. NULL until client portal is built.
2. **`UNIQUE (client_id, email)`** — same person can be admin at two different clients (rare but possible).
3. **`ON DELETE CASCADE`** — if a client is removed, its users go too.
4. **Not built yet** — this table is created in migration_v4 but remains empty until `/facility/*` routes are built (Phase 5).

---

## 4. Migration: migration_v4.sql

> **DO NOT APPLY** — design document only. Migration to be applied when implementation begins.

```sql
-- =============================================================================
-- migration_v4_clients.sql — Client entity + facility linkage
-- ClaimSync | Kaaryaa Intelligence LLP | March 2026
-- =============================================================================
-- Pre-requisites: claimssync_schema_v3.sql + migration_v3.sql applied
-- Run against: claimssync-db.postgres.database.azure.com / postgres / schema=claimssync
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards)
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

CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON claimssync.clients
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

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

CREATE TRIGGER trg_client_users_updated_at
    BEFORE UPDATE ON claimssync.client_users
    FOR EACH ROW EXECUTE FUNCTION claimssync.set_updated_at();

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
-- 5. Backfill: Auto-create 1:1 client per existing facility (Option A)
-- ---------------------------------------------------------------------------
-- For each active facility, create a client record using the facility's
-- own code and name, linked to the tenant's reseller.

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
        -- Check if client already exists for this facility code
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

-- ---------------------------------------------------------------------------
-- 6. Verify backfill
-- ---------------------------------------------------------------------------
-- After running, confirm:
--   SELECT c.client_code, c.client_name, f.facility_code, f.facility_name
--   FROM claimssync.clients c
--   JOIN claimssync.tenant_facilities f ON f.client_id = c.client_id
--   ORDER BY c.client_code, f.facility_code;
--
-- Expected:
--   MF2618  | Mediclinic — Facility MF2618 | MF2618 | Mediclinic — Facility MF2618
--   MF5360  | (name)                        | MF5360 | (name)
--   PF2576  | Facility PF2576               | PF2576 | Facility PF2576

-- ---------------------------------------------------------------------------
-- 7. (FUTURE — Phase 5) Make client_id NOT NULL after all facilities backfilled
-- ---------------------------------------------------------------------------
-- ALTER TABLE claimssync.tenant_facilities
--     ALTER COLUMN client_id SET NOT NULL;
--
-- Only uncomment after verifying zero NULLs:
--   SELECT COUNT(*) FROM claimssync.tenant_facilities WHERE client_id IS NULL;

-- =============================================================================
-- END OF MIGRATION v4 — client entity
-- =============================================================================
```

---

## 5. Updated Entity Hierarchy

### After Migration

```
Kaaryaa (super admin — kaaryaa_admins)
  └── Reseller (Saleem — resellers, level=master)
        └── Client (Mediclinic Group — clients)        ← NEW
              ├── Facility MF2618 (tenant_facilities)
              ├── Facility MF2619 (tenant_facilities)
              └── Facility MF2620 (tenant_facilities)
              └── Client Users (client_users)           ← NEW (Phase 5)
                    ├── dr.smith@mediclinic.ae (admin)
                    └── billing@mediclinic.ae (viewer)
```

### Relationship Rules

| Rule | Constraint |
|---|---|
| A facility MUST belong to a client | `client_id NOT NULL` (enforced after backfill in Phase 5) |
| A client MUST belong to a reseller | `reseller_id NOT NULL` on clients |
| A client MUST map to a tenant | `tenant_id NOT NULL` on clients |
| 1:1 case | client_code = facility_code (auto-created on backfill) |
| 1:N case | client is the billing unit; multiple facilities share client_id |
| Client users see all facilities under their client | JWT scoped to client_id |
| Reseller sees all clients + all facilities under them | JWT scoped to reseller_id |
| Admin sees everything | JWT with is_super_admin flag |

### Tenant vs Client Clarification

| Concept | Purpose | Engine Impact |
|---|---|---|
| **Tenant** | Technical execution scope — `CLAIMSSYNC_TENANT=KAARYAA-T1` | Engine queries facilities by tenant. **No change needed.** |
| **Client** | Business customer — billing, contacts, portal | API/Dashboard only. Engine ignores client_id. |

The engine continues to use `tenant_id` for facility lookup. The `client_id` is purely for API/Dashboard business logic.

---

## 6. API Endpoint Impact Assessment

### Existing Endpoints — Changes Required

| Endpoint | Router | Change |
|---|---|---|
| `GET /admin/dashboard` | admin.py:68 | Add client count to stats |
| `GET /admin/facilities` | admin.py:491 | Add `client_code`, `client_name` to response via JOIN |
| `GET /admin/onboarding` | admin.py:129 | Add `client_id`, `client_name` to response |
| `PUT /admin/onboarding/{id}/approve` | admin.py:208 | Create client if needed during approval |
| `GET /reseller/dashboard` | reseller.py:48 | Add client count to stats |
| `GET /reseller/facilities` | reseller.py:136 | Add `client_code`, `client_name`; group by client |
| `GET /reseller/facilities/{id}` | reseller.py:180 | Add client info to response |
| `GET /reseller/onboarding` | reseller.py:226 | Add client_id field |
| `POST /reseller/onboarding` | reseller.py:256 | Accept `client_id` or `new_client` fields |

### Existing Endpoints — No Change

| Endpoint | Reason |
|---|---|
| `POST /admin/facilities/{code}/adhoc-run` | Operates on facility, client irrelevant |
| `GET /admin/facilities/{code}/runs` | Per-facility run history, no client context |
| `GET /admin/facilities/{code}/runs/{id}/files` | Per-run file manifest |
| `GET /admin/facilities/{code}/runs/{id}/intervals` | Per-run intervals |
| `GET /admin/facilities/{code}/search-history/{fn}` | Raw XML viewer |
| `POST /auth/admin/login` | Admin auth unchanged |
| `POST /auth/reseller/login` | Reseller auth unchanged |
| `GET /onboard/credentials/{token}` | Token-based, no client context |
| `POST /onboard/credentials/` | Facility-level credential submit |
| All `/stats/*` endpoints | Can add client filter later |

### New Endpoints

| Method | Endpoint | Router | Purpose | Auth |
|---|---|---|---|---|
| `GET` | `/admin/clients` | admin.py | List all clients with facility count | JWT Admin |
| `GET` | `/admin/clients/{client_id}` | admin.py | Single client detail + facilities | JWT Admin |
| `PUT` | `/admin/clients/{client_id}` | admin.py | Update client info | JWT Admin |
| `GET` | `/reseller/clients` | reseller.py | Reseller's clients with facility count | JWT Reseller |
| `POST` | `/reseller/clients` | reseller.py | Create new client under reseller | JWT Reseller |
| `GET` | `/reseller/clients/{client_id}/facilities` | reseller.py | All facilities for a client | JWT Reseller |
| `POST` | `/auth/client/login` | auth.py | Client user login (Phase 5) | None |
| `GET` | `/client/facilities` | client.py | Client's own facilities (Phase 5) | JWT Client |

### Proposed Response Shapes

**GET /admin/clients**
```json
{
  "clients": [
    {
      "client_id": "uuid",
      "client_code": "MEDICLINIC-GROUP",
      "client_name": "Mediclinic Group",
      "reseller_name": "Saleem Channel Partner",
      "plan": "starter",
      "status": "active",
      "facility_count": 3,
      "contact_email": "ops@mediclinic.ae",
      "created_at": "2026-03-27T..."
    }
  ],
  "total": 1
}
```

**GET /reseller/clients**
```json
{
  "clients": [
    {
      "client_id": "uuid",
      "client_code": "MF2618",
      "client_name": "Mediclinic — Facility MF2618",
      "plan": "starter",
      "status": "active",
      "facility_count": 1,
      "created_at": "2026-03-27T..."
    }
  ]
}
```

---

## 7. Onboarding Flow Update

### Current Flow (no client entity)

```
1. Saleem submits onboarding_request (tenant_name, facilities JSONB)
2. Anbu reviews + approves
3. System creates tenant + facilities
4. Email with credential link sent to contact_email
5. Facility staff enters Shafafiya credentials
6. Facility activated
```

### Updated Flow (with client entity)

```
CASE A — New standalone facility (1:1)
──────────────────────────────────────
1. Saleem opens onboarding form
2. "Client" = "Create New" (auto-filled from facility details)
3. Saleem submits: facility_code, facility_name, contact info
4. System auto-creates client (client_code = facility_code)
5. Anbu approves → tenant + client + facility created
6. Credential email → contact_email on client record
7. Credentials entered → facility activated

CASE B — Adding facility to existing client (1:N)
──────────────────────────────────────────────────
1. Saleem opens onboarding form
2. "Client" = dropdown of existing clients under Saleem's reseller
3. Saleem selects "Mediclinic Group" → submits new facility under it
4. Anbu approves → facility created under existing client + tenant
5. Credential email → client.billing_email (or contact_email)
6. Credentials entered → facility activated

CASE C — Sub-reseller serves shared client (future)
────────────────────────────────────────────────────
1. Master reseller (Saleem) creates client
2. Sub-reseller is granted access to client via reseller hierarchy
3. Sub-reseller can onboard facilities under that client
4. Billing rolls up to client level
```

### Onboarding Request Schema Change

The `onboarding_requests` table gets a new nullable `client_id` column:

- **NULL** = new client to be auto-created on approval (Case A)
- **Set** = facility being added to existing client (Case B)

The existing `tenant_name`/`tenant_short_code` fields on `onboarding_requests` remain for backward compatibility but become secondary to `client_id` for new requests.

### Approval Logic Update (admin.py — approve endpoint)

```python
# Pseudocode for updated approval flow
if request.client_id:
    # Case B: adding to existing client
    client = get_client(request.client_id)
    tenant_id = client.tenant_id
else:
    # Case A: new standalone
    # 1. Create client (client_code = facility_code)
    # 2. Use existing tenant or create new one
    client = create_client(...)
    tenant_id = client.tenant_id

# Create facility under client + tenant
facility = create_facility(tenant_id=tenant_id, client_id=client.client_id, ...)

# Send credential email to client.contact_email
send_credential_email(client.contact_email, ...)
```

---

## 8. Recommendation: When to Implement

### Suggested Timeline

| Phase | Scope | When |
|---|---|---|
| **Phase 4 Sprint 1** | DB migration_v4 + backfill | Before billing hooks |
| **Phase 4 Sprint 2** | API endpoint updates + new client endpoints | After migration verified |
| **Phase 5** | client_users table populated + `/facility/*` portal | Beta launch |
| **Phase 5+** | `client_id NOT NULL` enforcement on tenant_facilities | After all facilities backfilled |

### Why Phase 4, Before Billing Hooks

1. **Billing needs a billing entity.** The client is the billing unit — invoices go to `client.billing_email`, not per-facility. Building billing hooks without the client entity would require a rewrite later.

2. **Zero engine impact.** The engine uses `tenant_id` for facility lookup. Adding `client_id` to `tenant_facilities` is purely additive — no engine code changes, no redeployment of `job-claimssync-engine`.

3. **Backward compatible.** The migration creates 1:1 client records for existing facilities. All existing API responses continue to work — client fields are additive to existing JSON responses.

4. **Unblocks Phase 5.** The facility self-service portal (`/facility/*`) needs client_users to know who can log in and what they can see. Having the client entity ready means Phase 5 can focus on UI, not schema.

### Migration Risk: Low

- `client_id` on `tenant_facilities` is **nullable** — no constraint violations on deploy
- Backfill runs in a DO block — creates 1:1 clients for existing facilities
- All existing queries continue to work (no column removed, no type changed)
- Rollback: `DROP TABLE claimssync.client_users; DROP TABLE claimssync.clients; ALTER TABLE claimssync.tenant_facilities DROP COLUMN client_id;`

### Engine Impact: None

The sync engine (`ClaimSync2.py`) queries facilities by `tenant_id`:
```sql
SELECT ... FROM claimssync.tenant_facilities WHERE tenant_id = (
    SELECT tenant_id FROM claimssync.tenants WHERE short_code = %s
)
```
This query is unchanged. The engine never reads or writes `client_id`.

---

## Appendix A: Entity-Relationship Summary

```
┌──────────────────┐
│  kaaryaa_admins   │  (super admin accounts)
└──────────────────┘
         │ manages all
         ▼
┌──────────────────┐       ┌──────────────────┐
│    resellers      │──────▶│    resellers      │  (self-referential: master→sub→individual)
│  (master/sub/ind) │       │  (parent_id)      │
└──────────────────┘       └──────────────────┘
         │ 1:N
         ▼
┌──────────────────┐
│    clients        │  ← NEW
│  (billing unit)   │
└──────────────────┘
     │ 1:N    │ 1:N
     ▼        ▼
┌────────┐  ┌──────────────┐
│ client │  │   tenant     │
│ _users │  │ _facilities  │──▶ tenants (engine scope)
│ (Ph 5) │  │              │──▶ service_providers
└────────┘  └──────────────┘
                  │ 1:N
                  ▼
            ┌──────────────┐
            │ sync_run_log │──▶ file_manifest
            │              │──▶ sync_run_intervals
            └──────────────┘
```

---

## Appendix B: Files to Modify (Implementation Checklist)

| File | Change |
|---|---|
| `ClaimSyncDocker/migration_v4_clients.sql` | New migration file (from Section 4) |
| `ClaimSyncAPI/claimssync_api/routers/admin.py` | Add client endpoints, update facility/onboarding queries |
| `ClaimSyncAPI/claimssync_api/routers/reseller.py` | Add client endpoints, update facility list |
| `ClaimSyncAPI/claimssync_api/routers/auth.py` | Add `/auth/client/login` (Phase 5) |
| `ClaimSyncAPI/claimssync_api/routers/client.py` | New router for client portal (Phase 5) |
| `ClaimSyncDocker/ClaimSync2.py` | **No change** — engine uses tenant_id only |

---

*End of design document — client_architecture_design.md*
*Kaaryaa Intelligence LLP | 27 Mar 2026*
