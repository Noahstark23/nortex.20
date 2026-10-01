#!/bin/sh
set -eu

# El controlador de release puede entregar su SHA verificado por argumento o
# NORTEX_BUILD_COMMIT. SOURCE_COMMIT configurable nunca acredita el código.
fail() { echo "$1" >&2; exit 1; }
valid_sha() {
  case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" -eq 40 ]
}
[ "$#" -le 1 ] || fail 'El build admite un único argumento SHA de release'
candidate_commit=''
if [ "$#" -eq 1 ]; then
  valid_sha "$1" || fail 'El argumento de release debe ser un SHA Git completo válido'
  candidate_commit=$1
fi
if [ "${NORTEX_BUILD_COMMIT+x}" = x ]; then
  valid_sha "$NORTEX_BUILD_COMMIT" || fail 'NORTEX_BUILD_COMMIT debe ser un SHA Git completo válido'
  [ -z "$candidate_commit" ] || [ "$candidate_commit" = "$NORTEX_BUILD_COMMIT" ] \
    || fail 'El argumento y NORTEX_BUILD_COMMIT deben coincidir'
  candidate_commit=$NORTEX_BUILD_COMMIT
fi

# Fijar metadata local desactiva descubrimiento de ancestros. Un entorno acotado
# neutraliza GIT_DIR, COMMON_DIR, objetos, configuración y demás overrides.
# .git archivo de worktree sigue siendo válido; metadata rota nunca usa fallback.
if [ -e .git ] || [ -L .git ]; then
  checkout_commit=$(env -i PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null GIT_NO_LAZY_FETCH=1 \
    git --git-dir=./.git --work-tree=. --no-replace-objects rev-parse --verify 'HEAD^{commit}')
  valid_sha "$checkout_commit" || fail 'HEAD debe ser un SHA Git completo válido'
  [ -z "$candidate_commit" ] || [ "$candidate_commit" = "$checkout_commit" ] \
    || fail 'El SHA explícito y HEAD deben coincidir'
  candidate_commit=$checkout_commit
fi

set -- -f ./docker-compose.yml -f docker-compose.whatsapp-staging.yml \
  --profile assistant-worker --profile whatsapp-commerce-worker

# Coolify escribe <uuid>_app:<SHA importado> antes del custom build sin .git.
# --images app incluye dependencias: leer sólo image directo de services.app en
# YAML CANÓNICO de Compose (indentación fija), nunca parsear el YAML fuente.
# No interpolar ni cargar env de build/runtime; no imprimir la configuración.
compose_model=$(docker compose "$@" --env-file /dev/null \
  config --no-interpolate --no-env-resolution)
app_image=$(printf '%s\n' "$compose_model" | awk '
  /^[^ ]/ { in_services = ($0 == "services:"); service = "" }
  in_services && /^  [^ ]/ {
    service = $0; sub(/^  /, "", service); sub(/:$/, "", service)
    if (service == "app") app_count++
  }
  in_services && /^    image: / {
    value = substr($0, 12)
    if (service == "app") { image_count++; app_image = value }
    else if (value ~ /_app[:@]/) other_app++
  }
  END {
    if (app_count != 1 || image_count > 1 || other_app) exit 1
    if (image_count) print app_image
  }
') || fail 'Compose no identifica una única imagen del servicio app'
if [ -n "$app_image" ]; then
  case "$app_image" in
    docker.io/library/*) app_image=${app_image#docker.io/library/} ;;
    library/*) app_image=${app_image#library/} ;;
  esac
  managed_uuid=${app_image%%_app:*}
  managed_commit=${app_image#*_app:}
  case "$managed_uuid" in ''|*[!a-z0-9]*) fail 'La imagen app no tiene UUID gestionado válido' ;; esac
  [ "${#managed_uuid}" -eq 24 ] && [ "$app_image" = "${managed_uuid}_app:${managed_commit}" ] \
    || fail 'La imagen app no tiene formato gestionado válido'
  valid_sha "$managed_commit" || fail 'La etiqueta app debe ser un SHA Git completo válido'
  [ -z "$candidate_commit" ] || [ "$candidate_commit" = "$managed_commit" ] \
    || fail 'La etiqueta gestionada y el SHA de release deben coincidir'
  candidate_commit=$managed_commit
fi
[ -n "$candidate_commit" ] || fail 'Sin .git se requiere etiqueta app o SHA explícito verificado'

# Coolify prepara este archivo para el build; Compose falla si no existe.
# No leerlo ni imprimirlo: Docker Compose administra sus variables de build.
exec docker compose -f ./docker-compose.yml --env-file /artifacts/build-time.env \
  -f docker-compose.whatsapp-staging.yml \
  --profile assistant-worker --profile whatsapp-commerce-worker \
  build --build-arg "NORTEX_BUILD_COMMIT=$candidate_commit" \
  app assistant-worker whatsapp-commerce-worker
