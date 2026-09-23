# A01.W01.1–2 · guardar y retomar la revisión de caja

## Resultado y autoridad

Convertir una revisión semanal terminada en un encargo privado durable: guardar
su referencia y período, aportar notas, dejarlo esperando y retomarlo o cancelarlo.
Recargar y recuperar no ejecuta herramientas, modelo, cierre, asiento ni pagos.

El usuario autenticado debe conservar `operations` y `cashReview`. El encargo
pertenece a tenant, usuario y rol original; no añade asignación entre usuarios.
Las notas son aportes humanos, no cifras ni evidencia confirmada. No se ofrece
aceptación final del informe hasta implementar la revalidación completa A02.W01.3.
Responsable de producto: Nortex. Conductas H01 aprobadas no aprueban este encargo.

## Contrato y fuentes

- Base: candidato `nortexgpt-release-ready-20260919`, main `67f1832` más A00.
- Se crea con `runId` propio, terminado, que contenga evidencia `review_weekly_cash`
  válida. El servidor obtiene período, referencia y resumen desde esa ejecución.
  No recibe informe ni importes del navegador. Una ejecución pertenece como máximo
  a un encargo por usuario; reintento exacto devuelve el mismo.
- Estado `IN_REVIEW`, `WAITING`, `CANCELLED`; versión creciente y eventos
  idempotentes por UUID. Mismo UUID con contenido distinto falla sin escribir.
- Operaciones de estado `ADD_NOTE`, `WAIT`, `RESUME`, `CANCEL`: versión requerida,
  revalidación de identidad y permisos, CAS y evento en la misma transacción.
- Las notas se conservan al esperar/reanudar. Cancelar no cancela ni cambia la caja.
  No se permite editar un encargo cancelado. No hay agenda ni reanudación automática.
- Listado paginado/acotado; GET no prepara, no calcula y no llama al proveedor.
  La recuperación valida también la ejecución de origen, su acceso y caducidad;
  una fuente indisponible no se reemplaza con cero ni datos de otra ejecución.
- Caducidad máxima 30 días y nunca posterior a la ejecución. Limpieza auxiliar
  borra eventos e item juntos; ningún documento contable depende del encargo.
- US$0 de gasto añadido; ninguna llamada IA nueva. Esperar no consume presupuesto.
- Incertidumbre de respuesta: conservar UUID y leer/reintentar exactamente el
  mismo evento. Un conflicto de versión obliga a recuperar el estado actual.

## Edición

| Responsable | Archivos |
|---|---|
| Plataforma | `backend/services/assistant/workItems/*.ts`, `backend/routes/assistantWorkItems.ts`, `shared/assistantWorkItems.ts`, modelos nuevos al final de schema, migración `20260919030000_assistant_work_items/migration.sql`, tests nuevos de work items |
| Integrador | mount de router, panel/hook UI nuevos, composición del panel, limpieza y docs de estado |
| QA independiente | pruebas adicionales y revisión de aislamiento/estado, sin editar archivos ajenos |

No extrae ni amplía monolitos; composición en módulos del asistente. UI dentro
del panel mantiene bloqueo de lector/atajos y carrito. No guardar notas privadas
en localStorage. Cambiar sesión oculta y elimina datos locales de esa sesión.

## Evidencia de salida

Antes del cambio: no existe encargo durable. Exigir pruebas ejecutables para dos
negocios, caducidad, permisos revocados, duplicados y cambios de versión, notas,
espera/reanudación/cancelación, recuperación sin llamadas ni cambios de dominio.
La integración de MySQL y la utilidad humana se registran aparte; no atribuir
las pruebas del lector financiero al almacenamiento del encargo ni viceversa.
Este lote no cierra W01 completo, aceptación, correcciones de caja, piloto o deploy.
