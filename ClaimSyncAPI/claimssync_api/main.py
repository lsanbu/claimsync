"""
ClaimSync FastAPI Backend  —  P3-T03
=====================================
REST API over the three ClaimSync audit tables:
  claimssync.sync_run_log
  claimssync.sync_run_intervals
  claimssync.file_manifest

Authentication : X-API-Key header  (key stored in KV secret 'claimssync-api-key',
                 injected as env var CLAIMSSYNC_API_KEY)

DB connection  : CLAIMSSYNC_DB_DSN env var  (KV-injected DSN, same as engine)

Deployment     : Separate Container App  ca-claimssync-api
                 Image: crclaimssync.azurecr.io/claimsync-api:1.0

Project        : ClaimSync (Kaaryaa Intelligence LLP)
Phase          : 3 — P3-T03
Version        : 1.0
Date           : 2026-03-13
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import Optional

# Azure Monitor — auto-instruments FastAPI requests, exceptions, dependencies
# Activated only when APPLICATIONINSIGHTS_CONNECTION_STRING is present
if os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    from azure.monitor.opentelemetry import configure_azure_monitor
    configure_azure_monitor()

from fastapi import FastAPI, Depends, Query, Path, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import verify_api_key
from .db   import get_db, close_db

# ── Router imports ─────────────────────────────────────────────────────────────
from .routers import runs, files, stats, facilities
from .routers import auth, reseller, admin, credentials   # onboarding module
from .routers import adhoc                                 # adhoc run trigger
from .routers import intervals                             # interval search history

logging.basicConfig(
    level=logging.INFO,
    format="[ClaimSync-API] %(levelname)s %(name)s: %(message)s",
    force=True,          # override Azure Monitor's handler setup so logs also go to stdout
)
logger = logging.getLogger(__name__)

API_VERSION = "2.11"
BUILD_TAG   = os.getenv("IMAGE_TAG", "local")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"ClaimSync API v{API_VERSION} starting (build={BUILD_TAG})")
    yield
    close_db()
    logger.info("ClaimSync API shutdown — DB connection closed")


app = FastAPI(
    title="ClaimSync API",
    description="Audit and reporting API for ClaimSync — Shafafiya claims sync engine.",
    version=API_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow Next.js dashboard (tightened in Phase 4 to specific origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],   # extended for onboarding
    allow_headers=["*"],
)


# ── Health (no auth — used by Container App health probe) ─────────────────────

@app.get("/health", tags=["system"], summary="Liveness probe")
def health():
    return {"status": "ok", "version": API_VERSION, "build": BUILD_TAG}


@app.get("/", tags=["system"], include_in_schema=False)
def root():
    return {"service": "ClaimSync API", "version": API_VERSION, "docs": "/docs"}


# ── Existing authenticated routers (API key) ───────────────────────────────────

app.include_router(
    runs.router,
    prefix="/runs",
    tags=["runs"],
    dependencies=[Depends(verify_api_key)],
)

app.include_router(
    files.router,
    prefix="/files",
    tags=["files"],
    dependencies=[Depends(verify_api_key)],
)

app.include_router(
    stats.router,
    prefix="/stats",
    tags=["stats"],
    dependencies=[Depends(verify_api_key)],
)

app.include_router(
    facilities.router,
    prefix="/facilities",
    tags=["facilities"],
    dependencies=[Depends(verify_api_key)],
)

# ── Onboarding module routers (JWT auth — handled inside each router) ──────────

app.include_router(
    auth.router,
    prefix="/auth",
    tags=["auth"],
)

app.include_router(
    reseller.router,
    prefix="/reseller",
    tags=["reseller"],
)

app.include_router(
    admin.router,
    prefix="/admin",
    tags=["admin"],
)

app.include_router(
    credentials.router,
    tags=["credentials"],
)

app.include_router(
    adhoc.router,
    tags=["adhoc"],
)

app.include_router(
    intervals.router,
    tags=["intervals"],
)
