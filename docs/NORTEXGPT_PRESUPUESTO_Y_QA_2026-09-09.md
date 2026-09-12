# NortexGPT: presupuesto y QA de preparación para clientes

Candidato local basado en `ead043c2aa27e25e6522e97b3cdc2c3a4e585783`, en la copia persistente `~/Developer/Nortex/candidates/release-20260908`. El repositorio original y la producción quedan separados. Esta entrega no equivale a activación del asistente ni a piloto aprobado.

[Manifiesto del candidato y resultados](evidence/nortexgpt/budget-approval-20260909/verification.json).

## Contrato implementado

- US$2 iniciales por negocio y mes civil de Managua. Se comparten entre los usuarios del negocio.
- El dueño solicita un **nuevo límite mensual total**, mayor al actual y de hasta US$10. Nortex aprueba o rechaza desde SuperAdmin, con motivo. El límite aprobado continúa los meses siguientes; no es una recarga ni un cobro automático.
- El máximo global continúa en US$20. Aprobar no reserva ese importe, no habilita capacidades y no elimina gasto, bloqueos ni reservas de costo incierto.
- `approvedMonthlyBudgetUsd`, por defecto 2, protege también configuraciones anteriores cuyo `monthlyBudgetUsd` vale 10. El límite efectivo es el menor entre configuración, aprobación y techo de US$10.
- Corrección posterior del 12/09: `User.OWNER` conserva autoridad y `User.ADMIN` requiere `assistantBudgetOwner=true`. El registro nuevo fija la concesión en el servidor; las cuentas anteriores requieren verificación de Nortex. `Employee.OWNER` no concede permisos de presupuesto. La aprobación exige un SUPER_ADMIN activo de Nortex, distinto del solicitante y su negocio. [Motivo y verificación posterior](NORTEXGPT_SUBIDA_QA_SEGURIDAD_2026-09-12.md).
- Una solicitud pendiente por negocio. La misma clave y contenido devuelven el mismo resultado; cambiar el contenido produce conflicto. Aprobar/rechazar vuelve a comprobar condiciones y permisos, guardando decisión y auditoría en la misma transacción.
- Reservas y aprobaciones comparten orden de locks. La reserva vuelve a comprobar acceso después de esperar: una revocación anterior a la reserva impide crear consumo.

La pantalla del dueño vive en **NortexGPT → Uso y presupuesto de NortexGPT**. La bandeja de revisión vive en **SuperAdmin → Presupuesto de NortexGPT**. Ambas distinguen error de consulta de saldo cero; el agotamiento de plataforma no muestra saldos de otros negocios ni se promete resolver con una ampliación individual. Los reintentos de respuestas inciertas conservan su identidad y contenido.

Rutas: `GET /api/assistant/budget`, `POST /api/assistant/budget/requests`, `GET /api/admin/assistant-budget/requests` y `POST /api/admin/assistant-budget/requests/:id/decision`. Los cuerpos son estrictos; la decisión contiene aprobación/rechazo y motivo, nunca un monto financiero nuevo. Las lecturas no siembran datos y las listas están acotadas/paginadas.

## QA ejecutado

| Comprobación | Resultado y alcance |
|---|---|
| Prisma 6.4.1 | Generate y validate aprobados; migración aditiva MySQL con SQL espejo. |
| Compuerta local | `mise exec -- sh scripts/ci-local-safe.sh`: TypeScript, 5.899 pruebas generales, sistema de diseño y build aprobados. 354 casos omitidos en esa ejecución general no cuentan como aprobados. |
| Integración obligatoria | 38 suites, **368 casos aprobados sin omisiones**, MySQL 8 descartable. Incluye 36 casos nuevos de presupuesto, HTTP, permisos, concurrencia, agotamiento global, rollback de auditoría y reservas UNKNOWN. [Resumen](evidence/nortexgpt/budget-approval-20260909/integration-summary.json). |
| Actualización de schema | Cuatro escenarios: schema anterior poblado, columna parcial, tabla parcial y SQL espejo. Doce db push, ocho preflights, índices/FK, duplicados y reejecución; importes y reservas preservados, cleanup aprobado. [Resumen](evidence/nortexgpt/budget-approval-20260909/upgrade-summary.json). |
| Mutación dirigida | Nueva política: **20/20 mutantes eliminados**, sin sobrevivientes ni timeouts. Además pasó la corrida global: **65 módulos, 5.779 eliminados + cuatro timeouts, cero sobrevivientes/sin cobertura y 20 exclusiones históricas**; score y umbral 100%, rangos/pisos verificados. [Global](evidence/nortexgpt/budget-approval-20260909/full-mutation-summary.json). [Dirigida](evidence/nortexgpt/budget-approval-20260909/policy-mutation-summary.json). |
| Interfaz | 18 casos de formularios y una prueba de montaje en POS: solicitar conserva carrito y ruta, sin confirmar compras. Ensayo visual con componentes reales y transporte simulado, a 390 y 1280 píxeles, sin desbordamiento horizontal. [Alcance](evidence/nortexgpt/budget-approval-20260909/visual-summary.json). |
| Ayuda operativa | Reproducción inicial: 8 fallos y un caso aprobado. Reparación muestra texto, abstención, título, sección y versión; 31 pruebas enfocadas aprobadas. El paso operativo dejaba estos datos guardados pero invisibles. |

Fallos encontrados durante el ciclo: el setup inicial agotó el límite de registros al crear demasiados negocios por HTTP; se corrigieron las fixtures sin relajar la protección del producto. Un doble unitario no representaba Employee y se actualizó. El guard de diseño detectó formato monetario no canónico; ahora usa `formatMoney` con USD y precisión suficiente para el consumo. El primer ensayo MySQL se adelantó al servidor temporal de inicialización; se corrigió readiness por TCP y se repitieron todos los escenarios.

## Modularidad

`backend/server.ts` baja **14.131 → 14.118 líneas**. La composición de rutas del asistente pasa a `backend/routes/assistantMounts.ts` (24 líneas), conservando orden y URLs; conjunto original+destino: **+11 líneas**, incluidas dos rutas nuevas de presupuesto. El presupuesto ejecutable baja a 14.118. El POS permanece en 5.924 líneas. La lógica nueva vive en módulos de presupuesto y componentes independientes, sin nuevos clientes Prisma ni dependencias.

## Estado y pendientes reales

No hubo llamadas pagadas ni modificaciones de producción en esta entrega. La credencial del llavero **local de QA** estaba ausente en la comprobación; esto no afirma nada sobre la variable privada de Coolify. Los formularios de evaluación real conservan `expectedOutcomesReviewed:false` y revisor sin asignar; ningún agente los aprobó en nombre de una persona.

Antes de habilitarlo a clientes: guardar credencial QA por el procedimiento privado, revisar expectativas con una persona, ejecutar evaluación Haiku acotada por vertical y contrastar utilidad/errores con trabajo manual. Identificar farmacia, tenant y revisores del piloto. Para adjuntos: operación del worker, almacenamiento privado y restauración de originales deben acreditarse antes de habilitarlos.

El RAG sigue con 12 artículos. Se reparó la ayuda invisible; abrir un pasaje autenticado de la versión citada sigue pendiente. La validación determinista de números no prueba soporte semántico de todas las afirmaciones: evaluación real e hipótesis explícitas siguen siendo condiciones de calidad.

El bucket global es por base de datos. QA, staging, producción y canal comercial requieren asignaciones cuya suma no exceda US$20 y cobertura de todos sus adaptadores; este cambio no acredita coordinación automática entre bases. La preparación QA fija US$2 por negocio sintético, sin activar ejecución, extracción, promociones ni WhatsApp. El [plan de estabilidad y RAG](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) mantiene esos trabajos abiertos.

CI del candidato nuevo, staging, autorización y producción no se acreditan con estas pruebas locales. La producción publicada previamente permanece documentada en [estado actual](ESTADO_ACTUAL_NORTEX.md).
