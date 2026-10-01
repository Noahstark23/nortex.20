#!/bin/sh
set -eu

# Ejecutar desde el checkout que Coolify preparó, sin depender de SOURCE_COMMIT.
candidate_commit=$(git rev-parse --verify HEAD)
case "$candidate_commit" in
  ''|*[!0-9a-f]*) echo 'HEAD debe ser un SHA Git completo válido' >&2; exit 1 ;;
esac
if [ "${#candidate_commit}" -ne 40 ]; then
  echo 'HEAD debe contener exactamente 40 caracteres' >&2
  exit 1
fi

# Coolify prepara este archivo para el build; Compose falla si no existe.
# No leerlo ni imprimirlo: Docker Compose administra sus variables de build.
exec docker compose \
  -f ./docker-compose.yml \
  --env-file /artifacts/build-time.env \
  -f docker-compose.whatsapp-staging.yml \
  --profile assistant-worker \
  --profile whatsapp-commerce-worker \
  build --build-arg "NORTEX_BUILD_COMMIT=$candidate_commit" \
  app assistant-worker whatsapp-commerce-worker
