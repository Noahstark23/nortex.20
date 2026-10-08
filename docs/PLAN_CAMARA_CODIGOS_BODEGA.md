# Plan maestro — Cámara, códigos y operación de bodega

> **Estado:** Fase 0 en curso\
> **Corte verificado:** 2026-08-30\
> **Alcance de este lote:** investigación reproducible, contratos y arnés aislado.\
> **Cambios al runtime productivo, schema, permisos o inventario:** ninguno. El
> arnés de Fase 0 vive fuera de `App.tsx` y no se conecta al backend.

## 1. Decisión ejecutiva

La cámara será una fuente de captura, no una autoridad de negocio. Debe entregar
un código al mismo flujo de resolución que utilizan el teclado, el lector físico
y, cuando corresponda, las etiquetas de balanza. Escanear por sí solo nunca
creará un producto, venderá, ajustará stock ni cerrará un conteo.

La Fase 0 debe demostrar con dispositivos reales qué combinación de superficie y
decoder es suficientemente confiable. La ruta base a validar es
`getUserMedia` + ZXing. `BarcodeDetector` se considera una optimización opcional,
con detección de capacidad; un adaptador nativo se evalúa solo si las celdas web
obligatorias no cumplen los gates.

Este documento conecta, sin reemplazar:

- [Bodega confiable](./PLAN_BODEGA_CONFIABLE_2026.md), autoridad para operación,
  permisos y movimientos de inventario.
- [Balanzas digitales y etiquetas](./PLAN_BALANZAS_DIGITALES_Y_ETIQUETAS.md),
  autoridad para perfiles PLU, reparseo y etiquetas de productos medidos.
- [Build Android](./BUILD_ANDROID.md), autoridad para el shell Capacitor actual.

## 2. Objetivo y frontera

El objetivo es permitir, de forma progresiva:

1. buscar un producto apuntando la cámara a EAN, UPC, Code 128 o una etiqueta de
   balanza compatible;
2. mostrar al bodeguero cuánto existe en la bodega activa y en el agregado,
   respetando su redacción de datos financieros;
3. localizar una línea dentro de una toma física y registrar un conteo explícito;
4. precargar un código desconocido en alta rápida para `OWNER`/`ADMIN`, o crear
   una solicitud supervisada si el negocio aprueba ese flujo;
5. imprimir etiquetas Nortex con un identificador definido, después de decidir
   el modelo de códigos.

Queda fuera de Fase 0:

- OCR de texto, reconocimiento de productos por imagen y clasificación con IA;
- integrar dependencias de cámara o permisos nativos al producto;
- modificar `Product`, crear endpoints o cambiar la política `BODEGUERO`;
- imprimir códigos, persistir fotos o integrar una pantalla de escaneo al producto;
- mutar stock, ventas, conteos o datos de clientes;
- declarar soporte de un dispositivo sin evidencia física reproducible.

## 3. Base actual verificada

| Área | Estado real al corte | Consecuencia |
|---|---|---|
| Identidad de producto | `Product.sku` es el único código general y es único por tenant | Fase 1 requiere un ADR: conservar un código o admitir varios |
| Etiqueta normal | Inventario imprime nombre, precio y SKU como texto | No existe barcode visual general |
| Etiqueta de balanza | Parser, perfiles, mappings, auditoría y telemetría ya existen | Se reutiliza el contrato; no se crea un segundo parser libre |
| POS | Escáner tipo teclado; intenta balanza y luego SKU exacto | La cámara debe entrar por un adaptador común |
| Inventario | Escáner tipo teclado; busca SKU y puede precargar alta rápida | La cámara no debe duplicar este flujo |
| Toma física | Escáner tipo teclado suma una unidad a una línea existente | Productos medidos necesitan una regla distinta antes de implementar |
| Bodegas | Multi-bodega, Kardex, auditoría y cierres transaccionales existen | La captura nunca evita `applyStockDelta` ni el cierre oficial |
| Rol `BODEGUERO` | Existe con allowlist y redacción server-side | Ampliar acceso exige decisión y prueba de política, no solo UI |
| Foto de producto | Existe `capture="environment"` para seleccionar una imagen | No es un lector de códigos |
| PWA | Existe manifest y service worker | Debe probarse en pestaña e instalada |
| Android | Existe shell Capacitor remoto; manifest solo declara Internet | Cámara nativa aún no está habilitada ni evaluada |

Hueco conocido: la allowlist de `BODEGUERO` no incluye hoy
`/api/scale-labels/preview`. Esto se documenta como decisión para una fase
posterior; Fase 0 no amplía ese permiso.

## 4. Progreso de Fase 0

| Entregable | Estado | Evidencia |
|---|---|---|
| Recon del repositorio y contratos vigentes | Completado | Sección 3 y documentos enlazados |
| Investigación de plataforma con fuentes primarias | Completado | Sección 8 |
| Protocolo, privacidad, métricas y gates | Completado | Secciones 5 a 10 |
| Schema del manifiesto de evidencia | Completado | `docs/product/camera-barcode-phase0-manifest.schema.json` |
| Plantilla sintética segura | Completado | `docs/product/camera-barcode-phase0-manifest.example.json` |
| Corpus físico de 60 muestras | Pendiente | Debe prepararse y custodiarse fuera del repositorio |
| Harness mínimo de investigación | Completado | `tools/camera-barcode-phase0/`; PWA aislada, sin API ni persistencia automática |
| Primera celda Android económico + PWA | Preparada | Guía reproducible en `tools/camera-barcode-phase0/README.md`; ejecución física pendiente |
| Corridas en Android e iPhone reales | Pendiente | No se sustituye con emuladores |
| Decisión GO / PILOT / NO-GO por celda | Pendiente | Se calcula después de las corridas |

## 5. Invariantes de seguridad e integridad

1. El backend resuelve siempre el tenant desde el JWT; ningún código capturado
   puede escoger `tenantId` ni ampliar resultados.
2. El decoder corre localmente. No se suben frames, imágenes ni video.
3. El repositorio no guarda códigos comerciales reales, datos de clientes,
   identificadores estables del dispositivo ni resultados crudos de campo.
4. Un código real se representa, si fuera indispensable correlacionarlo, mediante
   HMAC-SHA-256 con una llave fuera del repositorio; SHA-256 simple no basta para
   un espacio pequeño y enumerable como EAN.
5. Se preservan ceros iniciales. Nunca se usa `Number` ni `parseInt` para códigos.
6. Se valida longitud, charset y checksum antes de interpretar el contenido.
7. Una etiqueta de balanza reconocible pero inválida falla cerrada y no cae como
   SKU normal.
8. El parser de balanza y su versión exacta continúan siendo la autoridad para
   productos medidos.
9. Escanear solo propone una identidad. Toda venta, alta, conteo o mutación exige
   la confirmación y autorización propias de su flujo.
10. El stock solo cambia mediante los servicios y transacciones existentes,
    incluidos `applyStockDelta`, Kardex y auditoría atómica.
11. `BODEGUERO` conserva redacción de costo, precio y valoración. Un nuevo lookup
    debe aplicar la misma política en servidor.
12. Al cerrar, cambiar de pantalla o pasar a background se detienen todos los
    tracks de cámara.
13. Entrada manual y lector tipo teclado permanecen disponibles como fallback.
14. La telemetría futura no incluirá el payload crudo ni datos que permitan
    reconstruirlo.

## 6. Contrato de normalización v1

La normalización se versiona como `barcode-input-v1`:

- Cámara: conservar `rawValue` exacto; no aplicar `trim`, case-folding ni
  normalización Unicode.
- Lector tipo teclado: retirar únicamente prefijo/sufijo configurado y CR/LF
  exteriores; rechazar controles internos inesperados.
- Preservar ceros iniciales, mayúsculas/minúsculas, espacios válidos de Code 128
  y el separador GS1 `0x1D`.
- Conservar la simbología reportada. Derivar GTIN-14 solo después de validar un
  GTIN comercial.
- No colapsar UPC-A y EAN-13 antes de intentar perfiles de balanza.
- La deduplicación evita emisiones repetidas del mismo intento, pero no elimina
  dos escaneos explícitos consecutivos del operador.

## 7. Corpus y matriz experimental

### 7.1 Corpus mínimo

Se preparan 60 muestras físicas repo-safe o efímeras:

| Grupo | Cantidad | Uso |
|---|---:|---|
| EAN-13 comercial | 12 | Productos minoristas comunes |
| EAN-8 | 8 | Empaques pequeños |
| UPC-A | 8 | Productos importados |
| UPC-E | 4 | Compatibilidad compacta |
| Code 128 | 10 | Etiquetas internas Nortex |
| EAN-13 de balanza | 8 | Peso, cantidad o precio total |
| Negativos/no soportados | 10 | Checksum inválido, recorte, contraste y formato fuera de alcance |

QR se registra como exploratorio y no bloquea el primer release de retail. Cada
muestra lleva un ID opaco; las muestras reales permanecen fuera de Git y no se
fotografían para telemetría.

### 7.2 Celdas obligatorias

| Dispositivo | Superficie | Control mínimo |
|---|---|---|
| Android económico soportado | Chrome y PWA instalada | ZXing; `BarcodeDetector` solo como variante |
| Android medio | Chrome y PWA instalada | ZXing; `BarcodeDetector` solo como variante |
| iPhone con iOS mínimo soportado | Safari y PWA instalada | ZXing |
| iPhone actual | Safari y PWA instalada | ZXing |
| Desktop | Lector tipo teclado | Control de regresión |

El shell Capacitor remoto se prueba como celda separada después de definir
permisos y adaptador. No hereda un GO de Chrome o Safari.

### 7.3 Escenarios

Cada celda estándar cubre tres repeticiones por combinación relevante:

- arranque frío, caliente y regreso desde background;
- permiso en prompt, concedido y denegado;
- luz interior normal, baja luz y reflejo fuerte;
- etiqueta quieta y movimiento manual;
- distancia y ángulo registrados, vertical y horizontal;
- online y offline;
- salida por éxito, cancelación, navegación y timeout.

El orden de muestras se aleatoriza. El cronómetro comienza al tocar
“Escanear”, no cuando el preview ya está listo.

## 8. Candidatos de plataforma

### Ruta base: cámara web + ZXing

- `getUserMedia({ video: { facingMode: "environment" } })` para captura.
- Decoder ZXing limitado a los formatos de la celda para reducir CPU y batería.
- Región de interés, frecuencia de decode y lifecycle explícitos.
- Fallback por entrada manual, lector tipo teclado y, si las pruebas lo validan,
  captura de imagen.

El arnés fija `@zxing/browser` 0.1.5 y `@zxing/library` 0.21.3. Esa pareja
mantiene compatibilidad con el Node 22.23.2 canónico del repositorio; una
actualización del decoder exige repetir build, lifecycle y celdas físicas, y se
registra como una celda distinta.

### Optimización: `BarcodeDetector`

Solo se usa cuando existe, `getSupportedFormats()` incluye el formato requerido y
la celda concreta supera los mismos gates. Cualquier error vuelve a ZXing sin
degradar el flujo.

### Escalamiento nativo

Un plugin Capacitor no se agrega por anticipación. Se abre un spike si una celda
web obligatoria queda `NO-GO` por estabilidad, rendimiento o lifecycle y el
adaptador nativo puede corregirla sin crear dos contratos de negocio.

Fuentes primarias consultadas:

- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/):
  contexto seguro, permisos y errores de captura.
- [WICG Shape Detection API](https://wicg.github.io/shape-detection-api/): estado
  y contrato de `BarcodeDetector`.
- [Chrome Shape Detection](https://developer.chrome.com/docs/capabilities/shape-detection):
  disponibilidad y dependencia de plataforma en Chromium.
- [WebKit bug 281848](https://bugs.webkit.org/show_bug.cgi?id=281848): evidencia
  de riesgo de Shape Detection en iOS.
- [ZXing Browser](https://github.com/zxing-js/browser) y
  [ZXing](https://github.com/zxing/zxing): decoder web y formatos.
- [GS1 EAN/UPC](https://www.gs1.org/standards/barcodes/ean-upc) y
  [GS1 barcodes](https://www.gs1.org/standards/get-barcodes): simbologías de
  comercio y logística.

## 9. Registro de evidencia

La única fuente estructurada es JSON, validada por:

- [schema canónico](./product/camera-barcode-phase0-manifest.schema.json);
- [plantilla sintética](./product/camera-barcode-phase0-manifest.example.json).

El operador ejecuta el arnés y la primera celda física mediante
[`tools/camera-barcode-phase0/README.md`](../tools/camera-barcode-phase0/README.md).
La PWA usa el scope exclusivo `/phase0-camera/`, requiere HTTPS confiable en un
teléfono y falla cerrado si se proporciona solo una de las dos rutas TLS.

No se mantiene un CSV manual paralelo. Cualquier CSV o reporte se genera desde
el manifiesto para evitar divergencia. Una entrada de `runs` representa un solo
intento y guarda métricas, resultado y referencias opacas, nunca el código
observado ni notas libres.

El schema amarra `REPO_SAFE_SYNTHETIC` a muestras sintéticas repo-safe, prohíbe
corridas en una plantilla y rechaza combinaciones incoherentes entre resultado,
latencia, coincidencia, fallback, exclusión y código de falla. Las relaciones
entre IDs y su unicidad se verifican adicionalmente en QA, porque JSON Schema no
expresa llaves foráneas entre arreglos de forma portable.

Los resultados de campo viven en almacenamiento local controlado e ignorado por
Git. Solo un resumen agregado, sin payloads ni identificadores, puede entrar en
un futuro informe de decisión.

## 10. Métricas y gates

La decisión se toma por tupla exacta:

`dispositivo + SO + superficie + navegador + decoder + versión + formato`

No existe un GO global por “funcionó en mi celular”. Cada celda obligatoria debe
tener al menos 30 intentos de medición válidos y cobertura completa del
protocolo. Una corrida con fallback conserva evidencia de recuperación, pero no
entra en los denominadores de precisión, latencia, cobertura ni cierre de
tracks de la cámara. Los controles deliberados de permiso denegado, cierre y
background sí acreditan lifecycle y cierre de tracks, pero tampoco alteran la
precisión o latencia óptica. Un permiso denegado inesperado permanece como fallo
de medición.

| Gate | Umbral |
|---|---:|
| Lecturas incorrectas | 0 |
| Checksum inválido o formato no soportado aceptado | 0 |
| Primera lectura correcta en celda estándar | ≥ 95 % |
| p95 hasta primera lectura correcta | ≤ 2.000 ms |
| Lectura correcta dentro de 5 segundos, global | ≥ 99 % |
| Permiso denegado, cierre, background/resume y fallback manejados | 100 % |
| Tracks detenidos al salir | 100 % |
| Payloads reales, frames, PII o identificadores persistidos | 0 |

Fórmulas:

- `first_try_rate = DECODED_MATCH / intentos de medición válidos`;
- `within_5s_rate = DECODED_MATCH con firstCorrectMs <= 5000 / intentos de medición válidos`;
- `wrong_decode_rate = DECODED_WRONG / intentos de medición válidos`;
- `fallback_success_rate = fallbacks exitosos / fallbacks iniciados`.

Una sola lectura incorrecta, fuga de datos o mutación iniciada por el acto de
escanear produce `NO-GO`. Una celda lenta o incompatible queda `PILOT` o
`UNSUPPORTED`; no se oculta dentro de un promedio global.

## 11. Rondas QA de Fase 0

1. **Contrato documental:** cada requisito tiene campo, escenario, métrica y
   gate; no contradice los planes vigentes.
2. **Schema y plantilla:** JSON válido, propiedades cerradas, IDs únicos,
   referencias existentes y condicionales de privacidad.
3. **Privacidad y seguridad:** búsqueda negativa de payloads reales, imágenes,
   PII e identificadores; revisión de tenant, roles y límites de mutación.
4. **Regresión estática:** lector tipo teclado, parser de balanza y bodega
   permanecen intactos.
5. **Regresión ejecutable:** suites focalizadas de etiquetas, bodega, conteo y
   presupuesto POS.
6. **Compuerta canónica:** Prisma generate, TypeScript, Vitest, sistema de diseño
   y build mediante `scripts/ci-local-safe.sh`.
7. **Revisión independiente:** un segundo revisor inspecciona el diff y cualquier
   hallazgo se corrige y vuelve a ejecutar.
8. **Dry run físico posterior:** otra persona ejecuta tres corridas sin
   explicación verbal y reproduce los cálculos desde `runs`.

Cada ronda registra `PASS` o `FAIL`, hallazgo, corrección y repetición. Un FAIL no
se convierte en PASS sin evidencia nueva.

### Bitácora de apertura — 2026-08-30

| Ronda | Resultado | Evidencia de esta apertura |
|---|---|---|
| 1. Contrato y hechos actuales | PASS | Recon independiente de producto, balanza, bodega, PWA y Android |
| 2. Schema y plantilla | FAIL → PASS | AJV 2020-12 estricto detectó condicionales incompletos; se corrigieron y el contrato documental pasa 9/9 |
| 3. Privacidad y seguridad | PASS | Clasificación global amarrada a muestras sintéticas; sin payloads, frames, PII ni identificadores persistidos |
| 4. Regresión estática | PASS | No se modificaron el runtime del producto, Prisma, permisos ni lógica de inventario; ZXing/AJV entran solo como dependencias de desarrollo del arnés aislado |
| 5. Regresión ejecutable focalizada | PASS | 11 archivos y 106 pruebas de contrato, balanza, bodega, conteo y POS |
| 6. Compuerta canónica | PASS | 221 archivos aprobados y 9 omitidos; 3.065 pruebas aprobadas y 57 omitidas; Prisma generate, TypeScript, diseño y build aprobados |
| 7. Revisión independiente | PASS | Hallazgos corregidos y revalidados: fallback y controles de lifecycle separados de la medición, identidad del ambiente congelada y capacidades físicas preservadas |
| 8. Dry run físico | PENDIENTE | Requiere corpus, harness y dispositivos reales; no se simula como completado |

### Bitácora del arnés aislado — 2026-08-30

| Ronda | Resultado | Evidencia |
|---|---|---|
| Contrato ejecutable | PASS | Dominio, manifiesto, lifecycle, HMAC y helpers cubiertos por pruebas focales |
| Suite focal del arnés | PASS | 8 archivos y 100 pruebas aprobadas |
| Aislamiento | PASS | Sin imports de `App`, componentes o backend; sin `/api`, `fetch`, almacenamiento web ni telemetría |
| Build PWA | PASS | Scope `/phase0-camera/`, manifest e iconos propios; decoder cargado bajo demanda y precache sin runtime API |
| Simulación software | PASS | 9 escenarios de lifecycle y 6 decisiones esperadas; reporte determinista `SOFTWARE_ONLY_NOT_PHYSICAL` |
| Dependencias productivas | PASS | `npm audit --omit=dev`: 0 vulnerabilidades |
| Dependencias de desarrollo | PASS con hallazgo externo | ZXing/AJV sin advisory reportado; `npm audit` mantiene un hallazgo previo en `@capacitor/cli`/`tar`, fuera del bundle del arnés y del árbol productivo |
| Dispositivo físico | PENDIENTE | No hay dispositivo disponible en esta sesión; no se fabricó evidencia |

La última repetición de la ronda 6 pasó completa mediante
`scripts/ci-local-safe.sh`. No hubo deploy, push, webhook ni mutación de base de
datos.

Nota operativa: si después de construir el arnés se ejecuta el `build` principal
de Nortex, el directorio `dist/` se regenera y hay que volver a correr
`phase0:camera:build` antes de `phase0:camera:preview`.

## 12. Arquitectura objetivo, todavía no implementada

```text
Cámara web / adaptador nativo / lector físico / entrada manual
                           │
                           ▼
             BarcodeCaptureAdapter (sin negocio)
                           │
                           ▼
          normalize + validate + deduplicate (versionado)
                           │
                           ▼
       tenant-scoped ProductCodeResolver (servidor autoritativo)
             │               │                │
             ▼               ▼                ▼
        ficha bodega     toma física      POS / alta rápida
          lectura       comando explícito   comando explícito
```

La resolución futura debe ser exacta y tenant-scoped. Un resultado ambiguo no
elige “el primero”: devuelve conflicto operable. La prioridad entre etiqueta de
balanza, GTIN comercial, SKU y código interno se fija en un ADR antes de escribir
la capa de resolución.

## 13. Decisiones que bloquean Fase 1

1. ¿`sku` seguirá siendo el único identificador o existirá `ProductBarcode` para
   varios códigos por producto?
2. ¿EAN/UPC, Code 128 y QR se almacenan tal cual o con tipo explícito?
3. ¿Una etiqueta Nortex codifica el SKU visible o un identificador inmutable?
4. ¿Un bodeguero puede solo consultar/contar o también proponer un producto?
5. ¿Un producto medido suma `1`, abre cantidad o exige etiqueta de balanza?
6. ¿Qué versiones mínimas de Android/iOS son contractuales?
7. ¿Qué celdas son obligatorias para piloto y cuáles pueden declararse no
   soportadas con fallback?

## 14. Criterio de salida de Fase 0

Fase 0 termina únicamente cuando:

- el corpus y cada ambiente están identificados sin datos sensibles;
- el harness reproduce el protocolo sin tocar lógica de negocio;
- todas las celdas obligatorias tienen evidencia suficiente;
- las métricas se recalculan desde el manifiesto;
- existe decisión `GO`, `PILOT` o `NO-GO` por celda;
- se aprueba el ADR de identidad y prioridad de códigos;
- las rondas QA 1–8 están documentadas;
- no hubo regresión en lector físico, balanza, POS, conteos o permisos.

Solo entonces comienza Fase 1: un vertical slice de **búsqueda de solo lectura**
en una superficie, con fallback, sin crear ni mutar inventario.
