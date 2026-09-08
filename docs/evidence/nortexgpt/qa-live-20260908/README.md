# NortexGPT: QA local del 8 de septiembre de 2026

La aplicación local pasó las comprobaciones deterministas descritas aquí. **Haiku no fue llamado y el piloto no se ejecutó.** La mutación global aprobó con 99,88% y el alcance protegido intacto.

## Candidato y aislamiento

Copia del checkout con sus cambios previos en `/tmp/nortex-qa-live-20260908`, Node 22.23.2 mediante mise, npm, Prisma 6.4.1 y MySQL 8 descartable. Base nueva `nortex_quality_operativo`, contenedor propio `nortex-qa-live-20260908`, puerto MySQL 32768 limitado a loopback. No se usaron archivos de entorno ni datos de negocios reales. Credenciales efímeras fuera del repositorio e informes.

El manifiesto registra los archivos ensayados; no representa un commit limpio ni un candidato desplegado. Se conservaron rama, worktrees e índice. Se reintegró únicamente el parche propio después de comparar los hashes de origen.

## Resultado ejecutado

| Comprobación | Resultado |
|---|---|
| Prisma generate / validate | Aprobadas |
| TypeScript completo | Aprobado |
| Vitest general | 4.814 casos aprobados; 286 omitidos no se cuentan aprobados |
| Integración obligatoria MySQL | 35 suites, 300 casos aprobados, cero omitidos |
| Regresión dirigida del verificador, orquestador y presupuesto | 43/43 |
| Sistema de diseño / build | Aprobados |
| Lanzador con credencial sintética en llavero real de macOS | 21/21 |
| Corpus de operaciones | 120/120 contratos deterministas |
| Corpus de facturas | Integridad de 100 documentos; no evalúa lectura real |
| Migración aditiva de runId | Ejecutada sobre tabla anterior: conserva fila e importe, agrega columna nullable e índice |
| Mutación global | 99,88% ≥ 99,85%; 5.197 mutantes y 53 módulos protegidos; guarda de alcance aprobada |

La primera corrida de integración aprobó 298 casos. La segunda incorporó dos casos transaccionales: reservas simultáneas con enlace por ejecución, costo incierto y liquidación idempotente; liquidación después del corte mensual de Managua. Los totales de las dos corridas no se suman.

## Defecto reproducido y reparado

Con presupuesto agotado, el orquestador guarda `iterations = 1` pero nunca llama al proveedor. El verificador anterior afirmaba llamadas pagadas y liquidadas. La regresión falló con `expected true to be null` y pasó después de la reparación.

Ahora una respuesta validada o un identificador de respuesta enlazado acredita contacto. Los intentos sin evidencia suficiente quedan desconocidos. Una reserva, su liberación o un costo `UNKNOWN` no acreditan envío. Importes ausentes, negativos o no finitos no se convierten en cero. También se corrigió una expectativa textual desactualizada; la prueba conserva las aserciones de ausencia de atribución.

No se extrajeron módulos ni se modificaron presupuestos de monolitos. El verificador pasó de 218 a 233 líneas; las pruebas y la documentación se ampliaron para cubrir el comportamiento.

## Recorrido observado en navegador

Acceso a la ferretería sintética, un cemento de C$265 en el carrito, apertura del panel, «Compré 50 bolsas de cemento», consulta «¿Cómo va mi negocio?», corrección a 60, cierre y recarga. Se conservaron carrito y conversación; F9 no abrió el cobro detrás del panel. El asistente pidió elegir producto y BASE/PACK. No se registró ninguna compra nueva.

La consulta mostró C$2.650 de ventas emitidas, C$345,65 de IVA, C$2.000 de costo histórico y C$304,35 de margen bruto, con período Managua y procedencia. La respuesta avisó que el análisis de IA no estaba disponible. MySQL conservó la ejecución con cero iteraciones y cero filas de consumo en los negocios demo.

Se inspeccionó la presentación móvil de 320 px y escritorio de 1.440 px. No se probó un lector físico. Las pruebas automatizadas cubren caja, promociones, compras, permisos, recuperación y demás contratos; esa evidencia no equivale a una prueba física o a utilidad comercial.

El login falló inicialmente por el origen de frontend del lanzador API. Se configuró el origen local autorizado en una copia de lanzamiento exclusiva del entorno de QA; no se amplió CORS del producto.

## Haiku y siguiente paso

Se observaron US$5 de crédito y recarga automática apagada en Claude Console. Se creó `Nortex-QA` y se verificó su límite mensual de US$5. La lista de claves está vacía. No se creó ni leyó una clave real.

El usuario debe crear `nortex-qa-haiku` en API keys de ese workspace y guardarla desde el repositorio con:

```sh
bash scripts/qa/nortexgpt-credential.sh guardar
```

No pegar la clave en el chat. La prueba de modelo empezará después de guardarla y de revisar los resultados esperados de ferretería y farmacia. Los formularios siguen sin aprobación inventada. Se mantiene el máximo inicial de una consulta por vertical y US$1,127680 de reserva máxima por consulta, que no equivale a gasto.

Demo local: <http://127.0.0.1:44174/app/pos>. La cuenta sintética de ferretería está iniciada. El servidor de demo tiene consulta y conversación habilitadas, y acciones, extracción, ejecución y transportes externos apagados.

Implementación local, pruebas deterministas, calidad del modelo, piloto, CI remoto, staging y producción son estados distintos. Los últimos cinco no quedan acreditados por esta entrega.
