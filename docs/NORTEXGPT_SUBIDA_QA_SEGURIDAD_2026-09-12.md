# NortexGPT: cierre del candidato de presupuesto y caja

Fecha: 2026-09-12. Integrador: Codex; revisión independiente por dominio.
Candidato persistente: `~/Developer/Nortex/candidates/release-20260908`, rama
`codex/caja-nica-retention`, base `ead043c2aa27e25e6522e97b3cdc2c3a4e585783`.
El repositorio original, las ramas y los worktrees existentes se conservan.

## Alcance

El lote acumula el presupuesto inicial US$2 con solicitud/aprobación de Nortex,
la ayuda visible con fuentes, la meta del equipo administrativo y W01/W01B:
revisión semanal de caja e investigación del soporte de un cierre. Sus informes
fechados conservan sus pruebas originales. La revisión de caja es de lectura y
no confirma una conciliación física ni resuelve automáticamente sus pendientes.

## Corrección de autoridad presupuestaria

La revisión estática del candidato anterior encontró una causa con dos efectos:
la lectura del presupuesto/historial y la creación de solicitudes dependían de un
cargo `Employee.OWNER` editable por RRHH. El control nuevo pretendía reservar esas
funciones al dueño, pero usaba un dato que no acreditaba esa autoridad. No se
demostró acceso entre negocios ni aprobación automática o evasión de los topes.

Se reemplaza por `User.assistantBudgetOwner`, falso por defecto. `User.OWNER`
conserva acceso; `User.ADMIN` necesita esta concesión explícita. El registro de un
negocio nuevo la establece en el servidor dentro de su transacción. RRHH no puede
concederla y una migración no la deduce de cargos históricos.

Nortex puede conceder o revocar a un ADMIN anterior mediante
`POST /api/admin/assistant-budget/ownership`, autenticado como SUPER_ADMIN vigente
de otro negocio. Cuerpo estricto: `targetTenantId`, `targetUserId`, `granted` y
`reason` (10–500 caracteres). Es una operación administrativa explícita: el tenant
objetivo se valida junto al usuario después de comprobar la autoridad de Nortex;
no modifica el tenant de la sesión. Concesión: cuenta ADMIN activa. Revocación:
también permite retirar una bandera que quedó en una cuenta deshabilitada o cuyo
rol cambió. No revoca la autoridad del rol OWNER explícito.

Antes de conceder, Nortex debe verificar identidad y negocio por su procedimiento
de soporte; el motivo registra la referencia de esa revisión, sin adjuntar secretos
o documentos personales. Una respuesta perdida se recupera repitiendo el estado
deseado: si ya coincide, devuelve `changed:false` sin otra escritura/auditoría.
Toda transición real guarda `ASSISTANT_BUDGET_OWNERSHIP_CHANGED` y su before/after
en la misma transacción. Los locks User se adquieren en orden estable. La cuenta
que opera se revalida tras la espera. El servicio no toca límites, configuración,
gasto, reservas ni consumo UNKNOWN.

La consulta del dueño revalida al terminar bajo ReadCommitted. El listado de
Nortex también revalida después de leer. Retirar la concesión bloquea gestión e
historial; las capacidades habituales autorizadas y el consumo de ayuda continúan
bajo el mismo presupuesto. No hay cobro adicional automático.

## Evidencia de seguridad y límites

Scan original: `cde7904a-845d-43e5-9a41-637773d1dfe1`, sellado antes del parche.
Snapshot `b2755e59efd408428e57276014a2df078852994d54ac60c8a2061616760715d2`.
39 archivos fuente cambiados revisados, más schema, pruebas y controles de soporte.
Dos instancias de severidad media y confianza media, una causa compartida (S78/S79).
El informe original conserva los hallazgos; el parche posterior se verifica aparte.

La revisión automática rechazó la reproducción dinámica solicitada por posible
riesgo de ciberseguridad. No se reintentó. La conclusión original se apoya en
trazado estático del código, no en una reproducción HTTP exitosa. Las pruebas
defensivas posteriores verifican el nuevo contrato; no convierten esa reproducción
no ejecutada en evidencia ejecutada.

## QA y subida

Pendiente: repetir las compuertas sobre el parche final antes de aprobar el flujo.
La subida autorizada conserva el trabajo en la rama existente como revisión
pendiente; no acredita QA final ni promoción. Los workflows de release requieren
su dispatch separado. No se inicia un PR/CI como alternativa a la ejecución
bloqueada.
El agente de QA recibió también un bloqueo automático al solicitar la compuerta
canónica. No se trasladó esa misma ejecución a otro agente/herramienta para
sortearlo. TypeScript del producto pasó antes de incorporar la nueva suite de
ownership; las dos suites unitarias de acceso/presupuesto pasaron 38 casos.
La nueva suite de ownership declara 30 casos, todavía sin ejecución MySQL.
La revisión independiente del parche fue estática y no encontró otro defecto
concreto. No equivale a integración aprobada.
Los resultados anteriores a esta corrección fueron 6.154 pruebas generales,
436 obligatorias MySQL sin omisiones y auditoría npm de producción sin avisos.
Esos números no se atribuyen al parche nuevo. Los logs privados quedan bajo
`reports/quality-final-upload-20260912/`; no se publican datos ni salidas crudas.
La migración ya iniciada antes del bloqueo pasó **5/5 escenarios** en MySQL 8.0.46:
135 tablas anteriores comparadas por escenario, cuatro migraciones espejo exactas,
concesión legacy inicialmente falsa, concesión explícita previa conservada,
reejecución idempotente y gasto/reservas/UNKNOWN intactos. Limpieza confirmada,
cero llamadas IA. Resumen privado:
`reports/assistant-budget-upgrade/2026-09-12T19-02-49-356Z/summary.json`.
La mutación ya iniciada conserva evidencia separada bajo
`reports/quality-final-fixed-20260912/`; su resultado debe leerse del resumen final.

[Manifiesto de esta corrección](evidence/nortexgpt/final-security-20260912/verification.json),
[seguridad estática original](evidence/nortexgpt/final-security-20260912/security-summary.json)
y [migración posterior](evidence/nortexgpt/final-security-20260912/upgrade-summary.json).

El servidor permanece en 14.118 líneas y el POS en 5.924. Esta reparación añade un
campo literal al registro existente, sin extraer ni trasladar ese flujo. La lógica
de concesión/revocación vive fuera del monolito. No aumenta ningún presupuesto.
El lote previo redujo el servidor 14.131 → 14.118 y el servicio de reportes
994 → 933; sus destinos y deltas totales están en los informes de cada entrega.

Subir el candidato y CI no habilita capacidades ni acredita staging, producción,
calidad de Haiku o piloto. Antes de promoción: candidato CI/staging coincidente,
revisión de las migraciones y respaldo/restauración; identificar/verificar a los
dueños ADMIN anteriores para la concesión puntual. No se concede ninguna cuenta
real durante este QA. Continúan pendientes la evaluación humana/Haiku, farmacia y
revisores del piloto, y las condiciones operativas documentadas de almacenamiento.
