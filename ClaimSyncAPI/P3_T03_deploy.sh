################################################################################
# ClaimSync  —  P3-T03  FastAPI Backend  —  Deployment Commands
# Date   : 2026-03-13
# Image  : crclaimssync.azurecr.io/claimsync-api:1.0
# App    : ca-claimssync-api  (Separate Container App)
################################################################################

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Windows CMD  (build + push image)
# ══════════════════════════════════════════════════════════════════════════════

# Copy these files into your Docker build folder:
#   Dockerfile.api          → D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI\Dockerfile
#   claimssync_api\         → D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI\claimssync_api\
#   requirements.txt        → D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI\requirements.txt

cd D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncAPI

az acr login --name crclaimssync

docker build ^
  --no-cache ^
  --build-arg IMAGE_TAG=1.0 ^
  -t crclaimssync.azurecr.io/claimsync-api:1.0 ^
  -f Dockerfile ^
  .

docker push crclaimssync.azurecr.io/claimsync-api:1.0


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Azure Cloud Shell (bash)  —  create KV secret + Container App
# ══════════════════════════════════════════════════════════════════════════════

# -- 2a. Generate a strong API key and store in Key Vault --
API_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
echo "Your API key (save this for the dashboard): $API_KEY"

az keyvault secret set \
  --vault-name kv-claimssync-uae \
  --name claimssync-api-key \
  --value "$API_KEY"

# -- 2b. Get the Managed Identity resource ID (reuse existing engine MI) --
MI_ID=$(az identity show \
  --name id-claimssync-engine \
  --resource-group rg-claimssync-uaenorth-prod \
  --query id -o tsv)

MI_CLIENT_ID=$(az identity show \
  --name id-claimssync-engine \
  --resource-group rg-claimssync-uaenorth-prod \
  --query clientId -o tsv)

echo "MI_ID       = $MI_ID"
echo "MI_CLIENT_ID= $MI_CLIENT_ID"

# -- 2c. Get the Container Apps Environment ID --
CAE_ID=$(az containerapp env show \
  --name cae-claimssync-uae \
  --resource-group rg-claimssync-uaenorth-prod \
  --query id -o tsv)

echo "CAE_ID = $CAE_ID"

# -- 2d. Get the DB DSN secret URI from Key Vault --
DB_DSN_URI=$(az keyvault secret show \
  --vault-name kv-claimssync-uae \
  --name db-dsn \
  --query id -o tsv | sed 's|/[0-9a-f]*$||')

API_KEY_URI=$(az keyvault secret show \
  --vault-name kv-claimssync-uae \
  --name claimssync-api-key \
  --query id -o tsv | sed 's|/[0-9a-f]*$||')

echo "DB_DSN_URI  = $DB_DSN_URI"
echo "API_KEY_URI = $API_KEY_URI"

# -- 2e. Create the Container App --
az containerapp create \
  --name ca-claimssync-api \
  --resource-group rg-claimssync-uaenorth-prod \
  --environment "$CAE_ID" \
  --image crclaimssync.azurecr.io/claimsync-api:1.0 \
  --registry-server crclaimssync.azurecr.io \
  --user-assigned "$MI_ID" \
  --registry-identity "$MI_ID" \
  --ingress external \
  --target-port 8000 \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --secrets \
    "db-dsn=keyvaultref:${DB_DSN_URI},identityref:${MI_ID}" \
    "api-key=keyvaultref:${API_KEY_URI},identityref:${MI_ID}" \
  --env-vars \
    "AZURE_CLIENT_ID=${MI_CLIENT_ID}" \
    "CLAIMSSYNC_DB_DSN=secretref:db-dsn" \
    "CLAIMSSYNC_API_KEY=secretref:api-key" \
    "IMAGE_TAG=1.0"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Verify deployment (Azure Cloud Shell)
# ══════════════════════════════════════════════════════════════════════════════

# Get the API URL
API_URL=$(az containerapp show \
  --name ca-claimssync-api \
  --resource-group rg-claimssync-uaenorth-prod \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo "API URL: https://$API_URL"

# -- Health check (no auth) --
curl -s "https://${API_URL}/health" | python3 -m json.tool

# -- Authenticated test --
# Replace <YOUR_API_KEY> with the value printed in step 2a
curl -s \
  -H "X-API-Key: <YOUR_API_KEY>" \
  "https://${API_URL}/runs?limit=5" | python3 -m json.tool

# -- Stats summary --
curl -s \
  -H "X-API-Key: <YOUR_API_KEY>" \
  "https://${API_URL}/stats/summary?days=7" | python3 -m json.tool

# -- Payer breakdown --
curl -s \
  -H "X-API-Key: <YOUR_API_KEY>" \
  "https://${API_URL}/stats/payers?days=7" | python3 -m json.tool

# -- Files from the P3-T02 test run --
curl -s \
  -H "X-API-Key: <YOUR_API_KEY>" \
  "https://${API_URL}/files?run_id=40845821-4730-411f-9e6f-fb41feaf4080" \
  | python3 -m json.tool

# -- OpenAPI docs (browser) --
echo "Swagger UI: https://${API_URL}/docs"
echo "ReDoc     : https://${API_URL}/redoc"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Update image (future versions)
# ══════════════════════════════════════════════════════════════════════════════

# Windows CMD (build + push new tag):
#   docker build --no-cache --build-arg IMAGE_TAG=1.1 -t crclaimssync.azurecr.io/claimsync-api:1.1 .
#   docker push crclaimssync.azurecr.io/claimsync-api:1.1

# Azure Cloud Shell (update app):
#   az containerapp update \
#     --name ca-claimssync-api \
#     --resource-group rg-claimssync-uaenorth-prod \
#     --image crclaimssync.azurecr.io/claimsync-api:1.1


################################################################################
# API ENDPOINT REFERENCE
################################################################################

# GET /health                                no auth  — liveness probe
# GET /docs                                  no auth  — Swagger UI
# GET /runs                                  auth     — list runs (paginated)
# GET /runs/{run_id}                         auth     — run detail + intervals
# GET /runs/{run_id}/intervals               auth     — interval breakdown
# GET /files                                 auth     — file manifest (filterable)
# GET /files/{file_id}                       auth     — single file record
# GET /stats/summary                         auth     — header KPI cards
# GET /stats/payers                          auth     — payer breakdown chart
# GET /stats/daily                           auth     — daily trend sparkline
# GET /stats/duplicates                      auth     — resubmission rate per run
