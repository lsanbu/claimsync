"""
ClaimSyncPull.py
================
Downloads new files from ClaimSync Azure Blob Storage to Saleem's PC.
Multi-facility support: MF2618, MF5360.

Purpose:
  - Sync cloud-downloaded files to local PC for validation and processing
  - Supports claims, remittance, resubmission, search_history, and logs prefixes
  - Business continuity: cloud files available locally until full transition

Usage:
  python ClaimSyncPull.py              # pull all new files
  python ClaimSyncPull.py --dry-run    # show what WOULD be downloaded
  python ClaimSyncPull.py --date 17/03/2026  # pull files from specific date only

Requirements:
  pip install azure-storage-blob

Author  : Kaaryaa GenAI Solutions
Version : 2.0
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

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

STORAGE_ACCOUNT = "stclaimssyncuae"
STORAGE_KEY     = os.environ.get("CLAIMSSYNC_STORAGE_KEY", "")
STORAGE_URL     = f"https://{STORAGE_ACCOUNT}.blob.core.windows.net"

LOCAL_BASE      = r"C:\Users\USER\ClaimSync\Raggr"

# Facilities to sync — container name, local subfolder
FACILITIES = [
    {"code": "MF2618", "container": "claimssync-mf2618", "local": "mf2618"},
    {"code": "MF5360", "container": "claimssync-mf5360", "local": "mf5360"},
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
        # Quick check container exists
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
        description="ClaimSyncPull v2.0 — Download ClaimSync cloud files to local PC"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--date", type=str, default=None, help="DD/MM/YYYY")
    args = parser.parse_args()

    if not STORAGE_KEY:
        print("[ERROR] CLAIMSSYNC_STORAGE_KEY env var not set.")
        print("        Set it before running: set CLAIMSSYNC_STORAGE_KEY=<key>")
        sys.exit(1)

    log = setup_logging()
    log.info("=" * 60)
    log.info(f"ClaimSyncPull v2.0 | {'DRY RUN' if args.dry_run else 'LIVE RUN'}")
    if args.date:
        log.info(f"Date filter: {args.date}")
    log.info("=" * 60)

    client = BlobServiceClient(account_url=STORAGE_URL, credential=STORAGE_KEY)

    summary_parts = []
    for fac in FACILITIES:
        dl, sk = pull_facility(client, fac, log, args.dry_run, args.date)
        summary_parts.append(f"{fac['code']}: {dl} new, {sk} skipped")

    log.info(f"SUMMARY: {' | '.join(summary_parts)}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
