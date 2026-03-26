"""
auth.py — API key header authentication
----------------------------------------
Reads CLAIMSSYNC_API_KEY from environment (injected from Key Vault secret
'claimssync-api-key' via Container App secretRef).

Usage:
    router = APIRouter(dependencies=[Depends(verify_api_key)])
"""

import os
import secrets
import logging
from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader

logger = logging.getLogger(__name__)

_API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
_API_KEY: str | None = os.getenv("CLAIMSSYNC_API_KEY")

if not _API_KEY:
    logger.warning(
        "CLAIMSSYNC_API_KEY not set — all authenticated endpoints will return 403. "
        "Set the env var (from KV secret 'claimssync-api-key') before deploying."
    )


def verify_api_key(api_key: str | None = Security(_API_KEY_HEADER)) -> None:
    """
    FastAPI dependency — raises 403 if key is missing or wrong.
    Uses secrets.compare_digest to prevent timing attacks.
    """
    if not _API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key not configured on server.",
        )
    if not api_key or not secrets.compare_digest(api_key, _API_KEY):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-API-Key header.",
        )
