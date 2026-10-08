# NortexGPT: implementación local del 2026-09-05

> Evidencia histórica de la entrega anterior. La ampliación operativa posterior modifica parte de estas fuentes; su estado y sus compuertas se consultan en [NortexGPT operativo](NORTEXGPT_OPERATIVO_2026-09-05.md). Los manifiestos anteriores se conservan y no acreditan automáticamente el candidato nuevo.

Ampliación posterior: [captura de compras por conversación](NORTEXGPT_CONVERSACION_2026-09-05.md). Los resultados de pruebas de este informe corresponden a la primera entrega; la ampliación conserva su propia evidencia.

Estado: implementación local para revisión, con interruptores apagados por defecto. No hay piloto con clientes, evaluación pagada del modelo, CI remoto, staging ni despliegue de producción. Esta entrega conserva React/Vite, Express, Prisma 6.4.1, MySQL 8, Node 22.23.2 y npm.

Se trabajó en una copia aislada del checkout para conservar los cambios previos. La integración verifica el SHA-256 de cada archivo original antes de copiar únicamente los cambios de esta entrega. No se cambian ramas, worktrees ni historial. El identificador local de evidencia no es un commit desplegable.

## Comportamiento entregado

- Panel NortexGPT bajo demanda desde el Layout, con ayuda y consultas del negocio. Mantiene el POS montado y conserva su carrito. Mientras está abierto, el fondo queda inerte y los contratos existentes bloquean lector y atajos.
- Ayuda léxica revisable en `backend/services/assistant/knowledge.ts`, con documento, sección y versión. Una pregunta sin fuente suficiente se rechaza. El corpus de ayuda no incorpora facturas, conversaciones, instrucciones internas ni archivos privados.
- Métricas calculadas en MySQL por servicios cerrados: ventas del período, IVA histórico cuando existe, devoluciones separadas, gastos registrados, saldos actuales y stock/vencimientos. Períodos civiles de Managua. Ventas no se presenta como ganancia. Un error de consulta se muestra como dato no disponible.
- Interpretación opcional con Haiku: una llamada tipada propone intención y período; el servidor selecciona servicios autorizados y construye las cifras. Sin SQL, endpoints arbitrarios ni herramienta de confirmación. Con el modelo apagado siguen disponibles las intenciones deterministas y la ayuda.
- Carga privada de PDF, JPEG y PNG; lectura durable en un worker; revisión de proveedor, catálogo, OC, bodega, unidades, cantidades, costos, IVA, fechas, lotes y condiciones. WebP queda rechazado hasta contar con validación equivalente.
- Propuestas separadas de `Purchase`. Ni el documento ni el chat acreditan recepción o pago. La extracción restablece esas decisiones a pendientes y no infiere IDs del catálogo.
- Revisión editable y previsualización calculada por Compras; muestra stock, total, caja identificada o cuenta por pagar. Versión, hash y confirmación humana obligatorios. Una modificación material exige una nueva revisión.
- Registro compartido con el formulario, idempotencia durable, protección por factura/proveedor y consulta del comprobante después de perder una respuesta. Una factura vinculada a recepción de OC no ingresa stock nuevamente.

## Contratos y módulos

`shared/assistant.ts` contiene los DTO. `backend/routes/assistant*.ts` autentica y valida entradas. `backend/services/assistant/access.ts` revalida usuario activo, tenant, rol e interruptores. Conversaciones y adjuntos son privados por tenant, usuario y rol de creación. Cambiar el rol impide recuperar contenido anterior de ese rol; no se migra historial sensible automáticamente. Las respuestas del asistente usan `Cache-Control: private, no-store`; la PWA existente no cachea `/api/`.

| Perfil | Alcance inicial |
|---|---|
| Dueño, administrador y superadministrador | Ayuda, indicadores autorizados y compras. |
| Gerente | Ventas del negocio, inventario y compras; los indicadores contables conservan la política existente. |
| Contabilidad | Información financiera y operativa de lectura; sin preparación ni ejecución de compras. |
| Caja, empleado y vendedor | Ayuda y ventas propias autorizadas. |
| Bodega y consulta | Ayuda e inventario sin costos. |
| Otros roles conocidos | Ayuda de sus módulos. |

El cliente no envía un tenant autoritativo. `PURCHASE_WRITE_ROLES`, `ACCOUNTING_READ_ROLES` y las políticas existentes mantienen la autoridad. El modelo de interpretación recibe preguntas propias acotadas, nunca un contexto financiero sin filtrar. Los documentos sólo se procesan para actores autorizados para compras.

| Interfaz bajo `/api/assistant` | Función |
|---|---|
| `GET /capabilities` | Capacidades vigentes; apagado no consulta tablas nuevas. |
| `POST /conversations`, `GET /conversations/:id` | Conversación privada y recuperación por referencia. |
| `POST /conversations/:id/messages` | Mensaje con `requestId` UUID y texto; sin herramientas de escritura. |
| `GET /overview` | Período opcional `startDate`/`endDate` y métricas autorizadas. |
| `POST /attachments` | Bytes originales, MIME admitido y nombre codificado en `X-File-Name`. |
| `GET /attachments/:id`, `GET /attachments/:id/download` | Metadata o archivo privado autenticado. |
| `POST /extractions`, `GET /extractions/:id` | Encolar una factura y recuperar estado durable. |
| `GET /catalog` | Coincidencias de productos, proveedores, bodegas y OC recibidas; máximo 20 por consulta. |
| `GET /proposals/:id`, `PATCH /proposals/:id` | Recuperar y revisar `{version,draft}`; el servidor aumenta versión. |
| `POST /proposals/:id/confirm` | Sólo `{version,idempotencyKey}`; el ID de propuesta está en la URL. |
| `GET /operations/:id` | Comprobante durable propio; 404 no demuestra que una solicitud incierta no se ejecutó. |

La confirmación no acepta un nuevo contenido financiero del navegador. En una única transacción se validan permisos y condiciones, se bloquean los recursos del dominio, se registra la compra, se mueve stock con `applyStockDelta`, se contabilizan efectos, se audita y se vinculan comprobante y originales. Ninguna llamada IA ocurre dentro de esa transacción. Las columnas/índices nuevos son aditivos en `backend/prisma/migrations/20260905_nortex_assistant/migration.sql`.

`purchaseRegistrationPreparation.ts`, `purchaseRegistrationPreview.ts` y `purchaseRegistrationAuthority.ts` separan preparación, efectos y autoridad. `purchaseRegistrationService.ts` ejecuta el registro; `routes/purchases.ts` conserva la respuesta HTTP del formulario. Éste genera una clave por intento y la conserva al reintentar el mismo contenido durante su sesión.

## Documentos, cola y costo

Límites: una factura por trabajo, máximo 10 MB en total, 10 páginas/imágenes y 200 renglones. Se validan firmas, contenido y límites de decodificación. Se rechazan PDF cifrados/incompletos, páginas sin lectura válida y archivos repetidos por SHA-256 dentro de un trabajo. Las páginas duplicadas dentro de un PDF también forman parte de la evaluación del modelo y requieren revisión; no se presume detección perfecta.

Moneda incompatible, flete, descuentos, diferencias de totales y ambigüedades bloquean la propuesta. No se crean proveedores, productos, unidades o lotes por suposición. Las correspondencias se eligen explícitamente del catálogo. Farmacia exige lote/vencimiento cuando lo requiere el producto; un lote existente con otro vencimiento se bloquea. Las advertencias deben resolverse antes de guardar una revisión apta.

`backend/workers/assistant.ts` se inicia con `mise exec -- npm run assistant:worker`. Usar inicialmente **un solo proceso worker**: el ejecutable procesa secuencialmente. El lease durable de cada trabajo impide que un intento viejo publique su resultado; vence a los 180 segundos, con máximo dos intentos y timeout del proveedor de 90 segundos. El mismo trabajo sólo publica una propuesta. Varios trabajos distintos del mismo documento pueden generar varios borradores y consumir lecturas adicionales; la protección financiera impide compras duplicadas. La recuperación nunca confirma compras.

Los archivos viven fuera del directorio público y del repositorio. `NORTEX_ASSISTANT_STORAGE_DIR` debe apuntar a un volumen privado persistente compartido por backend y worker. En producción se rechaza omitirlo; el directorio temporal de desarrollo no es almacenamiento de piloto. Directorios privados, archivos 0600, claves opacas, comprobación de bytes y SHA-256. No se usa Cloudinary ni el transporte del catálogo.

Limpieza horaria del worker: conversaciones de 30 días y adjuntos no confirmados de 7 días. Los originales vinculados a una compra no vencen. La transición `DELETING` compite mediante condiciones atómicas con la vinculación financiera, evitando borrar evidencia confirmada. Respaldar juntos MySQL y el volumen de archivos: guardar sólo una parte no permite recuperar las relaciones. El ensayo local de archivos descrito abajo no acredita recuperación operativa completa.

El presupuesto de NortexGPT se comparte entre interpretación de lenguaje y extracción: US$20 por mes de Managua, con límite de hasta US$10 por negocio piloto. Antes de cada llamada se reserva en MySQL; los reintentos tienen su propia reserva. Un consumo desconocido conserva la reserva. Un costo real superior al reservado se registra y bloquea nuevas llamadas. No se aumenta el límite ni se cambia a modelos más caros automáticamente. Las llamadas de otros canales existentes no pasan por este adaptador.

Modelo inicial: `claude-haiku-4-5-20251001`, sin reintentos automáticos del SDK ni caché de prompts. Reserva conservadora de contexto completo y salida. El precio configurado debe revisarse antes de habilitar el proveedor; un cambio de modelo, precio o prompt requiere repetir evaluación. Fuentes: [PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support), [precios](https://platform.claude.com/docs/en/about-claude/pricing).

## Activación y operación del piloto

Todos los interruptores están apagados por defecto. `NORTEX_ASSISTANT_ENABLED` gobierna el panel y consultas; `NORTEX_ASSISTANT_LANGUAGE_ENABLED` habilita interpretación con el proveedor; `NORTEX_ASSISTANT_EXTRACTION_ENABLED` habilita preparación/lectura; `NORTEX_ASSISTANT_EXECUTION_ENABLED` habilita confirmación. Además, cada negocio requiere configuración explícita en `AssistantTenantConfig`. No hay endpoint que permita al modelo o usuario ordinario habilitarse el piloto.

Secuencia pendiente de promoción:

1. Elegir exactamente un negocio de ferretería y uno de farmacia; verificar roles, documentos autorizados y presupuesto. No habilitar todos los tenants.
2. Aplicar la migración aditiva mediante el procedimiento vigente, preparar el volumen privado y verificar respaldo/restauración coordinada con MySQL.
3. Desplegar consultas primero; habilitar extracción después de evaluación real y revisión humana del corpus. Confirmación permanece separada hasta conciliar compras, stock, caja/deuda y asientos del mismo candidato.
4. Arrancar un worker. Observar cola por estado/antigüedad, intentos, latencia entre creación y finalización, errores por código, propuestas corregidas, duplicados y consumo reservado/liquidado. `AssistantJob`, `AssistantUsage`, `AssistantBudget` y `PurchaseCommand` conservan esa evidencia sin guardar prompts completos en logs.
5. Ensayar apagado de ejecución y extracción; verificar que Compras/POS habituales siguen disponibles, que un mensaje no ejecuta, y que los originales/comprobantes autorizados siguen recuperables cuando sólo se apaga ejecución.
6. CI y staging deben corresponder al mismo commit. Producción requiere autorización independiente. Esta entrega no realizó ninguno de esos pasos externos.

## Evidencia y límites

Verificación final: **4.072 pruebas generales aprobadas**, 140 omitidas que no se cuentan como aprobación; **154/154 casos de integración MySQL en 20 suites**, sin omisiones; **mutación global 99,88%**, con los 55 mutantes nuevos detectados; Prisma generate/validate, TypeScript, sistema de diseño y build aprobados. TypeScript también pasó en el checkout integrado.

La compuerta final y la huella de archivos se registran en `docs/evidence/nortexgpt/verification.json`. Los informes completos de ejecución local permanecen en `reports/` del candidato y no se confunden con CI remoto.

- Caracterización previa del handler de Compras antes de extraerlo: 7 escenarios ejecutados. Regresión de contratos de fecha, unidad, recepción, lotes, caja, impuestos e idempotencia conserva pruebas existentes.
- Migración SQL exacta aplicada sobre una nueva base con el schema inicial: 109 tablas conservadas y 9 añadidas; datos sintéticos preservados; comparación con schema final sin diferencias. [Evidencia](evidence/nortexgpt/migration.json).
- Integración HTTP/MySQL: 154 casos en 20 suites de la compuerta obligatoria, incluidas las nuevas suites de compras y propuestas; sin casos omitidos en esa compuerta. Se verifican transacciones, concurrencia, revocación, negocios distintos, factura repetida, pérdida de respuesta, CASH/CREDIT y OC recibida.
- La primera mutación global detectó cinco fallos del cálculo de consumo que se producían al importar el módulo y no quedaban atribuidos a un caso. La reparación de pruebas mueve la carga al cuerpo del caso para que ese fallo se contabilice, sin quitar mutantes ni bajar el umbral.
- Mutación dirigida: 55/55 mutantes detectados (100%) sobre costo IA, conciliación exacta de totales y hash canónico. Umbral global 99.85 preservado, con rangos y pisos nuevos. Gate global final: 5.173 instrumentados, 5.143 detectados por pruebas, 4 por timeout, 6 sobrevivientes históricos y 20 ignorados preexistentes; 99,88%, sin ampliar exclusiones. Los cinco casos nuevos antes no contabilizados quedaron detectados.
- Corpus: 100 documentos sintéticos (50 por vertical) generados y comprobados sin llamadas pagadas. **No acredita OCR real ni revisión humana**. Harness optativo, límites y evaluación de discrepancias en [NORTEXGPT_EVALUACION.md](NORTEXGPT_EVALUACION.md).
- Prueba de 50 reservas simultáneas en MySQL: 40 aceptadas de US$0.25 y 10 rechazadas al alcanzar el límite del negocio. La carrera inicial de upsert y el deadlock detectados fueron reparados.
- Consulta real de inventario: se reprodujo error MySQL 1064 por un alias reservado; se cambió y se añadió verificación con stock conocido. No se acreditan métricas sólo con mocks.
- POS: el caso previo de 20 productos excedía 5 segundos bajo carga y contaminaba casos posteriores con teclas pendientes. Se conserva el recorrido completo, se limita ese caso a 15 segundos y se cancela interacción al abortar, con prueba contra contaminación.
- Recuperación durable: dos procesos reales con MySQL 8.0.46. El primero se terminó con SIGKILL durante el proveedor inyectado; después de vencer explícitamente su lease, otro produjo una sola propuesta DRAFT y cero compras. [Evidencia y límites](evidence/nortexgpt/worker-recovery.md). No se esperaron físicamente los 180 segundos ni se llamó al modelo.
- Respaldo local de un PDF sintético de 900 bytes: original retirado antes de restaurar, bytes/SHA coincidentes, permisos 0600 y archivo alterado rechazado. **No** restaura MySQL ni prueba respaldo remoto.
- QA del panel: [escenarios y límites](evidence/nortexgpt/panel.md). Un navegador emulado no acredita cámara ni lector físicos.

No están demostrados: precisión y costos facturados con proveedor real; revisión humana de las 100 facturas; documentos reales de ambos pilotos; mejora de tiempo/errores frente al ingreso manual; restauración coordinada MySQL/volumen fuera del host; comportamiento de múltiples réplicas; CI remoto, staging y producción. Estas condiciones siguen siendo requisitos de avance del plan.

## Modularidad

Comparación contra el checkout preservado al iniciar esta implementación (incluye cambios previos del usuario):

| Archivo | Antes | Después | Delta |
|---|---:|---:|---:|
| `backend/server.ts` | 15 363 | 14 638 | −725 |
| `components/Layout.tsx` | 629 | 632 | +3, composición |
| `components/POS.tsx` | 6 949 | 6 949 | 0 |
| `components/Purchases.tsx` | 2 802 | 2 809 | +7, identidad de reintento |

Los cinco módulos destino de Compras suman 952 líneas: preparación 284, autoridad 57, servicio 475, preview 40 y ruta 96. Origen más destinos: +227 líneas netas; reducción del monolito: 725. La lógica de NortexGPT vive en módulos propios; no se elevaron presupuestos de líneas/estado ni se añadieron excepciones para aprobar pruebas.
