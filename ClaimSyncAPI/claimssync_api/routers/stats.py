"""
routers/stats.py — /stats endpoints (schema-corrected)
  no payer column — group by file_type instead
  files_resubmission replaces files_duplicate
"""

from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Query
from ..db import query, query_one, SCHEMA

router = APIRouter()


@router.get("/summary", summary="Overall run statistics")
def run_summary(
    facility_id: Optional[str] = Query(None),
    days:        int            = Query(30, ge=1, le=365),
):
    filters = ["r.started_at >= NOW() - (%s || ' days')::interval"]
    params: list = [days]
    if facility_id:
        filters.append("r.facility_id = %s::uuid")
        params.append(facility_id)
    where = "WHERE " + " AND ".join(filters)
    fac_sub = ("AND r2.facility_id = %s::uuid" if facility_id else "")

    row = query_one(
        f"""
        SELECT
            COUNT(*)                                                AS total_runs,
            COUNT(*) FILTER (WHERE r.status = 'success')           AS successful_runs,
            COUNT(*) FILTER (WHERE r.status = 'failed')            AS failed_runs,
            COALESCE(SUM(r.files_downloaded),   0)                 AS total_files_downloaded,
            COALESCE(SUM(r.files_resubmission), 0)                 AS total_files_duplicate,
            AVG(r.duration_seconds)                                AS avg_duration_seconds,
            MAX(r.started_at)                                      AS last_run_at,
            (SELECT r2.status
             FROM   {SCHEMA}.sync_run_log r2
             WHERE  r2.started_at >= NOW() - (%s || ' days')::interval
             {fac_sub}
             ORDER  BY r2.started_at DESC LIMIT 1)                 AS last_run_status
        FROM {SCHEMA}.sync_run_log r
        {where}
        """,
        tuple(params + params),
    )
    return row or {}


@router.get("/payers", summary="Files per type (claims/resubmission/remittance)")
def payer_breakdown(
    facility_id: Optional[str] = Query(None),
    days:        int            = Query(30, ge=1, le=365),
):
    """Groups by file_type (claims|resubmission|remittance|unknown) — schema has no payer column."""
    filters = ["f.downloaded_at >= NOW() - (%s || ' days')::interval"]
    params: list = [days]
    if facility_id:
        filters.append("f.facility_id = %s::uuid")
        params.append(facility_id)
    where = "WHERE " + " AND ".join(filters)

    rows = query(
        f"""
        SELECT
            COALESCE(f.file_type, 'unknown') AS payer,
            COUNT(*)                          AS file_count,
            COUNT(DISTINCT f.run_id)          AS run_count
        FROM {SCHEMA}.file_manifest f
        {where}
        GROUP BY f.file_type
        ORDER BY file_count DESC
        """,
        tuple(params),
    )
    return rows


@router.get("/daily", summary="Daily file download trend")
def daily_trend(
    facility_id: Optional[str] = Query(None),
    days:        int            = Query(14, ge=1, le=90),
):
    filters = ["f.downloaded_at >= NOW() - (%s || ' days')::interval"]
    params: list = [days]
    if facility_id:
        filters.append("f.facility_id = %s::uuid")
        params.append(facility_id)
    where = "WHERE " + " AND ".join(filters)
    rows = query(
        f"""
        SELECT
            DATE(f.downloaded_at AT TIME ZONE 'Asia/Dubai') AS date,
            COUNT(*)                                         AS files_downloaded,
            COUNT(*) FILTER (WHERE f.is_duplicate)          AS files_duplicate
        FROM {SCHEMA}.file_manifest f
        {where}
        GROUP BY DATE(f.downloaded_at AT TIME ZONE 'Asia/Dubai')
        ORDER BY date ASC
        """,
        tuple(params),
    )
    return [{"date": str(r["date"]), **{k: v for k, v in r.items() if k != "date"}}
            for r in rows]


@router.get("/duplicates", summary="Resubmission rate per run")
def duplicate_rate(
    facility_id: Optional[str] = Query(None),
    limit:       int            = Query(20, ge=1, le=100),
):
    filters = []
    params: list = []
    if facility_id:
        filters.append("r.facility_id = %s::uuid")
        params.append(facility_id)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    rows = query(
        f"""
        SELECT
            r.run_id::text,
            r.started_at,
            r.files_downloaded,
            r.files_resubmission                                   AS files_duplicate,
            CASE WHEN r.files_downloaded > 0
                 THEN ROUND(100.0 * r.files_resubmission / r.files_downloaded, 1)
                 ELSE 0
            END                                                    AS duplicate_pct
        FROM {SCHEMA}.sync_run_log r
        {where}
        ORDER BY r.started_at DESC
        LIMIT %s
        """,
        tuple(params) + (limit,),
    )
    return rows
