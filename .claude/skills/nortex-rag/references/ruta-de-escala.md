# Ruta de escala del agente WhatsApp/RAG

Leé esta referencia al cambiar la topología del agente, introducir Redis/BullMQ,
separar un worker, agregar outbox/CDC, incorporar pgvector o evaluar extraer un
servicio. Para tools y prompts ordinarios basta el `SKILL.md` principal.

## Resultado buscado

Escalar WhatsApp y RAG sin distribuir las invariantes financieras de Nortex:

```text
Meta WhatsApp
      │ webhook firmado
      ▼
Web/API del monolito ──► inbox durable / BullMQ ──► worker WhatsApp
      │                         │                         │
      │                         │                         ├─► LLM
      │                         │                         ├─► tools core
      │                         │                         └─► envío Meta
      ▼                         ▼
MySQL (verdad) ◄──────── outbox/dispatcher
      │
      └─► jobs de ingesta ──► PostgreSQL + pgvector (índice reconstruible)
```

El web y los workers pueden ser entrypoints distintos del mismo repositorio y
reusar módulos de aplicación. Esa separación de proceso da escalado y aislamiento
de fallas sin pagar todavía el costo de contratos de red entre ventas, inventario,
caja y contabilidad.

## Límites de componentes

| Componente | Responsabilidad | No debe hacer |
|---|---|---|
| Monolito modular + MySQL | Autorizar, calcular y confirmar ventas, stock, caja, cartera, pedidos y contabilidad | Delegar una invariante financiera al LLM, Redis o pgvector |
| Redis/Valkey + BullMQ | Transportar trabajo, aplicar backoff y repartirlo entre workers | Ser la única evidencia de una operación de negocio o prometer exactly-once |
| Worker WhatsApp | Consumir idempotentemente, llamar brain/tools y enviar respuestas | Confiar en identidad aportada por el prompt o abrir una transacción core alrededor de llamadas externas |
| Outbox en MySQL | Registrar en el mismo commit qué efecto externo debe publicarse | Guardar secretos o documentos completos en el payload |
| PostgreSQL + pgvector | Indexar chunks/embeddings de conocimiento y buscar semánticamente | Ser fuente de verdad de precio, stock, saldo, ventas o permisos |
| Worker de ingesta | Extraer, partir, versionar y reindexar documentos | Inventar tenant desde metadatos del archivo o sobrescribir el original |

No extraer un microservicio porque un módulo “creció”. Considerarlo solo si tiene
frontera de datos y permisos clara, necesita escala o despliegue independiente y
puede tolerar consistencia eventual. Los primeros candidatos son WhatsApp,
ingesta/embeddings y exports pesados; el núcleo financiero permanece junto.

## SQL determinístico frente a RAG

Elegí la fuente antes de escribir la tool o el prompt:

| Pregunta/acción | Fuente correcta | Regla |
|---|---|---|
| “¿Cuánto cuesta?”, “¿hay existencia?”, “¿cuánto debo?”, “¿dónde va mi pedido?” | Tool determinística contra servicios/SQL MySQL | Respuesta autoritativa, tenant-scoped y con marca de tiempo cuando pueda quedar obsoleta |
| “¿Cómo uso este producto?”, políticas, manuales, garantías, fichas técnicas | RAG sobre documentos autorizados | Citar fuente/versión y admitir ausencia de evidencia |
| Pregunta que mezcla compatibilidad + precio/stock | RAG para evidencia textual + tool SQL para cifras actuales | Mantener procedencia separada; el texto recuperado nunca sobrescribe la tool |
| Crear pedido, reservar, vender, cobrar o ajustar stock | Comando explícito del servicio core | Confirmación del usuario, Zod, idempotencia, Decimal, auditoría y transacción del dominio |

El modelo solo decide qué tool invocar y redacta. No recibe un cliente SQL, no
genera consultas libres y no transforma texto recuperado en una cifra operativa.
Las tools exponen capacidades estrechas, no endpoints genéricos de “consultar” o
“ejecutar”.

## Identidad y aislamiento

- El productor confiable deriva `tenantId` de `phone_number_id` y `customerId`
  de `waId` dentro del mismo tenant. El mensaje, el LLM y los argumentos de tool
  nunca fijan esos campos.
- Un job puede transportar ids ya resueltos para eficiencia, pero el worker trata
  su productor como parte del perímetro de confianza y vuelve a validar que canal,
  conversación y cliente pertenezcan al tenant antes de una operación sensible.
- Toda fila vectorial lleva `tenantId`, `documentId`, versión y estado de
  publicación. La consulta preparada aplica `WHERE tenant_id = $1` **antes** del
  orden por distancia y del `LIMIT`; no se recupera globalmente para filtrar en JS.
- La ingesta obtiene el tenant de un registro/autorización server-side, no del
  nombre, contenido o metadatos arbitrarios del documento.
- El almacenamiento de documentos y el de backups usan buckets, llaves y políticas
  separados. Los payloads de jobs/outbox contienen referencias mínimas, no tokens,
  prompts completos ni PII innecesaria.

## Inbox, cola y semántica de entrega

La respuesta HTTP 200 al webhook solo ocurre después de aceptar el mensaje en un
inbox durable de MySQL. BullMQ es transporte reconstruible, no sustituto del
inbox. Si el inbox no se confirma, devolvé error para que Meta reintente; no
confirmes un trabajo que puede perderse.

Contrato recomendado:

1. Verificar HMAC y forma del payload.
2. Persistir/deduplicar en MySQL el identificador externo (`waMessageId`) y los
   datos mínimos necesarios para reconstruir el trabajo.
3. Encolar la referencia con un `jobId` estable derivado del inbox, nunca secretos.
   Si Redis falla después del commit, un reconciliador vuelve a encolar los inbox
   pendientes; el mensaje ya puede recibir 200 porque no se perdió.
4. Consumir at-least-once. Cada efecto usa una clave idempotente única: mensaje,
   comando, respuesta y evento.
5. Reintentar con backoff y jitter; clasificar errores permanentes; mover agotados a
   una cola fallida/cuarentena observable. No hacer loops infinitos.
6. Aplicar límites de concurrencia por proveedor y, cuando importe el orden, por
   conversación o agregado; no serializar tenants no relacionados.

Redis necesita autenticación/TLS, persistencia y política de memoria compatibles
con colas. Aun así, no es el ledger: un inbox/outbox pendiente debe permitir
reconstruir trabajos tras pérdida de Redis.

## Outbox transaccional

Usá outbox para efectos que deben ocurrir después de un cambio confirmado:
mensajes, indexación, webhooks, emails o eventos. La misma transacción MySQL escribe
el dato de dominio, su auditoría obligatoria y el evento outbox. Cero llamadas de
red dentro de esa transacción.

Un modelo aditivo típico contiene:

- `id`/`eventId` único y no reutilizable;
- `tenantId`, tipo/id del agregado y `eventType` versionado;
- payload mínimo versionado, sin secretos;
- `occurredAt`, `availableAt`, intentos y estado;
- lease/claim con vencimiento, `dispatchedAt` y error saneado;
- índices por estado/fecha y por tenant/agregado según los patrones reales.

El dispatcher reclama lotes pequeños con lease o locking seguro para MySQL 8,
publica fuera de la transacción de dominio y marca el resultado. Un crash después
de publicar y antes de marcar produce duplicado: el consumidor deduplica por
`eventId`. No intentar una transacción distribuida MySQL–Redis–PostgreSQL.

Si un proveedor externo no acepta una clave idempotente —por ejemplo, un envío
concreto de mensajería— no prometás un único envío físico. Persistí primero el
intento saliente, reducí la ventana, reconciliá con el id del proveedor cuando
exista y medí duplicados; la garantía fuerte sigue siendo un solo efecto de
dominio, no exactly-once sobre una API ajena.

Definí retención y archivado: los pendientes/fallidos se conservan para operar; los
despachados no crecen sin límite. Toda escritura y lectura de outbox sigue aislada
por tenant salvo el dispatcher interno, que usa un rol técnico explícito y nunca
expone un endpoint global al LLM.

## pgvector como índice separado

Nortex sigue usando MySQL 8 como sistema de registro. PostgreSQL + pgvector aloja
solo documentos/chunks reconstruibles:

Esta es una excepción auxiliar y acotada al guardrail “NO PostgreSQL” del core:
no reemplaza `DATABASE_URL`, no cambia el schema Prisma transaccional y usa
credenciales/clientes separados con permisos mínimos.

1. Registrar en MySQL el documento, propietario tenant, versión, checksum, estado
   y referencia al objeto original.
2. Emitir un evento outbox de indexación.
3. El worker descarga con credencial de alcance mínimo, extrae y divide; cada chunk
   hereda el tenant y versión server-side.
4. Insertar embeddings de forma idempotente por
   `(tenantId, documentId, version, chunkOrdinal, embeddingModelVersion)`.
5. Publicar la nueva versión solo cuando esté completa; retirar la anterior de
   búsqueda después del corte. Un retry no mezcla versiones parciales.
6. Conservar FULLTEXT como fallback. Si pgvector está caído o atrasado, las tools
   determinísticas siguen disponibles y el bot declara que no pudo consultar la
   documentación en vez de improvisar.

Antes de elegir dimensión, índice HNSW/IVFFlat o proveedor de embeddings, medí
volumen, latencia y calidad con el corpus real. El contrato `CatalogRetriever`
evita acoplar el brain a esas decisiones.

## Migración incremental y gates

Cada fase es desplegable y reversible por separado:

### 0. Línea base y fronteras

- Consolidar el cliente Prisma y presupuesto de conexiones antes de N instancias.
- Medir profundidad/edad de cola, latencia end-to-end, duplicados, fallos de tools
  y costo/tokens del LLM.
- Congelar pruebas de identidad, idempotencia y respuestas determinísticas.

**Gate:** comportamiento actual reproducible y backup/restauración verificados.

### 1. Monolito modular y entrypoints

- Extraer puertos para queue, sender, retriever y clock sin cambiar resultados.
- Crear entrypoints web y worker en el mismo código/artefacto; el web no procesa
  trabajo pesado inline.
- Mantener una sola instancia productiva hasta resolver todos los estados en
  memoria señalados por `docs/SCALING_AUDIT.md`.

**Gate:** MenuBot y ClaudeBrain pasan los mismos contratos; apagar el worker no
afecta POS ni las transacciones core.

### 2. Inbox + BullMQ/Redis

- Implementar el adaptador persistente detrás de la interfaz de cola.
- Habilitarlo por flag con **un solo productor activo**; un canary/tenant piloto
  evita doble enqueue. Reconciliar inbox pendiente con la cola.
- Escalar workers solo después de probar duplicados, orden y crash recovery.

**Gate:** cero pérdida en reinicio forzado; duplicados sin efectos duplicados;
backlog drena dentro del objetivo y la cola fallida es operable.

### 3. Outbox para efectos externos

- Empezar por envío WhatsApp e indexación, no por partir ventas/inventario.
- Desplegar schema aditivo, dispatcher apagado, backfill/reconciliación y luego
  activar por tipo de evento.
- Consumidores idempotentes antes de aumentar concurrencia.

**Gate:** crash en cada borde commit/publish/ack no duplica efectos de dominio;
los posibles duplicados de proveedores sin idempotencia están caracterizados y
mitigados; edad del outbox y fallidos tienen alertas.

### 4. PostgreSQL + pgvector

- Ingerir un corpus piloto por tenant; ejecutar búsquedas sombra sin cambiar la
  respuesta del usuario y comparar relevancia/latencia.
- Habilitar lectura vectorial por tenant, con fallback FULLTEXT y kill switch.
- Reindexar desde documentos originales para probar que el vector store es
  descartable.

**Gate:** pruebas cross-tenant negativas, calidad superior a la línea base,
latencia/costo aceptables y caída del vector store degradada sin afectar SQL.

### 5. Escalado horizontal

- Mover rate-limit, caché de paywall y coordinación de crons a stores/schedulers
  compartidos; verificar singleton Prisma y límites de conexiones.
- Escalar web y workers por métricas distintas. Establecer límites globales y por
  tenant para evitar que uno monopolice LLM/cola.

**Gate:** carga con dos o más instancias mantiene auth, caja, stock, idempotencia y
aislamiento; no hay crons duplicados ni agotamiento de conexiones.

### 6. Extracción selectiva, solo con evidencia

Extraer un servicio únicamente si los límites anteriores ya no bastan y existe
propiedad operacional clara. Un servicio nuevo necesita SLO, autenticación entre
servicios, versionado de contrato, trazas, despliegue/rollback independiente y un
modelo de consistencia explícito. No compartir tablas como API informal.

## QA de fallas y observabilidad

Automatizá al menos estos escenarios:

- mismo webhook/job/evento entregado 2+ veces;
- crash antes y después de cada commit, publish, envío y ack;
- Redis sin conexión, reinicio y pérdida simulada del transporte;
- LLM lento/429/5xx y Meta lento/429/5xx;
- pgvector caído, índice atrasado, versión incompleta y documento retirado;
- job con `tenantId`/`customerId` forjado, prompt injection y documento de otro
  tenant con alta similitud;
- reintento concurrente de una mutación de dinero/stock;
- backlog grande sin bloquear el event loop ni el POS.

Métricas mínimas: edad y profundidad de cola, throughput, reintentos/fallidos,
latencia por etapa, outbox pendiente más antiguo, lag de indexación, tasa de
fallback, errores por tool/proveedor y conexiones MySQL. Logs/trazas usan ids de
correlación y evento, nunca tokens ni contenido sensible completo.

## Rollback seguro

- Flags independientes para queue adapter, worker, outbox dispatcher y retriever.
- Schema siempre aditivo; un rollback de aplicación deja tablas/columnas nuevas y
  no ejecuta drops.
- Detener productores/dispatchers antes de cambiar consumidores; drenar o congelar
  trabajos y registrar el punto de corte.
- FULLTEXT/MenuBot son degradaciones funcionales válidas cuando LLM o pgvector
  fallan. El POS y las tools SQL no dependen de esos servicios.
- Tras rollback, reconciliar inbox/outbox por ids idempotentes; no borrar trabajos
  para “limpiar” métricas.

## Definition of Done de una fase

- Arquitectura y runbook (`docs/WHATSAPP_INFRA.md`) reflejan lo desplegado, no el
  estado aspiracional.
- Migraciones aditivas pasan preflight MySQL 8 sin `--accept-data-loss`.
- Tenant binding, permisos, idempotencia y auditoría tienen pruebas negativas.
- Dashboards/alertas y procedimiento de reintento/cuarentena existen antes del
  rollout amplio.
- Rollout piloto, criterio de promoción, kill switch y rollback fueron ensayados.
- No se declara escalabilidad horizontal hasta cerrar también los otros estados en
  memoria de `docs/SCALING_AUDIT.md`.
