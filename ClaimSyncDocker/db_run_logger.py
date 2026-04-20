"""
db_run_logger.py  —  ClaimSync  P3-T02
=======================================
Logs sync run metadata and per-file downloads to Azure PostgreSQL.

Tables written:
  claimssync.sync_run_log        — one row per facility per run
  claimssync.sync_run_intervals  — one row per 2-hr interval window
  claimssync.file_manifest       — one row per downloaded file

Authentication (tried in order):
  1. CLAIMSSYNC_DB_DSN env var  — full psycopg2 DSN (local / test / KV-injected password)
  2. DefaultAzureCredential      — Managed Identity AAD token (production path)
     Required env vars for option 2:
       CLAIMSSYNC_DB_HOST   e.g. claimssync-db.postgres.database.azure.com
       CLAIMSSYNC_DB_NAME   e.g. claimssync
       CLAIMSSYNC_DB_USER   AAD-enabled PG login for the MI, e.g. claimssync-engine-mi

Activation:
  Set CLAIMSSYNC_DB_LOGGING=1 in the Container App environment.
  When 0 (default), this module is never imported and has zero runtime cost.

Design principles:
  - ALL DB errors are caught and logged — never raised to caller.
    DB logging is a side-channel; a DB failure must never abort a sync run.
  - autocommit=False; each write is its own commit.
  - _ensure_connection() silently reconnects on dropped connection.
  - facility_id UUID looked up once per facility per run and cached.

Project       : ClaimSync (Kaaryaa GenAI Solutions)
Phase         : Phase 3 — P3-T02
Target DB     : claimssync-db (Azure PostgreSQL Flexible Server, UAE North)
Schema        : claimssync  (set_search_path handled per query)
Engine version: 2.13 → bumped to 3.1 on first P3-T02 release
Author        : Anbu / Kaaryaa GenAI Solutions
Date          : March 2026
"""

import os
import logging
import socket
from datetime import date, datetime
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

# Schema prefix — matches claimssync_schema_v2.sql
SCHEMA = 'claimssync'

# Engine version tag written to sync_run_log.engine_version
ENGINE_VERSION = '3.18'

# Status values the schema's sync_run_log_status_check constraint permits.
# Must stay in sync with the DB migration applied alongside engine :3.13.
VALID_END_STATUSES = ('success', 'partial', 'failed', 'auth_failed', 'skipped_auth_failed')

# v3.15: dedup bypass switch. Set CLAIMSSYNC_DEDUP_BYPASS=1 in the Container
# App Job env to force re-download + re-INSERT even when a file already exists
# in file_manifest for this facility. Used for adhoc re-runs of a date range
# whose original pull was corrupted (bad credentials, partial blob upload, etc).
# Read once at import — env vars are static for the lifetime of a job execution.
DEDUP_BYPASS = os.environ.get('CLAIMSSYNC_DEDUP_BYPASS', '0').strip() == '1'
if DEDUP_BYPASS:
    logger.warning('DBRunLogger: CLAIMSSYNC_DEDUP_BYPASS=1 — file_manifest dedup DISABLED for this run')

# Shafafiya API returns dates as DD/MM/YYYY HH:MM:SS or DD/MM/YYYY.
# PostgreSQL expects ISO YYYY-MM-DD [HH:MM:SS]. This helper converts either.
_SHAFAFIYA_FMTS = ('%d/%m/%Y %H:%M:%S', '%d/%m/%Y')

def _parse_dt(value) -> Optional[datetime]:
    """
    Accept a datetime, date, or DD/MM/YYYY [HH:MM:SS] string.
    Returns a datetime (or None on failure) safe for psycopg2 insertion.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, str):
        for fmt in _SHAFAFIYA_FMTS:
            try:
                return datetime.strptime(value.strip(), fmt)
            except ValueError:
                continue
        logger.warning(f'_parse_dt: unrecognised date string: {value!r}')
    return None


class DBRunLogger:
    """
    Thin write-only wrapper for the ClaimSync sync audit tables.

    Usage pattern (in ClaimSync2.py):

        logger = DBRunLogger()
        logger.connect()                      # once at startup

        # per-facility in the facility loop:
        run_id = logger.start_run(...)        # INSERT sync_run_log status='running'

        # per-interval in build_and_execute_search_request():
        interval_id = logger.log_interval(...)  # INSERT sync_run_intervals

        # per-file in GetHistoryTxnFileDownload():
        logger.log_file(...)                  # INSERT file_manifest

        # after all mainsub calls for the facility:
        logger.end_run(run_id, status, ...)   # UPDATE sync_run_log with final stats
    """

    def __init__(self):
        self._conn = None
        # facility_code → facility_id UUID str (cached for the lifetime of the process)
        self._facility_id_cache: dict = {}

    # ──────────────────────────────────────────────────────────────────
    # Connection management
    # ──────────────────────────────────────────────────────────────────

    def connect(self):
        """
        Open a psycopg2 connection.

        Tries CLAIMSSYNC_DB_DSN first (direct DSN — useful for local dev and
        for Container App deployments where the password is injected as a KV
        secret reference into the env var).

        Falls back to DefaultAzureCredential AAD token (zero-secret, Managed
        Identity path recommended for production).

        Raises on failure — caller (main()) should catch, log, and disable
        DB logging for the remainder of the run rather than aborting.
        """
        dsn = os.environ.get('CLAIMSSYNC_DB_DSN', '').strip()
        if dsn:
            logger.info('DBRunLogger.connect: using CLAIMSSYNC_DB_DSN')
            self._conn = psycopg2.connect(dsn)
        else:
            logger.info('DBRunLogger.connect: using DefaultAzureCredential (AAD token)')
            from azure.identity import DefaultAzureCredential
            credential = DefaultAzureCredential()
            token = credential.get_token(
                'https://ossrdbms-aad.database.windows.net/.default'
            )
            self._conn = psycopg2.connect(
                host=os.environ['CLAIMSSYNC_DB_HOST'],
                dbname=os.environ['CLAIMSSYNC_DB_NAME'],
                user=os.environ['CLAIMSSYNC_DB_USER'],
                password=token.token,
                sslmode='require',
            )

        self._conn.autocommit = False
        logger.info('DBRunLogger.connect: PostgreSQL connection established')

    def close(self):
        """Close connection if open. Safe to call multiple times."""
        try:
            if self._conn and not self._conn.closed:
                self._conn.close()
                logger.info('DBRunLogger.close: connection closed')
        except Exception as exc:
            logger.warning(f'DBRunLogger.close: {exc}')

    def _ensure_connection(self):
        """Silently reconnect if the connection was dropped between calls."""
        try:
            if self._conn is None or self._conn.closed:
                logger.info('DBRunLogger._ensure_connection: reconnecting')
                self.connect()
            else:
                # Cheap liveness ping
                with self._conn.cursor() as cur:
                    cur.execute('SELECT 1')
        except Exception:
            logger.info('DBRunLogger._ensure_connection: ping failed, reconnecting')
            self.connect()

    # ──────────────────────────────────────────────────────────────────
    # Facility lookup
    # ──────────────────────────────────────────────────────────────────

    def get_facility_id(self, facility_code: str) -> Optional[str]:
        """
        Return the facility_id UUID for a given facility_code.

        Queries tenant_facilities. Cached after first hit so the
        same SELECT isn't repeated for every file in a run.

        Returns None if the facility is not found or the query fails.
        Logs a warning either way — never raises.
        """
        if facility_code in self._facility_id_cache:
            return self._facility_id_cache[facility_code]
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"SELECT facility_id "
                    f"FROM {SCHEMA}.tenant_facilities "
                    f"WHERE facility_code = %s "
                    f"LIMIT 1",
                    (facility_code,)
                )
                row = cur.fetchone()
                if row:
                    fid = str(row[0])
                    self._facility_id_cache[facility_code] = fid
                    logger.info(f'DBRunLogger.get_facility_id: {facility_code} → {fid}')
                    return fid
                logger.warning(
                    f'DBRunLogger.get_facility_id: facility_code={facility_code} '
                    f'not found in tenant_facilities'
                )
        except Exception as exc:
            logger.warning(f'DBRunLogger.get_facility_id failed for {facility_code}: {exc}')
        return None

    # ──────────────────────────────────────────────────────────────────
    # sync_run_log — one row per facility per BAU run
    # ──────────────────────────────────────────────────────────────────

    def start_run(
        self,
        facility_code: str,
        search_from: date,
        search_to: date,
        trigger_type: str = 'scheduled',
    ) -> Optional[str]:
        """
        INSERT a new sync_run_log row with status='running'.

        Called once per facility at the start of the h-claim pass.
        Returns run_id (UUID str) on success, None on failure.
        """
        facility_id = self.get_facility_id(facility_code)
        if not facility_id:
            logger.warning(f'DBRunLogger.start_run: no facility_id for {facility_code} — skipping')
            return None
        # Convert Shafafiya DD/MM/YYYY strings → datetime for PostgreSQL
        search_from_dt = _parse_dt(search_from)
        search_to_dt   = _parse_dt(search_to)
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.sync_run_log (
                        facility_id, trigger_type, started_at,
                        search_from_date, search_to_date,
                        status, engine_version, host_name
                    ) VALUES (%s, %s, NOW(), %s, %s, 'running', %s, %s)
                    RETURNING run_id
                    """,
                    (
                        facility_id, trigger_type,
                        search_from_dt, search_to_dt,
                        ENGINE_VERSION, socket.gethostname(),
                    )
                )
                run_id = str(cur.fetchone()[0])
                self._conn.commit()
                logger.info(
                    f'DBRunLogger.start_run: run_id={run_id} '
                    f'facility={facility_code} '
                    f'{search_from} → {search_to}'
                )
                return run_id
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            logger.warning(f'DBRunLogger.start_run failed for {facility_code}: {exc}')
            return None

    def update_progress(
        self,
        run_id: str,
        intervals_completed: int,
        intervals_total: int,
        current_interval_from: Optional[str] = None,
        current_interval_to: Optional[str] = None,
    ) -> None:
        """v3.16: incremental progress UPDATE called after each interval finishes.
        v3.17: adds current_interval_from / current_interval_to so the dashboard
               can show "Currently: 12 Apr 2026 22:00 → 24:00". Caller formats
               the strings as 'YYYY-MM-DD HH:MM'. Columns added by
               migration_v5_run_progress.sql — must be applied before deploy.

        Writes counters together — intervals_total may not have been known at
        start_run() time (computing it requires replicating mainsub's date
        parsing + 2-hr split logic, including the v3.12 same-day adhoc 24-hr
        extension), so it's set on the first update_progress call instead. The
        dashboard polls every 5s, so the denominator becomes visible within one
        poll of the first interval finishing.

        Both counter values are CUMULATIVE across phases — caller passes the
        running totals from _run_stats so the display ticks smoothly across the
        h-claim → h-remit phase boundary instead of resetting mid-run.

        Non-fatal: failures rolled back + logged + swallowed (must never abort
        a sync run for a progress-reporting hiccup).
        """
        if not run_id:
            return
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {SCHEMA}.sync_run_log SET
                        intervals_completed   = %s,
                        intervals_total       = %s,
                        current_interval_from = %s,
                        current_interval_to   = %s
                    WHERE run_id = %s
                    """,
                    (
                        intervals_completed, intervals_total,
                        current_interval_from, current_interval_to,
                        str(run_id),
                    ),
                )
                self._conn.commit()
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            logger.warning(
                f'DBRunLogger.update_progress failed for run_id={run_id}: {exc}'
            )

    def file_already_downloaded(self, facility_code: str, shafafiya_txn_id: str) -> bool:
        """v3.15: engine-level dedup pre-check.

        Returns True iff a file_manifest row already exists for this
        (facility_id, shafafiya_txn_id) — i.e. this Shafafiya FileID was
        pulled in any prior run for this facility.

        Called from the FileID loop in ClaimSync2.mainsub() BEFORE
        DownloadTransactionFile, so we skip both the Shafafiya API call
        and the blob upload for files we already have.

        Fail-open: if the SELECT errors out, returns False so the file
        gets downloaded (data completeness > perfect dedup).
        Bypass: returns False unconditionally if CLAIMSSYNC_DEDUP_BYPASS=1.
        """
        if DEDUP_BYPASS:
            return False
        if not facility_code or not shafafiya_txn_id:
            return False
        facility_id = self.get_facility_id(facility_code)
        if not facility_id:
            return False
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"SELECT 1 FROM {SCHEMA}.file_manifest "
                    f"WHERE facility_id = %s AND shafafiya_txn_id = %s LIMIT 1",
                    (facility_id, shafafiya_txn_id),
                )
                return cur.fetchone() is not None
        except Exception as exc:
            logger.warning(
                f'DBRunLogger.file_already_downloaded check failed '
                f'(fail-open, will re-download): {exc}'
            )
            return False

    def end_run(
        self,
        run_id: str,
        status: str,                          # see VALID_END_STATUSES
        intervals_total: int = 0,
        intervals_completed: int = 0,
        intervals_skipped: int = 0,
        files_found: int = 0,
        files_downloaded: int = 0,
        files_skipped_api_error: int = 0,
        files_resubmission: int = 0,
        files_remittance: int = 0,
        error_message: Optional[str] = None,
    ):
        """
        UPDATE the sync_run_log row: set ended_at, status, and all counters.

        Called once per facility at the end of the facility loop iteration
        in main(), after all 6 mainsub() calls complete.
        status must be one of VALID_END_STATUSES:
          'success'              — normal completion
          'partial'              — some intervals failed
          'failed'               — non-auth fatal error
          'auth_failed'          — Shafafiya returned sr_code -1/-2 (v3.13)
          'skipped_auth_failed'  — precondition skip (written via log_skipped_run)
        """
        if not run_id:
            return
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {SCHEMA}.sync_run_log SET
                        ended_at                = NOW(),
                        status                  = %s,
                        error_message           = %s,
                        intervals_total         = %s,
                        intervals_completed     = %s,
                        intervals_skipped       = %s,
                        files_found             = %s,
                        files_downloaded        = %s,
                        files_skipped_api_error = %s,
                        files_resubmission      = %s,
                        files_remittance        = %s,
                        current_interval_from   = NULL,
                        current_interval_to     = NULL
                    WHERE run_id = %s
                    """,
                    (
                        status, error_message,
                        intervals_total, intervals_completed, intervals_skipped,
                        files_found, files_downloaded, files_skipped_api_error,
                        files_resubmission, files_remittance,
                        run_id,
                    )
                )
                self._conn.commit()
                logger.info(
                    f'DBRunLogger.end_run: run_id={run_id} status={status} '
                    f'files_dl={files_downloaded} intervals={intervals_completed}/{intervals_total}'
                )
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            logger.warning(f'DBRunLogger.end_run failed for run_id={run_id}: {exc}')

    # ──────────────────────────────────────────────────────────────────
    # v3.13 — auth-failure precondition handling
    # ──────────────────────────────────────────────────────────────────

    def get_last_real_run_status(self, facility_code: str) -> Optional[str]:
        """
        Return the status of the most recent *real* sync_run_log row for this
        facility. Rows with status='running' (stale in-flight) and
        'skipped_auth_failed' (precondition no-ops from prior days) are
        excluded — we want to know what the last honest attempt did.

        Used by main() before start_run: if the last real attempt was
        'auth_failed', the scheduled run is skipped to prevent repeatedly
        hammering Shafafiya with credentials that are known to be bad.

        Returns None when no prior row exists or on query failure.
        Never raises.
        """
        facility_id = self.get_facility_id(facility_code)
        if not facility_id:
            return None
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT status
                    FROM {SCHEMA}.sync_run_log
                    WHERE facility_id = %s
                      AND status NOT IN ('running', 'skipped_auth_failed')
                    ORDER BY started_at DESC
                    LIMIT 1
                    """,
                    (facility_id,)
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception as exc:
            logger.warning(
                f'DBRunLogger.get_last_real_run_status failed '
                f'for {facility_code}: {exc}'
            )
            return None

    def log_skipped_run(
        self,
        facility_code: str,
        trigger_type: str,
        search_from: date,
        search_to: date,
        error_message: str,
    ) -> Optional[str]:
        """
        INSERT a sync_run_log row with status='skipped_auth_failed'.

        Used when a scheduled run is skipped because the previous real run
        was auth_failed. The row has started_at = ended_at = NOW() so the
        dashboard's "most recent run" query shows it alongside real runs.

        Returns run_id on success, None on failure. Never raises.
        """
        facility_id = self.get_facility_id(facility_code)
        if not facility_id:
            return None
        search_from_dt = _parse_dt(search_from)
        search_to_dt   = _parse_dt(search_to)
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.sync_run_log (
                        facility_id, trigger_type, started_at, ended_at,
                        search_from_date, search_to_date,
                        status, error_message,
                        engine_version, host_name
                    ) VALUES (%s, %s, NOW(), NOW(), %s, %s,
                              'skipped_auth_failed', %s, %s, %s)
                    RETURNING run_id
                    """,
                    (
                        facility_id, trigger_type,
                        search_from_dt, search_to_dt,
                        error_message,
                        ENGINE_VERSION, socket.gethostname(),
                    )
                )
                run_id = str(cur.fetchone()[0])
                self._conn.commit()
                logger.info(
                    f'DBRunLogger.log_skipped_run: run_id={run_id} '
                    f'facility={facility_code} reason={error_message!r}'
                )
                return run_id
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            logger.warning(
                f'DBRunLogger.log_skipped_run failed for {facility_code}: {exc}'
            )
            return None

    # ──────────────────────────────────────────────────────────────────
    # sync_run_intervals — one row per 2-hr API window
    # ──────────────────────────────────────────────────────────────────

    def log_interval(
        self,
        run_id: str,
        interval_index: int,
        interval_from: datetime,
        interval_to: datetime,
        api_result_code: str,           # '0' = OK, 'ERR' = failed, 'SKIP' = no-op
        files_in_response: int = 0,     # count from the search response (0 in h phase;
                                        # could be updated later from hff if needed)
        status: str = 'pending',        # 'success' | 'error' | 'skipped'
        duration_ms: Optional[int] = None,
        api_error_message: Optional[str] = None,
    ) -> Optional[str]:
        """
        INSERT a sync_run_intervals row immediately after the Shafafiya
        SearchTransactions API call returns in build_and_execute_search_request().

        Returns interval_id (UUID str) for storage in _interval_id_map so
        file_manifest rows can reference the correct interval.
        Returns None on failure — caller continues normally.
        """
        if not run_id:
            return None
        # Convert Shafafiya DD/MM/YYYY HH:MM:SS strings → datetime for PostgreSQL
        interval_from_dt = _parse_dt(interval_from)
        interval_to_dt   = _parse_dt(interval_to)
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.sync_run_intervals (
                        run_id, interval_index,
                        interval_from, interval_to,
                        api_called_at, api_result_code, api_error_message,
                        files_in_response, status, duration_ms
                    ) VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
                    RETURNING interval_id
                    """,
                    (
                        run_id, interval_index,
                        interval_from_dt, interval_to_dt,
                        api_result_code, api_error_message,
                        files_in_response, status, duration_ms,
                    )
                )
                interval_id = str(cur.fetchone()[0])
                self._conn.commit()
                return interval_id
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            logger.warning(
                f'DBRunLogger.log_interval failed '
                f'run_id={run_id} idx={interval_index}: {exc}'
            )
            return None

    # ──────────────────────────────────────────────────────────────────
    # file_manifest — one row per downloaded file
    # ──────────────────────────────────────────────────────────────────

    def log_file(
        self,
        facility_code: str,
        run_id: str,
        file_name: str,
        file_type: str,                   # 'claims' | 'remittance' | 'resubmission'
        shafafiya_txn_id: Optional[str] = None,
        local_path: Optional[str] = None,
        blob_url: Optional[str] = None,
        file_size_bytes: Optional[int] = None,
        interval_id: Optional[str] = None,
        sender_id: Optional[str] = None,
        receiver_id: Optional[str] = None,
        record_count: Optional[str] = None,
        transaction_date: Optional[str] = None,
        transaction_timestamp: Optional[str] = None,
    ) -> Optional[str]:
        """
        INSERT a file_manifest row after a file is confirmed downloaded.

        Performs a dedup check: if the same file_name + facility_id already
        exists from a previous run, is_duplicate=TRUE and first_seen_run_id
        is set to that earlier run_id. This replaces the legacy os.path.exists()
        check for 'already downloaded' detection in cloud runs.

        file_type is normalised to match the DB CHECK constraint:
          'claim'  → 'claims'
          'remit'  → 'remittance'
          other    → passed through; 'unknown' used as fallback

        Returns manifest_id (UUID str) on success, None on failure.
        """
        if not run_id:
            return None

        facility_id = self.get_facility_id(facility_code)
        if not facility_id:
            return None

        # Normalise file_type to match CHECK ('claims','resubmission','remittance','unknown')
        _type_map = {
            'claim': 'claims', 'claims': 'claims',
            'remit': 'remittance', 'remittance': 'remittance',
            'resubmission': 'resubmission',
        }
        db_file_type = _type_map.get(file_type.lower(), 'unknown')

        # v3.15: dedup is now a HARD check — if (facility_id, file_name) already
        # exists in file_manifest, return the existing manifest_id and skip the
        # INSERT entirely. Pre-v3.15 set is_duplicate=TRUE and inserted anyway,
        # which produced 22k+ duplicate rows for MF4958 (and 128 / 8 for the
        # scheduled facilities) when Shafafiya returned the same FileID across
        # overlapping 2-hr interval responses.
        #
        # CLAIMSSYNC_DEDUP_BYPASS=1 restores the legacy soft-tag-and-insert
        # behaviour for forced adhoc re-runs.
        existing_manifest_id = None
        is_duplicate = False
        first_seen_run_id = None
        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT manifest_id, run_id
                    FROM {SCHEMA}.file_manifest
                    WHERE facility_id = %s AND file_name = %s
                    ORDER BY downloaded_at ASC
                    LIMIT 1
                    """,
                    (facility_id, file_name)
                )
                row = cur.fetchone()
                if row:
                    existing_manifest_id = str(row[0])
                    is_duplicate = True
                    first_seen_run_id = str(row[1])
        except Exception as exc:
            logger.warning(f'DBRunLogger.log_file dedup check failed: {exc}')
            # Non-fatal, fail-open — proceed to INSERT (better a duplicate
            # row than a missed file when the dedup query itself errors out).

        if existing_manifest_id and not DEDUP_BYPASS:
            print(f'DB:log_file SKIP duplicate file={file_name} '
                  f'first_seen_run={first_seen_run_id} '
                  f'existing_manifest_id={existing_manifest_id}')
            return existing_manifest_id

        try:
            self._ensure_connection()
            with self._conn.cursor() as cur:
                # v3.8: parse record_count to int safely
                _rc_int = None
                if record_count:
                    try:
                        _rc_int = int(record_count)
                    except (ValueError, TypeError):
                        pass
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.file_manifest (
                        facility_id, run_id, interval_id,
                        file_name, file_type,
                        file_size_bytes, shafafiya_txn_id,
                        local_path, blob_url,
                        is_duplicate, first_seen_run_id,
                        sender_id, receiver_id, record_count,
                        transaction_date, transaction_timestamp,
                        downloaded_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    RETURNING manifest_id
                    """,
                    (
                        facility_id, run_id, interval_id,
                        file_name, db_file_type,
                        file_size_bytes, shafafiya_txn_id,
                        local_path, blob_url,
                        is_duplicate, first_seen_run_id,
                        sender_id, receiver_id, _rc_int,
                        transaction_date, transaction_timestamp,
                    )
                )
                manifest_id = str(cur.fetchone()[0])
                self._conn.commit()
                print(f'DB:log_file OK manifest_id={manifest_id} file={file_name}')
                return manifest_id
        except Exception as exc:
            try:
                self._conn.rollback()
            except Exception:
                pass
            print(f'DB:log_file FAIL file={file_name} run_id={run_id}: {exc}')
            logger.warning(
                f'DBRunLogger.log_file insert failed '
                f'file={file_name} run_id={run_id}: {exc}'
            )
            return None
