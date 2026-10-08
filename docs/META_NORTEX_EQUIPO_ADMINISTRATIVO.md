# Meta de Nortex: un equipo administrativo accesible

Dirección acordada con el fundador el 2026-09-09, estructurada el **2026-09-19**.
Responsable de producto: fundador de Nortex. Esta es la fuente de prioridades;
el [estado verificable](ESTADO_ACTUAL_NORTEX.md) distingue código, QA y despliegue.

## Resultado que perseguimos

**Que un pequeño negocio de Nicaragua pueda encargar trabajo de contabilidad,
recursos humanos y finanzas a Nortex, seguir su avance y recibir un resultado
comprobable, con un objetivo de precio de US$20 por negocio al mes.**

La persona expresa una necesidad. Nortex consulta sus datos autorizados, explica
lo encontrado, conserva lo pendiente, solicita información o decisiones concretas
y comprueba el resultado. El POS conserva su rapidez, carrito y operación habitual.

El propósito social es recuperar tiempo, conservar capital y reducir pérdidas
administrativas. Mejorar ingresos es una aspiración a medir; no se promete salir
de la pobreza por usar el sistema. El precio indicado es un objetivo de producto,
no una modificación de tarifas ni una autorización de cobro.

## Qué significa un agente de Nortex

Un agente tiene un **trabajo definido, herramientas autorizadas, límites, estado
durable y un criterio de finalización**. Puede investigar, preparar, pedir ayuda y
retomar. El modelo interpreta y explica; los servicios deterministas calculan y
registran los efectos aprobados. Crear un borrador completa solamente un encargo
que se haya definido como preparación.

| Papel del producto | Primer trabajo útil | Resultado verificable |
|---|---|---|
| Contabilidad | W01: revisar la semana e investigar diferencias de caja | Informe versionado, fuentes, diferencias explicadas o excepciones asignadas, aceptación humana |
| Recursos humanos | W02: preparar y revisar la planilla | Conceptos calculados por el motor laboral, incidencias resueltas y versión revisada; pago separado |
| Finanzas | W03: organizar compromisos y caja de 7/30 días | Plan con corte, disponibilidad acreditada, cobros esperados separados y supuestos revisados |
| Coordinación | Conservar objetivos, pasos, dependencias y responsables | Trabajo recuperable tras salir o reiniciar; siguiente paso y resultado visibles |

Son capacidades del producto. Los [agentes de desarrollo](EQUIPO_DESARROLLO_NORTEX.md)
construyen y verifican esas capacidades. Ninguno de estos nombres acredita una
profesión regulada ni sustituye la revisión humana de normas y casos especiales.
Un mismo modelo puede atender varios perfiles; no se lanzan tres llamadas por
cada pregunta.

## Primer resultado completo

**W01: «Revisá mi semana y ayudame a aclarar las diferencias de caja».**

1. Elegir semana y turnos, con corte Managua y permisos actuales.
2. Consultar cierres y movimientos; distinguir evidencia histórica y datos actuales.
3. Explicar diferencias sustentadas y guardar preguntas, documentos o decisiones
   pendientes con responsable. Lo desconocido permanece pendiente.
4. Salir del panel, vender y volver otro día conservando trabajo y carrito.
5. Aportar evidencia o realizar una corrección desde su flujo autorizado; reconsultar.
6. Revisar y aceptar una versión exacta del informe. Mostrar **aceptado con
   excepciones** cuando existan pendientes; usar **conciliado** sólo cuando todas
   las diferencias tengan explicación verificable.

Aceptar ese informe no cierra caja, no ajusta saldos y no crea un asiento. Las
lecturas W01/W01B ya existen en un candidato local; faltan el encargo completo,
asignación, aceptación y evidencia del uso real. Ver [roadmap](ROADMAP_AGENTES_NORTEX.md).

## Lo que conservamos y lo que viene después

- Compras conversacionales, reposición, vencimientos y promociones siguen dentro
  del alcance, con sus propios contratos. Los criterios humanos A/B/C se preservan
  en [H01](CONTRATO_COMPRAS_CONVERSACIONALES_H01.md); aún necesitan reparación y QA.
- RAG aporta ayuda revisada y citada. Las cifras vienen de servicios autorizados.
  Biblioteca editorial implementada localmente no equivale a artículos publicados.
- Nortex y WhatsApp privado comparten dominio; el canal comercial sigue separado.
  Texto, documentos y voz se habilitan sólo donde su recorrido esté acreditado.
- Después de W01 durable: W02 y W03; para un negocio sin empleados W03 puede ir
  primero. Después se ofrece MCP de lectura/preparación sobre capacidades aceptadas.
- W04 —evaluar una contratación— coordina W01–W03 con datos mínimos. No contrata,
  despide, transfiere dinero ni envía declaraciones automáticamente.

## Economía y aceptación

| Importe | Significado |
|---|---|
| US$20/negocio/mes | Objetivo comercial; debe sostener IA, infraestructura, soporte y operación |
| US$2/negocio/mes | Presupuesto inicial de IA compartido por usuarios, especialistas y canales |
| Hasta US$10/negocio/mes | Ampliación mediante solicitud del dueño y aprobación de Nortex; sin cobro automático |
| US$20/mes en total | Techo de IA de esta etapa; no aumenta al agregar agentes, entornos o clientes |

La política de US$2 existe en el candidato posterior, pero no está consolidada en
este checkout. No habilitar consumo basándose en esta tabla: verificar código y
configuración del candidato exacto. Presupuesto agotado conserva trabajo guardado,
consultas deterministas permitidas y funciones habituales. Ver [reglas](REGLAS_AGENTES_NORTEX.md).

El piloto mantiene ferretería y farmacia. La referencia de ferretería aportada no
acredita identidad de tenant ni consentimiento sobre datos. Faltan responsables
identificados, farmacia y las revisiones pertinentes; no publicar contactos aquí.

Objetivos iniciales, todavía no resultados: al menos diez pares de tareas
manual/asistente por trabajo y vertical, alternando orden; reducir un 20% la
mediana de tiempo humano sin aumentar correcciones; cero incidentes críticos.
Medir tareas no terminadas, tiempo total, espera y costo por tarea. W01 se evalúa
primero; no esperar a terminar RRHH para aprender del uso real.

## Cómo se gobierna esta meta

El [roadmap](ROADMAP_AGENTES_NORTEX.md) decide el orden; la
[arquitectura](ARQUITECTURA_AGENTES_NORTEX.md) define los contratos propuestos; las
[reglas](REGLAS_AGENTES_NORTEX.md) fijan los límites y mantenimiento documental.
[AGENTS](../AGENTS.md) y [CLAUDE](../CLAUDE.md) conservan las reglas de ingeniería.

Todo lote debe indicar qué trabajo ayuda a terminar, quién lo revisa y qué prueba
su resultado. Se preservan A00–A07, C00/D00–D14 y E01–E08: no se crea un backlog
competidor ni se declara terminado un pendiente por cambiarle de nombre.
