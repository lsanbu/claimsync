# =============================================================================
# db_config_provider.py — ClaimSync Phase 2 (P2-T01)
# =============================================================================
# Project      : ClaimSync (Kaaryaa GenAI Solutions)
# Phase        : Phase 2 — Engine Migration
# Purpose      : DBConfigProvider — reads tenant/facility config from
#                Azure PostgreSQL (claimssync schema) and returns a
#                ConfigParser-compatible object so main engine code
#                (ClaimSync1a → ClaimSync2) requires ZERO changes.
#
# Replaces     : LocalINIProvider (shafafiaapi.ini) — Phase 0 baseline
# Drop-in swap : provider = DBConfigProvider(tenant_short_code, credential_provider)
#                config   = provider.get_main_config()
#                All config['section']['key'] accesses remain identical.
#
# Auth strategy:
#   Azure (container) : DefaultAzureCredential → Managed Identity token for
#                        PostgreSQL flexible server (azure.extensions auth)
#   Local / CI        : CLAIMSSYNC_DB_DSN env var (standard libpq DSN)
#                        e.g. "host=... dbname=postgres user=claimsyncadmin
#                              password=... sslmode=require"
#
# Dependencies : psycopg2-binary, azure-identity (both in requirements.txt)
#
# Change History:
#   v1.0  Mar 2026  Anbu / Kaaryaa — initial Phase 2 implementation
# =============================================================================

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ConfigProvider ABC (same interface as config_provider.py Phase 0)
# ---------------------------------------------------------------------------

class ConfigProvider(ABC):
    """Abstract base — all config backends implement this."""

    @abstractmethod
    def get_main_config(self) -> "ClaimSyncConfig":
        """Return a ConfigParser-compatible config object."""
        ...


# ---------------------------------------------------------------------------
# ClaimSyncConfig — dict-like wrapper returned by any ConfigProvider
# Supports: config['section']['key'] — identical to ConfigParser access
# ---------------------------------------------------------------------------

class ClaimSyncConfig:
    """
    Thin dict wrapper that mimics ConfigParser section/key access.
    Populated by any ConfigProvider (INI or DB).
    Engine code accesses it as: config['shafaapi-main']['active']
    """

    def __init__(self) -> None:
        self._data: dict[str, dict[str, str]] = {}

    def set(self, section: str, key: str, value: str) -> None:
        self._data.setdefault(section, {})[key] = value

    def set_section(self, section: str, values: dict[str, str]) -> None:
        self._data[section] = values

    def __getitem__(self, section: str) -> dict[str, str]:
        if section not in self._data:
            raise KeyError(f"ClaimSyncConfig: section '{section}' not found")
        return self._data[section]

    def __contains__(self, section: str) -> bool:
        return section in self._data

    def sections(self) -> list[str]:
        return list(self._data.keys())


# ---------------------------------------------------------------------------
# CredentialProvider protocol (loose — avoids circular import)
# Implemented by KeyVaultCredentialProvider in kv_credential_provider.py
# ---------------------------------------------------------------------------

class CredentialProvider(ABC):
    """Fetches a named secret value. Implemented by KeyVaultCredentialProvider."""

    @abstractmethod
    def get_secret(self, secret_name: str) -> str:
        ...


# ---------------------------------------------------------------------------
# DBConfigProvider — Phase 2 production implementation
# ---------------------------------------------------------------------------

class DBConfigProvider(ConfigProvider):
    """
    Reads tenant + facility configuration from Azure PostgreSQL
    (claimssync schema) and returns a ClaimSyncConfig object that is
    drop-in compatible with the LocalINIProvider output.

    INI → DB mapping:
      [shafaapi-main]
        active          ← tenants.status == 'active'  → 'y' / 'n'
        validuntil      ← facility_subscriptions.valid_until (first active facility)
        noofsetup       ← COUNT of active tenant_facilities rows
        systemfolder    ← tenant_facilities.local_base_path (first facility) [Phase 2: unused — Blob replaces]
        tempfolder      ← os.environ['CLAIMSSYNC_TEMP_DIR'] or '/tmp/claimssync/'
        enchost         ← REMOVED (host-lock eliminated in cloud — always returns '' )

      [client-config-N]  (N = 1-based, matches engine loop)
        userid          ← KeyVault: {kv_secret_prefix}-userid
        password        ← KeyVault: {kv_secret_prefix}-password
        callerlicense   ← KeyVault: {kv_secret_prefix}-caller-license
        facility        ← tenant_facilities.facility_code
        claims          ← tenant_facilities.local_base_path / claims_subfolder
        resubmission    ← tenant_facilities.local_base_path / resubmission_subfolder
        remittance      ← tenant_facilities.local_base_path / remittance_subfolder
        blob_container  ← tenant_facilities.blob_container
        kv_prefix       ← tenant_facilities.kv_secret_prefix
        lookback_days   ← tenant_facilities.lookback_days
        interval_hours  ← tenant_facilities.interval_hours
        api_sleep_secs  ← tenant_facilities.api_sleep_seconds
    """

    def __init__(
        self,
        tenant_short_code: Optional[str] = None,
        credential_provider: Optional[CredentialProvider] = None,
        dsn: Optional[str] = None,
    ) -> None:
        """
        Args:
            tenant_short_code:   e.g. 'KAARYAA-T1' — scopes the returned config
                                 to facilities owned by that tenant. Pass
                                 None (v3.14 default) to run multi-tenant:
                                 every facility with status='active' AND
                                 credentials_provided=TRUE is returned
                                 regardless of tenant.
            credential_provider: KeyVaultCredentialProvider instance.
                                 If None, credentials are returned as empty
                                 strings (useful for config-only unit tests).
            dsn:                 Override DB connection string. If None, uses
                                 CLAIMSSYNC_DB_DSN env var, then Managed Identity.
        """
        self.tenant_short_code = tenant_short_code
        self.credential_provider = credential_provider
        self._dsn = dsn
        self._conn: Optional[psycopg2.extensions.connection] = None

    # ------------------------------------------------------------------ #
    # Public interface                                                     #
    # ------------------------------------------------------------------ #

    def get_main_config(self) -> ClaimSyncConfig:
        """
        Connect to DB, read facility rows, build and return ClaimSyncConfig
        compatible with engine config['section']['key'] access.

        v3.14: when tenant_short_code is None, facilities from ALL tenants
        are loaded (filtered by status='active' AND credentials_provided=TRUE).
        When tenant_short_code is set, the legacy single-tenant scope applies.
        """
        if self.tenant_short_code:
            logger.info(f"DBConfigProvider: loading config for tenant '{self.tenant_short_code}'")
        else:
            logger.info("DBConfigProvider: loading config MULTI-TENANT (all active+credentialed facilities)")

        conn = self._get_connection()
        try:
            if self.tenant_short_code:
                tenant = self._fetch_tenant(conn)
                facilities = self._fetch_facilities(conn, tenant["tenant_id"])
                subscription = self._fetch_subscription_expiry(conn, tenant["tenant_id"])
                tenant_status = tenant["status"]
            else:
                tenant = None
                facilities = self._fetch_facilities(conn, tenant_id=None)
                subscription = self._fetch_subscription_expiry(conn, tenant_id=None)
                # Multi-tenant: per-facility tenant status is enforced by the
                # WHERE clause in _fetch_facilities (t.status != 'cancelled');
                # the legacy shafaapi-main.active flag is unused by main().
                tenant_status = "active"
        finally:
            conn.close()

        if not facilities:
            raise RuntimeError(
                "DBConfigProvider: no active+credentialed facilities found "
                + (f"for tenant '{self.tenant_short_code}'"
                   if self.tenant_short_code else "across any tenant")
            )

        config = ClaimSyncConfig()

        # ── [shafaapi-main] ─────────────────────────────────────────────
        temp_dir = os.environ.get("CLAIMSSYNC_TEMP_DIR", "/tmp/claimssync/")
        first_facility = facilities[0]

        config.set_section("shafaapi-main", {
            "active":       "y" if tenant_status == "active" else "n",
            "validuntil":   subscription or "99991231",  # never expires if no sub row
            "noofsetup":    str(len(facilities)),
            "systemfolder": first_facility["local_base_path"] or temp_dir,
            "tempfolder":   temp_dir,
            "enchost":      "",  # host-lock eliminated — always empty in Phase 2+
        })

        # ── [client-config-N] — one per active facility ─────────────────
        for idx, fac in enumerate(facilities, start=1):
            section = f"client-config-{idx}"

            # Credentials from Key Vault (empty strings if no credential_provider)
            userid, password, caller_license = self._fetch_credentials(fac)

            # Build local paths — Phase 2: engine still writes to local path
            # Phase 3: blob_container replaces local path entirely
            base = (fac["local_base_path"] or "").rstrip("/\\")
            sep = "\\" if "\\" in base else "/"

            config.set_section(section, {
                # Core credentials — engine uses these directly
                "userid":         userid,
                "password":       password,
                "callerlicense":  caller_license,   # lowercase alias
                "callerLicense":  caller_license,   # camelCase — mainsub reads this key

                # Facility identity
                "facility":       fac["facility_code"],
                "facility_id":    str(fac["facility_id"]),

                # Local folder paths (Phase 2 on-prem + cloud parallel run)
                "claims":         f"{base}{sep}{fac['claims_subfolder']}",
                "resubmission":   f"{base}{sep}{fac['resubmission_subfolder']}",
                "remittance":     f"{base}{sep}{fac['remittance_subfolder']}",

                # Azure Blob target (Phase 2 Blob writes)
                "blob_container": fac["blob_container"] or "",
                "kv_prefix":      fac["kv_secret_prefix"] or "",

                # Sync tuning
                "lookback_days":  str(fac["lookback_days"]),
                "interval_hours": str(fac["interval_hours"]),
                "api_sleep_secs": str(fac["api_sleep_seconds"]),

                # SOAP search params — mainsub reads these directly from config
                # direction + transactionID are overridden per claim/remit in mainsub
                "direction":           "1",
                "ePartner":            "",
                "transactionID":       "2",
                "transactionStatus":   "2",
                "defaultsearch":       "y",
                "transactionFileName": "",
                "transactionFromDate": "",
                "transactionToDate":   "",
                "minRecordCount":      "1",
                "maxRecordCount":      "100000",
            })

            # Per-facility tenant comes from the row join (multi-tenant) or
            # the constructor arg (legacy single-tenant mode).
            _fac_tenant = fac.get("tenant_short_code") or self.tenant_short_code or "(unknown)"
            logger.info(
                f"DBConfigProvider: loaded facility [{idx}] "
                f"{fac['facility_code']} (tenant={_fac_tenant})"
            )

        return config

    # ------------------------------------------------------------------ #
    # Private helpers                                                      #
    # ------------------------------------------------------------------ #

    def _get_connection(self) -> psycopg2.extensions.connection:
        """
        Return a psycopg2 connection.
        Priority:
          1. Constructor dsn argument
          2. CLAIMSSYNC_DB_DSN env var  (local dev / CI)
          3. Managed Identity token     (Azure container runtime)
        """
        dsn = self._dsn or os.environ.get("CLAIMSSYNC_DB_DSN")

        if dsn:
            logger.debug("DBConfigProvider: connecting via DSN")
            return psycopg2.connect(dsn, options="-c search_path=claimssync,public")

        # Managed Identity path — fetch AAD token for PostgreSQL
        logger.debug("DBConfigProvider: connecting via Managed Identity")
        return self._connect_managed_identity()

    def _connect_managed_identity(self) -> psycopg2.extensions.connection:
        """
        Obtain a short-lived AAD access token via DefaultAzureCredential
        and use it as the PostgreSQL password. No static credentials stored.
        The Managed Identity (id-claimssync-engine) must have been granted
        the 'azure_pg_reader' or equivalent DB role.
        """
        try:
            from azure.identity import DefaultAzureCredential
        except ImportError:
            raise RuntimeError(
                "azure-identity is not installed. "
                "Run: pip install azure-identity  or add to requirements.txt"
            )

        credential = DefaultAzureCredential()
        token = credential.get_token(
            "https://ossrdbms-aad.database.windows.net/.default"
        )

        host = os.environ.get(
            "CLAIMSSYNC_DB_HOST",
            "claimssync-db.postgres.database.azure.com"
        )
        user = os.environ.get("CLAIMSSYNC_DB_USER", "id-claimssync-engine")

        return psycopg2.connect(
            host=host,
            dbname="postgres",
            user=user,
            password=token.token,
            sslmode="require",
            options="-c search_path=claimssync,public",
        )

    def _fetch_tenant(self, conn) -> dict:
        """Fetch tenant row by short_code. Raises if not found or suspended."""
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT tenant_id, name, short_code, status, timezone
                FROM   claimssync.tenants
                WHERE  short_code = %s
                """,
                (self.tenant_short_code,),
            )
            row = cur.fetchone()

        if not row:
            raise RuntimeError(
                f"DBConfigProvider: tenant '{self.tenant_short_code}' not found in DB"
            )
        if row["status"] == "cancelled":
            raise RuntimeError(
                f"DBConfigProvider: tenant '{self.tenant_short_code}' is cancelled"
            )

        logger.info(
            f"DBConfigProvider: tenant found — {row['name']} "
            f"[{row['status']}]"
        )
        return dict(row)

    def _fetch_facilities(self, conn, tenant_id: Optional[str] = None) -> list[dict]:
        """
        Fetch facilities eligible for the engine run, ordered by facility_code.

        v3.14: selection criteria are tenant-agnostic.
          tf.status              = 'active'
          tf.credentials_provided = TRUE
          sp.is_active           = TRUE
          t.status              != 'cancelled'

        When tenant_id is provided, an extra `tf.tenant_id = %s` clause
        limits the result to that tenant (legacy single-tenant mode).
        When tenant_id is None, facilities across ALL tenants are returned.

        tenants row is joined so per-facility logs can show the owning tenant.
        """
        sql = """
            SELECT
                tf.facility_id,
                tf.facility_code,
                tf.facility_name,
                tf.tenant_id,
                t.short_code       AS tenant_short_code,
                t.name             AS tenant_name,
                tf.local_base_path,
                tf.claims_subfolder,
                tf.resubmission_subfolder,
                tf.remittance_subfolder,
                tf.blob_container,
                tf.kv_secret_prefix,
                tf.lookback_days,
                tf.interval_hours,
                tf.api_sleep_seconds,
                tf.min_free_disk_mb,
                sp.code            AS provider_code,
                sp.api_base_url    AS provider_url,
                sp.timeout_connect_s,
                sp.timeout_read_s,
                sp.max_files_per_call
            FROM   claimssync.tenant_facilities tf
            JOIN   claimssync.tenants           t  ON t.tenant_id    = tf.tenant_id
            JOIN   claimssync.service_providers sp ON sp.provider_id = tf.service_provider_id
            WHERE  tf.status               = 'active'
              AND  tf.credentials_provided = TRUE
              AND  sp.is_active            = TRUE
              AND  t.status               != 'cancelled'
        """
        params: tuple
        if tenant_id:
            sql += "\n              AND  tf.tenant_id = %s"
            params = (str(tenant_id),)
        else:
            params = ()
        sql += "\n            ORDER BY tf.facility_code"

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        return [dict(r) for r in rows]

    def _fetch_subscription_expiry(
        self, conn, tenant_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Return the latest valid_until date across active+trial subscriptions.

        Tenant-scoped when tenant_id is provided, platform-wide when None.
        Formatted as YYYYMMDD to match the legacy INI contract. Used only
        to populate shafaapi-main.validuntil, which current main() does not
        read — kept for drop-in compatibility with pre-Phase-2 engine code.
        Returns None if no subscription rows exist.
        """
        sql = """
            SELECT MAX(fs.valid_until)
            FROM   claimssync.facility_subscriptions fs
            JOIN   claimssync.tenant_facilities tf
                   ON tf.facility_id = fs.facility_id
            WHERE  fs.status IN ('trial', 'active')
        """
        params: tuple
        if tenant_id:
            sql += "\n              AND tf.tenant_id = %s"
            params = (str(tenant_id),)
        else:
            params = ()

        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()

        if row and row[0]:
            return row[0].strftime("%Y%m%d")
        return None

    def _fetch_credentials(self, facility: dict) -> tuple[str, str, str]:
        """
        Fetch userid, password, caller_license for a facility from
        KeyVaultCredentialProvider using the kv_secret_prefix stored in DB.

        Key Vault secret naming convention:
          {kv_secret_prefix}-userid
          {kv_secret_prefix}-password
          {kv_secret_prefix}-caller-license

        e.g. prefix='facility-mf2618' →
             facility-mf2618-userid
             facility-mf2618-password
             facility-mf2618-caller-license
        """
        if not self.credential_provider:
            logger.warning(
                f"DBConfigProvider: no credential_provider set — "
                f"returning empty credentials for {facility['facility_code']}"
            )
            return ("", "", "")

        prefix = facility.get("kv_secret_prefix", "")
        if not prefix:
            logger.error(
                f"DBConfigProvider: facility {facility['facility_code']} "
                f"has no kv_secret_prefix — cannot fetch credentials"
            )
            return ("", "", "")

        try:
            userid   = self.credential_provider.get_secret(f"{prefix}-userid")
            password = self.credential_provider.get_secret(f"{prefix}-password")
            cal_lic  = self.credential_provider.get_secret(f"{prefix}-caller-license")
            logger.info(
                f"DBConfigProvider: credentials loaded for "
                f"{facility['facility_code']} (prefix={prefix})"
            )
            return (userid, password, cal_lic)
        except Exception as exc:
            logger.error(
                f"DBConfigProvider: failed to fetch credentials for "
                f"{facility['facility_code']}: {exc}"
            )
            raise


# ---------------------------------------------------------------------------
# Smoke-test helper (run directly: python db_config_provider.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.DEBUG, format="%(levelname)s  %(message)s")

    print("\n── DBConfigProvider smoke test ──")
    print("Reads from DB — set CLAIMSSYNC_DB_DSN env var before running.\n")

    dsn = os.environ.get("CLAIMSSYNC_DB_DSN")
    if not dsn:
        print("CLAIMSSYNC_DB_DSN not set. Set it and re-run.")
        print(
            'Example:\n  export CLAIMSSYNC_DB_DSN="host=claimssync-db.postgres.database.azure.com '
            'port=5432 dbname=postgres user=claimsyncadmin password=<pw> sslmode=require"'
        )
        raise SystemExit(1)

    provider = DBConfigProvider(
        tenant_short_code="KAARYAA-T1",
        credential_provider=None,  # no KV in smoke test
        dsn=dsn,
    )
    config = provider.get_main_config()

    print("── [shafaapi-main] ──")
    for k, v in config["shafaapi-main"].items():
        print(f"  {k:20s} = {v}")

    noofsetup = int(config["shafaapi-main"]["noofsetup"])
    for i in range(1, noofsetup + 1):
        section = f"client-config-{i}"
        print(f"\n── [{section}] ──")
        for k, v in config[section].items():
            display = "***" if k in ("password", "callerlicense") else v
            print(f"  {k:20s} = {display}")

    print("\n✅ DBConfigProvider smoke test passed.")
