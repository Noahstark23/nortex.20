# Equipo de desarrollo de Nortex

Dirección actualizada el 2026-09-09: [meta del equipo administrativo](META_NORTEX_EQUIPO_ADMINISTRATIVO.md) y [arquitectura](ARQUITECTURA_EQUIPO_ADMINISTRATIVO_2026-09-09.md). Contador, RRHH y financiero son papeles del producto que se construirá; los perfiles siguientes desarrollan y verifican ese producto. No crear procesos/modelos adicionales por cada nombre ni confundir agentes con revisores profesionales humanos.

Configuración del 2026-09-08. Son perfiles de agentes disponibles por tarea, no empleados ni procesos permanentes. Codex los registra en `.codex/config.toml` y Claude en `.claude/agents/`. Conservan el modelo predeterminado del entorno; no añaden proveedores, presupuesto de IA ni permisos externos. Los perfiles nuevos se cargan en una sesión que vuelva a leer la configuración. La revisión de esta entrega usa los agentes existentes, con ownership explícito.

## Responsabilidad y entrega

| Perfil | Responsabilidad | Evidencia para integrar |
|---|---|---|
| nortex-integrator | Contratos, archivos compartidos, integración y release | Candidato preciso, conciliación del diff, pruebas y gates separados |
| nortex-finance | Venta, compras, stock, caja y contabilidad | Efectos conciliados, auditoría, idempotencia, rollback y concurrencia MySQL |
| nortex-platform | Prisma/pool, workers, observabilidad, capacidad y respaldo | Mediciones, recuperación ensayada y alcance de configuración |
| nortex-pos | Experiencia de caja, componentes y recuperación | Recorrido de venta, lector/atajos, carrito, red y accesibilidad |
| nortex-intelligence | RAG, orquestación, fuentes y evaluación | ACL, citas, abstención, presupuesto y calidad medida por separado |
| nortex-qa | Expected independientes y evaluación del candidato | Negativos, regresión, resultados sin omisiones y límites explícitos |
| nortex-clean-code | Extracciones y límites entre dominios | Caracterización previa, contratos conservados, delta de origen/destinos/total |

`reviewer`, `explorer` y `docs_researcher` existentes conservan su función de lectura/revisión. El revisor de un lote financiero no debe certificarlo basándose solo en la explicación de su autor. El responsable humano del producto define alcance y aceptación; revisión farmacéutica, datos esperados y piloto necesitan personas identificadas.

## Contrato antes de cada lote

El integrador registra: objetivo y criterio observable; candidato de partida; archivos permitidos por agente; firmas y errores compartidos; orden de integración y pruebas; responsable de revisión. Ningún perfil reserva archivos para siempre ni habilita cambios remotos. Si dos tareas necesitan el mismo archivo, serializarlas o reasignar su editor antes de modificarlo.

`backend/server.ts`, `components/POS.tsx`, `backend/prisma/schema.prisma`, migraciones, tipos compartidos, package/lockfile, CI y presupuestos tienen un único integrador. Un agente que detecta un cambio necesario allí entrega contrato y evidencia; no lo edita en paralelo por iniciativa propia.

Codex conserva `max_threads=6` y `max_depth=1`: como máximo el integrador y cinco tareas activas, sin aumentar límites para acelerar. Elegir solo tareas independientes con trabajo útil; los siete perfiles no necesitan ejecutarse simultáneamente. La lista de archivos es una regla de coordinación, no una ACL impuesta por el filesystem.

## Primer ciclo de estabilidad

1. Plataforma y QA: conservar el ensayo SQL real aislado ya aprobado y completar la recuperación del almacenamiento privado de adjuntos y medir baseline de los cuatro negocios sin saturar producción. Registrar RPO/RTO y ventanas; una muestra de RAM no acredita capacidad.
2. Finanzas y QA: adjudicar CxP paginadas, seriales, RRHH y caja bancaria mediante reproducciones independientes de D11; reparar únicamente los defectos demostrados, con transacción y reconciliación.
3. Clean Code y POS: caracterizar y extraer alta rápida y conteos, uno por lote. Exportación fiscal ya vive en rutas; queda revisar su carga síncrona. Reducir presupuestos en el mismo cambio.
4. Inteligencia y QA: reparar recorrido de citas, ampliar ayuda revisada y medir retrieval antes de elegir embeddings; mantener evaluación real y piloto como gates distintos.
5. Integrador: consolidar cada lote, actualizar estado/evidencia y ejecutar la promoción manual solo con sus requisitos satisfechos.

Prioridades, dependencias y aceptación detalladas: [plan de desarrollo](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md). Estado verificable: [estado actual](ESTADO_ACTUAL_NORTEX.md). La fecha de cada tarea se fija después del baseline y de disponer de sus revisores; no se promete una fecha comercial por conteo de agentes.

## Entregas del equipo administrativo — A00–A07

| Resultado | Editor de dominio por lote | Revisión y dependencias |
|---|---|---|
| A00/A01: encargos, evidencia, recuperación y cola | Plataforma para persistencia/worker; Inteligencia para coordinación, con archivos separados | Integrador de schema/contratos; QA de reinicio/revocación/idempotencia; Clean Code revisa límites |
| A02/W01: cierre semanal explicado | Finanzas para servicio de lectura; Inteligencia para herramienta | QA con expected independiente y responsable contable; POS para panel/carrito |
| A03/W02: planilla revisada | Finanzas con especialidad RRHH y skill `nortex-rrhh`; dueño único por módulo | Revisor laboral/contable humano; riesgos D11 de cálculo/privacidad para preparar. Pago separado exige atomicidad/concurrencia/rollback |
| A04/W03: planificación de caja | Finanzas | QA/Contabilidad verifican fuentes, cobertura y escenarios; Inteligencia sólo interpreta resultados |
| A05: conectar IA por MCP | Inteligencia para adaptador; Plataforma para identidad delegada, archivos distintos | Revisión de seguridad y QA en cada cliente; scopes y consentimiento antes de datos privados |
| A06/A07: coordinación y piloto | Integración organiza lotes y Producto conduce medición | Dueños de dominio, QA y revisores identificados; costo y resultado observados |

Estos son encargos para perfiles existentes, no una instalación de perfiles nuevos. Antes de cada lote, el integrador concreta archivos permitidos y contrato; la tabla no concede edición simultánea de archivos compartidos. Un mismo perfil puede cubrir varios dominios en lotes secuenciales. La presencia de agentes de desarrollo no sustituye revisión humana de normas, etiquetas ni resultados del piloto.

Primero especificar y caracterizar la lectura `getShiftSnapshot` de W01. El cierre real y el pago de nómina no se invocan para obtener una explicación. La rama y el candidato actual se preservan; este documento no solicita crear worktrees ni publicar cambios.
