# Capacidad de Nortex: inspección del Droplet

Fecha: 2026-09-08. Inspección inicial mediante conector DigitalOcean y panel autenticado, ampliada por el integrador mediante terminal autenticada de Coolify. Contraste de código del candidato `484f58a`. La lectura inicial no cambió el servidor; la actualización distingue las configuraciones autorizadas posteriores, el intento de restore y su limpieza. No se ejecutó una prueba de carga sobre producción.

## Resultado

**La capacidad máxima de negocios/cajas todavía no está medida.** La ficha de hardware y una gráfica de CPU no permiten afirmar que soporta 50, 100 o 1.000 negocios. Las pruebas funcionales/transaccionales locales tampoco sustituyen una prueba de carga.

La gráfica observada no muestra CPU continuamente saturada. Después se obtuvo un snapshot de RAM, swap, disco y contenedores. No hay serie histórica de esas métricas, conexiones/espera MySQL ni latencia de ventas: el snapshot no certifica margen sostenible ni ausencia histórica de OOM.

## Infraestructura verificada

| Dato | Resultado del conector |
|---|---|
| Droplet | `servidor-nortex`, ID `547282815` |
| Estado | `active` |
| Plan | `s-2vcpu-4gb`, Basic |
| CPU | 2 vCPU |
| RAM provisionada | 4.096 MiB |
| Disco provisionado | 80 GiB; no es espacio libre |
| Región | NYC1, Nueva York |
| Sistema declarado | Ubuntu 24.04 LTS x64 |
| Precio del tamaño | US$24/mes; no representa la factura total de la cuenta |
| Backups/snapshots de Droplet | Listas vacías, sin próxima ventana ni feature backups en la respuesta. Esto no demuestra ausencia de copias SQL externas. |
| Volúmenes adicionales | Ninguno vinculado en la respuesta |

La cuenta también devuelve otro Droplet activo de 1 vCPU/2 GiB/50 GiB en SFO3. Su función respecto a Nortex no se verificó y **no se suma** a la capacidad del servidor principal.

DigitalOcean clasifica Basic como CPU compartida: el acceso sostenido a los ciclos físicos puede variar. No convertir dos vCPU en dos núcleos dedicados garantizados. [Selección oficial de planes](https://docs.digitalocean.com/products/droplets/concepts/choosing-a-plan/)

## Observación de siete días

Panel [Insights de servidor-nortex](https://cloud.digitalocean.com/droplets/547282815/insights), período seleccionado `7 days`.

- Ventana mostrada: 1–8 septiembre de 2026, 1.009 puntos por serie; no atribuir automáticamente la zona horaria de la interfaz a Managua.
- CPU: dos series, `user` y `sys`. Visualmente, `user` está habitualmente alrededor de 15–25 %, con picos próximos a 70 %. El rango numérico accesible del conjunto de series es 1,3735–70,4611 %. **No es media, p95 ni máximo de CPU total agregado**; no se sumaron puntos ni se correlacionaron con eventos.
- Red: el rango de valores visible llega aproximadamente a 11,5 Mb/s. No equivale a capacidad de red medida ni throughput de ventas.
- Disk I/O: valores hasta aproximadamente 8 MB/s en la gráfica. No es disco ocupado, IOPS ni latencia de almacenamiento.
- El panel muestra la invitación a instalar Metrics Agent y no entrega gráficas de RAM o espacio ocupado. No se instaló software para conseguirlas.
- El primer intento SSH se detuvo por identidad de host desconocida bajo verificación estricta, y Web Console no abrió entonces una sesión utilizable. La verificación posterior se realizó desde la terminal autenticada de Coolify; no se deshabilitó la comprobación SSH.

## Snapshot posterior del host y contenedores

El integrador verificó estas lecturas puntuales el mismo día mediante `free -m`,
`df` y estadísticas de Docker. No se equiparan con la ventana de CPU de siete días.

| Medición | Snapshot observado |
|---|---|
| RAM visible del host | 3.915 MiB total; 2.220 MiB usada; 1.695 MiB disponible |
| Swap | 879 MiB usados de 2.047 MiB |
| Filesystem raíz | 16 GiB usados de 77 GiB; 21 %; aproximadamente 61 GiB libres |
| API producción | 235 MiB de RAM |
| MySQL producción | 306 MiB de RAM |
| API staging | 215 MiB de RAM |
| MySQL staging | 415 MiB de RAM |
| Backup | Aproximadamente 38 MiB de RAM |

Producción y staging comparten recursos del host. Estos contenedores no explican
por sí solos toda la memoria del sistema; no calcular memoria libre restando sus
valores a 4 GiB. Swap ocupado no prueba swapping activo ni OOM: faltan tasas,
latencia y evolución temporal. Tampoco se atribuyó el pico de CPU a una actividad
concreta de ventas/builds/jobs.

En Coolify se observó producción con build pack `dockercompose`, Auto Deploy
apagado y versión desplegada `2834497`. Es distinta del candidato `484f58a`;
no acredita staging o producción de NortexGPT nuevo. Los verificadores actuales
admiten `dockerfile` y `dockercompose`: no hace falta cambiar build pack para
satisfacer ese contrato.

## Respaldo y preparación de publicación

Se verificó un objeto SQL off-site con fecha **2026-09-08T09:15:09Z**, **1.150.696
bytes**, **111 tablas** y SHA-256
`497fbfa8ac219fd8ddbb51f21ed19e354496592bdb80a79d9b8ca4c713dbfac3`.
La comparación remota coincidió. Esto acredita presencia e integridad de esa
copia; su edad debe recalcularse para cada promoción.

**Restore real no acreditado.** El intento con terminal que truncaba comandos no
produjo una restauración MySQL verificada ni RTO medido. Al terminar no quedaban
contenedores o directorios del ensayo activos y se eliminó la copia temporal de
`/tmp`. La limpieza no convierte el intento en aprobado. Siguen pendientes el
restore drill y, para documentos de NortexGPT, SQL+originales reconciliados.

El integrador creó y guardó en GitHub tokens de lectura distintos para staging y
producción, con vencimiento **2026-10-08**. Tienen permiso `read`, pertenecen al
mismo Root Team y su alcance es de equipo: **no se acreditó aislamiento por app**.
Crear esos tokens no completa la promoción. Quedan por verificar/configurar origen
API HTTPS e identidad por environment, pin exacto del candidato y protecciones
remotas; tampoco hay staging sano de este candidato acreditado en esta inspección.
El CI de `484f58a` tiene sus cuatro checks verdes según la verificación del
integrador, estado independiente de las compuertas de respaldo y despliegue.

## Qué implica el monolito

Medición del candidato `484f58a`: `backend/server.ts` 14.131 líneas y `components/POS.tsx` 5.924. Son problemas de mantenimiento y alcance de cambios, no una fórmula de usuarios soportados. El POS corre en el dispositivo del usuario; su tamaño afecta ese dispositivo y la carga inicial. El cuello del Droplet depende de lo que ejecuta el backend y MySQL.

El agente de infraestructura comprobó estos puntos en el checkout, sin atribuirlos automáticamente al candidato de producción:

1. Diez construcciones Prisma runtime, incluida la compartida (nueve fuera), excluyendo scripts, tests y comentarios. `scoring.ts` ya importa el cliente compartido. Inventario exacto en [auditoría de escala](SCALING_AUDIT.md#a2--clientes-prisma-runtime). Más pools potenciales; faltan conexiones abiertas/espera medidas.
2. `salesService.ts:1035`: el correlativo está después de validaciones, **no al comienzo de la transacción como decían notas antiguas**. Todavía precede al trabajo por renglón (`:1079`) y queda bloqueado hasta commit; medir cajas del mismo negocio, lotes y tickets largos.
3. La exportación fiscal salió del monolito a `backend/routes/fiscalExports.ts`, pero todavía carga ventas mensuales y serializa XLSX en el handler (`:75`, `:124`). La extracción mejora organización; no acredita aislamiento del event loop ni velocidad. Falta medirla concurrentemente con cobros.
4. Crons en el proceso web (`server.ts:14107`) y recorrido de activos/tenants (`services/depreciation.ts:214`) comparten recursos. No confundir idempotencia de un job con aislamiento de su costo.
5. Búsqueda dirigida en scripts/tests/package/docs no encontró un benchmark ejecutado que mida ventas por segundo o cajas sostenibles. Sí existen objetivos y pruebas de integridad.

Consolidar Prisma, reducir consultas/locks medidos y separar trabajo pesado tiene una relación más directa con capacidad que únicamente mover líneas entre archivos. No dividir transacciones financieras en microservicios para resolver el tamaño.

## Cómo obtener un número defendible

Primero reunir una semana representativa de RAM disponible, swap, espacio/crecimiento de disco, CPU por contenedor, event-loop lag, conexiones/espera MySQL, p95/p99 de venta y peticiones/ventas por minuto en hora pico. Recolectar métricas agregadas sin payloads, secretos ni datos privados de clientes. La instalación de monitoreo o ajustes del servidor constituyen un trabajo posterior, no una acción realizada aquí.

Después ejecutar un candidato con datos sintéticos en un entorno equivalente a 2 vCPU/4 GiB y con las mismas cargas auxiliares relevantes. Recursos locales limitados sirven como aproximación, no como certificación de CPU compartida DigitalOcean. No crear otro Droplet de pago ni hacer pruebas de saturación de producción como parte de esta inspección.

| Cajas activas simuladas | Repartidas | Concentradas | Venta cada 120 s/caja | Pico cada 30 s/caja |
|---:|---|---|---:|---:|
| 10 | 10 negocios × 1 | 2 negocios × 5 | 5 ventas/min | 20 ventas/min |
| 25 | 25 negocios × 1 | 5 negocios × 5 | 12,5 ventas/min | 50 ventas/min |
| 50 | 50 negocios × 1 | 10 negocios × 5 | 25 ventas/min | 100 ventas/min |
| 100 | 100 negocios × 1 | 20 negocios × 5 | 50 ventas/min | 200 ventas/min |

**Son cargas objetivo del ensayo, no capacidades aprobadas.** Para cada escalón: 5 minutos de calentamiento, 20 estable, 5 pico y 10 recuperación. Detener ante corrupción, duplicación, pérdida de trabajo, OOM o cola creciente sin recuperación. Después del mayor escalón aprobado, añadir una prueba prolongada para detectar crecimiento de memoria/conexiones.

Mezcla inicial propuesta: tickets 70 % de 5 renglones, 25 % de 20 y 5 % de 50; ferretería/farmacia, BASE/PACK/fracciones legítimas, lotes, efectivo/crédito y promoción online. Agregar búsquedas, una exportación fiscal de mes poblado y consultas deterministas del asistente. Variar tamaño del catálogo e historial, incluyendo datos suficientes para que las consultas no se beneficien de una base vacía. Haiku se mide aparte; no generar gasto ni confundir demora del proveedor con capacidad del servidor.

Cada escalón concilia ventas, stock, caja, deuda, asientos y auditoría, incluidos reintentos con identidad estable. Un error financiero bloquea ese escalón aunque sus tiempos sean buenos.

Objetivos propuestos: venta p95 ≤2 s, colas estables, cero efectos parciales/duplicados; margen CPU ≤70 %, memoria usada no recuperable ≤75 % y conexiones ≤70 % del límite, sin swap/OOM sostenidos. Fijar la forma de medir cada porcentaje antes de ensayar. Son umbrales iniciales de ingeniería, no valores actuales del Droplet.

```text
demanda de ventas/s = cajas activas × ventas/minuto por caja ÷ 60
cajas soportadas = piso(ventas/s sostenibles medidas × 60 ÷ ritmo por caja)
```

La fórmula se aplica al mismo perfil ensayado y sólo hasta el máximo realmente aprobado. Para convertir cajas activas a negocios registrados hay que medir cajas por negocio y fracción activa en hora pico. Un número alto de registrados inactivos no acredita que puedan cobrar todos al mismo tiempo.

## Trabajo asignado al frente de infraestructura

- D06: consolidar Prisma y medir conexiones/espera bajo carga.
- D08/D09: inventario efectivo de API/MySQL/workers/builds, métricas, respaldo y restauración de SQL+originales; mantener separado estado verificado de configuración aspiracional.
- D10: la extracción de exportaciones está implementada localmente; queda aislar trabajo pesado y medirlo sin bloquear POS. Reducir los restantes monolitos por dominios pequeños.
- Añadir benchmark anterior al [plan de desarrollo](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) como puerta de capacidad antes de una expansión comercial.
- Elegir aumento de RAM/CPU o separación de cargas después de identificar el recurso limitante. Añadir una segunda réplica de API exige resolver antes rate limits/cachés/jobs por proceso; no es un escalado seguro automático.

Estado de cierre: recursos provisionados, siete días de CPU/I/O, snapshot de host/contenedores y copia SQL remota verificados. Tokens de lectura preparados; restore real, identidad/pin completo, staging/producción del candidato y capacidad sostenible todavía no acreditados. No se realizó una prueba de carga.
