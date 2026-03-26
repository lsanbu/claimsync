################################################################################
# ClaimSync — P3-T04  Next.js Dashboard — Deployment
# Image : crclaimssync.azurecr.io/claimsync-dashboard:1.0
# App   : ca-claimssync-dashboard
################################################################################

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Windows CMD  (build + push image)
# ══════════════════════════════════════════════════════════════════════════════

cd D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDashboard

az acr login --name crclaimssync

docker build ^
  --no-cache ^
  -t crclaimssync.azurecr.io/claimsync-dashboard:1.0 ^
  .

docker push crclaimssync.azurecr.io/claimsync-dashboard:1.0


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Azure Cloud Shell  (create Container App)
# ══════════════════════════════════════════════════════════════════════════════

MI_ID=$(az identity show \
  --name id-claimssync-engine \
  --resource-group rg-claimssync-uaenorth-prod \
  --query id -o tsv)

MI_CLIENT_ID="8e309ea2-175e-497e-8849-7af81a36c62a"

CAE_ID=$(az containerapp env show \
  --name cae-claimssync-uae \
  --resource-group rg-claimssync-uaenorth-prod \
  --query id -o tsv)

# Store dashboard API key in KV (same key, dashboard reads via server-side proxy)
API_KEY_URI="https://kv-claimssync-uae.vault.azure.net/secrets/claimssync-api-key"

az containerapp create \
  --name ca-claimssync-dashboard \
  --resource-group rg-claimssync-uaenorth-prod \
  --environment "$CAE_ID" \
  --image crclaimssync.azurecr.io/claimsync-dashboard:1.0 \
  --registry-server crclaimssync.azurecr.io \
  --user-assigned "$MI_ID" \
  --registry-identity "$MI_ID" \
  --ingress external \
  --target-port 3000 \
  --min-replicas 1 \
  --max-replicas 2 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --secrets \
    "api-key=keyvaultref:${API_KEY_URI},identityref:${MI_ID}" \
  --env-vars \
    "AZURE_CLIENT_ID=${MI_CLIENT_ID}" \
    "CLAIMSSYNC_API_URL=https://ca-claimssync-api.whitewater-45edc27c.uaenorth.azurecontainerapps.io" \
    "CLAIMSSYNC_API_KEY=secretref:api-key" \
    "NODE_ENV=production"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Verify
# ══════════════════════════════════════════════════════════════════════════════

DASH_URL=$(az containerapp show \
  --name ca-claimssync-dashboard \
  --resource-group rg-claimssync-uaenorth-prod \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo "Dashboard URL: https://$DASH_URL"

# Health check (should return Next.js HTML)
curl -s -o /dev/null -w "%{http_code}" "https://${DASH_URL}/"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Update image (future)
# ══════════════════════════════════════════════════════════════════════════════
# Windows: docker build -t crclaimssync.azurecr.io/claimsync-dashboard:1.1 . && docker push ...
# Cloud Shell: az containerapp update --name ca-claimssync-dashboard --resource-group rg-claimssync-uaenorth-prod --image crclaimssync.azurecr.io/claimsync-dashboard:1.1
