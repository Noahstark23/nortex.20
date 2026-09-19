# NortexGPT: cierre local y prioridades de infraestructura

Fecha: 2026-09-08. Revisión del checkout con cambios existentes en `codex/caja-nica-retention`; no representa producción. Dos agentes revisaron modularidad e infraestructura en modo de solo lectura y un integrador revisó RAG y evidencia. Esta revisión no ejecutó nuevas pruebas ni modificó producto.

## Entregado y comprobado en la sesión

- QA local aislado: Prisma generate/validate, TypeScript, sistema de diseño y build aprobados; 4.814 pruebas generales aprobadas y 286 omitidas. Integración obligatoria: 300 casos MySQL 8, 35 suites, cero omitidos. Mutación: 99,88 %, con seis mutantes supervivientes. Los omitidos no cuentan como aprobados.
- Corregida la atribución del verificador: iteraciones o reservas no demuestran contacto con el proveedor; el costo requiere enlace explícito a la ejecución. Añadidas pruebas de concurrencia, liquidación incierta y corte mensual Managua.
- Corpus determinista: 120 escenarios; integridad de 100 facturas verificada. Esto no acredita calidad de extracción con el modelo real.
- Demo sintética: conversación de compra, interrupción con consulta del negocio, recuperación y conservación del carrito; bloqueo de F9 detrás del asistente. No se probó un lector físico.
- Aviso local «Conocé NortexGPT»: abre el asistente según capacidades, conserva el carrito y no inicia llamadas pagadas. Esta entrega posterior tuvo 61 pruebas focalizadas y 4.821 generales aprobadas, 286 omitidas, TypeScript, generate, diseño y build. La integración financiera anterior no se repitió para este cambio de UI.
- Configuración asistida de Nortex-QA con límite mensual US$5 y recarga automática observada apagada. La evidencia termina en la entrega al usuario para crear la clave; no acredita la configuración posterior de Coolify. Cero llamadas reales realizadas por estos trabajos.

Evidencia: [QA](evidence/nortexgpt/qa-live-20260908/summary.json), [aviso](evidence/nortexgpt/aviso-20260908/summary.json), [configuración y aviso](NORTEXGPT_AVISO_Y_CONFIGURACION_2026-09-08.md). Son candidatos locales sucesivos: no sumar corridas ni presentar un resultado como cobertura del otro candidato. Piloto, evaluación con Haiku real, CI remoto, staging y despliegue siguen sin acreditarse aquí.

## Estado del RAG

| Capa | Código observado | Límite actual |
|---|---|---|
| Ayuda interna | 12 artículos curados en código, versión/sección/referencia; normalización de acentos, búsqueda por palabras, filtro por rol previo y hasta dos resultados. Rechaza preguntas sin coincidencias. | Corpus pequeño; no es ingestión de manuales ni búsqueda semántica general. Falta medir recuperación con preguntas reales, paráfrasis y fuentes contradictorias revisadas por una persona. |
| Catálogo interno | Búsqueda por nombre/SKU, alias aprobados y aproximación acotada; aislamiento por negocio y elección humana ante ambigüedad. | No acredita comprensión clínica o equivalencia de presentaciones. |
| Consultas del negocio | Herramientas cerradas y autorizadas; resultados vuelven al orquestador, con hasta cuatro iteraciones y 60 segundos. Confirmación fuera de las herramientas del modelo. | Las cifras provienen de servicios deterministas; la calidad de las explicaciones con Haiku real sigue pendiente. |
| WhatsApp comercial | Recuperación FULLTEXT de catálogo con fallback LIKE, separada del asistente privado. | No confundir búsqueda de productos con RAG documental ni con durabilidad del transporte. |

Fuentes: [ayuda](../backend/services/assistant/knowledge.ts), [catálogo](../backend/services/assistant/operations/catalogSearch.ts), [orquestador](../backend/services/assistant/operations/orchestrator.ts), [catálogo comercial](../backend/services/whatsapp/rag.ts).

Próximo criterio de calidad del RAG: preguntas reservadas con fuente esperada y revisión humana; medir respuestas respaldadas, rechazos correctos, recuperación por rol y errores de interpretación. Ejecutar después evaluación acotada con Haiku y registrar costo enlazado a ejecución. Incorporar embeddings solo si una comparación demuestra una mejora útil sobre la recuperación actual.

## Riesgos priorizados

| Prioridad | Evidencia estática | Trabajo y cierre exigido |
|---|---|---|
| Alta: recepción comercial durable | El webhook comercial responde 200 antes de persistir; `InMemoryQueue` pierde pendientes al reiniciar; el envío precede al registro de salida. | Inbox/outbox persistentes y estado incierto. Inyectar reinicios entre cada paso, duplicados y pérdida de respuesta; ninguna entrada aceptada perdida ni reenvío incierto automático. El canal privado ya tiene persistencia previa al 200 y outbox: conservar esa separación. |
| Alta: recuperación y workers | Compose versionado no incluye workers del asistente ni volumen privado de originales; el backup SQL no incluye esos archivos. Existe evidencia de restauración local sintética. | Verificar composición real de Coolify sin exponer secretos; contrato API/worker/volumen y respaldo SQL+archivos. Restaurar en destino aislado y conciliar referencias, hashes y operaciones; medir pérdida máxima y tiempo de recuperación. No se ha demostrado ausencia de backup en producción. |
| Alta: pools MySQL | 11 construcciones de Prisma en código runtime, diez fuera del cliente compartido. Esto no significa once conexiones medidas ni demuestra saturación actual. | Consolidar por grupos, conservar instrumentación del servidor; probar transacciones, pool de una conexión, concurrencia y conexiones máximas. Rate limiter y caché por proceso también deben resolverse antes de asumir escalado horizontal. |
| Media: acoplamiento | `server.ts`: 14.266 líneas, 183 registros HTTP directos por regex; `POS.tsx`: 6.892 líneas. El asistente ya se compone desde módulos separados. | Extraer dominios después de caracterizarlos; reducir presupuestos en el mismo cambio y medir origen/destinos/total. El tamaño no prueba una caída futura, pero amplía el alcance de regresiones y dificulta revisión. |
| Media: exportación fiscal | Ventas mensuales cargadas sin paginación y `XLSX.write` dentro del handler. | Prueba de volumen y memoria/latencia; separación conservando formato y valores. No hay degradación reproducida en esta revisión. |

Referencias: `backend/services/whatsapp/webhook.ts:63`, `queue.ts:19`, `inbound.ts:103`; `backend/routes/assistantPrivateWhatsapp.ts:29`; `backend/lib/prisma.ts:16`, `backend/server.ts:239`; `docker-compose.yml:42`, `scripts/docker-entrypoint.sh:130`, `backend/workers/assistant.ts:12`, `backend/services/assistant/attachments.ts:21`; `scripts/backup-db.sh:99`, `scripts/verify-backup-restore.sh:65`; `backend/server.ts:13915` y `:13964`.

## Responsables y lotes de trabajo propuestos

Las dos auditorías solicitadas ya terminaron. Estos contratos organizan las siguientes implementaciones; no crean vigilancia permanente ni habilitan despliegues.

| Responsable | Propiedad de edición propuesta | Primer resultado revisable |
|---|---|---|
| Clean Code | Nuevos `components/pos/PosQuickProductDialog.tsx`, `hooks/usePosQuickProduct.ts` y pruebas propias; después rutas/servicios de conteos físicos y exportaciones, en lotes distintos. | Alta rápida POS conserva validación, borrador ante fallo, doble envío y bloqueo de lector/atajos. Conteos requieren aislamiento por bodega, concurrencia, período cerrado y rollback de auditoría antes de extraer. |
| Infraestructura | Módulos consumidores de Prisma por lote acordado; implementación comercial durable, workers, respaldo y pruebas propias en entregas separadas. | Un lote pequeño comparte Prisma conservando conducta; inventario de ejecución/recuperación del asistente y ensayo aislado. No editar servidor, schema o despliegue compartido simultáneamente. |
| Integrador | Único editor de `backend/server.ts`, `components/POS.tsx`, schema/migraciones, archivos de despliegue y presupuestos de pruebas. | Contratos acordados antes de delegar; integrar sin perder cambios actuales y revisar evidencia por candidato. |

Orden recomendado: verificar restauración y composición del asistente antes de ampliar activación; cerrar durabilidad comercial antes de prometer continuidad de ese canal. En paralelo independiente, comenzar una consolidación pequeña de Prisma y una extracción acotada de POS con propietarios distintos.

Red existente para caracterizar: `tests/posActivationFlow.test.tsx`, `tests/posActivation.test.ts`, `tests/posVentaCritica.test.tsx`, `tests/stockCountWarehouse.integration.test.ts`, `tests/fiscalFlow.integration.test.ts`. Algunas pruebas inspeccionan texto de `server.ts`: trasladar sus garantías al módulo correspondiente o a pruebas de conducta, sin simplemente eliminarlas.

Cada extracción reportará líneas del origen, destinos y conjunto, sin aumentar presupuestos o excepciones. Dinero/inventario requieren integración obligatoria MySQL sin omitidos y mutación pertinente, además de la compuerta habitual. Cambios de producto, pruebas ejecutadas, evaluación de IA, piloto y despliegue se documentarán por separado.
