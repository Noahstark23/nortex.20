#!/bin/sh
# NORTEX — Revisión inmediata tras escribir un archivo (PostToolUse Edit|Write).
#
# No corre tsc: tarda ~8s y hacerlo en CADA edición vuelve el loop inusable
# (esa verificación va al final, con `npx tsc --noEmit`). Lo que hace es buscar
# los footguns que el CLAUDE.md de este repo YA documenta como reglas duras, que
# son greps baratos y de valor real.
#
# exit 2 = bloquea y le devuelve el motivo al agente.

# Se leen DOS cosas del evento: la ruta y el TEXTO RECIÉN ESCRITO (new_string de
# Edit, content de Write). Las reglas duras se evalúan contra el texto nuevo, NO
# contra el archivo entero, y la razón es concreta: el repo arrastra ~21
# `new PrismaClient()` legacy (SCALING_AUDIT A2). Chequeando el archivo completo,
# el hook bloqueaba CUALQUIER edición a backend/server.ts —incluida una guarda de
# seguridad de tres líneas— por una deuda preexistente que esa edición ni tocaba.
# Un guardián que impide arreglar el archivo se termina desactivando, y ahí se
# pierde entero. Lo que se persigue es INTRODUCIR el footgun, no convivir con él.
entrada=$(cat)
archivo=$(printf '%s' "$entrada" | python3 -c "import sys,json;d=json.load(sys.stdin).get('tool_input',{});print(d.get('file_path') or '')" 2>/dev/null)
[ -z "$archivo" ] && exit 0
[ -f "$archivo" ] || exit 0

nuevo=$(printf '%s' "$entrada" | python3 -c "
import sys, json
d = json.load(sys.stdin).get('tool_input', {})
partes = [d.get('new_string') or '', d.get('content') or '']
# Edit con replace_all o multi-edit: juntar todos los reemplazos.
for e in (d.get('edits') or []):
    if isinstance(e, dict):
        partes.append(e.get('new_string') or '')
print('\n'.join(p for p in partes if p))
" 2>/dev/null)
# Sin texto nuevo identificable (herramienta desconocida), no hay qué juzgar:
# mejor callarse que bloquear a ciegas.
[ -z "$nuevo" ] && exit 0

case "$archivo" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
case "$archivo" in
  */node_modules/*) exit 0 ;;
esac

fallas=""

# Guardrail 1 de escalabilidad: ya hay ~21 `new PrismaClient()` (uno por módulo)
# que agotan conexiones al escalar. Existe el singleton backend/lib/prisma.ts.
if printf '%s' "$nuevo" | grep -q "new PrismaClient(" 2>/dev/null; then
  fallas="${fallas}\n   · new PrismaClient() — importá el singleton de backend/lib/prisma.ts (SCALING_AUDIT A2)."
fi

# Capa 5 del Security Loop: sin secretos hardcodeados. El JWT sale del keyring
# JWT_SECRETS (backend/services/secrets.ts).
if printf '%s' "$nuevo" | grep -qE "(JWT_SECRET|API_KEY|PASSWORD|SECRET)[[:space:]]*=[[:space:]]*['\"][A-Za-z0-9_/+-]{12,}['\"]" 2>/dev/null; then
  fallas="${fallas}\n   · Parece haber un secreto hardcodeado. Va por variable de entorno / keyring."
fi

if [ -n "$fallas" ]; then
  printf "🛑 %s viola una regla dura del CLAUDE.md:%b\n" "$archivo" "$fallas" >&2
  exit 2
fi

# Advertencias que NO bloquean: en dinero puede haber un parseFloat legítimo
# (parsear una entrada del usuario antes de pasarla a Decimal), así que se avisa
# y decide quien escribe.
case "$archivo" in
  backend/services/*|utils/*)
    if printf '%s' "$nuevo" | grep -qE "parseFloat\(|Number\(" 2>/dev/null; then
      echo "ℹ️  $archivo: hay parseFloat/Number en lo recién escrito. Si es un CÁLCULO de dinero, va con decimal.js." >&2
    fi ;;
esac
exit 0
