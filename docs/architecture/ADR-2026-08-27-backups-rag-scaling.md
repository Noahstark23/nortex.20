# ADR-2026-08-27: Backups off-site y evolución del monolito para WhatsApp/RAG

**Estado:** Aceptado

**Fecha:** 2026-08-27

**Decisores:** Dirección de Nortex e Ingeniería

**Alcance:** producción, persistencia, despliegue y canal WhatsApp/RAG

**Documento operativo:** [PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md](../PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md)

## Resumen de la decisión

Nortex seguirá siendo un **monolito modular transaccional** para ventas, inventario,
caja, cobranza, contabilidad y fiscalidad. No se dividirá ese núcleo en
microservicios mientras comparta transacciones y un equipo de operación.

La evolución será incremental:

1. **Ahora:** respaldar MySQL diariamente en un Space privado, separado del
   Droplet, y demostrar una restauración real antes de desplegar cambios de
   schema.
2. **Antes de una segunda instancia web:** eliminar los bloqueos de estado local:
   cliente Prisma único, límites y cachés compartidos, y WhatsApp fuera de la
   cola en memoria.
3. **WhatsApp:** separar el proceso web del worker, con inbox/outbox durable en
   MySQL y BullMQ sobre Redis/Valkey como mecanismo de entrega.
4. **RAG semántico, cuando la calidad lo justifique:** usar PostgreSQL con
   pgvector para conocimiento no transaccional. Los saldos, precios y existencias
   seguirán leyéndose de MySQL mediante herramientas deterministas.
5. **Después, cuando se active un umbral operativo:** migrar el MySQL
   autogestionado a Managed MySQL con TLS, red restringida, backups administrados
   y recuperación a un punto en el tiempo. Se conservarán dumps portables
   independientes en Spaces.

Esta decisión reduce el riesgo inmediato sin crear transacciones distribuidas ni
obligar a operar varios servicios antes de que Nortex los necesite.

## Contexto verificado

Nortex maneja dinero e inventario reales sobre React/Vite, Express, Prisma 6.4.1 y
MySQL 8. El tenant confiable proviene del JWT autenticado. Las operaciones de
dinero e inventario deben permanecer atómicas, auditadas y aisladas por tenant.

El repositorio ya contiene la mayor parte del mecanismo de respaldo:

- [scripts/backup-db.sh](../../scripts/backup-db.sh) genera un dump consistente
  con mysqldump, lo comprime, valida tablas y cierre, calcula SHA-256, lo sube a un
  destino S3 compatible y escribe last-backup.json.
- [scripts/backup-scheduler.sh](../../scripts/backup-scheduler.sh) programa el
  backup diario a las 03:15 de Managua y considera atrasado un respaldo con 26
  horas o más.
- [scripts/verify-backup-restore.sh](../../scripts/verify-backup-restore.sh)
  restaura únicamente en una base cuyo nombre parezca desechable y compara tablas
  y conteos.
- [docker-compose.yml](../../docker-compose.yml) ya define un servicio backup,
  pero un volumen en el mismo Droplet no protege contra la pérdida del servidor.

El bloqueo actual no es de código: falta un destino off-site configurado y una
restauración de producción demostrada.

La revisión de escalabilidad documentada en
[SCALING_AUDIT.md](../SCALING_AUDIT.md) y
[PLAN_DESACOPLE_ESCALABILIDAD.md](../PLAN_DESACOPLE_ESCALABILIDAD.md) confirma
que producción funciona como un solo proceso:

- los rate limiters y el caché de paywall viven en memoria;
- todavía existen varios clientes Prisma y pools independientes;
- la cola WhatsApp es InMemoryQueue, con concurrencia dos;
- los crons nacen dentro del proceso web;
- una segunda instancia multiplicaría límites, workers y conexiones.

El canal WhatsApp ya tiene buenas costuras:

- la firma HMAC se verifica sobre el cuerpo crudo;
- phone_number_id resuelve el canal y el tenant en el servidor;
- waMessageId es único para deduplicar reintentos;
- ToolContext recibe tenantId y customerId desde el servidor, no desde el modelo;
- CatalogRetriever permite cambiar la implementación sin cambiar el agente;
- la búsqueda actual usa FULLTEXT de MySQL con fallback acotado.

No obstante, [backend/services/whatsapp/webhook.ts](../../backend/services/whatsapp/webhook.ts)
responde 200 antes de que el trabajo quede en almacenamiento durable, y
[backend/services/whatsapp/queue.ts](../../backend/services/whatsapp/queue.ts)
puede perder trabajos en un reinicio. Además, un envío a Meta no puede ser
atómico con una escritura MySQL. Estos dos bordes requieren inbox/outbox,
idempotencia y reconciliación; no una separación precipitada del núcleo
financiero.

## Objetivos

- Tener un respaldo off-site verificable antes del siguiente cambio de schema.
- Reducir el RPO inicial a 24 horas y validar un RTO inicial de 4 horas o menos.
- Poder ejecutar más de una instancia web sin perder mensajes, duplicar crons ni
  debilitar rate limits.
- Aislar fallas y picos de WhatsApp/LLM del POS.
- Consultar conocimiento semántico por WhatsApp sin convertir al vector store en
  fuente de verdad financiera.
- Mantener una ruta de rollback aditiva por fase.
- Evitar secretos en repositorio, logs, argumentos de procesos y documentación.

## No objetivos

- Reescribir el ERP como microservicios.
- Migrar ventas, inventario o contabilidad de MySQL a PostgreSQL.
- Usar embeddings para responder cifras vivas de stock, precio, caja o deuda.
- Permitir que el LLM elija tenantId, customerId, roles o permisos.
- Ejecutar llamadas a Meta, al LLM o a otro proveedor dentro de una transacción
  financiera.
- Considerar que un dump subido, pero nunca restaurado, es un backup válido.

## Arquitectura objetivo

Flujo principal:

    Meta WhatsApp
          |
          v
    Webhook firmado y delgado
          |
          v
    Inbox MySQL, único por proveedor/mensaje
          |
          v
    Dispatcher -> BullMQ -> worker WhatsApp/LLM
                              |             |
                              |             +-> PostgreSQL/pgvector: conocimiento
                              |
                              +-> API/herramientas de dominio -> MySQL transaccional
                              |
                              +-> Outbox MySQL -> sender Meta

Persistencia y recuperación:

    MySQL actual o Managed MySQL
          |
          +-> backup lógico portable -> DigitalOcean Spaces privado
          |
          +-> last-backup.json + alertas + restore drill

El webhook y el worker pueden ser despliegues distintos del mismo repositorio.
Eso separa carga y fallas sin convertir cada dominio en un microservicio ni
introducir una base por servicio.

## Decisiones detalladas

### 1. DigitalOcean Spaces es el destino inmediato

Se creará un bucket privado dedicado a backups. El runtime usará una llave
limitada a ese bucket; una identidad administrativa separada configurará
versionado y ciclo de vida. La llave de aplicación no tendrá acceso a otros
buckets ni al panel de DigitalOcean.

Las access keys de Spaces hoy se crean y gestionan en el Control Panel de
DigitalOcean, no por API o CLI. La llave limitada del runtime tendrá permiso
`Read/Write/Delete` sobre ese bucket; la configuración de versionado/lifecycle
requiere una identidad de mayor privilegio que queda fuera de Coolify.

Se habilitará versionado y retención remota. Versionado protege contra
sobrescrituras y borrados accidentales, pero **no convierte Spaces en una copia
regional inmutable**. Cuando el riesgo del negocio exija tolerar pérdida de
proveedor o región, se añadirá una segunda copia en otra región o proveedor.

Spaces es compatible con S3 y el script actual ya usa AWS CLI. Por eso resuelve
el bloqueo con el menor cambio. Según la documentación oficial consultada el
2026-08-27, la suscripción estándar parte de US$5/mes e incluye 250 GiB
compartidos entre buckets; el precio debe reconfirmarse antes de crear el
recurso. Fuentes:

- [Precios de DigitalOcean Spaces](https://docs.digitalocean.com/products/spaces/details/pricing/)
- [Control de acceso a Spaces](https://docs.digitalocean.com/products/spaces/how-to/manage-access/)
- [Versionado de objetos](https://docs.digitalocean.com/products/spaces/how-to/enable-versioning/)
- [Reglas de ciclo de vida](https://docs.digitalocean.com/products/spaces/how-to/configure-lifecycle-rules/)
- [Compatibilidad S3 en Coolify](https://coolify.io/docs/knowledge-base/s3/introduction)

El bucket de backups no almacenará documentos RAG. Un futuro bucket de
documentos usará otra llave, otra retención y otro modelo de acceso.

### 2. El núcleo permanece como monolito modular

Ventas, stock, caja, cobranza, contabilidad y fiscalidad seguirán en un mismo
límite transaccional. Se extraerán routers, servicios y contratos internos, pero
un único comando de dominio seguirá controlando cada mutación y su AuditLog,
Kardex o asiento en la misma transacción.

Las dependencias deberán apuntar hacia el dominio:

- adaptadores HTTP y WhatsApp invocan comandos/consultas;
- comandos de dominio no importan Meta, BullMQ ni un proveedor LLM;
- persistencia accede mediante un único cliente Prisma por proceso;
- eventos externos salen mediante outbox después del commit;
- consultas pesadas y generación de archivos van a workers.

Un dominio solo podrá convertirse en microservicio cuando tenga propietario,
SLO, despliegue y escalado independientes, no requiera escribir las mismas tablas
ni una transacción distribuida, y su extracción demuestre una mejora medible.

### 3. Inbox/outbox es la fuente durable; BullMQ es el transporte

Redis/Valkey no sustituye a MySQL como registro de mensajes. Se agregarán tablas
aditivas:

- InboxEvent: mensaje externo recibido, tenantId derivado en servidor, clave
  única del proveedor, estado, intentos, lease y timestamps.
- OutboxEvent: evento creado dentro de la misma transacción que el cambio de
  dominio, con tenantId, tipo, versión, idempotencyKey, payload mínimo, estado,
  intentos y disponibilidad.
- ConsumerReceipt: opcional para registrar qué consumidor aplicó cada evento.

El webhook solo devolverá éxito después de persistir el inbox. Si MySQL no está
disponible, devolverá error reintentable para que Meta reenvíe. El dispatcher
usará el id del evento como jobId de BullMQ. La semántica será **al menos una
vez**: todo consumidor debe ser idempotente.

Ningún payload de cola llevará secretos. Cuando sea posible llevará IDs y el
worker releerá la información tenant-scoped. Los eventos históricos no se
borrarán físicamente como parte del flujo normal; se aplicará retención aprobada
y auditable.

Para el primer escalado se prefiere Redis/Valkey administrado y restringido a la
red privada. DigitalOcean describe Valkey administrado como compatible con Redis
y apto para colas; aun así, MySQL inbox/outbox permite recuperar trabajos aunque
la cola pierda estado:

- [DigitalOcean Managed Databases](https://docs.digitalocean.com/products/databases/)
- [Límites y compatibilidad de Valkey](https://docs.digitalocean.com/products/databases/valkey/details/limits/)

### 4. PostgreSQL/pgvector se limita a conocimiento

La búsqueda FULLTEXT actual seguirá siendo el baseline. Se provisionará
PostgreSQL con pgvector solo si una evaluación real muestra que sinónimos,
lenguaje natural o documentos superan su capacidad.

El índice vectorial contendrá tenantId, documentId, chunkId, checksum, versión de
embedding, visibilidad y timestamps. Toda consulta filtrará tenantId obtenido del
canal autenticado antes de ordenar por similitud. Se añadirá defensa en
profundidad en PostgreSQL mediante roles mínimos y, si el driver y el pool
permiten fijar el contexto de forma segura, Row Level Security.

Precios, saldos, existencias, facturas y ventas no se responderán desde chunks.
El retriever puede devolver IDs de productos, pero el worker rehidratará precio y
stock actual desde MySQL. Los documentos y respuestas incluirán referencias de
origen para evaluación y soporte.

DigitalOcean ofrece PostgreSQL administrado con pgvector y pgvectorscale:

- [PostgreSQL Vector Search](https://docs.digitalocean.com/products/vector-databases/postgresql/getting-started/)
- [Carga de embeddings](https://docs.digitalocean.com/products/vector-databases/postgresql/how-to/load-embeddings/)

### 5. Managed MySQL se adopta por trigger, no por ansiedad

La migración ocurrirá después de consolidar Prisma, fijar límites de conexión,
separar la aplicación del paso de schema y demostrar backups/restores. Los
triggers aparecen en el plan operativo.

El destino usará la misma familia/version de MySQL certificada por las pruebas,
con TLS verificado, VPC o trusted sources, usuario de aplicación limitado y
usuario de migración separado. La migración será online solo si puede exponerse
el origen de forma temporal, cifrada y estrictamente permitida; de otro modo se
hará dump/restore en una ventana controlada. Nunca se publicará 3306 a
0.0.0.0/0.

Managed Databases incluye backups administrados y recuperación a un punto en el
tiempo, pero Nortex mantendrá dumps lógicos en Spaces para portabilidad y una
falla de cuenta/proveedor:

- [DigitalOcean Managed Databases](https://docs.digitalocean.com/products/databases/)
- [Migración de MySQL](https://docs.digitalocean.com/products/databases/mysql/how-to/migrate/)
- [Conexión y TLS de MySQL](https://docs.digitalocean.com/products/databases/mysql/how-to/connect/)
- [Trusted sources de MySQL](https://docs.digitalocean.com/products/databases/mysql/how-to/secure/)

## Opciones consideradas

| Opción | Complejidad inmediata | Protección de datos | Escala | Veredicto |
|---|---:|---:|---:|---|
| Mantener dump/BD en el Droplet | Baja | Nula ante pérdida del Droplet | Baja | Rechazada |
| Snapshot del Droplet como único backup | Baja | Parcial; misma cuenta y restauración gruesa | Media | Solo complemento |
| Spaces ahora + restore drill | Baja | Buena ante pérdida del Droplet; portable | Media | **Aceptada ahora** |
| Migrar ya todo a Managed MySQL | Media/alta | Alta, con PITR | Alta | Diferida hasta pasar gates |
| Microservicios por dominio ahora | Muy alta | Añade fallas y transacciones distribuidas | Potencial | Rechazada |
| Monolito modular + worker + outbox | Media e incremental | Alta integridad y recuperación | Alta para la etapa actual | **Aceptada** |
| Reemplazar MySQL por PostgreSQL/pgvector | Muy alta | Riesgo innecesario para el core | Alta | Rechazada |
| PostgreSQL/pgvector solo para conocimiento | Media y aislada | No altera el core financiero | Alta | **Aceptada por trigger** |

## SLO, RPO y RTO adoptados

Los valores son objetivos iniciales; el primer restore drill fijará la línea base.

| Capacidad | Objetivo inicial | Objetivo posterior |
|---|---|---|
| Backup lógico MySQL | éxito diario; alerta si la evidencia supera 26 h | conservar export portable aun con Managed MySQL |
| RPO de base transaccional | 24 h máximo | 5 min o menos, validado con PITR |
| RTO de base transaccional | 4 h o menos, validado en restore drill | 60 min o menos, validado trimestralmente |
| Restore drill | mensual y antes del primer deploy de schema | mensual lógico + trimestral PITR |
| Webhook WhatsApp | p95 de persistencia/ack menor de 1 s; 99.9 % de ack válido | mismo objetivo con N instancias |
| Inicio de job WhatsApp | p95 menor de 30 s | p95 menor de 10 s |
| Mensajes perdidos/cross-tenant | cero | cero |

## Consecuencias

### Positivas

- El siguiente deploy queda protegido sin reescribir el sistema.
- La fuente financiera conserva atomicidad y precisión.
- WhatsApp puede escalar y reiniciarse sin depender de memoria local.
- El worker y el LLM pueden tener límites y despliegues independientes del POS.
- RAG puede evolucionar por calidad sin contaminar la base transaccional.
- Cada fase tiene rollback por bandera o consumidor, manteniendo schema aditivo.

### Costos y límites aceptados

- Hasta Managed MySQL, el RPO depende de dumps diarios.
- Spaces no es inmutable ni una copia multi-proveedor por sí solo.
- Redis/Valkey y PostgreSQL añaden costo y observabilidad.
- Outbox implica consistencia eventual para efectos externos y posibles entregas
  repetidas; los consumidores deben ser idempotentes.
- Después de abrir escritura en un MySQL nuevo, volver al anterior sin sincronizar
  perdería datos. El rollback posterior al cutover será recuperación hacia
  adelante, no un simple cambio de URL.

## Reglas de revisión

Esta ADR se revisará cuando ocurra cualquiera de estos eventos:

- RPO o RTO incumplido en un incidente o simulacro.
- Segundo proceso web o más de un worker en producción.
- Dos incidentes de cola, conexión o cron en 30 días.
- El Space supera 70 % del almacenamiento incluido o la retención deja de caber.
- El RAG no alcanza el umbral de calidad definido en el plan.
- Un dominio cumple todos los criterios para extracción independiente.
- Cambian materialmente precios, límites o capacidades del proveedor.

## Resultado

La ruta elegida no es “monolito para siempre”. Es **modularidad primero,
durabilidad en los bordes y separación solo donde aporta aislamiento real**. El
primer paso obligatorio es el backup off-site restaurable; sin ese gate no se
promueve ningún cambio de schema a producción.

✓ Security & Integrity Loop superado para la decisión arquitectónica documentada.
