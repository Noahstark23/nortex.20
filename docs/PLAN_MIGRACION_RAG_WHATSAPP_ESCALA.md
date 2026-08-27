# Plan de migración: backups, WhatsApp/RAG y escala de Nortex

**Estado:** aprobado para ejecución por fases

**Fecha:** 2026-08-27

**Decisión rectora:** [ADR de backups y escalabilidad](architecture/ADR-2026-08-27-backups-rag-scaling.md)

**Complementa:** [auditoría de escalado](SCALING_AUDIT.md),
[plan de desacople](PLAN_DESACOPLE_ESCALABILIDAD.md) e
[infraestructura WhatsApp](WHATSAPP_INFRA.md)

## Resultado esperado

Al terminar este plan, Nortex tendrá:

- backups diarios de MySQL fuera del Droplet y restauraciones ensayadas;
- una compuerta de release que no promueve schema sin respaldo reciente;
- un monolito modular capaz de ejecutar más de una instancia web;
- recepción WhatsApp durable, workers independientes y reintentos idempotentes;
- un outbox para efectos externos, sin llamadas remotas dentro de transacciones;
- RAG semántico tenant-scoped para documentos, solo cuando supere a FULLTEXT;
- una ruta ensayada hacia Managed MySQL sin perder atomicidad ni portabilidad.

El plan no autoriza un “big bang”. Cada fase es aditiva, desplegable y reversible
sin borrar schema ni datos históricos.

## Estado de partida

| Área | Estado real | Riesgo |
|---|---|---|
| Base transaccional | MySQL 8 en el mismo stack del Droplet | servidor y volumen son un solo dominio de falla |
| Backup | scripts, servicio y smoke de CI existen | falta destino off-site y restore de producción probado |
| Deploy de schema | preflight + db push aditivo | no debe promoverse sin backup reciente |
| Aplicación | un proceso Express | no está habilitada para escala horizontal |
| Prisma | singleton iniciado, módulos legacy pendientes | demasiados pools al multiplicar procesos |
| Rate limit/caché/crons | estado local al proceso | comportamiento distinto o duplicado con N instancias |
| WhatsApp | HMAC, tenant routing y dedupe parcial correctos | cola en memoria y ventana de pérdida antes de persistir |
| RAG | MySQL FULLTEXT + fallback, tenant-scoped | no cubre bien conocimiento semántico o sinónimos |
| Herramientas LLM | ToolContext server-side | la herramienta B2B exige identidad fuerte antes de ampliarse |

## Invariantes que ninguna fase puede romper

1. tenantId se deriva del JWT o del canal WhatsApp resuelto en servidor. Nunca se
   acepta del prompt, body, query, metadata de un documento o job.
2. MySQL sigue siendo la única fuente de verdad para dinero, stock, clientes,
   ventas, deuda, caja, auditoría y contabilidad.
3. Toda mutación de dinero o inventario conserva Decimal, applyStockDelta y
   auditoría atómica en la misma transacción.
4. El LLM no escribe tablas ni construye SQL. Invoca comandos y consultas con
   schemas Zod, permisos e idempotencia.
5. No hay llamadas a Meta, al modelo, email, S3 o Redis dentro de una transacción
   financiera.
6. Los schemas son aditivos. No se usa accept-data-loss.
7. Los secretos permanecen en DigitalOcean/Coolify o en su gestor autorizado.
   No aparecen en archivos, comandos compartidos, logs, capturas ni tickets.
8. Backups y documentos RAG usan buckets, llaves y retenciones separados.
9. Todo consumidor asíncrono tolera entrega repetida.
10. Ningún recurso productivo se destruye como parte de un rollback automático.

## Mapa de fases

| Fase | Entrega | Trigger de inicio | Gate de salida |
|---|---|---|---|
| 0 | Space privado + primer backup + restore drill | inmediata | backup off-site restaurable y evidencia aprobada |
| 1 | operación continua de recuperación | fase 0 | 30 días sin backup vencido y un drill mensual |
| 2 | monolito modular listo para N procesos | antes de instancia web #2 | pools, rate limits, cachés y crons compartidos/controlados |
| 3 | worker WhatsApp + inbox/outbox + BullMQ | antes de piloto de volumen o instancia #2 | caos/reintentos sin pérdida ni cruce de tenant |
| 4 | RAG semántico con pgvector | evaluación FULLTEXT no alcanza calidad | canary supera baseline y rollback por bandera |
| 5 | Managed MySQL | se activa un umbral de BD/RPO/RTO | cutover ensayado, TLS, PITR y rollback validado |
| 6 | extracción selectiva de servicios | límites modulares estables | beneficio medido sin transacción distribuida |

---

## Fase 0 — Resolver el backup productivo ahora

### 0.1 Preflight de control

Antes de crear recursos:

- confirmar mediante el conector autorizado de DigitalOcean la cuenta/equipo y
  proyecto correctos;
- inventariar Spaces existentes para no duplicar un bucket;
- identificar la región del Droplet y elegir conscientemente la región del
  backup: otra región mejora aislamiento regional; la misma región reduce
  transferencia y latencia;
- comprobar que el nombre elegido no contiene datos de clientes;
- registrar precio vigente y límite incluido desde la documentación oficial;
- no solicitar ni mostrar tokens o llaves en la conversación.

Nombre recomendado: nortex-prod-db-backups seguido por un sufijo no sensible si
el nombre global ya está ocupado.

### 0.2 Crear y endurecer el Space

Usar el MCP de DigitalOcean si expone cada operación. Si una operación sensible
no está disponible, completarla en el panel de DigitalOcean sin copiar el secreto
al chat.

Configuración requerida:

- bucket privado; acceso público y CDN deshabilitados;
- versionado habilitado;
- una llave runtime limitada únicamente al bucket con el permiso mínimo que
  permita escribir y actualizar last-backup.json;
- una identidad de restauración separada con lectura;
- una identidad administrativa solo para versionado/ciclo de vida; no instalarla
  en la aplicación;
- cifrado de transporte HTTPS;
- ciclo de vida inicial: 90 días para dumps diarios y 30 días para versiones no
  actuales, después de medir el tamaño real;
- abortar multipart incompletos al día;
- alerta de capacidad al 70 % del almacenamiento presupuestado.

Durante los primeros 30 días no se reducirá retención. Antes de eliminar backups
antiguos se confirmará que existe al menos un drill exitoso y que la retención
cumple la política fiscal/operativa vigente.

### 0.3 Conectar el servicio backup en Coolify

Configurar como secretos o variables protegidas, según corresponda:

| Nombre | Tratamiento |
|---|---|
| BACKUP_S3_BUCKET | URI del bucket/prefijo, no pública |
| BACKUP_S3_ENDPOINT | endpoint regional S3 compatible |
| AWS_DEFAULT_REGION | región del Space |
| AWS_ACCESS_KEY_ID | secreto, llave runtime limitada |
| AWS_SECRET_ACCESS_KEY | secreto, nunca visible después de guardar |
| BACKUP_ALERT_WEBHOOK | secreto opcional para alertas |
| BACKUP_KEEP_DAYS | 7 para la copia local de mano |
| BACKUP_HOUR / BACKUP_MINUTE | 03 / 15, America/Managua |

No se modifica DATABASE_URL para esta fase. El servicio backup existente usa la
red interna del compose y debe seguir aislado de Internet.

La configuración está incompleta si el contenedor backup está “running” pero no
puede escribir en el Space. La señal válida es un objeto verificado más el
heartbeat remoto, no solo el estado del contenedor.

### 0.4 Crear el primer backup bajo control

1. Mantener producción en el commit actual.
2. Iniciar o redesplegar únicamente el servicio backup con las variables ya
   guardadas.
3. Ejecutar una corrida manual de
   [scripts/backup-db.sh](../scripts/backup-db.sh) dentro de la red del stack.
4. Confirmar salida exitosa sin imprimir DATABASE_URL ni credenciales.
5. Verificar en el Space:
   - existe el dump en el prefijo de año/mes;
   - existe last-backup.json;
   - verificado es true;
   - bytes y número de tablas son mayores que sus mínimos;
   - el SHA-256 coincide con el archivo descargado para el drill;
   - el timestamp tiene menos de cuatro horas para un deploy de schema.
6. Registrar solo metadata no sensible: timestamp UTC, nombre del objeto, bytes,
   SHA-256, número de tablas, duración y resultado.

Si cualquiera de esas comprobaciones falla, el release continúa bloqueado.

### 0.5 Primer restore drill

El primer drill usa MySQL 8 desechable y aislado. Nunca usa producción como
destino.

1. Programar una ventana breve sin escrituras si se desea comparar conteos
   exactos con el origen. Sin congelar escrituras, no comparar el dump contra la
   base viva porque ventas posteriores producirían falsos diferenciales.
2. Crear una base temporal cuyo nombre incluya restore, test, tmp o scratch. El
   guard de [scripts/verify-backup-restore.sh](../scripts/verify-backup-restore.sh)
   debe permanecer activo.
3. Descargar el objeto mediante la identidad de restauración.
4. Ejecutar el verificador con RESTORE_DATABASE_URL guardada fuera del shell
   history. Usar SOURCE_DATABASE_URL solo durante una ventana sin escrituras.
5. Verificar además:
   - tablas Tenant, User, Product, Sale, SaleItem, InvoiceSeries y AuditLog;
   - conteos y relaciones críticas;
   - al menos una venta controlada conserva total, ítems y asiento;
   - no se accede desde la aplicación productiva a la base de restore;
   - duración total menor o igual al RTO inicial de cuatro horas.
6. Guardar el acta sin filas, nombres, teléfonos, documentos ni montos reales.
7. Eliminar únicamente la base desechable después de aprobar el acta. Conservar
   el dump y su evidencia.

### 0.6 Gate de release

Un deploy con cambio de schema puede avanzar solo si:

- el último backup off-site verificado tiene menos de cuatro horas;
- el heartbeat no está vencido;
- existe un restore drill exitoso de los últimos 30 días;
- schema preflight, CI y seguridad están verdes;
- existe commit exacto y rollback identificado.

Para el primer despliegue después de este plan, las condiciones anteriores
aplican a la PR 184. Si el backup no pasa, no se hace merge: el merge a main
puede activar promoción automática.

### Rollback de fase 0

- Si la integración falla, retirar las variables nuevas del servicio backup y
  dejar la aplicación en su versión actual.
- No borrar el Space ni las versiones durante el diagnóstico.
- Rotar la llave si pudo aparecer en un log o terminal.
- No desactivar el backup actual hasta tener un destino alternativo verificado.

### Definition of done

- [ ] Bucket privado creado en el equipo/proyecto correcto.
- [ ] Versionado y lifecycle comprobados.
- [ ] Llave runtime limitada; llave de restore separada.
- [ ] Backup manual real subido y heartbeat remoto fresco.
- [ ] Restore drill real aprobado dentro del RTO.
- [ ] Scheduler diario activo y alerta probada.
- [ ] Evidencia de release almacenada sin datos de negocio.

---

## Fase 1 — Convertir el backup en una capacidad operativa

### Controles recurrentes

- Monitor cada 15 minutos de la edad de last-backup.json.
- Alerta crítica cuando la edad llegue a 26 horas.
- Alerta preventiva a las 22 horas.
- Alerta por tamaño anómalo: variación negativa mayor de 30 % contra la mediana
  de siete backups, salvo cambio de datos explicado.
- Alerta si disminuye el número de tablas críticas.
- Drill lógico mensual con el último dump.
- Drill trimestral desde otra máquina/red para comprobar que no depende del
  Droplet.
- Revisión trimestral de accesos y rotación planificada de llaves.
- Informe mensual de RPO observado, tiempo de restauración y costo.

### Política 3-2-1 progresiva

Fase 0 entrega dos copias en dos medios: MySQL/volumen y Space. Cuando ocurra uno
de los siguientes triggers, agregar una tercera copia en otra cuenta, región o
proveedor:

- el negocio exige recuperación ante pérdida de cuenta/región;
- un incidente de credenciales afecta al Droplet y al Space;
- RTO/RPO pasa a ser contractual;
- el tamaño/costo aconseja una clase de archivo distinta;
- Managed MySQL entra en producción.

Managed MySQL no reemplaza la copia portable. Después de esa migración, conservar
un dump lógico periódico en Spaces y ensayar su importación.

### Rollback de fase 1

Un monitor o alerta puede deshabilitarse si genera falsos positivos, pero el
scheduler de backup no se desactiva. Primero se deja un monitor sustituto activo,
después se retira el anterior.

---

## Fase 2 — Preparar el monolito modular para escalar

Esta fase implementa las dependencias del
[plan de desacople existente](PLAN_DESACOPLE_ESCALABILIDAD.md) sin mover el core
financiero a otro servicio.

### 2.1 Un solo Prisma y presupuesto de conexiones

Ejecutar en PRs pequeños por dominio:

1. Migrar módulos runtime a backend/lib/prisma.ts.
2. Permitir clientes independientes solo en scripts de administración que
   terminan explícitamente.
3. Fijar connection_limit y pool_timeout según el máximo de conexiones real.
4. Reservar conexiones para migración, backup y operación.
5. Definir el presupuesto:

       conexiones por proceso × procesos web
     + conexiones por worker × workers
     + reserva de operación
     < 70 % de max_connections

Gate:

- la búsqueda de new PrismaClient no encuentra consumidores runtime fuera del
  singleton;
- una prueba de carga no produce P2024/P2028;
- las transacciones calientes tienen timeout/maxWait explícitos y medidos;
- p95 y p99 de venta no regresan.

### 2.2 Separar schema deploy del arranque web

Antes de N instancias:

- ejecutar preflight y db push una sola vez como release job;
- protegerlo con exclusión mutua por release;
- arrancar contenedores web solo después del gate;
- usar un usuario de migración distinto del usuario de aplicación;
- mantener el deploy aditivo y sin accept-data-loss.

Así dos contenedores no compiten por DDL al arrancar.

### 2.3 Redis/Valkey para estado compartido

Adoptar una instancia administrada restringida por VPC/trusted sources:

- rate-limit-redis para límites globales y sensibles;
- caché de paywall compartido con invalidación;
- BullMQ para trabajos;
- locks de cron o, preferentemente, scheduler/worker único.

Durante el canary de una sola instancia puede existir fallback a memoria para
tráfico no sensible. Con N instancias:

- los limiters de login/PIN fallan de forma cerrada o degradan a un límite local
  más estricto;
- la cola WhatsApp nunca vuelve a memoria como única fuente;
- los crons no se ejecutan en cada web.

### 2.4 Límites del monolito

Organizar el código por módulos internos:

- identity/tenancy;
- customers/receivables;
- catalog/inventory;
- sales/POS;
- cash/accounting/fiscal;
- WhatsApp gateway/agent;
- reporting/exports.

Cada módulo publica comandos y consultas. Los routers no escriben directamente
tablas de otro dominio. Las reglas de dinero permanecen en servicios de dominio.

### QA obligatoria

- mise exec -- npm run release:preflight;
- pruebas de tenant cruzado por módulo migrado;
- prueba de conexiones con dos web y dos workers;
- prueba de que cada cron se ejecuta una sola vez;
- falla de Valkey: POS sigue vendiendo, seguridad sensible no se abre;
- mutación cuando cambie lógica de dinero;
- métricas de pool, latencia y errores antes/después.

### Rollback de fase 2

- Mantener imports y schemas compatibles durante un release.
- Reducir réplicas a una si se supera el pool.
- Desactivar el consumidor/scheduler nuevo, no borrar sus tablas.
- Volver al job de schema anterior solo con una instancia y después de comprobar
  que no se ejecutará DDL concurrente.

---

## Fase 3 — WhatsApp durable y aislado del POS

### Flujo objetivo

1. Meta envía el webhook.
2. El proceso web verifica HMAC sobre los bytes crudos.
3. Resuelve phone_number_id a un canal activo y a tenantId server-side.
4. Inserta InboxEvent con clave única de proveedor/mensaje.
5. Responde 200 solo después de persistir.
6. El dispatcher publica un job con jobId igual al inboxId.
7. El worker resuelve identidad, llama herramientas/RAG/LLM y prepara la salida.
8. La intención saliente se persiste en OutboxEvent.
9. El sender entrega a Meta, registra waMessageId y reconcilia resultados
   inciertos.

### PR 3A — Schema aditivo

Agregar modelos equivalentes a:

**InboxEvent**

- id, tenantId, provider, externalId, channelId;
- eventType, schemaVersion y payload mínimo validado;
- status, attempts, availableAt, lockedAt, lockedBy, lastErrorCode;
- receivedAt, processedAt, createdAt, updatedAt;
- unique por provider + externalId;
- índices por tenantId/status/availableAt y lockedAt.

**OutboxEvent**

- id, tenantId, aggregateType, aggregateId, eventType, schemaVersion;
- idempotencyKey, payload mínimo, status, attempts, availableAt;
- lockedAt, lockedBy, deliveredAt, lastErrorCode, createdAt;
- unique por tenantId + idempotencyKey;
- índices por status/availableAt y tenantId/createdAt.

No guardar tokens, prompts de sistema ni el payload bruto completo de Meta. Los
errores se clasifican por código; no se vuelcan respuestas con PII.

### PR 3B — Webhook persist-first

- Mantener express.raw antes de express.json.
- Verificar firma antes de parsear.
- Resolver el tenant por canal; nunca por texto o metadata controlada por usuario.
- Insertar inbox con dedupe.
- Si es duplicado ya persistido, devolver 200.
- Si MySQL falla antes de persistir, devolver 5xx para provocar reintento.
- Registrar métricas sin teléfonos ni contenido.

### PR 3C — Dispatcher y worker

- Crear un proceso worker separado del web.
- Usar BullMQ con Valkey/Redis administrado.
- Publicar lotes acotados desde inbox/outbox con lease y recuperación de locks
  vencidos.
- Usar jobId estable.
- Configurar backoff con jitter, máximo de intentos y dead-letter queue.
- Limitar concurrencia por tenant para evitar que uno consuma toda la capacidad.
- Aplicar timeout/circuit breaker al LLM y Meta.
- Mantener el POS independiente: saturar WhatsApp no debe consumir el pool
  reservado para ventas.

### PR 3D — Outbox saliente y estados inciertos

Una llamada externa no puede compartir commit con MySQL. Por eso:

- persistir la respuesta propuesta antes de enviar;
- reclamar un evento con lease;
- enviar una vez por intento;
- guardar el id remoto cuando Meta responde;
- si hay timeout después de enviar, marcar UNKNOWN y reconciliar antes de
  reenviar;
- no hacer retry ciego de UNKNOWN;
- un operador puede resolver DLQ con evidencia.

Las mutaciones futuras por WhatsApp escriben el resultado financiero, AuditLog y
OutboxEvent en la misma transacción. El worker nunca recalcula dinero desde texto
del modelo.

### PR 3E — Identidad fuerte para B2B y escrituras

Antes de exponer ventas_hoy u otras métricas sensibles a escala:

- vincular el waId a un User del mismo tenant mediante un desafío iniciado desde
  una sesión web autenticada o un código de un solo uso;
- guardar solo hash, expiración, intentos y revocación del desafío;
- aplicar rate limit compartido;
- derivar roles en servidor en cada comando;
- revocar vínculo al cambiar equipo, número o rol.

Primera etapa: herramientas de lectura. Las escrituras requieren confirmación
explícita, resumen determinista, idempotencyKey y permiso del rol. Operaciones de
alto riesgo pueden exigir aprobación en el POS/web.

### Canary

1. Desplegar schema sin consumidores.
2. Activar persistencia inbox para un tenant piloto conservando el procesador
   actual.
3. Ejecutar worker en shadow sin enviar mensajes.
4. Comparar decisiones/salidas y latencia.
5. Activar sender nuevo para el tenant piloto.
6. Expandir 5 %, 25 %, 50 % y 100 % si los SLO pasan durante 24 horas por etapa.

### Matriz de fallas

| Escenario | Resultado esperado |
|---|---|
| webhook duplicado | una fila inbox y una respuesta lógica |
| crash después de persistir | job recuperado |
| crash después del LLM | respuesta propuesta reutilizada o regeneración controlada |
| timeout de Meta tras enviar | estado UNKNOWN; sin retry ciego |
| Valkey caído | inbox crece; webhook persiste; dispatcher reanuda |
| MySQL caído | webhook devuelve 5xx; Meta reintenta |
| LLM caído | fallback determinístico/handoff; POS intacto |
| tenant A intenta consultar B | cero filas y evento de seguridad |
| job repetido | consumidor idempotente, sin doble dinero/stock |
| backlog de un tenant | fairness; otros tenants avanzan |

### SLO de WhatsApp

| Indicador | Objetivo |
|---|---|
| persistencia + ack del webhook | p95 menor de 1 s; 99.9 % válido |
| pérdida de mensajes persistidos | 0 |
| cruce de tenant | 0 |
| inicio de job | p95 menor de 30 s inicialmente |
| respuesta completa | p95 menor de 30 s; p99 menor de 60 s |
| DLQ sin atender | 0 por más de 15 min en horario operativo |
| duplicado visible | menor de 0.1 %, con objetivo 0 |

### Rollback de fase 3

- Apagar el sender/consumer mediante feature flag.
- Mantener webhook e inbox activos para no perder mensajes.
- Los eventos pendientes permanecen en MySQL.
- Usar un poller de degradación que lea inbox; no volver a InMemoryQueue como
  única fuente.
- No borrar jobs, inbox, outbox ni receipts durante rollback.
- Si el envío remoto quedó UNKNOWN, reconciliar manualmente antes de reprocesar.

---

## Fase 4 — RAG semántico con PostgreSQL/pgvector

### 4.1 Gate de necesidad

No provisionar pgvector solo porque está disponible. Primero construir un set de
evaluación con al menos:

- 50 consultas por vertical inicial;
- lenguaje nicaragüense, errores ortográficos, sinónimos y preguntas ambiguas;
- consultas negativas y ataques de prompt injection;
- dos o más tenants con documentos que jamás deben cruzarse.

Mantener FULLTEXT si logra:

- recall@5 mayor o igual a 85 %;
- respuesta útil mayor o igual a 85 %;
- tasa de “no encontré” menor o igual a 15 %;
- latencia p95 menor de 300 ms.

Activar la fase cuando FULLTEXT incumpla calidad durante dos evaluaciones o el
producto incorpore manuales, políticas, fichas técnicas y documentos extensos.

### 4.2 Datos y almacenamiento

Crear un bucket privado separado para documentos RAG. No reutilizar el bucket de
backups ni sus llaves.

Modelo lógico de knowledge_chunks:

- tenant_id obligatorio;
- document_id, chunk_id y chunk_index;
- content sanitizado;
- checksum y source_version;
- embedding y embedding_model_version;
- visibility/ACL;
- source_uri interna, created_at, updated_at y deleted_at.

Índices:

- unique por tenant_id/document_id/chunk_index/source_version;
- tenant_id + visibility;
- índice vectorial elegido después de medir tamaño/recall.

Los cambios de documento viajan por outbox. La ingesta valida tipo/tamaño,
analiza contenido, elimina macros, normaliza, trocea, genera embeddings y hace
upsert idempotente. Un delete de negocio produce tombstone; no deja chunks
huérfanos.

### 4.3 Seguridad y privacidad

- tenant_id se inyecta desde ToolContext, nunca desde argumentos del modelo.
- La consulta filtra tenant antes del ranking vectorial.
- Usuario y conexión de PostgreSQL con privilegios mínimos y TLS.
- Row Level Security como defensa adicional si el pool garantiza contexto por
  transacción sin fuga entre tenants.
- No indexar conversaciones completas, números, cédulas, tokens, deuda o
  movimientos financieros.
- Aplicar el plan FLE/blind-index de PII antes de ampliar retención de WhatsApp.
- Registrar IDs de fuentes y scores, no texto sensible en logs.

### 4.4 Separar conocimiento de hechos vivos

| Pregunta | Fuente |
|---|---|
| “¿Cómo uso la balanza?” | pgvector/documentación |
| “¿Qué política de devolución tiene la tienda?” | pgvector del tenant |
| “¿Cuánto debo?” | herramienta MySQL tenant/customer-scoped |
| “¿Hay pollo disponible y a qué precio?” | MySQL en tiempo real |
| “¿Cuánto vendimos hoy?” | herramienta MySQL con identidad B2B |

Para catálogo semántico, pgvector devuelve IDs candidatos; el precio, unidad y
stock se rehidratan siempre desde MySQL antes de responder.

### 4.5 Lanzamiento

1. Indexar un corpus sin tráfico.
2. Ejecutar la evaluación y guardar métricas por versión.
3. Shadow query contra FULLTEXT y vector.
4. Habilitar por tenant y porcentaje.
5. Mantener fallback FULLTEXT.
6. Promover solo si mejora al menos cinco puntos la respuesta útil sin empeorar
   el p95 acordado ni producir un cruce de tenant.

### Rollback de fase 4

Desactivar el retriever vectorial por bandera y volver a FULLTEXT. No borrar
PostgreSQL ni documentos hasta completar análisis. Como pgvector nunca es la
fuente financiera, el rollback no requiere reconciliar dinero ni stock.

---

## Fase 5 — Migrar a DigitalOcean Managed MySQL

### 5.1 Triggers

Iniciar la migración cuando ocurra cualquiera:

- el negocio requiere RPO menor de 24 horas o RTO menor de cuatro horas;
- se habilitará una segunda instancia de aplicación de forma sostenida;
- restaurar el dump ya supera cuatro horas;
- CPU supera 60 % durante 15 minutos en tres días distintos;
- almacenamiento o conexiones superan 70 % de capacidad;
- p95 de transacción de venta incumple el SLO por base/IO;
- dos incidentes de BD/host en un trimestre;
- la operación no puede seguir manteniendo parches, failover y binlogs.

Un trigger abre la fase; no omite sus prerrequisitos.

### 5.2 Prerrequisitos

- fase 0 y dos restore drills exitosos;
- singleton Prisma y presupuesto de pool;
- schema deploy como job único;
- target de MySQL certificado contra Prisma 6.4.1 y el preflight;
- staging con copia anonimizada o sintética representativa;
- inventario de extensiones, collations, FULLTEXT, triggers, routines y events;
- plan de DNS/secret/rollout y dueño de la decisión de cutover;
- backup fresco en Spaces antes de migrar.

### 5.3 Provisionamiento

Mediante el MCP autorizado:

- crear Managed MySQL en la misma región/VPC que la aplicación cuando sea
  posible;
- habilitar TLS y trusted sources; no acceso universal;
- crear base y usuarios separados para app, migración y observación;
- configurar alertas de CPU, disco, conexiones y replicación;
- confirmar backup administrado y PITR;
- guardar IDs del recurso, no credenciales, en el acta.

La aplicación usa el endpoint privado. Si una migración online exige que el
origen sea alcanzable, permitir únicamente el origen/destino exactos, con TLS y
una cuenta temporal de migración. Revocar acceso al terminar. Si eso no puede
hacerse sin publicar la BD, usar dump/restore en mantenimiento.

### 5.4 Ensayo en staging

1. Restaurar un dump reciente.
2. Ejecutar Prisma generate/validate y schema preflight.
3. Comparar tablas, filas y checksums por lotes.
4. Validar collations y búsqueda FULLTEXT.
5. Ejecutar flujos:
   - login y aislamiento;
   - venta/cancelación controlada;
   - stock/Kardex;
   - pago/cobranza;
   - asiento balanceado;
   - backup desde el destino.
6. Medir importación, catch-up y smokes.
7. Ensayar abort antes de abrir escrituras.

### 5.5 Cutover productivo

1. Anunciar ventana y congelar escrituras.
2. Drenar workers, inbox/outbox y crons.
3. Crear backup off-site fresco y comprobar SHA.
4. Completar réplica o importación.
5. Comparar conteos y invariantes con la fuente quieta.
6. Ejecutar schema release job una sola vez.
7. Cambiar DATABASE_URL en el gestor de secretos; nunca en Git.
8. Desplegar una sola instancia con tráfico cerrado.
9. Comprobar api/health, commit y db=up.
10. Ejecutar smokes en un tenant sintético/controlado.
11. Abrir lecturas y luego escrituras gradualmente.
12. Observar al menos una hora antes de aumentar réplicas.
13. Mantener la base anterior apagada para escritura, aislada y recuperable
    durante la ventana acordada.

### Validaciones financieras

- suma de débitos igual a créditos;
- ninguna venta/pago/evento idempotente duplicado;
- stock agregado coincide con movimientos;
- consecutivos de factura no retroceden ni se repiten;
- tenant A no lee ni modifica B;
- último AuditLog y último outbox presentes;
- RPO/PITR y backup lógico posterior comprobados.

### Rollback de fase 5

**Antes de abrir escrituras en el destino:** cerrar tráfico, volver al secreto del
origen, desplegar commit anterior y reabrir solo después de health/smokes.

**Después de abrir escrituras en el destino:** el origen quedó atrasado. No se
permite apuntar la app hacia él. El rollback es recuperación hacia adelante:
detener escrituras, exportar/replicar los cambios del destino, restaurar a un
destino nuevo o aplicar PITR, validar invariantes y recién entonces reabrir.

No destruir el origen ni el cluster nuevo hasta cerrar la ventana de
estabilización y conservar dos backups restaurables.

### Definition of done

- [ ] App conecta por TLS y fuente confiable.
- [ ] Pool bajo presupuesto con carga.
- [ ] PITR probado dentro del RPO/RTO.
- [ ] Dump portable en Spaces restaurado.
- [ ] Invariantes financieras aprobadas.
- [ ] Base anterior sin escrituras y con fecha explícita de retiro.
- [ ] Runbook y responsables actualizados.

---

## Fase 6 — Cuándo separar servicios

El primer proceso separado es el worker WhatsApp, pero sigue compartiendo
repositorio, contratos y MySQL mediante límites claros.

Un módulo puede convertirse en servicio independiente solo si cumple todos:

- necesita escalar o desplegarse al menos cinco veces distinto del web;
- tiene SLO y patrón de falla propios;
- su API/eventos están versionados y observados;
- no escribe tablas propiedad de otro dominio;
- no necesita una transacción distribuida;
- tiene idempotencia, outbox y reconciliación;
- hay capacidad real para operarlo 24/7;
- una prueba demuestra mejora de costo, latencia o aislamiento.

Candidatos naturales:

1. WhatsApp/LLM worker.
2. ingesta y retrieval documental.
3. exports XLSX/PDF pesados.
4. notificaciones.

Ventas, stock, caja y contabilidad no son candidatos iniciales porque comparten
invariantes y transacciones.

---

## Secuencia de PRs

| PR | Alcance | Depende de | Riesgo |
|---|---|---|---|
| R0 | evidencia/runbook de Space y restore | ninguno | bajo |
| R1 | monitor de heartbeat y alertas | R0 | bajo |
| M1..Mn | singleton Prisma por dominio | R0 | medio |
| M-schema | release job único de schema | M1 | alto |
| M-cache | Valkey, rate limit y caché | M1 | medio |
| W1 | InboxEvent/OutboxEvent aditivos | M1 | medio |
| W2 | webhook persist-first | W1 | medio/alto |
| W3 | dispatcher + worker BullMQ shadow | W2, M-cache | alto |
| W4 | sender/outbox/reconciliación | W3 | alto |
| W5 | identidad B2B fuerte | W4 | alto |
| V1 | evaluación y adapter vectorial | W3 | bajo |
| V2 | pgvector + ingesta shadow | V1 | medio |
| DB1 | ensayo Managed MySQL | M-schema, R1 | alto |
| DB2 | cutover productivo | DB1 | máximo |

Cada PR parte de main actualizado, es draft, no mezcla fases y documenta QA.
Los cambios de dinero activan mutación. Los cambios de schema pasan el smoke de
upgrade y nunca usan accept-data-loss.

## Observabilidad mínima

### Base y backup

- edad, tamaño, SHA y tablas del último backup;
- duración de dump y restore;
- CPU, memoria, disco, conexiones y slow queries;
- lock waits, deadlocks, P2024/P2028;
- RPO/RTO observado.

### Inbox/outbox/worker

- accepted, duplicate, pending, processing, delivered, failed y unknown;
- edad del job más viejo por tenant;
- intentos, leases vencidos y DLQ;
- latencia webhook → inicio → respuesta;
- consumo LLM por tenant sin registrar prompts sensibles;
- circuit breaker de Meta/LLM.

### RAG

- recall@k, MRR o nDCG del set versionado;
- respuesta útil/grounded y “no encontré”;
- latencia de embedding/retrieval;
- frescura del índice;
- cero resultados cross-tenant;
- versión de corpus, chunker y embedding.

## Evidencia y responsabilidades

| Responsabilidad | Evidencia |
|---|---|
| Operaciones | recurso, región, políticas, timestamp y restore drill |
| Ingeniería | PR, commit, CI, tests de aislamiento, carga y rollback |
| Seguridad | acceso mínimo, rotación, PII, ataques cross-tenant |
| Producto | set de evaluación RAG y definición de respuesta útil |
| Dirección | RPO/RTO aceptados, costo y trigger de Managed MySQL |

La evidencia puede vivir en docs/releases, pero contiene únicamente metadata.
No se adjuntan dumps, variables, filas, números de teléfono, tokens ni capturas
de consolas con secretos.

## Checklist ejecutivo inmediato

- [ ] Crear Space privado con la cuenta autorizada.
- [ ] Habilitar versionado y acceso mínimo.
- [ ] Configurar el servicio backup en Coolify.
- [ ] Generar un backup real sin desplegar schema nuevo.
- [ ] Restaurarlo en MySQL 8 desechable.
- [ ] Aprobar evidencia RPO/RTO.
- [ ] Verificar que el scheduler y la alerta funcionan.
- [ ] Solo entonces promover la PR 184.
- [ ] Abrir R1 y M1 como siguientes PRs.

## Criterio de éxito del programa

El programa termina cuando una pérdida simulada del Droplet se recupera dentro
del RTO, un reinicio durante cada punto crítico de WhatsApp no pierde ni duplica
efectos, las consultas RAG nunca cruzan tenants y la aplicación puede ejecutar
dos instancias sin multiplicar límites, crons o pools. Hasta entonces, cada
capacidad se declara por su fase y no como cumplimiento global.

✓ Security & Integrity Loop superado para el plan de migración documentado.
