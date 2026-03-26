"""
routers/reseller.py — Reseller portal API endpoints
----------------------------------------------------
All endpoints require valid reseller JWT (Bearer token).
Resellers can only see data scoped to their own tenants/facilities.

GET  /reseller/dashboard          — stats summary for Saleem's portal home
GET  /reseller/facilities         — all facilities under reseller's tenants
GET  /reseller/facilities/:id     — single facility with last run + file count
GET  /reseller/onboarding         — list reseller's onboarding requests
POST /reseller/onboarding         — submit new onboarding request
GET  /reseller/onboarding/:id     — single request status
"""

from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, Path, Body, HTTPException
from pydantic import BaseModel

from ..db import query, query_one, SCHEMA
from .auth import require_reseller

router = APIRouter()


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
    reseller_id = user.get("reseller_id")

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
        LEFT JOIN {SCHEMA}.facility_subscriptions fs ON fs.facility_id = f.facility_id
        LEFT JOIN {SCHEMA}.subscription_plans sp ON sp.plan_id = fs.plan_id
        LEFT JOIN LATERAL (
            SELECT started_at, status, files_downloaded
            FROM {SCHEMA}.sync_run_log
            WHERE facility_id = f.facility_id
            ORDER BY started_at DESC LIMIT 1
        ) lr ON TRUE
        { "WHERE t.reseller_id = %s::uuid" if reseller_id else "" }
        ORDER BY f.facility_code
        """,
        (reseller_id,) if reseller_id else ()
    )
    return rows


# ── GET /reseller/facilities/:id ──────────────────────────────────────────────

@router.get("/facilities/{facility_id}", summary="Single facility detail")
def get_reseller_facility(
    facility_id: str = Path(...),
    user: dict = Depends(require_reseller)
):
    reseller_id = user.get("reseller_id")

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
        { "AND t.reseller_id = %s::uuid" if reseller_id else "" }
        """,
        (facility_id, reseller_id) if reseller_id else (facility_id,)
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

    from ..db import get_db
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
                reseller_notes, status
            ) VALUES (
                %s::uuid, %s::uuid,
                %s, %s,
                %s, 'UAE',
                %s, %s, %s,
                %s::jsonb, %s,
                %s, 'submitted'
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
