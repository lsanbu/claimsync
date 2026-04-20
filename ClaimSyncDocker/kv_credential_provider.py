# =============================================================================
# kv_credential_provider.py — ClaimSync Phase 2 (P2-T02)
# =============================================================================
# Project      : ClaimSync (Kaaryaa Intelligence LLP)
# Phase        : Phase 2 — Engine Migration
# Purpose      : KeyVaultCredentialProvider — fetches facility credentials
#                (userid, password, caller-license) from Azure Key Vault.
#                Replaces INI fields: userid, password, callerlicense.
#
# Key Vault    : kv-claimssync-uae.vault.azure.net
# Auth         : DefaultAzureCredential → Managed Identity (id-claimssync-engine)
#                Fallback: AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars (CI/dev)
#
# Secret naming convention (matches what was loaded in P1-T07):
#   facility-mf2618-userid
#   facility-mf2618-password
#   facility-mf2618-caller-license
#
# Secret caching: secrets are cached in-process for the lifetime of this
# object. Container App Jobs are short-lived (minutes) — no TTL needed.
#
# Dependencies : azure-keyvault-secrets, azure-identity (requirements.txt)
#
# Change History:
#   v1.0  Mar 2026  Anbu / Kaaryaa — initial Phase 2 implementation
# =============================================================================

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


class KeyVaultCredentialProvider:
    """
    Fetches named secrets from Azure Key Vault using Managed Identity.

    Used by DBConfigProvider to resolve facility credentials:
        userid   = provider.get_secret('facility-mf2618-userid')
        password = provider.get_secret('facility-mf2618-password')
        cal_lic  = provider.get_secret('facility-mf2618-caller-license')

    Implements CredentialProvider protocol (db_config_provider.CredentialProvider).
    """

    # Default KV URI — override via CLAIMSSYNC_KV_URI env var or constructor
    DEFAULT_KV_URI = "https://kv-claimssync-uae.vault.azure.net/"

    def __init__(self, vault_uri: Optional[str] = None) -> None:
        """
        Args:
            vault_uri: Key Vault URI. Defaults to CLAIMSSYNC_KV_URI env var,
                       then DEFAULT_KV_URI.
        """
        self._vault_uri = (
            vault_uri
            or os.environ.get("CLAIMSSYNC_KV_URI")
            or self.DEFAULT_KV_URI
        )
        self._client = None       # lazy-init on first get_secret call
        self._cache: dict[str, str] = {}

    # ------------------------------------------------------------------ #
    # Public interface (CredentialProvider protocol)                      #
    # ------------------------------------------------------------------ #

    def get_secret(self, secret_name: str) -> str:
        """
        Return the value of a named secret from Key Vault.
        Result is cached in-process — subsequent calls for the same
        secret_name are instant (no KV round-trip).

        Args:
            secret_name: e.g. 'facility-mf2618-userid'

        Returns:
            Secret value string.

        Raises:
            RuntimeError if secret is not found or KV is unreachable.
        """
        if secret_name in self._cache:
            logger.debug(f"KVCredentialProvider: cache hit — {secret_name}")
            return self._cache[secret_name]

        client = self._get_client()
        logger.debug(f"KVCredentialProvider: fetching '{secret_name}' from KV")

        try:
            secret = client.get_secret(secret_name)
            value  = secret.value
        except Exception as exc:
            logger.error(
                f"KVCredentialProvider: failed to fetch '{secret_name}': {exc}"
            )
            raise RuntimeError(
                f"KeyVaultCredentialProvider: could not retrieve "
                f"secret '{secret_name}' from {self._vault_uri}: {exc}"
            ) from exc

        if not value:
            raise RuntimeError(
                f"KeyVaultCredentialProvider: secret '{secret_name}' "
                f"exists but has an empty value"
            )

        self._cache[secret_name] = value
        logger.info(f"KVCredentialProvider: loaded secret '{secret_name}'")
        return value

    def preload_facility(self, kv_secret_prefix: str) -> None:
        """
        Eagerly fetch all three credentials for a facility prefix.
        Useful to fail-fast at startup rather than mid-run.

        Args:
            kv_secret_prefix: e.g. 'facility-mf2618'
        """
        for suffix in ("userid", "password", "caller-license"):
            self.get_secret(f"{kv_secret_prefix}-{suffix}")
        logger.info(
            f"KVCredentialProvider: preloaded credentials for prefix "
            f"'{kv_secret_prefix}'"
        )

    def clear_cache(self) -> None:
        """Clear in-process secret cache (useful for long-lived processes)."""
        self._cache.clear()
        logger.debug("KVCredentialProvider: cache cleared")

    # ------------------------------------------------------------------ #
    # Private helpers                                                      #
    # ------------------------------------------------------------------ #

    def _get_client(self):
        """
        Lazy-init SecretClient with DefaultAzureCredential.
        In Azure container: Managed Identity (id-claimssync-engine) is used.
        In local dev:       env vars AZURE_TENANT_ID + AZURE_CLIENT_ID +
                            AZURE_CLIENT_SECRET provide SP credentials.
        """
        if self._client is not None:
            return self._client

        try:
            from azure.identity import DefaultAzureCredential
            from azure.keyvault.secrets import SecretClient
        except ImportError as exc:
            raise RuntimeError(
                "azure-identity and azure-keyvault-secrets are required. "
                "Run: pip install azure-identity azure-keyvault-secrets"
            ) from exc

        credential    = DefaultAzureCredential()
        self._client  = SecretClient(
            vault_url=self._vault_uri,
            credential=credential,
        )
        logger.info(
            f"KVCredentialProvider: SecretClient initialised "
            f"(vault={self._vault_uri})"
        )
        return self._client


# ---------------------------------------------------------------------------
# Smoke-test (run directly: python kv_credential_provider.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG, format="%(levelname)s  %(message)s")

    print("\n── KeyVaultCredentialProvider smoke test ──")
    print("Requires Azure login or Managed Identity + KV access.\n")

    provider = KeyVaultCredentialProvider()

    # Test MF2618 — secrets must exist in kv-claimssync-uae
    prefix = "facility-mf2618"
    for suffix in ("userid", "password", "caller-license"):
        name  = f"{prefix}-{suffix}"
        value = provider.get_secret(name)
        shown = "***" if suffix != "userid" else value
        print(f"  {name:40s} = {shown}")

    print("\n✅ KeyVaultCredentialProvider smoke test passed.")
