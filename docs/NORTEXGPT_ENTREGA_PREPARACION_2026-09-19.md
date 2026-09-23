# NortexGPT · entrega local y preparación de despliegue — 2026-09-19

**Candidato reunido y QA determinista aprobada; producción todavía no habilitada.**
La solicitud fue completar faltantes y preparar el deploy. Se cerraron la
consolidación A00, conflictos H01-2 y continuidad básica A01.W01.1–2. No se cierra
el roadmap completo ni se atribuye al modelo una calidad que aún no se evaluó.

## Artefacto y procedencia

- Candidato: `/Users/stark/Developer/Nortex/candidates/nortexgpt-release-ready-20260919`.
- Base: main `67f1832502ee68ef67ac12b0803bdbfce48a4cef`. El directorio es una copia
  ordinaria sin `.git`. Ese SHA no identifica los cambios nuevos.
- Paquete, parche y manifiesto:
  `/Users/stark/Developer/Nortex/release-evidence/ready-20260919/`.
  `delivery-manifest.json` identifica cada archivo y hash final;
  `nortexgpt-ready.patch` reconstruye la diferencia respecto de la base;
  `nortexgpt-ready.zip` contiene el parche, archivos modificados y evidencia resumida.
- Contratos: [A00/H01-2](CONTRATO_PREPARACION_NORTEXGPT_2026-09-19.md),
  [A01.W01.1–2](CONTRATO_W01_CONTINUIDAD_2026-09-19.md).
- Original preservado: 1.338 archivos inventariados sin cambios, rama, HEAD e índice
  iguales al inicio. No se modificaron las copias congeladas. La nota de entrega
  añadida al checkout sólo apunta a este artefacto; no integra producto allí.

La reconciliación conserva desde main marca de producto, bloqueos de lotes,
informes de cierre, tratamiento fiscal de compras, captura de existencias y POS.
No se copió sobre main el schema o los monolitos de un checkout anterior. Hay siete
migraciones aditivas nuevas; el schema suma 125 líneas. Falta ensayar upgrade y
recuperación desde la versión realmente desplegada, incluyendo sus backfills.

## Resultado implementado

| Necesidad | Comportamiento local | Límite |
|---|---|---|
| Candidato único revisable | Presupuesto US$2 con solicitud/aprobación, W01/W01B, RAG/editorial y compras reconciliados sobre main | No es commit, CI, staging ni versión para clientes |
| «Dije 50; la factura tiene 40» | Conserva ambas fuentes originales y bloquea revisión hasta decisión explícita. Guarda autor, motivo y versión; una edición invalida preview y resolución correspondiente | Correspondencia ambigua deriva a Compras. No crea cantidades recibidas o pagadas |
| Se perdió la respuesta al guardar | Lee la misma propuesta y sólo adopta la versión exacta con datos/decisiones coincidentes; conserva cambios locales si no puede acreditarla | No repite la escritura automáticamente ni interpreta una lectura como confirmación financiera |
| Retomar revisión de caja | Guarda un run propio como trabajo privado, con notas, espera, reanudación y cancelación. Eventos UUID/CAS y comprobante; recuperación de respuesta incierta | No asigna a otros usuarios, acepta informe final, corrige caja, agenda ni llama otra vez al modelo |
| Revocación de permisos de ayuda | Invalida fuentes y respuestas en curso según todas las capacidades y el alcance vigente | Requiere capacidades actualizadas por el servidor; no acredita actualización push instantánea |
| Identidad de catálogo | Revalida producto/proveedor antes de mostrar una confirmación habilitada, conservando selección exacta y carrito | UI comprobada con jsdom, sin recorrido móvil/escritorio real en esta entrega |

Los cálculos y efectos permanecen en los servicios de dominio. El modelo no recibe
herramienta de confirmación. Las lecturas del encargo no generan IA ni movimientos.
No se cambiaron flags, límites reales, credenciales, artículo publicado o datos de
clientes. No se hizo push, merge, dispatch, webhook o deploy.

## Pruebas ejecutadas sobre este conjunto

| Compuerta | Resultado y evidencia |
|---|---|
| Vitest determinista | **1.877/1.877**, 84 archivos, cero fallos/omitidos: `vitest-final.json`, `final-suite-list.json` y log |
| Prisma 6.4.1 | `validate` y `generate` aprobados, cliente generado desde schema reunido |
| TypeScript | `tsc --noEmit` aprobado |
| Sistema de diseño | `check-design-system.cjs` aprobado; presupuestos no elevados |
| Build de producción | `build:seo` aprobado, 71 rutas prerenderizadas y sitemap con 72 URLs; PWA 175 entradas. Advertencia existente de chunks mayores a 500 kB conservada |
| Control de promoción | 340 comprobaciones incluidas en las 1.877, con dobles; no son llamadas reales a Coolify ni despliegues |
| Fuente y preservación | Manifiesto completo, comparación contra main y `original-preservation.json`; ver verificación de parche |

Runtime Node 22.23.2 con `mise exec --`, npm y lockfile canónicos. Entorno de QA
con lista blanca y URL sintética sin servidor; sin heredar credencial del proveedor.
`quality-final.log` registra comando y código de salida de cada compuerta.
Los informes rojos previos se conservan como reproducción; `vitest-final.json`
identifica el resultado final, no un promedio ni suma de corridas repetidas.

La selección excluye los archivos `.integration.`; los tests que simulan una
transacción no prueban commit/rollback/concurrencia en MySQL. Las 59 pruebas de
servicio/ruta de encargos están incluidas en el total, no se suman otra vez.
La QA MySQL de candidatos anteriores conserva únicamente su alcance histórico.

## Modularidad

Comparación contra la misma base main, sin atribuir diferencias de otras ramas:

| Origen o conjunto | Antes | Después | Delta |
|---|---:|---:|---:|
| `backend/server.ts` | 13.190 | 13.177 | −13 |
| Nuevo `backend/routes/assistantMounts.ts` | 0 | 30 | +30 |
| Ambos archivos de composición | 13.190 | 13.207 | +17 |
| `backend/services/salesReportService.ts` | 994 | 933 | −61 |
| Nuevo `shiftSnapshotValidation.ts` | 0 | 95 | +95 |
| Ambos archivos de validación | 994 | 1.028 | +34 |
| `components/POS.tsx` | 5.895 | 5.895 | 0 |

El guardián de servidor baja a 13.177 y el de reportes a 933; no se suben
presupuestos ni excepciones. Las capacidades nuevas viven en módulos acotados.
El manifiesto registra también todos los destinos, pruebas/documentos y delta
completo; reducir el origen no se presenta como reducción del total del sistema.

## Qué falta y orden para desplegar

1. **QA de integración y migraciones.** La compuerta financiera obligatoria fue
   rechazada anteriormente por revisión automática de permisos. No se reintentó
   mediante otra herramienta, agente o CI. Quedan no ejecutadas para el conjunto
   MySQL 8 obligatorio, mutación pertinente, upgrade/reintento de SQL y restore.
   La evidencia simulada no permite aprobar registro de compras/presupuesto.
2. **Destino staging.** La CI de la base está aprobada, pero su staging falló al
   validar el destino Coolify antes del webhook. Hace falta el error saneado y
   contraste de configuración real; no se atribuye una causa por suposición.
3. **Operación del candidato.** Comprobar workers, permisos/volumen de originales,
   retención y restore conjunto; permisos de usuario/negocio, carrito y atajos en
   dispositivos. Verificar límites y señales bajo carga antes de prometer capacidad.
4. **SHA y promoción.** Tras cerrar compuertas, crear un commit del artefacto
   revisado sobre base vigente, CI terminal y staging del mismo SHA. La promoción
   sigue el [runbook](runbooks/release-promotion.md); la aprobación previa de otro
   candidato no publica éste. No se modifica el checkout sucio para lograrlo.
5. **Habilitación del producto.** Revisión de artículos/expected, evaluación real
   acotada y piloto por vertical; activación por capacidad. No es necesario afirmar
   que RRHH/MCP están terminados para entregar un W01 comprobado.

Los health leídos respondieron 200 con base disponible y versión anterior
`98e54afad4bfa7a0ef5ae99c902102d40d0400ff` tanto en staging como en producción. Los
runs/horas están en el [expediente de release](NORTEXGPT_PREPARACION_DEPLOY_2026-09-19.md).
Ninguno acredita el candidato nuevo. No se ensayó capacidad del Droplet ni
respaldo actual en esta entrega.

## Pendientes de producto conservados

A02.W01.3–4: informe, excepciones, fuentes revalidadas y aceptación final; pruebas
reales de continuidad tras reinicio. H01-3/4: recepción parcial, abonos/anticipos
con contratos separados. RAG: 12 artículos LEGACY disponibles; 48 borradores
pendientes de revisión humana, benchmark y publicación. Un borrador editorial sin
enviar puede perderse al salir de SuperAdmin. Modelo real y piloto no evaluados.
W02/W03, MCP externo y demás capacidades siguen el [roadmap](ROADMAP_AGENTES_NORTEX.md).
