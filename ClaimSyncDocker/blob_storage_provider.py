"""
blob_storage_provider.py — ClaimSync Phase 3
Uploads downloaded claim/remittance files to Azure Blob Storage
using Managed Identity (DefaultAzureCredential — no keys, no secrets).

Container naming convention:  claimssync-{facility.lower()}
                               e.g. claimssync-mf2618

Blob path convention:         {ftype}/{basename}
                               e.g. claims/MF2618_H13238_OP_NEURON_110326_5_1.xml
                                    remittance/351.24-24200898-NRML-11032026-11-20-00.zip
"""

import os
import logging
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import AzureError

logger = logging.getLogger(__name__)


def init_blob_client(account_url: str) -> BlobServiceClient:
    """
    Initialise a BlobServiceClient authenticated via Managed Identity.
    Called once at startup in main() if CLAIMSSYNC_BLOB_UPLOAD=1.

    Args:
        account_url: e.g. https://stclaimssyncuae.blob.core.windows.net

    Returns:
        BlobServiceClient instance ready for uploads.

    Raises:
        Exception — propagated to main() which logs and exits cleanly.
    """
    credential = DefaultAzureCredential()
    client = BlobServiceClient(account_url=account_url, credential=credential)
    return client


def upload_file(
    blob_service_client: BlobServiceClient,
    container_name: str,
    blob_name: str,
    local_path: str,
    overwrite: bool = True,
) -> bool:
    """
    Upload a single local file to Azure Blob Storage.

    Args:
        blob_service_client: Authenticated BlobServiceClient.
        container_name:       e.g. 'claimssync-mf2618'
        blob_name:            e.g. 'claims/MF2618_H13238_OP_NEURON_110326_5_1.xml'
        local_path:           Full local path to the file.
        overwrite:            Overwrite if blob already exists (default True — idempotent).

    Returns:
        True on success, False on failure (caller logs the outcome).
    """
    try:
        blob_client = blob_service_client.get_blob_client(
            container=container_name,
            blob=blob_name,
        )
        with open(local_path, "rb") as data:
            blob_client.upload_blob(data, overwrite=overwrite)
        return True
    except FileNotFoundError:
        logger.error(f"[BlobUpload] Local file not found: {local_path}")
        return False
    except AzureError as ae:
        logger.error(f"[BlobUpload] AzureError for {blob_name}: {ae}")
        return False
    except Exception as exc:
        logger.error(f"[BlobUpload] Unexpected error for {blob_name}: {exc}")
        return False


def upload_bytes(
    blob_service_client: BlobServiceClient,
    container_name: str,
    blob_name: str,
    data: bytes,
    overwrite: bool = True,
) -> bool:
    """
    Upload raw bytes to Azure Blob Storage (no local file read).
    Used when the caller has already transformed the payload in-memory
    (e.g. credential redaction) and must not write it to disk.
    """
    try:
        blob_client = blob_service_client.get_blob_client(
            container=container_name,
            blob=blob_name,
        )
        blob_client.upload_blob(data, overwrite=overwrite)
        return True
    except AzureError as ae:
        logger.error(f"[BlobUpload] AzureError for {blob_name}: {ae}")
        return False
    except Exception as exc:
        logger.error(f"[BlobUpload] Unexpected error for {blob_name}: {exc}")
        return False
