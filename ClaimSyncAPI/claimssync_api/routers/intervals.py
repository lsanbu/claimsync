"""
routers/intervals.py — Interval search history + raw XML viewer
-----------------------------------------------------------------
GET  /admin/facilities/{code}/runs/{run_id}/intervals  — interval list with blob refs
GET  /admin/facilities/{code}/search-history/{blob_filename}  — raw XML content
"""

from __future__ import annotations

import os
import logging
import re
from typing import Optional

from fastapi import APIRouter, Path, HTTPException, Depends
from fastapi.responses import Response

from .auth import require_admin
from ..db import query_one, SCHEMA

router = APIRouter()
log = logging.getLogger(__name__)

STORAGE_URL = os.getenv(
    "CLAIMSSYNC_STORAGE_URL",
    "https://stclaimssyncuae.blob.core.windows.net",
)
MANAGED_IDENTITY_CLIENT_ID = "8e309ea2-175e-497e-8849-7af81a36c62a"


def _get_facility(facility_code: str) -> dict:
    row = query_one(
        f"SELECT facility_id, facility_code, facility_name, status FROM {SCHEMA}.tenant_facilities WHERE facility_code = %s",
        (facility_code.upper(),),
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Facility {facility_code} not found")
    return row


def _get_blob_container_client(facility_code: str):
    """Return a ContainerClient for claimssync-{facility} using Managed Identity."""
    from azure.identity import ManagedIdentityCredential
    from azure.storage.blob import BlobServiceClient

    credential = ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID)
    blob_service = BlobServiceClient(account_url=STORAGE_URL, credential=credential)
    container_name = f"claimssync-{facility_code.lower()}"
    return blob_service.get_container_client(container_name)


# ── GET /admin/facilities/{code}/runs/{run_id}/intervals ──────────────────────

@router.get(
    "/admin/facilities/{facility_code}/runs/{run_id}/intervals",
    summary="Interval search history for a run",
)
def get_run_intervals(
    facility_code: str = Path(...),
    run_id: str = Path(...),
    user: dict = Depends(require_admin),
):
    facility_code = facility_code.upper()
    _get_facility(facility_code)

    # Scan blob search_history/ for this facility
    try:
        container = _get_blob_container_client(facility_code)
        blobs = list(container.list_blobs(name_starts_with="search_history/"))
    except Exception as exc:
        log.warning(f"Blob list failed for {facility_code}: {exc}")
        blobs = []

    # Parse blob names into interval records
    # Pattern: search_history_request_{FACILITY}_{TYPE}_{N}.xml
    pattern = re.compile(
        rf"search_history/search_history_(request|response)_{re.escape(facility_code)}_(\w+)_(\d+)\.xml",
        re.IGNORECASE,
    )

    intervals_map: dict[str, dict] = {}  # key = "{type}_{N}"
    blob_map: dict[str, object] = {}     # blob_name → blob object for content fetch
    for blob in blobs:
        m = pattern.match(blob.name)
        if not m:
            continue
        kind = m.group(1)   # request or response
        ftype = m.group(2)  # claim or remit
        idx = int(m.group(3))
        key = f"{ftype}_{idx}"
        if key not in intervals_map:
            intervals_map[key] = {
                "interval_index": idx,
                "type": ftype,
                "from_time": None,
                "to_time": None,
                "files_found": None,
                "request_blob": None,
                "response_blob": None,
                "request_exists": False,
                "response_exists": False,
            }
        blob_filename = os.path.basename(blob.name)
        if kind == "request":
            intervals_map[key]["request_blob"] = f"search_history/{blob_filename}"
            intervals_map[key]["request_exists"] = True
        else:
            intervals_map[key]["response_blob"] = f"search_history/{blob_filename}"
            intervals_map[key]["response_exists"] = True

    # Parse from/to from request XMLs and files_found from response XMLs
    re_from = re.compile(r"<v2:transactionFromDate>([^<]+)</v2:transactionFromDate>")
    re_to   = re.compile(r"<v2:transactionToDate>([^<]+)</v2:transactionToDate>")
    re_files = re.compile(r"FileID='")
    for key, intv in intervals_map.items():
        try:
            if intv["request_exists"] and intv["request_blob"]:
                blob_client = container.get_blob_client(intv["request_blob"])
                xml = blob_client.download_blob().readall().decode("utf-8", errors="replace")
                m_from = re_from.search(xml)
                m_to = re_to.search(xml)
                if m_from:
                    intv["from_time"] = m_from.group(1)
                if m_to:
                    intv["to_time"] = m_to.group(1)
            if intv["response_exists"] and intv["response_blob"]:
                blob_client = container.get_blob_client(intv["response_blob"])
                xml = blob_client.download_blob().readall().decode("utf-8", errors="replace")
                intv["files_found"] = len(re_files.findall(xml))
        except Exception as exc:
            log.warning(f"Interval parse error for {key}: {exc}")

    # Sort by type then index
    result = sorted(intervals_map.values(), key=lambda x: (x["type"], x["interval_index"]))

    return {"run_id": run_id, "facility_code": facility_code, "intervals": result}


# ── GET /admin/facilities/{code}/search-history/{blob_filename} ───────────────

@router.get(
    "/admin/facilities/{facility_code}/search-history/{blob_filename}",
    summary="Raw XML content of a search_history blob",
)
def get_search_history_xml(
    facility_code: str = Path(...),
    blob_filename: str = Path(...),
    user: dict = Depends(require_admin),
):
    facility_code = facility_code.upper()
    _get_facility(facility_code)

    # Sanitize filename
    if ".." in blob_filename or "/" in blob_filename or "\\" in blob_filename:
        raise HTTPException(status_code=400, detail="Invalid blob filename")

    blob_path = f"search_history/{blob_filename}"
    try:
        container = _get_blob_container_client(facility_code)
        blob_client = container.get_blob_client(blob_path)
        data = blob_client.download_blob().readall()
        return Response(content=data, media_type="text/xml; charset=utf-8")
    except Exception as exc:
        log.warning(f"Blob fetch failed: {blob_path}: {exc}")
        raise HTTPException(status_code=404, detail=f"Blob not found: {blob_filename}")
