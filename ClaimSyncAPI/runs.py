"""
routers/runs.py — /runs endpoints
"""

from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Query, Path, HTTPException, status
from ..db import query, query_one, SCHEMA
from ..models import RunSummary, RunDetail, IntervalRow, Page

router = APIRouter()

_RUN_COLS = f"""
    r.run_id::text,
    r.facility_id::text,
    r.trigger_type,
    r.status,
    r.started_at,
    r.ended_at,
    r.duration_seconds,
    r.search_from_date,
    r.search_to_date,
    r.files_downloaded,
    COALESCE(r.files_skipped_existing + r.files_skipped_api_error, 0) AS files_skipped,
    r.files_resubmission                                               AS files_duplicate,
    r.intervals_completed,
    r.intervals_total,
    r.engine_version,
    r.host_name,
    r.error_message
"""

_INTERVAL_COLS = f"""
    i.interval_id::text,
    i.run_id::text,
    i.interval_index,
    i.interval_from,
    i.interval_to,
    i.api_called_at,
    i.api_result_code,
    i.api_error_message,
    COALESCE(i.files_in_response, 0) AS files_in_response,
    i.status,
    i.duration_ms
"""


@router.get("", response_model=Page, summary="List sync runs")
def list_runs(
    facility_id: Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    limit:       int           = Query(20, ge=1, le=100),
    offset:      int           = Query(0,  ge=0),
):
    filters = []
    params: list = []
    if facility_id:
        filters.append("r.facility_id = %s::uuid")
        params.append(facility_id)
    if status:
        filters.append("r.status = %s")
        params.append(status)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    count_row = query_one(
        f"SELECT COUNT(*) AS n FROM {SCHEMA}.sync_run_log r {where}", tuple(params))
    total = count_row["n"] if count_row else 0

    rows = query(
        f"""
        SELECT {_RUN_COLS}
        FROM   {SCHEMA}.sync_run_log r
        {where}
        ORDER  BY r.started_at DESC
        LIMIT  %s OFFSET %s
        """,
        tuple(params) + (limit, offset),
    )
    return Page(total=total, limit=limit, offset=offset,
                items=[RunSummary(**r) for r in rows])


@router.get("/{run_id}", response_model=RunDetail, summary="Run detail + intervals")
def get_run(run_id: str = Path(...)):
    row = query_one(
        f"SELECT {_RUN_COLS} FROM {SCHEMA}.sync_run_log r WHERE r.run_id = %s::uuid",
        (run_id,),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Run {run_id} not found.")
    intervals = query(
        f"""
        SELECT {_INTERVAL_COLS}
        FROM   {SCHEMA}.sync_run_intervals i
        WHERE  i.run_id = %s::uuid
        ORDER  BY i.interval_index ASC
        """,
        (run_id,),
    )
    return RunDetail(**row, intervals=[IntervalRow(**i) for i in intervals])


@router.get("/{run_id}/intervals", response_model=list[IntervalRow],
            summary="Interval breakdown for a run")
def get_intervals(
    run_id: str = Path(...),
    status: Optional[str] = Query(None),
):
    filters = ["i.run_id = %s::uuid"]
    params: list = [run_id]
    if status:
        filters.append("i.status = %s")
        params.append(status)
    rows = query(
        f"""
        SELECT {_INTERVAL_COLS}
        FROM   {SCHEMA}.sync_run_intervals i
        WHERE  {" AND ".join(filters)}
        ORDER  BY i.interval_index ASC
        """,
        tuple(params),
    )
    return [IntervalRow(**r) for r in rows]
