"""
routers/files.py — /files endpoints
--------------------------------------
GET /files              paginated file manifest (filterable)
GET /files/{file_id}    single file record
"""

from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Query, Path, HTTPException, status
from ..db import query, query_one, SCHEMA
from ..models import FileRow, Page

router = APIRouter()

_FILE_COLS = f"""
    f.file_id::text,
    f.run_id::text,
    f.interval_id::text,
    f.facility_id::text,
    f.file_name,
    f.file_type,
    f.payer,
    f.blob_path,
    f.blob_container,
    f.local_path,
    f.is_duplicate,
    f.downloaded_at
"""


# ── GET /files ─────────────────────────────────────────────────────────────────

@router.get("", response_model=Page, summary="List downloaded files")
def list_files(
    run_id:       Optional[str]  = Query(None, description="Filter by run UUID"),
    facility_id:  Optional[str]  = Query(None, description="Filter by facility UUID"),
    payer:        Optional[str]  = Query(None, description="Filter by payer name (partial match)"),
    file_type:    Optional[str]  = Query(None, description="Filter: xml|zip|zip_extracted"),
    is_duplicate: Optional[bool] = Query(None, description="Filter duplicates: true|false"),
    date_from:    Optional[str]  = Query(None, description="downloaded_at >= (ISO date)"),
    date_to:      Optional[str]  = Query(None, description="downloaded_at <= (ISO date)"),
    limit:        int            = Query(50, ge=1, le=500),
    offset:       int            = Query(0,  ge=0),
):
    """
    Returns file manifest rows. Most useful filters:
    - `run_id` — all files from a specific run
    - `is_duplicate=true` — re-downloaded files (resubmission detection)
    - `payer` — files from a specific insurer
    """
    filters: list[str] = []
    params:  list      = []

    if run_id:
        filters.append("f.run_id = %s::uuid")
        params.append(run_id)
    if facility_id:
        filters.append("f.facility_id = %s::uuid")
        params.append(facility_id)
    if payer:
        filters.append("f.payer ILIKE %s")
        params.append(f"%{payer}%")
    if file_type:
        filters.append("f.file_type = %s")
        params.append(file_type)
    if is_duplicate is not None:
        filters.append("f.is_duplicate = %s")
        params.append(is_duplicate)
    if date_from:
        filters.append("f.downloaded_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        filters.append("f.downloaded_at <= %s::timestamptz")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    count_row = query_one(
        f"SELECT COUNT(*) AS n FROM {SCHEMA}.file_manifest f {where}",
        tuple(params),
    )
    total = count_row["n"] if count_row else 0

    rows = query(
        f"""
        SELECT {_FILE_COLS}
        FROM   {SCHEMA}.file_manifest f
        {where}
        ORDER  BY f.downloaded_at DESC
        LIMIT  %s OFFSET %s
        """,
        tuple(params) + (limit, offset),
    )

    return Page(total=total, limit=limit, offset=offset,
                items=[FileRow(**r) for r in rows])


# ── GET /files/{file_id} ───────────────────────────────────────────────────────

@router.get("/{file_id}", response_model=FileRow, summary="Single file record")
def get_file(file_id: str = Path(..., description="File UUID")):
    row = query_one(
        f"""
        SELECT {_FILE_COLS}
        FROM   {SCHEMA}.file_manifest f
        WHERE  f.file_id = %s::uuid
        """,
        (file_id,),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"File {file_id} not found.")
    return FileRow(**row)
