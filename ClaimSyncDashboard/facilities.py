"""
routers/facilities.py — Facility Config & Control endpoints
------------------------------------------------------------
GET  /facilities                     list all facilities + last run
GET  /facilities/{facility_id}       full config + last run + schedule
PUT  /facilities/{facility_id}/config update search dates + schedule
POST /facilities/{facility_id}/run   trigger adhoc job with date override
GET  /facilities/{facility_id}/run/status  poll latest execution status
"""

from __future__ import annotations
import os
import json
import subprocess
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Path, Body, HTTPException, status
from pydantic import BaseModel
from ..db import query, query_one, SCHEMA

router = APIRouter()

# ── Azure job trigger config ───────────────────────────────────────────────────
SUBSCRIPTION   = os.getenv("AZURE_SUBSCRIPTION_ID", "ec12e27e-1ef9-46e9-8817-46a10b197381")
RESOURCE_GROUP = os.getenv("AZURE_RESOURCE_GROUP",  "rg-claimssync-uaenorth-prod")
JOB_NAME       = os.getenv("CLAIMSSYNC_JOB_NAME",   "job-claimssync-engine")

# ── Pydantic models ────────────────────────────────────────────────────────────

class ConfigUpdate(BaseModel):
    search_from_date:      Optional[str] = None   # ISO date e.g. "2026-03-11"
    search_to_date:        Optional[str] = None
    lookback_days:         Optional[int] = None
    cron_expression:       Optional[str] = None
    schedule_active:       Optional[bool] = None

class AdhocRunRequest(BaseModel):
    from_date: str   # DD/MM/YYYY HH:MM:SS
    to_date:   str   # DD/MM/YYYY HH:MM:SS
    note:      Optional[str] = None


# ── Helper: last run for a facility ───────────────────────────────────────────

def _last_run(facility_id: str) -> dict | None:
    return query_one(
        f"""
        SELECT run_id::text, started_at, ended_at, status,
               files_downloaded, files_skipped_existing,
               files_resubmission, intervals_completed, intervals_total,
               engine_version, error_message,
               search_from_date, search_to_date,
               EXTRACT(EPOCH FROM (ended_at - started_at)) AS duration_seconds
        FROM {SCHEMA}.sync_run_log
        WHERE facility_id = %s::uuid
        ORDER BY started_at DESC LIMIT 1
        """,
        (facility_id,)
    )


# ── GET /facilities ────────────────────────────────────────────────────────────

@router.get("", summary="List all facilities with last run status")
def list_facilities():
    rows = query(
        f"""
        SELECT
            f.facility_id::text,
            f.facility_code,
            f.facility_name,
            f.status,
            f.blob_container,
            f.lookback_days,
            f.kv_secret_prefix,
            f.updated_at,
            s.cron_expression,
            s.is_active       AS schedule_active,
            s.lookback_override_days
        FROM {SCHEMA}.tenant_facilities f
        LEFT JOIN {SCHEMA}.sync_schedules s
               ON s.facility_id = f.facility_id AND s.is_active = TRUE
        ORDER BY f.facility_code
        """
    )
    # Attach last run to each
    result = []
    for r in rows:
        last = _last_run(r["facility_id"])
        result.append({**r, "last_run": last})
    return result


# ── GET /facilities/{facility_id} ──────────────────────────────────────────────

@router.get("/{facility_id}", summary="Full facility config + last run + schedule")
def get_facility(facility_id: str = Path(...)):
    row = query_one(
        f"""
        SELECT
            f.facility_id::text,
            f.facility_code,
            f.facility_name,
            f.status,
            f.blob_container,
            f.lookback_days,
            f.interval_hours,
            f.api_sleep_seconds,
            f.kv_secret_prefix,
            f.claims_subfolder,
            f.resubmission_subfolder,
            f.remittance_subfolder,
            f.updated_at,
            s.schedule_id::text,
            s.cron_expression,
            s.timezone,
            s.is_active       AS schedule_active,
            s.lookback_override_days
        FROM {SCHEMA}.tenant_facilities f
        LEFT JOIN {SCHEMA}.sync_schedules s
               ON s.facility_id = f.facility_id AND s.is_active = TRUE
        WHERE f.facility_id = %s::uuid
        """,
        (facility_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Facility {facility_id} not found.")

    last = _last_run(facility_id)
    return {**row, "last_run": last}


# ── PUT /facilities/{facility_id}/config ───────────────────────────────────────

@router.put("/{facility_id}/config", summary="Update date window / schedule")
def update_config(
    facility_id: str = Path(...),
    body: ConfigUpdate = Body(...),
):
    """
    Updates search date window and/or schedule cron expression.
    All fields optional — only provided fields are updated.
    """
    # Verify facility exists
    fac = query_one(
        f"SELECT facility_id FROM {SCHEMA}.tenant_facilities WHERE facility_id = %s::uuid",
        (facility_id,)
    )
    if not fac:
        raise HTTPException(status_code=404, detail=f"Facility {facility_id} not found.")

    updates = []

    # Update lookback_days on tenant_facilities if provided
    if body.lookback_days is not None:
        from ..db import get_db, SCHEMA
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE {SCHEMA}.tenant_facilities SET lookback_days = %s WHERE facility_id = %s::uuid",
                (body.lookback_days, facility_id)
            )
        updates.append(f"lookback_days={body.lookback_days}")

    # Update schedule if cron or active flag provided
    if body.cron_expression is not None or body.schedule_active is not None:
        from ..db import get_db
        conn = get_db()
        # Check if schedule exists
        sched = query_one(
            f"SELECT schedule_id FROM {SCHEMA}.sync_schedules WHERE facility_id = %s::uuid AND is_active = TRUE",
            (facility_id,)
        )
        with conn.cursor() as cur:
            if sched:
                if body.cron_expression is not None:
                    cur.execute(
                        f"UPDATE {SCHEMA}.sync_schedules SET cron_expression = %s WHERE schedule_id = %s::uuid",
                        (body.cron_expression, sched["schedule_id"])
                    )
                    updates.append(f"cron={body.cron_expression}")
                if body.schedule_active is not None:
                    cur.execute(
                        f"UPDATE {SCHEMA}.sync_schedules SET is_active = %s WHERE schedule_id = %s::uuid",
                        (body.schedule_active, sched["schedule_id"])
                    )
                    updates.append(f"schedule_active={body.schedule_active}")
            else:
                # Create schedule
                cron = body.cron_expression or "0 2 * * *"
                cur.execute(
                    f"""INSERT INTO {SCHEMA}.sync_schedules (facility_id, cron_expression, is_active)
                        VALUES (%s::uuid, %s, %s)""",
                    (facility_id, cron, body.schedule_active if body.schedule_active is not None else True)
                )
                updates.append(f"schedule created cron={cron}")

    return {"status": "updated", "changes": updates, "facility_id": facility_id}


# ── POST /facilities/{facility_id}/run ─────────────────────────────────────────

@router.post("/{facility_id}/run", summary="Trigger adhoc run with date override")
def trigger_adhoc_run(
    facility_id: str = Path(...),
    body: AdhocRunRequest = Body(...),
):
    """
    Triggers the engine job with date override env vars.
    from_date / to_date format: DD/MM/YYYY HH:MM:SS
    """
    fac = query_one(
        f"SELECT facility_code FROM {SCHEMA}.tenant_facilities WHERE facility_id = %s::uuid",
        (facility_id,)
    )
    if not fac:
        raise HTTPException(status_code=404, detail=f"Facility {facility_id} not found.")

    # Trigger via Azure CLI — runs inside the container using Managed Identity
    try:
        cmd = [
            "az", "containerapp", "job", "start",
            "--name", JOB_NAME,
            "--resource-group", RESOURCE_GROUP,
            "--env-vars",
            f"CLAIMSSYNC_ADHOC_FROM={body.from_date}",
            f"CLAIMSSYNC_ADHOC_TO={body.to_date}",
            "CLAIMSSYNC_ADHOC=1",
            "--output", "json"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Job trigger failed: {result.stderr[:200]}"
            )
        data = json.loads(result.stdout)
        execution_id = data.get("id", "").split("/")[-1]
        return {
            "status": "triggered",
            "execution_id": execution_id,
            "facility_code": fac["facility_code"],
            "from_date": body.from_date,
            "to_date": body.to_date,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Job trigger timed out.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Unexpected response from job trigger.")


# ── GET /facilities/{facility_id}/run/status ───────────────────────────────────

@router.get("/{facility_id}/run/status", summary="Latest run status for polling")
def run_status(facility_id: str = Path(...)):
    """
    Returns latest run status — used by dashboard to poll after triggering adhoc run.
    """
    last = _last_run(facility_id)
    if not last:
        return {"status": "no_runs", "facility_id": facility_id}
    return {
        "run_id":          last["run_id"],
        "status":          last["status"],
        "started_at":      last["started_at"],
        "ended_at":        last["ended_at"],
        "duration_seconds": last["duration_seconds"],
        "files_downloaded": last["files_downloaded"],
        "error_message":   last["error_message"],
    }
