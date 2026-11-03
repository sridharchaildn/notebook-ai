#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE_FILE="${TEMPLATE_FILE:-$ROOT_DIR/infra/container-apps/main.bicep}"
PARAM_FILE="${PARAM_FILE:-$ROOT_DIR/infra/container-apps/main.parameters.json}"
DOCKERFILE="${DOCKERFILE:-services/cloud-api/Dockerfile}"

AZ_SUBSCRIPTION_ID="${AZ_SUBSCRIPTION_ID:-}"
AZ_RESOURCE_GROUP="${AZ_RESOURCE_GROUP:-notebook-ai}"
NAME_PREFIX="${NAME_PREFIX:-notebook-ai}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-notebook-ai-cloud-api}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

# Required (same semantics as GitHub Actions secrets)
NOTEBOOK_CLOUD_SUPABASE_URL="${NOTEBOOK_CLOUD_SUPABASE_URL:-}"
NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY="${NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY:-}"
NOTEBOOK_CLOUD_CREDENTIAL_SECRET="${NOTEBOOK_CLOUD_CREDENTIAL_SECRET:-}"
NOTEBOOK_CLOUD_ALLOWED_ORIGINS="${NOTEBOOK_CLOUD_ALLOWED_ORIGINS:-}"

# Optional
NOTEBOOK_CLOUD_BUILD_VERSION="${NOTEBOOK_CLOUD_BUILD_VERSION:-}"
NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET="${NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID="${NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_SECRET="${NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_SECRET:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_TOKEN_URL="${NOTEBOOK_CLOUD_OPENAI_OAUTH_TOKEN_URL:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_REDIRECT_URI="${NOTEBOOK_CLOUD_OPENAI_OAUTH_REDIRECT_URI:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI:-}"
NOTEBOOK_CLOUD_SUPABASE_ANON_KEY="${NOTEBOOK_CLOUD_SUPABASE_ANON_KEY:-}"
NOTEBOOK_CLOUD_SUPABASE_JWKS_URL="${NOTEBOOK_CLOUD_SUPABASE_JWKS_URL:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_AUTHORIZE_URL="${NOTEBOOK_CLOUD_OPENAI_OAUTH_AUTHORIZE_URL:-}"
NOTEBOOK_CLOUD_OPENAI_OAUTH_SCOPE="${NOTEBOOK_CLOUD_OPENAI_OAUTH_SCOPE:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE:-}"
NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME="${NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME:-}"
NOTEBOOK_CLOUD_DEBUG="${NOTEBOOK_CLOUD_DEBUG:-}"
CONTAINER_APP_MIN_REPLICAS="${CONTAINER_APP_MIN_REPLICAS:-}"

usage() {
  cat <<EOF
Deploy Notebook AI cloud-api to Azure Container Apps (Bicep + ACR build).

Required environment variables:
  NOTEBOOK_CLOUD_SUPABASE_URL
  NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY
  NOTEBOOK_CLOUD_CREDENTIAL_SECRET
  NOTEBOOK_CLOUD_ALLOWED_ORIGINS   (comma-separated origins)

Optional:
  AZ_SUBSCRIPTION_ID     (default: current CLI subscription)
  AZ_RESOURCE_GROUP      (default: notebook-ai)
  NAME_PREFIX            (default: notebook-ai)
  IMAGE_REPOSITORY       (default: notebook-ai-cloud-api)
  IMAGE_TAG              (default: timestamp)
  NOTEBOOK_CLOUD_BUILD_VERSION
  NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET
  NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID / _CLIENT_SECRET / _TOKEN_URL / _REDIRECT_URI
  NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET / _OAUTH_TOKEN_URL / _REDIRECT_URI
  NOTEBOOK_CLOUD_SUPABASE_ANON_KEY / NOTEBOOK_CLOUD_SUPABASE_JWKS_URL
  NOTEBOOK_CLOUD_OPENAI_OAUTH_AUTHORIZE_URL / NOTEBOOK_CLOUD_OPENAI_OAUTH_SCOPE
  NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL / NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE
  NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME
  NOTEBOOK_CLOUD_DEBUG   (true or 1 to enable)
  CONTAINER_APP_MIN_REPLICAS

Example:
  NOTEBOOK_CLOUD_SUPABASE_URL="https://xxx.supabase.co" \\
  NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY="<service-role-key>" \\
  NOTEBOOK_CLOUD_CREDENTIAL_SECRET="<random-secret>" \\
  NOTEBOOK_CLOUD_ALLOWED_ORIGINS="https://app.example.com,https://www.example.com" \\
  $0
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

append_param_if_set() {
  local key="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    DEPLOY_PARAMS+=("${key}=${value}")
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$NOTEBOOK_CLOUD_SUPABASE_URL" || "$NOTEBOOK_CLOUD_SUPABASE_URL" == "https://your-project-ref.supabase.co" ]]; then
  echo "NOTEBOOK_CLOUD_SUPABASE_URL is required." >&2
  usage
  exit 1
fi

if [[ -z "$NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY" || "$NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY" == "REPLACE_WITH_SUPABASE_SECRET_KEY" ]]; then
  echo "NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY is required." >&2
  usage
  exit 1
fi

if [[ -z "$NOTEBOOK_CLOUD_CREDENTIAL_SECRET" || "$NOTEBOOK_CLOUD_CREDENTIAL_SECRET" == "REPLACE_WITH_CREDENTIAL_SECRET" ]]; then
  echo "NOTEBOOK_CLOUD_CREDENTIAL_SECRET is required." >&2
  usage
  exit 1
fi

if [[ -z "$NOTEBOOK_CLOUD_ALLOWED_ORIGINS" ]]; then
  echo "NOTEBOOK_CLOUD_ALLOWED_ORIGINS is required (comma-separated)." >&2
  usage
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Template file not found: $TEMPLATE_FILE" >&2
  exit 1
fi

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "Parameter file not found: $PARAM_FILE" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/$DOCKERFILE" ]]; then
  echo "Dockerfile not found: $ROOT_DIR/$DOCKERFILE" >&2
  exit 1
fi

require_command az

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not logged in. Run: az login" >&2
  exit 1
fi

if [[ -z "$AZ_SUBSCRIPTION_ID" ]]; then
  AZ_SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
fi

echo "Using subscription: $AZ_SUBSCRIPTION_ID"
az account set --subscription "$AZ_SUBSCRIPTION_ID"
echo "Using image tag: $IMAGE_TAG"

if ! az group show --subscription "$AZ_SUBSCRIPTION_ID" --name "$AZ_RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group not found: $AZ_RESOURCE_GROUP (subscription: $AZ_SUBSCRIPTION_ID)" >&2
  exit 1
fi

declare -a DEPLOY_PARAMS
DEPLOY_PARAMS=(
  "namePrefix=$NAME_PREFIX"
  "imageRepository=$IMAGE_REPOSITORY"
  "imageTag=$IMAGE_TAG"
  "supabaseUrl=$NOTEBOOK_CLOUD_SUPABASE_URL"
  "supabaseSecretKey=$NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY"
  "credentialSecret=$NOTEBOOK_CLOUD_CREDENTIAL_SECRET"
  "allowedOrigins=$NOTEBOOK_CLOUD_ALLOWED_ORIGINS"
)

append_param_if_set "buildVersion" "$NOTEBOOK_CLOUD_BUILD_VERSION"
append_param_if_set "supabaseJwtSecret" "$NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET"
append_param_if_set "openaiOauthClientId" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID"
append_param_if_set "openaiOauthClientSecret" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_SECRET"
append_param_if_set "openaiOauthTokenUrl" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_TOKEN_URL"
append_param_if_set "openaiOauthRedirectUri" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_REDIRECT_URI"
append_param_if_set "googleDriveClientId" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID"
append_param_if_set "googleDriveClientSecret" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET"
append_param_if_set "googleDriveOauthTokenUrl" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL"
append_param_if_set "googleDriveRedirectUri" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI"
append_param_if_set "supabaseAnonKey" "$NOTEBOOK_CLOUD_SUPABASE_ANON_KEY"
append_param_if_set "supabaseJwksUrl" "$NOTEBOOK_CLOUD_SUPABASE_JWKS_URL"
append_param_if_set "openaiOauthAuthorizeUrl" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_AUTHORIZE_URL"
append_param_if_set "openaiOauthScope" "$NOTEBOOK_CLOUD_OPENAI_OAUTH_SCOPE"
append_param_if_set "googleDriveOauthAuthorizeUrl" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL"
append_param_if_set "googleDriveScope" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE"
append_param_if_set "googleDriveDefaultFolderName" "$NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME"

if [[ "${NOTEBOOK_CLOUD_DEBUG}" == "true" || "${NOTEBOOK_CLOUD_DEBUG}" == "1" ]]; then
  DEPLOY_PARAMS+=('notebookCloudDebug=true')
fi

append_param_if_set "containerAppMinReplicas" "$CONTAINER_APP_MIN_REPLICAS"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
INFRA_DEPLOYMENT_NAME="${NAME_PREFIX}-infra-${TIMESTAMP}"
APP_DEPLOYMENT_NAME="${NAME_PREFIX}-app-${TIMESTAMP}"

echo "Step 1/3: Deploying base infrastructure (ACR + Container Apps environment)..."
ACR_NAME="$(
  az deployment group create \
    --subscription "$AZ_SUBSCRIPTION_ID" \
    --resource-group "$AZ_RESOURCE_GROUP" \
    --name "$INFRA_DEPLOYMENT_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --parameters @"$PARAM_FILE" \
    --parameters deployContainerApp=false \
    --parameters "${DEPLOY_PARAMS[@]}" \
    --query "properties.outputs.containerRegistryName.value" \
    -o tsv
)"

if [[ -z "$ACR_NAME" ]]; then
  echo "Failed to resolve ACR name from deployment output." >&2
  exit 1
fi

echo "Resolved ACR: $ACR_NAME"
ACR_LOGIN_SERVER="$(
  az acr show \
    --subscription "$AZ_SUBSCRIPTION_ID" \
    --name "$ACR_NAME" \
    --query loginServer \
    -o tsv
)"
if [[ -z "$ACR_LOGIN_SERVER" ]]; then
  echo "Failed to resolve ACR login server." >&2
  exit 1
fi

# Docker Hub rejects anonymous pulls once the shared rate limit is hit.
# Public ECR mirrors the official Python image and is what ACR import should use.
BASE_IMAGE="${BASE_IMAGE:-python:3.11-slim}"
BASE_IMAGE_SOURCE="${BASE_IMAGE_SOURCE:-public.ecr.aws/docker/library/python:3.11-slim}"

echo "Step 2/3a: Ensuring ${BASE_IMAGE} is in ACR (source: ${BASE_IMAGE_SOURCE})..."
if az acr repository show \
  --subscription "$AZ_SUBSCRIPTION_ID" \
  --name "$ACR_NAME" \
  --image "$BASE_IMAGE" >/dev/null 2>&1; then
  echo "Base image already present in ACR: ${BASE_IMAGE}"
else
  az acr import \
    --subscription "$AZ_SUBSCRIPTION_ID" \
    --name "$ACR_NAME" \
    --source "$BASE_IMAGE_SOURCE" \
    --image "$BASE_IMAGE"
fi

echo "Step 2/3b: Building and pushing app image (repo root context)..."
az acr build \
  --subscription "$AZ_SUBSCRIPTION_ID" \
  --registry "$ACR_NAME" \
  --image "${IMAGE_REPOSITORY}:${IMAGE_TAG}" \
  --file "$DOCKERFILE" \
  --build-arg "REGISTRY_PREFIX=${ACR_LOGIN_SERVER}/" \
  "$ROOT_DIR"

echo "Step 3/3: Deploying Container App revision..."
CONTAINER_APP_URL="$(
  az deployment group create \
    --subscription "$AZ_SUBSCRIPTION_ID" \
    --resource-group "$AZ_RESOURCE_GROUP" \
    --name "$APP_DEPLOYMENT_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --parameters @"$PARAM_FILE" \
    --parameters deployContainerApp=true \
    --parameters "${DEPLOY_PARAMS[@]}" \
    --query "properties.outputs.containerAppUrl.value" \
    -o tsv
)"

CONTAINER_APP_NAME="$(
  az deployment group show \
    --subscription "$AZ_SUBSCRIPTION_ID" \
    --resource-group "$AZ_RESOURCE_GROUP" \
    --name "$APP_DEPLOYMENT_NAME" \
    --query "properties.outputs.containerAppName.value" \
    -o tsv
)"

echo ""
echo "Deployment complete."
echo "Container App Name: $CONTAINER_APP_NAME"
echo "Container App URL : $CONTAINER_APP_URL"
echo "Health endpoint   : ${CONTAINER_APP_URL%/}/health"
