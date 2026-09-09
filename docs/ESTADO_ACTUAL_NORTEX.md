# Estado actual de Nortex

Revisión documental: 2026-09-08. Corte de producto verificado: `484f58a4e31ad74ba5bdbcfaee390ee3f3d1284b`, [PR 207](https://github.com/Noahstark23/nortex.20/pull/207). Este documento es el punto de entrada mantenido; los informes fechados describen su propio candidato. La actualización posterior de guías y perfiles necesita su propia comprobación; no cambia los resultados de producto ya registrados.

## Evidencia por estado

| Área | Demostrado | Pendiente o límite |
|---|---|---|
| Código consolidado | Compras conversacionales, propuestas/idempotencia, operaciones del asistente, promociones online, cierre Z y correcciones de POS integradas con PR205/206 | Implementación no acredita activación en cada negocio |
| QA local | Prisma generate/validate, TypeScript, diseño, build SEO; 5.736 pruebas generales aprobadas, cero fallidas | 318 omitidas no cuentan como aprobadas; QA visual/dispositivos y jornada real no sustituidas |
| Integración financiera | 37 suites, 332 casos HTTP/MySQL 8 descartable, cero omisiones | Solo escenarios y candidato ejecutados |
| Mutación local | 64 módulos, 100%; 5.759 eliminados + cuatro timeouts, cero sobrevivientes/sin cobertura; 20 exclusiones históricas | No es cobertura global ni mutación ejecutada en el run de PR |
| CI | Cuatro jobs exitosos en main `d51a948a4251b4b4a5676c5ff87ec982ac6e08d5`, [run 34291897808](https://github.com/Noahstark23/nortex.20/actions/runs/34291897808) | El cambio posterior de webhooks a POST necesita su propio CI |
| RAG | 12 artículos, búsqueda léxica/top-2 y filtros; datos del negocio desde herramientas deterministas | Curación, citas visibles del recorrido operativo, benchmark reservado y evaluación real siguen pendientes |
| Infraestructura | Droplet 2 vCPU, 4 GiB RAM, 80 GiB; producción y staging comparten host. Muestra: 1.695 MiB disponibles y 879 MiB de swap usados | No existe capacidad de clientes concurrentes acreditada; faltan series, carga y p95 |
| Respaldo real | Respaldo remoto restaurado en MySQL 8 aislado; schema candidato aplicado dos veces, con filas y agregados preservados y relaciones verificadas; cleanup aprobado | No acredita recuperación completa de la aplicación ni de originales privados; evidencia operativa conservada fuera del repositorio público |
| Configuración | Identidad HTTPS/UUID y webhooks verificados; tokens de lectura separados y token de deploy de producción; ambos Auto Deploy apagados en la interfaz; main requiere PR/checks y environments solo main sin bypass administrativo | Tokens limitados al equipo, no por app. El usuario eligió su propia cuenta para revisar production: excepción explícita, no revisión independiente. Pins deben corresponder al próximo SHA definitivo |
| Despliegue | PR 207 y reparación REST PR 208 fusionadas en main; producción sigue sana en `2834497f6090c2d55bcc48d5edb86887f6993ae3` | El nuevo staging pasó la validación de GitHub y se detuvo antes del webhook: Coolify 4.1.2 omite settings en la API. Compatibilidad/recuperación del panel pendientes; piloto no acreditado |

[Evidencia local y manifiesto](releases/evidence/2026-09-08-consolidated/local-verification.json) · [expediente del candidato](releases/2026-09-08-consolidated-candidate.md). Los datos de entorno de esta tabla son observaciones fechadas; revalidar antes de operar.

## Monolito y riesgo operativo

`backend/server.ts`: **14.131 líneas**; `components/POS.tsx`: **5.924 líneas**, **96 referencias textuales useState**. Las guardas ejecutables son `tests/presupuestoBackend.test.ts` y `tests/presupuestoPos.test.ts`; sus límites solo bajan. La extracción fiscal tuvo ocho pruebas conductuales antes/después: server 14.674→14.131, destinos 244+330 líneas, delta conjunto +31. Reducir un archivo no demuestra menor código total ni mejor rendimiento.

El tamaño sigue siendo deuda de mantenimiento. El riesgo de caída también depende de consultas, conexiones, trabajos durables, recursos y recuperación: no se puede afirmar que cuatro clientes son una carga segura solo por su cantidad. El usuario indicó cuatro negocios; no se midió su simultaneidad. Hay 10 construcciones runtime de Prisma en el corte (nueve fuera del cliente compartido), además de estado por proceso en límites/caché y canal comercial. La cola privada ya es durable; no confundirla con la comercial.

Prioridad inmediata **C00**: mantener la restauración SQL ya ensayada, acreditar recuperación de adjuntos antes de habilitarlos, ventanas de observación, carga representativa fuera de producción, conciliación de venta/caja y primeros lotes de modularización. Los objetivos se fijan antes de medir aceptación; no se promete disponibilidad ni número de clientes sin evidencia.

## Desarrollo siguiente

- [Plan de estabilidad y RAG](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md): C00 y D00–D14 con dependencias y criterios.
- [Equipo de desarrollo](EQUIPO_DESARROLLO_NORTEX.md): responsabilidades y propiedad de archivos.
- [Capacidad del Droplet](CAPACIDAD_DROPLET_NORTEX_2026-09-08.md) y [auditoría de escalado](SCALING_AUDIT.md): mediciones y deuda.
- [Promoción](runbooks/release-promotion.md): requisitos externos, SHA y verificaciones separadas.
- [Mantenimiento documental](MANTENIMIENTO_DOCUMENTAL_NORTEX.md): distinguir guía vigente de evidencia histórica.

La revisión encontró deuda heredada que requiere reproducciones específicas: paginación/totales CxP, transiciones de seriales, decisiones/pagos de RRHH, caja bancaria y precios de B2B. Un total verde no demuestra el cierre de todos esos riesgos. No convertir recetas antiguas de efectos financieros fuera de transacción en reglas para código nuevo.

La ferretería del piloto tiene una referencia de contacto aportada por el usuario. Faltan identificación del tenant/revisores, farmacia y evaluación humana de escenarios; no publicar datos personales ni inventar aprobaciones. Ayuda ampliada, valor del piloto y calidad del modelo se acreditan independientemente de QA determinista.

Actualización del intento de promoción: [incidente del verificador REST y reparación](releases/2026-09-08-workflow-run-path.md). La producción observada no tiene el asistente ni la extracción activos; publicar código no sustituye habilitación, workers, volumen privado y evaluación del piloto.

Bloqueo vigente y preparación: [contrato Coolify y recuperación independiente](releases/2026-09-08-coolify-compatibility.md).
