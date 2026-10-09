# NortexGPT: reparación de las compuertas de QA

## Origen comprobado

La QA del candidato `c0ec6e90f8e1f49b09ba373a704c1a0a7fe60b71`,
PR #224, encontró tres fallos reproducidos con Node 22.23.2 y MySQL 8:

- El séptimo SQL definía un índice de 65 caracteres y MySQL devolvió 1059.
- El smoke de presupuesto comparaba cuatro migraciones sobre `ead043c2` con el
  schema actual completo: `mirror` falló y `authority` no llegó a ejecutarse.
- Mutación obtuvo 99,77% frente al 100% requerido: diez sobrevivientes y cuatro
  sin cobertura en `utils/legacySaleMode.ts`. Ese código coincide con la base
  `8776be7`; no se atribuye una regresión nueva a NortexGPT.

La integración de ese candidato aprobó 559 casos, sin omisiones, y CI aprobó sus
cuatro jobs. Estos resultados no anulan los fallos anteriores ni acreditan otro SHA.

## Corrección delimitada

1. El SQL de `AssistantWorkItem` utiliza el nombre exacto de 64 caracteres que
   Prisma 6.4.1 genera para el índice. No cambia el schema ni el orden de sus campos.
2. El smoke parte de `20fda8dc196b808b0508e53d1253510cacd7096b` e incluye los
   siete SQL posteriores. Antes de iniciar Docker verifica el manifiesto contra
   Git: rechaza SQL omitido, histórico alterado y migraciones sin seguimiento.
   Conserva los cinco escenarios, las aserciones de datos y DDL completos,
   autoridad explícita, presupuesto y reejecución.
3. Las nuevas pruebas importan el resolver legado y el constructor real de
   cotizaciones. Cubren modo y paso por separado, unidades, normalización,
   rechazo de fracciones contadas y conservación de cantidades medidas.
4. CI ejecuta obligatoriamente el smoke del asistente dentro de
   `deploy-schema-smoke` y conserva su informe. `db push` no ejecuta el SQL
   versionado: ambos caminos necesitan evidencia.

No se modifica el resolver de negocio, dinero, stock, permisos, presupuesto de IA,
umbrales de mutación, alcance de Stryker ni monolitos. La configuración temporal
de npm usa archivos vacíos distintos; no hereda configuraciones con credenciales.

## Evidencia exigida para el candidato corregido

Registrar el SHA nuevo y ejecutar Prisma generate/validate, TypeScript, Vitest,
diseño, build, integración obligatoria MySQL 8 sin omisiones, mutación completa,
los cinco escenarios de presupuesto, los siete SQL desde `20fda8d`, reintento de
arranque y restauración sintética. El expediente externo de QA debe conservar
comando, fecha UTC, runtime, resultado y log de cada comprobación. Este documento
describe la reparación; no declara que esas ejecuciones hayan aprobado.

CI y staging deben corresponder a su candidato exacto. El merge posterior crea
otra identidad que requiere comprobación propia. La restauración sintética no
acredita el respaldo ni los originales privados de producción. La promoción
continúa bajo [el runbook vigente](../runbooks/release-promotion.md), sin activar
automáticamente capacidades ni gastar presupuesto del proveedor.
