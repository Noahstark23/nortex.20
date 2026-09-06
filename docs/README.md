# Documentación de Nortex

Actualización: 2026-09-04. La prioridad actual es primera venta, uso recurrente y soporte confiable para ferreterías/farmacias. Un documento de diseño no acredita implementación, despliegue ni uso efectivo.

## Dirección y evidencia actual

**Preparación actual:** [Candidato POS, caja y calidad](releases/2026-09-04-pos-release-candidate.md), [compuerta de producción](releases/2026-09-04-production-gate.md) y [siguiente entrega de Stock, cámara y RAG](PLAN_STOCK_RAG_CAMARA_2026-09-04.md). Candidato integrado local; CI remoto, staging y producción son etapas pendientes.

**Entrega local anterior a la integración:** [Reparación de prioridades y verificación por módulo](VERIFICACION_MODULOS_2026-09-04.md). Estado E01–E08, dinero/stock/permisos, QA MySQL, navegador y nuevos pendientes M01–M07. Conserva el [rediseño aceptado](REDISENO_POS_2026-09-04.md). Piloto y publicación siguen separados.

1. [Plan de transformación](PLAN_TRANSFORMACION_TOTAL_2026.md): programa maestro, hipótesis comerciales, backlog T00–T19 y criterios de decisión.
2. [Dirección UX y validación operativa](PLAN_DIRECCION_UX_Y_VALIDACION_2026.md): cuatro funciones de dirección, skills, contrato Apple/web, veinte escenarios y gates; incluye [ficha común de entrega](templates/CONTRATO_ENTREGA_VERIFICADA.md). Estado y evidencia E01–E08 en el informe por módulo; no es certificación global.
3. [Auditoría general](AUDITORIA_GENERAL_2026-09-04.md): checkout, pruebas ejecutadas, riesgos G01–G16 y límites.
4. [Activación y modularidad, 2026-09-04](ACTIVACION_Y_MODULARIDAD_2026-09-04.md): implementación local parcial de T04/T14, archivos, deltas y estado de QA; no cierra cohortes T03 ni acredita producción.
5. [Onboarding y retención](ONBOARDING_RETENCION.md): estado vigente y medición por cohortes.
6. [Infraestructura WhatsApp](WHATSAPP_INFRA.md): implementación y brechas actuales.
7. [Migración backups/RAG/WhatsApp](PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md) y [ADR](architecture/ADR-2026-08-27-backups-rag-scaling.md): diseño incremental; identidad/handoff se exigen antes del piloto.

## Planes de dominio que se conservan

| Dominio | Documento | Uso en este ciclo |
|---|---|---|
| Caja y contabilidad | [Cierre profesional](PLAN_CIERRE_CAJA_PROFESIONAL_DGI_CONTABILIDAD.md) | Priorizar integridad del recorrido real; cumplimiento profesional separado |
| Bodega/lotes | [Bodega confiable](PLAN_BODEGA_CONFIABLE_2026.md), [Bodeguero](PLAN_BODEGUERO_EXPERTO.md) | Farmacia y disponibilidad: verificar modo y UX antes de ampliar |
| POS | [Refactor Caja Nica](PLAN_REFACTOR_POS_CAJA_NICA.md) | Extraer por conducta preservada; no aumentar presupuesto |
| Compras/devoluciones | [ADR procurement](ADR_PROCUREMENT_DEVOLUCIONES_NOTAS_CREDITO.md) | Conciliar documentos/saldos y pruebas de datos |
| RRHH | [Plan RRHH Nicaragua](PLAN_RRHH_NICARAGUA.md) | Mantener trabajo existente; nuevas capacidades según demanda |
| Hardware | [Cámara/códigos](PLAN_CAMARA_CODIGOS_BODEGA.md), [Balanzas](PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md) | Simulación no acredita dispositivo físico; diferir expansión no requerida |
| Móvil | [App móvil](PLAN_APP_MOVIL.md), [Tiendas](PLAN_MOBILE_STORES.md) | Priorizar PWA/dispositivos actuales antes de nuevas publicaciones |
| Verticales | [Comercios híbridos](PLAN_COMERCIOS_HIBRIDOS_CARNES_AGROPECUARIA.md), [Prestamistas](PLAN_PRESTAMISTAS.md), [Agente bancario](PLAN_AGENTE_BANCARIO.md) | Conservar y atender defectos de clientes existentes; expansión diferida |

## Historial que requiere revalidación

- [Auditoría de escalado](SCALING_AUDIT.md) y [desacople](PLAN_DESACOPLE_ESCALABILIDAD.md): números y recomendaciones históricas corregidas por la auditoría actual.
- [Auditoría de seguridad](SECURITY_AUDIT.md) y [remediación](SECURITY_REMEDIATION_PLAN.md): conservar IDs; verificar cada hallazgo/fix contra código y pruebas antes de declararlo vigente/resuelto.
- [UX y retención](AUDITORIA_UX_RETENCION.md) y [UX profunda](AUDITORIA_UX_PROFUNDA.md): evidencia de agosto; varias fricciones ya tienen cambios locales.
- [Auditoría DGI](AUDITORIA_DGI.md), [manual técnico DGI](MANUAL_TECNICO_DGI.md) y [QA previo](QA_REPORT.md): alcance y fecha propios; no son certificación legal ni resultado de esta auditoría.

Las notas de `releases/` documentan un evento concreto. No usar un SHA/CI antiguo como estado del checkout actual.

## Cómo mantener los MD

Toda iniciativa debe tener dueño, fecha, alcance, estado, evidencia y siguiente condición de salida. Estados permitidos: PROPUESTO, IMPLEMENTADO_LOCAL, VALIDADO_LOCAL, VALIDADO_STAGING, VALIDADO_PRODUCCION, HISTORICO. Para validaciones guardar SHA **y** diff/manifiesto si había cambios, ambiente, comando, resultado, omisiones y fecha. “Aprobado para planificar” no equivale a permiso para enviar mensajes o desplegar.

El plan maestro decide prioridades; los planes de dominio detallan la implementación; AGENTS/CLAUDE mantienen reglas de seguridad/integridad. Si se contradicen hechos o recetas, detener la receta, verificar código y registrar la decisión. Ningún informe puede declarar seguridad o cumplimiento global por una prueba parcial.

No indexar todo docs en el RAG de clientes. Solo fuentes de ayuda revisadas, vigentes y aprobadas para esa audiencia, con permisos y propietario. Auditorías, planes aspiracionales e instrucciones de ingeniería quedan fuera del corpus público.
