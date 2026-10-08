# Auditoría de escalado — Nortex y sus asistentes

Revalidación estática del **2026-09-08**, candidato `484f58a`. Sustituye las recetas
obsoletas del análisis inicial de julio; su historial permanece en Git. El inventario
es del candidato, no una afirmación sobre el código que hoy sirve producción.

`backend/server.ts` tiene **14.131 líneas** y `components/POS.tsx` **5.924**. Hay
**10 construcciones Prisma runtime**, una compartida y nueve fuera. Se verificaron
las ubicaciones de código; no se ejecutó una prueba de carga en esta auditoría.
No inferir capacidad, corrupción o estabilidad a partir del tamaño de archivo.

La inspección del host, copia off-site y pendientes reales están separados en
[Capacidad del Droplet](CAPACIDAD_DROPLET_NORTEX_2026-09-08.md). El candidato no está
acreditado en staging/producción por haber aprobado pruebas locales o CI.

## C — Schema, respaldo y recuperación

El arranque usa `scripts/docker-entrypoint.sh`: espera MySQL, preflights conocidos y
`db push --skip-generate`, sin `--accept-data-loss`. Incompatibilidad y timeout
cierran el arranque; no se garantiza que la instancia anterior siga disponible.
El comando no se debe ejecutar manualmente contra producción por seguir esta guía.

Los índices compuestos agregados desde julio y los preflights nuevos existen en
schema/código. Una definición versionada no demuestra aplicación en la base real,
uso por el optimizador ni ausencia de metadata locks. Verificar upgrade/idempotencia
con datos, `EXPLAIN` y latencias para el volumen objetivo.

`backup-db.sh` genera y sube SQL off-site; `verify-backup-restore.sh` restaura en
MySQL descartable. La copia real observada el 8 de septiembre tiene hash remoto
coincidente, pero el restore real sigue **no acreditado**. Además, el dump SQL no
incluye los originales privados de facturas: el respaldo/restore del asistente debe
conciliar DB, archivos y hashes. Aplicar `nortex-backup-recovery` antes de promover schema.

## A — Condiciones antes de añadir réplicas API

La ausencia de Redis no prueba que todo sea en memoria: el asistente privado ya
utiliza trabajos durables en MySQL. Tampoco la existencia de esas tablas permite
replicar todo Nortex: quedan controles legacy por proceso.

### A1 — Límites de peticiones

`backend/server.ts` configura limiters con store por proceso, incluidos autenticación
y rutas públicas. Por ejemplo, `globalLimiter` está en la línea 458 y `loginLimiter`
en 477. Dos instancias no comparten el conteo. Antes de replicar, implementar y
probar un store compartido con caída segura y límites coherentes; no desactivar
rate limits para resolver errores de coordinación.

### A2 — Clientes Prisma runtime

Inventario de expresiones `new PrismaClient()`, excluyendo comentarios, tests y
`backend/scripts`:

| Módulo | Línea |
|---|---:|
| `backend/lib/prisma.ts` — compartido | 16 |
| `backend/server.ts` | 284 |
| `backend/routes/hr.ts` | 9 |
| `backend/routes/loans.ts` | 24 |
| `backend/routes/serials.ts` | 20 |
| `backend/routes/warehouses.ts` | 19 |
| `backend/services/audit.ts` | 12 |
| `backend/services/depreciation.ts` | 16 |
| `backend/services/stripe.ts` | 11 |
| `backend/services/whatsapp/db.ts` | 6 |

`scoring.ts` ya usa el compartido; no repetir el conteo anterior de 11 ni el de
~21 de julio. Diez construcciones no son diez conexiones: cada cliente puede abrir
un pool. La demanda depende de procesos, módulos cargados, límites y consultas.
Consolidar gradualmente conservando logging y semántica transaccional; medir conexiones
abiertas/activas, espera y P2024/P2028. No fijar `connection_limit` arbitrario ni
consultar el cliente global dentro de una transacción que debe usar `tx`.

### A3 — Caché de permisos/suscripción

`backend/middleware/auth.ts:16` usa `NodeCache` con TTL de 300 segundos. La
invalidación local no comunica cambios a otra instancia. Probar suspensión,
reactivación y revocación entre procesos antes de habilitar réplicas. Un JWT válido
no sustituye la comprobación vigente de usuario, tenant y capacidad.

### A4 — Jobs en el proceso web

`backend/server.ts:14107–14118` programa suscripciones, depreciación y emails.
Depreciación tiene protección idempotente por cuota; eso no evita repetir lecturas
ni competir con ventas. El recorrido de tenants con activos comienza en
`backend/services/depreciation.ts:214`. Separar scheduler/worker o claims durables,
concurrencia acotada y recuperación. Caracterizar cada job; no afirmar duplicación
de cargos/emails por la sola presencia de `setInterval`.

### A5 — WhatsApp comercial y privado son transportes distintos

| Canal | Contrato observado | Pendiente |
|---|---|---|
| Comercial (`services/whatsapp/*`) | `webhook.ts:63` responde 200 antes de encolar; `queue.ts` usa RAM con concurrencia 2. `inbound.ts:103` envía antes de persistir salida/estado. | Persistir antes del ACK, claims/orden por conversación, outbox y tratamiento del envío incierto. Probar reinicios y duplicados concurrentes. |
| Privado (`services/assistant/privateWhatsapp/*`) | La ruta espera inbox persistido antes del 200; leases/orden en MySQL; `outbox.ts` pasa envíos interrumpidos a UNKNOWN y no los reenvía automáticamente. | Verificar workers reales, heartbeat, retención, reinicios, revocación y proveedor. Código/pruebas sintéticas no acreditan tráfico real. |

La unicidad de `waMessageId` por sí sola no conserva un trabajo que nunca se guardó
ni garantiza exactamente un envío externo. No migrar el privado a otra cola por
confundirlo con el comercial; evaluar necesidad con métricas.

## B — Carga y crecimiento aun con una sola instancia

### B1 — Índices y datos

`Sale`, `AuditLog`, `KardexMovement`, `Expense`, `Purchase`, `Payment` y
`StockTransfer` ya tienen índices compuestos en el schema. El trabajo pendiente es
validar consultas actuales y su plan en datos representativos, no volver a crear
la migración histórica como si faltara. Nuevas queries deben acompañarse de límites
e índices según filtros/orden; no usar una base vacía para acreditar rendimiento.

### B2 — Transacción de venta

En `salesService.ts:1035`, el correlativo se reclama **después** de validaciones y
normalización; la receta de moverlo desde el inicio ya está superada. Aún precede
al bucle por ítem (`:1079`) y conserva lock hasta commit. Ítems, stock, FEFO y Kardex
implican consultas secuenciales. Medir queries, espera de locks y p95/p99 para
5/20/50 líneas y varias cajas del mismo tenant antes de optimizar.

`recordSale` (`:1257`) y auditoría siguen en la misma transacción. Consolidar
lecturas/escrituras únicamente si preserva dinero, stock, lote, idempotencia y
rollback. No mover el asiento fuera de la transacción ni elevar timeouts como
sustituto de una medición.

### B3 — Reportes y XLSX

La extracción local creó `backend/routes/fiscalExports.ts` y redujo el servidor.
No convirtió la exportación en background: todavía hay `findMany` mensual sin
paginación (`:75`, `:150`) y `XLSX.write` síncrono (`:124`, `:219`). El límite temporal
del mes no limita su número de ventas. Falta medir heap/event-loop y cobros mientras
se exporta; después aislar generación pesada y paginar/stream según el contrato.
No declarar que congela todas las peticiones sin una reproducción de carga.

### B4 — Escrituras desde lecturas

`accounting.ts:1241` y `:1284` todavía invocan `seedChartOfAccounts` al preparar balance
y estado de resultados. El seed usa `createMany` idempotente, pero puede amplificar
trabajo en lecturas. Caracterizar reparación de cuentas faltantes y trasladarla a
un punto de escritura apropiado sin romper catálogos legacy ni agotar el pool.

### B5 — Agregaciones de plataforma

Las métricas administrativas pueden consultar varios tenants por autorización de
SUPER_ADMIN; eso no es en sí una brecha. Revisar volumen, selectividad, índices y
necesidad de rollups con mediciones actuales. Los números de líneas y conclusiones
de escaneos de julio no son evidencia de planes de ejecución de este candidato.

### B6 — Frontend

El POS tiene 5.924 líneas y módulos extraídos; Vite divide chunks. No conservar como
actual el bundle monolítico de 2,14 MB de julio. Medir artefacto del candidato y
recorrido real en móvil/equipo económico: carga inicial, lector, entrada de teclado,
carrito, reconexión y actualización PWA. Menos líneas no acredita menos renderizados
ni menor latencia, y el JavaScript del POS corre en el dispositivo, no en el Droplet.

## RAG y consumo

El catálogo comercial usa FULLTEXT MySQL parametrizado y filtrado por tenant en
`backend/services/whatsapp/rag.ts`. Si no hay resultados o falla FULLTEXT, usa
`contains` en nombre/categoría/SKU con `take:100` y ranking local. Ese límite acota
filas devueltas y ranking, **no las filas que MySQL examina** para `LIKE '%texto%'`.
No afirmar ausencia de scan ni búsqueda semántica/híbrida vectorial: medir `EXPLAIN`
y latencia, también cuando faltan índices o hay términos ambiguos.

NortexGPT interno recupera ayuda aprobada/versionada y opera con herramientas
cerradas. Su orquestador limita cuatro iteraciones y 60 segundos, con reservas de
presupuesto y permisos. La implementación no acredita calidad real de Haiku,
recuperación semántica ni capacidad ilimitada. La extracción de documentos y el
WhatsApp privado tienen workers separados en código; su despliegue y volumen
persistente deben comprobarse, no inferirse del repositorio.

## Orden de trabajo y criterios de cierre

1. D08/D09: backup real restaurable, SQL+originales, inventario de procesos y métricas
   de cola/latencia/recursos. Sin restore vigente no promover schema.
2. D06: consolidar pools por módulos pequeños; prueba de una conexión, concurrencia,
   callbacks/auditoría y medición de conexiones antes/después.
3. D10: aislar exportación pesada después de caracterizarla; mantener transacciones
   financieras completas y medir consultas/locks antes de optimizarlas.
4. Antes de réplicas: límites, caché, jobs y transporte comercial compartidos y
   probados ante caída. Redis/BullMQ son opciones, no pruebas de que el sistema escala.
5. Ejecutar la matriz sintética de 10/25/50/100 cajas del informe de capacidad en
   hardware equivalente. Son escenarios, no capacidades aprobadas. Conciliar cada
   escalón; registrar p95/p99, carga sostenida, margen y recuperación.

No se midieron aquí capacidad sostenible, EXPLAIN bajo volumen, locks de producción
ni recuperación real completa. Son pendientes verificables, no garantías ni incidentes
productivos demostrados.
