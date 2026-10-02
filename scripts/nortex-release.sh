#!/bin/sh
# UI Coolify: sh scripts/nortex-release.sh staging build (o production/start).
# El nombre evita la sustitución literal de "compose" en el campo de comandos.
set -eu
target=${1:-}
phase=${2:-}
case "$target" in
  staging) project=jxzjinox4xrszsr2giwjxaky ;;
  production) project=loksow84gw0wccs8ookkosw8 ;;
  *) echo 'NORTEX_TARGET_INVALID' >&2; exit 1 ;;
esac
case "$phase" in build|start) ;; *) echo 'NORTEX_PHASE_INVALID' >&2; exit 1 ;; esac
[ "$#" -eq 2 ] || { echo 'NORTEX_ARGUMENTS_INVALID' >&2; exit 1; }
[ -f ./docker-compose.yml ] && [ -f "./deploy/nortex/$target.yml" ] \
  || { echo 'NORTEX_REPOSITORY_REQUIRED' >&2; exit 1; }

# Resolver con el mismo env-file que el proveedor, sin leer/evaluar su contenido.
if [ "$phase" = build ]; then env_file=/artifacts/build-time.env; else env_file=./.env; fi
[ -f "$env_file" ] || { echo 'NORTEX_ENV_FILE_REQUIRED' >&2; exit 1; }
# Coolify elimina .git antes del custom build. Su Compose generado vincula
# app al SHA del checkout; no dependemos de Git ni Node dentro del helper.
images=$(docker compose --project-name "$project" --project-directory "$PWD" \
  --env-file "$env_file" -f ./docker-compose.yml -f "./deploy/nortex/$target.yml" config --images app)
commit=
for image in $images; do
  case "$image" in
    "${project}_app:"*)
      [ -z "$commit" ] || { echo 'NORTEX_IMAGE_IDENTITY_AMBIGUOUS' >&2; exit 1; }
      commit=${image#*:} ;;
  esac
done
case "$commit" in *[!a-f0-9]*|'') echo 'NORTEX_IMAGE_IDENTITY_REQUIRED' >&2; exit 1 ;; esac
[ "${#commit}" -eq 40 ] || { echo 'NORTEX_IMAGE_IDENTITY_REQUIRED' >&2; exit 1; }

# Ambos comandos usan el mismo daemon que el proveedor. Sólo inspección aquí;
# la limpieza sigue siendo exclusivamente de Coolify y ocurre después del build.
for volume in "${project}_mysql-data" "${project}_assistant-private"; do
  docker volume inspect "$volume" >/dev/null
done
docker image inspect sha256:6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39 >/dev/null
if [ "$target" = staging ]; then
  docker image inspect sha256:1e9ac5b2be2b871a2aa9ab275123f9f4550dfce3dccb5d228107802eca19303d >/dev/null
  set -- db app assistant-worker
else
  docker volume inspect "${project}_backup-data" >/dev/null
  docker volume inspect 2e59a1dcfc792775cf9e891548551991b44baf46451855f8cd2cb9d35a2ae882 >/dev/null
  docker image inspect sha256:afd1dc8138f000bcbbd3a8c940e36b21d66b7876eb8cf8e4697ee1ef449d16c1 >/dev/null
  docker image inspect sha256:4df4fd9cdb06f619b8808eecbdaa4d33112b5f750d9554f9b4e1939811b5ef65 >/dev/null
  set -- db app assistant-worker backup
fi

if [ "$phase" = build ]; then
  # Helper: archivo oficial de variables de build. No se lee ni imprime en shell.
  env_file=/artifacts/build-time.env
  [ -f "$env_file" ] || { echo 'NORTEX_BUILD_ENV_REQUIRED' >&2; exit 1; }
  printf '{"version":1,"commit":"%s"}\n' "$commit" > .nortex-build-source.json
  docker compose --project-name "$project" --project-directory "$PWD" \
    --env-file "$env_file" -f ./docker-compose.yml -f "./deploy/nortex/$target.yml" \
    --profile assistant-worker config --quiet
  # Una llamada shell pura no recibe los --build-arg que Coolify inyectaría
  # en "docker compose build". Pasar sólo sus nombres declarados: Compose
  # resuelve sus valores con su parser dotenv, sin source/eval ni logs de valores.
  set --
  for argument in $(awk '$1 == "ARG" { split($2, name, "="); print name[1] }' Dockerfile); do
    case "$argument" in ''|[0-9]*|*[!a-zA-Z0-9_]*) echo 'NORTEX_BUILD_ARG_INVALID' >&2; exit 1 ;; esac
    set -- "$@" --build-arg "$argument"
  done
  exec docker compose --project-name "$project" --project-directory "$PWD" \
    --env-file "$env_file" -f ./docker-compose.yml -f "./deploy/nortex/$target.yml" build "$@" app
fi

# Con Preserve repository=true, Coolify copia repo y .env al workdir del host;
# false conserva ambos en el helper. No se monta ninguna ruta del repo en app.
[ -f ./.env ] || { echo 'NORTEX_RUNTIME_ENV_REQUIRED' >&2; exit 1; }
exec docker compose --project-name "$project" --project-directory "$PWD" \
  --env-file ./.env -f ./docker-compose.yml -f "./deploy/nortex/$target.yml" \
  --profile assistant-worker up -d --no-build --pull never --wait --wait-timeout 300 "$@"
