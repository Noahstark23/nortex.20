# Auditoría general de Nortex — 4 de septiembre de 2026

**Dictamen: base técnica aprovechable; encaje comercial aún no demostrado.** Priorizar activación y recurrencia en ferreterías/farmacias, cerrar riesgos del núcleo y abrir WhatsApp con identidad y persistencia verificadas. El [plan de transformación](PLAN_TRANSFORMACION_TOTAL_2026.md) convierte este diagnóstico en fases, responsables y aceptación.

## Alcance y evidencia

- Repositorio observado: `/Users/stark/Documents/GitHub/nortex.20`.
- Rama local: `codex/caja-nica-retention`; HEAD `d326c589a756db7977d14c94a625b6c895cb3313` **más numerosos cambios locales**. El SHA por sí solo no reproduce esta auditoría.
- Tres revisiones paralelas: arquitectura/calidad, producto/documentación y RAG/WhatsApp; revisión y comprobaciones locales consolidadas.
- Se leyó el código y se contrastaron planes y auditorías anteriores. Se creó una copia saneada de 823 archivos con manifiesto SHA-256; dependencias locales copiadas y Prisma generado allí.
- No se leyeron `.env`, llaves ni datos de clientes; no se consultó DB real ni telemetría privada, no se enviaron mensajes, no se desplegó ni modificó código funcional.
- Las líneas de evidencia se refieren al checkout observado antes de la actualización documental; trabajo concurrente puede moverlas.
- Esto es una auditoría general por muestreo y mediciones de fuente, no una certificación de seguridad, fiscalidad, UX física, capacidad de carga o producción.

Etiquetas: **código** = comprobado en fuente; **local** = prueba ejecutada; **autorreporte** = información del fundador; **inferencia** = consecuencia razonada pendiente de reproducción; **no verificado** = sin evidencia actual suficiente.

## 1. ¿Tiene futuro?

El producto contiene mecanismos que costaría reconstruir: autoridad de venta en servidor, stock centralizado, auditoría, lotes, compras, caja, fiado, contabilidad, PWA y una red considerable de pruebas. Es razonable continuar con una transformación incremental.

El fundador informa **45 personas registradas y 3 habituales**, en **ferreterías y farmacias**. Hay tráfico y recomendaciones ocasionales de ChatGPT según su relato. **3/45 ≈ 6,7 %** es una proporción puntual, no tasa de retención, churn ni conversión a pago: no se conocen cohortes, personas por comercio, demos, antigüedad ni pagos. No hay MRR, margen ni costos de soporte conciliados disponibles para este dictamen.

Por tanto: hay evidencia inicial de utilidad, pero no de crecimiento sostenible. La siguiente inversión debe demostrar primera venta, repetición y pago. El plan fija revisiones a 30/60/90 días con criterios propuestos; no pronostica éxito ni fracaso inevitable.

Una comparación pública acotada confirma presión competitiva: Loyverse publica TPV básico gratuito y complementos de personal/inventario de pago. **Inferencia:** Nortex necesita demostrar valor específico en el comercio local y soporte, no apoyarse solo en cantidad de módulos. No se hizo un estudio completo de mercado ni se verificó adecuación fiscal de competidores en Nicaragua. [Precios oficiales de Loyverse](https://loyverse.com/es/pricing).

## 2. Verificación local ejecutada

Runtime Node 22.23.2, paquetes instalados locales copiados (sin `npm ci` fresco), entorno saneado, URL MySQL ficticia en puerto cerrado y sin secretos. Las siguientes pruebas se ejecutaron sobre la copia del trabajo local, no sobre producción:

| Comprobación | Resultado | Límite |
|---|---|---|
| Prisma generate | PASS, 1,9 s | Genera tipos; no conecta ni migra DB |
| Prisma validate | PASS, 0,3 s | Validez del schema, no estado de DB |
| TypeScript `tsc --noEmit` | PASS, 9,3 s | Configuración actual no activa strict |
| Sistema de diseño | PASS, 75 archivos, 0 infracciones reportadas | Reglas estáticas, no evaluación visual humana |
| Vitest | **3.416 pruebas pasaron; 64 omitidas**. 266 archivos pasaron, 11 omitidos | Se excluyó además `tests/serverStartup.test.ts` para no iniciar servidor; suites HTTP/MySQL no habilitadas |
| Build Vite/PWA | PASS, 6,7 s | Build sin env; no `build:seo`, no prueba de carga/dispositivo |

Vitest tardó 27,2 s de proceso (26,48 s reportados por Vitest). No se ejecutaron mutación Stryker, `npm audit` en vivo, integración MySQL, restore, E2E autenticado, hardware ni CI remoto. La CI del repositorio contiene jobs de upgrade y backup/restore, pero no se comprobó aquí su ejecución vigente.

Build medido: chunk principal **662,94 kB** (184,56 kB gzip), POS **529,78 kB** (111,89 kB gzip), XLSX **500,06 kB** (163,12 kB gzip); precache PWA **6.874,50 KiB / 155 entradas**. Hay partición por chunks: la afirmación histórica de todo el SPA en un único archivo de 2 MB ya no describe este build. Vite advierte chunks >500 kB. Tamaños no permiten afirmar tiempo de carga en un Android real.

## 3. Línea base estructural

| Medición de fuente | Resultado |
|---|---:|
| backend/server.ts | 15.451 líneas; 188 declaraciones directas app HTTP (no incluye routers montados) |
| components/POS.tsx | 7.579 líneas; 123 apariciones textuales de useState |
| Inventory / Purchases / HRM | 3.472 / 2.802 / 2.182 líneas |
| Prisma | 109 modelos; 215 campos Decimal; 35 Float |
| Soft delete | Supplier tiene deletedAt; cobertura incompleta en otros agregados |
| Instancias Prisma runtime | 11, incluida la del singleton; 10 fuera del singleton |
| Pruebas | 278 archivos; 29 TSX; 88 contienen readFileSync |
| Suites condicionadas | 12 archivos con describe.skip dependiente de entorno; 11 archivos completos omitidos en esta corrida |

Float también incluye ubicación/cantidades/porcentajes, no solo dinero. `useState` y `readFileSync` son conteos textuales, no análisis AST ni juicio automático de calidad. El umbral configurado de mutación 99,85 % no es cobertura global ni un resultado ejecutado hoy.

## 4. Hallazgos prioritarios

P0 bloquea activar la capacidad afectada; no significa incidente productivo confirmado. P1 debe resolverse antes de expandir o tomar decisiones dependientes. No se parchearon estos hallazgos funcionales en esta entrega documental.

| ID | Prioridad / evidencia | Hallazgo e impacto | Acción / prueba necesaria |
|---|---|---|---|
| G01 | P0 canal / código | `ventas_hoy` permite la consulta por scope B2B/BOTH del canal sin comprobar dueño del remitente. `tools.ts:89–117`, `identity.ts:23–30` | Usuario vinculado/verificado, rol por tool, revocación. Un desconocido debe recibir rechazo. No se confirmó canal B2B activo en producción |
| G02 | P0 canal / código | Customer se vincula por `contains` de últimos 8 dígitos; puede elegir persona incorrecta. `identity.ts:63–68`; deuda muestra nombre/saldo/límite `tools.ts:70–85` | Número exacto normalizado + vínculo verificado; colisiones, reutilización y revocación; ninguna deuda por coincidencia parcial |
| G03 | P0 canal / código | ACK 200 antes de persistencia y cola en memoria: ventana de pérdida incluso con una instancia. `webhook.ts:63–87`, `queue.ts:19–61` | Inbox durable antes de ACK; DB caída/reinicio/duplicado concurrente con claims y leases |
| G04 | P0 canal / código | Meta send antes de commit local; dedupe sin claim concurrente, posible duplicado ante crash/timeout. `inbound.ts:33–59,103–128` | Outbox y conciliación de UNKNOWN; pruebas de fallo antes/después de send/commit; no prometer exactly-once |
| G05 | P1 negocio / código | `monthlyRevenue` suma 2 % de ventas del mes + 5 % de capital B2B; activeSubscriptions = total menos morosos incluye trials. `server.ts:10888–10913`, SuperAdmin `TU GANANCIA` | Separar GMV, proyección, MRR y cobros conciliados. No usar el campo como ingreso real |
| G06 | P1 datos / código condicional | Total de cuentas por pagar se suma sobre máximo 500 facturas. Si hay más, el total global es incompleto. `server.ts:9827–9851` | Agregado exacto independiente de página, compatible con balance efectivo legacy; pruebas 501/1.001 filas |
| G07 | P1 datos / código + inferencia | Product DELETE físico y cascadas a historial subordinado; otras FK pueden bloquearlo según registro. `server.ts:7051–7100`, schema `1882,2029,2171` | Archivar con conservación de Kardex/lotes/conteos; probar cada FK/caso; no afirmar borrado real observado |
| G08 | P1 concurrencia / código + inferencia | `getAccount` usa Prisma global desde una transacción y necesita otra conexión. `accounting.ts:94,119,217` | Resolver por tx/consolidar lecturas; probar saturación con pool pequeño. Riesgo de espera, no deadlock medido |
| G09 | P1 QA / código + local | Suites críticas HTTP/MySQL condicionadas no corren en CI ordinaria; local omitió 64 tests | Job de negocio MySQL obligatorio, dos tenants/roles, concurrencia, replay, devoluciones/cierre y reporte de omisiones |
| G10 | P1 escala / código | 10 instanciaciones Prisma ajenas al singleton; rate limit/cache/crons por proceso. `auth.ts:16`, `server.ts:394,15426`, `whatsapp/db.ts:6` | Consolidación con presupuesto conexiones, store compartido, scheduler único; no habilitar N instancias antes de probar |
| G11 | P1 deuda / código | Diff local sube trinquete POS de 7.497/122 a 7.581/123 y añade excepción de prueba estática. `tests/presupuestoPos.test.ts:50,128` | Extraer código, recuperar presupuesto previo sin perder funcionalidad; tests conductuales. No elevar límite para pasar |
| G12 | P1 soporte / código | Handoff marca HUMAN, pero no entrega atención humana; conversaciones por tenant+waId no separan canal/propósito. `inbound.ts:65–103`, schema `1698–1713` | Bandeja, asignación, horario, permisos y contexto separado; probar cambio de rol/canal y caída de envío |
| G13 | P1 IA / código | Existe catálogo FULLTEXT, no RAG documental; falta ciclo de documentos, citas, ACL, retención y presupuesto por tenant | Fuentes aprobadas y KnowledgeRetriever separado; golden set, abstención, retirada documental y límites de costo |
| G14 | P1 datos / código | Product money Float convive con históricos Decimal y columnas exactas nuevas. `schema.prisma:1269–1274,1465,1780` | Autoridad por agregado, backfill/comparación/reconciliación. No demostrar pérdidas reales solo por el tipo |
| G15 | P2 rendimiento / código + build | XLSX mensual síncrono y consultas por ítem; chunks pesados. `server.ts:15100–15144`, `salesService.ts:965–1080` | Medir p95/p99/query count/heap; worker para export y consolidación manteniendo transacción financiera |
| G16 | P2 configuración / código | tsconfig no activa strict; Vite define claves Gemini para cliente sin consumidores actuales encontrados. `tsconfig.json`, `vite.config.ts:103–105` | Strict gradual y retirar defines muertos; prueba con marcador sintético. No se demostró exposición de una clave real |

Archivos abreviados WhatsApp corresponden a `backend/services/whatsapp/`; schema a `backend/prisma/schema.prisma`.

Otros pendientes específicos: fallback de catálogo toma 100 antes de rankear; “ventas hoy” usa medianoche de zona del servidor; stock de catálogo usa `Product.stock` y debe alinearse con disponibilidad vendible. Alta administrativa de canal tiene validación/auditoría incompletas y permite cambio de tenant mediante upsert; asegurar reasignación explícita, trazabilidad y aislamiento de historial. Estas tareas se incorporan a T01/T07/T10/T12.

## 5. Fortalezas y avances que no hay que rehacer

- `salesService.ts:1189–1207` exige venta/asiento/AuditLog en la misma transacción; `applyStockDelta` centraliza stock. Mantenerlo al modularizar y al exponer herramientas.
- `auth.ts:130–160` revalida usuario, rol y tenant y falla cerrado. No implica cobertura correcta de cada ruta.
- Existen idempotencia y campos exactos en módulos nuevos, Supplier archivado y servicios de dominio extraídos. Hay una dirección técnica útil.
- CI define tipos, pruebas, diseño, mutación, build, schema upgrade y backup/restore; release verifica SHA esperado. Falta evidencia operacional actual, no crear otra herramienta equivalente sin revisar la existente.
- Registro/trial/precio local y landing coinciden en 30 días/$20; existen teléfono, bienvenida/lifecycle, lista de cuentas dormidas/export, menú por capacidades y ayuda. Las auditorías antiguas que dicen lo contrario no son diagnóstico vigente.
- La ayuda y onboarding están implementados; toca probar si resuelven el recorrido. En retail ya hay tres hitos base con pasos condicionales por capacidades (`server.ts:1443–1469`).

## 6. Producto, UX y negocio

No se observó una sesión de usuario real ni se accedió al panel autenticado. La hipótesis principal es fricción entre registro y valor recurrente, pero el motivo exacto de no volver sigue desconocido. Probar con los 3 habituales y 5–8 inactivos antes de un rediseño global.

El menú simple contiene 9 rutas de pulpería, 10 de ferretería, 9 de farmacia y 11 de distribuidora antes de filtrar por rol (`utils/navigation.ts:208–216`); el nombre “simple” no prueba facilidad. Conservar las tareas de uso frecuente visibles y revelar complejidad por capacidad/rol a partir de observación.

Hay divergencias de ayuda: `HelpCenter.tsx:115` invita a esperar una invitación por correo mientras `TeamManagement.tsx:572–595` muestra un enlace compartible. Actualizar guía y probar experiencia de invitado. Analítica frontend y login30d no equivalen a venta real, activación o hábito.

No se verificaron Search Console, GA4, volumen/calidad de tráfico ni referencias desde ChatGPT. El plan propone atribución por fuente y conversión/retención por cohorte; tráfico sin uso recurrente no justifica ampliar inversión publicitaria.

## 7. RAG y restricciones de WhatsApp

La primera aplicación recomendada es ayuda sobre Nortex: documentación aprobada → respuesta con fuente → tarea en la app o persona. Separar soporte corporativo, comprador del comercio y dueño verificado. No conectar automáticamente el chat público de landing con herramientas privadas de comercios.

Las políticas oficiales consultadas establecen consentimiento/opt-out, reglas de plantillas y ventana de atención, atención humana y restricciones de productos/actividades. Nicaragua figura en una excepción condicionada para mensajes de fármacos OTC; las experiencias de comercio regulado siguen restringidas. La elegibilidad requiere clasificar caso, producto y país antes del piloto; no es una prohibición total de dar soporte SaaS a farmacias. [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).

Los términos de Solution restringen IA cuando es la función principal y contemplan IA auxiliar. Diseñar atención empresarial acotada es una inferencia de diseño, no aprobación de Meta para Nortex. Revalidar los términos vigentes antes de lanzar. [Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms).

Meta publica precios por mensaje entregado según categoría y mercado. No se obtuvo tarifa específica Nicaragua ni se verificó costo productivo de Nortex; evitar presupuestos que asuman toda conversación gratuita o IA ilimitada. Guardar la tarifa y fecha aplicables antes de calcular margen. [WhatsApp Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/).

## 8. Reconciliación de documentos

| Documento | Tratamiento en esta actualización |
|---|---|
| README raíz | Reemplazar plantilla AI Studio por producto, arranque seguro, pruebas y mapa documental |
| CLAUDE | Corregir strict, soft-delete, Prisma, métricas históricas e inmunidad absoluta; conservar reglas de integridad |
| PLAN_TRANSFORMACION_TOTAL_2026 | Nueva fuente de prioridades, aprendizaje comercial y backlog |
| AUDITORIA_GENERAL_2026-09-04 | Nueva evidencia del checkout y pruebas con límites |
| docs/README | Índice de planes vigentes/históricos y disciplina de estados |
| ONBOARDING_RETENCION | Reescribir estado vigente, hipótesis pendientes y medición por cohortes |
| WHATSAPP_INFRA | Describir MVP y brechas; retirar garantías de idempotencia/identidad plenas y activación prematura |
| PLAN_MIGRACION_RAG_WHATSAPP_ESCALA | Añadir estado actual, adelantar identidad/handoff y enlazar programa T01/T07–12 |
| SCALING_AUDIT / PLAN_DESACOPLE | Mantener historia, actualizar baseline y retirar receta de contabilidad post-commit |
| SECURITY_REMEDIATION_PLAN | Sustituir sweep monetario global/Number por transición aditiva por agregado |
| SECURITY_AUDIT / auditorías UX anteriores | Marcar evidencia histórica y exigir revalidación; no borrar hallazgos históricos |
| ADR backups-RAG | Aclarar decisión arquitectónica vigente frente a evidencia operacional no verificada |
| Planes RRHH/bodega/móvil/cámara/verticales | Conservar contenido de otros trabajos; prioridad coordinada desde índice/master y validación física/release separadas |

Los inventarios revisados no equivalen a verificar cada requisito de todos los MD ni cada handler. No se marca “terminado” un plan por existir una implementación local. La fuente canónica de seguridad e integridad sigue siendo CLAUDE/AGENTS, y la evidencia de release debe tener ambiente, SHA y fecha.

## 9. Qué falta para una decisión comercial firme

Fechas de alta y uso por comercio, cuenta demo/real, pagos y renovaciones, costo de soporte, segmento concreto de cada habitual, motivos de inactividad, errores de producción y prueba de restauración. Recoger solo datos necesarios, preferentemente agregados.

Recomendación final: continuar con foco y revisiones de inversión cortas. El programa comercial arranca por conocer a los usuarios; el técnico, por identidad/durabilidad del canal, métricas y defectos de datos; ambos se unen en una primera venta confiable y soporte útil. El resultado de esta auditoría es un plan y documentación reconciliada, no una transformación ya implementada.
