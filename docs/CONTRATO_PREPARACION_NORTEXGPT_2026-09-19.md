# Contrato de preparación de NortexGPT · A00 y H01-2

## Resultado y autoridad

- Solicitud: completar faltantes y preparar el despliegue. Este lote corrige la
  sustitución de hechos entre conversación y factura, consolida dependencias
  verificadas y prepara controles de promoción. No autoriza desplegar este candidato.
- Cierre observable H01-2: 50 declarado y 40 facturado permanecen como fuentes
  separadas hasta una elección humana explícita. Quitar advertencias o editar la
  cantidad no sustituye esa elección; se invalida la revisión al cambiar datos.
- Usuario: mismo negocio, usuario y rol de la propuesta, con permisos actuales.
  El modelo no resuelve ni confirma. No se amplían permisos ni flags.
- Producto: responsable de Nortex; revisión A/B/C ya recibida con precisiones.
  Revisión editorial completa, expected del modelo y aceptación del piloto pendientes.
- Efectos nuevos: estado auxiliar de una propuesta, sin movimientos financieros o
  de existencias. Recepción parcial y anticipo previo siguen fuera de este contrato.

## Fuentes, continuidad y límites

- Base de H01-2: copia ordinaria `nortexgpt-ready-20260919` del checkout, inventario de 1.338
  archivos y hashes en `release-evidence/ready-20260919/baseline.json`. No es rama,
  worktree ni candidato de producción. H01-1 se conserva completo.
- Fuente documental y declaración originales se guardan por el servidor en JSON
  de procedencia; el navegador sólo envía decisiones, nunca reemplaza esas fuentes.
- Decisión explícita por conflicto: fuente elegida y explicación humana. Identidad
  de conflicto estable; las fuentes no se borran después de resolverlo. Los renglones
  ambiguos bloquean y se derivan a Compras; no se emparejan por semejanza.
- Ninguna fuente prueba recepción o pago. Cantidad desconocida se conserva vacía;
  un cero explícito permanece distinto. No sumar comprado, facturado y recibido.
- PATCH conserva versión/CAS, tenant/usuario/rol y caducidad. Un cambio invalida
  preview/hash. Una respuesta incierta se recupera leyendo la propuesta y su versión.
- Conflictos pendientes se pueden guardar como DRAFT; no invocan el cálculo de
  compra. Resolver los conflictos no registra nada. Confirmación conserva el
  contrato existente y debe rechazar cualquier evidencia pendiente o incoherente.
- Retención de propuesta: siete días conforme al servicio existente; originales
  vinculados a compras mantienen su política. No logs con documentos completos.
- Costo nuevo: US$0; QA sintética, sin proveedor. Esperar/recargar no llama al modelo.
- RAG y W01 sólo se integran por lista exacta de dependencias; evidencia histórica
  no se atribuye a esta base. A00 se registra en la entrega reunida; no acredita promoción.

## Responsabilidad de edición

| Responsable | Archivos permitidos | Contrato |
|---|---|---|
| Integrador raíz | `shared/assistant.ts`, `shared/assistantDocumentReview.ts`, `hooks/useNortexAssistant.ts`, package/lock, documentos de estado/roadmap y esta ficha | DTO y coordinación; integración mínima con H01-1 |
| Backend | `backend/services/assistant/purchaseDocumentContext.ts`, `purchaseDocumentReview.ts`, `purchaseSource.ts`, `proposals.ts`, `worker.ts`, `backend/routes/assistantDocuments.ts`, `assistantProposals.ts`, tests de esos módulos | Procedencia inmutable, decisiones y versiones |
| Interfaz | `components/assistant/AssistantInvoiceReview.tsx`, nuevo `AssistantDocumentConflicts.tsx`, tests de UI de conflictos | Elegir/revisar/guardar fuentes sin perder trabajo |
| Release | `.github/workflows/ci.yml`, `release-staging.yml`, `release-production.yml`, cuatro scripts de autorización/verificación de release, runbook, skill deploy y tests correspondientes | Promoción manual, validación exacta de destino, sin deploy |
| QA independiente | Revisión y nuevos tests de conflictos, sin editar archivos de otros responsables | Intentos de borrar fuentes, concurrencia, aislamiento, recuperación |

No ampliar monolitos. No hay extracción prevista ni aumento de presupuestos.
Mantener la protección existente del panel/lector/carrito y referencia de operación.

## Evidencia y condición de salida

La [entrega](NORTEXGPT_ENTREGA_PREPARACION_2026-09-19.md) registra reproducción
50/40, QA determinista de backend/UI, Prisma, TypeScript, diseño y build de
producción ejecutados. Esta ficha por sí sola no es evidencia de aprobación. La compuerta financiera anterior fue rechazada por revisión
automática; no se reintenta ni se sustituye con estas pruebas de estado auxiliar.

CI, staging, producción, restauración, evaluación real y piloto se registran por
separado. Entregar manifiesto/parche, matriz de procedencias y bloqueos concretos.
Conservar rama, índice, archivos ajenos y candidatos congelados.

## Reconciliación A00

La base del artefacto de release es `main` 67f1832502ee68ef67ac12b0803bdbfce48a4cef,
copia ordinaria `nortexgpt-release-ready-20260919` de 1.643 archivos, inventariada en
`main-baseline.json`. Conserva ProductBatchHold, ShiftCloseReport y promoción manual.
La copia de checkout sólo se usa para desarrollar H01-2; su parche se integra
selectivamente. No se reemplaza el esquema ni monolitos de main con versiones antiguas.
