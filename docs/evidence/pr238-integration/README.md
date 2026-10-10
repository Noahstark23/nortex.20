# Integración #238, 2026-10-10

Base main86549b5196417d7461bf9011f4df6c259a8200f7 y head original2cafa051b2665d8be8dbb4687e5fb8db61eaebbb. Se conservan ambas entradas de docs/README.md y las reglas de release vigentes. H2 queda fuera: el cálculo de aguinaldo preserva360, fechas/timestamps y redondeo de main por ruta. La extracción anual H8 mantiene pago/asiento/auditoría atómicos.

El manifest adjunto contiene los hashes fuente y cliente, receipt real de MySQL8.0.43 sintético, metadatos de las siete consultas canónicas y expansión histórica de staging/production. Staging aplica dos migraciones nuevas; production conserva tres WA y agrega las dos nuevas. Los contratos describen destinos reproducidos, no migraciones aplicadas a bases reales.

Las pruebas y CI de este candidato se registran por separado con sus SHA/tree y logs en la entrega de revisión. Este documento no acredita PASS antes de ejecución, revisión independiente, merge, staging o producción. No se fusiona #256 ni se modifica #222 en este corte.
