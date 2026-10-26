#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:?}"
ENVIRONMENT="${ENVIRONMENT:?}"
IMAGE_TAG="${IMAGE_TAG:?}"
ECR_REGISTRY="${ECR_REGISTRY:?}"

CLUSTER="${PROJECT_NAME}-${ENVIRONMENT}-cluster"

register_and_update() {
  local SERVICE="$1"
  local CONTAINER="$2"
  local FAMILY="${PROJECT_NAME}-${ENVIRONMENT}-${SERVICE}"
  local IMAGE="${ECR_REGISTRY}/${PROJECT_NAME}/${SERVICE}:${IMAGE_TAG}"

  aws ecs describe-task-definition --task-definition "$FAMILY" \
    --query taskDefinition > task-def.json

  jq --arg img "$IMAGE" --arg name "$CONTAINER" \
    'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
     | .containerDefinitions = [.containerDefinitions[] | if .name == $name then .image = $img else . end]' \
    task-def.json > task-def-new.json

  NEW_ARN=$(aws ecs register-task-definition --cli-input-json file://task-def-new.json \
    --query 'taskDefinition.taskDefinitionArn' --output text)

  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$FAMILY" \
    --task-definition "$NEW_ARN" \
    --force-new-deployment >/dev/null

  echo "Updated ${FAMILY} -> ${NEW_ARN}"
}

register_and_update web web
register_and_update worker worker
