# Bloqueo de arranque y reparación — 2026-10-06

## Diagnóstico reproducido

PR #253 corrigió el sellado del build y las dependencias de runtime. Su merge
`708eafa9114f09c1218729f1e6db1d519387d71b` tiene el mismo árbol que el candidato
`00014c7b0188f2b3cc5225a7bbf29fd58a3d6179`, ensayado con el Dockerfile real.
Ese código pasó gate y CMD/health con el fixture exacto de staging, pero falló
con `P2010` ante el fixture histórico de producción. El SQL registrado durante
los gates mostró cero DDL y cero DML.

La lectura por la terminal existente de Coolify confirmó:

- Staging C′ pasó su gate: 143 modelos, 1.735 columnas, cero DDL.
- Producción carece de las diez tablas `WaCommerce…` y de `commerceEnabled`,
  `commercePolicy`, `commercePolicyVersion` en `WhatsAppChannel`.
- El fingerprint remoto de producción es
  `65341b108be99cda2a06a2ce32660e3d48e4e1e33e89b4a89b596ee1b016870c`, idéntico
  al baseline sintético usado en el ensayo. Se consultó sólo metadata.
- El heartbeat del servicio backup registra `2026-10-06T09:15:14Z`, destino
  off-site y dump verificado. No se inspeccionó el contenido de clientes ni se
  ejecutó un restore. El heartbeat por sí solo no acredita recuperabilidad.

## Reparación

1. Prepare construye y después ejecuta el gate de esa imagen contra la base
   existente, antes de devolver éxito al proveedor. `compose run` no inicia
   dependencias, no publica puertos y tiene `traefik.enable=false`. Si falla,
   prepare devuelve el fallo; no ejecuta `up`, `stop` ni `down`.
2. El wrapper resuelve el `.env` requerido por el Compose generado sin una receta
   inline del panel. Sólo crea una copia temporal 0600 cuando falta y la elimina
   al terminar; conserva cualquier archivo existente.
3. El gate identifica tablas/columnas requeridas por el cliente antes de devolver
   el error genérico de Prisma. Conserva identidad, confirmación, fingerprint,
   visibilidad de metadata y preflight sólo lectura.
4. El contrato de producción describe el resultado de las migraciones existentes
   `202609290001_whatsapp_commerce`, `202609290002_whatsapp_activation_request`
   y `202609290004_whatsapp_operations`, en ese orden. Registra sus SHA-256 y el
   fingerprint anterior. No agrega una cuarta migración ni aplica DDL al arrancar.
5. CI verify ejecuta el Dockerfile/CMD real del candidato en cada PR/push. El job
   histórico opcional C′/B′ sigue separado y no sirve como evidencia del main nuevo.

El orden build → guardar variables runtime → retirar contenedores se verificó
en el código público de Coolify v4.3.18,
[`ApplicationDeploymentJob.php`](https://github.com/coollabsio/coolify/blob/v4.3.18/app/Jobs/ApplicationDeploymentJob.php#L744)
(SHA-256 `9a78c9ab121ba13cbf4a2cb280d4754a140c3769c7f66ea82fe6413e1c857f45`).
El contrato de `run`, puertos y `--no-deps` se contrastó con la
[documentación de Docker](https://docs.docker.com/reference/cli/docker/compose/run/).
La prueba local de Compose acredita el comando; no sustituye una ejecución completa
del proveedor instalado. Las variables de identidad y conexión deben existir
tanto en build como en runtime y seguir coincidiendo después del corte.

## Ensayo reproducible

`python3 scripts/qa/release-runtime.py --evidence <directorio-temporal>`:

- Ejecuta el wrapper real con Docker simulado para probar orden y propagación de
  fallo de build/gate; prueba aparte el comando Compose real contra MySQL real.
- Construye una imagen sellada para el SHA del checkout y usa una red interna y
  un volumen propios, sin puertos ni credenciales reales.
- Rechaza el esquema anterior de producción con `ROLLBACK_EXPANSION_MISSING`.
- Aplica sólo a MySQL descartable las tres migraciones cuyos hashes fija el contrato.
- Exige el nuevo fingerprint
  `7941abbd1ab5a72d5df3028c8ef755427bdf8e85042bff37bd224964502b8bb2` (153 tablas).
- Prueba gate y rechazo de SHA obsoleto junto a un contenedor vivo, sin recrearlo.
- Arranca el CMD en ambos perfiles, exige health con SHA exacto, `db=up`,
  `Cache-Control: no-store`, esquema conservado y cero DDL de arranque.
- Limpia exclusivamente recursos efímeros creados y etiquetados por el ensayo.

## Condiciones de la intervención real pendiente

La expansión es aditiva: diez tablas nuevas y tres columnas con defaults que
mantienen comercio apagado. MySQL DDL no se revierte con una transacción. Se
requieren backup fresco off-site, restore probado en destino aislado, control de
trabajo en vuelo y autorización de la migración/SHA/ventana antes de ejecutarla.
Ante un fallo parcial no repetir SQL a ciegas: comparar metadata y preparar la
reparación exacta; nunca usar `db push` para eludir el contrato.

El código anterior que esté corriendo puede seguir durante la expansión, pero
reiniciar una imagen histórica exige comprobar su entrypoint y su contrato sobre
el esquema nuevo. No asumir que C′/B′ aceptan ese fingerprint: preparar y ensayar
un rollback compatible antes del corte. Este cambio no acredita ese rollback ni
autoriza una migración remota o una promoción a producción.
