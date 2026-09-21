# Reproducción del lector compartido

Fixture local con EAN-13 sintético `7501055363018`. El canvas alimenta un
MediaStream; se ejecuta `startCameraBarcode` y el decoder real del producto.
No necesita permisos de cámara, sesión ni base de datos; no consulta productos.

```sh
mise exec -- npx --no-install vite build --config tools/barcode-debug/vite.config.ts
mise exec -- npx --no-install vite preview --config tools/barcode-debug/vite.config.ts
```

Abrir `http://127.0.0.1:4198/` y probar horizontal, vertical y fuera del centro.
Cada escenario debe mostrar `LEÍDO: 7501055363018`. El build minifica los mismos
imports dinámicos de ZXing que la aplicación. El resultado no acredita enfoque,
permisos, iluminación ni rendimiento de una cámara física.

Antes de la reparación: horizontal leído; vertical sin lectura con video vivo.
Las pruebas de píxeles también reproducen el fallo descentrado y la prueba del
adaptador reproduce un error fatal ignorado. Después: los tres escenarios se leen.

## Fotografía de empaque

`fixtures/ean13.png`: fixture de ZXing JS Library, `ean13-1/1.png` (Apache-2.0).
Fuente: https://github.com/zxing-js/library/tree/master/src/test/resources/blackbox/ean13-1
Código esperado: `8413000065504`. El botón de fotografía alimenta el mismo video
con píxeles de una fotografía de un envase curvo; tampoco sustituye cámara física.

## Cambio de dimensiones

El botón de cambio de tamaño inicia video blanco 640 × 480 y, tras 800 ms,
lo cambia a 1280 × 720 con código visible a la derecha. El adaptador anterior
conservaba un canvas 640 × 480 y no leía. El corregido devuelve `7501055363018`.
