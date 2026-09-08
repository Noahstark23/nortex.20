# Capacidad de Nortex: inspección del Droplet

Fecha: 2026-09-08. Inspección de lectura mediante conector DigitalOcean y panel autenticado; contraste independiente del agente de infraestructura con código local. Sin cambios de servidor, instalaciones, reinicios, llamadas a IA ni carga sintética sobre producción.

## Resultado

**La capacidad máxima de negocios/cajas todavía no está medida.** La ficha de hardware y una gráfica de CPU no permiten afirmar que soporta 50, 100 o 1.000 negocios. Las pruebas funcionales/transaccionales locales tampoco sustituyen una prueba de carga.

La gráfica observada no muestra CPU continuamente saturada. No se verificaron memoria disponible, swap/OOM, espacio ocupado, conexiones MySQL ni latencia de ventas; por tanto no se certifica margen ni capacidad sostenible.

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
- El intento SSH de lectura se detuvo porque no había identidad de host conocida bajo verificación estricta; no se deshabilitó esa validación. Web Console no abrió una sesión utilizable desde el navegador controlado. No se ejecutaron comandos dentro del host.

No se conoce qué parte del uso corresponde a ventas, MySQL, Coolify, staging, builds, backups o jobs. Tampoco se verificó el SHA desplegado ni cuántos procesos/servicios comparten RAM. El Compose del repositorio define app+MySQL+backup; no se presenta como inventario de contenedores reales.

## Qué implica el monolito

Medición local actual: `backend/server.ts` 14.266 líneas y `components/POS.tsx` 6.892. Son problemas de mantenimiento y alcance de cambios, no una fórmula de usuarios soportados. El POS corre en el dispositivo del usuario; su tamaño afecta ese dispositivo y la carga inicial. El cuello del Droplet depende de lo que ejecuta el backend y MySQL.

El agente de infraestructura comprobó estos puntos en el checkout, sin atribuirlos automáticamente al candidato de producción:

1. Once construcciones Prisma runtime, incluida la compartida (`backend/server.ts:239`, `backend/lib/prisma.ts:16`). Más pools potenciales; faltan conexiones abiertas/espera medidas.
2. `salesService.ts:965`: el correlativo está después de validaciones, **no al comienzo de la transacción como decían notas antiguas**. Todavía precede al trabajo por renglón (`:1013`) y queda bloqueado hasta commit; medir cajas del mismo negocio, lotes y tickets largos.
3. Exportación fiscal carga ventas mensuales y serializa XLSX en el handler (`server.ts:13915`, `:13964`). Puede competir con cobros; no se reprodujo degradación en esta inspección.
4. Crons en el proceso web (`server.ts:14241`) y recorrido de activos/tenants (`services/depreciation.ts:214`) comparten recursos. No confundir idempotencia de un job con aislamiento de su costo.
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
- D10: caracterizar y extraer exportaciones, luego medir su aislamiento; reducir monolitos por dominios pequeños.
- Añadir benchmark anterior al [plan de desarrollo](PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) como puerta de capacidad antes de una expansión comercial.
- Elegir aumento de RAM/CPU o separación de cargas después de identificar el recurso limitante. Añadir una segunda réplica de API exige resolver antes rate limits/cachés/jobs por proceso; no es un escalado seguro automático.

Conclusión operativa: se verificaron recursos y una semana de CPU/I/O; **no se ha determinado todavía cuántos negocios soporta Nortex con garantías de servicio**. No se cambió infraestructura ni se realizó una prueba de carga.
