#!/usr/bin/env bash
# Copia sólo originales vinculados a compras confirmadas. El SQL del mismo
# ciclo se genera primero; los originales ATTACHED son inmutables y no expiran.
# No habilita extracción ni sustituye un restore drill del objeto remoto.
set -Eeuo pipefail
umask 077

[[ "$#" -eq 5 ]] || { echo 'Uso: backup-assistant-originals.sh <cnf> <db> <root> <archive> <meta>' >&2; exit 1; }
CNF="$1"; DB_NAME="$2"; ROOT="$3"; ARCHIVE="$4"; META="$5"
fail() { echo "Backup de originales privados falló: $1" >&2; exit 1; }

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail 'nombre de base inválido'
[[ -f "$CNF" && "$(stat -c %a "$CNF")" == 600 ]] || fail 'credencial temporal no privada'
[[ -d "$ROOT" && ! -L "$ROOT" && "$(stat -c %a "$ROOT")" == 700 ]] || fail 'directorio de originales no privado'
[[ ! -e "$ARCHIVE" && ! -e "$META" ]] || fail 'el lote de originales ya existe'
command -v mysql >/dev/null && command -v tar >/dev/null && command -v sha256sum >/dev/null || fail 'faltan herramientas'

STAGE="$(mktemp -d "${ARCHIVE}.stage.XXXXXX")"
TEMP_ARCHIVE="${ARCHIVE}.tmp"
cleanup() { rm -rf "$STAGE"; rm -f "$TEMP_ARCHIVE"; }
trap cleanup EXIT
mkdir -m 700 "$STAGE/files"
: > "$STAGE/manifest.tsv"

# El listado posterior al dump puede contener originales adicionales creados
# entretanto. Los originales comprados anteriores no se eliminan por retención.
mysql --defaults-extra-file="$CNF" -N -B "$DB_NAME" -e \
  "SELECT storageKey,sha256,bytes FROM AssistantAttachment WHERE purchaseId IS NOT NULL OR status='ATTACHED' ORDER BY storageKey" \
  > "$STAGE/rows.tsv" || fail 'consulta de referencias'

COUNT=0
while IFS=$'\t' read -r KEY SHA BYTES; do
  [[ -n "$KEY" ]] || continue
  [[ "$KEY" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || fail 'referencia inválida'
  [[ "$SHA" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'hash inválido'
  [[ "$BYTES" =~ ^[0-9]+$ ]] && (( BYTES > 0 && BYTES <= 10485760 )) || fail 'tamaño inválido'
  [[ ! -e "$STAGE/files/$KEY" ]] || fail 'referencia duplicada'
  SOURCE="$ROOT/$KEY"
  [[ -f "$SOURCE" && ! -L "$SOURCE" && "$(stat -c %a "$SOURCE")" == 600 ]] || fail 'original ausente o inseguro'
  cp --no-dereference -- "$SOURCE" "$STAGE/files/$KEY" || fail 'copia de original'
  COPIED="$STAGE/files/$KEY"
  [[ -f "$COPIED" && ! -L "$COPIED" && "$(stat -c %a "$COPIED")" == 600 ]] || fail 'copia insegura'
  [[ "$(wc -c < "$COPIED" | tr -d ' ')" == "$BYTES" ]] || fail 'tamaño de original distinto'
  [[ "$(sha256sum "$COPIED" | cut -d' ' -f1)" == "${SHA,,}" ]] || fail 'hash de original distinto'
  printf '%s\t%s\t%s\n' "$KEY" "${SHA,,}" "$BYTES" >> "$STAGE/manifest.tsv"
  (( COUNT += 1 ))
done < "$STAGE/rows.tsv"

tar -cf "$TEMP_ARCHIVE" -C "$STAGE" manifest.tsv files || fail 'archivo privado'
chmod 600 "$TEMP_ARCHIVE"
ARCHIVE_BYTES="$(wc -c < "$TEMP_ARCHIVE" | tr -d ' ')"
ARCHIVE_SHA="$(sha256sum "$TEMP_ARCHIVE" | cut -d' ' -f1)"
mv "$TEMP_ARCHIVE" "$ARCHIVE"
printf '%s\t%s\t%s\n' "$COUNT" "$ARCHIVE_BYTES" "$ARCHIVE_SHA" > "$META"
chmod 600 "$META"
echo "✓ Originales privados verificados y archivados: ${COUNT} archivos."
