"""
ClaimSyncPull.py
================
Downloads new files from ClaimSync Azure Blob Storage to Saleem's PC.
Multi-facility support: MF2618, MF5360, MF4958.

Purpose:
  - Sync cloud-downloaded files to local PC for validation and processing
  - Supports claims, remittance, resubmission, search_history, and logs prefixes
  - Business continuity: cloud files available locally until full transition

Usage:
  python ClaimSyncPull.py              # pull all new files
  python ClaimSyncPull.py --dry-run    # show what WOULD be downloaded
  python ClaimSyncPull.py --date 17/03/2026  # pull files from specific date only

Security:
  v3.1 — No storage account key on this PC.
  Uses CLAIMSSYNC_API_URL + CLAIMSSYNC_API_TOKEN (reseller JWT) to fetch
  the storage key from the API at startup. Key lives only in memory
  during the script run — never written to disk.
  The JWT can be revoked instantly if this PC is compromised.

Requirements:
  pip install azure-storage-blob requests

Author  : Kaaryaa Intelligence LLP
Version : 3.2
Date    : March 2026
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
try:
    from azure.storage.blob import BlobServiceClient
except ImportError:
    print("[ERROR] azure-storage-blob not installed.")
    print("        Run: pip install azure-storage-blob")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("[ERROR] requests not installed.")
    print("        Run: pip install requests")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

# API endpoint for SAS token — set in environment
CLAIMSSYNC_API_URL   = os.environ.get("CLAIMSSYNC_API_URL", "").rstrip("/")
CLAIMSSYNC_API_TOKEN = os.environ.get("CLAIMSSYNC_API_TOKEN", "")

LOCAL_BASE = r"C:\Users\USER\ClaimSync\Reggr"

# Fallback facility list (overridden by API response)
FACILITIES = [
    {"code": "MF2618", "container": "claimssync-mf2618", "local": "mf2618"},
    {"code": "MF5360", "container": "claimssync-mf5360", "local": "mf5360"},
    {"code": "MF4958", "container": "claimssync-mf4958", "local": "mf4958"},
]

# Blob prefix → local subfolder mapping per facility
# search_history/ → facility root (strip prefix)
# logs/ → logs subfolder
PREFIX_MAP = {
    "claims":          "claims",
    "remittance":      "remittance",
    "resubmission":    "resubmission",
    "search_history":  "",           # root of facility folder
    "logs":            "logs",
}

# Central log — one file per day, all facilities
LOG_DATE = datetime.now().strftime("%Y-%m-%d")
LOG_FILE = os.path.join(LOCAL_BASE, f"claimsync_pull_{LOG_DATE}.log")

# ══════════════════════════════════════════════════════════════════════════════


def setup_logging():
    log_dir = Path(LOCAL_BASE)
    log_dir.mkdir(parents=True, exist_ok=True)

    # Clean up log files older than 30 days
    try:
        cutoff = datetime.now() - timedelta(days=30)
        for old_log in log_dir.glob("claimsync_pull_*.log"):
            try:
                log_dt = datetime.strptime(old_log.stem.replace("claimsync_pull_", ""), "%Y-%m-%d")
                if log_dt < cutoff:
                    old_log.unlink()
            except ValueError:
                pass
    except Exception:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger("ClaimSyncPull")


def fetch_storage_credential(log) -> BlobServiceClient:
    """Call the ClaimSync API to get storage credentials.
    Returns a BlobServiceClient ready for use."""

    url = f"{CLAIMSSYNC_API_URL}/reseller/storage/key"
    headers = {"Authorization": f"Bearer {CLAIMSSYNC_API_TOKEN}"}

    log.info(f"Fetching storage credential from {CLAIMSSYNC_API_URL} ...")
    try:
        resp = requests.get(url, headers=headers, timeout=30)
    except requests.RequestException as e:
        log.error(f"API request failed: {e}")
        sys.exit(1)

    if resp.status_code == 401:
        log.error("CLAIMSSYNC_API_TOKEN expired or invalid.")
        log.error("Generate a new 365-day service token:")
        log.error("  curl -X POST %s/auth/reseller/service-token"
                  " -H \"Content-Type: application/json\""
                  " -d \"{\\\"email\\\":\\\"...\\\",\\\"password\\\":\\\"...\\\"}\"",
                  CLAIMSSYNC_API_URL)
        log.error("Then update: setx CLAIMSSYNC_API_TOKEN <new_token> /M")
        sys.exit(1)
    if resp.status_code != 200:
        log.error(f"API returned {resp.status_code}: {resp.text}")
        sys.exit(1)

    data = resp.json()
    log.info(f"Storage credential received for {data['account_name']}")
    return BlobServiceClient(account_url=data["account_url"], credential=data["account_key"])


def pull_facility(client: BlobServiceClient, fac: dict, log, dry_run: bool, date_filter: str | None):
    """Sync a single facility. Returns (downloaded, skipped) counts."""
    code       = fac["code"]
    cont_name  = fac["container"]
    local_root = os.path.join(LOCAL_BASE, fac["local"])

    # Ensure local folder structure
    for sub in ["claims", "claims\\archive", "remittance", "remittance\\archive",
                 "resubmission", "resubmission\\archive", "logs"]:
        Path(local_root, sub).mkdir(parents=True, exist_ok=True)

    try:
        container = client.get_container_client(cont_name)
        container.get_container_properties()
    except Exception as e:
        log.warning(f"[{code}] Container {cont_name} not accessible: {e}")
        return 0, 0

    downloaded = 0
    skipped    = 0

    for blob in container.list_blobs():
        blob_name = blob.name
        parts = blob_name.split("/", 1)
        if len(parts) != 2:
            continue

        prefix, filename = parts[0], parts[1]
        if prefix not in PREFIX_MAP:
            continue

        # Date filter
        if date_filter:
            try:
                filter_dt = datetime.strptime(date_filter, "%d/%m/%Y").replace(tzinfo=timezone.utc)
                if blob.last_modified.date() != filter_dt.date():
                    skipped += 1
                    continue
            except ValueError:
                pass

        # Determine local path
        local_sub = PREFIX_MAP[prefix]
        if local_sub:
            local_path = os.path.join(local_root, local_sub, filename)
        else:
            # search_history → facility root, strip prefix
            local_path = os.path.join(local_root, filename)

        # Ensure parent dir exists
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)

        # Skip if exists
        if os.path.exists(local_path):
            skipped += 1
            continue

        if dry_run:
            log.info(f"[{code}] DRY-RUN {prefix}\\{filename}")
            downloaded += 1
            continue

        try:
            blob_client = container.get_blob_client(blob_name)
            with open(local_path, "wb") as f:
                data = blob_client.download_blob()
                data.readinto(f)
            blob_ts = blob.last_modified.timestamp()
            os.utime(local_path, (blob_ts, blob_ts))

            display_sub = f"{prefix}\\{filename}" if prefix != "search_history" else filename
            log.info(f"[{code}] {display_sub} — downloaded")
            downloaded += 1
        except Exception as e:
            log.error(f"[{code}] FAILED {prefix}\\{filename} — {e}")

    return downloaded, skipped


def main():
    parser = argparse.ArgumentParser(
        description="ClaimSyncPull v3.2 — Download ClaimSync cloud files to local PC"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--date", type=str, default=None, help="DD/MM/YYYY")
    args = parser.parse_args()

    if not CLAIMSSYNC_API_URL or not CLAIMSSYNC_API_TOKEN:
        print("[ERROR] Environment variables not set.")
        print("        set CLAIMSSYNC_API_URL=https://ca-claimssync-api.whitewater-45edc27c.uaenorth.azurecontainerapps.io")
        print("        set CLAIMSSYNC_API_TOKEN=<your reseller JWT>")
        sys.exit(1)

    log = setup_logging()
    log.info("=" * 60)
    log.info(f"ClaimSyncPull v3.2 | {'DRY RUN' if args.dry_run else 'LIVE RUN'}")
    if args.date:
        log.info(f"Date filter: {args.date}")
    log.info("=" * 60)

    # Fetch storage credential from API (key lives only in memory)
    client = fetch_storage_credential(log)

    summary_parts = []
    for fac in FACILITIES:
        dl, sk = pull_facility(client, fac, log, args.dry_run, args.date)
        summary_parts.append(f"{fac['code']}: {dl} new, {sk} skipped")

    log.info(f"SUMMARY: {' | '.join(summary_parts)}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
