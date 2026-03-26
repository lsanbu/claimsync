"""
routers/credentials.py — Secure credential entry + token management
---------------------------------------------------------------------
Public endpoints (token IS the auth):
  GET  /onboard/credentials/{token}  — validate token, return status + facility info
  POST /onboard/credentials/{token}  — receive credentials, write to KV, mark used

Admin endpoint (JWT required):
  POST /admin/facilities/{facility_id}/resend-token — revoke old tokens, issue new one, send email

Token states: valid / expired / used / revoked
Lazy expiry: on GET, if status=valid but expires_at < now() → update to expired.
"""

from __future__ import annotations

import os
import logging
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Path, Body, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from ..db import query_one, query, get_db, SCHEMA
from .auth import require_admin
from ..email_service import send_credential_email

router = APIRouter()
log = logging.getLogger(__name__)

KV_URL = "https://kv-claimssync-uae.vault.azure.net/"
MANAGED_IDENTITY_CLIENT_ID = "8e309ea2-175e-497e-8849-7af81a36c62a"

DASHBOARD_URL = os.getenv(
    "CLAIMSSYNC_DASHBOARD_URL",
    "https://whitewater-45edc27c.uaenorth.azurecontainerapps.io",
)

TOKEN_EXPIRY_DAYS = 7

STATUS_MESSAGES = {
    "valid":   "Token is valid. Please enter your Shafafiya credentials below.",
    "expired": "Link expired (7 days). Contact your ClaimSync representative.",
    "used":    "Credentials already submitted. Contact support to update.",
    "revoked": "This link was cancelled. A new link may have been sent.",
}


# ── Pydantic models ──────────────────────────────────────────────────────────

class CredentialSubmission(BaseModel):
    userid: str
    password: str
    caller_license: str

class TokenStatusResponse(BaseModel):
    status: str
    message: str
    facility_code: Optional[str] = None
    facility_name: Optional[str] = None
    expires_at: Optional[str] = None

class ResendTokenRequest(BaseModel):
    send_to_email: str

class ResendTokenResponse(BaseModel):
    credential_url: str
    sent_to: str
    expires_at: str
    email_sent: bool


# ── KV client ────────────────────────────────────────────────────────────────

def _get_kv_client():
    """Lazy-init Azure KV client (only needed when credentials are submitted)."""
    from azure.identity import ManagedIdentityCredential
    from azure.keyvault.secrets import SecretClient

    credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
    return SecretClient(vault_url=KV_URL, credential=credential)


# ── Token helpers ─────────────────────────────────────────────────────────────

def _lookup_token(token: str) -> dict:
    """Look up a credential token row joined with facility info."""
    row = query_one(
        f"""
        SELECT ct.token_id, ct.facility_id, ct.request_id,
               ct.expires_at, ct.used_at, ct.created_at,
               ct.status,
               f.facility_code, f.facility_name, f.kv_secret_prefix,
               f.credentials_provided
        FROM {SCHEMA}.credential_tokens ct
        JOIN {SCHEMA}.tenant_facilities f ON f.facility_id = ct.facility_id
        WHERE ct.token = %s
        """,
        (token,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invalid or unknown token")
    return row


def _resolve_token_status(row: dict) -> str:
    """
    Resolve effective token status with lazy expiry.
    If status=valid but expired → update DB to 'expired' and return 'expired'.
    """
    db_status = row["status"]

    if db_status == "valid" and row["expires_at"]:
        expires = row["expires_at"]
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            # Lazy expiry — update DB
            conn = get_db()
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {SCHEMA}.credential_tokens SET status = 'expired' WHERE token_id = %s",
                    (row["token_id"],),
                )
            log.info("Token %s lazy-expired for facility %s", row["token_id"], row["facility_code"])
            return "expired"

    return db_status


def _build_credential_url(token: str) -> str:
    """Build the full dashboard credential URL."""
    return f"{DASHBOARD_URL}/onboard/credentials/{token}"


# ── Public: GET /onboard/credentials/{token} ─────────────────────────────────

@router.get(
    "/onboard/credentials/{token}",
    response_model=TokenStatusResponse,
    summary="Validate credential token and return status",
)
def validate_token(token: str = Path(...)):
    row = _lookup_token(token)
    effective_status = _resolve_token_status(row)

    return TokenStatusResponse(
        status=effective_status,
        message=STATUS_MESSAGES.get(effective_status, "Unknown token state."),
        facility_code=row["facility_code"],
        facility_name=row["facility_name"],
        expires_at=row["expires_at"].isoformat() if row["expires_at"] else None,
    )


# ── Public: POST /onboard/credentials/{token} ────────────────────────────────

@router.post(
    "/onboard/credentials/{token}",
    summary="Submit facility credentials (one-time)",
)
def submit_credentials(
    token: str = Path(...),
    body: CredentialSubmission = Body(...),
):
    row = _lookup_token(token)
    effective_status = _resolve_token_status(row)

    if effective_status == "used":
        raise HTTPException(status_code=400, detail="Credentials already submitted for this token")
    if effective_status == "expired":
        raise HTTPException(status_code=410, detail="This credential link has expired")
    if effective_status == "revoked":
        raise HTTPException(status_code=410, detail="This link was cancelled. A new link may have been sent.")
    if effective_status != "valid":
        raise HTTPException(status_code=400, detail=f"Token is not valid (status: {effective_status})")

    # Guard: non-empty values
    if not body.userid.strip() or not body.password.strip() or not body.caller_license.strip():
        raise HTTPException(status_code=422, detail="All three credential fields are required")

    kv_prefix = row["kv_secret_prefix"]
    facility_code = row["facility_code"]

    # Write secrets to Azure Key Vault
    try:
        kv = _get_kv_client()
        kv.set_secret(f"{kv_prefix}-userid", body.userid.strip())
        kv.set_secret(f"{kv_prefix}-password", body.password.strip())
        kv.set_secret(f"{kv_prefix}-caller-license", body.caller_license.strip())
        log.info("KV secrets written for %s (%s)", facility_code, kv_prefix)
    except Exception as exc:
        log.error("KV write failed for %s: %s", facility_code, exc)
        raise HTTPException(
            status_code=502,
            detail="Failed to save credentials to secure vault. Please try again or contact support.",
        )

    # Mark token as used + activate facility
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.credential_tokens SET status = 'used', used_at = NOW() WHERE token_id = %s",
            (row["token_id"],),
        )
        cur.execute(
            f"UPDATE {SCHEMA}.tenant_facilities SET credentials_provided = true, status = 'active', updated_at = NOW() WHERE facility_id = %s",
            (row["facility_id"],),
        )

    log.info("Credentials submitted for %s via token", facility_code)
    return {
        "success": True,
        "facility_code": facility_code,
        "message": "Credentials saved securely. Your facility will be activated within 24 hours.",
    }


# ── Admin: POST /admin/facilities/{facility_id}/resend-token ──────────────────

@router.post(
    "/admin/facilities/{facility_id}/resend-token",
    response_model=ResendTokenResponse,
    summary="Revoke old tokens and issue+send a new credential link",
)
def resend_token(
    facility_id: str = Path(...),
    body: ResendTokenRequest = Body(...),
    user: dict = Depends(require_admin),
):
    # Verify facility exists
    facility = query_one(
        f"SELECT facility_id, facility_code, facility_name FROM {SCHEMA}.tenant_facilities WHERE facility_id = %s::uuid",
        (facility_id,),
    )
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    # Get the max resend_count for this facility
    count_row = query_one(
        f"SELECT COALESCE(MAX(resend_count), 0) AS max_count FROM {SCHEMA}.credential_tokens WHERE facility_id = %s::uuid",
        (facility_id,),
    )
    new_resend_count = (count_row["max_count"] if count_row else 0) + 1

    conn = get_db()
    with conn.cursor() as cur:
        # Revoke all existing valid/expired tokens for this facility
        cur.execute(
            f"""
            UPDATE {SCHEMA}.credential_tokens
            SET status = 'revoked'
            WHERE facility_id = %s::uuid AND status IN ('valid', 'expired')
            """,
            (facility_id,),
        )

        # Generate new token
        new_token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRY_DAYS)

        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.credential_tokens
                (facility_id, token, expires_at, status, sent_to_email, resend_count, resent_at, created_by)
            VALUES (%s::uuid, %s, %s, 'valid', %s, %s, NOW(), %s)
            """,
            (
                facility_id,
                new_token,
                expires_at,
                body.send_to_email,
                new_resend_count,
                user.get("email", "admin"),
            ),
        )

    credential_url = _build_credential_url(new_token)

    # Send email (non-blocking — won't crash if it fails)
    email_sent = send_credential_email(
        to_email=body.send_to_email,
        facility_name=facility["facility_name"],
        facility_code=facility["facility_code"],
        credential_url=credential_url,
        expires_days=TOKEN_EXPIRY_DAYS,
        is_resend=True,
    )

    log.info(
        "Resend token for %s → %s by %s (email_sent=%s)",
        facility["facility_code"], body.send_to_email, user.get("email"), email_sent,
    )

    return ResendTokenResponse(
        credential_url=credential_url,
        sent_to=body.send_to_email,
        expires_at=expires_at.isoformat(),
        email_sent=email_sent,
    )


# ── Helper: create and send credential token (used by approval flow) ─────────

def create_and_send_credential_token(
    facility_id: str,
    facility_code: str,
    facility_name: str,
    request_id: str,
    send_to_email: str,
    created_by: str = "system",
) -> dict:
    """
    Create a new credential token for a facility and optionally send an email.
    Used by the approval endpoint to auto-send on approval.

    Returns dict with token, credential_url, expires_at, email_sent.
    """
    new_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRY_DAYS)
    credential_url = _build_credential_url(new_token)

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.credential_tokens
                (facility_id, request_id, token, expires_at, status, sent_to_email, created_by)
            VALUES (%s::uuid, %s::uuid, %s, %s, 'valid', %s, %s)
            """,
            (facility_id, request_id, new_token, expires_at, send_to_email, created_by),
        )

        # Update onboarding request with email tracking
        cur.execute(
            f"""
            UPDATE {SCHEMA}.onboarding_requests
            SET credential_link_sent_at = NOW(),
                credential_link_sent_to = %s,
                credential_token = %s
            WHERE request_id = %s::uuid
            """,
            (send_to_email, new_token, request_id),
        )

    # Send email (non-blocking)
    email_sent = send_credential_email(
        to_email=send_to_email,
        facility_name=facility_name,
        facility_code=facility_code,
        credential_url=credential_url,
        expires_days=TOKEN_EXPIRY_DAYS,
        is_resend=False,
    )

    log.info(
        "Credential token created for %s → %s (email_sent=%s)",
        facility_code, send_to_email, email_sent,
    )

    return {
        "token": new_token,
        "credential_url": credential_url,
        "expires_at": expires_at.isoformat(),
        "email_sent": email_sent,
    }
