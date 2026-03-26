# =============================================================================
# Dockerfile — ClaimSync2 Engine
# =============================================================================
# Project      : ClaimSync (Kaaryaa GenAI Solutions)
# Phase        : Phase 2 — Engine Migration (P2-T04)
# Base image   : python:3.12-slim
# Target       : Azure Container Apps Job (crclaimssync.azurecr.io)
# Run trigger  : Manual (Phase 2 test) → Cron via schedule (Phase 3)
#
# Build:
#   docker build -t crclaimssync.azurecr.io/claimsync-engine:2.0 .
#
# Run (local test — INI mode):
#   docker run --rm \
#     -v C:/Users/USER/ClaimSync:/app/workspace \
#     -e CLAIMSSYNC_TEMP_DIR=/tmp/claimssync/ \
#     crclaimssync.azurecr.io/claimsync-engine:2.0
#
# Run (cloud mode — DB + KV + Blob):
#   docker run --rm \
#     -e CLAIMSSYNC_TENANT=KAARYAA-T1 \
#     -e CLAIMSSYNC_DB_DSN="host=... user=... password=... sslmode=require" \
#     -e CLAIMSSYNC_KV_URI=https://kv-claimssync-uae.vault.azure.net/ \
#     -e CLAIMSSYNC_BLOB_UPLOAD=1 \
#     -e CLAIMSSYNC_TEMP_DIR=/tmp/claimssync/ \
#     crclaimssync.azurecr.io/claimsync-engine:2.0
#
# Environment variables:
#   CLAIMSSYNC_TENANT        Tenant short_code — activates cloud mode (DBConfigProvider)
#   CLAIMSSYNC_DB_DSN        PostgreSQL DSN (dev/CI) — not needed with Managed Identity
#   CLAIMSSYNC_KV_URI        Key Vault URI (default: https://kv-claimssync-uae.vault.azure.net/)
#   CLAIMSSYNC_BLOB_UPLOAD   Set to '1' to upload files to Blob after download (default: off)
#   CLAIMSSYNC_TEMP_DIR      Temp folder for XML files (default: /tmp/claimssync/)
#   CLAIMSSYNC_STORAGE_URL   Blob Storage URL override (default: https://stclaimssyncuae.blob.core.windows.net)
# =============================================================================

FROM python:3.12-slim

# System deps: libpq for psycopg2, ca-certificates for SSL to Azure
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (layer caching — rebuilds only if deps change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy engine source files
COPY ClaimSync2.py          .
COPY httpx_soap.py          .
COPY config_provider.py     .
COPY db_config_provider.py  .
COPY kv_credential_provider.py  .
COPY blob_storage_provider.py   .
COPY db_run_logger.py .

# Temp folder for SOAP XML request/response files
# Overridden by CLAIMSSYNC_TEMP_DIR env var at runtime
# Non-root user — Azure Container Apps best practice
RUN useradd --no-create-home --shell /bin/false claimsync \
    && mkdir -p /tmp/claimssync \
    && chown -R claimsync:claimsync /tmp/claimssync \
    && chown -R claimsync:claimsync /app
USER claimsync

# Engine entry point — 'h' argument triggers history sync (same as on-prem .bat)
ENTRYPOINT ["python", "ClaimSync2.py", "h"]
