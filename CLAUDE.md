# ClaimSync — CLAUDE.md
> **Single source of truth for Claude Code**
> Last updated: 26 Mar 2026 (EOD) — verified by Claude Code live checks
> Founder: Anbu, Kaaryaa GenAI Solutions
> Read this file before making ANY changes to ClaimSync.

---

## 1. Product Overview

**ClaimSync** is a multi-tenant SaaS platform that automates downloading, classifying, and routing insurance claim files for Abu Dhabi healthcare facilities via the Shafafiya API.

| Attribute | Value |
|---|---|
| Founder | Anbu, Kaaryaa GenAI Solutions |
| Channel Partner | Saleem — UAE operator, production sign-off authority |
| Target Market | Abu Dhabi healthcare facilities (Shafafiya API subscribers) |
| Core API | Shafafiya API (UAE DOH insurance claims ecosystem) |
| Cloud | Microsoft Azure — UAE North |

---

## 2. Live Versions (26 Mar 2026 EOD)

| Component | Image | Container App / Job | Notes |
|---|---|---|---|
| Engine | `claimsync-engine:3.9` | `job-claimssync-engine` | Resubmission blob upload fix |
| API | `claimsync-api:2.9` | `ca-claimssync-api` | Intervals FROM/TO fix |
| Dashboard | `claimsync-dashboard:2.17` | `ca-claimssync-dashboard` | Interval XML viewer |

---

## 3. Azure Resources

| Resource | Value |
|---|---|
| Subscription | `ec12e27e-1ef9-46e9-8817-46a10b197381` |
| Tenant | `4a8ec151-3c90-4516-95c5-4c60fe32d713` |
| Resource Group | `rg-claimssync-uaenorth-prod` (UAE North) |
| Container App Env | `cae-claimssync-uae` (Consumption plan) |
| ACR | `crclaimssync.azurecr.io` |
| API FQDN | `ca-claimssync-api.whitewater-45edc27c.uaenorth.azurecontainerapps.io` |
| Dashboard FQDN | `ca-claimssync-dashboard.whitewater-45edc27c.uaenorth.azurecontainerapps.io` |
| Engine Job | `job-claimssync-engine` — cron `0 2 * * *` = 06:00 UAE |
| Key Vault | `kv-claimssync-uae` (RBAC mode) |
| DB Host | `claimssync-db.postgres.database.azure.com` |
| DB | `dbname=postgres` / schema=`claimssync` / user=`claimsyncadmin` |
| DB Password | `ClaimSync@DB2026!` (reset 25 Mar 2026) |
| DB KV Secret | `db-dsn` (Container App Job secret — not KV reference) |
| Blob Storage | `stclaimssyncuae` |
| Blob MF2618 | `claimssync-mf2618` |
| Blob MF5360 | `claimssync-mf5360` |
| Managed Identity | `id-claimssync-engine` — client_id: `8e309ea2-175e-497e-8849-7af81a36c62a` |
| ACS | `acs-claimssync-uae` / `acs-email-claimssync-uae` |
| ACS Domain | AzureManagedDomain linked ✅ |
| ACS Sender | `donotreply@3c391368-4b3b-4b02-8ae4-faf17ee6dc4a.azurecomm.net` |
| App Insights | `ai-claimssync-uae` (key: `6d6b4002-4e78-4628-b710-1a3585901dca`) |
| Log Analytics | `eb4827b3-0541-4fc4-991d-70d733e1c092` |
| Future Domain | `ClaimSync.Cloud` (registered — DNS not yet pointed to Azure) |

---

## 4. Env Vars — API Container

| Var | Source |
|---|---|
| `AZURE_CLIENT_ID` | `8e309ea2-175e-497e-8849-7af81a36c62a` |
| `CLAIMSSYNC_DB_DSN` | Container App secret: `db-dsn` |
| `CLAIMSSYNC_API_KEY` | KV secret |
| `CLAIMSSYNC_JWT_SECRET` | KV secret |
| `CLAIMSSYNC_ACS_CONNECTION_STRING` | KV secret: `acs-connection-string` |
| `CLAIMSSYNC_ACS_SENDER_ADDRESS` | KV secret: `acs-sender-address` |
| `CLAIMSSYNC_DASHBOARD_URL` | Dashboard FQDN |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights |
| `IMAGE_TAG` | Current image tag |

## 5. Env Vars — Engine Job

| Var | Source |
|---|---|
| `AZURE_CLIENT_ID` | `8e309ea2-175e-497e-8849-7af81a36c62a` |
| `KEYVAULT_URI` / `CLAIMSSYNC_KV_URI` | `https://kv-claimssync-uae.vault.azure.net/` |
| `BLOB_ACCOUNT` | `stclaimssyncuae` |
| `CLAIMSSYNC_BLOB_UPLOAD` | `1` |
| `CLAIMSSYNC_STORAGE_URL` | `https://stclaimssyncuae.blob.core.windows.net` |
| `CLAIMSSYNC_TEMP_DIR` | `/tmp/claimssync/` |
| `CLAIMSSYNC_TENANT` | `KAARYAA-T1` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights |
| `CLAIMSSYNC_ADHOC_FROM` | Optional — adhoc run from date |
| `CLAIMSSYNC_ADHOC_TO` | Optional — adhoc run to date |
| `CLAIMSSYNC_ADHOC_FACILITY` | Optional — single facility override |

---

## 6. Dev Directories (Windows)

| Component | Path |
|---|---|
| Engine | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDocker` |
| API | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI` |
| Dashboard | `D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDashboard` |

---

## 7. Two-Environment Rule — NEVER MIX

| Environment | Use For | Syntax |
|---|---|---|
| Windows CMD (Claude Code) | Docker builds, code edits, file ops | `dir`, `copy`, `^` continuation |
| Azure Cloud Shell (bash) | `az` CLI, `psql`, deployments, log queries | `ls`, `cp`, `\` continuation |

---

## 8. Admin Users

| User | Role | Password |
|---|---|---|
| `anbu@kaaryaa.com` | Kaaryaa Super Admin | `Kaaryaa@Admin2026` |
| `saleem@claimsync.cloud` | Master Reseller | `ClaimSync@Saleem2026` |

---

## 9. Active Facilities

| Code | Name | Tenant | Status | Blob Container |
|---|---|---|---|---|
| MF2618 | Mediclinic | KAARYAA-T1 | Active ✅ | `claimssync-mf2618` |
| MF5360 | MF5360 Facility | KAARYAA-T1 | Active ✅ | `claimssync-mf5360` |
| PF2576 | (Pending) | KAARYAA-T1 | Inactive ⬜ | `claimssync-pf2576` |

**IMPORTANT:** All facilities must be under `KAARYAA-T1` — engine uses `CLAIMSSYNC_TENANT=KAARYAA-T1`.

---

## 10. Blob Storage Layout (per facility)

```
claimssync-{facility}/
  claims/                    ← H* claim XML files
  remittance/                ← RA_* extracted remittance XMLs
  resubmission/              ← RSB*/RESUB* resubmission XMLs
  search_history/            ← per-interval SOAP request + response XMLs
    search_history_request_{FAC}_{TYPE}_{N}.xml
    search_history_response_{FAC}_{TYPE}_{N}.xml
  logs/                      ← per-run audit files
    downloadlog-{FAC}-{ts}.log   ← detailed run log
    downloadlog-{FAC}-{ts}.csv   ← file manifest CSV
```

---

## 11. Saleem PC — Local Folder Structure

```
C:\Users\USER\ClaimSync\Raggr\
  claimsync_pull_YYYY-MM-DD.log        ← central pull log (all facilities)

  mf2618\
    search_history_request_*.xml       ← from blob search_history/
    search_history_response_*.xml
    claims\
      archive\
    remittance\
      archive\
    resubmission\
      archive\
    logs\
      downloadlog-MF2618-*.log
      downloadlog-MF2618-*.csv

  mf5360\                              ← same structure
    search_history_request_*.xml
    search_history_response_*.xml
    claims\
      archive\
    remittance\
      archive\
    resubmission\
      archive\
    logs\
      downloadlog-MF5360-*.log
      downloadlog-MF5360-*.csv
```

**ClaimSyncPull.py v2.0** — Task Scheduler 07:00 UAE daily. Pulls all facilities. Central log at `Raggr\`.

---

## 12. Dashboard Routes — 18 Live + 1 Pending

All verified from codebase scan. Pure Next.js App Router.

| Route | Status |
|---|---|
| `/` | Live ✅ |
| `/facilities` | Live ✅ |
| `/admin/login` | Live ✅ |
| `/admin/dashboard` | Live ✅ |
| `/admin/facilities` | Live ✅ |
| `/admin/facilities/[code]/adhoc-run` | Live ✅ |
| `/admin/onboarding` | Live ✅ |
| `/admin/onboarding/[id]` | Live ✅ |
| `/admin/resellers` | Live ✅ |
| `/admin/revenue` | Live ✅ |
| `/admin/users` | Live ✅ |
| `/reseller/login` | Live ✅ |
| `/reseller/dashboard` | Live ✅ |
| `/reseller/facilities` | Live ✅ |
| `/reseller/facilities/[id]` | Live ✅ |
| `/reseller/onboard` | Live ✅ |
| `/reseller/onboarding` | Live ✅ |
| `/onboard/credentials/[token]` | Live ✅ |
| `/api/claimssync/[...path]` | Live ✅ (catch-all proxy) |
| `/facility/*` | NOT BUILT ⬜ |

---

## 13. Key API Endpoints

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Health + version | None |
| GET | `/docs` | Swagger UI | None |
| POST | `/auth/admin/login` | Admin JWT | None |
| POST | `/auth/reseller/login` | Reseller JWT | None |
| GET | `/admin/dashboard` | Platform stats | JWT Admin |
| GET | `/admin/facilities` | All facilities | JWT Admin |
| PUT | `/admin/facilities/{code}/reassign-tenant` | Reassign tenant | JWT SuperAdmin |
| POST | `/admin/facilities/{code}/adhoc-run` | Trigger adhoc engine run | JWT Admin |
| GET | `/admin/facilities/{code}/runs` | Last 10 sync runs | JWT Admin |
| GET | `/admin/facilities/{code}/runs/{run_id}/files` | File manifest for run | JWT Admin |
| GET | `/admin/facilities/{code}/runs/{run_id}/intervals` | Per-interval search history | JWT Admin |
| GET | `/admin/facilities/{code}/search-history/{filename}` | Raw SOAP XML from blob | JWT Admin |
| POST | `/admin/facilities/{code}/resend-token` | Revoke + reissue credential token | JWT Admin |
| GET | `/onboard/credentials/{token}` | Validate credential token | None |
| POST | `/onboard/credentials/` | Submit facility credentials | Token |

---

## 14. Database Schema

| Table | Purpose |
|---|---|
| `claimssync.tenants` | Tenant records (short_code, name) |
| `claimssync.tenant_facilities` | Facility records per tenant |
| `claimssync.onboarding_requests` | Onboarding pipeline |
| `claimssync.credential_tokens` | Setup tokens — `valid\|expired\|used\|revoked` |
| `claimssync.kaaryaa_admins` | Super admin accounts |
| `claimssync.resellers` | Reseller accounts (3-level) |
| `claimssync.sync_runs` | Engine run records per facility |
| `claimssync.file_manifest` | Per-file records — enriched with file_id, sender_id, receiver_id, record_count, transaction_date, transaction_timestamp |
| `claimssync.sync_run_log` | Detailed run logs — trigger_type: `scheduled\|manual\|api` |

Schema: `claimssync_schema_v2.sql` + `migration_v3.sql` + auto-migration for file_manifest columns

---

## 15. Implemented Features — Complete Phase History

### Phase 0 — Foundation ✅
- Azure resource provisioning
- RBAC roles — MI → KV + Blob
- DB schema v1

### Phase 1 — Sync Engine ✅ (:3.9)
- `ClaimSync2.py` — multi-facility Shafafiya automation
- 2-hour interval date splitting (1000-file cap workaround)
- httpx synchronous calls (replaced curl)
- sleep(3) rate-limit between intervals
- Stale XML/CSV purged at startup
- `/tmp/claimssync/` temp dir
- DB logging — `sync_runs` + `file_manifest`
- Blob upload — claims / remittance / resubmission subfolders
- ZIP extraction — ZIPs downloaded, extracted, XMLs uploaded, ZIP deleted
- FindnMoveResubmission() — detects `<Resubmission>` tag, moves to resubmission/
- remove_attachments_from_resubmissionfiles() — strips `<Attachment>` + `<Observation>`
- **Resubmission blob upload fix** (:3.9) — scan resubmission/ after move, upload all files
- Per-interval search_history XMLs (request + response) uploaded to blob
- Per-run downloadlog-*.log + downloadlog-*.csv uploaded to blob
- file_manifest enriched — file_id, sender_id, receiver_id, record_count
- Adhoc run support — `CLAIMSSYNC_ADHOC_FROM/TO/FACILITY` env vars
- trigger_type = `manual` for adhoc, `scheduled` for cron
- Azure Container App Job — cron `0 2 * * *` (06:00 UAE)

### Phase 2 — API ✅ (:2.9)
- FastAPI backend, JWT auth (admin + reseller)
- 15+ REST endpoints
- Full onboarding pipeline
- `email_service.py` — ACS email with correct EmailSendResult handling
- Azure Monitor + stdout logging (force=True fix)
- Adhoc run endpoint — triggers job via azure-mgmt-appcontainers
- Run history + file manifest endpoints
- Intervals endpoint — per-interval from/to + blob refs (FROM/TO fix :2.9)
- Search-history XML viewer endpoint
- Reassign-tenant endpoint (super-admin)

### Phase 3 — Dashboard + Onboarding ✅ (:2.17)
- Next.js 14 App Router — 18+ live routes
- Admin portal — 8 routes
- Reseller portal — 6 routes
- Adhoc Run page `/admin/facilities/[code]/adhoc-run`
  - Section A: date range form + Run Now button
  - Section B: Run History table (auto-refresh 30s) + Files/Intervals tabs
  - Section C: File manifest with filter + CSV export
  - Section D: Interval Search History table
    - Per-interval FROM/TO, files found, Request/Response status
    - Side-by-side XML viewer modal (SOAP request vs response)
    - Graceful fallback for pre-:3.8 runs
- Credential setup page `/onboard/credentials/[token]`
- ResendCredentialToken.tsx — 4-state token UI
- DB schema v2 + migration_v3 (7-day token expiry)

### ClaimSyncPull.py v2.0 ✅ (local — Saleem PC)
- Multi-facility: MF2618 + MF5360
- Blob prefix routing: claims/ → claims\, search_history/ → root, logs/ → logs\
- Central log: `Raggr\claimsync_pull_YYYY-MM-DD.log`
- Skip-if-exists logic
- archive\ subfolders auto-created
- Task Scheduler 07:00 UAE daily

---

## 16. Bug Fix Log

| Date | Bug | Root Cause | Fix |
|---|---|---|---|
| 25 Mar | Credential page "Link Not Found" | `data.valid` vs `data.status` | Normalized in `page.tsx` |
| 25 Mar | Email no stdout logs | `configure_azure_monitor()` silenced `basicConfig` | `force=True` in `main.py` |
| 25 Mar | Email falsely reported failed | `poller.result()` object not dict | `getattr(result, 'message_id', None)` |
| 26 Mar | Engine DB auth failure | DB password reset but KV + CA Job secret not updated | Updated both KV + Container App Job secret |
| 26 Mar | Engine finds 0 facilities | MF2618/MF5360 under wrong tenants (MEDICLINIC/MF5360-CLINIC vs KAARYAA-T1) | Reassigned via new API endpoint |
| 26 Mar | trigger_type constraint violation | `sync_run_log` CHECK allows `scheduled\|manual\|api` not `adhoc` | Changed to `manual` |
| 26 Mar | Blob container missing for MF5360 | Never created | Created `claimssync-mf5360` |
| 26 Mar | Interval FROM/TO showing `—` | `from_time`/`to_time` never populated in intervals endpoint | Parsed from request XML blobs in API :2.9 |
| 26 Mar | Resubmission files not in blob | Blob upload runs before `FindnMoveResubmission()` moves files | Post-move resubmission upload scan in :3.9 |

---

## 17. Shafafiya API Coverage

| Operation | Status | Phase |
|---|---|---|
| `SearchTransactions` | LIVE ✅ | 1 |
| `DownloadTransactionFile` | LIVE ✅ | 1 |
| `GetNewTransactions` | Planned ⬜ | 4 |
| `SetTransactionDownloaded` | Planned ⬜ | 4 |
| `GetClaimCountReconciliation` | Planned ⬜ | 4 |
| `CheckForNewPriorAuthTransactions` | Planned ⬜ | 4 |
| `GetNewPriorAuthorizationTransactions` | Planned ⬜ | 4 |
| `UploadTransaction` | Planned ⬜ | 5 |
| `AddDRGToEClaim` | Planned ⬜ | 5 |
| `GetDRGDetails` | Planned ⬜ | 5 |
| `GetPersonInsuranceHistory` | Planned ⬜ | 5 |
| `GetInsuranceContinuityCertificate` | Planned ⬜ | 6 |
| `CancelInsuranceContinuityCertificate` | Planned ⬜ | 6 |

---

## 18. Roadmap

### Immediate — 27 Mar 2026
- [ ] Verify 06:00 UAE cron resumes for both MF2618 + MF5360 (tenant fix)
- [ ] Verify resubmission files appear in blob for MF5360 16 Mar adhoc run
- [ ] Investigate Azure cost — PostgreSQL ₹3,578 — check DB SKU

### Next Sprint
- [ ] Reporting module — per-facility, date range, CSV export
- [ ] Facility self-service portal `/facility/*`
- [ ] PF2576 activation — 3 KV secrets + DB status + blob container
- [ ] Per-interval audit logging in DB (`sync_run_intervals` table)
- [ ] Multi-tenant access control ADR-002 — JWT-scoped DB filters
- [ ] XML beautification in interval viewer (syntax highlight)
- [ ] `ClaimSync.Cloud` custom domain — DNS pointed to Azure

### Phase 4 — VNet + Private Endpoints
- [ ] `cae-claimssync-uae-v2` Dedicated plan, VNet-injected
- [ ] Private Endpoints for DB + Blob + KV
- [ ] DB public access disabled

### Phase 5 — Beta Launch
- [ ] Reseller self-service, billing hooks, SLA monitoring, custom domain
- [ ] Shafafiya upload APIs

### Phase 6 — GenAI Intelligence
- [ ] Rejection pattern analysis, smart resubmission, NL query, anomaly detection

---

## 19. Key Architectural Principles

1. **httpx over curl** — no race conditions, ~80s saved per run
2. **2-hour interval splitting** — Shafafiya silently caps at 1000 files per call
3. **UAE-only API** — TCP blocked outside UAE; engine must stay in Azure UAE North
4. **`/tmp/claimssync/`** — `/mnt/` is tiny ephemeral; never use for scratch
5. **Docker non-root** — `mkdir` after `useradd` in single `RUN` layer
6. **Env var hygiene** — empty values = silent `LocalINIProvider` fallback
7. **`PGPASSWORD` for psql** — `!` in password breaks bash history expansion
8. **Container App Job secret** — `db-dsn` is a manual secret in the Job, not a KV reference. Update via `az containerapp job secret set`, not just KV.
9. **All facilities must be under KAARYAA-T1** — engine uses `CLAIMSSYNC_TENANT=KAARYAA-T1`
10. **trigger_type constraint** — `sync_run_log` allows `scheduled|manual|api` only
11. **Code protection** — `.py` source never on Saleem PC; PyInstaller exe only
12. **Deployment discipline** — Saleem sign-off before every production push
13. **force=True in basicConfig** — required when `configure_azure_monitor()` also used

---

## 20. Claude Code Ground Rules

1. ALL tasks via Claude Code prompt — code, builds, push, deploy, psql, logs
2. Never give manual CLI commands — always as a Claude Code prompt
3. Frontend browser test is the only exception — Anbu's discretion
4. Confirm current live versions before building new images
5. Bump minor version on every deploy
6. Saleem sign-off before every production deployment
7. `PGPASSWORD` for psql — never inline `!` passwords in bash
8. Windows CMD for builds; Azure Cloud Shell bash for az/psql
9. Never mix environment syntax
