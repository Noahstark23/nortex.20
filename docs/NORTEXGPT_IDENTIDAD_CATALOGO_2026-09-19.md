# H01-1: identidad de catálogo en NortexGPT

Corte: **2026-09-19**. Estado: implementación y QA local; parche limitado
reintegrado en el checkout original después de comprobar hashes. No desplegado.

## Resultado y procedencia

La captura distingue producto/proveedor por su ID autorizado. Conserva lo declarado
por la persona, muestra datos existentes para distinguir opciones y exige verificar
la ficha exacta antes de calcular o aprobar efectos. Una página de resultados no
puede sustituir esa verificación. No selecciona el primer homónimo.

Base: copia ordinaria de `/Users/stark/Documents/GitHub/nortex.20`, con 585 entradas
con cambios al inicio, sin cambiar rama, índice o worktrees. Candidato:
`/Users/stark/Developer/Nortex/candidates/nortexgpt-catalog-20260919`.
[Baseline y 1324 hashes](/Users/stark/Developer/Nortex/release-evidence/catalog-20260919/baseline.json).
Conserva `Product.brand` existente. No importa presupuesto/W01/editorial de otros
candidatos ni los sustituye; la consolidación general sigue pendiente.

## Conducta implementada

- Una proyección de identidad sirve al catálogo y la conversación: producto con
  nombre/SKU, marca, unidad, empaque, modo, paso y requisito de lote; proveedor
  con nombre/RUC/dirección. Sólo datos existentes y autorizados; sin costos/contactos.
- `GET /api/assistant/catalog?kind=products|suppliers&query=&selectedId=...`
  recupera exclusivamente ese ID del negocio autenticado. Se revalidan usuario,
  rol y capacidades antes y después. No hay búsqueda aproximada para resolver un ID.
- Nombres iguales requieren elección humana independiente. Una ficha visualmente
  indistinguible queda bloqueada incluso si su par no está en la página visible.
  Normalización de espacios y campos visibles evita diferencias falsas. Un catálogo
  grande con SKU/RUC/direcciones distintos sigue permitiendo elecciones inequívocas.
- Elegir una opción reconsulta su identidad actual. La búsqueda sólo puede invalidar;
  nunca rehabilita una selección rechazada. Respuestas antiguas o de otra sesión,
  versión o filtro no reemplazan la identidad vigente.
- Cambiar SKU, presentación o datos de proveedor invalida la revisión. La interfaz
  exige verificar y guardar otra versión para recalcular antes de confirmar. Una
  confirmación ya enviada conserva su referencia para recuperar el resultado incierto.
- Descripción original, cantidad y proveedor declarado permanecen separados del
  nombre de catálogo. Las aclaraciones de búsqueda no sustituyen hechos. No se
  reconstruye por inferencia texto perdido en capturas históricas anteriores.
- Las lecturas se deduplican por solicitud y ruta, con máximo cuatro simultáneas.
  Al desmontar, se cancelan las pendientes sin observadores; las activas terminan.
  No hay caché de resultados entre sesiones. Los valores del detalle se delimitan
  sin alterar los datos para evitar que un RUC parezca una dirección.
- El resumen bajo cada selector permite leer el detalle completo en móvil. Advertencias,
  falta de identidad y errores son visibles; no se interpretan como una elección válida.

No cambia importes, cantidades, estructura financiera de `InvoiceDraft`, schema,
transacciones ni el comando de confirmación del servidor. Cambia las condiciones
visuales para revisar y el texto documental conservado al formar un borrador.

## Responsables y módulos

| Responsable | Archivos editados |
|---|---|
| Integrador | `shared/assistantCatalog.ts`, tipo en `hooks/useNortexAssistant.ts`, `useAssistantInvoiceCatalogVerification.ts`, `AssistantInvoiceReview.tsx`, su suite, demostración y documentación |
| Backend | `catalogIdentity.ts`, `operations/catalogSearch.ts`, `operations/catalogOptions.ts`, `purchaseIntake.ts`, `purchaseIntakeTypes.ts` y pruebas focales |
| UI | `AssistantCatalogSelect.tsx`, `useAssistantCatalogSelection.ts`, transporte de lecturas y suites de selector/panel |
| QA independiente | `assistantCatalogIdentityIntake.test.ts`, `assistantCatalogIdentityUi.test.tsx`, fixture/launcher MySQL exclusivo de catálogo |
| Revisor | Lectura independiente; defectos comunicados a cada responsable, sin editar sus archivos |

Todos usaron la misma base; hubo un solo editor por archivo. `backend/server.ts` y
`components/POS.tsx` no se modifican. No se elevaron presupuestos ni excepciones.
El manifiesto final registra hashes, deltas de origen/destinos y total afectado;
la integración aplica sólo ese diff, nunca una sustitución del checkout completo.

## Tamaño y modularidad

Medición por líneas reales contra la copia inicial, sin elevar presupuestos:

| Conjunto | Antes | Después | Delta |
|---|---:|---:|---:|
| Backend afectado, incluido módulo nuevo de identidad | 433 | 551 | +118 |
| Frontend/shared afectados, incluidos módulos nuevos | 355 | 578 | +223 |
| Total de producto | 788 | 1129 | +341 |
| Pruebas, launcher y demostración | 1222 | 2537 | +1315 |
| Producto y QA juntos | 2010 | 3666 | +1656 |
| `backend/server.ts` | 13404 | 13404 | 0 |
| `components/POS.tsx` | 6853 | 6853 | 0 |

`AssistantCatalogSelect.tsx` conserva 50 líneas: los nuevos datos visibles compensan
la separación de lecturas. Destinos: hook de selección 85, transporte con cola 61,
verificación de revisión 52 e identidad backend 94. Durante la separación final del
transporte, el hook pasó de 97 a 85 y añadió 61 en el destino: conjunto +49.
El manifiesto desglosa también documentos, hashes y cada origen/destino. No se afirma
una reducción total de código ni una mejora de capacidad por esta modularización.

## Verificación y límites

La caracterización original dio 80 pruebas aprobadas. La reproducción independiente
registró tres fallos antes de reparar: primer proveedor homónimo y etiquetas de
producto/proveedor equivocadas fuera de la búsqueda. Se conservaron las pruebas
rojas y sus correspondientes resultados posteriores.

MySQL se usa en un contenedor descartable con cinco tablas mínimas: User,
AssistantTenantConfig, Product, Supplier y AssistantCatalogAlias. El ejecutor de
los servicios sólo tiene SELECT; las tablas no contienen costos/precios/stock.
El sembrado sintético es separado. Esta prueba acredita lecturas de catálogo,
no registro de compras ni conciliación financiera.

La demostración usa el componente real y respuestas de catálogo sintéticas; Guardar
sólo entrega el borrador a un callback local. No tiene backend, IA ni registro.
Se comprobó producto 2/proveedor 1, cambio de búsqueda, cantidad 50, textos originales
sin reemplazar y detalle completo a 390 píxeles. La regresión del panel usa jsdom;
no equivale a una prueba de POS completo en dispositivo físico.

Evidencia de esta entrega:
`/Users/stark/Developer/Nortex/release-evidence/catalog-20260919/`.

| Comprobación ejecutada | Resultado |
|---|---|
| Vitest focal + regresión de captura/panel | **324/324**, 13 archivos, cero fallos u omitidos |
| Catálogo MySQL 8.0.46, Prisma 6.4.1, Node 22.23.2 | **26/26**, credencial sólo SELECT, contenedor eliminado y comprobado |
| Prisma validate/generate | Aprobados con URL sintética sin base real |
| TypeScript, sistema de diseño y build | Aprobados; build conserva avisos de chunks mayores de 500 kB, sin elevar límites |
| Recorrido visual | Componente real con datos sintéticos, escritorio y viewport de 390 px |
| Revisión independiente | Hallazgos corregidos y relectura sin defectos concretos pendientes en este lote |

[Vitest final](/Users/stark/Developer/Nortex/release-evidence/catalog-20260919/vitest-final.json),
[calidad](/Users/stark/Developer/Nortex/release-evidence/catalog-20260919/quality-final.log),
[MySQL y EXPLAIN](/Users/stark/Developer/Nortex/release-evidence/catalog-20260919/mysql/2026-09-19T21-50-12.244Z.json).

Diagnóstico local con 20.000 productos (10.000 por negocio): 20 lecturas exactas,
120 consultas; p50 9,841 ms y p95 10,917 ms. EXPLAIN ANALYZE muestra acceso al
índice por tenant, corrigiendo el recorrido global anterior. La normalización sigue
con costo potencialmente lineal dentro del negocio; la fila devuelta después de
filtrar no prueba que se haya examinado una sola entrada. No acredita capacidad
del Droplet, carga simultánea del POS ni una cantidad de clientes soportada.

Se conservaron las reproducciones rojas de homónimos, espacios, selección sin
reconsulta exacta, texto original sustituido, separadores, 21 candidatos inequívocos
y 200 lecturas simultáneas. La compuerta financiera anterior no se reintentó.

## Qué falta para decir listo para clientes

1. Consolidar los incrementos verificados sobre un candidato único sin sobrescribir
   cambios; presupuesto US$2/W01/RAG editorial tienen procedencia distinta.
2. H01-2: conflictos y cantidades declaradas/facturadas/recibidas. H01-3/4: parciales
   y anticipos, con sus propios contratos y pruebas. Este lote no declara A/B/C completos.
3. Continuidad durable A01/W01, revisión editorial completa, expected humanos,
   evaluación real acotada y piloto con resultados de utilidad/costo.
4. Acreditar operación/promoción del candidato: restauración, rendimiento objetivo,
   CI y staging; producción conserva su autorización separada.

La compuerta financiera anterior fue rechazada por revisión automática y no se
reintentó aquí. No hay aprobación financiera ni de producción. Ninguna llamada
pagada, modificación de datos reales, push o despliegue forma parte de esta entrega.
