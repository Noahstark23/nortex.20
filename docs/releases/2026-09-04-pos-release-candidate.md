# Candidato POS, caja y calidad — 2026-09-04

Actualización posterior: [publicación, CI y avance de main del 5 de septiembre](2026-09-05-pos-publication-ci.md).
La base y la evidencia de abajo describen la preparación inicial.

Estado: preparación local. Este documento no autoriza publicación ni promoción.
La evidencia final y la identidad del árbol se entregan en el paquete de release;
los informes anteriores de esta fecha describen snapshots distintos.

## Alcance

Se integra el trabajo local de activación, POS y avisos con
`2834497f6090c2d55bcc48d5edb86887f6993ae3`. Se conservan el cierre profesional,
reportes de ventas, disponibilidad farmacéutica, seguridad de Entregas y páginas
públicas de esa base. El schema y las migraciones no cambian respecto de main.

El POS compone catálogo, búsqueda, resultado de venta y recuperación offline en
módulos separados. La consulta de catálogo conserva la disponibilidad vendible
autoritativa, incluido cero. La cola distingue venta guardada de confirmada y
reutiliza su identidad de reintento. Avisos reúne problemas operativos y recuperación
sin crear otro motor de ventas. La activación muestra el siguiente paso hacia una
venta confirmada. La comprobación visual anterior no prueba el candidato integrado.

## Reparaciones financieras de la integración

- Cierre: persiste evento y huella junto al reporte Z. El mismo intento devuelve
  el reporte existente; cambiar importe, actor o identidad produce conflicto.
  El histórico sin huella sigue consultable sin reinterpretarlo como un reintento.
  USD conserva cuatro decimales en cálculo, persistencia, reporte y auditoría;
  NIO conserva dos.
- Movimiento manual: la validación conserva la moneda recibida y limita importe
  a dos decimales y a la capacidad de la columna. El formulario actual envía NIO.
  Una solicitud USD por API recibe `CASH_MOVEMENT_USD_UNSUPPORTED` sin efectos;
  se necesita un contrato de conversión antes de admitirla. Este control no cambia
  pagos de ventas ni las operaciones de agente bancario.
- Anulación manual: bloquea primero el turno, vuelve a leer el movimiento y aplica
  la anulación, reverso contable y auditoría dentro de una sola transacción. Un gasto
  original se conserva y recibe una compensación negativa identificable; el reporte
  de gastos y resultados suman ambos. No se elimina el asiento ni la firma original.
  Reintentos con el mismo motivo no duplican el reverso. Se rechazan caja/períodos
  cerrados, movimientos derivados de otros documentos, evidencia histórica ambigua,
  usuarios ajenos y entradas consumidas que dejarían efectivo negativo.

La revisión funcional exige creación → anulación → reportes, dos anulaciones
concurrentes, reintento y rollback ante error contable con HTTP y MySQL 8 reales.
No presentar las pruebas puras ni los casos omitidos como sustitutos de ese ciclo.

## Publicación y promoción

1. Revisar el parche limpio contra la base y su SHA. Preservar el checkout original
   y sus cambios; el candidato vive en un worktree separado.
2. Publicar la rama y PR cuando se autorice. Exigir CI del SHA resultante: tipos,
   tests, mutación al 100 % y alcance protegido, diseño, build SEO, integración
   obligatoria, upgrade histórico y restauración de backup.
3. Antes de merge o cualquier promoción, volver a consultar main, ejecuciones
   pendientes y configuración real. Un avance de main requiere integrar y verificar
   otra vez. Merge a main puede desplegar staging.
4. Verificar staging saludable, DB y SHA exactos; ejecutar smoke financiero con
   tenant sintético autorizado. Revisar también el POS integrado en navegador.
5. Cumplir la [compuerta de producción](2026-09-04-production-gate.md): intención
   manual para SHA completo, environment, pin de Coolify y auto deploy desactivado.
   Una aprobación de PR o staging no autoriza producción.
6. Tras autorización y promoción: salud, DB, SHA y smoke financiero; observación
   de 30 minutos. Registrar tiempos, resultado y responsable de la decisión.

## Contención y rollback

Un descuadre de caja, duplicación, pérdida de stock, acceso entre negocios o SHA
inesperado detiene la promoción. Conservar evidencia y cerrar el flujo afectado.
No editar asientos, borrar gastos compensatorios ni restaurar una base poblada como
atajo. Un respaldo exige restauración comprobada antes de usarlo como recuperación.

La ausencia de cambios de schema permite preparar reversión de aplicación al SHA
previo, pero no demuestra compatibilidad de todas las escrituras nuevas. Después
de una anulación registrada por este candidato, volver al backend antiguo vuelve a
habilitar la anulación defectuosa: deshabilitar ese flujo o mantener el hotfix antes
de un rollback. Verificar ledger, mayor, gastos y cierre con las operaciones que
ya ocurrieron; usar reversos explícitos cuando haga falta corregir dinero.

## Siguiente bloque

[Stock, cámara y RAG](../PLAN_STOCK_RAG_CAMARA_2026-09-04.md) tiene una entrega
separada. Primero identificación exacta y cantidades; después recepción recuperable
y cámara de códigos. Datos operativos del RAG vienen de consultas autorizadas y
actuales. El simulador de cámara no acredita lectura física en teléfonos.
