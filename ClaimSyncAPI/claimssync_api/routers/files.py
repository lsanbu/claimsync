"""
routers/files.py — /files endpoints (schema-corrected)
  manifest_id  (was file_id)
  blob_url     (was blob_path)
  file_type    IN ('claims','resubmission','remittance','unknown')
  no payer column — derived from file_type
"""

from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Query, Path, HTTPException, status
from ..db import query, query_one, SCHEMA

router = APIRouter()

_FILE_COLS = f"""
    f.manifest_id::text                        AS file_id,
    f.run_id::text,
    f.interval_id::text,
    f.facility_id::text,
    f.file_name,
    f.file_type,
    f.file_type                                AS payer,
    f.blob_url                                 AS blob_path,
    NULL::text                                 AS blob_container,
    f.local_path,
    f.is_duplicate,
    f.downloaded_at
"""


@router.get("", summary="List downloaded files")
def list_files(
    run_id:       Optional[str]  = Query(None),
    facility_id:  Optional[str]  = Query(None),
    file_type:    Optional[str]  = Query(None, description="claims|resubmission|remittance|unknown"),
    is_duplicate: Optional[bool] = Query(None),
    date_from:    Optional[str]  = Query(None),
    date_to:      Optional[str]  = Query(None),
    limit:        int            = Query(50, ge=1, le=500),
    offset:       int            = Query(0,  ge=0),
):
    filters: list[str] = []
    params:  list      = []

    if run_id:
        filters.append("f.run_id = %s::uuid")
        params.append(run_id)
    if facility_id:
        filters.append("f.facility_id = %s::uuid")
        params.append(facility_id)
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

    return {"total": total, "limit": limit, "offset": offset, "items": rows}


@router.get("/{file_id}", summary="Single file record")
def get_file(file_id: str = Path(...)):
    row = query_one(
        f"""
        SELECT {_FILE_COLS}
        FROM   {SCHEMA}.file_manifest f
        WHERE  f.manifest_id = %s::uuid
        """,
        (file_id,),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"File {file_id} not found.")
    return row
