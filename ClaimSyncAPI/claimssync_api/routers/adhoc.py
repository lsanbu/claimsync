"""
routers/adhoc.py — Adhoc engine run trigger + run history
----------------------------------------------------------
POST /admin/facilities/{facility_code}/adhoc-run — trigger adhoc engine job
GET  /admin/facilities/{facility_code}/runs       — last 10 sync runs
GET  /admin/facilities/{facility_code}/runs/{run_id}/files — files for a run
"""

from __future__ import annotations

import os
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Path, Body, HTTPException, Depends
from pydantic import BaseModel

from ..db import query, query_one, SCHEMA
from .auth import require_admin

router = APIRouter()
log = logging.getLogger(__name__)

SUBSCRIPTION_ID = "ec12e27e-1ef9-46e9-8817-46a10b197381"
RESOURCE_GROUP = "rg-claimssync-uaenorth-prod"
ENGINE_JOB_NAME = "job-claimssync-engine"
MANAGED_IDENTITY_CLIENT_ID = "8e309ea2-175e-497e-8849-7af81a36c62a"


# ── Pydantic models ──────────────────────────────────────────────────────────

class AdhocRunRequest(BaseModel):
    from_datetime: str   # YYYY-MM-DD HH:MM or YYYY-MM-DD
    to_datetime: str     # YYYY-MM-DD HH:MM or YYYY-MM-DD


# ── Helpers ───────────────────────────────────────────────────────────────────

def _validate_datetime(val: str, field: str) -> str:
    """Validate adhoc datetime format."""
    for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            datetime.strptime(val, fmt)
            return val
        except ValueError:
            continue
    raise HTTPException(
        status_code=422,
        detail=f"Invalid {field} format: '{val}'. Use YYYY-MM-DD or YYYY-MM-DD HH:MM",
    )


def _get_facility(facility_code: str) -> dict:
    """Look up facility by code, raise 404 if not found."""
    row = query_one(
        f"SELECT facility_id, facility_code, facility_name, status FROM {SCHEMA}.tenant_facilities WHERE facility_code = %s",
        (facility_code.upper(),),
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Facility {facility_code} not found")
    if row["status"] != "active":
        raise HTTPException(status_code=400, detail=f"Facility {facility_code} is {row['status']}, not active")
    return row


# ── POST /admin/facilities/{facility_code}/adhoc-run ──────────────────────────

@router.post(
    "/admin/facilities/{facility_code}/adhoc-run",
    summary="Trigger adhoc engine run for a facility",
)
def trigger_adhoc_run(
    facility_code: str = Path(...),
    body: AdhocRunRequest = Body(...),
    user: dict = Depends(require_admin),
):
    facility_code = facility_code.upper()
    facility = _get_facility(facility_code)

    from_dt = _validate_datetime(body.from_datetime, "from_datetime")
    to_dt = _validate_datetime(body.to_datetime, "to_datetime")

    try:
        from azure.identity import ManagedIdentityCredential
        from azure.mgmt.appcontainers import ContainerAppsAPIClient
        from azure.mgmt.appcontainers.models import (
            JobExecutionTemplate,
            JobExecutionContainer,
            EnvironmentVar,
        )

        credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
        client = ContainerAppsAPIClient(credential, SUBSCRIPTION_ID)

        # ── Per-execution override (NOT persisted on the Job resource) ──────
        # begin_start(template=...) posts to Microsoft.App/jobs/{name}/start
        # with a JobExecutionTemplate body. Azure applies the template to the
        # single JobExecution it creates — the persistent Job.template is
        # untouched, so these three adhoc env vars never land on the job.
        #
        # Azure applies the execution's container `env` as a REPLACEMENT of
        # the job's env list (not a merge), so we must bundle the inherited
        # env vars (DB_DSN, KV_URI, BLOB_UPLOAD, APPLICATIONINSIGHTS_*, MI
        # client_id, etc.) together with the three adhoc overrides.
        ADHOC_NAMES = {
            "CLAIMSSYNC_ADHOC_FROM",
            "CLAIMSSYNC_ADHOC_TO",
            "CLAIMSSYNC_ADHOC_FACILITY",
        }

        job = client.jobs.get(RESOURCE_GROUP, ENGINE_JOB_NAME)
        current_container = job.template.containers[0]

        # Rebuild each EnvironmentVar explicitly. The response models from
        # jobs.get() sometimes carry read-only/extra attributes the request
        # side silently drops — reconstructing preserves name/value/secret_ref
        # cleanly so KV-backed secrets (e.g. db-dsn, acs-connection-string)
        # round-trip through the execution override.
        inherited_env = [
            EnvironmentVar(
                name=ev.name,
                value=ev.value,
                secret_ref=ev.secret_ref,
            )
            for ev in (current_container.env or [])
            if ev.name not in ADHOC_NAMES   # drop stale adhoc keys if any
        ]
        adhoc_env = [
            EnvironmentVar(name="CLAIMSSYNC_ADHOC_FROM",     value=from_dt),
            EnvironmentVar(name="CLAIMSSYNC_ADHOC_TO",       value=to_dt),
            EnvironmentVar(name="CLAIMSSYNC_ADHOC_FACILITY", value=facility_code),
        ]
        merged_env = inherited_env + adhoc_env

        override_template = JobExecutionTemplate(
            containers=[
                JobExecutionContainer(
                    name=current_container.name,
                    image=current_container.image,
                    env=merged_env,
                    resources=current_container.resources,
                )
            ],
        )

        # Log names only — values may contain secrets
        log.info(
            "Adhoc run: facility=%s user=%s per-execution override env keys=%s "
            "inherited=%d adhoc=%d",
            facility_code,
            user.get("email"),
            [ev.name for ev in adhoc_env],
            len(inherited_env),
            len(adhoc_env),
        )

        client.jobs.begin_start(
            resource_group_name=RESOURCE_GROUP,
            job_name=ENGINE_JOB_NAME,
            template=override_template,
        )

        return {
            "run_triggered": True,
            "facility_code": facility_code,
            "facility_name": facility["facility_name"],
            "from_datetime": from_dt,
            "to_datetime": to_dt,
            "override_vars": sorted(ADHOC_NAMES),
            "message": (
                f"Adhoc run started for {facility_code} "
                f"({from_dt} → {to_dt}) with per-execution env override "
                f"(job resource unchanged)"
            ),
        }

    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Adhoc run trigger failed for %s", facility_code)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to trigger adhoc run: {exc}",
        )


# ── GET /admin/facilities/{facility_code}/runs ───────────────────────────────

@router.get(
    "/admin/facilities/{facility_code}/runs",
    summary="Last 10 sync runs for a facility",
)
def get_facility_runs(
    facility_code: str = Path(...),
    user: dict = Depends(require_admin),
):
    facility = _get_facility(facility_code)

    rows = query(
        f"""
        SELECT
            r.run_id::text,
            r.started_at,
            r.ended_at,
            r.status,
            r.files_downloaded,
            r.search_from_date AS from_date,
            r.search_to_date   AS to_date,
            r.engine_version,
            r.intervals_total,
            r.intervals_completed,
            r.trigger_type,
            -- v2.10: live "currently processing" interval window, written by
            -- engine update_progress (engine :3.17+). Cleared at end_run, so
            -- non-NULL only while status='running'.
            r.current_interval_from,
            r.current_interval_to,
            -- v2.9: live counters computed from child tables.
            -- The engine only writes sync_run_log.files_downloaded /
            -- intervals_completed inside end_run(), so those columns stay 0
            -- while a run is in progress. file_manifest and sync_run_intervals
            -- ARE written incrementally — count them here so the dashboard
            -- can show progress for status='running' rows.
            (SELECT COUNT(*) FROM {SCHEMA}.file_manifest       fm WHERE fm.run_id = r.run_id) AS live_files_count,
            (SELECT COUNT(*) FROM {SCHEMA}.sync_run_intervals  si WHERE si.run_id = r.run_id) AS live_intervals_count
        FROM {SCHEMA}.sync_run_log r
        WHERE r.facility_id = %s
        ORDER BY r.started_at DESC
        LIMIT 10
        """,
        (facility["facility_id"],),
    )

    # Serialize datetimes
    for r in rows:
        for k in ("started_at", "ended_at", "from_date", "to_date"):
            if r.get(k) and hasattr(r[k], "isoformat"):
                r[k] = r[k].isoformat()

    return {
        "facility_code": facility["facility_code"],
        "facility_name": facility["facility_name"],
        "runs": rows,
    }


# ── GET /admin/facilities/{facility_code}/runs/{run_id}/files ─────────────────

@router.get(
    "/admin/facilities/{facility_code}/runs/{run_id}/files",
    summary="Files downloaded in a specific run",
)
def get_run_files(
    facility_code: str = Path(...),
    run_id: str = Path(...),
    user: dict = Depends(require_admin),
):
    _get_facility(facility_code)

    rows = query(
        f"""
        SELECT
            manifest_id::text AS file_id,
            file_name,
            file_type,
            file_size_bytes,
            blob_url       AS blob_path,
            downloaded_at  AS uploaded_at,
            created_at
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
