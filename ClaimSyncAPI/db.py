"""
db.py — PostgreSQL connection for ClaimSync API
-------------------------------------------------
Reads CLAIMSSYNC_DB_DSN env var (same KV-injected DSN used by the engine).
Uses a simple persistent connection with reconnect on failure.

For Phase 4 we can swap to asyncpg + connection pool; psycopg2 is fine for
the current query volume (dashboard reads, not high-concurrency writes).
"""

import os
import logging
import psycopg2
import psycopg2.extras
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

SCHEMA = "claimssync"
_conn: psycopg2.extensions.connection | None = None


def _connect() -> psycopg2.extensions.connection:
    dsn = os.getenv("CLAIMSSYNC_DB_DSN")
    if not dsn:
        raise RuntimeError("CLAIMSSYNC_DB_DSN env var not set")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True          # read-only API; no transactions needed
    logger.info("DB connection established")
    return conn


def get_db() -> psycopg2.extensions.connection:
    """Return a live DB connection, reconnecting if dropped."""
    global _conn
    try:
        if _conn is None or _conn.closed:
            _conn = _connect()
        else:
            # Lightweight ping
            _conn.cursor().execute("SELECT 1")
    except Exception:
        logger.warning("DB connection lost — reconnecting")
        try:
            _conn = _connect()
        except Exception as exc:
            logger.error(f"DB reconnect failed: {exc}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database unavailable. Please try again shortly.",
            )
    return _conn


def close_db() -> None:
    global _conn
    if _conn and not _conn.closed:
        _conn.close()
        logger.info("DB connection closed")
    _conn = None


def query(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a SELECT and return rows as list of dicts."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        logger.error(f"Query failed: {exc}\nSQL: {sql}\nParams: {params}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {exc}",
        )


def query_one(sql: str, params: tuple = ()) -> dict | None:
    """Execute a SELECT and return first row as dict, or None."""
    rows = query(sql, params)
    return rows[0] if rows else None
