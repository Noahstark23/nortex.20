---
name: nortex-security-audit
description: "Auditoría de seguridad e integridad de Nortex (auditar endpoints, buscar brechas cross-tenant, revisar manejo de dinero). Usar cuando se pida auditar, revisar seguridad, o antes de declarar seguro un subsistema. Los hallazgos van numerados (S-n) a docs/SECURITY_AUDIT.md."
---

# Auditoría de seguridad de Nortex

Leer `AGENTS.md` y `CLAUDE.md`. Las búsquedas siguientes localizan candidatos,
no confirman vulnerabilidades. Auditar el checkout y alcance solicitados;
reproducir únicamente con datos sintéticos y servicios QA descartables.
No leer ni mostrar archivos de secretos, usar credenciales reales ni atacar
sistemas vivos. Una auditoría no autoriza despliegues, rotaciones o mensajes.

## Barrido por clase de bug (greps de arranque)

**Capa 1 — Cross-tenant (la clase más crítica):**
```bash
# updates/deletes por id suelto (sin tenantId en el where ni verificación previa)
grep -rnE "\.(update|delete)\(\{ *where: *\{ *id" backend/ --include=*.ts | grep -v node_modules
# findUnique por id de negocio (no verifica tenant)
grep -rnE "findUnique\(\{ *where: *\{ *id" backend/ --include=*.ts
# tenant tomado del body (PROHIBIDO)
grep -rnE "req\.body\.(tenantId|lenderId)" backend/
```
Patrón correcto: `findFirst({ where: { id, tenantId } })` antes de mutar, o el
filtro de tenant dentro del `updateMany`. En WhatsApp: el tenant viaja SOLO en
`ToolContext` server-side (nunca del modelo/usuario).

**Capa 3/4 — Dinero:**
```bash
grep -rnE "parseFloat|parseInt" backend/ --include=*.ts | grep -viE "req.query|page|limit"   # dinero con float?
grep -rnE "Math\.round\(.*\* *100\)" backend/    # redondeo float manual (usar Decimal)
```
- Toda mutación de dinero/stock → `AuditLog` con before/after **dentro de la tx**.
- Sumas de dinero → `Decimal.plus`, jamás `reduce((s,x)=>s+Number(x))`.

**Capa 5 — Entradas/inyección:**
```bash
grep -rnE "queryRawUnsafe|\\\$queryRaw\(\`" backend/    # revisar parametrización; un tagged template no es SQL inseguro por sí mismo
grep -rnE "app\.(post|put|patch)" backend/server.ts | grep -v "validate("   # rutas de dinero sin Zod
```
- Tokens/operadores del usuario hacia FULLTEXT/SQL: sanear a alfanumérico Y parametrizar.
- Secretos: usar escaneo redactado o inventario de nombres de archivos sobre el
  código autorizado; no imprimir coincidencias con posibles claves/passwords.
  No abrir archivos de configuración privada ni contenido histórico de secretos.

**Trampas Prisma/concurrencia (clases reales del repo):**
- `select` + `include` en la misma relación → throw silencioso.
- Leer→validar→escribir en pasos separados (TOCTOU) → debe ser UPDATE condicional
  (`updateMany` condicional, bloqueo o identidad persistente según el contrato).
  Stock nuevo se mueve mediante `applyStockDelta`, no con un segundo motor.
- `upsert`/`create` sobre unique: comprobar contrato de conflicto/reintento; un
  error explícito no es por sí mismo una pérdida de integridad.
- `take: N` + re-rank en JS → resultados arbitrarios a escala.

## Verificación adversarial
Todo hallazgo se **confirma con el código completo del handler** (leer el flujo
entero, no solo la línea del grep) antes de reportarlo. Separar evidencia
estática, defecto reproducido y riesgo pendiente. Para concurrencia, permisos
revocados o rollback, una búsqueda no reemplaza la prueba ejecutable: ¿hay una verificación de
propiedad arriba? ¿el middleware ya lo cubre? Falso positivo → descartar.

## Reporte
- Numerar S-n continuando `docs/SECURITY_AUDIT.md`; tabla: id · descripción ·
  archivo:línea · severidad · candidato · estado (riesgo, reproducido, reparado,
  verificado) · evidencia y límites.
- Si el alcance autoriza reparación, corregir y ejecutar QA proporcional; una
  auditoría solo lectura entrega el hallazgo. Dinero/inventario requiere la
  integración obligatoria con MySQL descartable. Un PR o producción necesitan
  la autorización vigente correspondiente.
- Actualizar el estado en `CLAUDE.md` §Estado actual si cambia lo "ya cumplido".
- Nunca declarar "seguro a nivel sistema": declarar el **alcance** auditado.
