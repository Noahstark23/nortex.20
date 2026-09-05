# Compuerta local de integración obligatoria

`npm run test:integration:required` es una compuerta local para cambios de dinero
o inventario. Ejecuta recorridos HTTP y de concurrencia contra MySQL 8 real que
la suite unitaria no puede sustituir. No es un deploy y no acredita CI, staging
ni producción.

## Cuándo y cómo usarla

Ejecutarla después de las pruebas focales y antes de presentar un candidato que
toque dinero, stock, correcciones, compras, devoluciones o cierres:

```sh
mise exec -- npm run test:integration:required
```

Requiere Node 22, dependencias locales y Docker disponible. La imagen
`mysql:8.0` debe existir previamente: la ruta local falla cerrada si no está, para
no descargar imágenes ni iniciar red inesperada. En CI, el workflow obtiene esa
imagen de forma explícita antes de invocar la compuerta.

## Aislamiento que impone

El script no usa una `DATABASE_URL` heredada y crea un contenedor MySQL 8 con
nombre, puerto, credenciales y base aleatorios. El directorio de datos está en
`tmpfs`, el puerto se publica sólo en `127.0.0.1`, y un `trap` elimina el backend
y el contenedor al terminar, incluso ante fallo o interrupción. No usa
`docker-compose`, volúmenes de desarrollo, bases compartidas ni credenciales
reales.

El backend recibe un entorno vacío salvo sus valores locales mínimos, incluido un
JWT aleatorio de una sola corrida. Así no hereda claves de correo, WhatsApp,
Stripe, LLM ni telemetría. Los tenants, correos y movimientos de prueba son
sintéticos; no se envía correo ni se llama un servicio externo.

Durante el arranque se exige que `/api/health` responda con
`Cache-Control: no-store`. Esto evita que la misma ruta usada para observar el
SHA de una release acepte una respuesta en caché como si fuera salud actual.

## Recorridos exigidos

La lista cerrada está en `scripts/qa-integration-required.sh`. El script descubre
todos los archivos versionados `*.integration.test.ts` y `*.mysql.test.ts`; además
incluye cualquier prueba que use `NORTEX_QA_BASE_URL`, aunque su nombre no lleve el
sufijo habitual. Si una prueba descubierta no está inscrita, la compuerta falla.

Actualmente exige estos doce recorridos:

1. cliente/cartera;
2. fiscal;
3. ajuste de inventario;
4. movimientos manuales de lote y bodega;
5. compras — fase uno;
6. compras — fase dos;
7. pedidos/correcciones — fase dos B;
8. flujo de compra;
9. compra y cambio de precio de venta;
10. devolución idempotente;
11. conteo físico por bodega;
12. cierre de caja y asientos concurrentes.

Cada archivo corre por separado y su reporte JSON se valida antes de continuar.
Una suite inexistente, sin casos, fallida, omitida o marcada `todo` cierra la
compuerta. Prisma sincroniza una base recién creada y descartable sin
`--accept-data-loss`.

## Evidencia registrada — 2026-09-05

La primera ejecución detectó una discrepancia reproducible: el ajuste de
inventario devolvía `409` para `WAREHOUSE_REQUIRED` e `INSUFFICIENT_STOCK`, aunque
el contrato exige `400`. Se corrigió el orden de manejo de `StockError`, sin
cambiar el tenant, la transacción ni el movimiento de stock.

Las ejecuciones posteriores revelaron casos de pedidos/devoluciones que no
recorrían la aprobación obligatoria de una corrección. Se corrigieron para crear,
aprobar y usar el expediente, y se mantuvo el caso negativo cuando falta
`correctionRequestId`. La revisión final además incorporó la ronda HTTP de
lote+bodega que el patrón de nombre no detectaba; el descubrimiento por
`NORTEX_QA_BASE_URL` impide volver a omitirla por convención de archivo.

La repetición posterior al assert de `Cache-Control: no-store` terminó con
**12 suites y 83 casos aprobados**, sin casos omitidos ni `todo`. La suite general
del candidato se ejecutó aparte: **306 archivos y 4,076 pruebas aprobadas**, con
**11 archivos y 69 pruebas omitidas** dependientes de QA/MySQL fuera del entorno
normal; esos omitidos no cuentan como aprobados. No se usó una base compartida,
datos de usuarios, credenciales reales ni servicios externos.

## Límite de esta evidencia

Un resultado verde acredita únicamente los recorridos locales ejecutados en ese
candidato. No prueba el SHA remoto, configuración de GitHub/Coolify, datos de
clientes, experiencia visual autenticada, staging ni autorización de producción.
La limpieza de los recursos temporales es una propiedad que la propia ruta intenta
garantizar; si el proceso del host o Docker no puede responder, se debe registrar
el incidente y revisar los recursos etiquetados antes de repetir la ejecución.
