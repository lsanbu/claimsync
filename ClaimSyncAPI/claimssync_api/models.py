"""
models.py — Pydantic response schemas for ClaimSync API
---------------------------------------------------------
All datetimes are returned as ISO strings (FastAPI serialises them automatically).
UUIDs are returned as strings for JSON compatibility.
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ── sync_run_log ──────────────────────────────────────────────────────────────

class RunSummary(BaseModel):
    run_id:               str
    facility_id:          str
    facility_code:        Optional[str]   = None   # joined from facilities table if available
    trigger_type:         str
    status:               str
    started_at:           Optional[datetime]
    ended_at:             Optional[datetime]
    duration_seconds:     Optional[float]
    search_from_date:     Optional[datetime]
    search_to_date:       Optional[datetime]
    files_downloaded:     int
    files_skipped:        int
    files_duplicate:      int
    intervals_completed:  int
    intervals_total:      int
    engine_version:       Optional[str]
    host_name:            Optional[str]
    error_message:        Optional[str]


class RunDetail(RunSummary):
    """RunSummary + embedded intervals."""
    intervals: list[IntervalRow] = []


# ── sync_run_intervals ────────────────────────────────────────────────────────

class IntervalRow(BaseModel):
    interval_id:       str
    run_id:            str
    interval_index:    int
    interval_from:     Optional[datetime]
    interval_to:       Optional[datetime]
    api_called_at:     Optional[datetime]
    api_result_code:   Optional[str]
    api_error_message: Optional[str]
    files_in_response: int
    status:            str
    duration_ms:       Optional[int]


# ── file_manifest ─────────────────────────────────────────────────────────────

class FileRow(BaseModel):
    file_id:        str
    run_id:         str
    interval_id:    Optional[str]
    facility_id:    str
    file_name:      str
    file_type:      str                  # xml | zip | zip_extracted
    payer:          Optional[str]        # derived from filename
    blob_path:      Optional[str]
    blob_container: Optional[str]
    local_path:     Optional[str]
    is_duplicate:   bool
    downloaded_at:  Optional[datetime]


# ── Stats / aggregates ────────────────────────────────────────────────────────

class RunStats(BaseModel):
    total_runs:             int
    successful_runs:        int
    failed_runs:            int
    total_files_downloaded: int
    total_files_duplicate:  int
    avg_duration_seconds:   Optional[float]
    last_run_at:            Optional[datetime]
    last_run_status:        Optional[str]


class PayerStat(BaseModel):
    payer:       str
    file_count:  int
    run_count:   int


# ── Pagination wrapper ────────────────────────────────────────────────────────

class Page(BaseModel):
    total:  int
    limit:  int
    offset: int
    items:  list


# Rebuild to handle forward refs
RunDetail.model_rebuild()
