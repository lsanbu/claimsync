# ClaimSync — Product Reference Document (CLAUDE.md)
> **Last updated:** 25 Mar 2026 | Co-pilot: Claude.ai + Claude Code
> This file is the single source of truth for Claude Code. Always read this before making any changes.

---

## 1. Product Overview

**ClaimSync** is a SaaS platform by Kaaryaa Intelligence LLP that automates downloading, classifying, and routing insurance claims for Abu Dhabi healthcare facilities via the Shafafiya API.

| Attribute | Value |
|---|---|
| Founder | Anbu, Kaaryaa Intelligence LLP |
| Channel Partner | Saleem (UAE operator, production sign-off authority) |
| Target Market | Abu Dhabi healthcare facilities |
| Core API | Shafafiya API (UAE insurance claims) |
| Cloud | Azure UAE North |

---

## 2. Live Versions (as of 25 Mar 2026)

| Component | Image Tag | Container App / Job |
|---|---|---|
| Engine | `claimsync-engine:3.5` | `job-claimssync-engine` |
| API | `claimsync-api:2.5` | `ca-claimssync-api` |
| Dashboard | `claimsync-dashboard:2.15` | `ca-claimssync-dashboard` |

---

## 3. Azure Resources

| Resource | Value |
|---|---|
| Subscription | `ec12e27e-1ef9-46e9-8817-46a10b197381` |
| Tenant | `4a8ec151-3c90-4516-95c5-4c60fe32d713` |
| Resource Group | `rg-claimssync-uaenorth-prod` |
| Region | UAE North |
| ACR | `crclaimssync.azurecr.io` |
| API FQDN | `ca-claimssync-api.whitewater-45edc27c.uaenorth.azurecontainerapps.io` |
| Dashboard FQDN | `ca-claimssync-dashboard.whitewater-45edc27c.uaenorth.azurecontainerapps.io` |
| Engine Job | `job-claimssync-engine` — cron `0 2 * * *` = 06:00 UAE |
| Key Vault | `kv-claimssync-uae` (RBAC mode) |
| Database | `claimssync-db.postgres.database.azure.com` |
| DB Name | `dbname=postgres` / schema=`claimssync` / user=`claimsyncadmin` |
| DB Password | `ClaimSync@DB2026!` (reset 25 Mar 2026) |
| DB KV Secret | `db-dsn` (full DSN string) |
| Blob Storage | `stclaimssyncuae` |
| Managed Identity | `id-claimssync-engine` — client_id: `8e309ea2-175e-497e-8849-7af81a36c62a` |
| ACS | `acs-claimssync-uae` |
| ACS Email Svc | `acs-email-claimssync-uae` |
| ACS Domain | AzureManagedDomain (linked ✅) |
| ACS Sender | `donotreply@3c391368-4b3b-4b02-8ae4-faf17ee6dc4a.azurecomm.net` |
| ACS KV Secrets | `acs-connection-string`, `acs-sender-address` |

---

## 4. Dev Directories (Windows)

| Component | Path |
|---|---|
| Engine | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDocker` |
| API | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI` |
| Dashboard | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDashboard` |

---

## 5. Two-Environment Rule (NEVER MIX)

| Environment | Use For | Syntax |
|---|---|---|
| Windows CMD (Claude Code) | Docker builds, file ops, code edits | `dir`, `copy`, `^` continuation |
| Azure Cloud Shell (bash) | `az` CLI, `psql`, deployments | `ls`, `cp`, `\` continuation |

---

## 6. Admin Users

| User | Role | Password |
|---|---|---|
| `anbu@kaaryaa.com` | Super Admin | `Kaaryaa@Admin2026` |
| `saleem@claimsync.cloud` | Master Reseller | `ClaimSync@Saleem2026` |

---

## 7. Active Facilities

| Facility Code | Name | Status | Notes |
|---|---|---|---|
| MF2618 | Mediclinic | Active ✅ | credentials_provided=true, 437 files synced |
| MF5360 | MF5360 Facility | Active ✅ | Credentials entered 25 Mar 2026, first engine run pending |

---

## 8. Production Status (25 Mar 2026)

- Engine: **9 runs, 437 files, 100% success**
- ClaimSyncPull.py: Task Scheduler 07:00 UAE daily on Saleem PC
- Blob: `claimssync-mf2618` container — 435 blobs
- Blob: `claimssync-mf5360` container — pending first run

---

## 9. Database Schema (claimssync schema)

### Key Tables

| Table | Purpose |
|---|---|
| `claimssync.tenants` | Tenant (reseller) records |
| `claimssync.tenant_facilities` | Facility records per tenant |
| `claimssync.onboarding_requests` | Facility onboarding pipeline (PK: `request_id` uuid) |
| `claimssync.credential_tokens` | Secure credential setup tokens (migrated v3) |
| `claimssync.kaaryaa_admins` | Kaaryaa super admins |
| `claimssync.resellers` | Reseller accounts |
| `claimssync.sync_runs` | Engine run records per facility |
| `claimssync.file_manifest` | Per-file download records |
| `claimssync.sync_run_log` | Detailed engine run logs |

### credential_tokens status states
`valid` | `expired` | `used` | `revoked`

### Schema file
`claimssync_schema_v2.sql` + migrations: `migration_v3.sql`

---

## 10. Implemented Features (Phase 0–3 + Sprints to 25 Mar 2026)

### Phase 0 — Foundation
- [x] Azure resource provisioning (RG, ACR, DB, Blob, KV, Container Apps)
- [x] Managed Identity setup with RBAC roles
- [x] DB schema v1 — `sync_runs`, `file_manifest`, `sync_run_log`

### Phase 1 — Engine
- [x] `ClaimSync2.py` — Shafafiya API automation engine
  - Multi-facility support
  - 2-hour interval date splitting (API 1000-file cap workaround)
  - httpx (replaced curl subprocesses — eliminated race conditions)
  - `sleep(3)` rate-limit courtesy between intervals
  - Resubmission folder created before download loop
  - All stale XML/CSV purged at startup
  - Temp dir: `/tmp/claimssync/` (not `/mnt/` — avoids disk-full)
  - DB logging: `sync_runs`, `file_manifest`
- [x] Azure Container App Job — cron `0 2 * * *` (06:00 UAE)
- [x] Managed Identity blob upload
- [x] Engine image: `:3.5`

### Phase 2 — API + Dashboard
- [x] FastAPI backend (`ca-claimssync-api`)
  - `/onboard/*` — onboarding pipeline endpoints
  - `/onboard/credentials/[token]` — GET token info
  - `/onboard/credentials/` — POST submit credentials
  - `/onboard/credentials/resend` — POST resend token email
  - JWT authentication
  - Azure Monitor logging (`force=True` fix — stdout + App Insights)
- [x] Next.js dashboard (`ca-claimssync-dashboard`)
  - Admin portal
  - Reseller portal
  - Onboarding request state machine UI
  - Facility CRUD
  - `ResendCredentialToken.tsx` — admin resend UI with 4-state token display

### Phase 3 — Onboarding + Email
- [x] DB schema v2 — `tenant_facilities`, `tenants`, `onboarding_requests`, `credential_tokens`
- [x] `migration_v3.sql` — credential_tokens 4-state status + `sent_to_email` + `resend_count`
- [x] Token expiry: 7 days (was 72hr)
- [x] `email_service.py` — ACS email helper
  - Fixed: `getattr(result, 'message_id', None)` (was `result.get()` — AttributeError on object)
  - Fixed: `log.exception()` for full tracebacks on failure
- [x] `credentials_router.py` — 4-state GET/POST + resend endpoint
- [x] ACS resource + email domain created and linked
- [x] Onboarding Sprint 1+2 — LIVE
- [x] MF5360 onboarded (25 Mar 2026), credentials entered, pending first engine run

### Bug Fixes Applied (25 Mar 2026)
- [x] **Dashboard credential page "Link Not Found"** — frontend was checking `data.valid` (boolean) but API returns `data.status === 'valid'` (string). Fixed with normalization in `app/onboard/credentials/[token]/page.tsx`
- [x] **Email silent failure** — `configure_azure_monitor()` was claiming root logger before `basicConfig`, sending all logs to App Insights only (invisible in container logs). Fixed with `force=True` in `basicConfig`.
- [x] **Email false failure** — `poller.result()` returns `EmailSendResult` object; calling `.get("id")` raised `AttributeError` caught silently. Fixed with `getattr`.

---

## 11. API Env Vars

| Var | Source |
|---|---|
| `CLAIMSSYNC_DB_DSN` | KV secret: `db-dsn` |
| `CLAIMSSYNC_ACS_CONNECTION_STRING` | KV secret: `acs-connection-string` |
| `CLAIMSSYNC_ACS_SENDER_ADDRESS` | KV secret: `acs-sender-address` |

---

## 12. Key Architectural Principles

1. **httpx over curl** — synchronous httpx eliminates race conditions; no subprocess overhead
2. **Shafafiya API 1000-file cap** — always split date ranges into 2-hour intervals
3. **Shafafiya API UAE-only** — API blocks non-UAE IPs at TCP level; engine must run in Azure UAE North
4. **Temp dir** — always use `/tmp/claimssync/` (not `/mnt/`); owned by non-root `claimsync` user
5. **Docker non-root** — `mkdir /tmp/claimssync` must run AFTER `useradd` in single `RUN` layer
6. **Env var hygiene** — empty env var values cause silent fallback; always verify after setting
7. **Code protection** — `.py` source deleted from Saleem PC; only PyInstaller exe distributed
8. **Deployment discipline** — always wait for Saleem's production sign-off before deploying

---

## 13. Saleem PC (Production Baseline)

| Item | Value |
|---|---|
| OS | Windows, hostname `DESKTOP-OEUQ9BU` |
| Python | 3.12 (direct install, no Docker — virtualization disabled in BIOS) |
| Script | `ClaimSync1a.py` as PyInstaller exe at `C:\Users\USER\ClaimSync\` |
| Launcher | `ClaimSync.bat` (py -3.12) |
| Pull script | `ClaimSyncPull.py` — Task Scheduler 07:00 UAE daily |

---

## 14. Roadmap — What's Next

### Immediate (post MF5360 activation)
- [ ] **Verify MF5360 first engine run** — confirm `sync_runs` DB record + blobs in `claimssync-mf5360`
- [ ] **Reporting module** — per-facility, date range, CSV export
- [ ] **Facility self-service portal** `/facility/*` — update credentials, view sync history

### Sprint Backlog
- [ ] **Adhoc Run button** — wire `azure-mgmt-appcontainers` in API + `CLAIMSSYNC_ADHOC_FROM/TO` env var support in engine
- [ ] **PF2576 activation** — KV secrets (`facility-pf2576-userid/password/caller-license`) not yet created; status=inactive in DB

### Phase 4 — VNet + Private Endpoints + HA
- [ ] New `snet-containerapp` (/23) in `vnet-claimssync-uae`
- [ ] New `cae-claimssync-uae-v2` (Dedicated plan, VNet-injected)
- [ ] Private Endpoints for DB + Blob + KV on `snet-privateendpoints`
- [ ] DB public access reverted to Disabled
- [ ] Remove firewall rules (`allow-containerapp` + `allow-azure-services`)
- [ ] Pre-condition: CAE upgrade to Dedicated plan

### Phase 5 — Multi-tenant Beta Launch
- [ ] Reseller self-service onboarding
- [ ] Per-facility billing hooks
- [ ] SLA monitoring + alerting
- [ ] Custom domain + SSL

---

## 15. Claude Code Ground Rules

1. **ALL tasks via Claude Code prompt** — code, builds, Docker push, `az` deploy, `psql`, log checks
2. **Never give manual CLI commands** — always as a Claude Code prompt
3. **Frontend browser test** — only exception; Anbu's discretion
4. **Always confirm current live versions** before building new images
5. **Wait for Saleem sign-off** before any production deployment
6. **PGPASSWORD env var** for psql — never inline password with `!` in bash (history expansion)
7. **Image tagging** — bump minor version on every deploy (e.g., `:2.5` → `:2.6`)
