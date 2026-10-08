# Candidato de bodega, marca y cámara — 2026-09-12

Estado: PR #215 en draft, CI pendiente; no desplegado. Base remota: `8b41ef1fb37dbe86405bae696ed2228ba2ee4dca`.

Integra los tres cambios locales de bodega, experiencia de recepción y marca/lector sobre main vigente. Conserva disponibilidad farmacéutica, refresco por IDs, imágenes, tratamiento de IVA y precio de venta de compras. El checkout original y las demos locales permanecen intactos.

## Verificación del candidato combinado

- TypeScript: aprobado.
- Vitest: 443 suites, 6.282 casos aprobados; 45 suites y 400 casos omitidos, que no cuentan como aprobados. Corrida final con dos workers tras corregir conflictos e aislamiento de fixtures.
- MySQL 8 descartable: 46 suites, 414 casos aprobados, cero omisiones. Evidencia en `docs/evidence/bodega-release-20260912/integration-summary.json`.
- Diseño: 113 archivos, sin incumplimientos.
- Build de producción y prerender: aprobados; 71 rutas y sitemap de 72 URLs.
- Mutación dirigida: 365/365 detectados, 100%, sin sobrevivientes ni casos sin cobertura, sobre seis módulos/rangos afectados. Reproducible con `mise exec -- npx stryker run stryker.bodega.config.mjs`. La corrida global se interrumpió al detectar un rango desplazado por tres líneas en schemas; no se acredita. Se corrigió el rango completo de canonicalizeCloseShiftPayload a 871–883 y se conservó el umbral global de 100, con los dos helpers nuevos dentro de su alcance.
- Servidor: 14.131 → 13.190 líneas; POS: 5.924 → 5.895. Presupuestos reducidos, sin excepciones adicionales.

Las capturas de las entregas anteriores acreditan sus candidatos locales, no este candidato combinado ni producción. La cámara física, permisos de Android/iOS y lectura óptica requieren prueba en dispositivo real.

## Compatibilidad resuelta

Se conserva la proyección de stock vendible en la ruta extraída de catálogo y el mapper común del POS. Las cotizaciones históricas sin modo no se reinterpretan como enteras. La compra de contado exige caja propia, pero una factura OC conserva el orden de validación de trazabilidad previo al rechazo por falta de caja. La recepción mantiene IVA/no traslación y precio opcional; el borrador incluye su decisión fiscal. Las órdenes inválidas conservan el carrito y muestran el error.

El schema solo agrega `Product.brand`, índice tenant/marca y `StockCountItem.bookStockAtCapture`, ambos campos opcionales. No se ejecutó DDL sobre bases reales.

## Promoción pendiente

La solicitud del usuario fue «despliega entonces para verificarlo». Las rutas vigentes son `release-staging.yml` y `release-production.yml`. No se han invocado. Falta verificar acceso al panel, respaldo off-site fresco y restaurable, pin Coolify del candidato, CI del SHA final, staging y smoke del mismo SHA antes de promover producción.

La consulta pública previa confirmó API/MySQL disponibles en `07f30c9a2f372abfeb31c2e3ae0c1c8fae7818fc`. Es la referencia observada para recuperación de aplicación; no se autoriza ni ejecuta rollback aquí. No se leyeron credenciales ni datos de comercios.
