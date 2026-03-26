# =============================================================================
# ClaimSync — Dockerfile
# =============================================================================
# Project      : ClaimSync (Kaaryaa GenAI Solutions)
# Phase        : Phase 0 — Foundation (LocalINIProvider, local folder storage)
# Base image   : python:3.12-slim
# Target       : Azure Container Apps (UAE North) — Phase 2+
#
# VOLUME STRATEGY (Phase 0 — local file mode):
#   /app/data          → mount per-facility folder (contains shafafiaapi.ini
#                        and all output subfolders: claims/, remittance/,
#                        resubmission/, archive/)
#
#   Run command example:
#     docker run --rm \
#       -v /host/path/MF2618:/app/data \
#       claimsync:latest h
#
# Phase 2+ note:
#   Volume mount is replaced by:
#     - Azure Blob StorageProvider  (output files)
#     - Azure Key Vault             (credentials)
#     - PostgreSQL DBConfigProvider (facility config)
#   The /app/data volume and INI dependency are removed entirely in Phase 2.
# =============================================================================

FROM python:3.12-slim

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------
LABEL maintainer="Kaaryaa GenAI Solutions <anbu@kaaryaa.com>"
LABEL project="ClaimSync"
LABEL version="0.1.0-phase0"
LABEL description="ClaimSync Shafafiya sync engine — Phase 0 container"

# ---------------------------------------------------------------------------
# System dependencies
# ---------------------------------------------------------------------------
# libxml2 / libxslt — required by lxml if added in future phases
# curl is intentionally NOT installed — httpx is used instead (P0-T04)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 \
        libxslt1.1 \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Timezone — UAE (Gulf Standard Time, UTC+4, no DST)
# ---------------------------------------------------------------------------
ENV TZ=Asia/Dubai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ---------------------------------------------------------------------------
# Python environment
# ---------------------------------------------------------------------------
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# ---------------------------------------------------------------------------
# Non-root user (security best practice for Azure Container Apps)
# ---------------------------------------------------------------------------
RUN groupadd --gid 1001 claimsync \
    && useradd --uid 1001 --gid claimsync --shell /bin/bash --create-home claimsync

# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------
WORKDIR /app

# Install Python dependencies first (layer caching — only rebuilds on requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application script
# Phase 0: copy v8g. Phase 2+: this becomes a proper Python package.
COPY downloadTxnFilesv8g.py .

# ---------------------------------------------------------------------------
# Data volume
# ---------------------------------------------------------------------------
# /app/data is the per-facility working directory.
# Mount the facility folder here at runtime (contains shafafiaapi.ini +
# claims/, remittance/, resubmission/, archive/ subfolders).
# Phase 2: this volume is removed when Blob + DB replace local file I/O.
RUN mkdir -p /app/data && chown -R claimsync:claimsync /app/data
VOLUME ["/app/data"]

# Switch to working directory that the script expects (INI file location)
WORKDIR /app/data

# Run as non-root
USER claimsync

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
# Default: daily sync mode ('h' argument)
# Override at runtime for admin/onboarding: docker run ... claimsync:latest newclient
#
# Argument reference (from mainsub / main):
#   h         → daily/historical sync (normal scheduled run)
#   hf        → re-process already-fetched interval response files
#   hff       → glob all interval files and re-aggregate
#   newclient → admin onboarding menu (interactive, requires terminal)
#   vallic    → validate licence
#   renlic    → renew licence
CMD ["python", "/app/downloadTxnFilesv8g.py", "h"]
