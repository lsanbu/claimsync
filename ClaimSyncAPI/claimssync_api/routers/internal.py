"""
routers/internal.py — Engine-to-API internal endpoints
-------------------------------------------------------
POST /internal/facilities/{code}/auth-failed-alert
  Called by the engine (via CLAIMSSYNC_INTERNAL_SECRET) after an auth_failed
  run is written to sync_run_log. Updates last_auth_failed_at in tenant_facilities,
  creates a new credential token, and sends two emails (facility contact + reseller).

All endpoints hidden from Swagger (include_in_schema=False).
"""

from __future__ import annotations

import os
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Path, Body, Header, HTTPException
from pydantic import BaseModel

from ..db import query_one, get_db, SCHEMA
from ..email_service import send_auth_failed_facility_email, send_auth_failed_reseller_email

router = APIRouter()
log = logging.getLogger(__name__)

_INTERNAL_SECRET = os.getenv("CLAIMSSYNC_INTERNAL_SECRET", "")
_DASHBOARD_URL   = os.getenv(
    "CLAIMSSYNC_DASHBOARD_URL",
    "https://ca-claimssync-dashboard.whitewater-45edc27c.uaenorth.azurecontainerapps.io",
)
TOKEN_EXPIRY_DAYS = 7


class AuthFailedAlertBody(BaseModel):
    run_id: Optional[str] = None


@router.post(
    "/internal/facilities/{code}/auth-failed-alert",
    include_in_schema=False,
    summary="Engine auth-failed alert (internal only)",
)
def auth_failed_alert(
    code: str = Path(...),
    body: AuthFailedAlertBody = Body(default=AuthFailedAlertBody()),
    x_internal_secret: str = Header(...),
):
    if not _INTERNAL_SECRET or x_internal_secret != _INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal secret")

    code = code.upper()

    # 1. Look up facility + reseller contact
    facility = query_one(
        f"""
        SELECT
            f.facility_id,
            f.facility_code,
            f.facility_name,
            r.contact_email  AS reseller_email,
            r.contact_name   AS reseller_name
        FROM {SCHEMA}.tenant_facilities f
        JOIN {SCHEMA}.tenants    t ON t.tenant_id   = f.tenant_id
        JOIN {SCHEMA}.resellers  r ON r.reseller_id = t.reseller_id
        WHERE f.facility_code = %s
        """,
        (code,),
    )
    if not facility:
        raise HTTPException(status_code=404, detail=f"Facility {code} not found")

    facility_id = str(facility["facility_id"])

    # 2. Update last_auth_failed_at in tenant_facilities
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.tenant_facilities SET last_auth_failed_at = NOW() WHERE facility_id = %s::uuid",
            (facility_id,),
        )

    # 3. Find most-recent facility contact email (from credential_tokens sent_to_email)
    token_row = query_one(
        f"""
        SELECT sent_to_email
        FROM {SCHEMA}.credential_tokens
        WHERE facility_id = %s::uuid
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (facility_id,),
    )
    facility_email = token_row["sent_to_email"] if token_row and token_row.get("sent_to_email") else None

    # 4. Revoke existing valid/expired tokens, create a fresh one
    new_token  = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRY_DAYS)
    credential_url = f"{_DASHBOARD_URL}/onboard/credentials/{new_token}"

    count_row = query_one(
        f"SELECT COALESCE(MAX(resend_count), 0) AS max_count FROM {SCHEMA}.credential_tokens WHERE facility_id = %s::uuid",
        (facility_id,),
    )
    new_resend_count = (count_row["max_count"] if count_row else 0) + 1

    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE {SCHEMA}.credential_tokens
            SET status = 'revoked'
            WHERE facility_id = %s::uuid AND status IN ('valid', 'expired')
            """,
            (facility_id,),
        )
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.credential_tokens
                (facility_id, token, expires_at, status, sent_to_email, resend_count, resent_at, created_by)
            VALUES (%s::uuid, %s, %s, 'valid', %s, %s, NOW(), 'engine-auth-alert')
            """,
            (facility_id, new_token, expires_at, facility_email, new_resend_count),
        )

    auth_failed_time = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")

    # 5. Send emails (non-blocking — failures logged, never raised)
    facility_email_sent  = False
    reseller_email_sent  = False

    if facility_email:
        facility_email_sent = send_auth_failed_facility_email(
            to_email=facility_email,
            facility_code=code,
            facility_name=facility["facility_name"],
            credential_url=credential_url,
            auth_failed_time=auth_failed_time,
        )
    else:
        log.warning("auth_failed_alert: no facility contact email found for %s — skipping facility email", code)

    reseller_email = facility.get("reseller_email")
    if reseller_email:
        reseller_email_sent = send_auth_failed_reseller_email(
            to_email=reseller_email,
            reseller_name=facility.get("reseller_name") or "Reseller",
            facility_code=code,
            facility_name=facility["facility_name"],
            auth_failed_time=auth_failed_time,
        )

    log.info(
        "auth_failed_alert: %s token=%s... facility_email=%s reseller_email=%s",
        code, new_token[:8], facility_email_sent, reseller_email_sent,
    )

    return {
        "success":              True,
        "facility_code":        code,
        "credential_url":       credential_url,
        "expires_at":           expires_at.isoformat(),
        "facility_email_sent":  facility_email_sent,
        "reseller_email_sent":  reseller_email_sent,
    }
