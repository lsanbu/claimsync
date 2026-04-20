"""
routers/reseller.py — Reseller portal API endpoints
----------------------------------------------------
All endpoints require valid reseller JWT (Bearer token).
Resellers can only see data scoped to their own tenants/facilities.

GET  /reseller/dashboard          — stats summary
GET  /reseller/facilities         — all facilities under reseller's tenants
GET  /reseller/facilities/:id     — single facility with last run + file count
GET  /reseller/facilities/:code/runs         — last 10 runs (scoped)
GET  /reseller/facilities/:code/runs/:id/files — file manifest (scoped)
GET  /reseller/facilities/:code/runs/:id/intervals — intervals (scoped)
GET  /reseller/facilities/:code/search-history/:fn — raw XML (scoped)
POST /reseller/facilities/:code/adhoc-run    — trigger adhoc run (scoped)
GET  /reseller/clients            — reseller's clients
POST /reseller/clients            — create client
GET  /reseller/onboarding         — list onboarding requests
POST /reseller/onboarding         — submit new onboarding request
GET  /reseller/onboarding/:id     — single request status
"""

from __future__ import annotations

import os
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Path, Body, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..db import query, query_one, get_db, SCHEMA
from .auth import require_reseller

router = APIRouter()
log = logging.getLogger(__name__)

STORAGE_URL = os.getenv(
    "CLAIMSSYNC_STORAGE_URL",
    "https://stclaimssyncuae.blob.core.windows.net",
)
MANAGED_IDENTITY_CLIENT_ID = "8e309ea2-175e-497e-8849-7af81a36c62a"
SUBSCRIPTION_ID = "ec12e27e-1ef9-46e9-8817-46a10b197381"
RESOURCE_GROUP = "rg-claimssync-uaenorth-prod"
ENGINE_JOB_NAME = "job-claimssync-engine"


# ── Reseller facility access guard ──────────────────────────────────────────

def _get_reseller_facility(facility_code: str, reseller_id: str) -> dict:
    """Look up facility by code, ensure it belongs to this reseller.

    v2.8 scope: facility is accessible iff the reseller has an approved
    onboarding_request for the facility's tenant. The legacy v2.7 OR
    fallback on tenants.reseller_id was removed once MF2618/MF5360 were
    backfilled with onboarding_requests rows.
    """
    if not reseller_id:
        # Shouldn't happen — require_reseller enforces auth — but fail closed.
        raise HTTPException(status_code=403, detail="Reseller ID required")
    row = query_one(
        f"""
        SELECT f.facility_id, f.facility_code, f.facility_name, f.status
        FROM {SCHEMA}.tenant_facilities f
        WHERE f.facility_code = %s
          AND EXISTS (
              SELECT 1
                FROM {SCHEMA}.onboarding_requests orq
               WHERE orq.tenant_id   = f.tenant_id
                 AND orq.reseller_id = %s::uuid
                 AND orq.status      = 'approved'
          )
        """,
        (facility_code.upper(), reseller_id),
    )
    if not row:
        raise HTTPException(status_code=403, detail=f"Facility {facility_code} not found or not accessible")
    if row["status"] != "active":
        raise HTTPException(status_code=400, detail=f"Facility {facility_code} is {row['status']}, not active")
    return row


def _get_blob_container_client(facility_code: str):
    from azure.identity import ManagedIdentityCredential
    from azure.storage.blob import BlobServiceClient
    credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
    blob_service = BlobServiceClient(account_url=STORAGE_URL, credential=credential)
    return blob_service.get_container_client(f"claimssync-{facility_code.lower()}")


# ── GET /reseller/storage/sas-token ────────────────────────────────────────────

@router.get("/storage/sas-token", summary="Generate read-only SAS tokens for reseller's blob containers")
def reseller_sas_token(user: dict = Depends(require_reseller)):
    """
    Returns per-container SAS URLs scoped to the reseller's active facilities.
    Each SAS token is read-only + list, valid for 24 hours.
    Account key fetched from Key Vault at runtime — never leaves Azure.
    """
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        raise HTTPException(status_code=403, detail="Reseller ID required")

    # Get this reseller's active facilities
    rows = query(
        f"""
        SELECT f.facility_code, f.blob_container
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        LEFT JOIN {SCHEMA}.clients cl ON f.client_id = cl.client_id
        WHERE f.status = 'active'
        AND (t.reseller_id = %s::uuid OR cl.reseller_id = %s::uuid)
        """,
        (reseller_id, reseller_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No active facilities found")

    try:
        from azure.identity import ManagedIdentityCredential
        from azure.keyvault.secrets import SecretClient
        from azure.storage.blob import generate_container_sas, ContainerSasPermissions

        credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)

        # Fetch storage account key from Key Vault
        kv_url = os.getenv("CLAIMSSYNC_KV_URI", "https://kv-claimssync-uae.vault.azure.net/")
        secret_client = SecretClient(vault_url=kv_url, credential=credential)
        account_key = secret_client.get_secret("storage-account-key").value

        now = datetime.now(timezone.utc)
        sas_expiry = now + timedelta(hours=24)
        account_name = STORAGE_URL.split("//")[1].split(".")[0]  # stclaimssyncuae

        containers = []
        for row in rows:
            container_name = row["blob_container"] or f"claimssync-{row['facility_code'].lower()}"
            sas = generate_container_sas(
                account_name=account_name,
                container_name=container_name,
                account_key=account_key,
                permission=ContainerSasPermissions(read=True, list=True),
                expiry=sas_expiry,
            )
            containers.append({
                "facility_code": row["facility_code"],
                "container": container_name,
                "sas_url": f"{STORAGE_URL}/{container_name}?{sas}",
                "expires_at": sas_expiry.isoformat(),
            })

        log.info("SAS tokens generated for reseller %s: %s",
                 user.get("email"), [c["facility_code"] for c in containers])

        return {
            "account_url": STORAGE_URL,
            "containers": containers,
            "expires_at": sas_expiry.isoformat(),
            "valid_hours": 24,
        }

    except Exception as exc:
        log.exception("SAS token generation failed for reseller %s", user.get("email"))
        raise HTTPException(status_code=500, detail=f"Failed to generate SAS token: {exc}")


# ── GET /reseller/storage/key ─────────────────────────────────────────────────

@router.get("/storage/key", summary="Get storage account key for direct blob access")
def reseller_storage_key(user: dict = Depends(require_reseller)):
    """
    Returns storage account key for direct BlobServiceClient access.
    Key is fetched from Key Vault at runtime — never stored on client.
    For ClaimSyncPull.py: key lives only in memory during the script run.
    """
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        raise HTTPException(status_code=403, detail="Reseller ID required")

    try:
        from azure.identity import ManagedIdentityCredential
        from azure.keyvault.secrets import SecretClient

        credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
        kv_url = os.getenv("CLAIMSSYNC_KV_URI", "https://kv-claimssync-uae.vault.azure.net/")
        secret_client = SecretClient(vault_url=kv_url, credential=credential)
        account_key = secret_client.get_secret("storage-account-key").value
        account_name = STORAGE_URL.split("//")[1].split(".")[0]

        log.info("Storage key issued to reseller %s (%s)", user.get("email"), reseller_id)

        return {
            "account_name": account_name,
            "account_url": STORAGE_URL,
            "account_key": account_key,
        }

    except Exception as exc:
        log.exception("Storage key fetch failed for reseller %s", user.get("email"))
        raise HTTPException(status_code=500, detail=f"Failed to fetch storage key: {exc}")


# ── Pydantic models ────────────────────────────────────────────────────────────

class FacilityProposal(BaseModel):
    facility_code:  str
    facility_name:  str
    payer_id:       Optional[str] = None
    plan_code:      str = "STARTER"
    lookback_days:  int = 90

class OnboardingRequest(BaseModel):
    tenant_name:         str
    contact_name:        str
    contact_email:       str
    contact_phone:       Optional[str] = None
    tenant_emirate:      Optional[str] = "Abu Dhabi"
    proposed_facilities: list[FacilityProposal]
    requested_plan_code: str = "STARTER"
    reseller_notes:      Optional[str] = None
    client_id:           Optional[str] = None  # existing client — NULL = create new


# ── GET /reseller/dashboard ───────────────────────────────────────────────────

@router.get("/dashboard", summary="Reseller home dashboard stats")
def reseller_dashboard(user: dict = Depends(require_reseller)):
    reseller_id = user["reseller_id"] if user["role"] == "reseller" else None

    # Total facilities under this reseller
    facility_stats = query_one(
        f"""
        SELECT
            COUNT(f.facility_id)                                    AS total_facilities,
            COUNT(f.facility_id) FILTER (WHERE f.status = 'active') AS active_facilities,
            COUNT(f.facility_id) FILTER (WHERE f.status = 'inactive') AS inactive_facilities
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        WHERE t.reseller_id = %s::uuid
        """,
        (reseller_id,)
    ) if reseller_id else query_one(
        f"""
        SELECT
            COUNT(*)                                             AS total_facilities,
            COUNT(*) FILTER (WHERE status = 'active')            AS active_facilities,
            COUNT(*) FILTER (WHERE status = 'inactive')          AS inactive_facilities
        FROM {SCHEMA}.tenant_facilities
        """,
        ()
    )

    # Last run per facility (most recent)
    last_runs = query(
        f"""
        SELECT DISTINCT ON (r.facility_id)
            r.facility_id::text,
            f.facility_code,
            f.facility_name,
            r.status,
            r.started_at,
            r.files_downloaded,
            r.engine_version
        FROM {SCHEMA}.sync_run_log r
        JOIN {SCHEMA}.tenant_facilities f ON r.facility_id = f.facility_id
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        { "WHERE t.reseller_id = %s::uuid" if reseller_id else "" }
        ORDER BY r.facility_id, r.started_at DESC
        """,
        (reseller_id,) if reseller_id else ()
    )

    # Pending onboarding requests
    pending = query_one(
        f"""
        SELECT COUNT(*) AS cnt
        FROM {SCHEMA}.onboarding_requests
        WHERE reseller_id = %s::uuid
        AND status IN ('draft','submitted','reviewing')
        """,
        (reseller_id,)
    ) if reseller_id else {"cnt": 0}

    # Subscriptions expiring in 30 days
    expiring = query(
        f"""
        SELECT
            f.facility_code,
            f.facility_name,
            fs.valid_until,
            fs.status AS sub_status,
            EXTRACT(DAY FROM (fs.valid_until - NOW()))::int AS days_remaining
        FROM {SCHEMA}.facility_subscriptions fs
        JOIN {SCHEMA}.tenant_facilities f ON fs.facility_id = f.facility_id
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        WHERE fs.valid_until IS NOT NULL
        AND fs.valid_until <= NOW() + INTERVAL '30 days'
        { "AND t.reseller_id = %s::uuid" if reseller_id else "" }
        ORDER BY fs.valid_until ASC
        """,
        (reseller_id,) if reseller_id else ()
    )

    return {
        "facilities":     facility_stats,
        "last_runs":      last_runs,
        "pending_onboarding": pending.get("cnt", 0) if pending else 0,
        "expiring_soon":  expiring,
    }


# ── GET /reseller/facilities ──────────────────────────────────────────────────

@router.get("/facilities", summary="All facilities under reseller")
def list_reseller_facilities(user: dict = Depends(require_reseller)):
    # v2.7 scope fix: a reseller sees ONLY facilities whose tenant was created
    # from an approved onboarding_request submitted by this reseller_id.
    #
    # Why not tenants.reseller_id (prior behaviour):
    #   tenants.reseller_id is mutable — rewritten by the admin reassign-tenant
    #   endpoint and by direct DB edits. Using it as the scope gate let a
    #   reseller see facilities they had no role in onboarding if a tenant was
    #   ever reassigned to them, and hid facilities they DID onboard if a
    #   tenant was reassigned away.
    #
    # The onboarding_requests row with status='approved' is the immutable
    # record of who brought a tenant (and therefore its facilities) onto the
    # platform. tenant_facilities has no direct reseller FK, so the trace goes
    # reseller → onboarding_requests → tenant_id → tenant_facilities.
    #
    # EXISTS is correct here (not JOIN): a single tenant may have multiple
    # approved onboarding_requests from the same reseller (re-onboarding,
    # migration) — a JOIN would duplicate the facility row.
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        # Shouldn't happen — require_reseller enforces auth — but fail closed.
        return []

    rows = query(
        f"""
        SELECT
            f.facility_id::text,
            f.facility_code,
            f.facility_name,
            f.status,
            f.blob_container,
            f.lookback_days,
            t.name          AS tenant_name,
            t.short_code    AS tenant_code,
            cl.client_code,
            cl.client_name,
            cl.client_id::text AS client_id,
            fs.status       AS subscription_status,
            fs.valid_until,
            fs.trial_until,
            sp.name         AS plan_name,
            sp.price_aed_per_facility_month AS price_aed,
            -- Last run
            lr.started_at   AS last_run_at,
            lr.status       AS last_run_status,
            lr.files_downloaded AS last_run_files
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        LEFT JOIN {SCHEMA}.clients cl ON f.client_id = cl.client_id
        LEFT JOIN {SCHEMA}.facility_subscriptions fs ON fs.facility_id = f.facility_id
        LEFT JOIN {SCHEMA}.subscription_plans sp ON sp.plan_id = fs.plan_id
        LEFT JOIN LATERAL (
            SELECT started_at, status, files_downloaded
            FROM {SCHEMA}.sync_run_log
            WHERE facility_id = f.facility_id
            ORDER BY started_at DESC LIMIT 1
        ) lr ON TRUE
        WHERE EXISTS (
            SELECT 1
              FROM {SCHEMA}.onboarding_requests orq
             WHERE orq.tenant_id   = f.tenant_id
               AND orq.reseller_id = %s::uuid
               AND orq.status      = 'approved'
        )
        ORDER BY cl.client_name NULLS LAST, f.facility_code
        """,
        (reseller_id,)
    )
    return rows


# ── GET /reseller/facilities/:id ──────────────────────────────────────────────

@router.get("/facilities/{facility_id}", summary="Single facility detail")
def get_reseller_facility(
    facility_id: str = Path(...),
    user: dict = Depends(require_reseller)
):
    # v2.7 scope fix: gate via approved onboarding_request, not tenants.reseller_id.
    # Same rationale as list_reseller_facilities — see comment there.
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        raise HTTPException(status_code=403, detail="Reseller ID required")

    row = query_one(
        f"""
        SELECT
            f.facility_id::text,
            f.facility_code,
            f.facility_name,
            f.status,
            f.blob_container,
            f.lookback_days,
            f.kv_secret_prefix,
            t.name AS tenant_name
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        WHERE f.facility_id = %s::uuid
          AND EXISTS (
              SELECT 1
                FROM {SCHEMA}.onboarding_requests orq
               WHERE orq.tenant_id   = f.tenant_id
                 AND orq.reseller_id = %s::uuid
                 AND orq.status      = 'approved'
          )
        """,
        (facility_id, reseller_id)
    )

    if not row:
        raise HTTPException(status_code=404, detail="Facility not found")

    # Last 10 runs
    runs = query(
        f"""
        SELECT run_id::text, started_at, ended_at, status,
               files_downloaded, intervals_completed, engine_version
        FROM {SCHEMA}.sync_run_log
        WHERE facility_id = %s::uuid
        ORDER BY started_at DESC LIMIT 10
        """,
        (facility_id,)
    )

    return {**row, "recent_runs": runs}


# ── GET /reseller/clients ─────────────────────────────────────────────────────

@router.get("/clients", summary="Reseller's clients with facility count")
def list_reseller_clients(user: dict = Depends(require_reseller)):
    reseller_id = user.get("reseller_id")
    return query(
        f"""
        SELECT
            c.client_id::text,
            c.client_code,
            c.client_name,
            c.plan,
            c.status,
            c.contact_email,
            c.created_at,
            COUNT(f.facility_id) AS facility_count
        FROM {SCHEMA}.clients c
        LEFT JOIN {SCHEMA}.tenant_facilities f ON f.client_id = c.client_id
        {"WHERE c.reseller_id = %s::uuid" if reseller_id else ""}
        GROUP BY c.client_id
        ORDER BY c.client_name
        """,
        (reseller_id,) if reseller_id else ()
    )


@router.post("/clients", summary="Create new client under reseller")
def create_reseller_client(
    body: dict = Body(...),
    user: dict = Depends(require_reseller)
):
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        raise HTTPException(status_code=403, detail="Reseller ID required")

    client_code = body.get("client_code", "").strip().upper()
    client_name = body.get("client_name", "").strip()
    if not client_code or not client_name:
        raise HTTPException(status_code=400, detail="client_code and client_name required")

    # Get default tenant for this reseller
    tenant = query_one(
        f"SELECT tenant_id FROM {SCHEMA}.tenants WHERE reseller_id = %s::uuid LIMIT 1",
        (reseller_id,)
    )
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant found for reseller")

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.clients (
                reseller_id, tenant_id, client_code, client_name,
                contact_name, contact_email, contact_phone, billing_email,
                plan, status
            ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, 'active')
            RETURNING client_id::text
            """,
            (
                reseller_id, tenant["tenant_id"],
                client_code, client_name,
                body.get("contact_name"), body.get("contact_email"),
                body.get("contact_phone"), body.get("billing_email"),
                body.get("plan", "starter"),
            )
        )
        result = cur.fetchone()

    return {"status": "created", "client_id": result[0], "client_code": client_code}


# ── GET /reseller/onboarding ──────────────────────────────────────────────────

@router.get("/onboarding", summary="List reseller's onboarding requests")
def list_onboarding(user: dict = Depends(require_reseller)):
    reseller_id = user.get("reseller_id")

    rows = query(
        f"""
        SELECT
            request_id::text,
            tenant_name,
            contact_name,
            contact_email,
            status,
            proposed_facilities,
            requested_plan_code,
            submitted_at,
            reviewed_at,
            review_notes,
            rejection_reason,
            created_at
        FROM {SCHEMA}.onboarding_requests
        { "WHERE reseller_id = %s::uuid" if reseller_id else "" }
        ORDER BY created_at DESC
        """,
        (reseller_id,) if reseller_id else ()
    )
    return rows


# ── POST /reseller/onboarding ─────────────────────────────────────────────────

@router.post("/onboarding", summary="Submit new onboarding request")
def submit_onboarding(
    body: OnboardingRequest,
    user: dict = Depends(require_reseller)
):
    reseller_id = user.get("reseller_id")
    if not reseller_id:
        raise HTTPException(status_code=403, detail="Reseller ID required")

    # Get default service provider (Shafafiya)
    sp = query_one(
        f"SELECT provider_id FROM {SCHEMA}.service_providers WHERE code = 'SHAFAFIYA' LIMIT 1",
        ()
    )
    if not sp:
        raise HTTPException(status_code=500, detail="Service provider not found")

    import json
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.onboarding_requests (
                reseller_id, service_provider_id,
                tenant_name, tenant_short_code,
                tenant_emirate, tenant_country,
                contact_name, contact_email, contact_phone,
                proposed_facilities, requested_plan_code,
                reseller_notes, client_id, status
            ) VALUES (
                %s::uuid, %s::uuid,
                %s, %s,
                %s, 'UAE',
                %s, %s, %s,
                %s::jsonb, %s,
                %s, %s::uuid, 'submitted'
            )
            RETURNING request_id::text
            """,
            (
                reseller_id, sp["provider_id"],
                body.tenant_name,
                body.tenant_name.upper().replace(" ", "-")[:20],
                body.tenant_emirate,
                body.contact_name, body.contact_email, body.contact_phone,
                json.dumps([f.dict() for f in body.proposed_facilities]),
                body.requested_plan_code,
                body.reseller_notes,
                body.client_id,
            )
        )
        result = cur.fetchone()

    return {
        "status": "submitted",
        "request_id": result[0],
        "message": "Onboarding request submitted. Kaaryaa will review within 1 business day."
    }


# ── GET /reseller/onboarding/:id ──────────────────────────────────────────────

@router.get("/onboarding/{request_id}", summary="Single onboarding request")
def get_onboarding(
    request_id: str = Path(...),
    user: dict = Depends(require_reseller)
):
    reseller_id = user.get("reseller_id")

    row = query_one(
        f"""
        SELECT
            request_id::text,
            tenant_name, contact_name, contact_email,
            status, proposed_facilities,
            requested_plan_code, reseller_notes,
            submitted_at, reviewed_at, review_notes,
            rejection_reason, approved_at, created_at
        FROM {SCHEMA}.onboarding_requests
        WHERE request_id = %s::uuid
        { "AND reseller_id = %s::uuid" if reseller_id else "" }
        """,
        (request_id, reseller_id) if reseller_id else (request_id,)
    )

    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


# ── GET /reseller/facilities/{code}/runs ─────────────────────────────────────

@router.get("/facilities/{facility_code}/runs", summary="Last 10 runs for reseller's facility")
def reseller_facility_runs(
    facility_code: str = Path(...),
    user: dict = Depends(require_reseller),
):
    reseller_id = user.get("reseller_id")
    facility = _get_reseller_facility(facility_code, reseller_id)

    rows = query(
        f"""
        SELECT r.run_id::text, r.started_at, r.ended_at, r.status,
               r.files_downloaded,
               r.search_from_date AS from_date, r.search_to_date AS to_date,
               r.engine_version, r.intervals_total, r.intervals_completed, r.trigger_type,
               -- v2.10: currently-processing interval window (engine :3.17+).
               r.current_interval_from, r.current_interval_to,
               -- v2.9: live counters from child tables (engine doesn't update
               -- sync_run_log mid-run; file_manifest + sync_run_intervals do tick).
               (SELECT COUNT(*) FROM {SCHEMA}.file_manifest      fm WHERE fm.run_id = r.run_id) AS live_files_count,
               (SELECT COUNT(*) FROM {SCHEMA}.sync_run_intervals si WHERE si.run_id = r.run_id) AS live_intervals_count
        FROM {SCHEMA}.sync_run_log r
        WHERE r.facility_id = %s
        ORDER BY r.started_at DESC LIMIT 10
        """,
        (facility["facility_id"],),
    )
    for r in rows:
        for k in ("started_at", "ended_at", "from_date", "to_date"):
            if r.get(k) and hasattr(r[k], "isoformat"):
                r[k] = r[k].isoformat()

    return {"facility_code": facility["facility_code"], "facility_name": facility["facility_name"], "runs": rows}


# ── GET /reseller/facilities/{code}/runs/{run_id}/files ──────────────────────

@router.get("/facilities/{facility_code}/runs/{run_id}/files", summary="Files for a run (reseller)")
def reseller_run_files(
    facility_code: str = Path(...),
    run_id: str = Path(...),
    user: dict = Depends(require_reseller),
):
    _get_reseller_facility(facility_code, user.get("reseller_id"))

    rows = query(
        f"""
        SELECT manifest_id::text AS file_id, file_name, file_type, file_size_bytes,
               blob_url AS blob_path, downloaded_at AS uploaded_at, created_at
        FROM {SCHEMA}.file_manifest
        WHERE run_id = %s::uuid
        ORDER BY created_at
        """,
        (run_id,),
    )
    for r in rows:
        for k in ("uploaded_at", "created_at"):
            if r.get(k) and hasattr(r[k], "isoformat"):
                r[k] = r[k].isoformat()

    return {"run_id": run_id, "files": rows, "total": len(rows)}


# ── GET /reseller/facilities/{code}/runs/{run_id}/intervals ──────────────────

@router.get("/facilities/{facility_code}/runs/{run_id}/intervals", summary="Intervals for a run (reseller)")
def reseller_run_intervals(
    facility_code: str = Path(...),
    run_id: str = Path(...),
    user: dict = Depends(require_reseller),
):
    facility_code = facility_code.upper()
    _get_reseller_facility(facility_code, user.get("reseller_id"))

    try:
        container = _get_blob_container_client(facility_code)
        blobs = list(container.list_blobs(name_starts_with="search_history/"))
    except Exception as exc:
        log.warning(f"Blob list failed for {facility_code}: {exc}")
        blobs = []

    pattern = re.compile(
        rf"search_history/search_history_(request|response)_{re.escape(facility_code)}_(\w+)_(\d+)\.xml",
        re.IGNORECASE,
    )
    intervals_map: dict[str, dict] = {}
    for blob in blobs:
        m = pattern.match(blob.name)
        if not m:
            continue
        kind, ftype, idx_s = m.group(1), m.group(2), int(m.group(3))
        key = f"{ftype}_{idx_s}"
        if key not in intervals_map:
            intervals_map[key] = {
                "interval_index": idx_s, "type": ftype,
                "from_time": None, "to_time": None, "files_found": None,
                "request_blob": None, "response_blob": None,
                "request_exists": False, "response_exists": False,
            }
        blob_fn = os.path.basename(blob.name)
        if kind == "request":
            intervals_map[key]["request_blob"] = f"search_history/{blob_fn}"
            intervals_map[key]["request_exists"] = True
        else:
            intervals_map[key]["response_blob"] = f"search_history/{blob_fn}"
            intervals_map[key]["response_exists"] = True

    re_from = re.compile(r"<v2:transactionFromDate>([^<]+)</v2:transactionFromDate>")
    re_to   = re.compile(r"<v2:transactionToDate>([^<]+)</v2:transactionToDate>")
    re_files = re.compile(r"FileID='")
    for key, intv in intervals_map.items():
        try:
            if intv["request_exists"] and intv["request_blob"]:
                xml = container.get_blob_client(intv["request_blob"]).download_blob().readall().decode("utf-8", errors="replace")
                m_from = re_from.search(xml)
                m_to = re_to.search(xml)
                if m_from: intv["from_time"] = m_from.group(1)
                if m_to:   intv["to_time"] = m_to.group(1)
            if intv["response_exists"] and intv["response_blob"]:
                xml = container.get_blob_client(intv["response_blob"]).download_blob().readall().decode("utf-8", errors="replace")
                intv["files_found"] = len(re_files.findall(xml))
        except Exception as exc:
            log.warning(f"Interval parse error for {key}: {exc}")

    result = sorted(intervals_map.values(), key=lambda x: (x["type"], x["interval_index"]))
    return {"run_id": run_id, "facility_code": facility_code, "intervals": result}


# ── GET /reseller/facilities/{code}/search-history/{filename} ────────────────

@router.get("/facilities/{facility_code}/search-history/{blob_filename}", summary="Raw XML (reseller)")
def reseller_search_history_xml(
    facility_code: str = Path(...),
    blob_filename: str = Path(...),
    user: dict = Depends(require_reseller),
):
    facility_code = facility_code.upper()
    _get_reseller_facility(facility_code, user.get("reseller_id"))

    if ".." in blob_filename or "/" in blob_filename or "\\" in blob_filename:
        raise HTTPException(status_code=400, detail="Invalid blob filename")

    blob_path = f"search_history/{blob_filename}"
    try:
        container = _get_blob_container_client(facility_code)
        data = container.get_blob_client(blob_path).download_blob().readall()
        return Response(content=data, media_type="text/xml; charset=utf-8")
    except Exception as exc:
        log.warning(f"Blob fetch failed: {blob_path}: {exc}")
        raise HTTPException(status_code=404, detail=f"Blob not found: {blob_filename}")


# ── POST /reseller/facilities/{code}/adhoc-run ──────────────────────────────

class ResellerAdhocRunRequest(BaseModel):
    from_datetime: str
    to_datetime: str

@router.post("/facilities/{facility_code}/adhoc-run", summary="Trigger adhoc run (reseller)")
def reseller_trigger_adhoc_run(
    facility_code: str = Path(...),
    body: ResellerAdhocRunRequest = Body(...),
    user: dict = Depends(require_reseller),
):
    facility_code = facility_code.upper()
    facility = _get_reseller_facility(facility_code, user.get("reseller_id"))

    # Validate datetimes
    for val, field in [(body.from_datetime, "from_datetime"), (body.to_datetime, "to_datetime")]:
        ok = False
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d'):
            try:
                datetime.strptime(val, fmt)
                ok = True
                break
            except ValueError:
                continue
        if not ok:
            raise HTTPException(status_code=422, detail=f"Invalid {field}: '{val}'. Use YYYY-MM-DD or YYYY-MM-DD HH:MM")

    try:
        from azure.identity import ManagedIdentityCredential
        from azure.mgmt.appcontainers import ContainerAppsAPIClient
        from azure.mgmt.appcontainers.models import JobExecutionTemplate, JobExecutionContainer, EnvironmentVar

        credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
        client = ContainerAppsAPIClient(credential, SUBSCRIPTION_ID)

        job = client.jobs.get(RESOURCE_GROUP, ENGINE_JOB_NAME)
        current_container = job.template.containers[0]
        current_env = {e.name: e for e in (current_container.env or [])}
        current_env["CLAIMSSYNC_ADHOC_FROM"] = EnvironmentVar(name="CLAIMSSYNC_ADHOC_FROM", value=body.from_datetime)
        current_env["CLAIMSSYNC_ADHOC_TO"] = EnvironmentVar(name="CLAIMSSYNC_ADHOC_TO", value=body.to_datetime)
        current_env["CLAIMSSYNC_ADHOC_FACILITY"] = EnvironmentVar(name="CLAIMSSYNC_ADHOC_FACILITY", value=facility_code)

        template = JobExecutionTemplate(containers=[
            JobExecutionContainer(
                name=current_container.name, image=current_container.image,
                env=list(current_env.values()), resources=current_container.resources,
            )
        ])
        client.jobs.begin_start(resource_group_name=RESOURCE_GROUP, job_name=ENGINE_JOB_NAME, template=template)

        log.info("Reseller adhoc run triggered for %s by %s: from=%s to=%s",
                 facility_code, user.get("email"), body.from_datetime, body.to_datetime)
        return {
            "run_triggered": True, "facility_code": facility_code,
            "facility_name": facility["facility_name"],
            "from_datetime": body.from_datetime, "to_datetime": body.to_datetime,
            "message": f"Adhoc run started for {facility_code} ({body.from_datetime} -> {body.to_datetime})",
        }
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Reseller adhoc run trigger failed for %s", facility_code)
        raise HTTPException(status_code=500, detail=f"Failed to trigger adhoc run: {exc}")
