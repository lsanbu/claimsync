"""
routers/auth.py — Authentication for Reseller + Admin portals
--------------------------------------------------------------
POST /auth/reseller/login   — email + password → JWT token
POST /auth/admin/login      — email + password → JWT token
GET  /auth/me               — return current user info from token
POST /auth/logout           — client-side token discard (stateless)

JWT strategy:
  - HS256, secret from CLAIMSSYNC_JWT_SECRET env var
  - 8-hour expiry
  - payload: { sub: id, role: 'reseller'|'admin', email, name }

No refresh tokens in Sprint 1 — keep it simple.
"""

from __future__ import annotations
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

try:
    import bcrypt
    BCRYPT_OK = True
except ImportError:
    BCRYPT_OK = False
    logging.warning("bcrypt not installed — auth endpoints will return 503")

try:
    import jwt as pyjwt
    JWT_OK = True
except ImportError:
    JWT_OK = False
    logging.warning("PyJWT not installed — auth endpoints will return 503")

from ..db import query_one, SCHEMA

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

JWT_SECRET  = os.environ.get("CLAIMSSYNC_JWT_SECRET", "claimsync-dev-secret-change-in-prod")
JWT_ALGO    = "HS256"
JWT_EXPIRY  = 8   # hours — portal sessions
SERVICE_TOKEN_EXPIRY = int(os.environ.get("SERVICE_TOKEN_EXPIRE_HOURS", "8760"))  # 365 days — ClaimSyncPull.py

log = logging.getLogger(__name__)


# ── Pydantic models ────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email:    str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int = JWT_EXPIRY * 3600
    role:         str
    name:         str
    email:        str
    reseller_id:  Optional[str] = None
    admin_id:     Optional[str] = None


# ── JWT helpers ────────────────────────────────────────────────────────────────

def _create_token(payload: dict, expiry_hours: int = JWT_EXPIRY) -> str:
    payload["exp"] = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    payload["iat"] = datetime.now(timezone.utc)
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def _decode_token(token: str) -> dict:
    return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])


def _check_deps():
    if not BCRYPT_OK or not JWT_OK:
        raise HTTPException(
            status_code=503,
            detail="Auth dependencies not installed. Run: pip install bcrypt PyJWT"
        )


# ── Dependency: get current user from Bearer token ────────────────────────────

def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)
) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return _decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_reseller(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("reseller", "admin"):
        raise HTTPException(status_code=403, detail="Reseller access required")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── POST /auth/reseller/login ──────────────────────────────────────────────────

@router.post("/reseller/login", response_model=TokenResponse)
def reseller_login(body: LoginRequest):
    _check_deps()

    row = query_one(
        f"""
        SELECT reseller_id::text, name, login_email, password_hash, status
        FROM {SCHEMA}.resellers
        WHERE login_email = %s
        """,
        (body.email.lower().strip(),)
    )

    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if row["status"] != "active":
        raise HTTPException(status_code=403, detail=f"Account is {row['status']}")

    if not row["password_hash"]:
        raise HTTPException(status_code=401, detail="Account not yet activated — contact Kaaryaa")

    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Update last login
    from ..db import get_db
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.resellers SET last_login_at = NOW() WHERE reseller_id = %s::uuid",
            (row["reseller_id"],)
        )

    token = _create_token({
        "sub":         row["reseller_id"],
        "role":        "reseller",
        "email":       row["login_email"],
        "name":        row["name"],
        "reseller_id": row["reseller_id"],
    })

    log.info(f"Reseller login: {row['login_email']} ({row['name']})")

    return TokenResponse(
        access_token=token,
        role="reseller",
        name=row["name"],
        email=row["login_email"],
        reseller_id=row["reseller_id"],
    )


# ── POST /auth/reseller/service-token ─────────────────────────────────────────

class ServiceTokenResponse(BaseModel):
    access_token:   str
    token_type:     str = "bearer"
    expires_in_days: int = SERVICE_TOKEN_EXPIRY // 24
    role:           str
    name:           str
    email:          str
    reseller_id:    Optional[str] = None

@router.post("/reseller/service-token", response_model=ServiceTokenResponse,
             summary="Long-lived service token for ClaimSyncPull.py")
def reseller_service_token(body: LoginRequest):
    """Same credentials as /reseller/login but returns a 365-day token
    for automated scripts (ClaimSyncPull.py). Not for browser use."""
    _check_deps()

    row = query_one(
        f"""
        SELECT reseller_id::text, name, login_email, password_hash, status
        FROM {SCHEMA}.resellers
        WHERE login_email = %s
        """,
        (body.email.lower().strip(),)
    )

    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if row["status"] != "active":
        raise HTTPException(status_code=403, detail=f"Account is {row['status']}")
    if not row["password_hash"]:
        raise HTTPException(status_code=401, detail="Account not yet activated — contact Kaaryaa")
    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = _create_token(
        {
            "sub":         row["reseller_id"],
            "role":        "reseller",
            "email":       row["login_email"],
            "name":        row["name"],
            "reseller_id": row["reseller_id"],
            "token_type":  "service",
        },
        expiry_hours=SERVICE_TOKEN_EXPIRY,
    )

    log.info(f"Service token issued: {row['login_email']} ({row['name']}) — {SERVICE_TOKEN_EXPIRY // 24} days")

    return ServiceTokenResponse(
        access_token=token,
        role="reseller",
        name=row["name"],
        email=row["login_email"],
        reseller_id=row["reseller_id"],
    )


# ── POST /auth/admin/login ─────────────────────────────────────────────────────

@router.post("/admin/login", response_model=TokenResponse)
def admin_login(body: LoginRequest):
    _check_deps()

    row = query_one(
        f"""
        SELECT admin_id::text, name, email, password_hash, status, is_super_admin
        FROM {SCHEMA}.kaaryaa_admins
        WHERE email = %s
        """,
        (body.email.lower().strip(),)
    )

    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if row["status"] != "active":
        raise HTTPException(status_code=403, detail="Account inactive")

    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    from ..db import get_db
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.kaaryaa_admins SET last_login_at = NOW() WHERE admin_id = %s::uuid",
            (row["admin_id"],)
        )

    token = _create_token({
        "sub":           row["admin_id"],
        "role":          "admin",
        "email":         row["email"],
        "name":          row["name"],
        "admin_id":      row["admin_id"],
        "is_super_admin": row["is_super_admin"],
    })

    log.info(f"Admin login: {row['email']} ({row['name']})")

    return TokenResponse(
        access_token=token,
        role="admin",
        name=row["name"],
        email=row["email"],
        admin_id=row["admin_id"],
    )


# ── GET /auth/me ───────────────────────────────────────────────────────────────

@router.get("/me")
def get_me(user: dict = Depends(get_current_user)):
    return {
        "id":    user.get("sub"),
        "role":  user.get("role"),
        "email": user.get("email"),
        "name":  user.get("name"),
    }


def require_super_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin" or not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user
