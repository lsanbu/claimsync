# ── ClaimSync API — Dockerfile ────────────────────────────────────────────────
# Image : crclaimssync.azurecr.io/claimsync-api:1.0
# Runtime: python:3.12-slim  |  uvicorn on port 8000
# Auth   : non-root user 'apiuser'

FROM python:3.12-slim

# Build arg for image tag (written to IMAGE_TAG env var for /health response)
ARG IMAGE_TAG=local
ENV IMAGE_TAG=${IMAGE_TAG}

WORKDIR /app

# Install deps first (layer-cached unless requirements changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application package
COPY claimssync_api/ ./claimssync_api/

# Non-root user
RUN useradd --no-create-home --shell /bin/false apiuser \
    && chown -R apiuser:apiuser /app

USER apiuser

EXPOSE 8000

# uvicorn serves the FastAPI app
# --proxy-headers: trust X-Forwarded-* from Azure Container App ingress
CMD ["uvicorn", "claimssync_api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
