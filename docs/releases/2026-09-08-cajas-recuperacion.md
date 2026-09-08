# Recuperación persistente y cierre del hueco de cotizaciones

## Publicación autorizada del candidato

El usuario confirmó "avancemos" después de la solicitud explícita de publicar
v4 para CI/staging sin producción. Se prepara una rama dependiente de PR #205,
sin cambiar main ni hacer merge. Las capturas sintéticas se incluyen en Git;
los reportes JSON y parches citados permanecen en la carpeta local persistente,
no son archivos publicados ni acreditan CI remoto. El SHA publicado y sus checks
deben registrarse por separado. Producción continúa sin autorización.

## Estado y origen

Fecha: 2026-09-08. Reparación local; no autorizada ni desplegada a producción.
Base: `bf3de14cbec56584ab96db3410e273b11782dbce`.
Carpeta persistente: `/Users/stark/Documents/Codex/nortex-candidates/cajas-20260908`.

La carpeta previa `/private/tmp/nortex-staging-gate.y8PqhO/repo` y el sandbox de reproducción desaparecieron. Git aún conserva el commit base, pero no el parche no confirmado. Se reconstruyó el candidato a partir de ese commit y de las ediciones registradas; las pruebas se ejecutaron nuevamente. No se conoce la causa de la desaparición ni se atribuye a una persona.

No se cambió la rama, índice o trabajo pendiente del checkout principal. Esta carpeta es una exportación de Git, no un worktree nuevo. Las dependencias se instalaron con `npm ci --ignore-scripts`, respetando package-lock; Prisma local 6.4.1 se generó explícitamente con Node 22.23.2.

## Contratos reparados

- POS y servidor usan `resolveLegacySaleMode`: unidad/caja/cajas sin modo ni paso explícitos requieren enteros; se conservan las configuraciones explícitas y las medidas legítimas.
- PACK exige empaques completos; 18 piezas BASE son válidas, 1.5 cajas de 12 no.
- El ticket conserva el error de cantidad y bloquea el cobro guiado hasta corregirlo. No trunca ni redondea la entrada.
- Hueco adicional reproducido en esta ronda: `resolveQuotationItems` aceptaba 1.5 cajas legacy y emitía un snapshot MEASURED. Ahora la creación de cotizaciones usa el mismo resolver. Prueba roja ejecutada antes del cambio y verde después.
- No se reescriben snapshots históricos de cotización, ventas, inventario ni colas offline. Las cotizaciones históricas explícitamente medidas conservan su contrato; no se afirma que se hayan conciliado datos históricos reales.

## Evidencia actual

- Suite general tras ampliar mutación: 4.725 pruebas aprobadas; 147 omitidas, NO contabilizadas como aprobación. Reporte JSON en `reports/cajas-final-tests.json`.
- Pruebas dirigidas de cantidades, cotizaciones y normalización: 47 aprobadas.
- TypeScript, build y sistema de diseño pasaron durante la reconstrucción. El cambio posterior de cotización es solo backend y volvió a pasar la suite general; TypeScript se repitió.
- Integración requerida final: 161 casos aprobados en 19 suites, sin omitidos; HTTP real y MySQL 8 descartable. Resumen persistente en `reports/cajas-integration-summary.txt`.
- La regresión HTTP añade a los rechazos de venta sin efectos el rechazo de una cotización de 1.5 cajas, comprobando que no aparece ninguna cotización nueva ni cambian los snapshots de negocio.
- El fixture inicializa el catálogo de cuentas antes de comparar efectos. No se omiten stock, ventas, turno, auditoría, Kardex, asientos o saldos de la comparación.

## Entrega recuperable

### Artefacto v4 vigente y revisión final local

`reports/cajas-candidate-v4.patch`, SHA256:
`db4b8c80b9dd9f6c9a01c39eb09beb7e2039e37bc542c2f277bceefa0bb7f945`.
Conserva los 15 archivos del v3; el único cambio adicional es pasar env: minimal
a la espera Docker/MySQL del runner visual. Esa llamada heredaba el entorno
del proceso, contradiciendo el aislamiento del resto del runner.

Node --check y la comprobación inversa del parche pasaron. Se ejecutó el runner
actualizado: inició una base propia y llegó a salud/preview; Ctrl-C terminó con
código 0 y eliminó solo esa base sintética. La sesión visual anterior quedó viva.
No se modificó producto ni tests después de la suite general de 4.731 aprobadas.

Revisión final de lectura: el parche preserva tenant y autoridad de producto,
no incorpora migraciones ni escrituras de stock fuera del flujo existente;
el runner limita puertos a loopback y no hereda claves de proveedores. La suite
posIntegrity está incluida tanto en qa-integration-required.sh como en el contrato
del quality gate. No se hallaron otros problemas nuevos en este diff acotado.
Esto no aprueba la configuración del producto real ni los pasos de promoción.

### Artefacto v3 histórico

`reports/cajas-candidate-v3.patch` reúne 15 archivos de producto, tests,
configuración y runner visual respecto a la base bf3de14. SHA256:
`b29f067a349c717079492a6db07e7150268a238ea1fa7308896267658df90f3c`.
La comprobación `git apply --reverse --check` pasó sin aplicar el parche.
Documentación, capturas y reportes se conservan aparte en este candidato;
no están contenidos en el parche de código.

Suite general posterior a la etiqueta: 4.731 aprobadas, 0 fallidas, 147 omitidas
no contabilizadas como aprobación (`reports/cajas-final-v3-tests.json`).
Check de diseño: 92 archivos, sin infracciones. TypeScript y build del ajuste
de etiqueta pasaron en la ronda anterior. Las 57 fuentes del reporte de mutación
siguen idénticas al candidato; el nuevo test de etiqueta se ejecutó en la suite
general posterior, no en aquella corrida de mutación.

La comprobación inversa no implica commit, reintegración al checkout principal,
CI remoto ni autorización de publicación. Las versiones v1/v2 son históricas.

### Ronda posterior: mutación del resolver y POS

La primera corrida dirigida del resolver produjo 29 killed y 4 survived de 33.
Faltaban pruebas que distinguieran COUNTED de MEASURED con paso entero, MEASURED
explícito sin paso y unidad ausente. Se añadieron tres pruebas de conducta, sin
cambiar producto ni bajar el umbral. La nueva corrida conjunta usa 68 pruebas:
`legacySaleMode.ts` 33/33 killed y `posActivation.ts` 192/192 killed; total 225/225,
0 survived, timeout, NoCoverage o errores. Reporte: `reports/cajas-mutation.json`.

El alcance global incluye ahora `legacySaleMode.ts`. El piso de posActivation
se realineó de 221 a 192 porque se eliminó de ese archivo la implementación
legacy duplicada; el nuevo módulo añade 33 y el total conjunto sube a 225.
El umbral global continúa en 100. Esta medición dirigida NO acredita una corrida
global de `npm run test:mutation`; su resultado posterior se registra abajo.
También se repitieron TypeScript (sin errores) y `mutationFunctionScope.test.ts`
(28/28 aprobadas).

Parche vigente de código, pruebas y configuración: `reports/cajas-candidate-v2.patch`.
SHA256: `552da0a0abbaefec9f58ec38defd16728124f5428936c92a5a165d6fad584a5d`.
Su comprobación inversa pasó sin escribir archivos. La versión anterior se conserva
como evidencia histórica, no describe ya las pruebas/configuración ampliadas.

`reports/cajas-candidate.patch` contiene los ocho archivos de código/pruebas respecto a la base. SHA256: `16780846d79337b2db2f405a1aff7e483cb07c240c3f2e44bf4cafc6f7ce170f`.
`git apply --reverse --check reports/cajas-candidate.patch` pasó: el parche describe el estado presente y no se aplicó destructivamente. No equivale a un commit o a aprobación de integración.

Aprendizaje: no dejar la única copia de una reparación financiera sin commit en `/tmp`. Conservar código, parche y resultados en ubicación persistente; los temporales solo alojan servicios y datos sintéticos descartables.

## Recorrido visual renovado

Se ejecutó el build real con Express y MySQL 8 en una sesión local independiente,
creada por `tools/qa/local-visual-session.mjs`. Base tmpfs propia, credenciales
aleatorias no persistidas, solo loopback y proveedores externos desactivados.
El proxy local sustituye analytics.js para no enviar telemetría de la prueba.
No se modificó el smoke de run-nortex ni se reutilizó una base de usuarios.

Desde el navegador: registro sintético, catálogo de ejemplo de ferretería,
apertura de caja con fondo cero y POS real. Resultados observados:

- Tornillos (caja), catálogo legacy: al escribir 1.5 y salir del campo aparece
  el error de enteros y ambos cobros quedan deshabilitados. Se conserva la última
  cantidad válida en el ticket; el screenshot muestra 1, no una venta de 1.5.
- Corregir a 2 elimina el error, muestra C$90 y habilita ambos cobros.
- Cable eléctrico: 1.5 metros conserva la fracción, total C$27 y cobro habilitado.
- No se confirmó ninguna venta por navegador en esta ronda. La evidencia
  transaccional sigue siendo la integración HTTP/MySQL indicada arriba.

Capturas actuales en `evidence/2026-09-08-cajas/`:
`01-caja-fraccion-rechazada.jpg`, `02-dos-cajas-validas.jpg`,
`03-metro-fraccion-valida.jpg`.

Hallazgo de presentación pendiente: inventario aún rotula las cajas legacy como
"Legado fraccionable", aunque POS/backend aplican ahora enteros. No confundir esa
etiqueta con la regla efectiva. Este recorrido no acredita uniformidad visual de
todo Nortex ni una auditoría de contraste completa.

## No demostrado en esta ronda

### Diagnóstico acotado de actualización PWA

**Resultado posterior observado:** la sesión antigua mostró finalmente el aviso
"Actualización lista", sin forzar ServiceWorker.update ni borrar cachés. Se
capturó el aviso y se pulsó "Recargar Nortex". El DOM de la misma pestaña/origen
pasó de index-BUdJdnaX.js a index-BV_9DAIC.js; inventario mostró la nueva etiqueta.
Al volver a Vender se recuperó el carrito previo: Tornillos (caja), cantidad 2,
precio C$45, total C$90, caja abierta. No se confirmó una venta ni se modificó
stock. Capturas: `05-pwa-actualizacion-lista.jpg` y
`06-pwa-carrito-preservado.jpg`, en el directorio de evidencia de esta fecha.

Queda verificado este recorrido real de aviso, recarga explícita y recuperación
del carrito local. No se midió el plazo de propagación ni se ensayó una venta ya
en cola offline durante el cambio de versión; no extrapolar a ese escenario.
Las observaciones anteriores de espera se conservan a continuación como historia.

La inspección del DOM confirmó dos bundles distintos del mismo backend local:
la sesión antigua 127.0.0.1 cargó `index-BUdJdnaX.js`; el origen limpio localhost
cargó `index-BV_9DAIC.js`, correspondiente al build nuevo. Esto demuestra una
sesión desactualizada, no identifica por sí solo la causa interna.

El código configura autoUpdate en VitePWA y registra el SW al cargar la página.
PwaUpdateNotice escucha controllerchange y ofrece recarga explícita; no recarga
automáticamente durante una venta. La API de diagnóstico ServiceWorker de CDP
no está soportada en este navegador integrado. No se borraron cachés ni se
desregistró el SW, y no se alteró ese mecanismo sin reproducción causal.

Pruebas actuales de pwaUpdate y cartPersistence: 128 aprobadas en dos archivos.
Son pruebas de eventos simulados y del contrato de persistencia, no demuestran
la instalación/activación de una actualización real. El recorrido real de PWA
abierta, incluido carrito y cola pendiente, conserva estado pendiente antes de
promoción. No confundir abrir un origen limpio con aprobar actualización.

### Etiqueta de inventario reparada después de la mutación global

Inventory.tsx consulta ahora resolveLegacySaleMode para distinguir en la etiqueta
legacy "cantidades enteras" de "fraccionable". Los selectores de configuración y
filtro dicen "Configuración automática (legado)"; no cambian valores enviados ni
reglas de filtrado. Sin escrituras de negocio ni cambios del resolver.

Se reprodujeron seis fallos en el inventario renderizado antes del cambio y
pasaron los seis después. Corrida conjunta: 34 tests aprobados entre etiqueta,
lotes y cantidades. TypeScript y build también pasaron. La corrida global
precede este cambio de presentación; no se afirma que incluyera el nuevo test.

Navegador: la pestaña original conservaba la PWA anterior incluso tras recarga.
Un origen limpio localhost contra el mismo backend sintético confirmó Tornillos
(caja) como "Legado · cantidades enteras", 40 cajas, C$45. Captura actual:
`evidence/2026-09-08-cajas/04-inventario-caja-entera.jpg`.
No se borraron cachés, carritos ni datos de la sesión original. La actualización
de una PWA ya abierta queda como recorrido separado por verificar antes de release.

### Revisión del parche de cantidades

Revisión de lectura del parche v2 y de los cuerpos actuales, sin modificar las
fuentes durante la corrida global:

- La validación PACK comprueba enteros antes de multiplicar por packSize y
  compara la cantidad base derivada con la enviada; no redondea fracciones.
- La resolución de líneas cotizadas conserva el filtro por tenant en la
  relación quotation y verifica identidad del producto, vigencia y estado SENT.
  Un snapshot MEASURED explícito prevalece sobre cambios posteriores del catálogo.
- El resolver compartido no añade consultas, escrituras ni nuevas autoridades
  de tenant, precio o stock. La reparación no requiere migración de schema.
- Límite de aceptación comercial: una caja configurada MEASURED o con paso
  fraccionario explícito todavía admite fracciones por diseño. Se pidió nombre
  o SKU del producto reportado para contrastar ese caso sin pedir credenciales
  ni detalles de clientes/facturas. No se declara cerrado el incidente real
  solo por reproducir el caso legacy sintético.

Esta revisión no es aprobación de release. Sigue pendiente corregir la etiqueta
"Legado fraccionable" del inventario. La compuerta global posterior pasó como
se detalla a continuación.

### Corrida global finalizada

Se ejecutó `npm run test:mutation` en este candidato con Node canónico y entorno
limitado a PATH, HOME y NODE_ENV=test. Stryker instrumentó 57 archivos con 5.696
mutantes; su dry-run pasó con 3.222 tests en 41 segundos. La sesión de ejecución
75739 terminó con código 0 tras 6 minutos 57 segundos. Resultado: 5.672 Killed,
4 Timeout, 20 Ignored históricos, 0 Survived, 0 NoCoverage y 0 errores. Score 100%.
El verificador posterior aprobó los 57 módulos y las 11 funciones completas
controladas por AST. Se compararon las 57 fuentes incluidas en el JSON con los
archivos actuales: ninguna diferencia.

Tres Timeout tienen statusReason Hit limit reached: i-- en nicaLabor.ts:389,
i-- en calc-laborales.ts:96 e index -= 1 en scaleLabels.ts:102. El cuarto cambia
división a multiplicación en nicaLabor.ts:47 y no aporta statusReason; no se
atribuye automáticamente a carga del entorno ni se presenta como Killed.
Reporte completo: `reports/mutation/mutation.json` y vista HTML en
`reports/mutation/index.html`. Esto aprueba la compuerta configurada, no muta
todo el ERP ni acredita staging/producción.
No se habilitó ignoreStatic ni se bajó el umbral de 100. Se excluyen de la copia
del sandbox únicamente archivos .env, dist y reports, no fuentes de producto.

Se reconciliaron las instrucciones de `.claude/skills/nortex-qa/SKILL.md` con
CLAUDE: importar funciones reales en las pruebas, no replicar fórmulas, separar
omisiones de aprobaciones y no inferir autorización de commit o promoción.
El parche v2 es anterior a estos cambios de configuración/documentación;
habrá que regenerar el artefacto final tras concluir la corrida.

No se recuperaron las capturas antiguas; las capturas indicadas arriba son nuevas. La mutación global pasó antes del ajuste de presentación, y la etiqueta de inventario ya está reparada y verificada. El parche v4 está generado, comprobado y revisado localmente. La actualización de PWA abierta con carrito se verificó; no se probó la actualización con venta pendiente de sincronizar. Faltan publicación autorizada del candidato, CI, staging del mismo SHA y autorización de producción. No se han inspeccionado las facturas ni la configuración del producto real reportado.

El objetivo amplio de uniformidad visual, mejora del producto completo y promoción segura continúa abierto.
