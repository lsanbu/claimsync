"""
routers/admin.py — Kaaryaa Admin portal API
--------------------------------------------
All endpoints require valid admin JWT.
Super-admin-only endpoints additionally check is_super_admin flag.

GET  /admin/dashboard              — platform stats overview
GET  /admin/onboarding             — all onboarding requests
GET  /admin/onboarding/:id         — single request detail
PUT  /admin/onboarding/:id/approve — approve + provision
PUT  /admin/onboarding/:id/reject  — reject with reason
GET  /admin/resellers              — all resellers
POST /admin/resellers              — create reseller [super]
GET  /admin/facilities             — all facilities across tenants
GET  /admin/users                  — admin users list [super]
POST /admin/users                  — create admin user [super]
PUT  /admin/users/:id              — update admin user [super]
GET  /admin/revenue                — subscription + billing overview
"""

from __future__ import annotations
import os
import logging
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, Path, Body, HTTPException
from pydantic import BaseModel

from ..db import query, query_one, get_db, SCHEMA
from .auth import require_admin, require_super_admin
from .credentials import create_and_send_credential_token

router = APIRouter()
log    = logging.getLogger(__name__)


# ── Pydantic models ────────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    review_notes:      Optional[str] = None
    trial_days_granted: int = 30

class RejectRequest(BaseModel):
    rejection_reason: str
    review_notes:     Optional[str] = None

class CreateReseller(BaseModel):
    name:            str
    short_code:      str
    contact_name:    str
    contact_email:   str
    contact_phone:   Optional[str] = None
    emirate:         Optional[str] = "Abu Dhabi"
    commission_pct:  float = 15.0
    max_facilities:  Optional[int] = None
    login_email:     str
    password:        str   # plain — will be hashed

class CreateAdminUser(BaseModel):
    name:           str
    email:          str
    password:       str
    is_super_admin: bool = False


# ── GET /admin/dashboard ──────────────────────────────────────────────────────

@router.get("/dashboard", summary="Platform overview stats")
def admin_dashboard(user: dict = Depends(require_admin)):
    stats = query_one(
        f"""
        SELECT
            (SELECT COUNT(*) FROM {SCHEMA}.tenants)               AS total_tenants,
            (SELECT COUNT(*) FROM {SCHEMA}.tenant_facilities)      AS total_facilities,
            (SELECT COUNT(*) FROM {SCHEMA}.tenant_facilities
             WHERE status = 'active')                              AS active_facilities,
            (SELECT COUNT(*) FROM {SCHEMA}.resellers
             WHERE status = 'active')                             AS active_resellers,
            (SELECT COUNT(*) FROM {SCHEMA}.onboarding_requests
             WHERE status IN ('submitted','reviewing'))            AS pending_approvals,
            (SELECT COUNT(*) FROM {SCHEMA}.onboarding_requests
             WHERE status = 'approved')                           AS approved_total,
            (SELECT COUNT(*) FROM {SCHEMA}.sync_run_log
             WHERE started_at >= NOW() - INTERVAL '24 hours')     AS runs_today,
            (SELECT COALESCE(SUM(files_downloaded),0)
             FROM {SCHEMA}.sync_run_log
             WHERE started_at >= NOW() - INTERVAL '24 hours')     AS files_today
        """, ()
    )

    # Recent onboarding requests
    recent = query(
        f"""
        SELECT r.request_id::text, r.tenant_name, r.status,
               r.contact_email, r.created_at, r.submitted_at,
               rs.name AS reseller_name
        FROM {SCHEMA}.onboarding_requests r
        JOIN {SCHEMA}.resellers rs ON r.reseller_id = rs.reseller_id
        ORDER BY r.created_at DESC LIMIT 5
        """, ()
    )

    # Expiring subscriptions
    expiring = query(
        f"""
        SELECT f.facility_code, f.facility_name,
               fs.valid_until,
               EXTRACT(DAY FROM (fs.valid_until - NOW()))::int AS days_remaining,
               t.name AS tenant_name
        FROM {SCHEMA}.facility_subscriptions fs
        JOIN {SCHEMA}.tenant_facilities f ON fs.facility_id = f.facility_id
        JOIN {SCHEMA}.tenants t ON f.tenant_id = t.tenant_id
        WHERE fs.valid_until IS NOT NULL
          AND fs.valid_until <= NOW() + INTERVAL '30 days'
        ORDER BY fs.valid_until ASC
        LIMIT 10
        """, ()
    )

    return {
        "stats":    stats,
        "recent_onboarding": recent,
        "expiring_subscriptions": expiring,
    }


# ── GET /admin/onboarding ─────────────────────────────────────────────────────

@router.get("/onboarding", summary="All onboarding requests")
def list_onboarding(
    status: Optional[str] = None,
    user:   dict = Depends(require_admin)
):
    where  = "WHERE r.status = %s" if status else ""
    params = (status,) if status else ()

    rows = query(
        f"""
        SELECT
            r.request_id::text,
            r.tenant_name,
            r.contact_name,
            r.contact_email,
            r.status,
            r.requested_plan_code,
            r.proposed_facilities,
            r.submitted_at,
            r.reviewed_at,
            r.reviewed_by,
            r.review_notes,
            r.rejection_reason,
            r.approved_at,
            r.created_at,
            rs.name        AS reseller_name,
            rs.short_code  AS reseller_code,
            rs.contact_email AS reseller_email
        FROM {SCHEMA}.onboarding_requests r
        JOIN {SCHEMA}.resellers rs ON r.reseller_id = rs.reseller_id
        {where}
        ORDER BY
            CASE r.status
                WHEN 'submitted' THEN 1
                WHEN 'reviewing' THEN 2
                WHEN 'draft'     THEN 3
                ELSE 4
            END,
            r.created_at DESC
        """,
        params
    )
    return rows


# ── GET /admin/onboarding/:id ─────────────────────────────────────────────────

@router.get("/onboarding/{request_id}", summary="Single onboarding request")
def get_onboarding(
    request_id: str = Path(...),
    user: dict = Depends(require_admin)
):
    row = query_one(
        f"""
        SELECT
            r.*,
            r.request_id::text AS request_id,
            r.reseller_id::text AS reseller_id,
            r.tenant_id::text AS tenant_id,
            rs.name AS reseller_name, rs.short_code AS reseller_code,
            rs.contact_email AS reseller_email, rs.contact_phone AS reseller_phone,
            (SELECT f.facility_id::text
             FROM {SCHEMA}.tenant_facilities f
             WHERE f.tenant_id = r.tenant_id AND f.status = 'active'
             ORDER BY f.created_at LIMIT 1
            ) AS facility_id
        FROM {SCHEMA}.onboarding_requests r
        JOIN {SCHEMA}.resellers rs ON r.reseller_id = rs.reseller_id
        WHERE r.request_id = %s::uuid
        """,
        (request_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


# ── PUT /admin/onboarding/:id/approve ────────────────────────────────────────

@router.put("/onboarding/{request_id}/approve", summary="Approve onboarding request")
def approve_onboarding(
    request_id: str = Path(...),
    body: ApproveRequest = Body(...),
    user: dict = Depends(require_admin)
):
    req = query_one(
        f"SELECT * FROM {SCHEMA}.onboarding_requests WHERE request_id = %s::uuid",
        (request_id,)
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] not in ("submitted", "reviewing", "draft"):
        raise HTTPException(status_code=400, detail=f"Cannot approve — current status: {req['status']}")

    import json
    conn = get_db()
    with conn.cursor() as cur:

        # 1. Create tenant
        short_code = req["tenant_short_code"] or req["tenant_name"].upper().replace(" ","-")[:20]
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.tenants (
                reseller_id, name, short_code, legal_name,
                contact_name, contact_email, contact_phone,
                country, emirate, status
            ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, 'UAE', %s, 'active')
            ON CONFLICT (short_code) DO UPDATE SET name = EXCLUDED.name
            RETURNING tenant_id
            """,
            (
                req["reseller_id"], req["tenant_name"], short_code, req["tenant_name"],
                req["contact_name"], req["contact_email"], req["contact_phone"],
                req["tenant_emirate"] or "Abu Dhabi",
            )
        )
        tenant_id = cur.fetchone()[0]

        # 2. Get service provider + default plan
        cur.execute(
            f"SELECT provider_id FROM {SCHEMA}.service_providers WHERE code='SHAFAFIYA' LIMIT 1"
        )
        provider_id = cur.fetchone()[0]

        cur.execute(
            f"SELECT plan_id FROM {SCHEMA}.subscription_plans WHERE code=%s LIMIT 1",
            (req["requested_plan_code"] or "STARTER",)
        )
        plan_row = cur.fetchone()
        plan_id  = plan_row[0] if plan_row else None

        # 3. Create facilities from proposed_facilities JSONB
        facilities = req["proposed_facilities"]
        if isinstance(facilities, str):
            facilities = json.loads(facilities)

        for fac in facilities:
            fc = fac.get("facility_code","").upper()
            if not fc:
                continue
            kv_prefix = f"facility-{fc.lower()}"
            blob_cont = f"claimssync-{fc.lower()}"

            # Check if facility already exists
            cur.execute(
                f"SELECT facility_id FROM {SCHEMA}.tenant_facilities WHERE facility_code = %s",
                (fc,)
            )
            existing = cur.fetchone()

            if existing:
                # Reactivate existing facility
                cur.execute(
                    f"""
                    UPDATE {SCHEMA}.tenant_facilities
                    SET status = 'active', tenant_id = %s, updated_at = NOW()
                    WHERE facility_code = %s
                    RETURNING facility_id
                    """,
                    (tenant_id, fc)
                )
                fac_row = cur.fetchone()
            else:
                # Create new facility as active
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.tenant_facilities (
                        tenant_id, service_provider_id,
                        facility_code, facility_name,
                        blob_container, kv_secret_prefix,
                        lookback_days, status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'active')
                    RETURNING facility_id
                    """,
                    (
                        tenant_id, provider_id,
                        fc, fac.get("facility_name", fc),
                        blob_cont, kv_prefix,
                        fac.get("lookback_days", 90),
                    )
                )
                fac_row = cur.fetchone()
            if fac_row and plan_id:
                facility_id = fac_row[0]
                from datetime import date, timedelta
                trial_until = date.today() + timedelta(days=body.trial_days_granted)
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.facility_subscriptions (
                        facility_id, plan_id,
                        trial_until, valid_from,
                        billing_cycle, status, approved_by, approved_at
                    ) VALUES (%s, %s, %s, CURRENT_DATE, 'monthly', 'trial', %s, NOW())
                    ON CONFLICT DO NOTHING
                    """,
                    (facility_id, plan_id, trial_until, user.get("name","Kaaryaa Admin"))
                )

        # 4. Update onboarding request (before token creation — token helper updates it too)
        cur.execute(
            f"""
            UPDATE {SCHEMA}.onboarding_requests SET
                status             = 'approved',
                reviewed_by        = %s,
                reviewed_at        = NOW(),
                approved_at        = NOW(),
                trial_days_granted = %s,
                review_notes       = %s,
                tenant_id          = %s
            WHERE request_id = %s::uuid
            """,
            (
                user.get("name","Kaaryaa Admin"),
                body.trial_days_granted,
                body.review_notes,
                tenant_id,
                request_id,
            )
        )

    # 5. Generate credential token + send email for the first facility
    credential_result = None
    if facilities:
        first_fac = facilities[0]
        fc = first_fac.get("facility_code", "").upper()
        if fc:
            fid_row = query_one(
                f"SELECT facility_id FROM {SCHEMA}.tenant_facilities WHERE facility_code = %s",
                (fc,),
            )
            if fid_row:
                credential_result = create_and_send_credential_token(
                    facility_id=str(fid_row["facility_id"]),
                    facility_code=fc,
                    facility_name=first_fac.get("facility_name", fc),
                    request_id=request_id,
                    send_to_email=req["contact_email"],
                    created_by=user.get("email", "admin"),
                )

    log.info(f"Onboarding approved: {req['tenant_name']} by {user.get('email')}")
    result = {
        "status":    "approved",
        "tenant_id": str(tenant_id),
        "message":   f"{req['tenant_name']} approved. {len(facilities)} facility/ies provisioned (active)."
    }
    if credential_result:
        result["credential_url"] = credential_result["credential_url"]
        result["email_sent"] = credential_result["email_sent"]
        result["credential_expires_at"] = credential_result["expires_at"]
    return result


# ── PUT /admin/onboarding/:id/reject ─────────────────────────────────────────

@router.put("/onboarding/{request_id}/reject", summary="Reject onboarding request")
def reject_onboarding(
    request_id: str = Path(...),
    body: RejectRequest = Body(...),
    user: dict = Depends(require_admin)
):
    req = query_one(
        f"SELECT status, tenant_name FROM {SCHEMA}.onboarding_requests WHERE request_id=%s::uuid",
        (request_id,)
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] == "approved":
        raise HTTPException(status_code=400, detail="Cannot reject an already approved request")

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE {SCHEMA}.onboarding_requests SET
                status           = 'rejected',
                reviewed_by      = %s,
                reviewed_at      = NOW(),
                review_notes     = %s,
                rejection_reason = %s
            WHERE request_id = %s::uuid
            """,
            (user.get("name"), body.review_notes, body.rejection_reason, request_id)
        )

    log.info(f"Onboarding rejected: {req['tenant_name']} by {user.get('email')}")
    return {"status": "rejected", "message": f"{req['tenant_name']} request rejected."}


# ── GET /admin/resellers ──────────────────────────────────────────────────────

@router.get("/resellers", summary="All resellers")
def list_resellers(user: dict = Depends(require_admin)):
    return query(
        f"""
        SELECT
            r.reseller_id::text,
            r.name, r.short_code, r.level,
            r.contact_name, r.contact_email,
            r.login_email, r.last_login_at,
            r.commission_pct, r.status,
            r.emirate, r.country,
            r.max_facilities,
            COUNT(DISTINCT t.tenant_id)  AS tenant_count,
            COUNT(DISTINCT f.facility_id) AS facility_count
        FROM {SCHEMA}.resellers r
        LEFT JOIN {SCHEMA}.tenants t ON t.reseller_id = r.reseller_id
        LEFT JOIN {SCHEMA}.tenant_facilities f ON f.tenant_id = t.tenant_id
        GROUP BY r.reseller_id
        ORDER BY r.name
        """, ()
    )


# ── POST /admin/resellers — super admin only ──────────────────────────────────

@router.post("/resellers", summary="Create reseller [super admin]")
def create_reseller(
    body: CreateReseller,
    user: dict = Depends(require_super_admin)
):
    try:
        import bcrypt
        pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    except ImportError:
        raise HTTPException(status_code=503, detail="bcrypt not installed")

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.resellers (
                level, name, short_code,
                contact_name, contact_email, contact_phone,
                country, emirate,
                commission_pct, max_facilities,
                login_email, password_hash,
                status, authorized_providers
            ) VALUES (
                'master', %s, %s,
                %s, %s, %s,
                'UAE', %s,
                %s, %s,
                %s, %s,
                'active', ARRAY['SHAFAFIYA']
            ) RETURNING reseller_id::text
            """,
            (
                body.name, body.short_code.upper(),
                body.contact_name, body.contact_email, body.contact_phone,
                body.emirate,
                body.commission_pct, body.max_facilities,
                body.login_email.lower(), pw_hash,
            )
        )
        reseller_id = cur.fetchone()[0]

    return {"status": "created", "reseller_id": reseller_id, "name": body.name}


# ── GET /admin/facilities ─────────────────────────────────────────────────────

@router.get("/facilities", summary="All facilities across all tenants")
def list_all_facilities(user: dict = Depends(require_admin)):
    return query(
        f"""
        SELECT
            f.facility_id::text,
            f.facility_code,
            f.facility_name,
            f.status,
            f.blob_container,
            f.kv_secret_prefix,
            t.name          AS tenant_name,
            t.short_code    AS tenant_code,
            rs.name         AS reseller_name,
            fs.status       AS sub_status,
            fs.trial_until,
            fs.valid_until,
            sp.name         AS plan_name,
            lr.started_at   AS last_run_at,
            lr.status       AS last_run_status,
            lr.files_downloaded
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants t    ON f.tenant_id = t.tenant_id
        LEFT JOIN {SCHEMA}.resellers rs ON t.reseller_id = rs.reseller_id
        LEFT JOIN {SCHEMA}.facility_subscriptions fs ON fs.facility_id = f.facility_id
        LEFT JOIN {SCHEMA}.subscription_plans sp     ON sp.plan_id = fs.plan_id
        LEFT JOIN LATERAL (
            SELECT started_at, status, files_downloaded
            FROM {SCHEMA}.sync_run_log
            WHERE facility_id = f.facility_id
            ORDER BY started_at DESC LIMIT 1
        ) lr ON TRUE
        ORDER BY rs.name, t.name, f.facility_code
        """, ()
    )


# ── GET /admin/users — super admin only ───────────────────────────────────────

@router.get("/users", summary="Admin users list [super admin]")
def list_admin_users(user: dict = Depends(require_super_admin)):
    return query(
        f"""
        SELECT admin_id::text, name, email,
               is_super_admin, status, last_login_at, created_at
        FROM {SCHEMA}.kaaryaa_admins
        ORDER BY is_super_admin DESC, name
        """, ()
    )


# ── POST /admin/users — super admin only ─────────────────────────────────────

@router.post("/users", summary="Create admin user [super admin]")
def create_admin_user(
    body: CreateAdminUser,
    user: dict = Depends(require_super_admin)
):
    try:
        import bcrypt
        pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    except ImportError:
        raise HTTPException(status_code=503, detail="bcrypt not installed")

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.kaaryaa_admins (name, email, password_hash, is_super_admin)
            VALUES (%s, %s, %s, %s)
            RETURNING admin_id::text
            """,
            (body.name, body.email.lower(), pw_hash, body.is_super_admin)
        )
        admin_id = cur.fetchone()[0]

    log.info(f"Admin user created: {body.email} by {user.get('email')}")
    return {"status": "created", "admin_id": admin_id, "name": body.name}


# ── PUT /admin/users/:id — super admin only ───────────────────────────────────

@router.put("/users/{admin_id}", summary="Update admin user [super admin]")
def update_admin_user(
    admin_id: str = Path(...),
    body: dict = Body(...),
    user: dict = Depends(require_super_admin)
):
    allowed = {"name", "status", "is_super_admin"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if "password" in body:
        import bcrypt
        updates["password_hash"] = bcrypt.hashpw(body["password"].encode(), bcrypt.gensalt()).decode()

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.kaaryaa_admins SET {set_clause} WHERE admin_id = %s::uuid",
            (*updates.values(), admin_id)
        )

    return {"status": "updated", "admin_id": admin_id}


# ── GET /admin/revenue ────────────────────────────────────────────────────────

@router.get("/revenue", summary="Subscription and billing overview")
def revenue_overview(user: dict = Depends(require_admin)):
    summary = query_one(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE fs.status = 'active')  AS active_paid,
            COUNT(*) FILTER (WHERE fs.status = 'trial')   AS on_trial,
            COUNT(*) FILTER (WHERE fs.status = 'expired') AS expired,
            COALESCE(SUM(
                CASE WHEN fs.status = 'active'
                THEN COALESCE(fs.price_override_aed, sp.price_aed_per_facility_month)
                ELSE 0 END
            ), 0) AS mrr_aed
        FROM {SCHEMA}.facility_subscriptions fs
        JOIN {SCHEMA}.subscription_plans sp ON sp.plan_id = fs.plan_id
        """, ()
    )

    by_plan = query(
        f"""
        SELECT sp.name AS plan_name, sp.code,
               COUNT(*) AS facility_count,
               SUM(COALESCE(fs.price_override_aed, sp.price_aed_per_facility_month)) AS plan_revenue
        FROM {SCHEMA}.facility_subscriptions fs
        JOIN {SCHEMA}.subscription_plans sp ON sp.plan_id = fs.plan_id
        WHERE fs.status = 'active'
        GROUP BY sp.plan_id, sp.name, sp.code
        ORDER BY plan_revenue DESC
        """, ()
    )

    by_reseller = query(
        f"""
        SELECT rs.name AS reseller_name, rs.commission_pct,
               COUNT(DISTINCT f.facility_id) AS facilities,
               COALESCE(SUM(
                   COALESCE(fs.price_override_aed, sp.price_aed_per_facility_month)
               ), 0) AS revenue_aed,
               COALESCE(SUM(
                   COALESCE(fs.price_override_aed, sp.price_aed_per_facility_month)
               ) * rs.commission_pct / 100, 0) AS commission_aed
        FROM {SCHEMA}.resellers rs
        JOIN {SCHEMA}.tenants t ON t.reseller_id = rs.reseller_id
        JOIN {SCHEMA}.tenant_facilities f ON f.tenant_id = t.tenant_id
        LEFT JOIN {SCHEMA}.facility_subscriptions fs ON fs.facility_id = f.facility_id AND fs.status='active'
        LEFT JOIN {SCHEMA}.subscription_plans sp ON sp.plan_id = fs.plan_id
        GROUP BY rs.reseller_id
        ORDER BY revenue_aed DESC
        """, ()
    )

    return {
        "summary":     summary,
        "by_plan":     by_plan,
        "by_reseller": by_reseller,
    }


# ── PUT /admin/facilities/{facility_code}/reassign-tenant ─────────────────────

class ReassignTenantRequest(BaseModel):
    tenant_code: str

@router.put(
    "/facilities/{facility_code}/reassign-tenant",
    summary="Reassign a facility to a different tenant [super-admin]",
)
def reassign_facility_tenant(
    facility_code: str = Path(...),
    body: ReassignTenantRequest = Body(...),
    user: dict = Depends(require_super_admin),
):
    facility_code = facility_code.upper()
    tenant_code = body.tenant_code.upper()

    # Look up target tenant
    tenant_row = query_one(
        f"SELECT tenant_id::text, name FROM {SCHEMA}.tenants WHERE short_code = %s",
        (tenant_code,),
    )
    if not tenant_row:
        raise HTTPException(status_code=404, detail=f"Tenant '{tenant_code}' not found")

    # Look up facility
    fac_row = query_one(
        f"SELECT facility_id::text, tenant_id::text FROM {SCHEMA}.tenant_facilities WHERE facility_code = %s",
        (facility_code,),
    )
    if not fac_row:
        raise HTTPException(status_code=404, detail=f"Facility '{facility_code}' not found")

    # Update — autocommit is on, no explicit commit needed
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.tenant_facilities SET tenant_id = %s, updated_at = NOW() WHERE facility_code = %s",
            (tenant_row["tenant_id"], facility_code),
        )

    return {
        "facility_code": facility_code,
        "new_tenant_code": tenant_code,
        "new_tenant_name": tenant_row["name"],
        "message": f"Facility {facility_code} reassigned to tenant {tenant_code}",
    }
