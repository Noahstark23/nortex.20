# NortexGPT: corpus y evaluación local

El corpus contiene **100 facturas sintéticas, 50 de ferretería y 50 de farmacia**. No contiene facturas de clientes, datos de producción ni credenciales. Los importes esperados son etiquetas sintéticas; **su revisión humana está pendiente**. El corpus no acredita capacidad del modelo ni autorización de piloto.

## Documentos y valores esperados

`tests/fixtures/assistant/corpus/manifest.json` registra por documento: vertical, escenario, archivo, MIME, páginas, tamaño, SHA-256, campos esperados, campos omitidos, candidatos de catálogo ambiguos y motivos de revisión. Cada documento incluye la advertencia de prueba y no acredita recepción o pago.

Por vertical se incluyen cinco documentos de cada escenario: legible, desenfoque raster real, rotación 90°, dos páginas, página duplicada, descripción ambigua, moneda incompatible, descuento, dato obligatorio ausente e instrucciones maliciosas incrustadas. Los PNG usan una tipografía bitmap deliberadamente limitada; no representan cámaras físicas, iluminación, papel real ni toda la diversidad comercial. Los PDF multipágina dividen una sola factura. Los PDF duplicados repiten su contenido y deben recibir revisión.

Generación determinista y comprobación sin proveedor:

```sh
mise exec -- node scripts/assistant-evaluation/generate.mjs
mise exec -- node scripts/assistant-evaluation/evaluate.mjs
```

El informe se guarda en `reports/assistant-evaluation/report.json`. Comprobar hashes, MIME y páginas **no ejecuta OCR**. No confundir `corpusIntegrity: passed` con `providerEvaluation: not_run`.

## Evaluación optativa con proveedor real

Esta ejecución puede consumir presupuesto y requiere habilitación explícita en la invocación. Usa un backend local con MySQL descartable, almacenamiento privado y el worker real, un usuario sintético con permiso de compras y configuración de piloto. La reserva de presupuesto y límites de IA se aplican dentro del backend; el harness no recibe claves del proveedor. Guardar el token de sesión QA en un archivo temporal privado con permisos `0600`, fuera del repositorio.

```sh
mise exec -- node scripts/assistant-evaluation/evaluate.mjs \
  --allow-paid-model --base-url http://127.0.0.1:PUERTO_QA \
  --session-token-file /ruta/privada/sesion-qa \
  --limit 5 --report reports/assistant-evaluation/provider.json
```

El valor predeterminado es cinco documentos, alternando ambas verticales, y nunca supera 100. Un documento defectuoso se registra y la evaluación continúa; se detiene ante presupuesto agotado o violación de controles. Una extracción debe producir `DRAFT`, sin recepción ni pago confirmados. **El harness nunca revisa ni confirma una propuesta**. Al ejecutarlo después de cambios al proveedor, prompt o modelo se deben conservar informes separados. `jobsSubmitted` cuenta trabajos y `paidCalls` permanece desconocido en ejecución con proveedor: los reintentos y validaciones previas impiden deducir llamadas facturadas a partir de trabajos.

Antes del piloto una persona debe contrastar los documentos, etiquetas e incertidumbres y registrar los casos aceptados/corregidos. El informe compara campos, pero no decide que una coincidencia textual sea una correspondencia de catálogo correcta. Medir precisión por campo, totales, páginas duplicadas, productos/unidades/lotes ambiguos, bloqueos correctos, latencia, consumo reservado y costo facturado. Comparar tiempo y correcciones con ingreso manual en cada vertical. No atribuir mejora de retención ni exactitud completa a fixtures o pruebas simuladas.

## Pruebas transaccionales

`tests/purchaseRegistration.integration.test.ts` usa HTTP real con MySQL descartable para la autoridad compartida de compras: idempotencia, concurrencia, aislamiento, roles, período cerrado y fallo real de auditoría provocado por un trigger temporal, eliminado en `finally`.

`tests/assistantFlow.integration.test.ts` comprueba propuesta/revisión/confirmación, comprobante, versiones, doble clic, permisos revocados, fuentes ajenas, farmacia, cambios materiales, rollback fiscal, equivalencia del formulario y topes de consumo con concurrencia en MySQL. Las fixtures preparan el resultado de extracción y cargan archivos reales de prueba; **esa preparación no prueba el proveedor**.

La compuerta obligatoria debe ejecutar ambas suites con todas sus aserciones. Una suite omitida por faltar MySQL no es aprobada. La base QA, almacenamiento privado y claves efímeras se crean fuera del repositorio. No conectar bases existentes de usuarios. Estos resultados no acreditan staging, producción ni dispositivos físicos.

## Evidencia ejecutada el 2026-09-05

En el candidato aislado `/tmp/nortexgpt-implementation-20260905`, las dos suites ejecutaron **24/24 casos aprobados** contra HTTP real y el contenedor propio `nortex-gpt-qa-20260905` (MySQL 8, base `nortex_qa_assistant`, publicada sólo en loopback). Incluye compra de contado con débito único y factura vinculada a recepción de OC sin reingreso de stock. Informe: `reports/assistant-qa/tests.json`. Esta es una ejecución puntual; la compuerta integral debe volver a ejecutar ambas suites al integrar cambios.

La prueba de 50 reservas concurrentes reprodujo primero una carrera `P2002` del upsert emulado y después un deadlock por conversión de bloqueo compartido. La reparación con upsert SQL nativo y lectura bloqueante produjo 40 reservas de US$0.25 y diez rechazos por presupuesto. Se verificó reserva desconocida retenida y liquidación repetida sin doble consumo. No se llamó al proveedor de IA.

El trigger temporal para provocar fallo de auditoría requiere privilegio `TRIGGER`. Con binlog habilitado, esta base **descartable** se configuró con `log_bin_trust_function_creators=1`; esa receta se limita a infraestructura QA nueva y no modifica configuración de producción. Prisma no admite `CREATE TRIGGER` mediante prepared statements; la fixture usa el CLI local pinneado para ese DDL y elimina el trigger al terminar. Los datos sintéticos persistidos permanecen únicamente en la base QA.
