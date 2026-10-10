# Integración #238, 2026-10-10

Base main86549b5196417d7461bf9011f4df6c259a8200f7 y head original2cafa051b2665d8be8dbb4687e5fb8db61eaebbb. Se conservan ambas entradas de docs/README.md y las reglas de release vigentes. H2 queda fuera: el cálculo de aguinaldo preserva360, fechas/timestamps y redondeo de main por ruta. La extracción anual H8 mantiene pago/asiento/auditoría atómicos.

El manifest adjunto contiene los hashes fuente y cliente, receipt real de MySQL8.0.43 sintético, metadatos de las siete consultas canónicas y expansión histórica de staging/production. Staging aplica dos migraciones nuevas; production conserva tres WA y agrega las dos nuevas. Los contratos describen destinos reproducidos, no migraciones aplicadas a bases reales.

Las pruebas y CI de este candidato se registran por separado con sus SHA/tree y logs en la entrega de revisión. Este documento no acredita PASS antes de ejecución, revisión independiente, merge, staging o producción. No se fusiona #256 ni se modifica #222 en este corte.

## Segundo intento sobre main c8cc6ca

Base `c8cc6ca9bdc5637b0c00bdfa0b1a6727985412cc` (#257), sin resetear el primer intento ni su evidencia. Noel aprobó el 10-oct a las 04:05:57 UTC el guard mínimo de recibos conciliados y las dos suites demo. El reinicio asistido sigue en el panel modular y obtiene el dueño persistido del tenant visible; cuentas archivadas quedan fuera de métricas/listas operativas. Se preservan el bloqueo de identidad, contraseña, roles, auth y protección de proveedores de #257. Un recibo positivo conciliado de la cuenta o su raíz impide vista previa y confirmación; esta última vuelve a verificarlo.

El cliente propio Prisma6.4.1 mide158 modelos/1903 columnas escalares. MySQL8.0.43 desechable reproduce tanto main+#238 como #238+#257 desde fixtures históricos; ambos órdenes coinciden por perfil. El manifest agrega este corte y conserva íntegra la evidencia previa. Las huellas intermedias del runtime y los17 índices nuevos de ambas expansiones provienen de consultas reales. Los errores de memoria/importación de los ensayos preliminares permanecen en la entrega; no se atribuyen al producto ni se omiten.

Math.min/max sustituye tres comparadores equivalentes de fechas iguales, con fallback explícito para NaN; conserva calendario, divisor360 y redondeos por ruta. Los siete rangos completos y pisos190/50/13 permanecen. La dirigida mide194 instrumentados (20 ignores históricos),171 killed+3 timeout,0 survived/NoCoverage y100%; la corrida global se acredita sólo con su propio resultado. Ninguna prueba local sustituye CI por SHA ni la revisión independiente. Este candidato se prepara para revisión y no autoriza merge ni despliegue.
