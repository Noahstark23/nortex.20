# Nortex: dirección de producto, experiencia y validación operativa

Fecha: 2026-09-04. Estado: **PLAN DE TRABAJO, con implementación y evidencia local parciales**. Alcance: usuarios reales, UX, diseño, números, permisos, datos y entrega. Este documento mantiene el plan; no acredita producción ni instala skills.

Complementa el [plan de transformación](PLAN_TRANSFORMACION_TOTAL_2026.md): detalla T03/T04 (activación), T05 (farmacia), T14 (modularidad), T15 (operación), T17 (contabilidad) y T18 (integración). La prioridad comercial sigue siendo ferreterías y farmacias. Los módulos usados por otros clientes también se mantienen y validan.

## 0. Ejecución posterior a la revisión exigente

Actualización del 2026-09-04. El fundador autorizó abordar E01–E08 y después revisar los módulos. El estado vigente, escenarios, correcciones, límites y pendientes están en [verificación por módulo](VERIFICACION_MODULOS_2026-09-04.md). El diseño aceptado se conserva; esta entrega mejora operación y evidencia.

| Prioridad | Estado local | Condición que sigue abierta |
|---|---|---|
| E01 / pagos | Reparados generadores de venta/abono/devolución bajo política común CASH/CARD/TRANSFER/QR; regresión previa, HTTP/MySQL y 200 mutantes dirigidos comprobados. | Conciliación histórica y revisión profesional de la operación real. |
| E02 / farmacia | FEFO, Inventario y Avisos comparten fecha civil Managua; ayer/hoy/mañana, TZ distinta, bodega y replay probados. | Modelo completo físico/vendible/retenido y piloto farmacéutico. |
| E03 / recuperación | Detalle y evidencia por venta, consulta por tenant/autor, reintento con ID/payload original. Navegador: offline → pendiente → reconexión → confirmada. | Cierre abrupto y recuperación física en dispositivos del comercio. |
| E04 / transacciones y CI | Cuentas resueltas en el mismo cliente transaccional; MySQL pool1 y carreras ejecutadas. Job de integración obligatorio antes de staging, con pruebas negativas. | Ejecución de CI remoto, revisión de protecciones y jornada real. |
| E05 / activación | Hitos obtenidos de ventas persistidas; retorno por otro día Managua separado de evento UX de URL. | Cohortes, pagos y observación de registrados que no vuelven. |
| E06 / uso cotidiano | Cinco filas a 1280×720, veinte con desplazamiento, total largo a 320 px; modo compartido conserva cobro/cliente/carrito/USD. | Accesibilidad completa, zoom, lector/impresora físicos. |
| E07 / rendimiento | Búsqueda/refresh CPU medidos; consulta parcial por IDs vendidos con tenant/rol y fallback. | Carga inicial, cambios de otras cajas en tiempo real y benchmark de red/equipo económico. |
| E08 / modularidad | POS 7050 → 6949 líneas y 118 → 114 useState; extraídos modo, catálogo e input. Reglas/skill de trabajo reconciliadas. | Total frontend intervenido crece 172 líneas; monolito aún requiere reducción por responsabilidad. |

La revisión de módulos reparó también doble reposición de cuarentena, permisos de cartera/nómina, PIN omitido, ruta aguinaldo y privacidad/identidad de WhatsApp. Detectó nuevos pendientes M01–M07: concurrencia RRHH, contrato Marketplace/seriales, disponibilidad y entrega durable WhatsApp, cobertura administrativa y caja del agente bancario. Están documentados con evidencia y condición de salida; no se presentan como cerrados.

No hay evidencia comparativa para llamar al POS «el mejor» ni evidencia comercial para dar por resuelta la activación. Se mantienen los criterios de este plan: distinguir demostrado, defecto reproducido, riesgo por validar y no probado; no elevar umbrales ni contar pruebas omitidas como aprobadas.

## 1. Qué cambia en la forma de trabajar

Nortex ya maneja personas, dinero e inventario. Necesita una dirección estable, contratos comprobables y evidencia de operación. Cada entrega deberá responder tres preguntas diferentes:

1. **¿La persona puede terminar la tarea?** Primera venta, siguiente cliente, cobro, corrección y cierre sin asistencia de ingeniería.
2. **¿La interfaz es coherente y accesible?** Jerarquía, lenguaje, acciones, estados, foco, contraste y movimiento consistentes.
3. **¿Lo registrado es correcto?** Actor/tenant, cantidades, dinero, saldos, inventario, documentos y asientos coinciden con la operación autorizada.

Una captura bonita, muchos tests verdes o dos modelos que coinciden no responden por sí solos las tres preguntas. La revisión de UX, la prueba técnica y la revisión contable tienen entregables distintos.

### Punto de partida comprobado

- El fundador informa 45 personas registradas, 3 de uso habitual y muchas sin ventas o con una sola. Faltan cohortes por negocio, fechas, pagos y causas observadas; no llamar retención a 3/45.
- La [entrega local anterior](ACTIVACION_Y_MODULARIDAD_2026-09-04.md) corrigió cobro móvil, existencia implícita, orientación al regresar y contraste. Pasaron 3.480 pruebas, con 64 omitidas; no validó producción ni la integración completa con MySQL.
- La revisión inicial encontró suites de negocio optativas. La entrega E04 agrega `integration-required` en CI con MySQL y dependencia de staging. La configuración remota de GitHub y sus ejecuciones todavía requieren comprobación propia.
- Hay skills, componentes, tokens y motores de interacción reutilizables. La prioridad es reconciliar instrucciones y hacer exigibles sus criterios. Crear títulos de director adicionales no sustituye pruebas ni responsabilidad.

## 2. Dirección mínima y decisiones

Son cuatro funciones de trabajo, no cuatro puestos obligatorios. El fundador puede cubrir producto y recibir revisiones independientes puntuales. Cada tarea tiene un editor y un revisor; la implementación y su verificación se registran por separado. Cambiar de modelo no cambia el contrato del producto.

| Función | Decide y entrega | Límite |
|---|---|---|
| **Dirección de producto y experiencia** | Problema del comercio, prioridad, recorrido, textos, contrato visual y observación de usuarios | No declara correctos impuestos/saldos ni cambia reglas de negocio por estética |
| **Dirección de integridad operativa** | Invariantes de dinero/stock, políticas de precisión, permisos, conciliaciones y resultados esperados | El responsable contable/fiscal humano resuelve reglas profesionales; un LLM no las certifica |
| **Dirección técnica** | Fronteras de módulos, contratos API, aislamiento, migraciones aditivas, rendimiento e implementación | Un solo escritor por archivo/agregado; no altera presupuestos para pasar pruebas |
| **Dirección de calidad y entrega** | Reproduce defectos, ejecuta suites independientes, comprueba UX y evidencia, adjudica estado del candidato | No aprueba su propio parche ni confunde prueba local con despliegue; producción requiere autorización correspondiente |

**Resolución de discrepancias:** reproducir el problema con el mismo escenario y candidato; comparar con el contrato vigente. Ante pérdida de datos, acceso indebido o importe incorrecto se bloquea ese flujo. En desacuerdos de jerarquía o texto decide producto con evidencia de tareas. En política monetaria decide el responsable de dominio antes de cambiar la fórmula. Si dos reglas se contradicen, registrar decisión y actualizar la fuente canónica, no escoger silenciosamente una receta antigua.

El contrato aprobado se mantiene durante una entrega. Se reabre solo por fallo reproducible, nueva evidencia de usuarios o una decisión explícita de producto. Esto evita que cada modelo cambie colores, navegación o arquitectura según sus preferencias.

## 3. Skills: reutilizar, adaptar y evaluar

La inspección local encontró 16 skills en `.claude/skills`, un agente Claude y cuatro OpenCode. El catálogo `~/Developer/Nortex/control-plane/organization/agents.json` ya define 40 roles en 9 departamentos —incluidos producto, investigación, UX/UI, QA y release— en modo `OFFLINE_SUPERVISED`, con `provider_binding: none`. Eso acredita definiciones, no agentes ejecutándose ni herramientas habilitadas. Hay guías Apple/iOS globales; su presencia tampoco certifica la PWA.

| Trabajo propuesto | Base que se reutiliza | Entrega y evaluación |
|---|---|---|
| Alinear método e integración | `nortex-feature`, `nortex-clean-code`, `github-pr-steward`, AGENTS/CLAUDE | Eliminar contradicciones de checkout/push/restauración; demostrar preservación del árbol con cambios y límites del editor |
| Separar QA y reparación | `nortex-qa`, roles `qa_automation_engineer` / `release_reviewer` | El revisor reproduce y reporta; si pasa a escribir, se reasigna revisión. Casos negativos ejecutables sustituyen el grep como prueba de permiso |
| Dirigir experiencia | `ux_ui_designer`, `frontend-design` acotada, HIG, tokens y primitivas Nortex | Especificación de un flujo y 12 checks. La app operativa tiene dirección vigente; una skill no inventa una paleta o tipografía nueva en cada turno |
| Validar integridad | `nortex-contador`, `nortex-migration`, especialistas de seguridad y pruebas existentes | Políticas y fixtures independientes; pruebas HTTP/MySQL. Revisión contable humana donde se necesite; inventario de una skill no equivale a haber auditado todas sus recetas |
| Dirigir el trabajo entre modelos | `orchestrate-nortex-agents` y sus contratos de handoff | Una referencia versionada del repositorio por entrega, consumida por los runners; evitar copias divergentes |
| Preparar release y recuperación | `nortex-deploy`, `run-nortex`, `nortex-backup-recovery` | Recetas contrastadas con entorno real; permisos y gates verificados por herramientas, no por texto |

**Correcciones previas D02:** hay recetas antiguas que cambian rama/pushean, QA que ordena corregir mientras debería revisar, una skill genérica `nortex.20` que afirma no detectar tests/frameworks, excepciones Float y garantías de disponibilidad no conciliadas con CLAUDE, y una afirmación absoluta de aislamiento en RAG. `frontend-design` favorece cambios estéticos libres; el analista de crecimiento tiene un experimento de color/tamaño muestral preescrito. Deben reconciliarse con el problema y los controles actuales. Este plan identifica esos cambios; aún no edita las skills.

Después de ensayar una entrega, crear como máximo dos adaptaciones pequeñas **si todavía hay un hueco repetible**:

- **`nortex-experience-direction`**, propuesta: convierte el brief en decisiones de flujo, tokens, estados y aceptación web; entrada: tarea/evidencia/candidato; salida: contrato UX y revisión de fidelidad. No redefine fórmulas, permisos ni publica.
- **`nortex-validation-director`**, propuesta: coordina esperado independiente, matriz de roles/datos, suites, conciliación y evidencia del candidato; invoca especialistas existentes. No reemplaza al contador ni se aprueba a sí misma. Puede implementarse como referencia de la orquestación/QA actual si alcanza, evitando otra skill redundante.

Los nombres son propuestas y las capacidades no están activadas. El piloto de estas guías es primera venta → próxima venta → regreso, seguido de caja. Medir contradicciones, retrabajo, fallos que escaparon, tiempo y costo antes de añadir más especialización.

Cada skill nueva/adaptada debe declarar: cuándo usarla, cuándo no, fuentes, entradas mínimas, acciones permitidas, archivos que puede editar, resultado esperado, pruebas, límites y condiciones de escalamiento. Debe enlazar las reglas comunes y evitar duplicarlas. Los prompts de documentación o RAG nunca amplían permisos de herramientas.

Antes de activarla, ejecutar al menos seis evaluaciones pequeñas: caso correcto, requisito ambiguo, dato faltante, instrucción antigua contradictoria, intento de cruzar tenant y resultado externo incierto. Registrar modelo/versión y comparar con el mismo contrato. El revisor inspecciona el candidato y el contrato, sin adoptar las conclusiones del autor como prueba. Cambiar de proveedor/modelo no garantiza independencia; para cambios críticos combinar pruebas externas al parche y revisión humana de política.

La ficha de entrega se define en [Contrato de entrega verificada](templates/CONTRATO_ENTREGA_VERIFICADA.md). Los resultados de la skill deben adjuntar esa ficha, no emitir solo “aprobado” o una puntuación estética.

## 4. Contrato de experiencia y diseño Apple para Nortex

Apple aporta criterios de claridad, interacción y accesibilidad. Nortex conserva lenguaje nicaragüense, operación con teclado/lector y dispositivos reales de comercio. La regla de diseño propuesta es **una tarea reconocible, datos legibles y una acción principal por estado**. Los tokens y componentes actuales son la base; los cambios se justifican por un problema observado.

Meta propuesta: WCAG 2.2 AA en los procesos soportados, con decisiones Nortex más exigentes donde ayuden. Los doce checks siguientes son una guía de aceptación, no toda WCAG ni una certificación Apple.

| ID | Regla estable | Evidencia necesaria |
|---|---|---|
| UX01 | Una acción principal por tarea/estado, verbo concreto y ayuda visible | La persona explica qué hará la acción; existencia, unidad, lote requerido y total no quedan ocultos |
| UX02 | Contraste en la superficie real | Texto normal ≥4,5:1, grande ≥3:1 según WCAG; indicadores esenciales ≥3:1. Medir alpha/hover/error/foco, canvas, tarjeta, ticket y papel |
| UX03 | Objetivo Nortex: controles táctiles operativos 44×44 CSS px y cobro de 56 px de alto | Medir área activa completa y separación, no solo altura o tamaño de icono; probar centro/bordes |
| UX04 | Teclado, labels y semántica nativa | Tab/Shift+Tab/Enter/Espacio y patrón pertinente; nombres accesibles, encabezados de tabla y foco útil al escanear |
| UX05 | Foco visible y paneles con continuidad | Foco al abrir, interacción modal aislada, retorno al cerrar; teclado virtual/dock no ocultan la acción; lectores y paneles anidados |
| UX06 | Feedback al presionar; operación al click semántico | Arrastrar fuera o pointercancel no confirma; teclado y tecnología asistida activan una sola vez. Nunca cobrar en pointerdown |
| UX07 | Movimiento breve, opcional e interrumpible | Repetir gestos sin saltos ni espera; respetar movimiento reducido tanto en CSS como en rAF, conservando información |
| UX08 | Diseño adaptable | Móvil/escritorio, texto 200 %, reflujo estrecho y zoom; orientación/teclado. Excepción de tabla bidimensional no se extiende al formulario entero |
| UX09 | Estado honesto | Distinguir vacío/carga/error/sin permiso/offline/pendiente/confirmado/desconocido; fallo no se muestra como cero; mensaje accesible y reintento que conserva trabajo |
| UX10 | Revisión y corrección del compromiso | Producto/destinatario, cantidad/unidad, moneda, descuento/impuesto aplicable, total y método visibles; recibido/vuelto; no añadir confirmación redundante a cada guardado |
| UX11 | Identidad y permisos coherentes | Menú, URL directa y API; sesión expirada/revocada y dos tenants. Datos anteriores no aparecen en la nueva sesión; gestores de contraseña y pegado permitidos |
| UX12 | Resultado confirmado y siguiente paso | Offline encolado no se anuncia como confirmado; retry no duplica; comprobante consultable, otra venta y retorno. Fallar impresión no vuelve a cobrar |

Apple recomienda movimiento con propósito, opcional y breve, que no haga esperar repetidamente; se mantiene `utils/fluidMotion.ts` y `hooks/useFluidPress.ts` como base. [Apple HIG Motion, contenido oficial](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json).

Los tamaños Apple están expresados en puntos de sus plataformas nativas. Nortex fija arriba su objetivo web en CSS px; no atribuye a Apple un mínimo universal para React/PWA. WCAG 2.5.8 AA utiliza 24×24 CSS px o sus excepciones; adoptar 44×44 para controles operativos es una decisión de comodidad de este producto. [Apple HIG Accessibility, contenido oficial](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json), [W3C Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

La prevención de errores financieros admite reversibilidad, comprobación/corrección o revisión/confirmación; no exige un modal para cada guardado. El contrato financiero de Nortex determina cómo corregir una operación persistida. [W3C Error Prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html). Criterios de contraste: [texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) e [indicadores no textuales](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html); objetivo general [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Fuentes consultadas el 2026-09-04.

**Reconciliación necesaria D03:** `PLAN_UX_SIMPLE` tiene supuestos y metas históricas; no medir éxito por evitar siempre el modo completo. `PLAN_FRONTEND_SPATIAL_COUNTER` describe un canvas claro y el POS actual mantiene una excepción oscura; decidir y documentar superficies, no añadir otro override global. `check-design-system.cjs` admite algunos radios legacy diferentes de los tokens: alinear el guard sin ampliar excepciones. Estos controles estáticos no sustituyen contraste computado ni operación en navegador.

### Matriz de recorridos

Cada fila se prueba como tarea completa, no solo como pantalla abierta. Fuente inicial del inventario: `App.tsx`, `utils/navigation.ts`, roles y middleware; verificar las capacidades reales antes de asignar permisos en la matriz.

| Recorrido prioritario | Personas/roles a verificar | Estados obligatorios |
|---|---|---|
| Registro → Inicio → primer producto → primera venta | Dueño nuevo de ferretería y farmacia | Sin catálogo, error de alta, stock cero, caja cerrada, cobro insuficiente, confirmado y regreso |
| Venta cotidiana → otra venta | Cajero y dueño según política vigente | Búsqueda/lector, precio/cantidad, efectivo/otros métodos, doble acción, error y respuesta perdida |
| Fiado → abono → saldo → comprobante | Dueño/cajero autorizado; probar rol denegado | Límite, parcial, total, exceso, retry y corrección autorizada |
| Compra → recepción → disponibilidad | Compras/bodega según permisos | Unidades/empaques, parcial, duplicado, bodega destino, proveedor y deuda |
| Devolución / anulación | Roles autorizados por operación | Parcial, repetida, venta anulada, abonos existentes, lote original y error recuperable |
| Caja → cierre → reimpresión | Cajero dueño del turno y supervisor autorizado | Ciego, exacto, diferencia, moneda, turno ajeno, retry y período bloqueado |
| Farmacia: lote → venta → devolución | Roles actuales, con modo de farmacia explícito | Físico/vendible/retenido, vencimiento, agotado, bloqueo, FEFO y trazabilidad |
| Usuario → permiso → cambio de sesión | Propietario/admin y roles restringidos | Revocación, JWT vigente/expirado, dos negocios, caché/offline e ID ajeno |
| Reportes → filtros → exportación | Dueño/administración/contabilidad según permisos | Vacío, carga, error, rango, zona horaria, paginación y conciliación con detalle |

Inventariar también los destinos restantes de `App.tsx`: hay 33 rutas autenticadas principales en la lectura actual, además de acceso y superficies públicas/canales. Cada ruta soportada requiere smoke de acceso, contenido y regreso; cada mutación de dinero/stock, permitido/denegado, fallo/retry y conciliación. Sitio público, demo, comprador, repartidor, admin y LENDER tienen contratos propios.

Cubrir primero 390×844 y 1440×900, después borde de quiebre 1023/1024 px, reflujo estrecho/zoom, teclado virtual, rotación y dispositivo físico usado por los participantes. Probar temas claro/oscuro cuando correspondan, movimiento reducido y VoiceOver/TalkBack según dispositivos disponibles. La matriz prioriza combinaciones peligrosas y recorridos principales; no pretende ejecutar indiscriminadamente todo el producto cartesiano.

### Pruebas con personas

Primera ronda: los tres usuarios habituales y cinco registrados que no volvieron, sujeto a disponibilidad y consentimiento. Registrar ferretería/farmacia, dispositivo, experiencia y tarea. Con muestras pequeñas reportar casos absolutos; no extrapolar porcentajes al mercado.

Observar primero sin dirigir. Luego permitir ayuda y marcar exactamente cuándo fue necesaria. Medir finalización sin ayuda, tiempo desde tarea iniciada, errores, retrocesos, ayuda y confianza al revisar total/existencia. Separar venta de práctica de venta legítima; las tareas de prueba se hacen con datos de prueba y no contaminan libros reales.

Criterio inicial propuesto para el recorrido prioritario: al menos 4 de los 5 registrados con poco o ningún uso completan la tarea sin intervención de ingeniería. Ese grupo se fija antes de observar; los tres habituales se analizan por separado. No seleccionar los cinco mejores resultados entre ocho. Además, ningún participante debe sufrir un error crítico en los casos observados. Si no hay cinco, no declarar el criterio superado. Repetir con el siguiente grupo después de corregir. Medir aparte primera venta confirmada, otra sesión con venta y uso en días distintos: dos tickets seguidos no demuestran regreso.

## 5. Validación de números, usuarios y operación

### Política antes de fórmula

Inventariar para cada importe/cantidad: unidad, moneda, signo, precisión interna y de persistencia, redondeo y momento de redondeo, fuente de verdad, vigencia, quién puede cambiarlo y snapshot histórico. Fijar explícitamente casos como `1.005`, descuentos combinados, impuesto incluido/exento, fracciones y conversión NIO/USD; no escoger un modo de redondeo para que el test coincida con el código.

El resultado esperado debe venir de ejemplos revisados a mano, aritmética decimal independiente y política del dominio. Un test que importa el mismo calculador para producir su esperado no demuestra corrección. Decimal evita ciertos errores de representación, pero no arregla una fórmula, una regla fiscal o una operación duplicada.

Por escenario, comprobar estas cinco capas: **interfaz → API autorizada → registro persistido → stock/saldos/asientos → reporte/comprobante**. Los fixtures positivos deben acompañarse de casos de rechazo sin efectos laterales. Para importes exactos, comparar a la precisión contractual; no introducir tolerancias arbitrarias de centavos.

### Ejemplos de control independientes

Son datos sintéticos para definir pruebas; el 15 %, el tipo de cambio y las políticas indicadas son parámetros del fixture, no una afirmación legal ni una cotización actual. Los resultados se recalcularon con Python Decimal separado del código de Nortex.

| Caso | Datos y política del ejemplo | Resultado esperado |
|---|---|---|
| Venta con descuento e impuesto incluido | 3 × C$115; descuento 10 % antes del impuesto incluido de 15 % | Subtotal C$345; descuento C$34,50; total C$310,50; base C$270; impuesto C$40,50 |
| Cobro en córdobas | Total C$310,50; recibido C$500 | Vuelto C$189,50; ingreso neto de efectivo C$310,50 |
| Crédito y abono | Deuda inicial de esa venta C$310,50; abono C$100 | Pendiente C$210,50; ingreso del abono C$100; la venta no se crea otra vez |
| Cobro USD / vuelto NIO | Gaveta inicial C$100 y US$0; venta C$310,50; recibe US$10; tasa fija 36,62; vuelto NIO | Equivalente recibido C$366,20; vuelto C$55,70; físico final C$44,30 + US$10; equivalente total C$410,50, sin contar dos veces la moneda |
| Producto medido | 2,375 kg × C$84/kg; sin descuento ni conversión | C$199,50; cantidad persistida y salida de stock 2,375 kg |
| Stock y transferencia | A:10, B:0; recibe6 en A; vende3 desde A; transfiere4 de A a B | A:9, B:4; agregado13; transferir no agrega ni elimina inventario |
| Duplicado | Repetir la misma venta confirmada con la misma clave y payload | Una venta y un conjunto de efectos; repetir no cambia dinero/stock. Misma clave con otro payload se rechaza |

Añadir fixture de devolución parcial según snapshot y regla vigente, reembolso por medio de pago, saldo a favor, recepción parcial, reverso contable y anulación con abonos. Su resultado no se generaliza desde “deshacer venta”: son procesos diferentes.

### Matriz técnica priorizada


**Niveles:** U = regla/servicio simulado; UI = render/browser con fixtures; I = HTTP + MySQL 8 real; O = observación con operador y periféricos. Las suites citadas son puntos de partida existentes, no una afirmación de que ya cubran todos los criterios de la fila. Los casos faltantes se añaden antes de aprobar el cambio afectado.

| ID | Escenario y variaciones obligatorias | Base existente / nivel a completar | Oráculo y aprobación |
|---|---|---|---|
| V01 | Cantidad contada/medida, step 0.0001, detalle/mayoreo/empaque explícito; vacío, NaN, negativos, overflow | `quantity.test.ts`, `pricing.test.ts`, `purchasePackaging.test.ts`, `posActivation.test.ts`; U→I | Enteros escalados; 6×8.50=51.00 y empaque explícito 12 por 90.00 según fixture. Rechazos sin escrituras |
| V02 | Snapshot GENERAL/CUOTA_FIJA/exento/mixto; cambio de configuración después de vender | `fiscalRegime.test.ts`, `reporteVentasIva.test.ts`, `nicaTaxMonthlyReport.test.ts`, `fiscalFlow.integration.test.ts`; U+I | Documento histórico no cambia al editar configuración. Base+impuesto=bruto exacto, sin afirmar obligaciones legales |
| V03 | Escanear→cobrar; recibido exacto/insuficiente/excedente; doble Enter/click, cerrar diálogo durante submit | `posVentaCritica.test.tsx`, `posCash.test.ts`, `posPaymentSheet.test.tsx`; UI→I | Un intento lógico/una venta; vuelto recibido−total; insuficiente conserva trabajo y no postea |
| V04 | Alterar total, precio, costo, descuento, cliente y producto del payload frente al servidor | `offlineSaleReplay.test.ts`, `salesService.ts`; ampliar I | Backend usa la política autoritativa; total UI enviado no basta como oráculo. Cero escritura parcial ante intención inválida |
| V05 | Dos tenants y roles OWNER/ADMIN/MANAGER/CASHIER/VENDEDOR/ACCOUNTANT/BODEGUERO/VIEWER; usuario deshabilitado/rol cambiado con JWT aún vigente | `authRevalidation.test.ts`, `customerFlow.integration.test.ts`, `fiscalFlow.integration.test.ts`, `accountingAuthorization.test.ts`; U+I+UI | Matriz explícita de acceso, tenant de JWT y autoridad persistida; lectura prohibida sin datos y mutación prohibida sin efectos. Probar URL directa además de menú |
| V06 | Dos cajas consumen la última unidad; solicitud multilínea donde falla la última; negativos permitidos/prohibidos | `stockAlert.test.ts`, `saleBatchWarehouseEgress.test.ts`; ampliar I | Con stock 1 y política restrictiva, exactamente una venta de 1 gana. Fallo multilínea revierte venta, stock, deuda, asiento y auditoría |
| V07 | Servidor confirma, respuesta se pierde, navegador encola y reintenta; mismo id distinto payload | `offlineSaleReplay.test.ts`, `offlineSaleReplay.mutation.test.ts`, `posVentaCritica.test.tsx`; U+UI→I | Un Sale, un efecto de stock y un asiento; payload diferente produce 409/conciliación, nunca segundo éxito silencioso |
| V08 | Replay sin turno/turno ajeno/usuario ajeno/empleado divergente/turno legítimo cerrado; cotización y aparcado de otra cuenta | `offlineSaleReplay.test.ts`, `syncIdentityRoute.test.ts`, `quotationPosBridge.test.ts`, `cartPersistence.test.ts`; U+UI→I | No reatribuir identidad; casos inválidos sin efectos. Turno cerrado legítimo conserva fecha económica y política explícita |
| V09 | Dos créditos simultáneos y límite restante; abono parcial CASH/TRANSFER duplicado; saldo a favor total/parcial | `saleCreditConcurrency.test.ts`, `customerFlow.integration.test.ts`, `storeCreditSale.test.ts`; U+I | Límite100 con dos cargos60: solo uno gana. Transferencia no entra gaveta; saldo a favor consume pasivo una vez y caja recibe solo remanente |
| V10 | Apertura, ventas mixtas, entradas/salidas, abono, devolución, agente bancario y USD | `margen.test.ts`, `pulsoPos.test.ts`, `postSalePrintCash.test.ts`; U→I | Fixture de gaveta definido abajo; POS, monitor, movimiento y cierre coinciden. No sumar monedas ni crédito a efectivo |
| V11 | Dos cierres iguales/diferentes; venta o OUT concurrente contra cierre; reintento tras respuesta perdida | `closeShiftIdempotency.test.ts`, `cashCloseConcurrencyGuards.test.ts`, `cashCloseJournal.mysql.test.ts`; U+I | Un cierre/auditoría. Igual devuelve mismo resultado, distinto409. Ganador del lock define población; no admitir movimiento perdido fuera del cierre |
| V12 | Posting/reverso concurrente; cuenta ausente; período cerrado; pool pequeño; fallo de auditoría | `journalPosting.test.ts`, `journalPosting.edge.test.ts`, `cashCloseJournal.mysql.test.ts`, `accountingLockOrder.test.ts`; U+I | Debe=Haber y cambios de saldo exactos; una póliza/reverso/auditoría. Error revierte todas las tablas y nunca cuelga por conexión anidada |
| V13 | Anulación CASH/CARD/CREDIT; repetición; venta con devolución/abono; período cerrado | `saleCancellation.test.ts`, `returnBatchWarehouseLedger.test.ts`, `procurementPhaseTwoB.integration.test.ts`; U+I | Documento VOIDED una vez, revierte cantidades/costo histórico/deuda/asiento según método. En CASH no descontar doble al excluir venta anulada y crear otro OUT |
| V14 | Devolución parcial repetida y acumulada excesiva; efectivo/saldo a favor/reembolso externo pendiente | `returnService.test.ts`, `returnAccounting.test.ts`, `returnIdempotency.integration.test.ts`, `returnBatchWarehouseLedger.test.ts`; U+I | Nunca devuelve más de lo vendido; cantidades/lotes históricos exactos. Pasivo, efectivo y banco distinguidos; fuente de saldo a favor trazable |
| V15 | OC→recepción→factura→pago/NC; recepción y factura duplicadas, sobrerrecepción y órdenes inversas concurrentes | `purchaseFlow.integration.test.ts`, `procurementPhaseOne.integration.test.ts`, `procurementPhaseTwo.integration.test.ts`, `procurementPhaseTwoB.integration.test.ts`; I | Recepción mueve stock una vez; factura no repite recepción; documento/pago/NC ajustan CxP y asiento según contrato; sin deadlock persistente |
| V16 | CxP con 0/1/500/501+ documentos; legacy con saldo fallback; filtros y todas las páginas | `supplierPayments.test.ts`, `purchaseDocumentStatus.test.ts`, `purchases/pending` en server; ampliar I | Para 501 facturas pendientes de 1.0000 cada una, total global501.0000 independiente de página; los tamaños0/1/500 tienen esperado propio; saldo de proveedor y mayor reconciliados. Actualmente hay defecto estático documentado |
| V17 | Dos bodegas, transferencia parcial, ajuste insuficiente y conteos paralelos por bodega | `inventoryAdjust.integration.test.ts`, `stockCountWarehouse.integration.test.ts`, `stockTransferService.test.ts`, `procurementPhaseTwoB.integration.test.ts`; U+I | Cambia solo bodega autorizada; suma local/agregado/Kardex exactos; transferencia no crea ni destruye cantidad; rollback sin parcial |
| V18 | Farmacia: lotes con hoy/ayer/mañana, FEFO por bodega, retorno al lote original; stock retenido si se incorpora | `saleBatchAllocationService.test.ts`, `saleBatchWarehouseEgress.test.ts`, `productBatchWarehouseLedgerService.test.ts`; U→I+O | Reloj civil Managua congelado; validar política de vencimiento explícita y availability del lote, no solo Product.stock. Retención/bloqueos requieren contrato y cobertura que no se encontró en este checkout |
| V19 | Mismo período en Inicio/reportes/JSON/HTML/XLSX; medianoche Managua, VOIDED, devolución de venta de otro mes; refresco fallido | `fiscalAccess.test.ts`, `reporteVentasIva.test.ts`, `nicaTaxMonthlyReport.test.ts`, `salesQuantityReport.test.ts`, `miNegocioActivation.test.tsx`; U+UI+I | Población y definición escritas; subtotal de grupos=total; snapshots intactos; error visible o dato ausente, no cero inventado ni cifra vieja sin señal |
| V20 | Jornada observada: dueño+cajero, apertura→alta/importación→ventas→mala red→retorno→arqueo→ticket→día siguiente | Harness anterior + navegador/API/DB real de QA y dispositivos del piloto; O | Operador completa sin ingeniería; conteo físico, tickets y libro independiente concilian. Registrar ayuda, error, reintento, tiempo y retorno posterior; no convertir demo en adopción |


Fixture adicional V10: fondo NIO500 + venta CASH115 + abono CASH25 + entrada20 − salida10 − devolución CASH15 = NIO635. Por separado: USD30 + USD10 − USD5 = USD35. CARD/TRANSFER/CREDIT no ingresan a la gaveta. Los movimientos de agente bancario deben tener su fixture y naturaleza propios; no se agregan a ventas. Los nombres abreviados de suites se ubican bajo `tests/`; `salesService.ts` corresponde a `backend/services/`.

**Riesgos actuales a resolver según el flujo:**

- CxP: `backend/server.ts` limita pendientes a 500 y deriva el total de esa página; V16 debe cubrir 501+ y el saldo efectivo legacy antes de presentar un total global fiable.
- Contabilidad: `getAccount()` usa cliente global dentro del recorrido de `createJournalEntry(tx,...)`; probar pool pequeño, cuenta nueva y rollback antes de consolidar clientes. Es un riesgo estático; la falla no se reprodujo en esta planificación.
- Precisión: precio/costo de Product aún Float y sumas contables pasan por Number en partes legacy. Definir fronteras y medir casos antes de migrar cada agregado; no hacer conversión masiva para cumplir una etiqueta.
- Farmacia: hay FEFO/lotes/bodega, pero no se hallaron `pharmacyInventoryMode`, `ProductBatchHold`, `heldStock` ni `sellableStock` en el schema actual. Trabajo de otra copia o una memoria no acredita esa capacidad aquí. Verificar e implementar lo que falte antes de prometer stock vendible/retenido.
- Históricos: permanece baja física de productos. Simplificar una acción de eliminar exige comprobar Kardex/lotes/documentos y un contrato de archivo; no borrar historia para limpiar la interfaz.

Las prioridades se aplican al flujo afectado y se contrastan con uso/incidentes. Estos hallazgos de código no demuestran por sí solos daños actuales a clientes. No impiden avanzar prototipos de lectura o correcciones visuales independientes.

Además, inventariar todo módulo habilitado por tenant: RRHH/nómina, préstamos/mora, delivery/wallet, agente bancario y suscripciones. Validar sus roles, movimientos y reportes si están en uso. Si no se conoce el uso, marcarlo PENDIENTE; no asumir que es seguro posponerlo ni habilitarlo por este plan. Nómina, fiscalidad, clasificación de cuentas y políticas de crédito requieren responsable profesional y versión normativa antes de aceptar resultados.

Métricas del SaaS: separar personas de negocios, login de venta confirmada, GMV de MRR, trial de pago, cuota contratada de cobro conciliado y reembolso de ingreso. Los datos de onboarding ayudan al recorrido, pero no sustituyen una cohorte ni un cierre financiero.

## 6. Cómo se obtiene evidencia fiable

1. **Contrato y casos conocidos.** Fixtures revisados por alguien distinto del implementador; entradas y esperado versionados.
2. **Pruebas puras y propiedades.** Signos, límites, precisión, monotonicidad donde aplique y conservación de cantidades. Semillas reproducibles; ninguna propiedad debe ignorar descuentos por umbral o redondeo definido.
3. **HTTP con aplicación real y MySQL 8 efímero.** Dos tenants, roles permitidos/denegados y conexiones concurrentes. El runner arranca, espera disponibilidad y falla si falta DB, no se descubren casos o hay una omisión obligatoria. No reemplazarlo por mocks para cerrar el gate. Reutilizar `scripts/test-cash-close-journal-mysql.sh` y `scripts/test-delivery-mysql.sh` como base, ampliando suites y parametrizando recursos: el wrapper de caja usa nombres fijos y debe serializarse hasta aislarlos por ejecución. Deshabilitar correo, Stripe, WhatsApp y jobs externos. Una URL loopback no prueba por sí sola que la base destino sea de QA.
4. **UI conectada a esa API.** Venta completa, recibido/vuelto, error y recuperación, actualización del resumen y registros comprobados. Los mocks siguen siendo útiles para pruebas rápidas de componentes, con evidencia marcada como tal.
5. **Fallas y concurrencia.** Respuesta perdida después de commit, dos cajeros vendiendo la última unidad, cierre duplicado, reintentos de abonos/devoluciones, desconexión durante replay y cambio de usuario. Al fallar antes del commit no quedan efectos parciales; después de commit se reconcilia con la misma identidad/idempotencia.
6. **Migración y restore.** Datos legacy sintéticos, respaldo, schema aditivo, backfill/reconciliación y ensayo de restauración aislado. No ejecutar restore de prueba sobre producción.
7. **Revisión del candidato.** CI y staging del mismo SHA, más manifiesto cuando se audite un árbol con cambios; revisión visual, de dominio y omisiones explícitas. El resultado local anterior no se transfiere a un candidato distinto.

Para dinero puro, aplicar mutación al alcance afectado y revisar sobrevivientes relevantes. Conservar el umbral configurado y justificar el alcance; una cifra de mutación alta sobre pocas funciones no certifica todo el negocio. Para seguridad, ampliar por superficie con auditoría específica; el plan general no es un escaneo exhaustivo ni una certificación.

## 7. Ejecución por entregas

Estimación orientativa para un desarrollador dedicado con participación del fundador y revisiones de dominio. La capacidad real aún no se confirmó; los días organizan el trabajo y no prometen validar todo Nortex en una fecha fija.

| Orden / ventana | Entrega concreta | Responsable | Condición de salida |
|---|---|---|---|
| D01, días 1–2 | Inventario de módulos/roles usados, candidato local, métricas faltantes y registro de decisiones | Producto + técnica | Cada flujo tiene dueño, riesgo, fuente y estado; sin afirmar hechos productivos no comprobados |
| D02, días 2–4 | Reconciliar skills, adaptar cuatro funciones y evaluar sus handoffs | Técnica + calidad | Casos de evaluación pasan; no hay recetas contradictorias de rama/deploy/dinero |
| D03, días 2–5 | Contrato UX v1 y baseline de las tareas; observar primera ronda | Producto/UX | Patrón común y problemas reproducibles priorizados; evidencia separada de gusto personal |
| D04, días 3–7 | Catálogo de invariantes, precisión y fixtures independientes | Integridad + responsable del dominio | No quedan reglas ambiguas en la primera tanda crítica |
| D05, semana 2 | Runner y job obligatorios de negocio MySQL/HTTP | Técnica + calidad | Arranque aislado, casos positivos/negativos y falla demostrada si la suite está vacía/omitida |
| D06, semanas 2–3 | Primer bloque: venta → stock → cobro → caja, incluyendo replay | Técnica + integridad + calidad | Contratos críticos, doble acción, concurrencia y UI pasan juntos; reparar antes de ampliar |
| D07, semanas 3–4 | Segundo bloque: fiado, compras, devoluciones, reportes y farmacia según uso | Dueños de dominio | Saldos/documentos/lotes conciliados; cada discrepancia explicada o corregida |
| D08, semanas 4–6 | Modularización por flujo y aplicación del contrato UX al resto prioritario | Técnica + producto | Componentes/rutas reutilizables, presupuestos sin crecer y regresión integrada |
| D09, después de gates técnicos | Staging, prueba observada y piloto de candidato autorizado | Calidad + fundador | Misma versión, restauración y rollback preparados, transacciones legítimas y monitoreo |
| D10, semanas 6–8 orientativas | Revisar repetición de uso, soporte, pagos y costo | Producto + integridad | Cohortes maduras y pagos reales informan la siguiente inversión |

D03/D04 pueden prepararse en paralelo. D06 depende de D04/D05; el piloto depende de pruebas y políticas vigentes, no del calendario. Si hay un defecto activo de pérdida de datos/dinero o acceso indebido, su contención precede los cambios visuales. Los trabajos avanzan de uno en uno por dominio, con un integrador para archivos compartidos.

## 8. Qué significa aprobar

| Puerta | Evidencia requerida | Lo que impide avanzar |
|---|---|---|
| G0 Alcance y política | Actor, tenant, regla, riesgo, oráculo y responsable definidos | Falta una regla material o no se conoce el estado real del dato |
| G1 Experiencia | Tarea observada, contrato visual, teclado/foco/contraste/errores verificados | No se puede completar, acción ambigua, datos ilegibles o confirmación engañosa |
| G2 Integridad | Casos críticos HTTP/MySQL, conciliación, autorización, replay y concurrencia | Diferencia inexplicada, fuga entre tenants, duplicado, parcial persistido o suite obligatoria omitida |
| G3 Ingeniería | Tipos, schema, build, pruebas, presupuesto y contratos; revisión independiente | Regresión, migración riesgosa, test debilitado o excepción para ocultar un fallo |
| G4 Candidato | CI, staging y artefacto identificados; restore y rollback adecuados al cambio | SHA diferente, entorno no comprobado o evidencia tomada de otro candidato |
| G5 Publicación | Autorización productiva del candidato y rollout acordado; salud y humo posteriores | Aprobación solo local, promoción automática no autorizada o resultados ambiguos |
| G6 Resultado comercial | Primera venta y regreso por cohorte, incidencias, pagos/costos conciliados | Solo registros, clicks, tráfico o intención de pago sin hechos de uso/cobro |

Una puerta puede quedar PENDIENTE o BLOQUEADA sin convertir todo el producto en fallido. Una sección fuera del alcance puede marcarse NO APLICA con motivo y revisor; por ejemplo, un cambio de texto independiente no exige repetir conciliación MySQL ni un estudio comercial. G6 sirve para evaluar inversión y utilidad, no para demorar la reparación de un defecto crítico. Las puertas de integridad no se omiten cuando el cambio sí afecta al contrato financiero o de permisos. Se identifica el flujo afectado y se permite continuar el trabajo independiente seguro. No exigir confirmaciones para cada cambio reversible de texto o UI; la revisión es proporcional al riesgo. Las autorizaciones ya concedidas siguen vigentes dentro de su alcance.

Antes de un release revisar además la configuración real de GitHub y las rutas de promoción. Una regla escrita en un MD no garantiza que el workflow la cumpla. Probar el caso negativo de documentación sin autorización productiva: no debe promover producción. Este control requiere implementación/verificación propia; no se considera arreglado por haber escrito el plan.

## 9. Tablero de evidencia y continuidad entre modelos

Por cada flujo: ID, estado documental (PROPUESTO / IMPLEMENTADO_LOCAL / VALIDADO_LOCAL / VALIDADO_STAGING / VALIDADO_PRODUCCION / HISTORICO), bloqueo operativo si existe, propietario, revisor, política, SHA+manifiesto, escenario/fixture, esperado/observado, comando, evidencias, omisiones y siguiente condición de salida. El [formato común](templates/CONTRATO_ENTREGA_VERIFICADA.md) evita reiniciar la auditoría desde cero con cada modelo.

Una captura valida una apariencia concreta; un test de componente valida un contrato acotado; HTTP/MySQL valida efectos bajo escenarios; un especialista valida política; usuarios validan comprensión; producción valida el candidato en su entorno. Ninguna capa reemplaza a las demás.

El repositorio conserva fuentes canónicas: AGENTS/CLAUDE para reglas, este plan para dirección/validación, plan general para prioridades y planes de dominio para detalle. Los hallazgos históricos permanecen con su fecha; una decisión nueva indica qué sustituye. El RAG de clientes solo utiliza ayuda aprobada, no este plan ni recetas de ingeniería.


## 10. Alcance de esta actualización documental

Se revisaron código, planes, skills/catálogos y fuentes oficiales para elaborar este plan. En este turno no se ejecutaron suites nuevas del producto, no se consultó una base de clientes, no se instalaron skills, no se activaron agentes ni se desplegó. Los cálculos ilustrativos se comprobaron aparte con Decimal. La validación documental comprueba vínculos, referencias, contenido y preservación del checkout; no eleva el estado de los flujos de negocio.

El primer paquete ejecutable es D01–D05: cerrar reglas contradictorias, contrato UX, esperado numérico y job de negocio obligatorio. Los resultados de ese paquete decidirán el alcance de los siguientes cambios.
