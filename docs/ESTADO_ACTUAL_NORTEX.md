# Estado actual de Nortex

**Incremento local del 2026-09-12:** [W01B investiga el soporte de un cierre](NORTEXGPT_INVESTIGACION_CIERRES_2026-09-12.md). `inspect_cash_close` separa fuentes históricas/actuales y conserva pendientes humanos en el run privado; no acredita conciliación ni despliegue. [La revisión final](NORTEXGPT_SUBIDA_QA_SEGURIDAD_2026-09-12.md) añade autoridad presupuestaria explícita en User; migración probada, compuerta final bloqueada por el servicio de seguridad. El estado productivo fechado más abajo no cambia por esta entrega.

**Dirección actualizada el 2026-09-09:** [meta del equipo administrativo](META_NORTEX_EQUIPO_ADMINISTRATIVO.md) y [arquitectura propuesta](ARQUITECTURA_EQUIPO_ADMINISTRATIVO_2026-09-09.md). Contabilidad, RRHH y finanzas coordinadas, con objetivo de precio US$20/negocio/mes. La actualización original fue documental; posteriormente se implementó y probó localmente el [primer incremento W01](NORTEXGPT_REVISION_SEMANAL_CAJA_2026-09-09.md). No hubo llamadas IA ni promoción nuevas. Las cifras de infraestructura y release siguientes conservan su fecha de observación.

El [lote documental](evidence/administrative-goal-20260909/verification.json) identifica los 15 Markdown afectados y preserva la evidencia de QA anterior; no equivale a implementar A00–A07.

Revisión documental: 2026-09-08 (cierre de promoción en UTC del 09/09). Candidato desplegado: `07f30c9a2f372abfeb31c2e3ae0c1c8fae7818fc`. Corte de producto verificado: `484f58a4e31ad74ba5bdbcfaee390ee3f3d1284b`, [PR 207](https://github.com/Noahstark23/nortex.20/pull/207). Este documento es el punto de entrada mantenido; los informes fechados describen su propio candidato. La actualización posterior de guías y perfiles necesita su propia comprobación; no cambia los resultados de producto ya registrados.

## Evidencia por estado

| Área | Demostrado | Pendiente o límite |
|---|---|---|
| Código consolidado | Compras conversacionales, propuestas/idempotencia, operaciones del asistente, promociones online, cierre Z y correcciones de POS integradas con PR205/206 | Implementación no acredita activación en cada negocio |
| QA local | Prisma generate/validate, TypeScript, diseño, build SEO; 5.736 pruebas generales aprobadas, cero fallidas | 318 omitidas no cuentan como aprobadas; QA visual/dispositivos y jornada real no sustituidas |
| Integración financiera | 37 suites, 332 casos HTTP/MySQL 8 descartable, cero omisiones | Solo escenarios y candidato ejecutados |
| Mutación local | 64 módulos, 100%; 5.759 eliminados + cuatro timeouts, cero sobrevivientes/sin cobertura; 20 exclusiones históricas | No es cobertura global ni mutación ejecutada en el run de PR |
| CI | Cuatro jobs exitosos en el candidato desplegado `07f30c9`, [run 34293152828](https://github.com/Noahstark23/nortex.20/actions/runs/34293152828) | Mutación corresponde a la corrida local indicada arriba; el paso está omitido en este run de CI |
| RAG | 12 artículos, búsqueda léxica/top-2 y filtros; datos del negocio desde herramientas deterministas | Curación, citas visibles del recorrido operativo, benchmark reservado y evaluación real siguen pendientes |
| Infraestructura | Droplet 2 vCPU, 4 GiB RAM, 80 GiB; producción y staging comparten host. Muestra: 1.695 MiB disponibles y 879 MiB de swap usados | No existe capacidad de clientes concurrentes acreditada; faltan series, carga y p95 |
| Respaldo real | Respaldo remoto restaurado en MySQL 8 aislado; schema candidato aplicado dos veces, con filas y agregados preservados y relaciones verificadas; cleanup aprobado | No acredita recuperación completa de la aplicación ni de originales privados; evidencia operativa conservada fuera del repositorio público |
| Configuración | Identidad HTTPS/UUID y webhooks verificados; tokens de lectura separados y token de deploy de producción; ambos Auto Deploy apagados en la interfaz; main requiere PR/checks y environments solo main sin bypass administrativo | Tokens limitados al equipo, no por app. El usuario eligió su propia cuenta para revisar production: excepción explícita, no revisión independiente. Ambos pins corresponden al candidato desplegado; revalidar antes de cada promoción |
| Despliegue | PR 207/208/209 fusionadas; staging [34296014918](https://github.com/Noahstark23/nortex.20/actions/runs/34296014918) y producción [34296529913](https://github.com/Noahstark23/nortex.20/actions/runs/34296529913) exitosos en `07f30c9`; smoke financiero sintético aprobado en ambos | Hubo HTTP 503 durante el reemplazo; duración continua no medida. Observación posterior de 30 minutos aprobada (31 muestras); piloto no acreditado |
| Panel Coolify | Actualización real 4.1.2 → 4.3.18; backup cifrado fuera del host y en Mac; restauración SQL, 53 migraciones y reejecución ensayadas; sesión existente y API verificadas | No acredita rollback integral con consumidores reiniciados, recuperación del host ni originales privados de NortexGPT |

[Evidencia local y manifiesto](releases/evidence/2026-09-08-consolidated/local-verification.json) · [expediente del candidato](releases/2026-09-08-consolidated-candidate.md). Los datos de entorno de esta tabla son observaciones fechadas; revalidar antes de operar.

## Monolito y riesgo operativo

`backend/server.ts`: **14.131 líneas**; `components/POS.tsx`: **5.924 líneas**, **96 referencias textuales useState**. Las guardas ejecutables son `tests/presupuestoBackend.test.ts` y `tests/presupuestoPos.test.ts`; sus límites solo bajan. La extracción fiscal tuvo ocho pruebas conductuales antes/después: server 14.674→14.131, destinos 244+330 líneas, delta conjunto +31. Reducir un archivo no demuestra menor código total ni mejor rendimiento.

El tamaño sigue siendo deuda de mantenimiento. El riesgo de caída también depende de consultas, conexiones, trabajos durables, recursos y recuperación: no se puede afirmar que cuatro clientes son una carga segura solo por su cantidad. El usuario indicó cuatro negocios; no se midió su simultaneidad. Hay 10 construcciones runtime de Prisma en el corte (nueve fuera del cliente compartido), además de estado por proceso en límites/caché y canal comercial. La cola privada ya es durable; no confundirla con la comercial.

Prioridad inmediata **C00**: mantener la restauración SQL ya ensayada, acreditar recuperación de adjuntos antes de habilitarlos, ventanas de observación, carga representativa fuera de producción, conciliación de venta/caja y primeros lotes de modularización. Los objetivos se fijan antes de medir aceptación; no se promete disponibilidad ni número de clientes sin evidencia.

## Lote local posterior: presupuesto de NortexGPT

US$2 iniciales por negocio/mes y ampliación mediante solicitud y aprobación de
Nortex, sin cobro automático. Código, UI y QA local del candidato posterior están
en [el informe del presupuesto](NORTEXGPT_PRESUPUESTO_Y_QA_2026-09-09.md):
5.899 pruebas generales y 368 casos de integración obligatoria sin omisiones.
También se corrigió la ayuda invisible en respuestas operativas. El servidor
local baja a 14.118 líneas; las cifras de 14.131 anteriores corresponden al
candidato desplegado. Este lote aún no acredita evaluación Haiku, piloto, CI,
staging ni producción nuevos.

## Desarrollo siguiente

- **A00–A07 / nueva meta:** encargos durables y W01 revisión de cierre semanal; W02 planilla revisada, W03 caja/compromisos, MCP y coordinación posterior. Primera herramienta de caja implementada y probada localmente: `review_weekly_cash`. El expediente completo, contabilidad/RRHH/finanzas coordinados y OAuth MCP siguen pendientes. [Meta y aceptación](META_NORTEX_EQUIPO_ADMINISTRATIVO.md).
- [Plan de estabilidad y RAG](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md): C00 y D00–D14 con dependencias y criterios.
- [Equipo de desarrollo](EQUIPO_DESARROLLO_NORTEX.md): responsabilidades y propiedad de archivos.
- [Capacidad del Droplet](CAPACIDAD_DROPLET_NORTEX_2026-09-08.md) y [auditoría de escalado](SCALING_AUDIT.md): mediciones y deuda.
- [Promoción](runbooks/release-promotion.md): requisitos externos, SHA y verificaciones separadas.
- [Mantenimiento documental](MANTENIMIENTO_DOCUMENTAL_NORTEX.md): distinguir guía vigente de evidencia histórica.

La revisión encontró deuda heredada que requiere reproducciones específicas: paginación/totales CxP, transiciones de seriales, decisiones/pagos de RRHH, caja bancaria y precios de B2B. Un total verde no demuestra el cierre de todos esos riesgos. No convertir recetas antiguas de efectos financieros fuera de transacción en reglas para código nuevo.

La ferretería del piloto tiene una referencia de contacto aportada por el usuario. Faltan identificación del tenant/revisores, farmacia y evaluación humana de escenarios; no publicar datos personales ni inventar aprobaciones. Ayuda ampliada, valor del piloto y calidad del modelo se acreditan independientemente de QA determinista.

Actualización del intento de promoción: [incidente del verificador REST y reparación](releases/2026-09-08-workflow-run-path.md). La producción observada no tiene el asistente ni la extracción activos; publicar código no sustituye habilitación, workers, volumen privado y evaluación del piloto.

Cierre del bloqueo de Coolify y promoción: [evidencia de producción](releases/2026-09-08-production-verification.md). El [informe de compatibilidad](releases/2026-09-08-coolify-compatibility.md) conserva el intento anterior como historia.
