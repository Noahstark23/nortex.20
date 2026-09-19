# Arnés Fase 0 — cámara y códigos

PWA aislada para medir captura de códigos en dispositivos reales. No importa la
aplicación Nortex, no llama al backend, no conoce tenants y no puede crear
productos, ventas, conteos ni movimientos de inventario.

## Límites deliberados

- El video y la decodificación permanecen en el dispositivo.
- No se guardan imágenes, frames ni payloads observados.
- No se usa `localStorage`, IndexedDB, cookies ni telemetría.
- Una corrida solo conserva longitud, simbología, coincidencia, tiempos y estado
  de lifecycle según el schema canónico.
- Los datos se exportan únicamente al pulsar **Exportar evidencia**.
- Los manifiestos de campo y sus secretos quedan fuera del repositorio.
- Este arnés no demuestra compatibilidad óptica hasta ejecutarse físicamente.

El contrato autoritativo está en
`docs/product/camera-barcode-phase0-manifest.schema.json`; la plantilla segura
está en `docs/product/camera-barcode-phase0-manifest.example.json`.

## Comandos

Desde la raíz del repositorio y con Node 22.23.2:

```sh
mise exec node@22.23.2 -- npm run phase0:camera:dev
mise exec node@22.23.2 -- npm run phase0:camera:build
mise exec node@22.23.2 -- npm run phase0:camera:preview
mise exec node@22.23.2 -- npm run phase0:camera:simulate
```

`phase0:camera:simulate` ejecuta una demostración determinista sin hardware:
recorre éxito, timeout, cancelación, background/resume, cierre de página,
permiso denegado y contexto inseguro; después verifica las rutas
`GO`, `PILOT`, `NO_GO` e `INSUFFICIENT`. El reporte se marca siempre como
`SOFTWARE_ONLY_NOT_PHYSICAL`, no genera un manifiesto importable y no autoriza
un GO de dispositivo. Usa `npm run phase0:camera:simulate -- --json` para obtener
el reporte estructurado por stdout.

Sin TLS el servidor escucha únicamente en `127.0.0.1:4176`. Es suficiente para
QA de escritorio porque `localhost` es un contexto seguro, pero no permite que
un teléfono de la red abra la cámara.

## HTTPS para un teléfono real

La prueba móvil exige elegir primero el hostname o IP LAN exacto que abrirá el
dispositivo y emitir un certificado que lo incluya en sus SAN. El certificado
y su llave se generan y custodian
fuera del repositorio. Nunca se copian a `tools/`, `public/`, `artifacts/` ni a
un commit.

Configura las dos rutas juntas antes de iniciar o previsualizar:

```sh
NORTEX_PHASE0_TLS_KEY_PATH=/ruta/fuera-del-repo/phase0-key.pem \
NORTEX_PHASE0_TLS_CERT_PATH=/ruta/fuera-del-repo/phase0-cert.pem \
mise exec node@22.23.2 -- npm run phase0:camera:preview
```

Si solo se configura una ruta, el servidor falla cerrado. Con TLS escucha en la
red local; el operador sigue siendo responsable de usar una red controlada,
confiar la CA en el teléfono y cerrar el proceso al terminar.

Para validar la PWA instalada se debe usar el build de producción:

1. Ejecutar `phase0:camera:build`.
2. Si antes corriste el `build` principal de Nortex, vuelve a ejecutar
   `phase0:camera:build` porque ese proceso regenera `dist/` y elimina
   `dist/phase0-camera`.
3. Iniciar `phase0:camera:preview` con TLS.
4. Abrir `https://HOST:4176/phase0-camera/` en Chrome Android. No continuar si
   Chrome muestra advertencia de certificado; la UI debe indicar
   `HTTPS/secure context: sí`.
5. Instalar **Nortex Fase 0** desde el navegador y abrirla desde su icono.
6. Confirmar que la UI indica `PWA instalada: sí` y que el ambiente dice
   `INSTALLED_PWA`.
7. Cambiar manualmente `studyId`, fabricante, alias de modelo, versión de SO y
   versión de navegador. El decoder y el build se fijan automáticamente al
   pulsar **Preparar estudio**.

Después de la primera corrida, `studyId` y la identidad del ambiente quedan
congelados. Para otro dispositivo, SO, navegador, decoder o build se debe usar
otro `environmentId`; el arnés rechaza reetiquetar evidencia ya registrada.

## Primera celda física preparada

La primera celda es:

`Android económico + versión exacta de Android + PWA instalada + Chrome/Blink + ZXing Browser 0.1.5 / Library 0.21.3 + EAN-13`.

Procedimiento por intento:

1. Seleccionar muestra y escenario; no mostrar otro código dentro del encuadre.
2. Pulsar **Iniciar cámara**. El cronómetro comienza con ese gesto.
3. Permitir que la corrida termine por lectura, timeout, permiso denegado o
   cancelación. No recargar para ocultar un fallo.
4. Confirmar visualmente que el indicador del sistema deja de mostrar cámara al
   salir, cambiar a background y cerrar la PWA.
5. Repetir hasta cumplir el protocolo. Una celda necesita al menos 30 intentos
   de medición válidos; tres intentos solo sirven como dry run del operador.
6. Exportar el JSON a almacenamiento local controlado y validarlo de nuevo antes
   de calcular una decisión. Para la revalidación visible, vuelve a cargar ese
   mismo archivo con **Importar manifiesto JSON** y confirma el mensaje de éxito.

La plantilla incluye solo un escenario para probar el recorrido básico. Antes
de reunir los 30 intentos de decisión, importa un manifiesto que declare los
escenarios COLD/WARM/RESUME, permisos, online/offline, iluminación, orientación,
cancelación, background/resume y fallback exigidos por el plan maestro.

La UI nunca muestra el código decodificado. Para muestras reales, el manifiesto
solo contiene `expectedFingerprint` y el operador introduce un secreto HMAC
efímero en un campo protegido. El secreto se convierte en una llave WebCrypto no
extraíble, el campo se limpia y ningún valor crudo entra al JSON exportado.
El operador debe custodiar y reutilizar el mismo secreto externo durante toda la
sesión; el arnés deliberadamente no lo recuerda ni puede confirmar cuál se usó.
El fallback manual se usa solo con muestras cuyo `expectedOutcome` es `DECODE`;
las muestras negativas conservan su evaluación por rechazo del decoder. El
fallback tiene una métrica separada y nunca cuenta para los 30 intentos, la
precisión, la latencia, la cobertura ni el cierre de tracks de cámara.
Los controles deliberados de permiso denegado, cierre y background se evalúan
en lifecycle y cierre de tracks, pero no contaminan precisión o latencia. Un
permiso denegado inesperado sí permanece como fallo de medición.

## Interpretación

Las decisiones son por celda exacta, no por plataforma global:

- `INSUFFICIENT`: menos de 30 intentos válidos o cobertura incompleta.
- `GO`: todos los gates del protocolo se cumplen.
- `PILOT`: no hay lectura incorrecta, fuga ni mutación, pero falla un umbral de
  rendimiento o confiabilidad.
- `NO_GO`: existe lectura incorrecta, aceptación inválida, lifecycle inseguro,
  fuga de privacidad o mutación causada por capturar.

La prueba física sigue pendiente hasta que el JSON provenga de un dispositivo
real. Los tests con mocks solo verifican contrato, privacidad y lifecycle del
código.
